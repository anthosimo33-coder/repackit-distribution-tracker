"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Loader2Icon, LinkIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PublicTrackerView } from "./PublicTrackerView";

/**
 * Page `/s/<token>` — ce que voit la marque ou la créatrice qui reçoit le lien.
 * Aucune session : la seule clé est le jeton, et la seule lecture est
 * `getPublicShare`, qui rend la même réponse pour un lien inconnu, expiré ou
 * révoqué.
 */
export function PublicSharePage({ token }: { token: string }) {
  const t = useTranslations("publicShare");
  const share = useQuery(api.publicShares.getPublicShare, { token });
  const recordOpen = useMutation(api.publicShares.recordShareOpen);
  const loadThumbs = useAction(api.publicShares.getShareThumbnails);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Miniatures du podium : demandées au SERVEUR, qui seul parle à TikTok (sa
  // réponse nomme le compte). Relancé si le top 3 change.
  const videoKey =
    share?.status === "valid"
      ? (share.view.posts ?? []).map((p) => p.video?.id ?? "").join(",")
      : "";
  useEffect(() => {
    if (videoKey.replace(/,/g, "") === "") return;
    let alive = true;
    loadThumbs({ token })
      .then((m) => alive && setThumbs(m))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [videoKey, token, loadThumbs]);

  // Une ouverture par onglet : un rechargement ne recompte pas. Sans stockage
  // (navigation privée, stockage bloqué), on compte — mieux vaut un compteur un
  // peu haut qu'une page qui plante.
  useEffect(() => {
    const key = `share-open:${token}`;
    try {
      if (sessionStorage.getItem(key) !== null) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* stockage indisponible */
    }
    void recordOpen({ token }).catch(() => undefined);
  }, [token, recordOpen]);

  if (share === undefined) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50">
        <Loader2Icon className="size-6 animate-spin text-slate-400" aria-label={t("loading")} />
      </main>
    );
  }

  if (share.status === "invalid") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100">
            <LinkIcon className="size-5 text-slate-400" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">{t("invalid.title")}</h1>
          <p className="mt-2 text-sm text-slate-500">{t("invalid.body")}</p>
          <p className="mt-8 text-xs text-slate-400">{t("poweredBy")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-2xl px-3 py-4 sm:px-4 sm:py-10">
        <PublicTrackerView payload={share} thumbs={thumbs} />
      </div>
    </main>
  );
}
