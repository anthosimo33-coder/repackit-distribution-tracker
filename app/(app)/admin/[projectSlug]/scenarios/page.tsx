"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileUpIcon, Loader2Icon, MessageCircleHeartIcon, PlusIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useConvexError } from "@/lib/use-convex-error";
import { codeValide, lireBible, type ErreurBible } from "@/convex/scenarioBible";
import modele from "@/convex/scenarioModele.json";
import { BibleErreurs } from "@/components/scenarios/BibleErreurs";
import { StatutScenario, useTypeScenario } from "@/components/scenarios/StatutScenario";
import { VerdictScenario } from "@/components/scenarios/VerdictScenario";
import { formatNumber } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";

type Creation = { mode: "nouveau" } | { mode: "import"; texte: string; nom: string };

/** Une médiane de vues s'affiche entière (la moyenne des deux du milieu peut tomber sur ,5). */
const arrondi = (x: number | null) => (x === null ? null : Math.round(x));

/**
 * SCÉNARIOS — les bibles des fausses conversations WhatsApp (BLUSH), rangées par
 * THÈME : la famille de campagne qu'elles servent (« La dispute »…), pour
 * qu'une campagne ne tire que des convs de son style.
 */
export default function ScenariosPage() {
  const tr = useTranslations("admin.scripts.ScenariosPage");
  const typeLabel = useTypeScenario();
  const projectPath = useProjectPath();
  const { has, chargement, skipUnless } = usePermissions();
  const loc = useIntlLocale();
  const scenarios = useProjectQuery(
    api.scenarios.listScenarios,
    has("scripts.manage") ? {} : "skip",
  );
  // PERFORMANCE à J+7, toutes campagnes confondues — bloc analytics : sans lui,
  // la liste reste là, sans les chiffres.
  const perf = useProjectQuery(api.scenarioAnalytics.perfParScenario, skipUnless("content.analytics", {}));
  const perfParId = useMemo(
    () => new Map((perf?.scenarios ?? []).map((p) => [p.scenarioId as string, p])),
    [perf],
  );
  const [creation, setCreation] = useState<Creation | null>(null);
  const fichier = useRef<HTMLInputElement>(null);

  const parTheme = useMemo(() => {
    const groupes = new Map<string, NonNullable<typeof scenarios>>();
    for (const s of scenarios ?? []) {
      const k = s.theme.trim();
      groupes.set(k, [...(groupes.get(k) ?? []), s]);
    }
    return [...groupes.entries()].sort(([a], [b]) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "fr"),
    );
  }, [scenarios]);
  const themes = useMemo(() => parTheme.map(([t]) => t).filter(Boolean), [parTheme]);

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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <MessageCircleHeartIcon className="size-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tr("titre")}</h1>
            <p className="text-sm text-slate-500">{tr("sousTitre")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => fichier.current?.click()}>
            <FileUpIcon className="mr-2 size-4" />
            {tr("importer")}
          </Button>
          <input
            ref={fichier}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="scenario-import-input"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setCreation({ mode: "import", texte: await f.text(), nom: f.name });
            }}
          />
          <Button onClick={() => setCreation({ mode: "nouveau" })}>
            <PlusIcon className="mr-2 size-4" />
            {tr("nouveau")}
          </Button>
        </div>
      </header>

      {scenarios === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : scenarios.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">{tr("aucun")}</CardContent>
        </Card>
      ) : (
        parTheme.map(([theme, liste]) => (
          <section key={theme || "—"} className="space-y-2" data-testid="scenario-theme">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {theme || tr("sansTheme")}
              <span className="ml-1.5 font-normal tabular-nums text-slate-400">{liste.length}</span>
            </h2>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {liste.map((s) => (
                <Link
                  key={s._id}
                  href={projectPath(`/scenarios/${s._id}`)}
                  prefetch={false}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                  data-testid="scenario-row"
                >
                  <span className="min-w-14 shrink-0 font-mono text-sm font-semibold text-slate-900">{s.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{s.titre}</span>
                  <Badge variant="outline" className="hidden text-[10px] text-slate-500 sm:inline-flex">
                    {typeLabel(s.type)}
                  </Badge>
                  {perf && (
                    <span
                      className="hidden w-36 shrink-0 text-right text-xs tabular-nums text-slate-500 md:inline"
                      data-testid="scenario-perf"
                    >
                      {perfParId.get(s._id)
                        ? tr("perf", {
                            posts: perfParId.get(s._id)!.posts,
                            vues: formatNumber(arrondi(perfParId.get(s._id)!.vuesMediane), loc),
                          })
                        : tr("perfAucune")}
                    </span>
                  )}
                  {perf && perfParId.get(s._id) && <VerdictScenario verdict={perfParId.get(s._id)!.verdict} />}
                  <StatutScenario statut={s.statut} />
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      <CreationDialog creation={creation} themes={themes} onClose={() => setCreation(null)} />
    </div>
  );
}

/**
 * Créer : un code et un thème, puis la bible — le modèle à compléter, ou le
 * fichier importé, vérifié AVANT l'envoi (les erreurs s'affichent ici).
 */
function CreationDialog({
  creation,
  themes,
  onClose,
}: {
  creation: Creation | null;
  themes: string[];
  onClose: () => void;
}) {
  const tr = useTranslations("admin.scripts.ScenariosPage");
  const showError = useConvexError();
  const router = useRouter();
  const projectPath = useProjectPath();
  const creer = useProjectMutation(api.scenarios.creerScenario);
  const [code, setCode] = useState("");
  const [theme, setTheme] = useState("");
  const [busy, setBusy] = useState(false);
  const listeThemes = useId();

  const lue = creation?.mode === "import" ? lireBible(creation.texte) : null;
  const erreurs: ErreurBible[] | null = lue ? (lue.ok ? [] : lue.erreurs) : null;
  const pret = creation?.mode === "import" ? lue?.ok === true : codeValide(code.trim());

  async function valider() {
    if (!creation || !pret) return;
    setBusy(true);
    try {
      const bible =
        creation.mode === "import"
          ? creation.texte
          : `${JSON.stringify({ ...modele, id: code.trim() }, null, 2)}\n`;
      const id: Id<"scenarios"> = await creer({ bible, theme });
      toast.success(tr("cree"));
      onClose();
      setCode("");
      setTheme("");
      router.push(projectPath(`/scenarios/${id}`));
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={creation !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creation?.mode === "import" ? tr("importerTitre") : tr("nouveauTitre")}</DialogTitle>
          <DialogDescription>
            {creation?.mode === "import" ? creation.nom : tr("nouveauAide")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {creation?.mode === "nouveau" && (
            <div className="space-y-1.5">
              <Label htmlFor="scenario-code">{tr("code")}</Label>
              <Input
                id="scenario-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={tr("codeExemple")}
                aria-invalid={code.length > 0 && !codeValide(code.trim())}
              />
              <p className="text-xs text-slate-400">{tr("codeAide")}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="scenario-theme">{tr("theme")}</Label>
            <Input
              id="scenario-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              list={listeThemes}
              placeholder={tr("themeExemple")}
            />
            <datalist id={listeThemes}>
              {themes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <p className="text-xs text-slate-400">{tr("themeAide")}</p>
          </div>
          {creation?.mode === "import" && <BibleErreurs erreurs={erreurs} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("annuler")}
          </Button>
          <Button onClick={valider} disabled={!pret || busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("creer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
