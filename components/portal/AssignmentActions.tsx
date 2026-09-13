"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { celebrate } from "@/lib/celebrate";
import { haptic } from "@/lib/haptics";
import { suggestedPostUrl } from "@/lib/clipboard-post-url";
import { estimateMissionEarnings } from "@/lib/pricing-engine";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VideoUploader, type UploadedVideo } from "@/components/VideoUploader";
import { VideoExample } from "@/components/formats/VideoExample";
import { StreamPlayer } from "@/components/formats/StreamPlayer";
import {
  Loader2Icon,
  PlayIcon,
  UploadIcon,
  SendIcon,
  ClockIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  UsersIcon,
  ClipboardPasteIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useConvexError } from "@/lib/use-convex-error";
import { detectInspirationType } from "@/lib/inspiration-url";
import { publishUrlIssue, type PostUrlPlatform } from "@/convex/postUrlShape";
import { useTranslations } from "next-intl";

/**
 * Workflow EN DEUX TEMPS côté créateur :
 *   todo → « Je commence » → in_progress
 *   → « Soumettre ma vidéo » (upload MP4 modal) → video_submitted (en revue)
 *   → [refus] video_rejected (feedback) → re-upload → video_submitted
 *   → [validée] to_publish → publie sur CHAQUE plateforme + colle les URLs → published.
 * Le PAIEMENT se déclenche à `published` (confirmPublication), 1 base PAR POST.
 */

type Platform = "TikTok" | "Instagram" | "YouTube";
type Target = {
  platform: Platform;
  accountHandle: string | null;
  publishedUrl: string | null;
  publishedAt: number | null;
};

/** Bouton d'action TACTILE : pleine largeur + 44px sur mobile, normal en desktop. */
const ACTION_BTN = "h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm";

function placeholderFor(p: Platform): string {
  if (p === "TikTok") return "https://www.tiktok.com/@toi/video/…";
  if (p === "YouTube") return "https://www.youtube.com/watch?v=…";
  return "https://www.instagram.com/p/…";
}

export function AssignmentActions({
  assignment,
  targets,
  projectId,
  submittedVideoUrl,
  submittedVideoMimeType,
  readOnly = false,
  missionName,
}: {
  assignment: Doc<"assignments">;
  targets: Target[];
  projectId: Id<"projects">;
  submittedVideoUrl?: string | null;
  submittedVideoMimeType?: string | null;
  /** Admin view-as : aucune action ; l'état du workflow est rendu en lecture. */
  readOnly?: boolean;
  /** Nom de la mission, repris par la célébration de publication. */
  missionName?: string;
}) {
  const showError = useConvexError();
  const t = useTranslations("portal");
  // Alias STABLE : les `.map((t) => …)` de ce fichier nomment leur cible `t` et
  // masquent le hook à l'intérieur. Renommer le paramètre toucherait beaucoup
  // plus de lignes qu'un alias, pour le même résultat.
  const tr = t;
  const start = useMutation(api.assignments.startAssignment);
  const submitVideo = useMutation(api.assignments.submitVideo);
  const confirmPublication = useMutation(api.assignments.confirmPublication);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Lien de publication trouvé dans le presse-papiers, par plateforme.
  const [clipSuggest, setClipSuggest] = useState<Record<string, string>>({});

  // « C'EST CE LIEN ? » — au retour sur l'écran (elle revient de TikTok), on
  // regarde le presse-papiers et on propose le lien qui s'y trouve.
  //
  // ⚠️ SEULEMENT SI LA LECTURE EST DÉJÀ AUTORISÉE. Lire sans permission ferait
  // surgir une demande du navigateur à chaque retour sur l'onglet — une
  // interruption, pas une aide. La première autorisation se donne en touchant
  // « Coller » (un geste explicite) ; ensuite, la suggestion arrive seule.
  useEffect(() => {
    if (assignment.status !== "to_publish" || readOnly || assignment.managedByAdmin) return;
    let alive = true;
    async function probe() {
      try {
        const perm = await navigator.permissions?.query({
          name: "clipboard-read" as PermissionName,
        });
        if (!perm || perm.state !== "granted") return;
        const text = await navigator.clipboard.readText();
        if (!alive) return;
        const next: Record<string, string> = {};
        for (const target of targets) {
          const found = suggestedPostUrl(text, target.platform);
          if (found) next[target.platform] = found;
        }
        setClipSuggest(next);
      } catch {
        /* navigateur sans API de permission, ou lecture refusée : pas de suggestion */
      }
    }
    void probe();
    const onBack = () => {
      if (document.visibilityState === "visible") void probe();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [assignment.status, assignment.managedByAdmin, readOnly, targets]);

  /** « Coller » : le geste qui autorise la lecture, et remplit le champ. */
  async function pasteInto(platform: Platform) {
    try {
      const text = await navigator.clipboard.readText();
      // Lien reconnu → on le garde propre ; sinon le texte brut, que la
      // vérification du champ commentera (profil, mauvaise plateforme).
      const value = suggestedPostUrl(text, platform) ?? text.trim();
      setUrls((prev) => ({ ...prev, [platform]: value }));
      haptic("tap");
    } catch {
      /* lecture refusée : le champ reste modifiable à la main */
    }
  }

  const s = assignment.status;
  // Compte GÉRÉ par l'équipe : la créatrice ne soumet ni ne publie rien (l'admin
  // le fait). Rendu en LECTURE seule + marqueur, quel que soit readOnly.
  const managed = assignment.managedByAdmin === true;

  async function handleStart() {
    setBusy(true);
    try {
      await start({ projectId, id: assignment._id });
      toast.success(t("assignment.started"));
    } catch (e) {
      toast.error(showError(e, t("assignment.startFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function handleUploaded(v: UploadedVideo) {
    setBusy(true);
    try {
      await submitVideo({
        projectId,
        id: assignment._id,
        storageId: v.storageId,
        mimeType: v.mimeType,
      });
      setUploadOpen(false);
      toast.success(t("assignment.videoSent"));
    } catch (e) {
      toast.error(showError(e, t("assignment.videoSendFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    // Garde client : on ne refuse QUE ce qui est prouvé faux — mauvaise
    // plateforme, ou lien de profil. Un format d'URL non reconnu PASSE : c'est
    // au serveur de trancher, et il est permissif. L'inverse — une liste
    // blanche de formats côté client — a bloqué des créatrices pendant des
    // semaines sur des liens parfaitement valides (cf convex/postUrlShape.ts).
    for (const t of targets) {
      const issue = publishUrlIssue(
        (urls[t.platform] ?? "").trim(),
        t.platform as PostUrlPlatform,
      );
      if (issue !== null) {
        toast.error(
          tr(
            issue === "account-url"
              ? "assignment.urlIsAccount"
              : "assignment.urlWrongPlatform",
            { platform: t.platform },
          ),
        );
        return;
      }
    }
    setBusy(true);
    try {
      await confirmPublication({
        projectId,
        id: assignment._id,
        urls: targets.map((t) => ({
          platform: t.platform,
          url: (urls[t.platform] ?? "").trim(),
        })),
      });
      // Le moment de fierté de la mission : il se CÉLÈBRE (confettis, vibration,
      // gain par vidéo) au lieu d'un toast qui passe inaperçu.
      const perVideo = assignment.pricingSnapshot
        ? estimateMissionEarnings(assignment.pricingSnapshot, 0).fixed
        : null;
      celebrate({
        kind: "published",
        missionName: missionName ?? "",
        perVideo: perVideo && perVideo > 0 ? perVideo : null,
      });
      setUrls({});
      setClipSuggest({});
    } catch (err) {
      toast.error(showError(err, t("assignment.publishFailed")));
    } finally {
      setBusy(false);
    }
  }

  const streamUid = assignment.submittedVideoStreamUid;
  const streamStatus = assignment.submittedVideoStreamStatus;
  const myVideoPreview =
    streamUid && (streamStatus === "ready" || streamStatus === "processing") ? (
      // Cloudflare Stream a transcodé ta vidéo → tu la revois lisible (HEVC
      // inclus), même si ton .mov ne s'ouvrait pas dans le navigateur.
      <StreamPlayer
        uid={streamUid}
        status={streamStatus}
        title={t("assignment.myVideo")}
      />
    ) : assignment.submittedVideoStorageId && submittedVideoUrl !== undefined ? (
      <VideoExample
        example={{
          kind: "file",
          storageId: assignment.submittedVideoStorageId,
          title: t("assignment.myVideo"),
          mimeType: submittedVideoMimeType ?? "video/mp4",
          url: submittedVideoUrl ?? null,
        }}
      />
    ) : null;

  // ── Compte GÉRÉ par l'équipe (LECTURE SEULE + marqueur) ─────────────────────
  // La créatrice SUIT sa vidéo (script au-dessus, post + perfs dans « Mes
  // vidéos ») mais ne soumet ni ne publie RIEN : l'équipe s'en charge. Aucune
  // action mutatrice ; on montre le marqueur « géré par l'équipe » + les liens
  // publiés le cas échéant. Branche AVANT readOnly et le rendu normal → le
  // chemin créateur classique reste strictement inchangé.
  if (managed) {
    const publishedTargets = targets.filter((t) => t.publishedUrl);
    const isOnline = s === "published" || s === "paid";
    return (
      <div className="space-y-3" data-testid="managed-assignment-actions">
        <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          <UsersIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <span>
            <span className="font-medium text-slate-800">{t("assignment.managedBadge2")}</span>{" "}
            {t("assignment.managedNotice")}
          </span>
        </div>
        {isOnline && publishedTargets.length > 0 && (
          <div className="space-y-1">
            {publishedTargets.map((t) => (
              <a
                key={t.platform}
                href={t.publishedUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                {tr("assignment.seePostOn", { platform: t.platform })}
                <ExternalLinkIcon className="size-3.5" />
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Admin view-as (LECTURE SEULE) ──────────────────────────────────────────
  // Aucune action : on montre l'ÉTAT du workflow (où en est le créateur) +, le
  // cas échéant, la vidéo soumise et les liens publiés. Les boutons/formulaires
  // mutateurs (commencer, soumettre, confirmer) sont absents. Branche placée
  // AVANT le rendu normal → le chemin créateur reste strictement inchangé.
  if (readOnly) {
    const publishedTargets = targets.filter((t) => t.publishedUrl);
    return (
      <div className="space-y-3">
        {s === "todo" && (
          <ReadOnlyState tone="slate" label={t("assignment.ro.todo")} />
        )}
        {s === "in_progress" && (
          <ReadOnlyState tone="slate" label={t("assignment.ro.inProgress")} />
        )}
        {s === "video_submitted" && (
          <>
            <ReadOnlyState tone="amber" label={t("assignment.ro.submitted")} />
            {myVideoPreview}
          </>
        )}
        {s === "video_rejected" && (
          <>
            {assignment.videoReviewFeedback && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <p className="font-semibold">{t("assignment.redoTitle")}</p>
                <p>{assignment.videoReviewFeedback}</p>
              </div>
            )}
            {myVideoPreview}
            <ReadOnlyState tone="slate" label={t("assignment.ro.resubmit")} />
          </>
        )}
        {s === "to_publish" && (
          <ReadOnlyState
            tone="emerald"
            label={t("assignment.ro.toPublish")}
          />
        )}
        {(s === "published" || s === "paid") && (
          <>
            <ReadOnlyState
              tone="emerald"
              label={s === "paid" ? t("assignment.publishedPaid") : t("assignment.publishedOnly")}
            />
            {publishedTargets.map((t) => (
              <a
                key={t.platform}
                href={t.publishedUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                {tr("assignment.seePostOn", { platform: t.platform })}
                <ExternalLinkIcon className="size-3.5" />
              </a>
            ))}
          </>
        )}
      </div>
    );
  }

  const uploadModal = (
    <Dialog open={uploadOpen} onOpenChange={(o) => !busy && setUploadOpen(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("assignment.uploadTitle")}</DialogTitle>
          <DialogDescription>
            {t("assignment.uploadHint", { count: targets.length })}
          </DialogDescription>
        </DialogHeader>
        <VideoUploader
          onUploaded={handleUploaded}
          disabled={busy}
          title={t("assignment.dropHere")}
        />
      </DialogContent>
    </Dialog>
  );

  // ── todo ───────────────────────────────────────────────────────────────────
  if (s === "todo") {
    return (
      <Button onClick={handleStart} disabled={busy} className={ACTION_BTN}>
        {busy ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <PlayIcon className="mr-2 size-4" />
        )}
        Je commence
      </Button>
    );
  }

  // ── in_progress → soumettre la vidéo ───────────────────────────────────────
  if (s === "in_progress") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">{t("assignment.shootHint")}</p>
        <Button
          onClick={() => setUploadOpen(true)}
          disabled={busy}
          className={ACTION_BTN}
        >
          <UploadIcon className="mr-2 size-4" />{t("assignment.submitMine")}</Button>
        {uploadModal}
      </div>
    );
  }

  // ── video_submitted → en attente ───────────────────────────────────────────
  if (s === "video_submitted") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <ClockIcon className="size-4 shrink-0" />{t("assignment.sentAwaiting")}</div>
        {myVideoPreview}
      </div>
    );
  }

  // ── video_rejected → feedback + re-upload ──────────────────────────────────
  if (s === "video_rejected") {
    return (
      <div className="space-y-3">
        {assignment.videoReviewFeedback && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <p className="font-semibold">{t("assignment.redoTitle")}</p>
            <p>{assignment.videoReviewFeedback}</p>
          </div>
        )}
        {myVideoPreview}
        <Button
          onClick={() => setUploadOpen(true)}
          disabled={busy}
          className={ACTION_BTN}
        >
          <UploadIcon className="mr-2 size-4" />{t("assignment.resubmit")}</Button>
        {uploadModal}
      </div>
    );
  }

  // ── to_publish → publie sur CHAQUE plateforme + colle 1 URL par plateforme ──
  if (s === "to_publish") {
    const allFilled = targets.every(
      (t) => (urls[t.platform] ?? "").trim().length > 0,
    );
    return (
      <form onSubmit={handleConfirm} className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2Icon className="size-4 shrink-0" />
          {t("assignment.validatedPublish", { count: targets.length })}
        </div>
        {targets.map((target) => {
          const val = urls[target.platform] ?? "";
          // Trois états, jamais un silence. `issue` = prouvé faux (rouge,
          // bloquant) ; `unknown` = lien non reconnu (ambre, NON bloquant) —
          // c'est cet état qui manquait : le champ paraissait valide, le bouton
          // actif, et l'erreur ne tombait qu'au clic, sur un lien correct.
          const issue = publishUrlIssue(
            val.trim(),
            target.platform as PostUrlPlatform,
          );
          const unknown =
            issue === null &&
            val.trim() !== "" &&
            detectInspirationType(val) === null;
          return (
            <div key={target.platform} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`url-${target.platform}`}>
                  {t("assignment.publishOn", { platform: target.platform })}
                  {target.accountHandle ? (
                    <span className="font-mono text-slate-500">
                      {" "}
                      {target.accountHandle}
                    </span>
                  ) : null}
                </Label>
                <button
                  type="button"
                  onClick={() => void pasteInto(target.platform)}
                  data-testid={`paste-url-${target.platform}`}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  <ClipboardPasteIcon className="size-3.5" />
                  {t("publishFlow.paste")}
                </button>
              </div>
              <Input
                id={`url-${target.platform}`}
                type="url"
                inputMode="url"
                placeholder={placeholderFor(target.platform)}
                value={val}
                onChange={(e) =>
                  setUrls((prev) => ({ ...prev, [target.platform]: e.target.value }))
                }
                required
                className="h-11 sm:h-9"
              />
              {clipSuggest[target.platform] && val.trim() === "" && (
                <button
                  type="button"
                  data-testid={`clip-suggest-${target.platform}`}
                  onClick={() => {
                    setUrls((prev) => ({
                      ...prev,
                      [target.platform]: clipSuggest[target.platform],
                    }));
                    haptic("tap");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"
                >
                  <ClipboardPasteIcon className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-primary">
                      {t("publishFlow.suggestion")}
                    </span>
                    <span className="block truncate font-mono text-xs text-slate-600">
                      {clipSuggest[target.platform]}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-primary">
                    {t("publishFlow.use")}
                  </span>
                </button>
              )}
              {issue !== null && (
                <p
                  className="text-xs text-rose-600"
                  data-testid={`url-issue-${target.platform}`}
                >
                  {issue === "account-url"
                    ? t("assignment.profileLink")
                    : t("assignment.wrongLink", { platform: target.platform })}
                </p>
              )}
              {unknown && (
                <p
                  className="text-xs text-amber-600"
                  data-testid={`url-unknown-${target.platform}`}
                >
                  {t("assignment.unknownLink")}
                </p>
              )}
            </div>
          );
        })}
        <Button
          type="submit"
          disabled={busy || !allFilled}
          className="h-11 w-full text-base sm:h-9 sm:text-sm"
        >
          {busy ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : (
            <SendIcon className="mr-2 size-4" />
          )}
          {t("assignment.confirmPublish")}
        </Button>
      </form>
    );
  }

  // ── published | paid ───────────────────────────────────────────────────────
  const publishedTargets = targets.filter((t) => t.publishedUrl);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
        <CheckCircle2Icon className="size-4 shrink-0" />
        {s === "paid" ? t("assignment.publishedPaid") : t("assignment.publishedOnly")}
      </div>
      {publishedTargets.map((t) => (
        <a
          key={t.platform}
          href={t.publishedUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          {tr("assignment.seePostOn", { platform: t.platform })}
          <ExternalLinkIcon className="size-3.5" />
        </a>
      ))}
    </div>
  );
}

const READONLY_TONE: Record<string, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

/** Encart d'état (admin view-as) : montre où en est le créateur, sans action. */
function ReadOnlyState({
  tone,
  label,
}: {
  tone: "slate" | "amber" | "emerald";
  label: string;
}) {
  const t = useTranslations("portal.assignment");
  return (
    <div
      data-testid="assignment-readonly-state"
      className={`flex items-center gap-2 rounded-md border p-3 text-sm ${READONLY_TONE[tone]}`}
    >
      <ClockIcon className="size-4 shrink-0" />
      {label}
    </div>
  );
}
