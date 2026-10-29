#!/usr/bin/env node
/**
 * GARDE DE TÊTE DE MAIN — un build Vercel Production ne pousse le code Convex
 * prod que s'il porte ENCORE le commit de tête de `main`.
 *
 * POURQUOI. Le 2026-10-29, #434 (d42d186) et #433 (f66cc71, son enfant) ont été
 * mergées à 5 s d'écart. Vercel a lancé les deux builds Production EN
 * PARALLÈLE. `convex deploy --cmd 'pnpm build'` pousse Convex APRÈS la commande
 * (runCommand puis runPush, node_modules/convex/dist/cjs/cli/lib/deploy2.js) :
 * le build du parent a fini en dernier et a poussé à 14:40:49, contre 14:40:40
 * pour l'enfant. Convex prod a tourné sans #433, alors que les deux
 * déploiements étaient « Ready » et l'alias sur #433. Aucun signal ne le disait.
 *
 * LE MÉCANISME. `vercel.json` appelle ce script deux fois :
 *   1. avant tout (`avant-build`) — un commit déjà périmé n'a pas à dérouler
 *      80 s de `next build` ;
 *   2. en DERNIÈRE commande du `--cmd` de `convex deploy` (`avant-push`) —
 *      c'est là que la course se joue. `convex deploy` lance `--cmd` dans un
 *      shell et s'arrête sans pousser si son statut n'est pas 0.
 * Reste une fenêtre de quelques secondes (le push lui-même) : pour la perdre,
 * il faudrait qu'un commit mergé APRÈS ce contrôle finisse son propre build
 * (installation + `next build`) avant la fin de ce push.
 *
 * ÉCHEC, PAS SAUT. Un build périmé échoue au lieu de réussir sans pousser : un
 * déploiement en erreur ne devient jamais « Ready », donc ne peut pas recevoir
 * l'alias de production avec un front qui ne correspond pas au backend. Le
 * build du commit de tête fait le push. Une marque rouge sur le commit périmé
 * est le prix, et elle dit la vérité.
 *
 * FERMÉ PAR DÉFAUT. Tête illisible (réseau, dépôt repassé privé, ref absente)
 * après 3 essais, ou SHA absent : on ne pousse pas. On ne peut pas prouver que
 * ce commit est la tête ; Convex reste sur la version précédente, et le front
 * aussi puisque le build échoue. Un `vercel redeploy` du commit de tête suffit
 * une fois GitHub joignable. Si le dépôt redevient privé, `git ls-remote`
 * anonyme échouera à CHAQUE build : c'est ce script qu'il faudra adapter.
 *
 * HORS PRODUCTION (`VERCEL_ENV` ≠ "production", poste local, CI) : aucun
 * contrôle. `convex deploy` refuse de lui-même une clé prod hors production
 * Vercel (isNonProdBuildEnvironment) ; la CI ne passe pas par `buildCommand`.
 *
 * Testé par scripts/convex-head-guard.test.mjs, câblage de vercel.json compris.
 */

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

/** Dépôt public depuis juin 2026 : `ls-remote` anonyme, aucun jeton. */
export const REPO_URL =
  "https://github.com/anthosimo33-coder/repackit-distribution-tracker";
const MAIN_REF = "refs/heads/main";
const ATTEMPTS = 3;

/**
 * SHA de `refs/heads/main` dans une sortie de `git ls-remote`, ou null.
 * Le motif passé à ls-remote matche par la FIN du nom : une branche
 * `x/refs/heads/main` sortirait aussi. On ne garde que la ref exacte.
 */
export function parseLsRemote(stdout) {
  for (const line of stdout.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === MAIN_REF && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  return null;
}

/** Tête de `main` sur `url`, lue par le vrai git. Lève si git échoue. */
export async function readRemoteHead(url = REPO_URL) {
  const { stdout } = await promisify(execFile)(
    "git",
    ["ls-remote", url, MAIN_REF],
    {
      timeout: 15_000,
      // Sans terminal (build Vercel), une demande d'identifiants pendrait
      // jusqu'au timeout : on veut l'échec tout de suite.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  return parseLsRemote(stdout);
}

const short = (sha) => sha.slice(0, 7);

/**
 * Décision : `{ push: true }` ou `{ push: false }`, avec le message à imprimer.
 * `readHead` et `sleep` sont injectés pour les tests.
 */
export async function checkHead({
  env,
  readHead = readRemoteHead,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (env.VERCEL_ENV !== "production") {
    return {
      push: true,
      message: `VERCEL_ENV=${env.VERCEL_ENV ?? "(absent)"} : pas un build de production, contrôle sans objet.`,
    };
  }
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (!sha) {
    return {
      push: false,
      message:
        "VERCEL_GIT_COMMIT_SHA absent : déploiement de production hors Git, rien à comparer à la tête de main. Convex prod n'est PAS poussé.",
    };
  }

  let head = null;
  let lastError = "ref refs/heads/main absente de la réponse";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      head = await readHead();
      if (head) break;
      lastError = "ref refs/heads/main absente de la réponse";
    } catch (e) {
      lastError = String(e?.message ?? e).trim();
    }
    if (attempt < ATTEMPTS) await sleep(1000 * attempt);
  }
  if (!head) {
    return {
      push: false,
      message: [
        `Tête de main illisible après ${ATTEMPTS} essais (${lastError}).`,
        `Convex prod n'est PAS poussé : rien ne prouve que ${short(sha)} est la tête.`,
        "Relancer ce déploiement (vercel redeploy) une fois GitHub joignable.",
      ].join("\n"),
    };
  }
  if (head !== sha) {
    return {
      push: false,
      message: [
        `Ce build porte ${short(sha)}, mais main est déjà à ${short(head)}.`,
        `Convex prod n'est PAS poussé : le build de ${short(head)} s'en charge.`,
        "Échec voulu : ce déploiement périmé ne doit jamais devenir « Ready ».",
      ].join("\n"),
    };
  }
  return { push: true, message: `${short(sha)} est la tête de main.` };
}

// ─── Point d'entrée (vercel.json → buildCommand) ────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const label = process.argv[2] ? `:${process.argv[2]}` : "";
  const prefix = `[convex-head-guard${label}]`;
  const verdict = await checkHead({ env: process.env });
  for (const line of verdict.message.split("\n")) {
    (verdict.push ? console.log : console.error)(`${prefix} ${line}`);
  }
  process.exit(verdict.push ? 0 : 1);
}
