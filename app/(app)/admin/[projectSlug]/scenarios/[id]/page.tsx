"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftIcon, CopyIcon, Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useConvexError } from "@/lib/use-convex-error";
import { codeValide, lireBible } from "@/convex/scenarioBible";
import { BibleErreurs } from "@/components/scenarios/BibleErreurs";
import { ScenarioTesteur, type TestAuto } from "@/components/scenarios/ScenarioTesteur";
import { ScenarioPerformance } from "@/components/scenarios/ScenarioPerformance";
import { StatutScenario, type Statut } from "@/components/scenarios/StatutScenario";

const STATUTS: Statut[] = ["brouillon", "actif", "archive"];

/**
 * Un SCÉNARIO : sa bible (éditeur JSON, vérifiée à chaque frappe), son thème,
 * son statut, et le banc d'essai « Tester ». Le texte saisi n'est enregistré
 * que valide ; le Tester, lui, marche aussi sur une saisie pas encore
 * enregistrée.
 */
export default function ScenarioPage() {
  const params = useParams<{ id: string }>();
  const id = params.id as Id<"scenarios">;
  const tr = useTranslations("admin.scripts.ScenarioPage");
  const projectPath = useProjectPath();
  const { has, chargement } = usePermissions();
  const scenario = useProjectQuery(
    api.scenarios.getScenario,
    has("scripts.manage") ? { id } : "skip",
  );

  if (chargement || scenario === undefined) return <Skeleton className="h-96 w-full" />;
  if (scenario === null) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-500">{tr("introuvable")}</CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Link
        href={projectPath("/scenarios")}
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        {tr("retour")}
      </Link>
      {/* Après un enregistrement, le texte en base REJOINT la saisie : rien à
          remonter. Remonter à chaque version perdrait une saisie en cours au
          moindre changement de statut. */}
      <Editeur key={scenario._id} scenario={scenario} />
    </div>
  );
}

type Scenario = {
  _id: Id<"scenarios">;
  code: string;
  titre: string;
  theme: string;
  statut: Statut;
  bible: string;
};

function Editeur({ scenario }: { scenario: Scenario }) {
  const tr = useTranslations("admin.scripts.ScenarioPage");
  const tStatut = useTranslations("admin.scripts.scenarioStatut");
  const showError = useConvexError();
  const modifier = useProjectMutation(api.scenarios.modifierScenario);
  const changerStatut = useProjectMutation(api.scenarios.changerStatutScenario);
  const [texte, setTexte] = useState(scenario.bible);
  const [theme, setTheme] = useState(scenario.theme);
  const [busy, setBusy] = useState(false);
  const [duplication, setDuplication] = useState(false);
  const auto = useTestAuto();

  // La vérification suit la frappe sans la ralentir (une bible fait ~1 000 lignes).
  const texteDiffere = useDeferredValue(texte);
  const lue = useMemo(() => lireBible(texteDiffere), [texteDiffere]);
  const modifie = texte !== scenario.bible || theme.trim() !== scenario.theme;

  async function enregistrer() {
    if (!lue.ok) return;
    setBusy(true);
    try {
      await modifier({
        id: scenario._id,
        ...(texte !== scenario.bible ? { bible: texte } : {}),
        ...(theme.trim() !== scenario.theme ? { theme } : {}),
      });
      toast.success(tr("enregistre"));
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  async function statut(s: Statut) {
    try {
      await changerStatut({ id: scenario._id, statut: s });
    } catch (e) {
      toast.error(showError(e));
    }
  }

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            <span className="font-mono">{scenario.code}</span> · {scenario.titre}
          </h1>
          <StatutScenario statut={scenario.statut} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={scenario.statut} onValueChange={(v) => v && void statut(v as Statut)}>
            <SelectTrigger className="h-9 w-36" aria-label={tr("statut")} data-testid="scenario-statut-select">
              <SelectValue>{tStatut(scenario.statut)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {STATUTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {tStatut(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setDuplication(true)}>
            <CopyIcon className="mr-2 size-4" />
            {tr("dupliquer")}
          </Button>
          <Button onClick={enregistrer} disabled={!lue.ok || !modifie || busy} data-testid="scenario-enregistrer">
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("enregistrer")}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="space-y-3" aria-label={tr("bible")}>
          <div className="space-y-1.5">
            <Label htmlFor="scenario-theme-edit">{tr("theme")}</Label>
            <Input
              id="scenario-theme-edit"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder={tr("themeExemple")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scenario-bible">{tr("bible")}</Label>
            <Textarea
              id="scenario-bible"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              spellCheck={false}
              className="h-[60vh] min-h-80 font-mono text-xs leading-relaxed"
              data-testid="scenario-bible"
            />
          </div>
          <BibleErreurs erreurs={lue.ok ? [] : lue.erreurs} />
          {modifie && <p className="text-xs text-amber-700">{tr("nonEnregistre")}</p>}
        </section>
        <section className="space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label={tr("tester")}>
          <ScenarioPerformance scenarioId={scenario._id} />
          <ScenarioTesteur bible={lue.ok ? lue.bible : null} auto={auto.test} onAutoFait={auto.fait} />
        </section>
      </div>

      <DuplicationDialog
        scenarioId={scenario._id}
        open={duplication}
        onOpenChange={setDuplication}
      />
    </>
  );
}

/**
 * Le test demandé par un lien de l'outil MCP `tester_scenario` :
 * `?tester=<prénom>&graine=<n>[&dates=bible][&telecharger=txt|zip|png]`. Une
 * fois fait, `telecharger` quitte l'adresse : recharger ne retélécharge pas.
 */
function useTestAuto(): { test: TestAuto | null; fait: () => void } {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const prenom = params.get("tester");
  const quoi = params.get("telecharger");
  // Figé à l'ouverture : retirer `telecharger` de l'adresse ne relance rien.
  const [test] = useState<TestAuto | null>(() =>
    prenom
      ? {
          prenom,
          graine: Math.max(0, Math.trunc(Number(params.get("graine") ?? 7)) || 0),
          datesBible: params.get("dates") === "bible",
          telecharger: quoi === "txt" || quoi === "zip" || quoi === "png" ? quoi : null,
        }
      : null,
  );
  return {
    test,
    fait: () => {
      if (!quoi) return;
      const reste = new URLSearchParams(params.toString());
      reste.delete("telecharger");
      router.replace(`${pathname}?${reste.toString()}`);
    },
  };
}

function DuplicationDialog({
  scenarioId,
  open,
  onOpenChange,
}: {
  scenarioId: Id<"scenarios">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const tr = useTranslations("admin.scripts.ScenarioPage");
  const showError = useConvexError();
  const router = useRouter();
  const projectPath = useProjectPath();
  const dupliquer = useProjectMutation(api.scenarios.dupliquerScenario);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function valider() {
    setBusy(true);
    try {
      const id = await dupliquer({ id: scenarioId, code: code.trim() });
      onOpenChange(false);
      setCode("");
      toast.success(tr("duplique"));
      router.push(projectPath(`/scenarios/${id}`));
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("dupliquerTitre")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="duplication-code">{tr("nouveauCode")}</Label>
          <Input id="duplication-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("annuler")}
          </Button>
          <Button onClick={valider} disabled={!codeValide(code.trim()) || busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("dupliquer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
