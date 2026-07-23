/**
 * Export CSV côté navigateur. Extrait de la page Paiements pour être partagé
 * avec le hub Analytics (table d'attribution exportable) — une seule
 * implémentation, un seul comportement Excel.
 */

const csvEscape = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** Sérialise des lignes en CSV (RFC 4180 : guillemets doublés, CRLF). */
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

/** Déclenche le téléchargement d'un CSV. Nécessite un contexte navigateur. */
export function downloadCsv(filename: string, rows: string[][]) {
  // BOM pour qu'Excel ouvre l'UTF-8 correctement.
  const blob = new Blob(["﻿" + toCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
