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
import { lastCheck } from "@/lib/warmup";
import {
  warmupStateOf,
  compareUrgence,
  type WarmupState,
} from "@/lib/compte-warmup-state";
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
import { useIsMobile } from "@/components/layout/use-is-mobile";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatNumber } from "@/lib/format";

type StatusFilter = "all" | CompteStatus;

// Libellés : `admin.accounts.statusFilter.<valeur>`.
const STATUS_FILTER_OPTIONS = ["all", "actif", "warmup", "shadowban", "archived"] as const satisfies readonly StatusFilter[];

type PlateformeFilter = "all" | "TikTok" | "Instagram" | "YouTube";
// Seul « all » est un libellé : les trois autres sont des noms de plateformes.
const PLATEFORME_FILTER_OPTIONS = ["all", "TikTok", "Instagram", "YouTube"] as const satisfies readonly PlateformeFilter[];

// Libellés : `admin.accounts.groupBy.<valeur>`.
const GROUP_OPTIONS = ["creator", "plateforme", "none"] as const satisfies readonly GroupAxis[];

// "all" | "internal" (comptes sans créateur) | <creatorId>.
type CreatorFilter = string;

function formatDateShort(ts: number | null, locale: string): string {
  return ts === null ? "—" : new Date(ts).toLocaleDateString(locale);
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
  const tr = useTranslations("admin.accounts.ComptesPageInner");
  const loc = useIntlLocale();
  const tStatus = useTranslations("admin.accounts.statusFilter");
  const tGroup = useTranslations("admin.accounts.groupBy");
  const etiquetteChauffe = useEtiquetteChauffe();
  const tLabel = useLabel();
  const router = useRouter();
  const projectPath = useProjectPath();
  const projectId = useProjectId();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
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
    () =>
      groupComptes(visibles, groupe, sortKey, sortDir, totalVuesProjet, tr("interne")),
    [visibles, groupe, sortKey, sortDir, totalVuesProjet, tr],
  );

  /**
   * Instant de référence, figé au montage. Un `Date.now()` dans le `useMemo`
   * serait impur (react-hooks/purity), et surtout le bandeau se recalculerait à
   * chaque rendu. Conséquence assumée : un onglet laissé ouvert toute la nuit
   * garde la journée de la veille jusqu'au rechargement.
   */
  const [maintenant] = useState(() => Date.now());

  /**
   * Chauffes qui réclament un geste, la plus en retard d'abord. Trois états
   * distincts au lieu d'un seul « warmup » : ce qui TRAÎNE ne se confond plus
   * avec le check ordinaire du jour.
   */
  const aTraiter = useMemo(() => {
    return (comptes ?? [])
      .map((c) => ({ compte: c, etat: warmupStateOf(c, maintenant) }))
      .filter(
        (x) => x.etat.kind === "enSouffrance" || x.etat.kind === "duJour",
      )
      .sort((a, b) => compareUrgence(a.etat, b.etat));
  }, [comptes, maintenant]);

  const enSouffrance = aTraiter.filter(
    (x) => x.etat.kind === "enSouffrance",
  ).length;

  /**
   * Comptes ACTIFS qui n'ont jamais rien publié — six sur vingt-sept en
   * production. Rien ne les distinguait d'un compte qui tourne.
   */
  const jamaisPublie = useMemo(
    () =>
      (comptes ?? []).filter(
        (c) => getEffectiveStatus(c) === "actif" && c.perf.nbPublies === 0,
      ).length,
    [comptes],
  );

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
    if (comptes === undefined) return tr("chargement");
    const parts = [tr("actifs", { count: counts.actif })];
    if (counts.warmup > 0) parts.push(tr("enWarmup", { count: counts.warmup }));
    if (counts.shadowban > 0) parts.push(tr("enShadowban", { count: counts.shadowban }));
    if (counts.archived > 0)
      parts.push(tr("archive", { archived: counts.archived }));
    if (jamaisPublie > 0)
      // Invariable : la ligne est une suite de compteurs (« 27 actifs · 4
      // warmup · 6 sans publication »), pas une phrase.
      parts.push(tr("sansPublication", { count: jamaisPublie }));
    if (totalVuesProjet > 0)
      parts.push(tr("vuesCumulees", { value: formatNumber(totalVuesProjet, loc) }));
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
            {tr("comptes")}
          </h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WarmupGuideButton projectId={projectId} admin />
          <WarmupSettingsButton />
          <Button variant="outline" onClick={() => navigate("personnes")}>
            <UsersIcon className="mr-2 size-4" />
            {tr("personnes")}
          </Button>
          <Button variant="outline" onClick={() => navigate("icps")}>
            <TargetIcon className="mr-2 size-4" />
            {tr("icps")}
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon className="mr-2 size-4" />
            {tr("ajouterUnCompte")}
          </Button>
        </div>
      </header>

      {/* Le seul travail QUOTIDIEN de cet écran : les checks de chauffe. Une
          chauffe qui TRAÎNE n'est pas un check du jour : sur le parc réel,
          @sofiamatcha22 tournait depuis 26 jours avec zéro check, en publiant
          déjà des posts rémunérés, et rien ne le disait plus fort qu'un compte
          démarré la veille. Le bandeau passe donc au rouge dès qu'une chauffe
          a dépassé sa durée, et cite l'ÂGE — que `missedDays`, plafonné à la
          durée cible, ne peut pas dire. */}
      {aTraiter.length > 0 && (
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2.5 text-sm ${
            enSouffrance > 0
              ? "border-rose-200 bg-rose-50/70"
              : "border-amber-200 bg-amber-50/70"
          }`}
        >
          <span
            className={`font-semibold ${enSouffrance > 0 ? "text-rose-900" : "text-amber-900"}`}
          >
            {enSouffrance > 0
              ? tr("chauffeEnSouffrance", { enSouffrance: enSouffrance })
              : tr("checkDeWarmupAFaire", { count: aTraiter.length })}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {aTraiter.slice(0, 6).map(({ compte: c, etat }) => (
              <Link
                key={c._id}
                href={projectPath(`/comptes/${c._id}`)}
                className={`inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-0.5 font-mono text-xs ${
                  etat.kind === "enSouffrance"
                    ? "border-rose-200 text-rose-900 hover:bg-rose-100"
                    : "border-amber-200 text-amber-900 hover:bg-amber-100"
                }`}
              >
                {c.handle}
                <span
                  className={
                    etat.kind === "enSouffrance"
                      ? "text-rose-600"
                      : "text-amber-600"
                  }
                >
                  {etiquetteChauffe(etat)}
                </span>
              </Link>
            ))}
            {aTraiter.length > 6 && (
              <span className="text-xs text-slate-500">
                {tr("etAutre", { value: aTraiter.length - 6 })}
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
          <span className="font-semibold">{tr("mesureDedoublee")}</span>{" "}
          {tr("collision", {
            plateforme: col.plateforme,
            handles: col.handles.map((h) => `« ${h} »`).join(tr("et")),
            count: col.handles.length,
          })}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-[300px]">
          <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder={tr("rechercherUnHandleUnCreateur")}
            aria-label={tr("rechercherUnCompte")}
            className="h-9 pl-8"
          />
        </div>
        <Select
          value={creatorFilter}
          onValueChange={(v) => v !== null && setCreatorFilter(v)}
        >
          <SelectTrigger className="w-40" aria-label={tr("filtrerParCreateur")}>
            <SelectValue>
              {creatorFilter === "all"
                ? tr("tousCreateurs")
                : creatorFilter === "internal"
                  ? tr("interne")
                  : (creatorOptions.find((o) => o.id === creatorFilter)?.name ??
                    tr("createur"))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("tousCreateurs")}</SelectItem>
            <SelectItem value="internal">{tr("interne")}</SelectItem>
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
          <SelectTrigger className="w-32" aria-label={tr("filtrerParPlateforme")}>
            <SelectValue>
              {plateformeFilter === "all" ? tr("toutes") : plateformeFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PLATEFORME_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>
                {o === "all" ? tr("toutes") : o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => v !== null && setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger className="w-36" aria-label={tr("filtrerParStatut")}>
            <SelectValue>{tStatus(statusFilter)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>
                {tStatus(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={groupe}
          onValueChange={(v) => v !== null && setGroupe(v as GroupAxis)}
        >
          <SelectTrigger className="w-44" aria-label={tr("grouperLesComptes")}>
            <SelectValue>{tGroup(groupe)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GROUP_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>
                {tGroup(o)}
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
            {tr("aucunComptePourCeFiltre")}
          </CardContent>
        </Card>
      ) : isMobile ? (
        <Card className="py-0">
          <CardContent className="p-0">
            {groupes.map((g) => (
              <section key={g.clef}>
                {g.titre !== null && (
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2">
                    <EnteteGroupe
                      titre={g.titre}
                      effectif={g.lignes.length}
                      vues={g.vues}
                      posts={g.posts}
                      part={g.part}
                    />
                  </div>
                )}
                <ul className="divide-y divide-slate-100">
                  {g.lignes.map((c) => (
                    <CarteCompte
                      key={c._id}
                      compte={c}
                      href={projectPath(`/comptes/${c._id}`)}
                      tLabel={tLabel}
                      maintenant={maintenant}
                      creatorRedondant={groupe === "creator"}
                      onEdit={() => setEditTarget(c)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader
                    label={tr("handle")}
                    sortKey="handle"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <TableHead>{tr("plateforme")}</TableHead>
                  <TableHead>{tr("etat")}</TableHead>
                  <TableHead>{tr("createur")}</TableHead>
                  <SortHeader
                    label={tr("vues")}
                    sortKey="vues"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label={tr("posts")}
                    sortKey="posts"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label={tr("dernierPost")}
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
                        maintenant={maintenant}
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
  maintenant,
  creatorRedondant,
  onEdit,
}: {
  compte: CompteRow;
  href: string;
  tLabel: ReturnType<typeof useLabel>;
  /** Instant de référence, figé par l'écran (cf son commentaire). */
  maintenant: number;
  /**
   * Vrai quand le groupe porte déjà ce nom, juste au-dessus. On ne RETIRE pas
   * la cellule pour autant : elle reste le fait de la ligne, et la spec de
   * réassignation lit ce texte (`row.getByText(creatorName)`) pour prouver
   * qu'un compte a bien changé de propriétaire. On l'éteint, c'est tout.
   */
  creatorRedondant: boolean;
  onEdit: () => void;
}) {
  const loc = useIntlLocale();
  const statut = getEffectiveStatus(c);

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
        <PastillesPlateforme compte={c} />
      </TableCell>
      {/* ÉTAT — trois anciennes colonnes en une. Statut, gestionnaire et
          progression de warmup étaient trois colonnes remplies 27, 5 et 4 fois
          sur 33 : un tiers de la largeur pour presque rien. Les textes restent
          au NIVEAU DE LA LIGNE, ce que les specs interrogent. */}
      <TableCell>
        <PastillesEtat compte={c} tLabel={tLabel} maintenant={maintenant} />
      </TableCell>
      <TableCell className={creatorRedondant ? "text-xs" : "text-sm"}>
        <NomCreateur compte={c} redondant={creatorRedondant} />
      </TableCell>
      {/* « 0 » et non « — » : un compte sans publication a zéro vue, ce n'est
          pas une donnée absente — et une spec compte ces deux cellules. */}
      <TableCell className="text-right font-medium tabular-nums text-slate-900">
        {formatNumber(c.perf.vuesCumulees, loc)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-700">
        {c.perf.nbPublies}
      </TableCell>
      <TableCell className="text-sm text-slate-500">
        {formatDateShort(c.perf.dernierPost, loc)}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <CompteAdminActions compte={c} onEdit={onEdit} />
      </TableCell>
    </TableRow>
  );
}

/**
 * La même ligne, en CARTE — sous 768 px, où sept colonnes ne tiennent pas.
 * Mêmes pastilles, même nom, mêmes chiffres : seule la disposition change.
 */
function CarteCompte({
  compte: c,
  href,
  tLabel,
  maintenant,
  creatorRedondant,
  onEdit,
}: {
  compte: CompteRow;
  href: string;
  tLabel: ReturnType<typeof useLabel>;
  maintenant: number;
  creatorRedondant: boolean;
  onEdit: () => void;
}) {
  const tr = useTranslations("admin.accounts.ComptesPageInner");
  const loc = useIntlLocale();
  const statut = getEffectiveStatus(c);
  return (
    <li
      className={cn(
        "space-y-2 px-4 py-3",
        statut === "archived" && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={href}
          className="min-w-0 truncate pt-1 font-mono text-sm font-medium text-slate-900 transition-colors hover:text-primary hover:underline"
        >
          {c.handle}
        </Link>
        <div className="shrink-0">
          <CompteAdminActions compte={c} onEdit={onEdit} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <PastillesPlateforme compte={c} />
        <PastillesEtat compte={c} tLabel={tLabel} maintenant={maintenant} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className={creatorRedondant ? "text-xs" : "text-sm"}>
          <NomCreateur compte={c} redondant={creatorRedondant} />
        </span>
        <span className="tabular-nums">
          <span className="font-medium text-slate-900">
            {formatNumber(c.perf.vuesCumulees, loc)}
          </span>{" "}
          {tr("vues").toLowerCase()} · {c.perf.nbPublies}{" "}
          {tr("posts").toLowerCase()} · {formatDateShort(c.perf.dernierPost, loc)}
        </span>
      </div>
    </li>
  );
}

function PastillesPlateforme({ compte: c }: { compte: CompteRow }) {
  const tr = useTranslations("admin.accounts.LigneCompte");
  const loc = useIntlLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PlatformBadge plateforme={c.plateforme} />
      {/* Pays ciblé (label informatif #110) — masqué si non défini, même
          style que le badge de la fiche détail. */}
      {c.targetCountry && (
        <span
          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600"
          title={tr("paysCible")}
        >
          {countryLabel(c.targetCountry, loc)}
        </span>
      )}
    </div>
  );
}

function PastillesEtat({
  compte: c,
  tLabel,
  maintenant,
}: {
  compte: CompteRow;
  tLabel: ReturnType<typeof useLabel>;
  maintenant: number;
}) {
  const tr = useTranslations("admin.accounts.LigneCompte");
  const etiquetteChauffe = useEtiquetteChauffe();
  const badge = getStatusBadge(c);
  const statut = getEffectiveStatus(c);
  const etat = warmupStateOf(c, maintenant);
  const last = lastCheck(c.warmupProtocol?.dailyChecks ?? []);
  const jamaisPublie = statut === "actif" && c.perf.nbPublies === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
          badge.className,
        )}
      >
        {tLabel(badge.labelKey, badge.params)}
      </span>
      {/* UNIQUEMENT la souffrance. La pastille de statut porte déjà
          « Warmup J+{done}/{target} » : ajouter « J1/7 » à côté aurait mis
          deux compteurs différents du même warmup sur la même ligne. Ce
          qu'elle ne sait pas dire, en revanche, c'est depuis QUAND ça
          traîne — et c'est ça qui décide de l'ordre des relances. */}
      {etat.kind === "enSouffrance" && (
        <span
          className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"
          title={last ? tr("dernierCheck", { last: last }) : tr("aucunCheckPose")}
        >
          {etiquetteChauffe(etat, { nommerLEtat: true })}
        </span>
      )}
      {/* Six comptes actifs sur vingt-sept n'ont jamais rien publié : ils
          étaient indistinguables d'un compte qui tourne. */}
      {jamaisPublie && (
        <span
          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500"
          title={tr("compteActifQuiNA")}
        >
          {tr("jamaisPublie")}
        </span>
      )}
      {c.personne && (
        <span
          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
          title={tr("gestionnaire")}
        >
          {c.personne.prenom} {c.personne.nom}
        </span>
      )}
    </div>
  );
}

function NomCreateur({
  compte: c,
  redondant,
}: {
  compte: CompteRow;
  redondant: boolean;
}) {
  const tr = useTranslations("admin.accounts.LigneCompte");
  return c.creator ? (
    <span className={redondant ? "text-slate-400" : "font-medium text-slate-700"}>
      {c.creator.name}
    </span>
  ) : (
    <span className="text-slate-400">{tr("interne")}</span>
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
  const tr = useTranslations("admin.accounts.EnteteGroupe");
  const loc = useIntlLocale();
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
        {tr("compte", { effectif: effectif })}
      </span>
      {posts > 0 && (
        <span className="text-xs tabular-nums text-slate-400">
          {tr("post", { posts: posts })}
        </span>
      )}
      {vues > 0 && (
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-600">
            {tr("vues", { value: formatNumber(vues, loc) })}
          </span>
          <span
            className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"
            title={tr("partDesVuesDuProjet", { pct })}
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </span>
          <span className="w-9 text-right text-xs tabular-nums text-slate-400">
            {tr("pctPart", { pct })}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * Libellé court d'une chauffe. En souffrance, c'est l'ÂGE qui parle — « 26 j,
 * 0 check » — parce que c'est lui qui dit à qui téléphoner en premier. En
 * cours, la progression suffit.
 */
function useEtiquetteChauffe() {
  const t = useTranslations("admin.accounts.chauffe");
  /**
   * Le bandeau annonce déjà « N chauffes en souffrance » dans son titre :
   * répéter les mots sur chaque pastille en dessous ne dit rien de plus. Sur la
   * ligne du tableau, en revanche, rien ne les porte — il les faut.
   */
  return (etat: WarmupState, opts: { nommerLEtat?: boolean } = {}): string => {
    if (etat.kind === "enSouffrance") {
      const mesure = t("mesure", { age: etat.age ?? 0, checks: etat.checks });
      return opts.nommerLEtat ? t("enSouffrance", { mesure }) : mesure;
    }
    if (etat.kind === "aValider") return t("aValider");
    return t("progression", { day: etat.day, target: etat.targetDays });
  };
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
  const tr = useTranslations("admin.accounts.EmptyState");
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-sm text-slate-500">
          {tr("aucunCompteAjouteTonPremier")}
        </p>
        <Button onClick={onAdd}>
          <PlusIcon className="mr-2 size-4" />
          {tr("ajouterUnCompte")}
        </Button>
      </CardContent>
    </Card>
  );
}
