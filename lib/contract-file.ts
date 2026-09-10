/**
 * Contrat créateur — validation PURE du fichier déposé (type + taille), testée
 * Vitest. PDF UNIQUEMENT, ≤ 20 Mo.
 *
 * Réutilisé côté client (ContractUploader) et RÉPLIQUÉ côté serveur
 * (convex/creatorContracts.ts) — règle A6 (convex/ ne peut pas importer lib/).
 * Toute évolution ici doit l'être là-bas.
 *
 * Pourquoi PDF seul, alors que les assets acceptent images et vidéos : un
 * contrat est un document signé qu'on archive et qu'on relit tel quel. Accepter
 * un .docx ou une photo du papier, c'est accepter qu'un créateur reçoive un
 * fichier qu'il ne peut pas ouvrir dans son navigateur — et le seul écran où il
 * le consultera est son profil, dans un onglet.
 */

export const CONTRACT_CONTENT_TYPE = "application/pdf";

/** 20 Mo : un contrat scanné en couleur tient largement dedans. */
export const CONTRACT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Type EFFECTIF du fichier : son MIME s'il est déjà `application/pdf`, sinon
 * déduit de l'EXTENSION. Certains OS renvoient un `File.type` vide dans le
 * picker — sans ce repli, un vrai PDF serait refusé avant tout upload.
 * null si ni le MIME ni l'extension ne désignent un PDF.
 */
export function resolveContractContentType(file: {
  type: string;
  name: string;
}): string | null {
  if (file.type === CONTRACT_CONTENT_TYPE) return CONTRACT_CONTENT_TYPE;
  return file.name.toLowerCase().endsWith(".pdf")
    ? CONTRACT_CONTENT_TYPE
    : null;
}

export interface ContractValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Valide un fichier candidat : PDF ET taille ≤ 20 Mo. Message d'erreur lisible
 * (FR — écran admin) si invalide.
 */
export function validateContractFile(file: {
  contentType: string;
  size: number;
}): ContractValidationResult {
  if (file.contentType !== CONTRACT_CONTENT_TYPE) {
    return { ok: false, error: "Format non supporté : PDF uniquement." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "Fichier vide ou taille invalide." };
  }
  if (file.size > CONTRACT_MAX_BYTES) {
    return { ok: false, error: "PDF trop lourd (20 Mo max)." };
  }
  return { ok: true };
}
