import { strToU8, zipSync } from "fflate";

/** Fait enregistrer un fichier par le navigateur (même origine : `download` est respecté). */
export function enregistrer(blob: Blob, nom: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Laisser au navigateur (Safari iOS en tête) le temps de lire le blob.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** L'export tel que WhatsApp le rend en texte : UTF-8, sans BOM. */
export function blobTexte(texte: string): Blob {
  return new Blob([texte], { type: "text/plain;charset=utf-8" });
}

/** Le zip d'export iOS : un seul fichier, `_chat.txt`. */
export function blobZip(texte: string): Blob {
  const zip = zipSync({ "_chat.txt": strToU8(texte) }, { level: 6 });
  return new Blob([zip as BlobPart], { type: "application/zip" });
}
