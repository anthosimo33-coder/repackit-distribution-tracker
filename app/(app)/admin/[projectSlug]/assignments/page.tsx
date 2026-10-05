"use client";

import {
  Suspense,
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  BanIcon,
  BellIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ClapperboardIcon,
  ClipboardListIcon,
  FileTextIcon,
  ImagesIcon,
  ListIcon,
  Loader2Icon,
  LockIcon,
  RotateCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { AssignmentModelVideosDialog } from "@/components/admin/AssignmentModelVideosDialog";
import { AssignmentScriptDialog } from "@/components/admin/AssignmentScriptDialog";
import { EditScriptComboDialog } from "@/components/admin/EditScriptComboDialog";
import { EditBrickTextDialog } from "@/components/admin/EditBrickTextDialog";
import { LinkAssetFolderDialog } from "@/components/admin/LinkAssetFolderDialog";
import { AssignmentOverlayDialog } from "@/components/admin/AssignmentOverlayDialog";
import { AssignmentInstructionsDialog } from "@/components/admin/AssignmentInstructionsDialog";
import { AssignmentPostDateDialog } from "@/components/admin/AssignmentPostDateDialog";
import {
  AssignmentsCalendar,
  type CalendarStatusFilter,
} from "@/components/admin/AssignmentsCalendar";
import { AssignmentAttachments } from "@/components/admin/AssignmentAttachments";
import { AssignmentDetailSheet } from "@/components/admin/AssignmentDetailSheet";
import { AssignmentsFilters } from "@/components/admin/AssignmentsFilters";
import {
  AssignmentMobileList,
  AssignmentRowMenu,
  type AssignmentRowActions,
  type AssignmentRowGestures,
} from "@/components/admin/AssignmentMobileList";
import { ImposedComboBadge } from "@/components/admin/ImposedComboBadge";
import { useProject } from "@/components/project/ProjectProvider";
import { useIsCompact } from "@/lib/use-media-query";
import {
  buildCampaignOptions,
  NO_CAMPAIGN,
  campaignTriggerLabel,
  matchesCampaignFilter,
  sanitizeCampaignSelection,
} from "@/lib/assignment-campaign-filter";
import { matchesSearch, searchTerms } from "@/lib/assignment-search";
import { buildCreatorOptions } from "@/lib/assignment-creator-filter";
import {
  buildCountryOptions,
  matchesCountryFilter,
  NO_COUNTRY,
} from "@/lib/country-filter";
import { countryLabel } from "@/lib/countries";
import { canEditScriptCombo } from "@/lib/script-combo-edit";
import { canCancelAssignment, canDeleteAssignment } from "@/lib/assignment-delete";
import {
  AbandonMissionDialog,
  useRestoreAssignment,
} from "@/components/admin/AbandonMissionDialog";
import { DELETED_VIDEO_RETENTION_DAYS, hasSubmittedVideo } from "@/lib/assignment-video";
import { useLabel } from "@/lib/use-label";
import {
  assignmentGroupKey,
  interleaveByGroup,
} from "@/lib/assignment-order";
import {
  ASSIGNMENT_STATUS,
  assignmentUrgency,
  urgencyRank,
  type AssignmentStatus,
} from "@/lib/assignment-status";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";
import { sameContent } from "@/lib/same-content";
import { listPage } from "@/lib/list-page";
import { ListPager } from "@/components/admin/ListPager";

function formatDate(ts: number, locale: string = "fr-FR") {
  return new Date(ts).toLocaleDateString(locale);
}

/** Clé de mémorisation du dernier mode d'affichage (défaut = calendrier). */
const VIEW_MODE_KEY = "repackit.assignments.viewMode";

/**
 * Clé du filtre campagne — PAR PROJET. Une clé globale rapatrierait les ids de
 * campagne d'un projet dans l'autre : ils n'y matcheraient rien et la liste
 * paraîtrait vide sans cause visible. Le contenu est en plus repassé par
 * sanitizeCampaignSelection au chargement (campagne supprimée entre-temps).
 */
const campaignFilterKey = (slug: string) =>
  `repackit.assignments.campaignFilter.${slug}`;

/**
 * Wrapper Suspense pour `useSearchParams` (Next 16 le suspend) — même découpage
 * que app/admin/[projectSlug]/validation/page.tsx et inspirations/page.tsx.
 * Sans lui, le build échoue sur le rendu statique de la page.
 */
export default function AssignmentsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AssignmentsPageInner />
    </Suspense>
  );
}

function AssignmentsPageInner() {
  const showError = useConvexError();
  const loc = useIntlLocale();
  const tr = useTranslations("admin.assignments.AssignmentsPageInner");
  const assignments = useProjectQuery(api.assignments.listAssignmentsPilotage, {});
  const projectSlug = useProject().project.slug;
  // Ancre temporelle stable au montage (rang d'urgence de l'ordre + filtre
  // « en retard »). Impure au render sinon (cf react-hooks/purity, comme le
  // dashboard créateur) → l'ordre ne se réordonne pas à chaque re-render.
  const [nowMs] = useState(() => Date.now());
  // Filtre créateur MULTI (Set vide = tous) — partagé par la liste ET le
  // calendrier. Étendu depuis un mono-select : le calendrier a besoin du multi.
  //
  // Lien profond `?createur=<creatorId>` : c'est la cible des notifications de
  // retard (« un lien vers ses assignations filtrées »). Lu UNE FOIS, à
  // l'initialisation — pas dans un effet qui réécrirait le filtre à chaque
  // rendu, ce qui empêcherait l'admin de le modifier après avoir suivi le lien.
  const deepLinkCreator = useSearchParams().get("createur");
  const [creatorIds, setCreatorIds] = useState<Set<string>>(() =>
    deepLinkCreator ? new Set([deepLinkCreator]) : new Set(),
  );
  // Sous 768 px : le tableau à huit colonnes devient une liste de cartes, et les
  // filtres quittent la barre pour un panneau. Un seul des deux rendus est monté
  // (cf. lib/use-media-query) — rien n'est dupliqué dans le DOM.
  const compact = useIsCompact();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Vue Liste (table) / Calendrier (pilotage) — mêmes filtres partagés. Le
  // CALENDRIER est la vue par DÉFAUT ; le dernier choix est mémorisé.
  const [viewMode, setViewMode] = useState<"list" | "calendar">("calendar");
  // Restaure le dernier choix APRÈS montage (aucun écart d'hydratation SSR ; le
  // défaut reste calendrier si rien de mémorisé ou localStorage indisponible).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      // Hydratation post-mount depuis localStorage (même pattern best-effort que
      // SidebarLayout) → pas de mismatch SSR ; setState post-mount assumé.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "list" || saved === "calendar") setViewMode(saved);
    } catch {
      // localStorage indisponible (mode privé strict) → on garde le défaut.
    }
  }, []);
  function changeViewMode(next: "list" | "calendar") {
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // idem : on tolère l'absence de persistance.
    }
  }
  // Filtre CAMPAGNE de scripts (Set vide = toutes) — remplace l'ancien « Tous
  // formats », qui ne filtrait que les assignations d'origine FORMAT : il n'en
  // existe AUCUNE en prod, son menu était donc vide. Partagé liste + calendrier.
  const [campaignIds, setCampaignIds] = useState<Set<string>>(new Set());
  // Filtre PAYS CIBLÉ (Set vide = tous) — le pays des comptes que vise
  // l'assignation. Partagé liste + calendrier, non persisté (comme le créateur).
  const [countryCodes, setCountryCodes] = useState<Set<string>>(new Set());
  // Verrou de restauration en REF (pas en state) : il ne doit rien re-rendre, et
  // ça laisse un seul setState dans l'effet ci-dessous.
  const campaignRestored = useRef(false);
  const [statusFilter, setStatusFilter] = useState("all");
  // Filtre de STATUT CALENDRIER (vue calendrier uniquement) — MÊME emplacement
  // que le filtre de statut de production, mais axe distinct (dérivé). On ne crée
  // pas un second contrôle : le Select s'adapte à la vue.
  const [calStatusFilter, setCalStatusFilter] =
    useState<CalendarStatusFilter>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Recherche TEXTE — le seul filtre qui ne demande pas de savoir d'avance ce
  // qu'on cherche. Volontairement NON persistée : un filtre catégoriel oublié
  // se remarque au libellé du déclencheur, une recherche oubliée ne se remarque
  // pas du tout. Elle est partagée par les deux vues (chercher une créatrice
  // puis basculer sur son calendrier est le geste naturel).
  const [search, setSearch] = useState("");
  // Le FILTRE suit une valeur DIFFÉRÉE : le champ affiche la frappe tout de
  // suite, le re-tri de ~800 lignes vient ensuite, en rendu interruptible —
  // une lettre de plus l'abandonne au lieu de s'empiler derrière lui.
  const deferredSearch = useDeferredValue(search);
  const terms = useMemo(() => searchTerms(deferredSearch), [deferredSearch]);
  // Vidéos modèles : gestion à chaud d'un assignment (dialog). On dérive la row
  // LIVE depuis `assignments` (réactif) → la liste se rafraîchit après ajout/retrait.
  const [manageId, setManageId] = useState<Id<"assignments"> | null>(null);
  const manageRow = manageId
    ? ((assignments ?? []).find((a) => a._id === manageId) ?? null)
    : null;
  // Voir le script monté (lecture seule) — assembledScript FIGÉ, non re-dérivé.
  const [scriptId, setScriptId] = useState<Id<"assignments"> | null>(null);
  const scriptRow = scriptId
    ? ((assignments ?? []).find((a) => a._id === scriptId) ?? null)
    : null;
  // Modifier le combo (1 brique, 1 fois, avant publication) — row dérivée live.
  const [editId, setEditId] = useState<Id<"assignments"> | null>(null);
  const editRow = editId
    ? ((assignments ?? []).find((a) => a._id === editId) ?? null)
    : null;
  // Éditer le texte d'une brique (fork) — MÊME verrou que "Modifier le combo".
  const [textEditId, setTextEditId] = useState<Id<"assignments"> | null>(null);
  const textEditRow = textEditId
    ? ((assignments ?? []).find((a) => a._id === textEditId) ?? null)
    : null;
  // Le COMBO de briques de la ligne éditée, demandé À L'OUVERTURE : la liste ne
  // le porte plus (cf listAssignmentsPilotage), comme elle ne porte plus le
  // texte du script. La modale s'ouvre quand il est arrivé.
  const editCombo = useProjectQuery(
    api.assignments.getAssignmentCombo,
    editId ? { id: editId } : "skip",
  );
  const textEditCombo = useProjectQuery(
    api.assignments.getAssignmentCombo,
    textEditId ? { id: textEditId } : "skip",
  );
  // Lier un dossier d'assets (images à télécharger) — row dérivée live.
  const [assetLinkId, setAssetLinkId] = useState<Id<"assignments"> | null>(null);
  const assetLinkRow = assetLinkId
    ? ((assignments ?? []).find((a) => a._id === assetLinkId) ?? null)
    : null;
  // Texte overlay à incruster (consigne admin) — row dérivée live.
  const [overlayId, setOverlayId] = useState<Id<"assignments"> | null>(null);
  const overlayRow = overlayId
    ? ((assignments ?? []).find((a) => a._id === overlayId) ?? null)
    : null;
  // Instructions libres pour la créatrice (consigne admin) — row dérivée live.
  const [instructionsId, setInstructionsId] = useState<Id<"assignments"> | null>(
    null,
  );
  const instructionsRow = instructionsId
    ? ((assignments ?? []).find((a) => a._id === instructionsId) ?? null)
    : null;
  // Date de publication planifiée — édition après coup (row dérivée live).
  // Hoistée au niveau page → réutilisable depuis la future vue calendrier (C).
  const [postDateId, setPostDateId] = useState<Id<"assignments"> | null>(null);
  const postDateRow = postDateId
    ? ((assignments ?? []).find((a) => a._id === postDateId) ?? null)
    : null;
  // Détail d'une assignation — panneau ouvert au clic sur un post du CALENDRIER
  // (script + publication + date éditable). Row dérivée LIVE → statut/pub à jour.
  const [detailId, setDetailId] = useState<Id<"assignments"> | null>(null);
  const detailRow = detailId
    ? ((assignments ?? []).find((a) => a._id === detailId) ?? null)
    : null;
  // Suppression (hard-delete) — confirmation obligatoire, libère le combo.
  const deleteAssignment = useProjectMutation(api.assignments.deleteAssignment);
  // Relance créateur (email du chantier B). La colonne « en retard » était
  // purement passive : on voyait le problème sans pouvoir le traiter.
  const nudge = useProjectMutation(api.assignments.nudgeAssignment);
  const [nudgingId, setNudgingId] = useState<Id<"assignments"> | null>(null);

  async function handleNudge(id: Id<"assignments">, creatorName: string) {
    setNudgingId(id);
    try {
      const res = await nudge({ assignmentId: id });
      if (res.sent) {
        toast.success(tr("relanceParEmail", { creatorName: creatorName }));
      } else {
        toast.info(tr("aDejaEteRelanceIl", { creatorName: creatorName }));
      }
    } catch (e) {
      toast.error(showError(e, tr("relanceImpossible")));
    } finally {
      setNudgingId(null);
    }
  }
  const [deleteId, setDeleteId] = useState<Id<"assignments"> | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Abandon — confirmation (vidéo envoyée, email à la créatrice) ; la ligne
  // reste. « Rétablir » remet le statut d'avant l'abandon.
  const [abandonId, setAbandonId] = useState<Id<"assignments"> | null>(null);
  const abandonRow = abandonId !== null ? (assignments ?? []).find((a) => a._id === abandonId) : undefined;
  const { restore } = useRestoreAssignment();
  // Les gestes de ligne sont STABLES (lignes mémoïsées) : ils appellent la
  // dernière version par une ref, comme la relance.
  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  });

  // Une ABANDONNÉE a déjà libéré son combo : la confirmation parle alors de ce
  // qui change vraiment — elle quitte la liste et l'historique.
  const deleteRow = deleteId !== null ? (assignments ?? []).find((a) => a._id === deleteId) : undefined;
  const deleteAbandoned = deleteRow?.status === "cancelled";
  // Une vidéo envoyée jointe : la confirmation dit qu'elle est gardée 30 jours.
  const deleteHasVideo = deleteRow !== undefined && hasSubmittedVideo(deleteRow);

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteAssignment({ id: deleteId });
      toast.success(
        deleteAbandoned
          ? tr("missionAbandonneeSupprimee")
          : tr("assignmentSupprimeLeComboEst"),
      );
      setDeleteId(null);
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setDeleting(false);
    }
  }

  // Options du filtre CRÉATEUR : les créatrices sorties du parc (en pause,
  // parties, supprimées) forment une section REPLIÉE — cf
  // lib/assignment-creator-filter.
  const creatorOptionsRaw = useMemo(
    () => buildCreatorOptions(assignments ?? []),
    [assignments],
  );
  // Options du filtre CAMPAGNE : construites depuis les ASSIGNATIONS (une
  // campagne sans assignation n'a rien à filtrer), triées par effectif
  // décroissant, archivées en seconde section mais SÉLECTIONNABLES — elles
  // portent 23 % des livrables sur Snytch. Cf lib/assignment-campaign-filter.
  const campaignOptions = useMemo(
    () => buildCampaignOptions(assignments ?? []),
    [assignments],
  );

  // Options mises en forme pour <AssignmentsFilters> — calculées ICI et non dans
  // le rendu : les deux hôtes du composant (barre desktop / panneau mobile) les
  // reçoivent à l'identique, et le tableau ne se reconstruit pas à chaque frappe.
  const creatorOptions = useMemo(
    () =>
      creatorOptionsRaw.map((o) => ({
        ...o,
        muted: o.section === "inactive",
      })),
    [creatorOptionsRaw],
  );
  const nbInactives = creatorOptionsRaw.filter(
    (o) => o.section === "inactive",
  ).length;
  const creatorFolded = {
    section: "inactive",
    showLabel: tr("afficherInactives", { count: nbInactives }),
    hideLabel: tr("masquerInactives"),
  };
  const countryOptions = useMemo(
    () =>
      buildCountryOptions(
        (assignments ?? []).map((a) => a.targets.map((t) => t.country)),
      ).map((o) => ({
        value: o.value,
        label:
          o.value === NO_COUNTRY
            ? tr("sansPays")
            : (countryLabel(o.value, loc) ?? o.value),
        count: o.count,
      })),
    [assignments, loc, tr],
  );
  const filterCampaignOptions = useMemo(
    () =>
      campaignOptions.map((o) => ({
        value: o.value,
        // Le bucket « sans campagne » est le seul libellé du lot : il vient du
        // catalogue, les autres sont des noms de campagne.
        label: o.value === NO_CAMPAIGN ? tr("sansCampagne") : o.label,
        count: o.count,
        section: o.section,
        muted: o.section === "archived",
      })),
    [campaignOptions],
  );
  const campaignTrigger = campaignTriggerLabel(
    campaignIds,
    campaignOptions,
    tr("toutesCampagnes"),
  );

  // RESTAURATION du filtre campagne — après chargement, pour pouvoir purger les
  // ids devenus fantômes (campagne supprimée, ou clé d'un autre projet). Sans
  // cette purge, un id orphelin ne matcherait rien et la liste paraîtrait vide
  // sans cause visible. Une seule fois : ensuite l'utilisateur est maître.
  useEffect(() => {
    if (assignments === undefined || campaignRestored.current) return;
    campaignRestored.current = true;
    try {
      const raw = localStorage.getItem(campaignFilterKey(projectSlug));
      const saved: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(saved)) return;
      const clean = sanitizeCampaignSelection(
        saved.filter((v): v is string => typeof v === "string"),
        buildCampaignOptions(assignments),
      );
      // Hydratation post-mount depuis localStorage (même pattern best-effort que
      // le mode d'affichage ci-dessus) → pas de mismatch SSR ; setState assumé.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (clean.size > 0) setCampaignIds(clean);
    } catch {
      // localStorage indisponible ou JSON corrompu → aucun filtre restauré.
    }
  }, [assignments, projectSlug]);

  /** Change le filtre ET le mémorise (par projet). */
  function changeCampaignIds(next: Set<string>) {
    setCampaignIds(next);
    try {
      localStorage.setItem(
        campaignFilterKey(projectSlug),
        JSON.stringify([...next]),
      );
    } catch {
      // idem : on tolère l'absence de persistance.
    }
  }

  // Un filtre actif doit être VISIBLE au retour sur la page — le compteur
  // « 42 / 139 » est trop discret pour ça.
  const activeFilterCount =
    (creatorIds.size > 0 ? 1 : 0) +
    (campaignIds.size > 0 ? 1 : 0) +
    (countryCodes.size > 0 ? 1 : 0) +
    (statusFilter !== "all" && viewMode === "list" ? 1 : 0) +
    (calStatusFilter !== "all" && viewMode === "calendar" ? 1 : 0) +
    (overdueOnly ? 1 : 0) +
    (terms.length > 0 ? 1 : 0);

  function resetFilters() {
    setCreatorIds(new Set());
    changeCampaignIds(new Set());
    setCountryCodes(new Set());
    setStatusFilter("all");
    setCalStatusFilter("all");
    setOverdueOnly(false);
    setSearch("");
  }

  const rows = useMemo(() => {
    const now = nowMs;
    const filtered = (assignments ?? []).filter((a) => {
      if (creatorIds.size > 0 && !creatorIds.has(a.creatorId)) return false;
      // Campagne — appliqué AVANT la bascule de vue, donc actif en liste ET en
      // calendrier (tous deux consomment `rows`) : changer de vue ne fait pas
      // sauter le filtre en silence.
      if (!matchesCampaignFilter(a, campaignIds)) return false;
      if (
        !matchesCountryFilter(
          a.targets.map((t) => t.country),
          countryCodes,
        )
      )
        return false;
      // Recherche texte — appliquée AVANT la bascule de vue, donc active en
      // liste ET en calendrier (cf lib/assignment-search).
      if (!matchesSearch(a, terms)) return false;
      // Statut de PRODUCTION : filtre la LISTE. En vue calendrier, c'est le statut
      // CALENDRIER (calStatusFilter, appliqué dans AssignmentsCalendar) qui filtre.
      if (
        viewMode === "list" &&
        statusFilter !== "all" &&
        a.status !== statusFilter
      )
        return false;
      if (
        overdueOnly &&
        assignmentUrgency(a.dueDate, a.status as AssignmentStatus, now) !==
          "overdue"
      )
        return false;
      return true;
    });
    // Les FORMATS d'une créatrice ALTERNENT quelle que soit leur ÉCHÉANCE (fini
    // les blocs « 7 carrousels d'échéance 31/07 collés à la fin »). On groupe par
    // créatrice — dans l'ordre où elles apparaissent (listAssignments = createdAt
    // décroissant → activité la plus récente en tête) — puis on entrelace SES
    // missions PAR RANG D'URGENCE (en retard → < 48 h → dans les temps → non
    // actionnable ; formats alternés dans chaque rang). MÊME moteur que l'espace
    // créatrice (lib/assignment-order), seed = creatorId → ordre stable.
    const byCreator = new Map<string, typeof filtered>();
    for (const a of filtered) {
      const g = byCreator.get(a.creatorId);
      if (g) g.push(a);
      else byCreator.set(a.creatorId, [a]);
    }
    return [...byCreator.entries()].flatMap(([creatorId, group]) =>
      interleaveByGroup(group, {
        keyOf: (a) => assignmentGroupKey(a),
        tierOf: (a) =>
          urgencyRank(assignmentUrgency(a.dueDate, a.status as AssignmentStatus, now)),
        dueDateOf: (a) => a.dueDate,
        seed: creatorId,
      }),
    );
  }, [
    assignments,
    creatorIds,
    campaignIds,
    countryCodes,
    statusFilter,
    overdueOnly,
    terms,
    nowMs,
    viewMode,
  ]);

  // PAGE de la vue Liste, attachée à la combinaison de filtres qui l'a
  // produite : changer un filtre ou la recherche revient à la page 1 (la page 3
  // d'une autre sélection ne désigne rien). Une écriture — nouvelle version de
  // la query — ne touche pas cette clé : on reste sur sa page pendant qu'on y
  // travaille. Dérivée au rendu plutôt que remise à zéro dans un effet, donc
  // jamais un rendu intermédiaire sur la mauvaise page.
  const pageKey = [
    [...creatorIds].sort().join(","),
    [...campaignIds].sort().join(","),
    [...countryCodes].sort().join(","),
    statusFilter,
    overdueOnly ? "retard" : "",
    terms.join(" "),
  ].join("|");
  const [pageAt, setPageAt] = useState({ key: pageKey, page: 0 });
  const listView = listPage(rows, pageAt.key === pageKey ? pageAt.page : 0);
  const tableTopRef = useRef<HTMLDivElement>(null);
  function goToPage(page: number) {
    setPageAt({ key: pageKey, page });
    // Le pager est en BAS du tableau : on repart du haut de la nouvelle page,
    // juste sous la barre d'outils collante (scroll-mt).
    tableTopRef.current?.scrollIntoView({ block: "start" });
  }

  // Les gestes d'une ligne, en UN objet : la carte mobile et le menu de la ligne
  // desktop ouvrent EXACTEMENT les mêmes modales, tenues ici. Rassemblés plutôt
  // que passés un par un — onze `on…` en props, c'est onze occasions d'en
  // brancher un sur la mauvaise modale.
  // Hauteur RÉELLE de la barre d'outils, publiée en variable CSS pour que les
  // en-têtes de groupe de la liste mobile collent JUSTE EN DESSOUS. Une constante
  // en dur (« top-12 ») serait fausse dès que la barre passe sur deux lignes —
  // ce qu'elle fait précisément sur téléphone, où la recherche prend la sienne.
  // Écriture directe dans le style du nœud : aucun state, donc aucun re-rendu.
  useEffect(() => {
    const bar = toolbarRef.current;
    const root = rootRef.current;
    if (!bar || !root) return;
    const apply = () =>
      root.style.setProperty("--assignments-sticky-top", `${bar.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // Relance : la DERNIÈRE version de `handleNudge` (elle referme sur `nudge`,
  // `tr`, `showError`), lue au moment du clic. Sans ce relais, les gestes
  // ci-dessous changeraient d'identité à chaque rendu, et toutes les lignes du
  // tableau avec eux.
  const handleNudgeRef = useRef(handleNudge);
  useEffect(() => {
    handleNudgeRef.current = handleNudge;
  });
  // Gestes STABLES — le même objet d'un rendu à l'autre. C'est ce qui permet
  // aux lignes mémoïsées du tableau de NE PAS se re-rendre quand on ouvre une
  // modale ou qu'on tape dans la recherche : sur Snytch (787 lignes, ~70 000
  // nœuds), chacun de ces gestes bloquait l'écran ~500 ms. `nudgingId` n'en
  // fait pas partie : il change, lui, et la ligne le reçoit à part.
  const rowGestures = useMemo<AssignmentRowGestures>(
    () => ({
      onDetail: setDetailId,
      onScript: setScriptId,
      onEditCombo: setEditId,
      onEditText: setTextEditId,
      onModelVideos: setManageId,
      onAssets: setAssetLinkId,
      onOverlay: setOverlayId,
      onInstructions: setInstructionsId,
      onPostDate: setPostDateId,
      onNudge: (id, creatorName) =>
        void handleNudgeRef.current(id, creatorName),
      onCancel: setAbandonId,
      onRestore: (id) => void restoreRef.current(id),
      onDelete: setDeleteId,
    }),
    // Des setters de useState : stables, l'objet ne se reconstruit jamais.
    [
      setDetailId,
      setScriptId,
      setEditId,
      setTextEditId,
      setManageId,
      setAssetLinkId,
      setOverlayId,
      setInstructionsId,
      setPostDateId,
      setAbandonId,
      setDeleteId,
    ],
  );
  const rowActions = useMemo<AssignmentRowActions>(
    () => ({ ...rowGestures, nudgingId }),
    [rowGestures, nudgingId],
  );

  return (
    <div ref={rootRef} className="space-y-4 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {tr("assignments")}
        </h1>
        <p className="text-sm text-slate-500">
          {assignments === undefined
            ? tr("chargement")
            : tr("livrable", { count: rows.length, count2: assignments.length })}
        </p>
      </header>

      {/* Barre d'outils COLLANTE. Sur une liste de plusieurs centaines de lignes
          — et plus encore sur un mois de calendrier — changer de filtre imposait
          de remonter jusqu'en haut de page. Elle colle au conteneur de
          défilement (<main>), pas à la fenêtre. */}
      <div
        ref={toolbarRef}
        className="sticky top-0 z-30 bg-slate-50/95 py-2 backdrop-blur supports-backdrop-filter:bg-slate-50/80"
      >
        <div className="flex flex-wrap items-end gap-2">
          {/* RECHERCHE — les autres filtres sont tous catégoriels : pour
              retrouver une ligne parmi 478 il fallait connaître d'avance sa
              créatrice ET sa campagne, puis parcourir à l'œil. Sur téléphone,
              où l'écran montre trois cartes, ça revient à ne pas pouvoir
              chercher. Pleine largeur sur téléphone (elle prend sa propre
              ligne), fixe à côté des filtres sur desktop. */}
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("creatriceCampagneCompte")}
              aria-label={tr("rechercherUneAssignation")}
              // La croix native de `type="search"` (WebKit) doublonnerait avec
              // la nôtre : deux croix côte à côte, dont une seule tombe sous le
              // pouce. On garde le type (clavier « rechercher » sur mobile) et
              // on masque la sienne.
              className="h-9 pl-8 pr-8 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {search.length > 0 && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label={tr("effacerLaRecherche")}
                className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>

          {/* Sous 768 px, cinq contrôles à largeur fixe s'empilent en cinq
              lignes : un écran entier de filtres avant la première donnée. Ils
              passent derrière un bouton unique, qui PORTE le compte de filtres
              actifs — sans quoi une liste restreinte se lit comme une liste
              vide. */}
          {compact ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-9 gap-1.5",
                activeFilterCount > 0 &&
                  "border-amber-300 bg-amber-50 text-amber-900",
              )}
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontalIcon className="size-3.5" />
              {tr("filtres")}
              {activeFilterCount > 0 && (
                <span className="inline-flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          ) : (
            <AssignmentsFilters
              layout="inline"
              viewMode={viewMode}
              creatorIds={creatorIds}
              onCreatorIdsChange={setCreatorIds}
              creatorOptions={creatorOptions}
              creatorFolded={creatorFolded}
              countryCodes={countryCodes}
              onCountryCodesChange={setCountryCodes}
              countryOptions={countryOptions}
              campaignIds={campaignIds}
              onCampaignIdsChange={changeCampaignIds}
              campaignOptions={filterCampaignOptions}
              campaignTriggerLabel={campaignTrigger}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              calStatusFilter={calStatusFilter}
              onCalStatusFilterChange={setCalStatusFilter}
              overdueOnly={overdueOnly}
              onOverdueOnlyChange={setOverdueOnly}
              activeFilterCount={activeFilterCount}
              onReset={resetFilters}
            />
          )}

          {/* Bascule Liste / Calendrier (mêmes filtres partagés). */}
          <div
            role="radiogroup"
            aria-label={tr("modeDAffichage")}
            className="ml-auto inline-flex rounded-md border border-slate-200 bg-white p-0.5"
          >
            {(
              [
                { value: "list", label: tr("liste"), Icon: ListIcon },
                { value: "calendar", label: tr("calendrier"), Icon: CalendarDaysIcon },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={viewMode === opt.value}
                onClick={() => changeViewMode(opt.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors sm:py-1",
                  viewMode === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <opt.Icon className="size-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Panneau de filtres (téléphone). Un seul des deux hôtes est monté à la
          fois : aucun libellé de filtre n'existe en double dans le DOM. */}
      {compact && (
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
            <SheetHeader className="p-0">
              <SheetTitle>{tr("filtres")}</SheetTitle>
            </SheetHeader>
            <AssignmentsFilters
              layout="stacked"
              viewMode={viewMode}
              creatorIds={creatorIds}
              onCreatorIdsChange={setCreatorIds}
              creatorOptions={creatorOptions}
              creatorFolded={creatorFolded}
              countryCodes={countryCodes}
              onCountryCodesChange={setCountryCodes}
              countryOptions={countryOptions}
              campaignIds={campaignIds}
              onCampaignIdsChange={changeCampaignIds}
              campaignOptions={filterCampaignOptions}
              campaignTriggerLabel={campaignTrigger}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              calStatusFilter={calStatusFilter}
              onCalStatusFilterChange={setCalStatusFilter}
              overdueOnly={overdueOnly}
              onOverdueOnlyChange={setOverdueOnly}
              activeFilterCount={activeFilterCount}
              onReset={resetFilters}
            />
            <Button
              type="button"
              className="w-full"
              onClick={() => setFiltersOpen(false)}
            >
              {tr("voirResultat", { count: rows.length })}
            </Button>
          </SheetContent>
        </Sheet>
      )}

      {assignments === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : viewMode === "calendar" ? (
        <AssignmentsCalendar
          rows={rows}
          now={nowMs}
          onOpen={(id) => setDetailId(id)}
          statusFilter={calStatusFilter}
        />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            {tr("aucunAssignment")}{assignments.length > 0 ? ` ${tr("pourCeFiltre")}` : ""}.
          </CardContent>
        </Card>
      ) : compact ? (
        <AssignmentMobileList
          rows={rows}
          now={nowMs}
          actions={rowActions}
          // Une recherche active DÉPLIE tout : on vient de restreindre la liste
          // à quelques lignes, les replier derrière un accordéon annulerait le
          // geste.
          expanded={terms.length > 0}
        />
      ) : (
        <Card
          ref={tableTopRef}
          className="scroll-mt-[var(--assignments-sticky-top)]"
        >
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                {/* Onze colonnes étaient devenues huit. « Soumis » a rejoint la
                    cellule Statut (c'est la date DU statut), et « Modèles /
                    Assets / Overlay » se sont regroupées sous « Brief » — quatre
                    gestes qui décrivent le même objet, la consigne envoyée à la
                    créatrice. */}
                <TableRow>
                  <TableHead>{tr("createur")}</TableHead>
                  <TableHead>{tr("mission")}</TableHead>
                  <TableHead>{tr("compte")}</TableHead>
                  <TableHead>{tr("echeance")}</TableHead>
                  <TableHead>{tr("post")}</TableHead>
                  <TableHead>{tr("statut")}</TableHead>
                  <TableHead>{tr("brief")}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{tr("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listView.items.map((a) => (
                  <AssignmentTableRow
                    key={a._id}
                    row={a}
                    gestures={rowGestures}
                    nudging={nudgingId === a._id}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
          {/* 787 lignes d'un bloc = ~70 000 nœuds : ~0,9 s pour afficher la
              liste, ~0,5 s pour y revenir après une recherche. Par pages de
              100, la recherche et les filtres portant toujours sur TOUTES
              les lignes (ils s'appliquent avant le découpage). */}
          <ListPager view={listView} onPage={goToPage} />
        </Card>
      )}

      {manageRow && (
        <AssignmentModelVideosDialog
          open
          onOpenChange={(o) => !o && setManageId(null)}
          assignmentId={manageRow._id}
          creatorName={manageRow.creatorName}
          modelVideos={manageRow.modelVideos ?? []}
        />
      )}

      {scriptRow?.hasAssembledScript && (
        <AssignmentScriptDialog
          open
          onOpenChange={(o) => !o && setScriptId(null)}
          assignmentId={scriptRow._id}
          comboSummary={scriptRow.comboSummary}
          creatorName={scriptRow.creatorName}
          platforms={scriptRow.targets.map((t) => t.platform)}
        />
      )}

      {editRow && editCombo && (
        <EditScriptComboDialog
          open
          onOpenChange={(o) => !o && setEditId(null)}
          assignmentId={editRow._id}
          campaignId={editCombo.campaignId}
          combo={{
            hookBrickId: editCombo.hookBrickId,
            fluxBrickId: editCombo.fluxBrickId,
            ctaBrickId: editCombo.ctaBrickId,
          }}
          creatorName={editRow.creatorName}
        />
      )}

      {textEditRow && textEditCombo && (
        <EditBrickTextDialog
          open
          onOpenChange={(o) => !o && setTextEditId(null)}
          assignmentId={textEditRow._id}
          campaignId={textEditCombo.campaignId}
          combo={{
            hookBrickId: textEditCombo.hookBrickId,
            fluxBrickId: textEditCombo.fluxBrickId,
            ctaBrickId: textEditCombo.ctaBrickId,
            notifBrickId: textEditCombo.notifBrickId,
          }}
          creatorName={textEditRow.creatorName}
        />
      )}

      {assetLinkRow && (
        <LinkAssetFolderDialog
          open
          onOpenChange={(o) => !o && setAssetLinkId(null)}
          assignmentId={assetLinkRow._id}
          currentFolderIds={assetLinkRow.linkedFolderIds}
          creatorName={assetLinkRow.creatorName}
        />
      )}

      {overlayRow && (
        <AssignmentOverlayDialog
          key={overlayRow._id}
          open
          onOpenChange={(o) => !o && setOverlayId(null)}
          assignmentId={overlayRow._id}
          creatorName={overlayRow.creatorName}
          currentOverlayText={overlayRow.overlayText}
        />
      )}

      {instructionsRow && (
        <AssignmentInstructionsDialog
          key={instructionsRow._id}
          open
          onOpenChange={(o) => !o && setInstructionsId(null)}
          assignmentId={instructionsRow._id}
          creatorName={instructionsRow.creatorName}
          currentInstructions={instructionsRow.instructions}
        />
      )}

      {postDateRow && (
        <AssignmentPostDateDialog
          key={postDateRow._id}
          open
          onOpenChange={(o) => !o && setPostDateId(null)}
          assignmentId={postDateRow._id}
          creatorName={postDateRow.creatorName}
          currentPostDate={postDateRow.postDate}
        />
      )}

      {detailRow && (
        <AssignmentDetailSheet
          key={detailRow._id}
          open
          onOpenChange={(o) => !o && setDetailId(null)}
          row={detailRow}
          now={nowMs}
        />
      )}

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("supprimerCetAssignment")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteHasVideo ? (
                <span className="font-medium text-amber-700" data-testid="delete-video-warning">
                  {tr("videoJointeConservee", { jours: DELETED_VIDEO_RETENTION_DAYS })}{" "}
                </span>
              ) : null}
              {deleteAbandoned
                ? tr("missionAbandonneeDisparaitra")
                : tr("leComboSeraLibereEt")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tr("annuler")}</AlertDialogCancel>
            {/* L'option SÛRE : la mission reste, et « Rétablir » la reprend. */}
            {deleteRow && canCancelAssignment(deleteRow.status as AssignmentStatus) && (
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => {
                  setAbandonId(deleteRow._id);
                  setDeleteId(null);
                }}
                data-testid="assignment-abandon-instead"
              >
                <BanIcon className="size-4" />
                {tr("abandonnerPlutot")}
              </Button>
            )}
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                // On gère la fermeture nous-mêmes (succès) pour afficher l'état
                // de chargement ; empêche la fermeture auto de l'AlertDialog.
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
            >
              {deleting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {tr("supprimer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AbandonMissionDialog
        target={
          abandonRow
            ? {
                _id: abandonRow._id,
                creatorName: abandonRow.creatorName,
                label: abandonRow.scriptCampaignName ?? abandonRow.formatName ?? "—",
                postDate: abandonRow.postDate,
                status: abandonRow.status,
                hasVideo: hasSubmittedVideo(abandonRow),
              }
            : null
        }
        onClose={() => setAbandonId(null)}
      />
    </div>
  );
}

type AssignmentListRow =
  FunctionReturnType<typeof api.assignments.listAssignmentsPilotage>[number];

type AssignmentTableRowProps = {
  row: AssignmentListRow;
  gestures: AssignmentRowGestures;
  /** Relance en cours sur CETTE ligne (le spinner du bouton). */
  nudging: boolean;
};

/**
 * UNE ligne du tableau desktop, MÉMOÏSÉE.
 *
 * La page tient une dizaine de modales et la recherche dans son état : chaque
 * geste la re-rend. Tant que les lignes étaient écrites en ligne dans la page,
 * ouvrir une modale reconstruisait les 787 lignes de Snytch (~70 000 nœuds) et
 * gelait l'écran ~500 ms. Mémoïsée, une ligne ne se re-rend que si SA donnée,
 * ses gestes ou sa relance changent.
 *
 * La donnée se compare au CONTENU (`sameContent`), pas à la référence : chaque
 * écriture qui touche la query (une vidéo modèle ajoutée, un relevé de compte)
 * renvoie TOUTE la liste en objets neufs, et la comparaison par référence
 * re-rendrait les 787 lignes pour une seule qui a bougé.
 *
 * Libellés : ceux de la page (`AssignmentsPageInner`), dont la ligne est sortie
 * telle quelle.
 */
const AssignmentTableRow = memo(function AssignmentTableRow({
  row: a,
  gestures,
  nudging,
}: AssignmentTableRowProps) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.assignments.AssignmentsPageInner");
  const tLabel = useLabel();
  const overdue =
    assignmentUrgency(a.dueDate, a.status as AssignmentStatus) ===
    "overdue";
  const st = ASSIGNMENT_STATUS[a.status as AssignmentStatus];
  const editable = canEditScriptCombo({ postedAt: a.postedAt });
  return (
    <TableRow className={cn(overdue && "bg-rose-50/60")}>
      <TableCell className="font-medium text-slate-900">
        {a.creatorName}
      </TableCell>
      <TableCell className="text-slate-700">
        {/* Largeurs BORNÉES : un nom de campagne ou un résumé de
            combo long poussait la moitié du tableau hors de
            l'écran, et les colonnes de droite (statut, brief,
            actions) ne se voyaient plus qu'au défilement
            horizontal. */}
        <div className="space-y-1.5">
          {a.origin === "script" ? (
            <div className="max-w-72 space-y-1">
              <div className="truncate font-medium text-slate-900">
                {a.scriptCampaignName}
              </div>
              {a.comboImposed && <ImposedComboBadge />}
              <div className="truncate text-xs text-slate-500">
                {a.comboSummary}
              </div>
              {a.hasAssembledScript && (
                <div className="flex flex-wrap items-center gap-1">
                  {/* Le seul geste de LECTURE reste en clair ;
                      « modifier le combo » et « éditer le texte »
                      sont partis dans le menu de ligne. Trois
                      boutons empilés par ligne, sur 480 lignes,
                      doublaient la hauteur du tableau pour des
                      gestes qu'on fait une fois sur cent. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs text-primary"
                    onClick={() => gestures.onScript(a._id)}
                  >
                    <FileTextIcon className="size-3.5" />
                    {tr("voirLeScript")}
                  </Button>
                  {!editable && (
                    // Publié → verrouillé (même règle que le
                    // panneau) : on l'explicite, pas d'absence muette.
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <LockIcon className="size-3 shrink-0" />
                      {tr("publieVerrouille")}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>{a.formatName}</div>
          )}
          {/* Assets + vidéos modèles rattachés — compact, visible
              seulement s'il y en a (mêmes données que le brief). */}
          <AssignmentAttachments
            variant="list"
            assetFolderNames={a.assetFolderNames}
            assetFolderCount={a.assetFolderCount}
            modelVideos={a.modelVideos ?? []}
          />
        </div>
      </TableCell>
      <TableCell className="text-sm text-slate-500">
        {a.targets.length === 0 ? (
          "—"
        ) : (
          <div className="space-y-0.5">
            {a.targets.map((t) => (
              <div
                key={t.platform}
                className="flex items-center gap-1.5"
              >
                <span className="text-xs text-slate-400">
                  {t.platform}
                </span>
                <span
                  className="max-w-44 truncate font-mono text-slate-600"
                  title={t.accountHandle ?? undefined}
                >
                  {t.accountHandle ?? "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm">
        <span className={cn(overdue && "font-semibold text-rose-700")}>
          {formatDate(a.dueDate, loc)}
        </span>
        {overdue && (
          <span className="ml-1 text-xs font-semibold text-rose-600">
            {tr("retard")}
          </span>
        )}
        {/* Relance, SOUS la date et non à côté : en ligne, ce
            bouton ajoutait ~90 px à la colonne pour TOUTES les
            lignes, y compris celles qui ne l'affichent pas.
            Uniquement sur les statuts où la balle est au
            créateur (cf nudgeAssignment côté serveur) :
            to_publish, géré par l'équipe, en est exclu. */}
        {overdue &&
          (a.status === "todo" ||
            a.status === "in_progress" ||
            a.status === "video_rejected") && (
            <Button
              variant="ghost"
              size="xs"
              className="mt-1 flex h-6 gap-1 px-1.5 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
              onClick={() => gestures.onNudge(a._id, a.creatorName)}
              disabled={nudging}
              data-testid={`nudge-${a._id}`}
            >
              {nudging ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <BellIcon className="size-3" />
              )}
              {tr("relancer")}
            </Button>
          )}
      </TableCell>
      <TableCell className="text-sm">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 gap-1.5 px-2",
            a.postDate ? "text-slate-700" : "text-slate-500",
          )}
          onClick={() => gestures.onPostDate(a._id)}
          aria-label={tr("modifierLaDateDePublication")}
        >
          <CalendarIcon className="size-4" />
          {a.postDate ? formatDate(a.postDate, loc) : "—"}
        </Button>
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
              st.className,
            )}
          >
            {tLabel(st.labelKey)}
          </span>
          {/* Ancienne colonne « Soumis » : c'est la DATE de ce
              statut, elle se lit collée à lui, pas six colonnes
              plus loin. */}
          {a.submittedAt && (
            <div className="text-xs text-slate-400">
              {tr("soumis", { date: formatDate(a.submittedAt, loc) })}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell>
        {/* BRIEF — les quatre gestes qui composent la consigne
            envoyée à la créatrice, groupés. Le compteur (ou le
            point) dit lesquels sont renseignés. */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-1.5 text-slate-600"
            onClick={() => gestures.onModelVideos(a._id)}
            aria-label={tr("gererLesVideosModeles")}
            title={tr("videosModeles")}
          >
            <ClapperboardIcon className="size-4" />
            {a.modelVideos && a.modelVideos.length > 0
              ? a.modelVideos.length
              : "+"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-1.5 text-slate-600"
            onClick={() => gestures.onAssets(a._id)}
            aria-label={tr("lierDesDossiersDAssets")}
            title={tr("dossiersDAssets")}
          >
            <ImagesIcon className="size-4" />
            {a.linkedFolderIds.length > 0
              ? a.assetFolderCount
              : "+"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 gap-1 px-1.5",
              a.overlayText ? "text-amber-700" : "text-slate-600",
            )}
            onClick={() => gestures.onOverlay(a._id)}
            aria-label={tr("texteAIncrusterEnHaut")}
            title={a.overlayText ?? tr("ajouterUnTexteOverlay")}
          >
            <TypeIcon className="size-4" />
            {a.overlayText ? "•" : "+"}
          </Button>
          {/* Instructions libres pour la créatrice (consigne). */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 gap-1 px-1.5",
              a.instructions ? "text-indigo-700" : "text-slate-600",
            )}
            onClick={() => gestures.onInstructions(a._id)}
            aria-label={tr("instructionsPourLaCreatrice")}
            title={a.instructions ?? tr("ajouterDesInstructions")}
          >
            <ClipboardListIcon className="size-4" />
            {a.instructions ? "•" : "+"}
          </Button>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          {/* Même menu que la carte mobile — les gestes rares
              (détail, combo, texte) y vivent une seule fois. */}
          <AssignmentRowMenu
            row={a}
            actions={gestures}
            editable={editable}
            hasScript={a.hasAssembledScript}
            variant="row"
          />
          {/* Abandonner (la ligne reste) ou Rétablir — à côté de la corbeille. */}
          {canCancelAssignment(a.status as AssignmentStatus) ? (
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 text-slate-400 hover:text-amber-700"
              onClick={() => gestures.onCancel(a._id)}
              aria-label={tr("abandonnerCetteMission")}
              title={tr("abandonnerCetteMission")}
            >
              <BanIcon className="size-4" />
            </Button>
          ) : a.status === "cancelled" ? (
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 text-slate-400 hover:text-primary"
              onClick={() => gestures.onRestore(a._id)}
              aria-label={tr("retablirCetteMission")}
              title={tr("retablirCetteMission")}
            >
              <RotateCcwIcon className="size-4" />
            </Button>
          ) : null}
          {canDeleteAssignment(a.status as AssignmentStatus) ? (
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 text-slate-400 hover:text-rose-600"
              onClick={() => gestures.onDelete(a._id)}
              aria-label={tr("supprimerCetAssignment2")}
            >
              <Trash2Icon className="size-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 text-slate-300"
              disabled
              aria-label={tr("suppressionIndisponibleAssignmentPublieO")}
              title={tr("unAssignmentPublieOuPaye")}
            >
              <Trash2Icon className="size-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}, sameRowProps);

function sameRowProps(
  prev: AssignmentTableRowProps,
  next: AssignmentTableRowProps,
): boolean {
  return (
    prev.gestures === next.gestures &&
    prev.nudging === next.nudging &&
    sameContent(prev.row, next.row)
  );
}
