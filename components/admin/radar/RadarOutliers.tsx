"use client";

import { useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import {
  useProjectAction,
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  BookmarkCheckIcon,
  BookmarkPlusIcon,
  CalendarIcon,
  ExternalLinkIcon,
  EyeIcon,
  FlameIcon,
  Loader2Icon,
  PlayIcon,
  RepeatIcon,
  SearchIcon,
  UserCheckIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { convexErrorMessage } from "@/lib/convex-error";
import { tiktokCanonicalVideoUrl, tiktokPlayerEmbedUrl } from "@/lib/embed";
import { applyFollowerFloor } from "@/lib/radarParsing";
import {
  formatCount,
  formatOutlierRatio,
  formatPublished,
  formatRelative,
} from "./radar-format";

/**
 * RADAR Brique 3 — RECHERCHE D'OUTLIERS. L'admin tape un mot-clé : on récupère un
 * lot de vidéos TikTok US (via l'action cache-aware searchOutliers), scorées par
 * surperformance relative (vues/abonnés) côté serveur. L'UI met en avant les
 * COMPTES RÉCURRENTS (≥ 2 vidéos outlier = format validé), puis liste les vidéos
 * triées par ratio décroissant. Lecture TikTok en place (iframe player officiel).
 * Admin only (l'action/query sont gardées serveur).
 */
type SearchResult = NonNullable<
  FunctionReturnType<typeof api.radar.getRadarSearch>
>;
type SearchVideo = SearchResult["videos"][number];

/** Provenance du dernier résultat affiché (pour l'indicateur de cache). */
type Origin = { cached: boolean; fetchedAt: number | null } | null;

export function RadarOutliers() {
  const [input, setInput] = useState("");
  const [floorInput, setFloorInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [origin, setOrigin] = useState<Origin>(null);
  const [active, setActive] = useState<SearchVideo | null>(null);

  // Plancher d'abonnés — pur filtre d'AFFICHAGE sur le lot caché (jamais un
  // paramètre Apify : l'ajuster ne consomme aucun quota). 0/invalide = pas de
  // filtre. Voir applyFollowerFloor (recalcule aussi la récurrence).
  const minFollowers = useMemo(() => {
    const n = Number.parseInt(floorInput, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [floorInput]);

  const search = useProjectAction(api.radar.searchOutliers);
  const result = useProjectQuery(
    api.radar.getRadarSearch,
    submitted ? { keyword: submitted } : "skip",
  );

  // États "déjà suivi" / "déjà ajouté" pour les actions de chaque carte. On
  // ne souscrit qu'une fois une recherche lancée (skip sinon) : inutile de
  // charger comptes + inspirations tant qu'aucun résultat n'est affiché.
  const radarAccounts = useProjectQuery(
    api.radar.listRadarAccounts,
    submitted ? {} : "skip",
  );
  const inspirations = useProjectQuery(
    api.inspirations.listInspirations,
    submitted ? {} : "skip",
  );
  const followedHandles = useMemo(
    () => new Set((radarAccounts?.accounts ?? []).map((a) => a.handle)),
    [radarAccounts],
  );
  const savedUrls = useMemo(
    () => new Set((inspirations ?? []).map((i) => i.url)),
    [inspirations],
  );

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const keyword = input.trim();
    if (keyword === "" || loading) return;
    setLoading(true);
    try {
      const r = await search({ keyword });
      if (!r.ok) {
        toast.error("Recherche impossible (quota Apify ou acteur indisponible).");
        return;
      }
      setSubmitted(keyword.toLowerCase().replace(/\s+/g, " "));
      setOrigin({ cached: r.cached, fetchedAt: r.fetchedAt });
      if (r.cached) {
        toast.info("Résultats servis depuis le cache — aucun appel consommé.");
      }
    } catch (err) {
      toast.error(convexErrorMessage(err, "Recherche impossible."));
    } finally {
      setLoading(false);
    }
  }

  // Lot affiché = cache filtré par le plancher (récurrence recalculée dessus).
  const displayedVideos = useMemo(
    () => (result?.videos ? applyFollowerFloor(result.videos, minFollowers) : undefined),
    [result, minFollowers],
  );
  const recurringAccounts = useMemo(
    () => (displayedVideos ? groupRecurringAccounts(displayedVideos) : []),
    [displayedVideos],
  );

  const waitingForResult = submitted !== null && result === undefined;
  const showSkeleton = loading || waitingForResult;

  return (
    <div className="space-y-5">
      <form onSubmit={runSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Mot-clé (ex. make money online)"
            className="pl-9"
            aria-label="Mot-clé de recherche d'outliers"
            disabled={loading}
            maxLength={100}
          />
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="radar-floor"
            className="whitespace-nowrap text-xs text-slate-500"
          >
            Abonnés min
          </label>
          <Input
            id="radar-floor"
            type="number"
            min={0}
            inputMode="numeric"
            value={floorInput}
            onChange={(e) => setFloorInput(e.target.value)}
            placeholder="0"
            className="w-24"
            aria-label="Plancher d'abonnés (filtre d'affichage)"
          />
        </div>
        <Button type="submit" disabled={loading || input.trim() === ""} className="gap-1.5">
          <SearchIcon className={cn("size-4", loading && "animate-pulse")} />
          {loading ? "Recherche…" : "Rechercher"}
        </Button>
      </form>

      <p className="text-xs text-slate-400">
        TikTok 🇺🇸 · 3 derniers mois · les comptes qui pètent ≥ 2 fois sont des
        formats validés. Recherche mise en cache 24 h. Le plancher « abonnés min »
        filtre l&apos;affichage (gratuit, aucun appel).
      </p>

      {showSkeleton ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : submitted === null ? (
        <EmptyState
          icon={SearchIcon}
          title="Recherche d'outliers"
          text="Tape un mot-clé pour repérer les vidéos qui surperforment et les comptes qui valident un format."
        />
      ) : result == null || result.videos.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="Aucun outlier"
          text="Aucune vidéo anglophone exploitable pour ce mot-clé. Essaie une autre formulation."
        />
      ) : (displayedVideos ?? []).length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="Plancher trop haut"
          text={`Aucune vidéo de compte ≥ ${formatCount(minFollowers)} abonnés. Baisse le plancher « abonnés min » pour réafficher le lot.`}
        />
      ) : (
        <div className="space-y-5">
          <CacheBanner
            origin={origin}
            result={result}
            count={(displayedVideos ?? []).length}
          />

          {recurringAccounts.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <RepeatIcon className="size-4 text-emerald-600" />
                Comptes récurrents
                <span className="text-xs font-normal text-slate-400">
                  ({recurringAccounts.length})
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Ces comptes ont fait ≥ 2 vidéos outlier sur ce mot-clé — formats à
                disséquer en priorité.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {recurringAccounts.map((a) => (
                  <RecurringAccountCard key={a.authorId} account={a} />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <FlameIcon className="size-4 text-slate-500" />
              Vidéos par surperformance
              <span className="text-xs font-normal text-slate-400">
                ({(displayedVideos ?? []).length})
              </span>
            </h3>
            <ul className="space-y-2">
              {(displayedVideos ?? []).map((v) => (
                <OutlierRow
                  key={v.tiktokId}
                  video={v}
                  onPlay={() => setActive(v)}
                  followedHandles={followedHandles}
                  savedUrls={savedUrls}
                />
              ))}
            </ul>
          </section>
        </div>
      )}

      <EmbedDialog video={active} onClose={() => setActive(null)} />
    </div>
  );
}

// ─── Indicateur de cache ─────────────────────────────────────────────────────

function CacheBanner({
  origin,
  result,
  count,
}: {
  origin: Origin;
  result: SearchResult;
  count: number;
}) {
  const cached = origin?.cached ?? false;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs",
        cached
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      <span className="font-medium">
        {count} vidéo{count > 1 ? "s" : ""} · {result.totalFetched} récupérée
        {result.totalFetched > 1 ? "s" : ""} brutes
      </span>
      <span className="text-slate-400">·</span>
      {cached ? (
        <span>
          Résultats en cache ({formatRelative(result.fetchedAt)}) — aucun appel
          Apify consommé.
        </span>
      ) : (
        <span>Résultats frais ({formatRelative(result.fetchedAt)}).</span>
      )}
    </div>
  );
}

// ─── Comptes récurrents (groupage client) ────────────────────────────────────

interface RecurringAccount {
  authorId: string;
  handle: string | null;
  fans: number | null;
  outlierCount: number;
  bestRatio: number;
  videoCount: number;
}

/** Regroupe les vidéos récurrentes par compte (authorId), trié par best ratio. */
function groupRecurringAccounts(videos: readonly SearchVideo[]): RecurringAccount[] {
  const byId = new Map<string, RecurringAccount>();
  for (const v of videos) {
    if (!v.isRecurringAccount || v.authorId === null) continue;
    const cur = byId.get(v.authorId);
    if (cur === undefined) {
      byId.set(v.authorId, {
        authorId: v.authorId,
        handle: v.authorHandle,
        fans: v.fans,
        outlierCount: v.accountOutlierCount,
        bestRatio: v.outlierRatio,
        videoCount: 1,
      });
    } else {
      cur.videoCount += 1;
      cur.bestRatio = Math.max(cur.bestRatio, v.outlierRatio);
    }
  }
  return [...byId.values()].sort((a, b) => b.bestRatio - a.bestRatio);
}

function RecurringAccountCard({ account }: { account: RecurringAccount }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <RepeatIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={`https://www.tiktok.com/@${account.handle ?? ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-semibold text-slate-900 hover:underline"
        >
          @{account.handle ?? "compte"}
        </a>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span className="font-medium text-emerald-700">
            {account.outlierCount} vidéos outlier
          </span>
          {account.fans != null && <span>{formatCount(account.fans)} abonnés</span>}
        </p>
      </div>
      <span className="shrink-0 rounded-md bg-emerald-600 px-2 py-1 text-sm font-bold tabular-nums text-white">
        {formatOutlierRatio(account.bestRatio)}
      </span>
    </div>
  );
}

// ─── Ligne vidéo ─────────────────────────────────────────────────────────────

/** Normalise un handle TikTok pour comparaison (sans @, minuscules), ou null. */
function normalizeHandle(handle: string | null): string | null {
  if (handle === null) return null;
  const h = handle.trim().replace(/^@+/, "").toLowerCase();
  return h.length > 0 ? h : null;
}

function OutlierRow({
  video,
  onPlay,
  followedHandles,
  savedUrls,
}: {
  video: SearchVideo;
  onPlay: () => void;
  followedHandles: ReadonlySet<string>;
  savedUrls: ReadonlySet<string>;
}) {
  const link = video.authorHandle
    ? tiktokCanonicalVideoUrl(video.authorHandle, video.tiktokId)
    : video.url;
  const handle = normalizeHandle(video.authorHandle);

  const addAccount = useProjectMutation(api.radar.addRadarAccount);
  const createInspiration = useProjectMutation(api.inspirations.createInspiration);

  // Vérité réactive (les queries reflètent l'ajout) + flag local optimiste pour
  // un retour immédiat avant le rafraîchissement de la souscription.
  const [justFollowed, setJustFollowed] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [following, setFollowing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inspoOpen, setInspoOpen] = useState(false);
  const [titre, setTitre] = useState("");
  const [note, setNote] = useState("");

  const followed = justFollowed || (handle !== null && followedHandles.has(handle));
  const saved = justSaved || savedUrls.has(link);

  async function handleFollow() {
    if (handle === null || followed || following) return;
    setFollowing(true);
    try {
      await addAccount({ input: handle });
      setJustFollowed(true);
      toast.success(`@${handle} ajouté au suivi Radar`);
    } catch (err) {
      toast.error(convexErrorMessage(err, "Ajout au suivi impossible."));
    } finally {
      setFollowing(false);
    }
  }

  async function handleSaveInspiration() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await createInspiration({
        url: link,
        type: "video",
        plateforme: "TikTok",
        titre: titre.trim() || undefined,
        notes: note.trim() || undefined,
        stats: {
          views: video.views,
          followers: video.fans ?? undefined,
          outlierRatio: video.outlierRatio,
          authorHandle: video.authorHandle ?? undefined,
          capturedAt: Date.now(),
        },
      });
      setJustSaved(true);
      setInspoOpen(false);
      toast.success("Vidéo ajoutée aux inspirations");
    } catch (err) {
      toast.error(convexErrorMessage(err, "Ajout en inspiration impossible."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      className={cn(
        "flex items-stretch gap-3 rounded-lg border bg-white p-2 shadow-sm",
        video.isRecurringAccount ? "border-emerald-300" : "border-slate-200",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Lire la vidéo de @${video.authorHandle ?? ""}`}
        className="relative block aspect-[9/16] h-28 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-900"
      >
        <Thumb url={video.coverUrl} alt={video.caption ?? "Vidéo TikTok"} />
        <span className="absolute inset-0 flex items-center justify-center">
          <PlayIcon className="size-6 text-white/90 drop-shadow" />
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 py-0.5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-sm font-bold tabular-nums text-white">
              {formatOutlierRatio(video.outlierRatio)}
            </span>
            {video.isRecurringAccount && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <RepeatIcon className="size-3" />
                COMPTE RÉCURRENT · {video.accountOutlierCount}
              </span>
            )}
          </div>
          {video.caption && (
            <p className="line-clamp-2 text-sm text-slate-700">{video.caption}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
          <span className="truncate font-medium text-slate-700">
            @{video.authorHandle ?? "?"}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <EyeIcon className="size-3.5 text-slate-400" />
            {formatCount(video.views)}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <UsersIcon className="size-3.5 text-slate-400" />
            {video.fans != null ? formatCount(video.fans) : "—"}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarIcon className="size-3 text-slate-400" />
            {formatPublished(video.publishedAt)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 self-start">
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ouvrir sur TikTok"
          className="flex items-center justify-center p-1.5 text-slate-400 hover:text-slate-700"
        >
          <ExternalLinkIcon className="size-4" />
        </a>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            handle === null
              ? "Compte inconnu"
              : followed
                ? `@${handle} déjà suivi`
                : `Suivre @${handle}`
          }
          title={
            handle === null
              ? "Handle indisponible"
              : followed
                ? "Compte déjà suivi"
                : "Suivre ce compte"
          }
          onClick={handleFollow}
          disabled={handle === null || followed || following}
          className={cn(followed && "text-emerald-600")}
        >
          {following ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : followed ? (
            <UserCheckIcon className="size-4" />
          ) : (
            <UserPlusIcon className="size-4" />
          )}
        </Button>

        {saved ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Déjà en inspiration"
            title="Déjà en inspiration"
            disabled
            className="text-emerald-600"
          >
            <BookmarkCheckIcon className="size-4" />
          </Button>
        ) : (
          <Popover open={inspoOpen} onOpenChange={setInspoOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Ajouter en inspiration"
                  title="Ajouter en inspiration"
                >
                  <BookmarkPlusIcon className="size-4" />
                </Button>
              }
            />
            <PopoverContent align="end" className="w-72 space-y-2 p-3">
              <p className="text-sm font-semibold text-slate-900">
                Ajouter en inspiration
              </p>
              <Input
                autoFocus
                placeholder="Titre / étiquette (optionnel)"
                value={titre}
                maxLength={120}
                onChange={(e) => setTitre(e.target.value)}
              />
              <Textarea
                placeholder="Note perso (optionnelle)"
                value={note}
                maxLength={2000}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                size="sm"
                className="w-full"
                onClick={handleSaveInspiration}
                disabled={saving}
              >
                {saving && <Loader2Icon className="size-4 animate-spin" />}
                Enregistrer
              </Button>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </li>
  );
}

// ─── Miniature (repli propre si l'image manque/expire) ───────────────────────

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={() => setBroken(true)}
        className="size-full object-cover"
      />
    );
  }
  return (
    <div className="flex size-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-300">
      <PlayIcon className="size-6" />
    </div>
  );
}

// ─── Empty / embed ───────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof SearchIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
      <Icon className="size-12 text-slate-300" strokeWidth={1.5} />
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-slate-500">{text}</p>
      </div>
    </div>
  );
}

/** Lecture EN PLACE via l'iframe du lecteur TikTok officiel (cf RadarVideoGrid). */
function EmbedDialog({
  video,
  onClose,
}: {
  video: SearchVideo | null;
  onClose: () => void;
}) {
  const canonicalUrl =
    video === null
      ? ""
      : video.authorHandle
        ? tiktokCanonicalVideoUrl(video.authorHandle, video.tiktokId)
        : video.url;

  return (
    <Dialog open={video !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {video && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate">@{video.authorHandle}</DialogTitle>
              {video.caption && (
                <DialogDescription className="line-clamp-2">
                  {video.caption}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-lg border border-slate-200 bg-black">
              <iframe
                key={video.tiktokId}
                src={tiktokPlayerEmbedUrl(video.tiktokId)}
                title={video.caption ?? "Vidéo TikTok"}
                className="aspect-[9/16] w-full"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                data-testid="radar-tiktok-player"
              />
            </div>
            <div className="space-y-1 text-center">
              <a
                href={canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                <ExternalLinkIcon className="size-4" />
                Ouvrir sur TikTok
              </a>
              <p className="text-xs text-slate-400">
                Si la vidéo ne se lance pas (privée ou restreinte), ouvre-la sur
                TikTok.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
