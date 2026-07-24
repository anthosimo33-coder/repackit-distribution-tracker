/**
 * Rattrapage du stock Assets — post-traitement des images déposées AVANT
 * l'existence du pipeline (retrait C2PA/EXIF/XMP + ré-encodage).
 *
 *   pnpm tsx scripts/postprocess-existing-assets.ts              # dry-run (dev)
 *   pnpm tsx scripts/postprocess-existing-assets.ts --prod       # dry-run (prod)
 *   pnpm tsx scripts/postprocess-existing-assets.ts --prod --folder "chris.frn"
 *   pnpm tsx scripts/postprocess-existing-assets.ts --prod --folder "chris.frn" --apply
 *   pnpm tsx scripts/postprocess-existing-assets.ts --prod --restore --apply
 *   pnpm tsx scripts/postprocess-existing-assets.ts --prod --purge-backups --apply
 *
 * MANUEL, jamais automatique : pas de route, pas de cron. `--apply` est
 * obligatoire pour écrire quoi que ce soit ; sans lui le script se contente de
 * lister ce qu'il ferait, dimensions et poids à l'appui. Vrai pour les TROIS
 * modes (traitement, restauration, purge).
 *
 * `--folder <fragment|id>` restreint à UN dossier : permet de dérouler un
 * dossier, vérifier le rendu à l'œil, puis enchaîner sur le reste.
 *
 * SAUVEGARDE — chaque image traitée conserve son original dans
 * `postprocessBackup`. `--restore` revient en arrière (rien n'est perdu),
 * `--purge-backups` supprime définitivement les originaux une fois le rendu
 * validé. Tant que la purge n'est pas passée, le stockage occupé est doublé et
 * les blobs de sauvegarde CONSERVENT leurs métadonnées de provenance.
 *
 * PÉRIMÈTRE — uniquement les images d'un dossier marqué « contenu à publier »
 * (assetFolders.postprocessImages) qui n'ont PAS encore de `postprocessedAt`.
 * Le matériel source que les créatrices retravaillent n'est jamais touché : le
 * pipeline est destructif et irréversible.
 *
 * IDEMPOTENCE — `postprocessedAt` est posé au commit et re-vérifié SERVEUR au
 * moment d'écrire. Une 2ᵉ passe ne retraite rien : sans ce verrou elle
 * recompresserait une image déjà recompressée, en cumulant les pertes.
 *
 * MÊME MOTEUR QUE L'INGESTION — `postProcessImage` de lib/image-postprocess est
 * importé tel quel, avec les mêmes garde-fous que la route (dimensions réelles
 * relues par image, plafond 10 Mo, original conservé en cas d'échec). Aucune
 * logique dupliquée.
 *
 * Convex passe par `npx convex run` (fonctions internes de
 * convex/assetsMigration.ts) : l'authentification est celle de la CLI, aucun
 * secret applicatif n'est requis ni manipulé ici.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ASSET_IMAGE_MAX_BYTES } from "../lib/asset-file";
import {
  POSTPROCESS_OUTPUT_TYPE,
  hasC2PAMarker,
  postProcessImage,
  readImageDimensions,
  toJpegFileName,
} from "../lib/image-postprocess";

const run = promisify(execFile);

const APPLY = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");
const RESTORE = process.argv.includes("--restore");
const PURGE = process.argv.includes("--purge-backups");
/** `--folder <fragment|id>` : restreint le lot à un dossier. */
const FOLDER = (() => {
  const i = process.argv.indexOf("--folder");
  return i !== -1 ? process.argv[i + 1] : undefined;
})();
/** Taille de lot : borne la mémoire (buffers d'images) et la taille des appels. */
const BATCH_SIZE = 10;

type Candidate = {
  assetId: string;
  folderName: string;
  fileName: string;
  contentType: string;
  size: number;
  url: string | null;
};

type CandidatePayload = {
  candidates: Candidate[];
  totalCandidates: number;
  skipped: Array<{ fileName: string; folderName: string; reason: string }>;
  outOfScope: number;
  flaggedFolders: string[];
};

/** Appel d'une fonction interne Convex via la CLI (auth = celle du dev). */
async function convexRun<T>(fn: string, args: unknown): Promise<T> {
  const argv = ["convex", "run", fn, JSON.stringify(args)];
  if (PROD) argv.push("--prod");
  const { stdout } = await run("npx", argv, {
    maxBuffer: 64 * 1024 * 1024,
  });
  // La CLI peut préfixer des lignes de log : on ne garde que la valeur JSON.
  const text = stdout.trim();
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error(`Réponse Convex illisible pour ${fn}`);
  return JSON.parse(text.slice(start)) as T;
}

const mo = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} Mo`;

type Outcome =
  | { kind: "ok"; label: string }
  | { kind: "skip"; label: string; reason: string }
  | { kind: "fail"; label: string; reason: string };

/**
 * Traite UNE image : lecture du blob, pipeline, upload du résultat. Ne jette
 * jamais — un échec est retourné, il ne doit pas interrompre le lot.
 */
async function processOne(
  candidate: Candidate,
  uploadUrl: string,
): Promise<
  | { outcome: Outcome; commit: null }
  | {
      outcome: Outcome;
      commit: {
        assetId: string;
        storageId: string;
        fileName: string;
        contentType: string;
        size: number;
      };
    }
> {
  const label = `${candidate.folderName}/${candidate.fileName}`;
  try {
    if (!candidate.url) throw new Error("URL de lecture indisponible");

    const res = await fetch(candidate.url);
    if (!res.ok) throw new Error(`lecture HTTP ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());

    const dimensions = await readImageDimensions(input);
    if (!dimensions) throw new Error("dimensions illisibles");

    const output = await postProcessImage(input, {
      targetWidth: dimensions.width,
      targetHeight: dimensions.height,
    });

    // Même garde que la route : on renonce au traitement plutôt que de faire
    // grossir un fichier au-delà du plafond (il deviendrait non conforme).
    if (output.byteLength > ASSET_IMAGE_MAX_BYTES) {
      return {
        outcome: {
          kind: "skip",
          label,
          reason: `sortie ${mo(output.byteLength)} > plafond ${mo(ASSET_IMAGE_MAX_BYTES)}`,
        },
        commit: null,
      };
    }

    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": POSTPROCESS_OUTPUT_TYPE },
      body: new Uint8Array(output),
    });
    if (!upload.ok) throw new Error(`upload HTTP ${upload.status}`);
    const { storageId } = (await upload.json()) as { storageId?: string };
    if (!storageId) throw new Error("storageId absent");

    return {
      outcome: {
        kind: "ok",
        label: `${label} — ${dimensions.width}×${dimensions.height}, ${mo(candidate.size)} → ${mo(output.byteLength)}`,
      },
      commit: {
        assetId: candidate.assetId,
        storageId,
        fileName: toJpegFileName(candidate.fileName),
        contentType: POSTPROCESS_OUTPUT_TYPE,
        size: output.byteLength,
      },
    };
  } catch (e) {
    return {
      outcome: {
        kind: "fail",
        label,
        reason: e instanceof Error ? e.message : "erreur inconnue",
      },
      commit: null,
    };
  }
}

/** Inspection LECTURE SEULE d'une image : dimensions + présence de provenance. */
async function inspect(candidate: Candidate): Promise<string> {
  if (!candidate.url) return "  ?  URL de lecture indisponible";
  try {
    const res = await fetch(candidate.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());
    const d = await readImageDimensions(input);
    const c2pa = hasC2PAMarker(input) ? " · marqueur C2PA" : "";
    return `  ·  ${candidate.folderName}/${candidate.fileName} — ${
      d ? `${d.width}×${d.height}` : "dimensions illisibles"
    }, ${mo(candidate.size)}, ${candidate.contentType}${c2pa}`;
  } catch (e) {
    return `  ?  ${candidate.folderName}/${candidate.fileName} — inspection impossible (${
      e instanceof Error ? e.message : "?"
    })`;
  }
}

type BackupRow = {
  assetId: string;
  folderName: string;
  current: { fileName: string; size: number };
  backup: { fileName: string; size: number };
};

/** `--restore` / `--purge-backups` : opèrent sur les sauvegardes existantes. */
async function backupMode() {
  const rows = await convexRun<BackupRow[]>("assetsMigration:listBackups", {
    folder: FOLDER,
  });

  if (rows.length === 0) {
    console.log("Aucune sauvegarde trouvée pour ce périmètre.\n");
    return;
  }

  for (const r of rows) {
    console.log(
      `  ·  ${r.folderName}/${r.current.fileName} — sauvegarde « ${r.backup.fileName} » (${mo(r.backup.size)})`,
    );
  }
  const total = rows.reduce((s, r) => s + r.backup.size, 0);
  console.log(`\n${rows.length} sauvegarde(s), ${mo(total)}.`);

  if (!APPLY) {
    console.log(
      RESTORE
        ? "Relance avec --apply pour RESTAURER ces originaux (l'image traitée sera supprimée).\n"
        : "Relance avec --apply pour PURGER définitivement ces originaux.\n",
    );
    return;
  }

  const ids = rows.map((r) => r.assetId);
  if (RESTORE) {
    const { restored, missing } = await convexRun<{
      restored: number;
      missing: string[];
    }>("assetsMigration:restoreOriginals", { assetIds: ids });
    console.log(
      `\n=== ${restored} original(aux) restauré(s)${missing.length > 0 ? `, ${missing.length} sans sauvegarde` : ""} ===\n`,
    );
  } else {
    const { purged } = await convexRun<{ purged: number }>(
      "assetsMigration:purgeBackups",
      { assetIds: ids },
    );
    console.log(
      `\n=== ${purged} sauvegarde(s) purgée(s) — retour arrière désormais impossible ===\n`,
    );
  }
}

async function main() {
  const target = PROD ? "PROD" : "dev";
  const mode = RESTORE ? "RESTORE" : PURGE ? "PURGE-BACKUPS" : "TRAITEMENT";
  console.log(
    `\n=== Rattrapage post-traitement Assets — ${target} — ${mode} — ${APPLY ? "APPLY" : "DRY-RUN"} ===`,
  );
  console.log(
    FOLDER ? `Périmètre : dossier « ${FOLDER} »\n` : "Périmètre : tous les dossiers marqués\n",
  );

  if (RESTORE && PURGE) {
    throw new Error("--restore et --purge-backups sont exclusifs.");
  }
  if (RESTORE || PURGE) return backupMode();

  const payload = await convexRun<CandidatePayload>(
    "assetsMigration:listPostprocessCandidates",
    { folder: FOLDER },
  );

  console.log(
    `Dossiers marqués « contenu à publier » : ${
      payload.flaggedFolders.length === 0
        ? "AUCUN"
        : payload.flaggedFolders.join(", ")
    }`,
  );
  console.log(`Assets hors périmètre (dossiers non marqués) : ${payload.outOfScope}`);
  console.log(`Candidats à traiter : ${payload.totalCandidates}`);

  for (const s of payload.skipped) {
    console.log(`  ⊘  ${s.folderName}/${s.fileName} — skippé (${s.reason})`);
  }

  if (payload.totalCandidates === 0) {
    console.log(
      "\nRien à faire. Si c'est inattendu : le flag « contenu à publier » n'est peut-être posé sur aucun dossier.\n",
    );
    return;
  }

  if (!APPLY) {
    console.log("\n--- Ce qui serait traité (aucune écriture) ---");
    for (const c of payload.candidates) console.log(await inspect(c));
    const total = payload.candidates.reduce((s, c) => s + c.size, 0);
    console.log(
      `\n${payload.candidates.length} image(s), ${mo(total)} au total.\nRelance avec --apply pour exécuter.\n`,
    );
    return;
  }

  const tally = { ok: 0, skip: 0, fail: 0 };
  for (let i = 0; i < payload.candidates.length; i += BATCH_SIZE) {
    const batch = payload.candidates.slice(i, i + BATCH_SIZE);
    console.log(
      `\n--- Lot ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} image(s)) ---`,
    );

    const uploadUrls = await convexRun<string[]>(
      "assetsMigration:prepareUploadUrls",
      { count: batch.length },
    );

    const commits: Array<{
      assetId: string;
      storageId: string;
      fileName: string;
      contentType: string;
      size: number;
    }> = [];

    // Séquentiel : borne la mémoire (un buffer décodé ≈ 8 Mo) et reste lisible
    // dans le log. Un échec est enregistré puis on continue le lot.
    for (const [n, candidate] of batch.entries()) {
      const { outcome, commit } = await processOne(candidate, uploadUrls[n]);
      if (outcome.kind === "ok") {
        tally.ok++;
        console.log(`  ✓  ${outcome.label}`);
      } else if (outcome.kind === "skip") {
        tally.skip++;
        console.log(`  ⊘  ${outcome.label} — skippé (${outcome.reason})`);
      } else {
        tally.fail++;
        console.log(
          `  ✗  ${outcome.label} — ÉCHEC (${outcome.reason}) — original conservé`,
        );
      }
      if (commit) commits.push(commit);
    }

    if (commits.length > 0) {
      const { committed, conflicts } = await convexRun<{
        committed: number;
        conflicts: string[];
      }>("assetsMigration:commitPostprocessed", { results: commits });
      console.log(
        `  →  ${committed} row(s) basculée(s), original conservé en sauvegarde.`,
      );
      if (conflicts.length > 0) {
        console.log(
          `  !  ${conflicts.length} asset(s) déjà traité(s) entre-temps — ignoré(s).`,
        );
      }
    }
  }

  console.log(
    `\n=== Terminé — ${tally.ok} traitée(s), ${tally.skip} skippée(s), ${tally.fail} en échec ===`,
  );
  if (tally.ok > 0) {
    console.log(
      "Originaux conservés. Vérifie le rendu, puis --purge-backups (définitif) ou --restore (retour arrière).\n",
    );
  }
}

main().catch((e) => {
  console.error("\nÉchec du script :", e instanceof Error ? e.message : e);
  process.exit(1);
});
