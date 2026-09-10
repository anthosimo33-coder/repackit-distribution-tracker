"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Loader2Icon, SendIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useClipperProject } from "@/components/clip/ClipperProjectProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useConvexError } from "@/lib/use-convex-error";
import { accountUrlCheck, type UrlPlateforme } from "@/lib/post-url-account";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useLabel } from "@/lib/use-label";
import {
  PHASE_INLINE_KEYS,
  accountPhaseAt,
  dayKeyToUtcInstant,
  formatUtcDay,
  postsPerDayAt,
  utcDayKey,
} from "@/convex/accountPhase";
import {
  publicationDateFromUrl,
  type PostDatePlatform,
  type PostDateRead,
} from "@/convex/postUrlDate";

/**
 * PUBLICATION D'UN CLIP — coller le lien, et déclarer QUAND le post est sorti.
 *
 * ─── Un seul repère : la journée UTC ────────────────────────────────────────
 * Le champ date, le compteur et le message de refus doivent parler du MÊME jour,
 * sinon l'écran annonce un créneau libre pendant que le serveur refuse — le seul
 * endroit où un clippeur peut perdre confiance dans l'outil en une vue. Le seau
 * du quota est la journée UTC (`utcDayRange`), donc tout ici l'est : le jour par
 * défaut, le `max` du champ, la clé de comptage et le libellé.
 * Conséquence assumée et documentée dans `convex/accountPhase.ts` : entre minuit
 * et 2 h à Paris, le jour proposé est celui de la veille — ce qui est
 * exactement le jour sur lequel le quota sera décompté.
 *
 * ─── La date se LIT dans le lien ─────────────────────────────────────────────
 * Pré-remplir « aujourd'hui » ferait valider la mauvaise date sans que personne
 * ne s'en aperçoive : le clippeur déclare mardi matin un post de lundi soir, le
 * champ dit mardi, il valide sans y penser. Le compteur du mardi est faux, en
 * silence. On lit donc l'horodatage DANS l'identifiant TikTok — et on l'ANNONCE :
 * un pré-remplissage invisible reproduit le défaut qu'on corrige.
 */

type Plateforme = "TikTok" | "Instagram" | "YouTube";

export type ClipPublishTarget = {
  platform: Plateforme;
  accountHandle: string | null;
};

/** Ce que la lecture d'URL a donné, dit en clair — jamais un silence. */
function LigneDateLue({ read }: { read: PostDateRead }) {
  const loc = useIntlLocale();
  const tc = useTranslations("clip");
  if (read.at !== null) {
    return (
      <p className="text-xs text-emerald-700">
        {tc("dateRead", { date: formatUtcDay(read.at, loc.startsWith("fr") ? "fr" : "en") })}
      </p>
    );
  }
  const pourquoi =
    read.reason === "shortlink"
      ? tc("dateShortlink")
      : read.reason === "platform"
        ? tc("dateNoPlatform")
        : read.reason === "out-of-range"
          ? tc("dateUnreadable")
          : null;
  return pourquoi ? <p className="text-xs text-slate-500">{pourquoi}</p> : null;
}

/** Statut de cohérence URL↔compte — avertissement, jamais blocage. */
function LigneCompte({
  url,
  platform,
  expected,
}: {
  url: string;
  platform: Plateforme;
  expected: string | null;
}) {
  const tc = useTranslations("clip");
  if (url.trim() === "") return null;
  const check = accountUrlCheck(url, platform as UrlPlateforme, expected);
  if (check.status === "match") {
    return (
      <p className="text-xs text-emerald-600">
        {tc("accountMatch", { handle: check.detected ?? "" })}
      </p>
    );
  }
  if (check.status === "mismatch") {
    return (
      <p className="text-xs font-medium text-amber-700">
        {tc("accountMismatch", {
          detected: check.detected ?? "",
          expected: expected ? `@${expected}` : tc("expectedAccount"),
        })}
      </p>
    );
  }
  return null;
}

export function ClipPublishForm({
  clipId,
  targets,
}: {
  clipId: Id<"assignments">;
  targets: ClipPublishTarget[];
}) {
  const showError = useConvexError();
  const tLabel = useLabel();
  const loc = useIntlLocale();
  const tc = useTranslations("clip");
  const { projectId } = useClipperProject();
  const publier = useMutation(api.assignments.confirmClipPublication);
  const quota = useQuery(api.clipQuota.myQuotaWindow, { projectId });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [jour, setJour] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (quota === undefined) return <Skeleton className="h-48 w-full" />;

  // Instant de référence CÔTÉ SERVEUR (borne haute de la fenêtre − 1 ms) :
  // l'horloge du navigateur peut désigner une autre journée UTC.
  const maintenant = quota.windowEnd - 1;
  const aujourdhui = utcDayKey(maintenant);

  // La date lue dans le PREMIER lien TikTok collé. C'est le seul lien qui porte
  // un horodatage ; les autres cibles sortent le même jour (publication groupée).
  const lecture: PostDateRead = (() => {
    for (const t of targets) {
      const u = (urls[t.platform] ?? "").trim();
      if (u === "") continue;
      const r = publicationDateFromUrl(
        u,
        t.platform as PostDatePlatform,
        maintenant,
      );
      if (r.at !== null) return r;
    }
    // Aucune lecture réussie : on rend la raison du premier lien non vide.
    for (const t of targets) {
      const u = (urls[t.platform] ?? "").trim();
      if (u !== "") {
        return publicationDateFromUrl(
          u,
          t.platform as PostDatePlatform,
          maintenant,
        );
      }
    }
    return { at: null, reason: "no-id" };
  })();

  // Le champ suit la lecture TANT QUE le clippeur n'y a pas touché : une fois
  // qu'il a choisi une date, elle ne doit plus bouger sous ses doigts.
  const jourEffectif =
    jour ?? (lecture.at !== null ? utcDayKey(lecture.at) : aujourdhui);
  const instantChoisi = dayKeyToUtcInstant(jourEffectif) ?? maintenant;
  const horsFenetre = instantChoisi < quota.windowStart;

  /** Pour chaque cible : ce que dit le compteur À LA DATE CHOISIE. */
  const compteurs = targets.map((t) => {
    const compte = quota.comptes.find((c) => c.handle === t.accountHandle);
    if (!compte) return { handle: t.accountHandle, texte: null };
    if (compte.validatedAt === null) {
      return {
        handle: t.accountHandle,
        texte: tc("accountNotApproved"),
      };
    }
    if (horsFenetre) {
      return {
        handle: t.accountHandle,
        texte: tc("dateOutOfWindow"),
      };
    }
    const phase = accountPhaseAt(compte.validatedAt, instantChoisi);
    const max = postsPerDayAt(compte.validatedAt, instantChoisi);
    const deja = compte.parJour[jourEffectif] ?? 0;
    if (max === 0) {
      return {
        handle: t.accountHandle,
        texte: tc("counterPhaseZero", {
          phase: phase ? tLabel(PHASE_INLINE_KEYS[phase]) : tc("phaseUnknown"),
        }),
      };
    }
    return {
      handle: t.accountHandle,
      texte:
        deja >= max
          ? tc("counterQuotaFull", { count: deja, max })
          : tc("counterQuota", { count: deja, max }),
    };
  });

  async function onPublish() {
    const payload = targets.map((t) => ({
      platform: t.platform,
      url: (urls[t.platform] ?? "").trim(),
    }));
    // TOUTES les cibles doivent avoir un lien (B5) — le serveur refuse sinon, et
    // l'écran NOMME celle qui manque plutôt que de renvoyer « URL manquante ».
    const manquantes = payload.filter((u) => u.url.length === 0);
    if (manquantes.length > 0) {
      toast.error(
        tc("missingLinks", {
          platforms: manquantes.map((m) => m.platform).join(" et "),
        }),
      );
      return;
    }
    // Jour courant ⇒ pas d'override : le serveur pose `now`, qui tombe dans le
    // même seau UTC. Un autre jour ⇒ midi UTC, franchement au milieu du seau.
    const publishedAt =
      jourEffectif === aujourdhui
        ? undefined
        : (dayKeyToUtcInstant(jourEffectif) ?? undefined);
    setBusy(true);
    try {
      await publier({
        projectId,
        id: clipId,
        urls: payload,
        ...(publishedAt !== undefined ? { publishedAt } : {}),
      });
      toast.success(tc("published"));
      setUrls({});
    } catch (e) {
      toast.error(showError(e, tc("publishFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {targets.map((t) => {
          const val = urls[t.platform] ?? "";
          return (
            <div key={t.platform} className="space-y-1">
              <Label htmlFor={`clip-url-${t.platform}`} className="text-xs">
                Lien du post {t.platform}
                {t.accountHandle ? (
                  <span className="ml-1 font-mono text-slate-400">
                    {t.accountHandle}
                  </span>
                ) : null}
              </Label>
              <Input
                id={`clip-url-${t.platform}`}
                placeholder="https://…"
                value={val}
                onChange={(e) =>
                  setUrls((u) => ({ ...u, [t.platform]: e.target.value }))
                }
              />
              <LigneCompte
                url={val}
                platform={t.platform}
                expected={t.accountHandle}
              />
            </div>
          );
        })}
      </div>

      {/* DATE — en clair dans le formulaire, jamais derrière un « avancé ». */}
      <div className="space-y-1">
        <Label htmlFor="clip-date" className="text-xs">
          {tc("postDate")}
        </Label>
        <Input
          id="clip-date"
          type="date"
          value={jourEffectif}
          max={aujourdhui}
          onChange={(e) => setJour(e.target.value)}
        />
        <LigneDateLue read={lecture} />
        <p className="text-xs text-slate-500">
          {tc("dateCountsHint")}
        </p>
      </div>

      {/* COMPTEUR — il suit la DATE CHOISIE, jamais « aujourd'hui ». */}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
        <p className="text-xs font-medium text-slate-900">
          {tc("forDate", { date: formatUtcDay(instantChoisi, loc.startsWith("fr") ? "fr" : "en") })}
        </p>
        <ul className="mt-1 space-y-0.5">
          {compteurs.map((c) =>
            c.texte ? (
              <li key={c.handle ?? "?"} className="text-xs text-slate-600">
                <span className="font-mono">{c.handle}</span> — {c.texte}
              </li>
            ) : null,
          )}
        </ul>
      </div>

      <Button onClick={onPublish} disabled={busy} className="w-full">
        {busy ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <SendIcon className="mr-2 size-4" />
        )}
        J&apos;ai publié — enregistrer
      </Button>
    </div>
  );
}
