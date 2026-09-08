"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject, useProjectPath, useProjectSlug } from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FilterMultiSelect,
  type FilterMultiSelectOption,
} from "@/components/filters/FilterMultiSelect";
import {
  ClockIcon,
  LayoutGridIcon,
  ListIcon,
  MoreHorizontalIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { creatorStatusBadge, CREATOR_STATUS_ORDER, type CreatorStatus } from "@/lib/creator-status";
import { formatMoney } from "@/lib/format-rate";
import { formatDateFr } from "@/convex/dateFr";
import { cn } from "@/lib/utils";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";
import {
  CREATOR_KINDS,
  KIND_LABELS,
  resolveCreatorKind,
  type CreatorKind,
} from "@/convex/roles";
import {
  REGION_LABELS,
  REGION_ORDER,
  creatorRegion,
  localTimeIn,
  shortZoneLabel,
  type RegionKey,
} from "@/lib/creator-region";
import { joinUrl } from "./CopyableLink";
import { CycleLeaderStrip } from "./CycleLeaderStrip";

/**
 * ANNUAIRE DES CRÉATRICES — recherche, filtres, regroupement, liste.
 *
 * ─── CE QUI A CHANGÉ, ET POURQUOI ────────────────────────────────────────────
 * L'écran précédent ouvrait sur ~470 px de podium, puis deux rangées de sept
 * pastilles pour deux axes, puis un tableau sans recherche, sans tri, sans
 * sélection, et dont la seule colonne temporelle était « Ajouté le ». On ne
 * pouvait ni trouver quelqu'un, ni voir qui travaille, ni savoir où sont les
 * gens — alors même que le fuseau, lui, était déjà en base.
 *
 * ─── L'AXE « RÉGION » NE COÛTE AUCUNE DONNÉE NOUVELLE ────────────────────────
 * Il se dérive du fuseau EFFECTIF servi par `listCreatorActivity` (fiche, sinon
 * pays des comptes) — le MÊME que celui sur lequel le warmup compte les jours.
 * Cf `lib/creator-region.ts`.
 *
 * ─── LES COMPTEURS SONT CROISÉS ──────────────────────────────────────────────
 * Invariant repris de l'écran précédent et ÉLARGI à quatre axes : le compteur
 * d'une option compte sur la liste déjà filtrée par TOUS LES AUTRES axes, et par
 * la recherche. Un compteur qui annonce autre chose que ce qu'il va produire est
 * pire que pas de compteur.
 */

type CreatorRow = FunctionReturnType<typeof api.creators.listCreators>[number];
type ActivityRow = FunctionReturnType<
  typeof api.creators.listCreatorActivity
>[number];
type LeaderRow = FunctionReturnType<typeof api.payments.leaderboard>[number];

/** Ligne d'écran : la fiche, son activité, ses gains du cycle. */
type Ligne = CreatorRow & {
  activite: Omit<ActivityRow, "creatorId">;
  region: RegionKey;
  /** Gains du cycle en cours. `null` = pas de cycle (jamais publié) ou droit absent. */
  gains: number | null;
};

const AXES = ["kind", "locale", "region", "status"] as const;
type Axe = (typeof AXES)[number];

const GROUPES = ["region", "status", "locale", "kind", "none"] as const;
type Groupe = (typeof GROUPES)[number];

const GROUPE_LABELS: Record<Groupe, string> = {
  region: "Région",
  status: "Statut",
  locale: "Langue",
  kind: "Population",
  none: "Rien",
};

const TRIS = ["recent", "name", "gains", "lastPost", "publications"] as const;
type Tri = (typeof TRIS)[number];

const TRI_LABELS: Record<Tri, string> = {
  recent: "Ajout le plus récent",
  name: "Nom (A → Z)",
  gains: "Gains du cycle",
  lastPost: "Dernier post",
  publications: "Publications",
};

/** Valeur de chaque axe pour une ligne — la seule définition, filtres et groupes. */
const VALEUR_AXE: Record<Axe, (l: Ligne) => string> = {
  kind: (l) => resolveCreatorKind(l.kind),
  locale: (l) => l.locale,
  region: (l) => l.region,
  status: (l) => l.status,
};

// ─── Persistance par projet ─────────────────────────────────────────────────
// Même patron best-effort que le filtre de campagne des Assignments : clé par
// PROJET, restauration APRÈS montage (aucun écart d'hydratation), et une valeur
// illisible ou un localStorage indisponible n'empêchent jamais l'écran de
// s'afficher. Le filtre restauré reste VISIBLE dans la barre d'outils — un état
// qui cache des lignes sans le dire est le défaut qu'on évite.
const cle = (slug: string, quoi: string) => `createurs:${quoi}:${slug}`;

function lire(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function ecrire(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    // localStorage indisponible (mode privé strict) : on tolère l'absence de
    // persistance, jamais une erreur à l'écran.
  }
}

function initiales(nom: string): string {
  const parts = nom.trim().split(/[\s/]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * « il y a 4 j » — l'ancienneté d'un post, en JOURS DE PARIS.
 *
 * Le repère est épinglé sur Europe/Paris comme partout ailleurs dans ce dépôt :
 * le runtime Convex est en UTC et `postDate` est stocké à minuit Paris, si bien
 * qu'un décompte en heure locale du navigateur ferait basculer une partie des
 * posts d'un jour (cf convex/calendarStatus.ts).
 */
function anciennete(ts: number, maintenant: number): string {
  const jour = (t: number) =>
    Math.floor(
      Date.parse(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Paris",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(t)) + "T00:00:00Z",
      ) / 86_400_000,
    );
  const n = jour(maintenant) - jour(ts);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return "hier";
  return `il y a ${n} j`;
}

export function CreatorsDirectory({
  onInvite,
  onDelete,
}: {
  onInvite: () => void;
  onDelete: (cible: { id: Id<"creators">; name: string }) => void;
}) {
  const droits = usePermissions();
  const projectPath = useProjectPath();
  const projectSlug = useProjectSlug();
  const payCurrency = useProject().project.payCurrency;

  const creators = useProjectQuery(api.creators.listCreators, {});
  const activite = useProjectQuery(api.creators.listCreatorActivity, {});
  // UNE SEULE lecture du classement pour DEUX usages : le bandeau de tête et la
  // colonne « Gains du cycle ». Gardée par `payments.manage` — sans le droit, la
  // colonne n'existe pas, et l'écran tient debout quand même.
  const classement = useProjectQuery(
    api.payments.leaderboard,
    droits.skipUnless("payments.manage", {}),
  );
  const regenerate = useProjectMutation(api.creators.regenerateInvitation);

  const [recherche, setRecherche] = useState("");
  const [groupe, setGroupe] = useState<Groupe>("region");
  const [tri, setTri] = useState<Tri>("recent");
  const [vue, setVue] = useState<"list" | "cards">("list");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [filtres, setFiltres] = useState<Record<Axe, Set<string>>>({
    kind: new Set(),
    locale: new Set(),
    region: new Set(),
    status: new Set(),
  });

  // Heure locale des créatrices — rafraîchie chaque minute. Sans ça, l'écran
  // affiche l'heure du chargement : à 23:59 dans son fuseau, une créatrice
  // apparaît encore la veille pendant toute la session.
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Restauration post-montage, une seule fois.
  const restaure = useRef(false);
  useEffect(() => {
    if (restaure.current) return;
    restaure.current = true;
    const g = lire(cle(projectSlug, "groupe"));
    const t = lire(cle(projectSlug, "tri"));
    const v = lire(cle(projectSlug, "vue"));
    const f = lire(cle(projectSlug, "filtres"));
    /* eslint-disable react-hooks/set-state-in-effect -- hydratation post-mount
       best-effort depuis localStorage, même patron que SidebarLayout. */
    if (g && (GROUPES as readonly string[]).includes(g)) setGroupe(g as Groupe);
    if (t && (TRIS as readonly string[]).includes(t)) setTri(t as Tri);
    if (v === "list" || v === "cards") setVue(v);
    if (f) {
      try {
        const brut: unknown = JSON.parse(f);
        if (brut && typeof brut === "object") {
          const prochain = { kind: new Set<string>(), locale: new Set<string>(), region: new Set<string>(), status: new Set<string>() };
          for (const a of AXES) {
            const vals = (brut as Record<string, unknown>)[a];
            if (Array.isArray(vals)) {
              for (const x of vals) if (typeof x === "string") prochain[a].add(x);
            }
          }
          setFiltres(prochain);
        }
      } catch {
        // JSON corrompu → aucun filtre restauré, l'écran s'ouvre complet.
      }
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [projectSlug]);

  function changerGroupe(g: Groupe) {
    setGroupe(g);
    ecrire(cle(projectSlug, "groupe"), g);
  }
  function changerTri(t: Tri) {
    setTri(t);
    ecrire(cle(projectSlug, "tri"), t);
  }
  function changerVue(v: "list" | "cards") {
    setVue(v);
    ecrire(cle(projectSlug, "vue"), v);
  }
  function changerFiltre(axe: Axe, valeurs: Set<string>) {
    const prochain = { ...filtres, [axe]: valeurs };
    setFiltres(prochain);
    ecrire(
      cle(projectSlug, "filtres"),
      JSON.stringify(
        Object.fromEntries(AXES.map((a) => [a, [...prochain[a]]])),
      ),
    );
  }

  // ─── Lignes enrichies ─────────────────────────────────────────────────────
  const gainsParId = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of (classement ?? []) as LeaderRow[]) m.set(e.creatorId, e.totalDue);
    return m;
  }, [classement]);

  const activiteParId = useMemo(() => {
    const m = new Map<string, ActivityRow>();
    for (const a of activite ?? []) m.set(a.creatorId, a);
    return m;
  }, [activite]);

  const lignes = useMemo<Ligne[]>(() => {
    return (creators ?? []).map((c) => {
      const a = activiteParId.get(c._id);
      return {
        ...c,
        activite: {
          comptes: a?.comptes ?? 0,
          publications: a?.publications ?? 0,
          lastPostAt: a?.lastPostAt ?? null,
          // Le fuseau EFFECTIF vient de l'activité ; tant qu'elle charge, on
          // retombe sur celui de la fiche plutôt que d'annoncer « non
          // renseigné » à tout le monde pendant une demi-seconde.
          zone: a?.zone ?? c.timezone ?? null,
          zoneSource: a?.zoneSource ?? c.timezoneSource ?? null,
          zoneStored: a?.zoneStored ?? c.timezone !== undefined,
        },
        // La région suit le fuseau EFFECTIF, pas celui de la fiche : une
        // créatrice dont le fuseau se déduit du pays de ses comptes a une
        // région parfaitement connue, et n'a rien à faire dans « non
        // renseigné » — ce groupe-là est une file de travail.
        region: creatorRegion(a?.zone ?? c.timezone),
        gains: gainsParId.get(c._id) ?? null,
      };
    });
  }, [creators, activiteParId, gainsParId]);

  // ─── Recherche, puis filtres croisés ──────────────────────────────────────
  const cherchees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (q === "") return lignes;
    return lignes.filter((l) => {
      const h = l.handlesToCreate;
      const foin = [
        l.name,
        l.email,
        l.refSlug ?? "",
        h?.tiktok ?? "",
        h?.youtube ?? "",
        h?.instagram ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return foin.includes(q);
    });
  }, [lignes, recherche]);

  /** Lignes retenues par tous les axes SAUF `sauf` (undefined = tous). */
  const passe = useMemo(
    () => (l: Ligne, sauf?: Axe) =>
      AXES.every((a) => {
        if (a === sauf) return true;
        const sel = filtres[a];
        return sel.size === 0 || sel.has(VALEUR_AXE[a](l));
      }),
    [filtres],
  );

  const visibles = useMemo(
    () => cherchees.filter((l) => passe(l)),
    [cherchees, passe],
  );

  /** Effectifs d'un axe, comptés sur la liste filtrée par TOUS LES AUTRES. */
  function effectifs(axe: Axe): Map<string, number> {
    const m = new Map<string, number>();
    for (const l of cherchees) {
      if (!passe(l, axe)) continue;
      const v = VALEUR_AXE[axe](l);
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  }

  // ─── Population : un axe qui ne dit rien ne s'affiche pas ─────────────────
  // Sur un projet 100 % partenaires, la colonne rend dix-sept pastilles
  // identiques et le filtre a une seule option : une colonne entière et un menu
  // pour zéro information. La règle est DÉRIVÉE de la donnée, pas codée en dur —
  // ils reviennent le jour où un talent ou un clippeur existe.
  const populations = useMemo(() => {
    const s = new Set<CreatorKind>();
    for (const l of lignes) s.add(resolveCreatorKind(l.kind));
    return s;
  }, [lignes]);
  const montrerPopulation = populations.size > 1;
  const montrerGains = droits.has("payments.manage");

  // ─── Regroupement ─────────────────────────────────────────────────────────
  const groupes = useMemo(() => {
    const compare = (a: Ligne, b: Ligne) => {
      switch (tri) {
        case "name":
          return a.name.localeCompare(b.name, "fr");
        case "gains":
          return (b.gains ?? -1) - (a.gains ?? -1) || a.name.localeCompare(b.name, "fr");
        case "lastPost":
          return (
            (b.activite.lastPostAt ?? 0) - (a.activite.lastPostAt ?? 0) ||
            a.name.localeCompare(b.name, "fr")
          );
        case "publications":
          return (
            b.activite.publications - a.activite.publications ||
            a.name.localeCompare(b.name, "fr")
          );
        default:
          return b.createdAt - a.createdAt;
      }
    };
    const triees = [...visibles].sort(compare);
    if (groupe === "none") {
      return [{ clef: "all", titre: null, lignes: triees }];
    }
    const ordre: string[] =
      groupe === "region"
        ? REGION_ORDER
        : groupe === "status"
          ? CREATOR_STATUS_ORDER
          : groupe === "locale"
            ? [...LOCALES]
            : [...CREATOR_KINDS];
    const parClef = new Map<string, Ligne[]>();
    for (const l of triees) {
      const k = VALEUR_AXE[groupe as Axe](l);
      const liste = parClef.get(k) ?? [];
      liste.push(l);
      parClef.set(k, liste);
    }
    // L'ordre déclaré d'abord, puis toute clé imprévue (une locale ajoutée, un
    // statut inconnu) — jamais silencieusement perdue.
    const clefs = [
      ...ordre.filter((k) => parClef.has(k)),
      ...[...parClef.keys()].filter((k) => !ordre.includes(k)),
    ];
    return clefs.map((k) => ({
      clef: k,
      titre: titreGroupe(groupe, k),
      lignes: parClef.get(k)!,
    }));
  }, [visibles, groupe, tri]);

  // ─── Sélection ────────────────────────────────────────────────────────────
  const idsVisibles = useMemo(() => visibles.map((l) => String(l._id)), [visibles]);
  const selectionVisible = useMemo(
    () => idsVisibles.filter((id) => selection.has(id)),
    [idsVisibles, selection],
  );
  const toutSelectionne =
    idsVisibles.length > 0 && selectionVisible.length === idsVisibles.length;

  function basculerTout() {
    setSelection(toutSelectionne ? new Set() : new Set(idsVisibles));
  }
  function basculerUn(id: string) {
    const s = new Set(selection);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelection(s);
  }

  const selectionnees = visibles.filter((l) => selection.has(String(l._id)));

  async function copierEmails() {
    try {
      await navigator.clipboard.writeText(
        selectionnees.map((l) => l.email).join(", "),
      );
      toast.success(
        `${selectionnees.length} e-mail${selectionnees.length > 1 ? "s" : ""} copié${selectionnees.length > 1 ? "s" : ""}`,
      );
    } catch {
      toast.error("Copie impossible");
    }
  }

  function exporterCsv() {
    // Export LOCAL : rien ne quitte le navigateur, aucune query de plus. Les
    // colonnes sont celles de l'écran — pas un champ de plus, surtout aucun
    // champ de rémunération (ils ne sortent pas de `listCreators`, cf sa
    // projection explicite).
    const entetes = [
      "Nom",
      "Email",
      "Population",
      "Statut",
      "Langue",
      "Region",
      "Fuseau",
      "Comptes",
      "Publications",
      "Dernier post",
      "Ajoute le",
    ];
    const echappe = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const corps = selectionnees.map((l) =>
      [
        l.name,
        l.email,
        KIND_LABELS[resolveCreatorKind(l.kind)].singular,
        creatorStatusBadge(l.status).label,
        LOCALE_LABELS[l.locale as Locale] ?? l.locale,
        REGION_LABELS[l.region],
        l.activite.zone ?? "",
        String(l.activite.comptes),
        String(l.activite.publications),
        l.activite.lastPostAt ? formatDateFr(l.activite.lastPostAt) : "",
        formatDateFr(l.createdAt),
      ]
        .map(echappe)
        .join(";"),
    );
    // BOM UTF-8 : sans lui, Excel rend « Créateur » en « CrÃ©ateur ».
    const blob = new Blob(["﻿" + [entetes.map(echappe).join(";"), ...corps].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `createurs-${projectSlug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copierLien(token: string) {
    try {
      await navigator.clipboard.writeText(joinUrl(token));
      toast.success("Lien copié");
    } catch {
      toast.error("Copie impossible");
    }
  }

  async function regenerer(creatorId: Id<"creators">) {
    try {
      const { token } = await regenerate({ creatorId });
      await copierLien(token);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  if (creators === undefined) return <Skeleton className="h-96 w-full" />;

  // Colonnes FIXES : case, Nom, Email, Langue, Statut, Heure locale, Comptes,
  // Publis, Dernier post, actions. Les deux conditionnelles s'y ajoutent. Ce
  // nombre pilote le `colSpan` des lignes de groupe : faux, le titre de groupe
  // n'occupe plus toute la largeur et la grille se désaligne.
  const colonnes = 10 + (montrerPopulation ? 1 : 0) + (montrerGains ? 1 : 0);

  return (
    <div className="space-y-4">
      {montrerGains && (
        <CycleLeaderStrip data={classement} currency={payCurrency} />
      )}

      {/* ── Barre d'outils : une seule rangée, alignée sur la ligne de base des
             menus (FilterMultiSelect rend son propre libellé au-dessus). ── */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[340px]">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Chercher un nom, un e-mail, un @…"
            aria-label="Chercher un créateur"
            className="h-9 pl-8"
          />
        </div>

        {/* Enveloppes `data-testid` : le déclencheur de FilterMultiSelect
            n'est pas atteignable par `getByRole("combobox")` (le `render` de
            base-ui écrase le rôle), et son libellé visible est le même pour
            plusieurs menus (« Toutes »). Sans ancre stable, les specs visent au
            jugé. */}
        {montrerPopulation && (
          <div data-testid="filtre-population">
          <FilterMultiSelect
            label="Population"
            allLabel="Toutes"
            selectedValues={filtres.kind}
            onChange={(v) => changerFiltre("kind", v)}
            options={optionsDe(CREATOR_KINDS, effectifs("kind"), (k) => KIND_LABELS[k].singular)}
          />
          </div>
        )}
        <div data-testid="filtre-langue">
        <FilterMultiSelect
          label="Langue"
          allLabel="Toutes"
          selectedValues={filtres.locale}
          onChange={(v) => changerFiltre("locale", v)}
          options={optionsDe(LOCALES, effectifs("locale"), (l) => LOCALE_LABELS[l])}
        />
        </div>
        <div data-testid="filtre-region">
        <FilterMultiSelect
          label="Région"
          allLabel="Toutes"
          selectedValues={filtres.region}
          onChange={(v) => changerFiltre("region", v)}
          options={optionsDe(REGION_ORDER, effectifs("region"), (r) => REGION_LABELS[r])}
        />
        </div>
        <div data-testid="filtre-statut">
        <FilterMultiSelect
          label="Statut"
          allLabel="Tous"
          selectedValues={filtres.status}
          onChange={(v) => changerFiltre("status", v)}
          options={optionsDe(
            CREATOR_STATUS_ORDER,
            effectifs("status"),
            (s) => creatorStatusBadge(s).label,
          )}
        />
        </div>

        <div className="ml-auto flex items-end gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Grouper par</span>
            <select
              value={groupe}
              onChange={(e) => changerGroupe(e.target.value as Groupe)}
              data-testid="grouper-par"
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 focus-visible:border-primary focus-visible:outline-none"
            >
              {GROUPES.filter((g) => g !== "kind" || montrerPopulation).map((g) => (
                <option key={g} value={g}>
                  {GROUPE_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Trier par</span>
            <select
              value={tri}
              onChange={(e) => changerTri(e.target.value as Tri)}
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 focus-visible:border-primary focus-visible:outline-none"
            >
              {TRIS.filter((t) => t !== "gains" || montrerGains).map((t) => (
                <option key={t} value={t}>
                  {TRI_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-0.5 rounded-md bg-slate-100 p-0.5">
            <ViewButton actif={vue === "list"} onClick={() => changerVue("list")} label="Vue liste">
              <ListIcon className="size-4" />
            </ViewButton>
            <ViewButton actif={vue === "cards"} onClick={() => changerVue("cards")} label="Vue cartes">
              <LayoutGridIcon className="size-4" />
            </ViewButton>
          </div>
        </div>
      </div>

      {/* ── Barre d'actions groupées — n'apparaît qu'avec une sélection. ── */}
      {selectionnees.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2">
          <span className="text-sm font-medium text-slate-800">
            {selectionnees.length} sélectionné
            {selectionnees.length > 1 ? "s" : ""}
          </span>
          <Button variant="outline" size="sm" onClick={copierEmails}>
            Copier les e-mails
          </Button>
          <Button variant="outline" size="sm" onClick={exporterCsv}>
            Exporter en CSV
          </Button>
          <button
            type="button"
            onClick={() => setSelection(new Set())}
            className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            Tout désélectionner
          </button>
        </div>
      )}

      <p className="text-sm text-slate-500">
        {visibles.length === lignes.length
          ? `${lignes.length} créateur${lignes.length > 1 ? "s" : ""}`
          : `${visibles.length} sur ${lignes.length} créateur${lignes.length > 1 ? "s" : ""}`}
      </p>

      {lignes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <p className="text-sm text-slate-500">
              Aucun créateur. Invite ton premier créateur — il sera opérationnel
              en deux minutes.
            </p>
            <Button onClick={onInvite}>Inviter un créateur</Button>
          </CardContent>
        </Card>
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-sm text-slate-500">
            Aucun créateur ne correspond. Retire un filtre ou vide la recherche.
          </CardContent>
        </Card>
      ) : vue === "list" ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-9">
                    <input
                      type="checkbox"
                      checked={toutSelectionne}
                      onChange={basculerTout}
                      aria-label="Tout sélectionner"
                      className="size-3.5 accent-primary"
                    />
                  </TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email</TableHead>
                  {montrerPopulation && <TableHead>Population</TableHead>}
                  <TableHead className="whitespace-nowrap">Langue</TableHead>
                  <TableHead className="whitespace-nowrap">Statut</TableHead>
                  <TableHead className="whitespace-nowrap">Heure locale</TableHead>
                  <TableHead className="text-right">Comptes</TableHead>
                  <TableHead className="text-right">Publis</TableHead>
                  <TableHead className="whitespace-nowrap">Dernier post</TableHead>
                  {montrerGains && (
                    <TableHead className="text-right">Gains du cycle</TableHead>
                  )}
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupes.map((g) => (
                  <Fragment key={g.clef}>
                    {g.titre && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={colonnes}
                          className="bg-slate-50 py-2 text-xs"
                        >
                          <EnteteGroupe
                            titre={g.titre}
                            alerte={groupe === "region" && g.clef === "unknown"}
                            effectif={g.lignes.length}
                            total={
                              montrerGains
                                ? g.lignes.reduce((s, l) => s + (l.gains ?? 0), 0)
                                : null
                            }
                            currency={payCurrency}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                    {g.lignes.map((l) => {
                      const badge = creatorStatusBadge(l.status);
                      const pop = KIND_LABELS[resolveCreatorKind(l.kind)];
                      return (
                        <TableRow key={String(l._id)}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selection.has(String(l._id))}
                              onChange={() => basculerUn(String(l._id))}
                              // ⚠️ JAMAIS le nom de la ligne dans un aria-label :
                              // le nom accessible remonte sur la CELLULE, et
                              // `getByRole("cell", { name })` — qui matche par
                              // sous-chaîne — en trouve alors trois au lieu
                              // d'une. Les specs visent le testid, scopé à la
                              // ligne.
                              aria-label="Sélectionner ce créateur"
                              data-testid="row-select"
                              className="size-3.5 accent-primary"
                            />
                          </TableCell>
                          <TableCell className="font-medium whitespace-nowrap text-slate-900">
                            <span className="flex items-center gap-2.5">
                              <span
                                aria-hidden
                                className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
                              >
                                {initiales(l.name)}
                              </span>
                              <Link
                                href={projectPath(`/createurs/${l._id}`)}
                                className="transition-colors hover:text-primary hover:underline"
                              >
                                {l.name}
                              </Link>
                            </span>
                          </TableCell>
                          {/* TRONQUÉE, et volontairement : un e-mail de
                              créatrice fait facilement quarante caractères et
                              poussait « Dernier post » et « Gains du cycle »
                              hors de l'écran. La contrainte est sur la CELLULE
                              (un `max-width` sur un enfant ne borne pas la
                              colonne, qui se dimensionne sur son contenu). La
                              valeur entière reste au survol. */}
                          <TableCell
                            className="max-w-[210px] truncate text-sm text-slate-500"
                            title={l.email}
                          >
                            {l.email}
                          </TableCell>
                          {montrerPopulation && (
                            <TableCell>
                              <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-0.5 text-xs font-semibold text-indigo-700">
                                {pop.singular === "Créateur partenaire"
                                  ? "Partenaire"
                                  : pop.singular}
                              </span>
                            </TableCell>
                          )}
                          {/* Langue RÉSOLUE (users.locale → creators.locale → fr),
                              servie par le serveur. Sans cette colonne, on filtre
                              à l'aveugle : rien ne dirait que le filtre a raison. */}
                          <TableCell className="text-sm text-slate-600">
                            {LOCALE_LABELS[l.locale as Locale] ?? l.locale}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold",
                                badge.className,
                              )}
                            >
                              {badge.label}
                            </span>
                          </TableCell>
                          <TableCell>
                            <HeureLocale
                              zone={l.activite.zone}
                              source={l.activite.zoneSource}
                              maintenant={maintenant}
                            />
                          </TableCell>
                          <TableCell
                            data-testid="cell-comptes"
                            className="text-right text-sm tabular-nums text-slate-700"
                          >
                            {l.activite.comptes === 0 ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              l.activite.comptes
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-slate-700">
                            {l.activite.publications === 0 ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              l.activite.publications
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-slate-500">
                            {l.activite.lastPostAt === null ? (
                              <span className="text-slate-400">jamais publié</span>
                            ) : (
                              <span title={formatDateFr(l.activite.lastPostAt)}>
                                {anciennete(l.activite.lastPostAt, maintenant)}
                              </span>
                            )}
                          </TableCell>
                          {montrerGains && (
                            <TableCell className="text-right text-sm font-semibold tabular-nums text-slate-900">
                              {l.gains === null ? (
                                <span className="font-normal text-slate-300">—</span>
                              ) : (
                                formatMoney(l.gains, payCurrency)
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-8 p-0"
                                    aria-label="Actions"
                                    data-testid="row-actions"
                                  >
                                    <MoreHorizontalIcon className="size-4" />
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="end">
                                {l.invitation ? (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => copierLien(l.invitation!.token)}
                                    >
                                      Copier le lien
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => regenerer(l._id)}>
                                      Régénérer le lien
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                  </>
                                ) : null}
                                <DropdownMenuItem
                                  onClick={() => onDelete({ id: l._id, name: l.name })}
                                  className="text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                                >
                                  <Trash2Icon className="mr-2 size-4" />
                                  Supprimer le créateur
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupes.map((g) => (
            <section key={g.clef} className="space-y-2.5">
              {g.titre && (
                <EnteteGroupe
                  titre={g.titre}
                  alerte={groupe === "region" && g.clef === "unknown"}
                  effectif={g.lignes.length}
                  total={
                    montrerGains
                      ? g.lignes.reduce((s, l) => s + (l.gains ?? 0), 0)
                      : null
                  }
                  currency={payCurrency}
                />
              )}
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {g.lignes.map((l) => (
                  <CarteCreatrice
                    key={String(l._id)}
                    ligne={l}
                    href={projectPath(`/createurs/${l._id}`)}
                    maintenant={maintenant}
                    currency={payCurrency}
                    montrerGains={montrerGains}
                    selectionnee={selection.has(String(l._id))}
                    onToggle={() => basculerUn(String(l._id))}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Options d'un menu de filtre, effectif compris. Une option à zéro reste
 *  affichée : la faire disparaître ferait croire que la valeur n'existe pas. */
function optionsDe<T extends string>(
  valeurs: readonly T[],
  compte: Map<string, number>,
  label: (v: T) => string,
): FilterMultiSelectOption[] {
  return valeurs.map((v) => ({
    value: v,
    label: label(v),
    count: compte.get(v) ?? 0,
    muted: (compte.get(v) ?? 0) === 0,
  }));
}

function titreGroupe(groupe: Groupe, clef: string): string {
  switch (groupe) {
    case "region":
      return REGION_LABELS[clef as RegionKey] ?? clef;
    case "status":
      return creatorStatusBadge(clef as CreatorStatus).label;
    case "locale":
      return LOCALE_LABELS[clef as Locale] ?? clef;
    case "kind":
      return KIND_LABELS[clef as CreatorKind]?.plural ?? clef;
    default:
      return clef;
  }
}

function EnteteGroupe({
  titre,
  effectif,
  total,
  currency,
  alerte,
}: {
  titre: string;
  effectif: number;
  /** Somme des gains du groupe, ou `null` sans le droit `payments.manage`. */
  total: number | null;
  currency?: string | null;
  /** Groupe « fuseau non renseigné » : une file de travail, pas une région. */
  alerte?: boolean;
}) {
  return (
    <div
      data-testid="entete-groupe"
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
    >
      <span
        className={cn(
          "text-xs font-semibold tracking-tight",
          alerte ? "text-amber-700" : "text-slate-800",
        )}
      >
        {titre}
      </span>
      <span className="text-slate-300">·</span>
      <span className="text-xs tabular-nums text-slate-500">
        {effectif} créateur{effectif > 1 ? "s" : ""}
      </span>
      {total !== null && total > 0 && (
        <span className="ml-auto text-xs tabular-nums text-slate-500">
          {formatMoney(total, currency)} ce cycle
        </span>
      )}
    </div>
  );
}

/**
 * « São Paulo · 09:20 » — l'heure QU'IL EST CHEZ ELLE.
 *
 * Un fuseau non confirmé porte une pastille ambre : c'est la distinction que la
 * fiche fait déjà entre un FAIT (elle l'a validé) et une SUPPOSITION (saisi à la
 * main, ou déduit du pays de ses comptes). Sans elle, l'écran donne à toutes ces
 * heures la même autorité.
 */
function HeureLocale({
  zone,
  source,
  maintenant,
}: {
  zone: string | null;
  source: string | null;
  maintenant: number;
}) {
  if (!zone) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <ClockIcon className="size-3" />
        Non renseigné
      </span>
    );
  }
  const heure = localTimeIn(zone, maintenant);
  const confirme = source === "confirmed";
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-600"
      title={
        confirme
          ? `${zone} — confirmé par elle`
          : `${zone} — ${source === "inferred" ? "déduit du pays de ses comptes" : "saisi à la main"}, à confirmer`
      }
    >
      {!confirme && (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-400" />
      )}
      <span className="text-slate-700">{shortZoneLabel(zone)}</span>
      {heure && (
        <span className="tabular-nums text-slate-400">{heure}</span>
      )}
    </span>
  );
}

function ViewButton({
  actif,
  onClick,
  label,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      aria-label={label}
      className={cn(
        "grid size-8 place-items-center rounded transition-colors",
        actif
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-500 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

function CarteCreatrice({
  ligne,
  href,
  maintenant,
  currency,
  montrerGains,
  selectionnee,
  onToggle,
}: {
  ligne: Ligne;
  href: string;
  maintenant: number;
  currency?: string | null;
  montrerGains: boolean;
  selectionnee: boolean;
  onToggle: () => void;
}) {
  const badge = creatorStatusBadge(ligne.status);
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-white p-3.5 transition-colors",
        selectionnee ? "border-primary/40 bg-primary/5" : "border-slate-200 hover:border-slate-300",
      )}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selectionnee}
          onChange={onToggle}
          aria-label="Sélectionner ce créateur"
          className="mt-1 size-3.5 shrink-0 accent-primary"
        />
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {initiales(ligne.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <Link
            href={href}
            className="truncate text-sm font-medium text-slate-900 hover:text-primary hover:underline"
          >
            {ligne.name}
          </Link>
          <span className="truncate text-xs text-slate-400">{ligne.email}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <span className="text-[11px] font-medium text-slate-500">
          {LOCALE_LABELS[ligne.locale as Locale] ?? ligne.locale}
        </span>
        <span className="text-slate-300">·</span>
        <HeureLocale
          zone={ligne.activite.zone}
          source={ligne.activite.zoneSource}
          maintenant={maintenant}
        />
      </div>

      <div className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-2.5">
        <span className="text-xs text-slate-500 tabular-nums">
          {ligne.activite.comptes} compte{ligne.activite.comptes > 1 ? "s" : ""} ·{" "}
          {ligne.activite.publications} publi
          {ligne.activite.publications > 1 ? "s" : ""}
        </span>
        <span className="text-xs text-slate-400">
          {ligne.activite.lastPostAt === null
            ? "jamais publié"
            : anciennete(ligne.activite.lastPostAt, maintenant)}
        </span>
      </div>
      {montrerGains && ligne.gains !== null && (
        <div className="text-sm font-semibold tabular-nums text-slate-900">
          {formatMoney(ligne.gains, currency)}
          <span className="ml-1.5 text-xs font-normal text-slate-400">
            ce cycle
          </span>
        </div>
      )}
    </div>
  );
}
