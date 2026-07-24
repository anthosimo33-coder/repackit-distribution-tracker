import type { NextRequest } from "next/server";
import { ASSET_IMAGE_MAX_BYTES } from "@/lib/asset-file";
import {
  POSTPROCESS_OUTPUT_TYPE,
  hasC2PAMarker,
  isPostProcessableType,
  postProcessImage,
  readImageDimensions,
  toJpegFileName,
} from "@/lib/image-postprocess";

/**
 * Post-traitement des images Assets à l'ingestion — retire les métadonnées de
 * provenance (C2PA/EXIF/XMP) et ré-encode, AVANT que le fichier ne devienne un
 * asset. Systématique : aucun toggle, aucune option d'appel côté UI.
 *
 * POURQUOI UNE ROUTE NEXT ET PAS CONVEX : sharp est un binaire natif (libvips),
 * il ne tourne ni dans le runtime V8 de Convex ni dans le navigateur. Aucun
 * module convex/ n'utilise `"use node"` dans ce repo (cf. convex/emailApi.ts) —
 * on ne l'introduit pas pour ça. Vercel, lui, embarque sharp nativement (next/
 * image) : il est dans la liste `serverExternalPackages` par défaut de Next,
 * donc AUCUNE config à ajouter.
 *
 * FLUX — par RÉFÉRENCE, jamais par corps de requête :
 *   1. le client uploade l'original vers Convex (direct, inchangé) ;
 *   2. il appelle cette route avec l'URL SIGNÉE de lecture + une URL SIGNÉE
 *      d'upload fraîche (deux capacités qu'il détient déjà, cf. api.storage) ;
 *   3. la route lit les octets, applique le pipeline, POST le résultat sur
 *      l'URL d'upload et renvoie le nouveau storageId ;
 *   4. `createAsset` enregistre la version traitée et PURGE le blob d'origine
 *      (arg `replacedStorageId`).
 *
 * Les octets ne transitent JAMAIS par le corps d'une requête entrante : les
 * fonctions Vercel plafonnent le body à ~4,5 Mo (cf. app/api/snytch-drive/
 * upload/route.ts, qui découpe pour cette raison) alors que les images Assets
 * vont jusqu'à 10 Mo. Un fetch sortant, lui, n'est pas plafonné.
 *
 * CONSÉQUENCE ASSUMÉE : l'original touche brièvement le storage avant d'être
 * remplacé puis supprimé. Le fichier CONSERVÉ est toujours la version nettoyée ;
 * « avant stockage » au sens strict est hors d'atteinte tant que l'upload est
 * direct navigateur → Convex.
 *
 * SÉCURITÉ : les deux URL sont fournies par le client → validées comme étant
 * sur l'origine EXACTE du déploiement Convex (anti-SSRF, même garde que la route
 * snytch-drive). La route ne relaie donc des octets que vers notre propre
 * storage, et ne détient aucun secret. Elle est par ailleurs derrière le gating
 * de session du proxy Next (proxy.ts) ; la vraie barrière reste `createAsset`
 * (adminMutation), qui seule crée la row.
 */

export const runtime = "nodejs";
// Une image (≤ 10 Mo) : lecture + pipeline + ré-upload. Large de marge.
export const maxDuration = 60;

type PostProcessRequest = {
  sourceUrl: string;
  uploadUrl: string;
  contentType: string;
  fileName: string;
};

/** Origine du déploiement Convex — seule cible autorisée pour les deux URL. */
function convexOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** L'URL pointe-t-elle exactement notre storage Convex ? (anti-SSRF) */
function isConvexUrl(value: unknown, origin: string): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const origin = convexOrigin();
  if (!origin) {
    console.error("[assets/postprocess] NEXT_PUBLIC_CONVEX_URL absente.");
    return Response.json(
      { error: "Déploiement Convex non configuré." },
      { status: 500 },
    );
  }

  let body: Partial<PostProcessRequest>;
  try {
    body = (await request.json()) as Partial<PostProcessRequest>;
  } catch {
    return Response.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { sourceUrl, uploadUrl, contentType, fileName } = body;
  if (!isConvexUrl(sourceUrl, origin) || !isConvexUrl(uploadUrl, origin)) {
    return Response.json(
      { error: "URL de storage invalide." },
      { status: 400 },
    );
  }
  if (typeof contentType !== "string" || typeof fileName !== "string") {
    return Response.json({ error: "Requête incomplète." }, { status: 400 });
  }

  // Format non supporté → PAS une erreur : le client conserve l'original.
  if (!isPostProcessableType(contentType)) {
    console.warn(
      `[assets/postprocess] ${fileName} : format « ${contentType} » non post-traitable — original conservé.`,
    );
    return Response.json({ processed: false, reason: "format-non-supporte" });
  }

  try {
    const sourceRes = await fetch(sourceUrl);
    if (!sourceRes.ok) {
      throw new Error(`lecture source HTTP ${sourceRes.status}`);
    }
    const input = Buffer.from(await sourceRes.arrayBuffer());

    // Dimensions RÉELLES de CETTE image (jamais un ratio codé en dur) :
    // le pipeline recadre en `fit: "cover"`, une cible erronée détruirait le
    // cadrage d'origine.
    const dimensions = await readImageDimensions(input);
    if (!dimensions) throw new Error("dimensions source illisibles");

    // Diagnostic seul — le nettoyage est fait par le détour PNG du pipeline.
    if (hasC2PAMarker(input)) {
      console.info(
        `[assets/postprocess] ${fileName} : marqueur C2PA détecté en entrée.`,
      );
    }

    const output = await postProcessImage(input, {
      targetWidth: dimensions.width,
      targetHeight: dimensions.height,
    });

    /**
     * Le ré-encodage peut GROSSIR le fichier (un très grand PNG compressé
     * ressort en JPEG q92 plus lourd). Au-delà du plafond image, `createAsset`
     * refuserait le fichier et FERAIT ÉCHOUER un upload que l'original aurait
     * passé : on renonce donc au traitement plutôt qu'à l'upload. Contrôlé ici,
     * avant l'envoi, pour ne pas laisser de blob orphelin.
     */
    if (output.byteLength > ASSET_IMAGE_MAX_BYTES) {
      console.warn(
        `[assets/postprocess] ${fileName} : sortie ${output.byteLength} o > plafond ${ASSET_IMAGE_MAX_BYTES} o — original conservé.`,
      );
      return Response.json({ processed: false, reason: "sortie-trop-lourde" });
    }

    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": POSTPROCESS_OUTPUT_TYPE },
      body: new Uint8Array(output),
    });
    if (!uploadRes.ok) {
      throw new Error(`upload traité HTTP ${uploadRes.status}`);
    }
    const { storageId } = (await uploadRes.json()) as { storageId?: string };
    if (!storageId) throw new Error("storageId absent de la réponse d'upload");

    return Response.json({
      processed: true,
      storageId,
      fileName: toJpegFileName(fileName),
      contentType: POSTPROCESS_OUTPUT_TYPE,
      size: output.byteLength,
      width: dimensions.width,
      height: dimensions.height,
    });
  } catch (e) {
    // L'appelant retombe sur l'original : un échec ici ne bloque JAMAIS l'upload.
    const message = e instanceof Error ? e.message : "erreur inconnue";
    console.error(
      `[assets/postprocess] ${fileName} : post-traitement échoué (${message}) — original conservé.`,
    );
    return Response.json(
      { error: `Post-traitement échoué : ${message}` },
      { status: 502 },
    );
  }
}
