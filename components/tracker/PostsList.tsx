"use client";

import type { Id } from "@/convex/_generated/dataModel";
import {
  collectAvailabilityLabel,
  showsMetric,
  type CollectAvailability,
} from "@/convex/collectAvailability";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlatformBadge } from "@/components/VerdictBadge";
import { PostWarmupBadge } from "@/components/PostWarmupBadge";
import { formatNumber, formatPercent, formatDate } from "@/lib/format";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import { engagementRate } from "@/lib/tracker-data";
import type {
  QuadrantQualification,
  QuadrantSnapshot,
} from "@/convex/quadrant";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ExternalLinkIcon,
} from "lucide-react";

/**
 * Table PRÉSENTATIONNELLE des posts publiés (vues/likes/comments/engagement +
 * lien). Extraite de TrackerDataView pour être partagée : le tracker dashboard
 * l'utilise sur ses posts en latest ; le drill-down analytics scripts l'utilise
 * sur les posts d'une variable à la fenêtre J+X. Composant pur (posts + tri
 * fournis par le parent) — l'engagement est dérivé au rendu via engagementRate.
 */
export type TrackerPost = {
  _id: Id<"publications">;
  carouselId: string;
  label: string;
  plateforme: "TikTok" | "Instagram" | "YouTube";
  mediaType: FormatKey;
  compte: string;
  creatorId: Id<"creators"> | null;
  creatorName: string | null;
  formatId: Id<"formats"> | null;
  formatName: string | null;
  /** Campagne d'origine (nom INTERNE — écran admin). Optionnels : seul
   *  listTrackerPosts les renseigne ; les autres producteurs de TrackerPost
   *  (drill-down scripts) ne les fournissent pas. */
  campaignId?: string | null;
  campaignName?: string | null;
  /** Famille d'angle du HOOK du combo (chaîne libre, cf convex/angleFamily).
   *  Même optionalité que la campagne : seul listTrackerPosts la renseigne.
   *  null = pas de combo, hook supprimé, ou famille non renseignée. */
  angleFamily?: string | null;
  datePubli: number;
  postUrl: string | null;
  vues: number;
  likes: number;
  comments: number;
  /** Flag warmup (PR #119) — post exclu de la paie. Optionnel : seul le
   *  producteur listTrackerPosts (dashboard) le renseigne ; le drill-down
   *  scripts (postsForBrick) l'omet → pas de pastille là-bas. */
  isWarmup?: boolean;
  /** Saves du dernier relevé. `null` = NON COLLECTÉ (jamais « 0 save ») :
   *  Instagram/YouTube n'exposent pas la métrique et les posts antérieurs à sa
   *  collecte n'en portent pas. Même optionalité que la campagne : seul
   *  listTrackerPosts la renseigne. */
  saves?: number | null;
  /** Pourquoi les saves manquent, quand elles manquent (cf savesAvailability). */
  savesAvailability?: "measured" | "collecting" | "unavailable";
  /**
   * STATUT DE COLLECTE des vues/likes/commentaires (cf collectAvailability).
   *
   * Absent = producteur qui ne le renseigne pas (drill-down scripts) : on
   * retombe alors sur l'ancien comportement, les chiffres s'affichent tels
   * quels. Seul `listTrackerPosts` le fournit.
   */
  collect?: {
    availability: CollectAvailability;
    reason: string | null;
    failureStreak: number;
  };
  /** Qualification éditoriale TRI-ÉTAT (warmup / promo / jamais qualifié).
   *  Distincte d'`isWarmup` ci-dessus, qui est un booléen et confond donc
   *  « promo » et « non qualifié ». Seul listTrackerPosts la renseigne. */
  qualification?: QuadrantQualification;
  /** Classement « Vues × Intent » écrit par le relevé nocturne. `null`/absent =
   *  jamais recalculé — c'est une ignorance, pas un post sous les seuils. */
  quadrant?: QuadrantSnapshot | null;
};


/**
 * Affiche un chiffre, ou un TIRET quand il n'y a pas de mesure derrière.
 *
 * C'est le point unique où l'écran refuse de peindre « 0 » sur une ignorance.
 * Sept publications Snytch cumulant 78 476 vues réelles se sont affichées
 * « 0 vue » pendant des semaines faute de cette distinction. Le motif exact
 * (« visible par son autrice uniquement », « HTTP 429 »…) est porté par
 * l'attribut `title`, donc au survol, sans alourdir le tableau.
 *
 * Sans `collect` (producteurs qui ne le renseignent pas), le comportement est
 * EXACTEMENT l'ancien : on affiche l'enfant.
 */
function Mesure({
  post,
  children,
}: {
  post: TrackerPost;
  children: React.ReactNode;
}) {
  const c = post.collect;
  if (c === undefined || showsMetric(c.availability)) return <>{children}</>;
  const label = collectAvailabilityLabel(c.availability, c.reason ?? undefined);
  return (
    <span className="text-muted-foreground" title={label ?? undefined}>
      —
    </span>
  );
}

export type SortKey = "vues" | "date" | "likes" | "engagement";
export type SortDir = "asc" | "desc";

function sortValue(p: TrackerPost, key: SortKey): number | null {
  switch (key) {
    case "vues":
      return p.vues;
    case "date":
      return p.datePubli;
    case "likes":
      return p.likes;
    case "engagement":
      return engagementRate(p.likes, p.comments, p.vues);
  }
}

/**
 * Tri stable partagé (tracker + drill-down). Nulls (engagement sans vues)
 * TOUJOURS en fin ; tiebreak = plus récent d'abord. Ne mute pas l'entrée.
 */
export function sortTrackerPosts(
  posts: readonly TrackerPost[],
  sortKey: SortKey,
  sortDir: SortDir,
): TrackerPost[] {
  const list = [...posts];
  list.sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    let cmp: number;
    if (va === null && vb === null) cmp = 0;
    else if (va === null) cmp = 1;
    else if (vb === null) cmp = -1;
    else cmp = va - vb;
    const directional = sortDir === "asc" ? cmp : -cmp;
    if (directional !== 0) return directional;
    return b.datePubli - a.datePubli; // tiebreak: plus récent d'abord
  });
  return list;
}

export function PostsList({
  posts,
  sortKey,
  sortDir,
  onToggleSort,
  onRowClick,
}: {
  posts: TrackerPost[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (k: SortKey) => void;
  /** Optionnel — rend chaque ligne cliquable (ouvre le détail du post).
   *  Fourni par le dashboard tracker pour atteindre le toggle warmup ;
   *  omis par le drill-down analytics scripts (lignes non cliquables). */
  onRowClick?: (id: Id<"publications">) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              active={sortKey === "date"}
              dir={sortDir}
              onClick={() => onToggleSort("date")}
            >
              Post
            </SortableHead>
            <SortableHead
              active={sortKey === "vues"}
              dir={sortDir}
              onClick={() => onToggleSort("vues")}
              className="text-right"
            >
              Vues
            </SortableHead>
            <SortableHead
              active={sortKey === "likes"}
              dir={sortDir}
              onClick={() => onToggleSort("likes")}
              className="text-right"
            >
              Likes
            </SortableHead>
            <TableHead className="text-right">Comm.</TableHead>
            <SortableHead
              active={sortKey === "engagement"}
              dir={sortDir}
              onClick={() => onToggleSort("engagement")}
              className="text-right"
            >
              Engagement
            </SortableHead>
            <TableHead className="w-10 text-center">Lien</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.map((p) => {
            const eng = engagementRate(p.likes, p.comments, p.vues);
            const clickable = onRowClick !== undefined;
            return (
              <TableRow
                key={p._id}
                className={clickable ? "cursor-pointer" : undefined}
                onClick={clickable ? () => onRowClick(p._id) : undefined}
              >
                <TableCell className="max-w-[420px]">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="truncate text-sm font-medium text-slate-900"
                      title={p.label}
                    >
                      {p.label || (
                        <span className="text-slate-400">(sans titre)</span>
                      )}
                    </div>
                    {p.isWarmup === true && (
                      <PostWarmupBadge className="shrink-0" />
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                    <PlatformBadge plateforme={p.plateforme} />
                    <span>{p.creatorName ?? "Sans créateur"}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {p.formatName ?? FORMAT_CONFIGS[p.mediaType].singular}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">
                      {formatDate(p.datePubli)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Mesure post={p}>{formatNumber(p.vues)}</Mesure>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Mesure post={p}>{formatNumber(p.likes)}</Mesure>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Mesure post={p}>{formatNumber(p.comments)}</Mesure>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Mesure post={p}>{formatPercent(eng, 2)}</Mesure>
                </TableCell>
                <TableCell className="text-center">
                  {p.postUrl ? (
                    <a
                      href={p.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      // Le lien externe ne doit pas déclencher l'ouverture du
                      // détail quand la ligne est cliquable (dashboard).
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex text-slate-400 hover:text-primary"
                      aria-label={`Ouvrir le post ${p.carouselId} sur ${p.plateforme}`}
                      title="Ouvrir le post"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  children,
  active,
  dir,
  onClick,
  className,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-slate-900"
      >
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUpIcon className="size-3" />
          ) : (
            <ArrowDownIcon className="size-3" />
          )
        ) : (
          <ArrowUpDownIcon className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}
