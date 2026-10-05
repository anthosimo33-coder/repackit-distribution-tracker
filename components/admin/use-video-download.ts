"use client";

import { useState, type MouseEvent } from "react";
import { toast } from "sonner";

/**
 * Télécharger le FICHIER ORIGINAL d'une vidéo stockée (URL signée Convex) — la
 * file de Validation et l'écran « Vidéos supprimées ».
 *
 * On passe par fetch → blob → <a download> : cross-origin, c'est le seul moyen
 * FIABLE d'imposer le téléchargement (et le nom de fichier) plutôt qu'une
 * ouverture inline que le navigateur ne sait pas lire (HEVC). Repli : ouverture
 * dans un onglet si le fetch échoue (réseau/CORS), avec `fallbackMessage`.
 */
export function useVideoDownload(url: string | null, filename: string, fallbackMessage: string) {
  const [downloading, setDownloading] = useState(false);

  async function onDownload(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (!url || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      toast.error(fallbackMessage);
    } finally {
      setDownloading(false);
    }
  }

  return { downloading, onDownload };
}
