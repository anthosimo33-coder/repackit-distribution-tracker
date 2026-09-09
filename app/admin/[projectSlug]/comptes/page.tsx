"use client";

import { Fragment, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath, useProjectId } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformBadge } from "@/components/VerdictBadge";
import { countryLabel } from "@/lib/countries";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusIcon,
  UsersIcon,
  TargetIcon,
  SearchIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getEffectiveStatus,
  getStatusBadge,
  type CompteStatus,
} from "@/lib/compte-status";
import { warmupProgress, lastCheck, checkedToday } from "@/lib/warmup";
import {
  groupComptes,
  collisionsDeMesure,
  type GroupAxis,
  type SortKey,
  type SortDir,
} from "@/lib/compte-grouping";
import { PersonnesManagerSection } from "@/components/comptes/PersonnesManagerSection";
import { IcpsManagerSection } from "@/components/icps/IcpsManagerSection";
import { WarmupGuideButton } from "@/components/warmup/WarmupGuideButton";
import { WarmupSettingsButton } from "@/components/warmup/WarmupSettingsButton";
import CompteDialog, { type Compte } from "@/components/comptes/CompteDialog";
import { CompteAdminActions } from "@/components/comptes/CompteAdminActions";
import { ComptesAValiderSection } from "@/components/comptes/ComptesAValiderSection";
import { useLabel } from "@/lib/use-label";
import type { FunctionReturnType } from "convex/server";

type StatusFilter = "all" | CompteStatus;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "actif", label: "Actifs" },
  { value: "warmup", label: "Warmup" },
  { value: "shadowban", label: "Shadowban" },
  { value: "archived", label: "Archivés" },
];

type PlateformeFilter = "all" | "TikTok" | "Instagram" | "YouTube";
const PLATEFORME_FILTER_OPTIONS: { value: PlateformeFilter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "TikTok", label: "TikTok" },
  { value: "Instagram", label: "Instagram" },
  { value: "YouTube", label: "YouTube" },
];

const GROUP_OPTIONS: { value: GroupAxis; label: string }[] = [
  { value: "creator", label: "Par créateur" },
  { value: "plateforme", label: "Par plateforme" },
  { value: "none", label: "Sans regroupement" },
];

// "all" | "internal" (comptes sans créateur) | <creatorId>.
type CreatorFilter = string;

const nfFR = new Intl.NumberFormat("fr-FR");
function formatDateShort(ts: number | null): string {
  return ts === null ? "—" : new Date(ts).toLocaleDateString("fr-FR");
}

/**
 * COLONNES FIXES de la table : Handle, Plateforme, État, Créateur, Vues, Posts,
 * Dernier post, actions. Ce nombre pilote le `colSpan` des lignes de groupe :
 * faux, le titre de groupe n'occupe plus toute la largeur et la grille se
 * désaligne (même piège que l'écran Créateurs).
 */
const COLONNES = 8;

export default function ComptesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ComptesPageInner />
    </Suspense>
  );
}

/**
 * Admin — parc de comptes du projet.
 *
 * L'écran listait 33 lignes à plat, triées par handle : il ouvrait donc sur
 * `@ang_creates` et ses 2 764 vues pendant que Kelly, 83 % des vues du projet,
 * dormait plus bas sur trois lignes qu'aucun regroupement ne rassemblait. Trois
 * colonnes sur dix étaient quasi constantes — « Actif » 27 fois sur 33, un
 * gestionnaire 5 fois, un warmup 4 fois — et mangeaient un tiers de la largeur.
 * Sept contrôles se disputaient l'en-tête, au point que « Ajouter un compte »
 * passait à la ligne. Il n'y avait pas de recherche.
 *
 * ⚠️ CE QUE LA REFONTE NE TOUCHE PAS, ET POURQUOI. La table reste une VRAIE
 * table, la cellule du handle ne contient QUE le handle, les en-têtes triables
 * restent des boutons nommés « Vues » / « Posts » / « Dernier post », le filtre
 * de statut reste un `Select` étiqueté « Filtrer par statut », et un compteur à
 * zéro s'écrit « 0 » et non « — ». Une vingtaine de specs e2e s'y appuient
 * (`getByRole("cell", { name: "@handle" })`, `getByRole("combobox", …)`), et
 * elles gardent des comportements réels : réassignation, archivage, warmup par
 * plateforme.
 */
function ComptesPageInner() {
  const tLabel = useLabel();
  const router = useRouter();
  const projectPath = useProjectPath();
  const projectId = useProjectId();
  const searchParams = useSearchParams();
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Compte | null>(null);
  const [recherche, setRecherche] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [plateformeFilter, setPlateformeFilter] =
    useState<PlateformeFilter>("all");
  const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>("all");
  const [groupe, setGroupe] = useState<GroupAxis>("creator");
  // Un écran d'exploitation ouvre sur ce qui pèse. L'alphabet reste à un clic.
  const [sortKey, setSortKey] = useState<SortKey>("vues");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const viewParam = searchParams.get("view");
  const isPersonnesView = viewParam === "personnes";
  const isIcpsView = viewParam === "icps";

  function navigate(view: "personnes" | "icps" | null) {
    const params = new URLSearchParams(searchParams);
    if (view) params.set("view", view);
    else params.delete("view");
    const qs = params.toString();
    router.replace(projectPath(qs ? `/comptes?${qs}` : "/comptes"));
  }

  // Compteurs par statut (sur l'ensemble, hors filtre) pour le sous-titre.
  const counts = useMemo(() => {
    const acc = { actif: 0, warmup: 0, shadowban: 0, archived: 0 };
    for (const c of comptes ?? []) acc[getEffectiveStatus(c)]++;
    return acc;
  }, [comptes]);

  // Options du filtre créateur : créateurs distincts présents (par id + nom).
  const creatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of comptes ?? []) {
      if (c.creatorId && c.creator) map.set(c.creatorId, c.creator.name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [comptes]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Perf : tri descendant par défaut (le plus performant d'abord) ;
      // handle : ascendant (ordre alphabétique).
      setSortDir(key === "handle" ? "asc" : "desc");
    }
  }

  // Filtres combinables (recherche × statut × plateforme × créateur).
  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (comptes ?? []).filter((c) => {
      if (statusFilter !== "all" && getEffectiveStatus(c) !== statusFilter)
        return false;
      if (plateformeFilter !== "all" && c.plateforme !== plateformeFilter)
        return false;
      if (creatorFilter === "internal" && c.creatorId) return false;
      if (
        creatorFilter !== "all" &&
        creatorFilter !== "internal" &&
        c.creatorId !== creatorFilter
      )
        return false;
      if (q === "") return true;
      // Le handle ET le nom du créateur : on cherche « Kelly » aussi souvent
      // qu'un pseudo, et ses trois comptes ne le portent pas dans leur nom.
      return (
        c.handle.toLowerCase().includes(q) ||
        (c.creator?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [comptes, recherche, statusFilter, plateformeFilter, creatorFilter]);

  /** Total du PROJET — dénominateur des parts, insensible aux filtres. */
  const totalVuesProjet = useMemo(
    () => (comptes ?? []).reduce((s, c) => s + c.perf.vuesCumulees, 0),
    [comptes],
  );

  const groupes = useMemo(
    () => groupComptes(visibles, groupe, sortKey, sortDir, totalVuesProjet),
    [visibles, groupe, sortKey, sortDir, totalVuesProjet],
  );

  /**
   * Instant de référence, figé au montage. Un `Date.now()` dans le `useMemo`
   * serait impur (react-hooks/purity), et surtout le bandeau se recalculerait à
   * chaque rendu. Conséquence assumée : un onglet laissé ouvert toute la nuit
   * garde la journée de la veille jusqu'au rechargement.
   */
  const [maintenant] = useState(() => Date.now());

  /** Comptes en chauffe dont le check du jour n'est pas encore posé. */
  const checksDus = useMemo(() => {
    return (comptes ?? []).filter(
      (c) =>
        getEffectiveStatus(c) === "warmup" &&
        !c.warmupDone &&
        // Le jour est celui de la CRÉATRICE, servi par le serveur — jamais
        // l'horloge du navigateur de l'équipe.
        !checkedToday(
          c.warmupProtocol?.dailyChecks ?? [],
          maintenant,
          c.creatorTimezone ?? null,
        ),
    );
  }, [comptes, maintenant]);

  /** Deux comptes d'une même plateforme sur la même clé de mesure (cf #196). */
  const collisions = useMemo(
    () => collisionsDeMesure(comptes ?? []),
    [comptes],
  );

  if (isPersonnesView) {
    return (
      <div className="space-y-6">
        <PersonnesManagerSection onBack={() => navigate(null)} />
      </div>
    );
  }

  if (isIcpsView) {
    return (
      <div className="space-y-6">
        <IcpsManagerSection onBack={() => navigate(null)} />
      </div>
    );
  }

  const subtitle = (() => {
    if (comptes === undefined) return "Chargement…";
    const parts = [`${counts.actif} actif${counts.actif > 1 ? "s" : ""}`];
    if (counts.warmup > 0) parts.push(`${counts.warmup} warmup`);
    if (counts.shadowban > 0) parts.push(`${counts.shadowban} shadowban`);
    if (counts.archived > 0)
      parts.push(`${counts.archived} archivé${counts.archived > 1 ? "s" : ""}`);
    if (totalVuesProjet > 0)
      parts.push(`${nfFR.format(totalVuesProjet)} vues cumulées`);
    return parts.join(" · ");
  })();

  return (
    <div className="space-y-5">
      {/* File de validation des comptes de clippeur — en TÊTE parce qu'elle est
          bloquante pour eux : tant qu'un compte n'est pas validé, son compteur
          de phase n'a pas démarré et il ne peut rien publier. La section
          s'efface d'elle-même quand la file est vide. */}
      <ComptesAValiderSection />

      {/* Le titre garde sa ligne. Les sept contrôles descendent d'un cran : à
          les mettre à côté du H1, le bouton principal passait sous le titre. */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Comptes
          </h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WarmupGuideButton projectId={projectId} admin />
          <WarmupSettingsButton />
          <Button variant="outline" onClick={() => navigate("personnes")}>
            <UsersIcon className="mr-2 size-4" />
            Personnes
          </Button>
          <Button variant="outline" onClick={() => navigate("icps")}>
            <TargetIcon className="mr-2 size-4" />
            ICPs
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon className="mr-2 size-4" />
            Ajouter un compte
          </Button>
        </div>
      </header>

      {/* Le seul travail QUOTIDIEN de cet écran : les checks de chauffe. Il
          fallait les repérer dans une colonne vide 29 fois sur 33. */}
      {checksDus.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-sm">
          {/* Phrase construite en JS : en JSX, le texte qui suit une
              interpolation rendant "" perd son espace (« 1 checkde warmup »),
              et un point renvoyé à la ligne en gagne un (« en double . »). */}
          <span className="font-semibold text-amber-900">
            {`${checksDus.length} check${checksDus.length > 1 ? "s" : ""} de warmup à faire aujourd'hui`}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {checksDus.slice(0, 6).map((c) => {
              const p = warmupProgress(
                c.warmupProtocol?.dailyChecks?.length ?? 0,
                c.targetDays,
              );
              return (
                <Link
                  key={c._id}
                  href={projectPath(`/comptes/${c._id}`)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2 py-0.5 font-mono text-xs text-amber-900 hover:bg-amber-100"
                >
                  {c.handle}
                  <span className="text-amber-600">
                    J{p.day}/{p.targetDays}
                  </span>
                </Link>
              );
            })}
            {checksDus.length > 6 && (
              <span className="text-xs text-amber-700">
                … et {checksDus.length - 6} autre
                {checksDus.length - 6 > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Collision de mesure : deux comptes d'une même plateforme lisent le même
          total (cf lib/compte-grouping). Aucun cas en prod à ce jour — le
          bandeau existe pour que le premier ne passe pas inaperçu. */}
      {collisions.map((col) => (
        <div
          key={`${col.plateforme}-${col.handles.join("|")}`}
          className="rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2.5 text-sm text-rose-900"
        >
          <span className="font-semibold">Mesure dédoublée</span>{" "}
          {`— sur ${col.plateforme}, ${col.handles
            .map((h) => `« ${h} »`)
            .join(" et ")} ${
            col.handles.length > 1
              ? "ne diffèrent que par la casse"
              : "existe en double"
          }. Leurs vues sont les mêmes des deux côtés : ce total est compté deux fois. À réunir en un seul compte.`}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-[300px]">
          <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un handle, un créateur…"
            aria-label="Rechercher un compte"
            className="h-9 pl-8"
          />
        </div>
        <Select
          value={creatorFilter}
          onValueChange={(v) => v !== null && setCreatorFilter(v)}
        >
          <SelectTrigger className="w-40" aria-label="Filtrer par créateur">
            <SelectValue>
              {creatorFilter === "all"
                ? "Tous créateurs"
                : creatorFilter === "internal"
                  ? "Interne"
                  : (creatorOptions.find((o) => o.id === creatorFilter)?.name ??
                    "Créateur")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous créateurs</SelectItem>
            <SelectItem value="internal">Interne</SelectItem>
            {creatorOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={plateformeFilter}
          onValueChange={(v) =>
            v !== null && setPlateformeFilter(v as PlateformeFilter)
          }
        >
          <SelectTrigger className="w-32" aria-label="Filtrer par plateforme">
            <SelectValue>
              {PLATEFORME_FILTER_OPTIONS.find(
                (o) => o.value === plateformeFilter,
              )?.label ?? "Toutes"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PLATEFORME_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => v !== null && setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger className="w-36" aria-label="Filtrer par statut">
            <SelectValue>
              {STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)
                ?.label ?? "Tous"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={groupe}
          onValueChange={(v) => v !== null && setGroupe(v as GroupAxis)}
        >
          <SelectTrigger className="w-44" aria-label="Grouper les comptes">
            <SelectValue>
              {GROUP_OPTIONS.find((o) => o.value === groupe)?.label ??
                "Par créateur"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GROUP_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {comptes === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : comptes.length === 0 ? (
        <EmptyState onAdd={() => setAddOpen(true)} />
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Aucun compte pour ce filtre.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader
                    label="Handle"
                    sortKey="handle"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <TableHead>Plateforme</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead>Créateur</TableHead>
                  <SortHeader
                    label="Vues"
                    sortKey="vues"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Posts"
                    sortKey="posts"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Dernier post"
                    sortKey="dernierPost"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupes.map((g) => (
                  <Fragment key={g.clef}>
                    {g.titre !== null && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={COLONNES}
                          className="bg-slate-50 py-2"
                        >
                          <EnteteGroupe
                            titre={g.titre}
                            effectif={g.lignes.length}
                            vues={g.vues}
                            posts={g.posts}
                            part={g.part}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                    {g.lignes.map((c) => (
                      <LigneCompte
                        key={c._id}
                        compte={c}
                        href={projectPath(`/comptes/${c._id}`)}
                        tLabel={tLabel}
                        creatorRedondant={groupe === "creator"}
                        onEdit={() => setEditTarget(c)}
                      />
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CompteDialog open={addOpen} onOpenChange={setAddOpen} mode="add" />
      <CompteDialog
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
        mode="edit"
        compte={editTarget ?? undefined}
      />
    </div>
  );
}

type CompteRow = FunctionReturnType<typeof api.comptes.listComptes>[number];

/**
 * Une ligne de compte. La cellule du HANDLE ne contient que le handle : c'est
 * son nom accessible, et une dizaine de specs font
 * `getByRole("cell", { name: "@handle" })`, qui compare le nom ENTIER.
 */
function LigneCompte({
  compte: c,
  href,
  tLabel,
  creatorRedondant,
  onEdit,
}: {
  compte: CompteRow;
  href: string;
  tLabel: ReturnType<typeof useLabel>;
  /**
   * Vrai quand le groupe porte déjà ce nom, juste au-dessus. On ne RETIRE pas
   * la cellule pour autant : elle reste le fait de la ligne, et la spec de
   * réassignation lit ce texte (`row.getByText(creatorName)`) pour prouver
   * qu'un compte a bien changé de propriétaire. On l'éteint, c'est tout.
   */
  creatorRedondant: boolean;
  onEdit: () => void;
}) {
  const badge = getStatusBadge(c);
  const statut = getEffectiveStatus(c);
  const isWarmup = statut === "warmup";
  // Durée servie par le serveur — jamais recalculée ici.
  const progress =
    isWarmup && c.warmupStartedAt !== undefined
      ? warmupProgress(
          c.warmupProtocol?.dailyChecks?.length ?? 0,
          c.targetDays,
        )
      : null;
  const last = lastCheck(c.warmupProtocol?.dailyChecks ?? []);

  return (
    <TableRow className={cn(statut === "archived" && "opacity-50")}>
      <TableCell className="font-mono font-medium text-slate-900">
        <Link
          href={href}
          className="transition-colors hover:text-primary hover:underline"
        >
          {c.handle}
        </Link>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <PlatformBadge plateforme={c.plateforme} />
          {/* Pays ciblé (label informatif #110) — masqué si non défini, même
              style que le badge de la fiche détail. */}
          {c.targetCountry && (
            <span
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600"
              title="Pays ciblé"
            >
              {countryLabel(c.targetCountry)}
            </span>
          )}
        </div>
      </TableCell>
      {/* ÉTAT — trois anciennes colonnes en une. Statut, gestionnaire et
          progression de warmup étaient trois colonnes remplies 27, 5 et 4 fois
          sur 33 : un tiers de la largeur pour presque rien. Les textes restent
          au NIVEAU DE LA LIGNE, ce que les specs interrogent. */}
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
              badge.className,
            )}
          >
            {tLabel(badge.labelKey, badge.params)}
          </span>
          {progress && (
            <span
              className="text-xs text-slate-500"
              title={last ? `Dernier check ${last}` : "Aucun check"}
            >
              J{progress.day}/{progress.targetDays}
            </span>
          )}
          {c.personne && (
            <span
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
              title="Gestionnaire"
            >
              {c.personne.prenom} {c.personne.nom}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className={creatorRedondant ? "text-xs" : "text-sm"}>
        {c.creator ? (
          <span
            className={
              creatorRedondant ? "text-slate-400" : "font-medium text-slate-700"
            }
          >
            {c.creator.name}
          </span>
        ) : (
          <span className="text-slate-400">Interne</span>
        )}
      </TableCell>
      {/* « 0 » et non « — » : un compte sans publication a zéro vue, ce n'est
          pas une donnée absente — et une spec compte ces deux cellules. */}
      <TableCell className="text-right font-medium tabular-nums text-slate-900">
        {nfFR.format(c.perf.vuesCumulees)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-700">
        {c.perf.nbPublies}
      </TableCell>
      <TableCell className="text-sm text-slate-500">
        {formatDateShort(c.perf.dernierPost)}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <CompteAdminActions compte={c} onEdit={onEdit} />
      </TableCell>
    </TableRow>
  );
}

/**
 * En-tête d'un groupe : qui, combien de comptes, et surtout QUEL POIDS. La barre
 * de part est la seule chose de cet écran qui dise qu'un projet tient sur une
 * personne — sur Snytch, Kelly porte 83 % des vues.
 */
function EnteteGroupe({
  titre,
  effectif,
  vues,
  posts,
  part,
}: {
  titre: string;
  effectif: number;
  vues: number;
  posts: number;
  /** 0..1 — jamais NaN, la garde est dans groupComptes. */
  part: number;
}) {
  const pct = Math.round(part * 100);
  return (
    <div
      data-testid="entete-groupe"
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      <span className="text-xs font-semibold tracking-tight text-slate-800">
        {titre}
      </span>
      <span className="text-xs tabular-nums text-slate-500">
        {effectif} compte{effectif > 1 ? "s" : ""}
      </span>
      {posts > 0 && (
        <span className="text-xs tabular-nums text-slate-400">
          {posts} post{posts > 1 ? "s" : ""}
        </span>
      )}
      {vues > 0 && (
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-600">
            {nfFR.format(vues)} vues
          </span>
          <span
            className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"
            title={`${pct} % des vues du projet`}
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </span>
          <span className="w-9 text-right text-xs tabular-nums text-slate-400">
            {pct} %
          </span>
        </span>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeKey === sortKey;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      {/* Pas d'aria-label : le texte visible EST le nom accessible. Un
          aria-label contenant le libellé (ex. « Handle ») collisionnerait avec
          les nombreux specs qui font getByLabel('Handle') (match en substring)
          dès que la table est rendue. */}
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-slate-900",
          align === "right" && "flex-row-reverse",
          active ? "text-slate-900" : "text-slate-500",
        )}
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ChevronUpIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          ))}
      </button>
    </TableHead>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-sm text-slate-500">
          Aucun compte. Ajoute ton premier compte TikTok ou Instagram.
        </p>
        <Button onClick={onAdd}>
          <PlusIcon className="mr-2 size-4" />
          Ajouter un compte
        </Button>
      </CardContent>
    </Card>
  );
}
