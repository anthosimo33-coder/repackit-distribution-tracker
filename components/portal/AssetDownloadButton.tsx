"use client";

import { useState, type MouseEvent } from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { enregistrer } from "@/components/scenarios/telechargement";
import { partageVersPhotos } from "@/lib/partage-vers-photos";
import { cn } from "@/lib/utils";

/**
 * « Télécharger » un asset de la fiche mission.
 *
 * L'URL signée Convex est d'un AUTRE domaine : `download` y est ignoré et le
 * navigateur OUVRE le fichier. Sur iPhone, c'est un lecteur d'où l'on ne peut
 * pas ranger la vidéo dans Photos (retour d'une créatrice, 03/11).
 *
 * On rapatrie donc le fichier (Convex répond en CORS), puis :
 *   - iPhone/iPad : feuille de partage avec le fichier → « Enregistrer la
 *     vidéo » (cf lib/partage-vers-photos) ;
 *   - ailleurs : téléchargement depuis une URL blob, même origine, respecté.
 *
 * Safari refuse le partage quand le tap est trop ancien (gros fichier, réseau
 * lent) : le fichier reste alors en mémoire et le bouton devient
 * « Enregistrer », dont le tap partage aussitôt. Fetch en échec : le tap
 * suivant retombe sur le lien d'avant (ouverture dans un onglet).
 */
export function AssetDownloadButton({
  url,
  fileName,
  contentType,
}: {
  url: string;
  fileName: string;
  contentType: string;
}) {
  const t = useTranslations("portal.assignmentDetail");
  const [enCours, setEnCours] = useState(false);
  const [progres, setProgres] = useState<number | null>(null);
  const [pret, setPret] = useState<File | null>(null);
  const [lienDirect, setLienDirect] = useState(false);

  /** `peutAttendre` : sur un geste périmé, garder le fichier pour un 2e tap. */
  async function partager(file: File, peutAttendre: boolean) {
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      const nom = err instanceof DOMException ? err.name : "";
      if (nom === "AbortError") return; // feuille refermée par la créatrice
      if (nom === "NotAllowedError" && peutAttendre) {
        setPret(file);
        toast(t("downloadReady"));
        return;
      }
      enregistrer(file, fileName);
    }
  }

  async function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (lienDirect) return; // repli : le lien s'ouvre comme avant
    e.preventDefault();
    if (enCours) return;
    if (pret) {
      // Fichier déjà en mémoire : le partage part DANS le geste.
      setPret(null);
      await partager(pret, false);
      return;
    }
    setEnCours(true);
    setProgres(null);
    let file: File;
    try {
      const blob = await rapatrier(url, setProgres);
      file = new File([blob], fileName, { type: blob.type || contentType });
    } catch {
      setLienDirect(true);
      toast.error(t("downloadFailed"));
      return;
    } finally {
      setEnCours(false);
    }
    const viaPartage =
      partageVersPhotos(navigator) &&
      "canShare" in navigator &&
      navigator.canShare({ files: [file] });
    if (viaPartage) {
      await partager(file, true);
    } else {
      enregistrer(file, fileName);
    }
  }

  return (
    <a
      href={url}
      download={fileName}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      aria-busy={enCours}
      data-testid="asset-download"
      className={cn(
        "inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
        pret
          ? "border-primary bg-primary/5 text-primary hover:bg-primary/10"
          : "border-slate-200 text-slate-700 hover:bg-slate-50",
      )}
    >
      {enCours ? (
        <>
          <Loader2Icon className="size-3.5 animate-spin" />
          {progres === null ? t("downloadPreparing") : t("downloadProgress", { pct: progres })}
        </>
      ) : (
        <>
          <DownloadIcon className="size-3.5" />
          {pret ? t("downloadSave") : t("download")}
        </>
      )}
    </a>
  );
}

/** Rapatrie le fichier en suivant l'avancement (Content-Length passe en CORS). */
async function rapatrier(url: string, onProgres: (pct: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const total = Number(res.headers.get("content-length"));
  if (!res.body || !total) return res.blob();
  const lecteur = res.body.getReader();
  const morceaux: BlobPart[] = [];
  let recu = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value as BlobPart);
    recu += value.length;
    onProgres(Math.min(99, Math.floor((recu * 100) / total)));
  }
  return new Blob(morceaux, { type: res.headers.get("content-type") ?? "" });
}
