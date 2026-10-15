"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { strToU8, zipSync } from "fflate";
import { ArrowLeftIcon, CheckCircle2Icon, ChevronDownIcon, ClapperboardIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectAction, useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useConvexError } from "@/lib/use-convex-error";
import { enregistrer } from "@/components/scenarios/telechargement";

type Donnees = NonNullable<ReturnType<typeof useTournages>>;
type Createatrice = Donnees["createatrices"][number];
type Scenario = Donnees["scenarios"][number];
type Tournage = Createatrice["tournages"][number];

/** Au-delà, les cartes s'ouvrent une à une : la liste reste légère. */
const OUVERTES_JUSQUA = 6;

function useTournages(actif: boolean) {
  return useProjectQuery(api.scenarioTournage.tournagesDuProjet, actif ? {} : "skip");
}

/** Le nom du fichier pour l'équipe : « Kelly · A1 · Le mdr de 5h52.txt » (la créatrice, elle, reçoit le nom WhatsApp). */
const nomEquipe = (prenom: string, s: Scenario) => `${prenom} · ${s.code} · ${s.titre}.txt`.replace(/[/\\:]/g, "-");

async function texteDe(url: string | null): Promise<string> {
  if (!url) throw new Error("fichier absent"); // i18n-exempt: erreur interne, jamais affichée (toast générique)
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/**
 * MODE TOURNAGE BLUSH — pour chaque créatrice et chaque histoire : le fichier
 * FIGÉ à importer dans BLUSH, puis le lien de tournage à coller. La mission de la
 * créatrice sert ce fichier et ce lien, et rien tant que le lien manque (cf
 * convex/scenarioTournage).
 */
export default function TournagePage() {
  const tr = useTranslations("admin.scripts.TournagePage");
  const projectPath = useProjectPath();
  const { has, chargement } = usePermissions();
  const donnees = useTournages(has("scripts.manage"));

  if (chargement) return <Skeleton className="h-96 w-full" />;
  if (!has("scripts.manage")) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-slate-500">{tr("accesRefuse")}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href={projectPath("/scenarios")}
        prefetch={false}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        {tr("retour")}
      </Link>
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
          <ClapperboardIcon className="size-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tr("titre")}</h1>
          <p className="text-sm text-slate-500">{tr("sousTitre")}</p>
        </div>
      </header>
      <ol className="list-decimal space-y-1 rounded-lg border border-slate-200 bg-white py-3 pr-4 pl-9 text-sm text-slate-700">
        <li>{tr("etape1")}</li>
        <li>{tr("etape2")}</li>
        <li>{tr("etape3")}</li>
      </ol>

      {donnees === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : donnees.createatrices.length === 0 || donnees.scenarios.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">{tr("rien")}</CardContent>
        </Card>
      ) : (
        donnees.createatrices.map((c) => (
          <CarteCreatrice
            key={c._id}
            createatrice={c}
            scenarios={donnees.scenarios}
            ouverteAuDepart={donnees.createatrices.length <= OUVERTES_JUSQUA}
          />
        ))
      )}
    </div>
  );
}

function CarteCreatrice({
  createatrice: c,
  scenarios,
  ouverteAuDepart,
}: {
  createatrice: Createatrice;
  scenarios: Scenario[];
  ouverteAuDepart: boolean;
}) {
  const tr = useTranslations("admin.scripts.TournagePage");
  const showError = useConvexError();
  const preparer = useProjectAction(api.scenarioTournage.preparerTournages);
  const [busy, setBusy] = useState<"preparer" | "zip" | null>(null);
  const [ouverte, setOuverte] = useState(ouverteAuDepart);
  const parScenario = new Map(c.tournages.map((t) => [t.scenarioId as string, t]));
  const manquants = scenarios.filter((s) => !parScenario.has(s._id)).length;
  const liens = c.tournages.filter((t) => t.lien).length;

  async function lancerPreparation(scenarioIds?: Id<"scenarios">[]) {
    setBusy("preparer");
    try {
      const r = await preparer({ creatorId: c._id, ...(scenarioIds ? { scenarioIds } : {}) });
      toast.success(tr("prepares", { n: r.prepares, nom: c.prenom }));
    } catch (e) {
      toast.error(showError(e, tr("echec")));
    } finally {
      setBusy(null);
    }
  }

  async function toutTelecharger() {
    setBusy("zip");
    try {
      const fichiers: Record<string, Uint8Array> = {};
      for (const s of scenarios) {
        const t = parScenario.get(s._id);
        if (t) fichiers[nomEquipe(c.prenom, s)] = strToU8(await texteDe(t.url));
      }
      enregistrer(new Blob([zipSync(fichiers) as BlobPart], { type: "application/zip" }), tr("nomZip", { prenom: c.prenom }));
    } catch {
      toast.error(tr("echecTelechargement"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="tournage-createatrice">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setOuverte((o) => !o)}
          aria-expanded={ouverte}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <ChevronDownIcon className={`size-4 shrink-0 text-slate-400 transition-transform ${ouverte ? "" : "-rotate-90"}`} />
          <span className="min-w-0 space-y-0.5">
            <CardTitle className="truncate text-base">{c.nom}</CardTitle>
            <span className="block text-xs text-slate-500" data-testid="tournage-progression">
              {tr("progression", { liens, total: scenarios.length })}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          {manquants > 0 && (
            <Button size="sm" onClick={() => lancerPreparation()} disabled={busy !== null} data-testid="tournage-preparer">
              {busy === "preparer" && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {tr("preparer", { n: manquants })}
            </Button>
          )}
          {c.tournages.length > 0 && (
            <Button size="sm" variant="outline" onClick={toutTelecharger} disabled={busy !== null}>
              {busy === "zip" ? <Loader2Icon className="mr-2 size-4 animate-spin" /> : <DownloadIcon className="mr-2 size-4" />}
              {tr("toutTelecharger")}
            </Button>
          )}
        </div>
      </CardHeader>
      {ouverte && (
        <CardContent className="p-0">
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {scenarios.map((s) => (
              <LigneTournage
                key={s._id}
                prenom={c.prenom}
                scenario={s}
                tournage={parScenario.get(s._id) ?? null}
                preparer={busy === null ? () => lancerPreparation([s._id as Id<"scenarios">]) : null}
              />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function LigneTournage({
  prenom,
  scenario: s,
  tournage: t,
  preparer,
}: {
  prenom: string;
  scenario: Scenario;
  tournage: Tournage | null;
  /** Préparer CE fichier seul ; null pendant une préparation. */
  preparer: (() => void) | null;
}) {
  const tr = useTranslations("admin.scripts.TournagePage");
  const showError = useConvexError();
  const poser = useProjectMutation(api.scenarioTournage.poserLienTournage);
  const [saisie, setSaisie] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valeur = saisie ?? t?.lien ?? "";
  const change = saisie !== null && saisie.trim() !== (t?.lien ?? "");

  async function enregistrerLien() {
    if (!t) return;
    setBusy(true);
    try {
      await poser({ id: t._id as Id<"scenarioTournages">, lien: valeur });
      setSaisie(null);
      toast.success(valeur.trim() ? tr("lienEnregistre") : tr("lienRetire"));
    } catch (e) {
      toast.error(showError(e, tr("echec")));
    } finally {
      setBusy(false);
    }
  }

  async function telecharger() {
    if (!t) return;
    try {
      enregistrer(new Blob([await texteDe(t.url)], { type: "text/plain;charset=utf-8" }), nomEquipe(prenom, s));
    } catch {
      toast.error(tr("echecTelechargement"));
    }
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center" data-testid="tournage-ligne">
      <div className="flex min-w-0 items-center gap-3 lg:w-72 lg:shrink-0">
        <span className="min-w-10 shrink-0 font-mono text-sm font-semibold text-slate-900">{s.code}</span>
        <span className="min-w-0 truncate text-sm text-slate-700">{s.titre}</span>
      </div>
      {!t ? (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => preparer?.()}
          disabled={preparer === null}
          aria-label={tr("preparerUn", { code: s.code, prenom })}
        >
          {tr("aPreparer")}
        </Button>
      ) : (
        <form
          className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void enregistrerLien();
          }}
        >
          <button
            type="button"
            onClick={telecharger}
            className={buttonVariants({ variant: "outline", size: "sm", className: "shrink-0" })}
            title={tr("messages", { n: t.messages })}
          >
            <DownloadIcon className="mr-1.5 size-3.5" />
            {tr("fichier")}
          </button>
          <Input
            value={valeur}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder={tr("lienPlaceholder")}
            aria-label={tr("lienLabel", { code: s.code, prenom })}
            className="min-w-0 flex-1"
            inputMode="url"
          />
          {change ? (
            <Button type="submit" size="sm" disabled={busy} className="shrink-0">
              {tr("enregistrer")}
            </Button>
          ) : t.lien ? (
            <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600" aria-label={tr("pret")} />
          ) : null}
        </form>
      )}
    </div>
  );
}
