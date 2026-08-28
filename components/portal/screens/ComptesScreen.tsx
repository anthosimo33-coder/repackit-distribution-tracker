"use client";

import { useState } from "react";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useMyComptes, useMyProfile } from "@/components/portal/creator-data";
import { useReadOnly } from "@/components/portal/ViewAsContext";
import { PlatformBadge } from "@/components/VerdictBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusIcon,
  MonitorSmartphoneIcon,
  FlameIcon,
  BellRingIcon,
} from "lucide-react";
import { DeclareCompteDialog } from "@/components/creators/portal/DeclareCompteDialog";
import { WarmupCompteCard } from "@/components/creators/portal/WarmupCompteCard";
import { WarmupGuideButton } from "@/components/warmup/WarmupGuideButton";
import { getEffectiveStatus } from "@/lib/compte-status";
import { mustCheckToday } from "@/lib/warmup";
import { useTranslations } from "next-intl";

/**
 * « Mes comptes » — écran RÉUTILISÉ par le portail créateur normal ET le mode
 * admin « voir l'espace d'un créateur ». En lecture seule (view-as) : le bouton
 * « Déclarer un compte » et les boutons de check warmup / confirmation de bio
 * sont masqués (WarmupCompteCard readOnly) ; les notifications et la progression
 * restent affichées (information). Données via useMyComptes (getMy* en normal,
 * *AsAdmin scopé serveur en view-as).
 */
export default function ComptesScreen() {
  const t = useTranslations("portal");
  const projectId = useCreatorProjectId();
  const comptes = useMyComptes(projectId);
  const profile = useMyProfile(projectId);
  const readOnly = useReadOnly();
  const [declareOpen, setDeclareOpen] = useState(false);

  // Comptes GÉRÉS par l'équipe : la créatrice ne crée pas le @ et ne fait pas le
  // warmup/bio dessus → on les retire des consignes/notifs (l'équipe s'en charge).
  const managedPlatforms = new Set(
    (comptes ?? []).filter((c) => c.managedByAdmin).map((c) => c.plateforme),
  );

  // @ à créer par réseau (consigne admin) — uniquement les réseaux renseignés ET
  // non gérés par l'équipe (un @ géré est créé par l'équipe, pas par la créatrice).
  const h = profile?.handlesToCreate ?? null;
  const handlesToCreate = h
    ? (
        [
          ["TikTok", h.tiktok],
          ["YouTube", h.youtube],
          ["Instagram", h.instagram],
        ] as const
      ).filter(
        (entry): entry is readonly ["TikTok" | "YouTube" | "Instagram", string] =>
          typeof entry[1] === "string" &&
          entry[1].length > 0 &&
          !managedPlatforms.has(entry[0]),
      )
    : [];

  const loading = comptes === undefined;

  // Notif in-app : comptes en warmup à faire/rattraper aujourd'hui (compteur
  // dérivé des comptes déjà chargés — même logique que countMyWarmupDue serveur).
  // Comptes gérés exclus (l'équipe coche leur warmup).
  const dueToday = (comptes ?? []).filter(
    (c) =>
      !c.managedByAdmin && getEffectiveStatus(c) === "warmup" && c.dueToday,
  );

  // Notif in-app : comptes dont l'admin a (re)défini la bio → à (re)appliquer.
  // Comptes gérés exclus (l'équipe applique la bio sur le vrai compte).
  const bioDue = (comptes ?? []).filter(
    (c) => !c.managedByAdmin && !!c.bioToApply && c.bioStatus === "to_apply",
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t("comptes.title")}</h1>
          <p className="text-sm text-slate-500">{t("comptes.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Même guide warmup que l'admin (source unique : components/warmup),
              en lecture seule. Toujours visible — consultable même sans compte
              déclaré et indépendant du chargement de projectId. */}
          <WarmupGuideButton />
          {!readOnly && projectId && (
            <Button onClick={() => setDeclareOpen(true)}>
              <PlusIcon className="mr-2 size-4" />{t("comptes.declare")}</Button>
          )}
        </div>
      </header>

      {/* @ à créer par réseau (consigne admin d'onboarding) — EN COMPLÉMENT des
          mots-clés de warmup (par compte). Masqué si aucun @ renseigné. */}
      {handlesToCreate.length > 0 && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-slate-900">{t("comptes.createThese")}</p>
              <p className="text-xs text-slate-500">
                {t("comptes.createExact")}
              </p>
            </div>
            <ul className="space-y-2">
              {handlesToCreate.map(([network, handle]) => (
                <li key={network} className="flex items-center gap-2">
                  <PlatformBadge plateforme={network} />
                  <span className="font-mono text-sm font-medium break-all text-slate-900">
                    {handle}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {dueToday.length > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
          data-testid="warmup-due-notif"
        >
          <FlameIcon className="size-5 shrink-0 text-amber-600" />
          <p className="text-sm font-medium text-amber-900">
            {t("comptes.warmupDue", { count: dueToday.length })}
          </p>
        </div>
      )}

      {bioDue.length > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
          data-testid="bio-due-notif"
        >
          <BellRingIcon className="size-5 shrink-0 text-amber-600" />
          <p className="text-sm font-medium text-amber-900">
            {t("comptes.bioDue", { count: bioDue.length })}
          </p>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : comptes && comptes.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {comptes.map((c) => (
            <WarmupCompteCard
              key={c._id}
              compte={c}
              projectId={projectId}
              readOnly={readOnly}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <MonitorSmartphoneIcon
              className="size-14 text-slate-300"
              strokeWidth={1.5}
            />
            <p className="text-sm text-slate-500">
              {t("comptes.noneDeclared")}{" "}
              {readOnly
                ? t("comptes.emptyReadOnly")
                : t("comptes.emptyCreator")}
            </p>
            {!readOnly && projectId && (
              <Button onClick={() => setDeclareOpen(true)}>
                <PlusIcon className="mr-2 size-4" />{t("comptes.declare")}</Button>
            )}
          </CardContent>
        </Card>
      )}

      {!readOnly && projectId && (
        <DeclareCompteDialog
          open={declareOpen}
          onOpenChange={setDeclareOpen}
          projectId={projectId}
          expectedHandles={h}
        />
      )}
    </div>
  );
}
