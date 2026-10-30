"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarRangeIcon, ChevronDownIcon, Loader2Icon, RotateCcwIcon, XIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { usePermissions } from "@/components/project/use-permissions";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useConvexError } from "@/lib/use-convex-error";
import { formatNumber } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { choixNouveau, PILOTE, type Etage } from "@/convex/pilotePlan";

type Plan = FunctionReturnType<typeof api.pilote.proposer>;
type PlanCreatrice = Plan["createatrices"][number];
type CreneauPlan = PlanCreatrice["creneaux"][number];
type Exclusion = {
  creatorId: Id<"creators">;
  campaignId: Id<"scriptCampaigns">;
  cle: string;
};

const JOURS = [7, 14] as const;
const EXPLORATIONS = [0, 0.2, 0.3, 0.5] as const;
const CADENCES = [1, 2, 3] as const;

const demainParis = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + 24 * 3_600_000));

/**
 * PILOTE DES MISSIONS — la semaine de chaque créatrice, proposée depuis ce qui
 * a marché : chaque jour un parlé à midi et un muet le soir, ses gagnants
 * rejoués à l'identique, une part de nouveaux scripts. On retire, on change,
 * puis « Assigner » crée tout — un email par créatrice. Les règles :
 * convex/pilotePlan.
 */
export default function PilotePage() {
  const tr = useTranslations("admin.assignments.PilotePage");
  const { has, chargement } = usePermissions();
  const peut = has("assignments.manage");
  const creators = useProjectQuery(api.assignments.listAssignableCreators, peut ? {} : "skip");

  const [cadences, setCadences] = useState<Map<string, number>>(new Map());
  const [du, setDu] = useState(demainParis);
  const [jours, setJours] = useState<number>(7);
  const [exploration, setExploration] = useState<number>(PILOTE.explorationDefaut);
  const [retires, setRetires] = useState<string[]>([]);
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [confirmer, setConfirmer] = useState(false);

  const args = useMemo(
    () => ({
      createatrices: [...cadences].map(([creatorId, cadence]) => ({ creatorId: creatorId as Id<"creators">, cadence })),
      du,
      jours,
      exploration,
      seuil: PILOTE.seuilDefaut,
      retires,
      choix: Object.entries(choix).map(([creneau, source]) => ({ creneau, source })),
      exclusions,
    }),
    [cadences, du, jours, exploration, retires, choix, exclusions],
  );
  const plan = useProjectQuery(api.pilote.proposer, peut && cadences.size > 0 ? args : "skip");

  const remettreAZero = () => {
    setRetires([]);
    setChoix({});
    setExclusions([]);
  };

  if (chargement) return <Skeleton className="h-96 w-full" />;
  if (!peut) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-slate-500">{tr("accesRefuse")}</CardContent>
      </Card>
    );
  }

  const aAssigner = (plan?.createatrices ?? []).filter((c) => c.bloquee === null);
  const missions = aAssigner.reduce((n, c) => n + c.creneaux.filter((x) => x.source !== null).length, 0);
  const avecMissions = aAssigner.filter((c) => c.creneaux.some((x) => x.source !== null)).length;

  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
          <CalendarRangeIcon className="size-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tr("titre")}</h1>
          <p className="text-sm text-slate-500">{tr("sousTitre")}</p>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-x-6 gap-y-4 py-4">
          <div>
            <FilterMultiSelect
              label={tr("createatrices")}
              allLabel={tr("aucune")}
              searchable
              selectedValues={new Set(cadences.keys())}
              onChange={(next) => {
                setCadences((prev) => new Map([...next].map((id) => [id, prev.get(id) ?? PILOTE.cadenceDefaut])));
                remettreAZero();
              }}
              options={(creators ?? []).map((c) => ({ value: c._id, label: c.name }))}
            />
          </div>
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-500">{tr("aPartirDu")}</span>
            <Input
              type="date"
              value={du}
              onChange={(e) => {
                setDu(e.target.value);
                remettreAZero();
              }}
              className="w-40"
              data-testid="pilote-du"
            />
          </label>
          <Segments
            label={tr("jours")}
            valeurs={JOURS}
            valeur={jours}
            libelle={(n) => tr("nJours", { n })}
            onChange={(n) => {
              setJours(n);
              remettreAZero();
            }}
          />
          <Segments
            label={tr("exploration")}
            aide={tr("explorationAide")}
            valeurs={EXPLORATIONS}
            valeur={exploration}
            libelle={(x) => `${Math.round(x * 100)} %`}
            onChange={(x) => {
              setExploration(x);
              remettreAZero();
            }}
          />
        </CardContent>
      </Card>

      {cadences.size === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">{tr("choisisDesCreatrices")}</CardContent>
        </Card>
      ) : plan === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Campagnes campagnes={plan.campagnes} />
          {plan.createatrices.map((c) => (
            <PlanDeCreatrice
              key={c.creatorId}
              c={c}
              cadence={cadences.get(c.creatorId) ?? PILOTE.cadenceDefaut}
              setCadence={(n) => {
                setCadences((prev) => new Map(prev).set(c.creatorId, n));
                remettreAZero();
              }}
              retires={retires}
              setRetires={setRetires}
              setChoix={setChoix}
              setExclusions={setExclusions}
            />
          ))}
        </>
      )}

      {plan && missions > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-sm text-slate-600">{tr("resume", { missions, createatrices: avecMissions })}</span>
            <Button onClick={() => setConfirmer(true)} data-testid="pilote-assigner">
              {tr("assigner", { n: missions })}
            </Button>
          </div>
        </div>
      )}

      {plan && (
        <ConfirmerAssignation
          open={confirmer}
          onClose={() => setConfirmer(false)}
          createatrices={aAssigner}
          missions={missions}
          onDone={remettreAZero}
        />
      )}
    </div>
  );
}

function Segments<T extends number>({
  label,
  aide,
  valeurs,
  valeur,
  libelle,
  onChange,
}: {
  label: string;
  aide?: string;
  valeurs: readonly T[];
  valeur: number;
  libelle: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1.5" title={aide}>
      <span className="block text-xs font-medium text-slate-500">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-slate-200" role="radiogroup" aria-label={label}>
        {valeurs.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={v === valeur}
            onClick={() => onChange(v)}
            className={`px-3 py-1.5 text-sm tabular-nums transition-colors ${
              v === valeur ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {libelle(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Les campagnes en jeu : parlé, muet ou hors du pilote. */
function Campagnes({ campagnes }: { campagnes: Plan["campagnes"] }) {
  const tr = useTranslations("admin.assignments.PilotePage");
  const { has } = usePermissions();
  const showError = useConvexError();
  const classer = useProjectMutation(api.pilote.classerCampagne);
  const [ouvert, setOuvert] = useState(false);
  const nonClassees = campagnes.filter((c) => c.etage === null).length;
  if (campagnes.length === 0) return null;
  const visible = ouvert || nonClassees > 0;
  const options: { etage: Etage | null; label: string }[] = [
    { etage: "tofu", label: tr("parle") },
    { etage: "bofu", label: tr("muet") },
    { etage: null, label: tr("horsPilote") },
  ];

  return (
    <Card data-testid="pilote-campagnes">
      <CardContent className="space-y-3 py-4">
        <button type="button" onClick={() => setOuvert((o) => !o)} className="flex w-full items-center justify-between text-left">
          <span className="text-sm font-medium text-slate-900">
            {tr("campagnes")}
            {nonClassees > 0 && (
              <span className="ml-2 font-normal text-amber-700">{tr("aClasser", { n: nonClassees })}</span>
            )}
          </span>
          <ChevronDownIcon className={`size-4 text-slate-400 transition-transform ${visible ? "rotate-180" : ""}`} />
        </button>
        {visible && (
          <>
            <p className="text-xs text-slate-500">{tr("campagnesAide")}</p>
            <ul className="divide-y divide-slate-100">
              {campagnes.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid="pilote-campagne">
                  <span className="text-sm text-slate-800">{c.nom}</span>
                  {has("scripts.manage") ? (
                    <div className="flex overflow-hidden rounded-md border border-slate-200" role="radiogroup" aria-label={c.nom}>
                      {options.map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          role="radio"
                          aria-checked={c.etage === o.etage}
                          onClick={async () => {
                            try {
                              await classer({ campaignId: c.id, etage: o.etage });
                            } catch (e) {
                              toast.error(showError(e));
                            }
                          }}
                          className={`px-2.5 py-1 text-xs transition-colors ${
                            c.etage === o.etage ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">
                      {c.etage === "tofu" ? tr("parle") : c.etage === "bofu" ? tr("muet") : tr("horsPilote")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlanDeCreatrice({
  c,
  cadence,
  setCadence,
  retires,
  setRetires,
  setChoix,
  setExclusions,
}: {
  c: PlanCreatrice;
  cadence: number;
  setCadence: (n: number) => void;
  retires: string[];
  setRetires: React.Dispatch<React.SetStateAction<string[]>>;
  setChoix: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setExclusions: React.Dispatch<React.SetStateAction<Exclusion[]>>;
}) {
  const tr = useTranslations("admin.assignments.PilotePage");
  const loc = useIntlLocale();
  const jourLong = useMemo(
    () => new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
    [loc],
  );
  const libelleJour = (j: string) => jourLong.format(new Date(`${j}T00:00:00Z`));
  const parJour = new Map<string, CreneauPlan[]>();
  for (const x of c.creneaux) parJour.set(x.jour, [...(parJour.get(x.jour) ?? []), x]);

  return (
    <Card data-testid="pilote-createatrice">
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">{c.nom}</h2>
            <p className="text-xs text-slate-500">
              {[
                c.comptes.map((x) => `${x.handle} (${x.plateforme})`).join(" · ") || tr("sansCompte"),
                c.bareme ?? tr("sansBareme"),
                `${c.contenu.type === "promo" ? tr("promo") : tr("warmup")} · ${c.contenu.remuneree ? tr("remuneree") : tr("nonRemuneree")}`,
              ].join(" — ")}
            </p>
            {c.medianes.length > 0 && (
              <p className="text-xs text-slate-500">
                {tr("medianes")}{" "}
                {c.medianes
                  .map((m) => `${m.etage === "tofu" ? tr("parle") : tr("muet")} ${m.plateforme} ${m.valeur === null ? tr("pasAssez") : formatNumber(m.valeur, loc)}`)
                  .join(" · ")}
              </p>
            )}
          </div>
          <Segments
            label={tr("parJour")}
            valeurs={CADENCES}
            valeur={cadence}
            libelle={(n) => String(n)}
            onChange={setCadence}
          />
        </div>

        {c.bloquee !== null && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {c.bloquee === "sansCompte" ? tr("bloqueeSansCompte") : tr("bloqueeSansBareme")}
          </p>
        )}
        {c.nonClassees.length > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {tr("nonClassees", { campagnes: c.nonClassees.map((x) => x.nom).join(", ") })}
          </p>
        )}
        {c.dejaPrevus.length > 0 && (
          <p className="text-xs text-slate-500">
            {tr("dejaPrevus")}{" "}
            {c.dejaPrevus.map((d) => tr("dejaPrevusJour", { jour: libelleJour(d.jour), n: d.missions })).join(" · ")}
          </p>
        )}

        {c.creneaux.length === 0 ? (
          <p className="text-sm text-slate-500">{tr("riendARemplir")}</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {[...parJour].map(([jour, creneaux]) => (
              <div key={jour} className="flex flex-col gap-2 px-3 py-2 sm:flex-row">
                <span className="w-28 shrink-0 pt-1 text-xs font-medium capitalize text-slate-500">{libelleJour(jour)}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  {creneaux.map((x) => (
                    <LigneCreneau
                      key={x.id}
                      x={x}
                      creatorId={c.creatorId}
                      retire={retires.includes(x.id)}
                      setRetires={setRetires}
                      setChoix={setChoix}
                      setExclusions={setExclusions}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LigneCreneau({
  x,
  creatorId,
  retire,
  setRetires,
  setChoix,
  setExclusions,
}: {
  x: CreneauPlan;
  creatorId: Id<"creators">;
  retire: boolean;
  setRetires: React.Dispatch<React.SetStateAction<string[]>>;
  setChoix: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setExclusions: React.Dispatch<React.SetStateAction<Exclusion[]>>;
}) {
  const tr = useTranslations("admin.assignments.PilotePage");
  const tPlage = useTranslations("postWindow.short");
  const loc = useIntlLocale();
  const s = x.source;
  const vues = (n: number, plateforme: string, ratio: number | null) =>
    ratio === null
      ? tr("vues", { vues: formatNumber(n, loc), plateforme })
      : tr("vuesRatio", {
          vues: formatNumber(n, loc),
          plateforme,
          ratio: new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(ratio),
        });
  const choisir = (source: string) => {
    setChoix((prev) => ({ ...prev, [x.id]: source }));
    setRetires((prev) => prev.filter((id) => id !== x.id));
  };

  return (
    <div className={`flex flex-wrap items-start gap-x-3 gap-y-1 ${retire ? "opacity-50" : ""}`} data-testid="pilote-creneau">
      <div className="flex w-16 shrink-0 flex-col gap-1 sm:w-32">
        <span className="text-xs text-slate-500">{tPlage(x.plage)}</span>
        <Badge variant="outline" className={x.etage === "tofu" ? "border-sky-200 text-sky-700" : "border-violet-200 text-violet-700"}>
          {x.etage === "tofu" ? tr("parle") : tr("muet")}
        </Badge>
      </div>
      <div className="min-w-0 flex-1 basis-48 space-y-0.5">
        {s === null ? (
          <p className="text-sm text-slate-500">
            {x.vide === "retire"
              ? tr("videRetire")
              : x.vide === "aCourt"
                ? tr("aCourt")
                : x.vide === "aucuneCampagne"
                  ? tr("videAucuneCampagne")
                  : tr("videAucunGagnant")}
          </p>
        ) : s.kind === "rejeu" ? (
          <>
            <p className="text-sm text-slate-900">
              {s.propre ? tr("rejeuPropre") : tr("rejeuEquipe", { createatrice: s.createatrice })}{" "}
              {s.lien ? (
                <a href={s.lien} target="_blank" rel="noreferrer" className="text-slate-500 underline-offset-2 hover:underline">
                  {vues(s.vues, s.plateforme, s.ratio)}
                </a>
              ) : (
                <span className="text-slate-500">{vues(s.vues, s.plateforme, s.ratio)}</span>
              )}
            </p>
            <p className="text-xs text-slate-400">{s.campagne}</p>
            {s.texte && <p className="line-clamp-2 text-xs text-slate-600">{s.texte}</p>}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-900">
              {tr("nouveau")} <span className="text-slate-500">· {s.campagne}</span>{" "}
              <span className="text-xs text-slate-400">{x.exploration ? tr("enExploration") : tr("aucunGagnantLibre")}</span>
            </p>
            {s.apercu ? (
              <p className="line-clamp-2 text-xs text-slate-600">{s.apercu.texte}</p>
            ) : (
              <p className="text-xs text-amber-700">{tr("aCourt")}</p>
            )}
          </>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" data-testid="pilote-changer" />}>
            {tr("changer")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-sm">
            {x.alternatives.length > 0 && <DropdownMenuLabel>{tr("autresGagnants")}</DropdownMenuLabel>}
            {x.alternatives.map((alt) => (
              <DropdownMenuItem key={alt.comboKey} onClick={() => choisir(alt.comboKey)} className="flex-col items-start">
                <span className="text-sm">
                  {alt.propre ? tr("rejeuPropre") : tr("rejeuEquipe", { createatrice: alt.createatrice })} ·{" "}
                  {vues(alt.vues, alt.plateforme, alt.ratio)}
                </span>
                {alt.texte && <span className="line-clamp-1 text-xs text-slate-500">{alt.texte}</span>}
              </DropdownMenuItem>
            ))}
            {(x.alternatives.length > 0 || x.campagnes.length > 0) && <DropdownMenuSeparator />}
            {s?.kind === "nouveau" && s.apercu && (
              <DropdownMenuItem
                onClick={() =>
                  setExclusions((prev) => [...prev, { creatorId, campaignId: s.campaignId, cle: s.apercu!.cle }])
                }
              >
                {tr("autreScript")}
              </DropdownMenuItem>
            )}
            {x.campagnes
              .filter((cp) => !(s?.kind === "nouveau" && s.campaignId === cp.id))
              .map((cp) => (
                <DropdownMenuItem key={cp.id} onClick={() => choisir(choixNouveau(cp.id))}>
                  {tr("nouveauDans", { campagne: cp.nom })}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          aria-label={retire ? tr("remettre") : tr("retirer")}
          title={retire ? tr("remettre") : tr("retirer")}
          onClick={() => setRetires((prev) => (retire ? prev.filter((id) => id !== x.id) : [...prev, x.id]))}
          data-testid="pilote-retirer"
        >
          {retire ? <RotateCcwIcon className="size-4" /> : <XIcon className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

/** Une mutation par créatrice, comme l'assignation en masse : un refus n'emporte pas les autres. */
function ConfirmerAssignation({
  open,
  onClose,
  createatrices,
  missions,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  createatrices: PlanCreatrice[];
  missions: number;
  onDone: () => void;
}) {
  const tr = useTranslations("admin.assignments.PilotePage");
  const showError = useConvexError();
  const assigner = useProjectMutation(api.pilote.assigner);
  const [busy, setBusy] = useState(false);
  const avec = createatrices.filter((c) => c.creneaux.some((x) => x.source !== null));

  async function valider() {
    setBusy(true);
    let creees = 0;
    for (const c of avec) {
      const lignes = c.creneaux.flatMap((x) =>
        x.source === null
          ? []
          : [
              {
                jour: x.jour,
                plage: x.plage,
                source:
                  x.source.kind === "rejeu"
                    ? { kind: "rejeu" as const, assignmentId: x.source.assignmentId }
                    : {
                        kind: "nouveau" as const,
                        campaignId: x.source.campaignId,
                        exclusions: [] as string[],
                      },
              },
            ],
      );
      try {
        const r = await assigner({ creatorId: c.creatorId, lignes });
        creees += r.creees;
        for (const m of r.manques) toast.warning(tr("manque", { createatrice: c.nom, campagne: m.campagne, creees: m.creees, demandees: m.demandees }));
      } catch (e) {
        toast.error(`${c.nom} : ${showError(e)}`);
      }
    }
    setBusy(false);
    if (creees > 0) toast.success(tr("assignees", { n: creees }));
    onDone();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("confirmerTitre", { n: missions })}</DialogTitle>
          <DialogDescription>{tr("confirmerAide", { createatrices: avec.length })}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm text-slate-700">
          {avec.map((c) => (
            <li key={c.creatorId}>
              {tr("confirmerLigne", { createatrice: c.nom, n: c.creneaux.filter((x) => x.source !== null).length })}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("annuler")}
          </Button>
          <Button onClick={valider} disabled={busy} data-testid="pilote-confirmer">
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("assigner", { n: missions })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
