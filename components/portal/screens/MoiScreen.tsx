"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  AtSignIcon,
  BookOpenIcon,
  ChevronRightIcon,
  FolderIcon,
  LogOutIcon,
  PlusIcon,
  UserIcon,
  WalletIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  useMyComptes,
  useMyProfile,
  useWarmupDue,
} from "@/components/portal/creator-data";
import { usePortalBase, useReadOnly } from "@/components/portal/ViewAsContext";
import { Skeleton } from "@/components/ui/skeleton";
import { needsPaymentInfo } from "@/lib/creator-payment";
import { getCreatorTools } from "@/lib/creator-tools";
import { isSnytchProject } from "@/lib/snytch-drive";
import { portalHref } from "@/lib/view-as";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * « MOI » — l'onglet de ce qu'on configure une fois et qu'on consulte rarement.
 *
 * Il réunit ce qui occupait quatre places dans la barre (Comptes, Profil, Guide,
 * Outils/Fichiers). Un écran de liens seul serait un détour : on y montre donc
 * ce qui peut demander un geste — l'état de chaque compte (chauffe du jour, bio
 * à appliquer) et des coordonnées de paiement manquantes.
 *
 * Chaque ligne mène à l'écran existant, qui garde toute sa fonction. Les liens
 * portent un `aria-label` égal à leur titre : la ligne affiche un sous-titre, et
 * sans ce libellé le nom accessible deviendrait « Mes comptes Jour 2 sur 3… ».
 *
 * Écran RÉUTILISÉ en observation : pas de déconnexion (l'admin reste lui-même).
 */
type Compte = NonNullable<ReturnType<typeof useMyComptes>>[number];

function compteStatus(c: Compte): "warmup" | "actif" | "shadowban" | "archived" {
  if (c.status) return c.status;
  return c.actif ? "actif" : "archived";
}

export default function MoiScreen() {
  const t = useTranslations("portal");
  const { current } = useCreatorProject();
  const base = usePortalBase();
  const readOnly = useReadOnly();
  const profile = useMyProfile(current.projectId);
  const comptes = useMyComptes(current.projectId);
  const warmupDue = useWarmupDue(current.projectId) ?? 0;
  const tools = getCreatorTools(current.slug);
  const showFiles = isSnytchProject(current.slug);
  const name = profile?.name ?? current.creatorName ?? "";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground"
        >
          {initialsOf(name)}
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t("moi.title")}
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">
            {name || t("moi.title")}
          </h1>
          {profile?.email && (
            <p className="truncate text-sm text-slate-500">{profile.email}</p>
          )}
        </div>
      </header>

      <section className="space-y-2" data-testid="moi-accounts">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={portalHref(base, "/comptes")}
            className="text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            {t("sidebar.comptes")}
          </Link>
          {warmupDue > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
              {warmupDue}
            </span>
          )}
        </div>
        {comptes === undefined ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : comptes.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            {t("comptes.noneDeclared")}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {comptes.map((c) => (
              <li key={c._id}>
                <CompteRow compte={c} href={portalHref(base, "/comptes")} />
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <Link
            href={portalHref(base, "/comptes")}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-sm font-medium text-slate-600 transition-colors hover:bg-white"
          >
            <PlusIcon className="size-4" />
            {t("comptes.declare")}
          </Link>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">{t("moi.space")}</h2>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          <li>
            <MoiRow
              href={portalHref(base, "/profil")}
              icon={WalletIcon}
              label={t("moi.payment")}
              hint={
                profile === undefined
                  ? ""
                  : needsPaymentInfo(profile)
                    ? t("moi.paymentTodo")
                    : t("moi.paymentDone")
              }
              tone={profile && needsPaymentInfo(profile) ? "amber" : "slate"}
            />
          </li>
          <li>
            <MoiRow
              href={portalHref(base, "/guide")}
              icon={BookOpenIcon}
              label={t("sidebar.guide")}
              hint={t("moi.guideHint")}
            />
          </li>
          {showFiles && (
            <li>
              <MoiRow
                href={portalHref(base, "/fichiers")}
                icon={FolderIcon}
                label={t("sidebar.fichiers")}
                hint={t("moi.filesHint")}
              />
            </li>
          )}
          {tools.length > 0 && (
            <li>
              <MoiRow
                href={portalHref(base, "/outils")}
                icon={WrenchIcon}
                label={t("tools.title")}
                hint={t("moi.toolsHint")}
              />
            </li>
          )}
          <li>
            <MoiRow
              href={portalHref(base, "/profil")}
              icon={UserIcon}
              label={t("profil.title")}
              hint={t("moi.profileHint")}
            />
          </li>
        </ul>
      </section>

      {!readOnly && <SignOutButton label={t("sidebar.logout")} />}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const PILL = {
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  primary: "bg-primary/10 text-primary",
  slate: "bg-slate-100 text-slate-500",
  rose: "bg-rose-50 text-rose-700",
} as const;

function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium",
        PILL[tone],
      )}
    >
      {children}
    </span>
  );
}

function CompteRow({ compte: c, href }: { compte: Compte; href: string }) {
  const t = useTranslations("portal");
  const status = compteStatus(c);
  const checksDone = c.warmupProtocol?.dailyChecks?.length ?? 0;
  return (
    <Link
      href={href}
      aria-label={`@${c.handle}`}
      className="flex min-h-16 flex-col gap-2 px-4 py-3 transition-colors hover:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <AtSignIcon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">@{c.handle}</p>
          <p className="text-xs text-slate-500">{c.plateforme}</p>
        </div>
        {status === "actif" && <Pill tone="emerald">{t("moi.account.active")}</Pill>}
        {status === "warmup" && (
          <Pill tone="amber">
            {t("moi.account.warmup", { done: Math.min(checksDone, c.targetDays), target: c.targetDays })}
          </Pill>
        )}
        {status === "archived" && <Pill tone="slate">{t("moi.account.archived")}</Pill>}
        {status === "shadowban" && <Pill tone="rose">{t("moi.account.pending")}</Pill>}
        <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
      </div>
      {(c.dueToday || c.bioStatus === "to_apply") && (
        <div className="flex flex-wrap gap-1.5 pl-12">
          {c.dueToday && <Pill tone="primary">{t("moi.account.checkToday")}</Pill>}
          {c.bioStatus === "to_apply" && <Pill tone="primary">{t("moi.account.bio")}</Pill>}
        </div>
      )}
    </Link>
  );
}

function MoiRow({
  href,
  icon: Icon,
  label,
  hint,
  tone = "slate",
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  tone?: "slate" | "amber";
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600",
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{label}</p>
        {hint && (
          <p className={cn("truncate text-xs", tone === "amber" ? "text-amber-700" : "text-slate-500")}>
            {hint}
          </p>
        )}
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
    </Link>
  );
}

function SignOutButton({ label }: { label: string }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        router.push("/login");
      }}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-900"
    >
      <LogOutIcon className="size-4" />
      {label}
    </button>
  );
}
