"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTalentProject } from "@/components/talent/TalentProjectProvider";
import {
  DriveUploader,
  type DriveUploadCopy,
  type DriveUploadLimits,
} from "@/components/portal/DriveUploader";
import { VideoExample, type FormatExample } from "@/components/formats/VideoExample";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FilmIcon, InboxIcon } from "lucide-react";
import { TALENT_STATUS_LABELS, type RushStatus } from "@/convex/rushStatus";
import { formatBytes } from "@/lib/snytch-drive";
import { formatDate } from "@/lib/format";

/**
 * ESPACE TALENT — un seul écran, et c'est tout ce qu'il y a.
 *
 * Brief permanent, vidéos d'exemple, dépôt, mes dépôts. Pas de navigation, pas de
 * script, pas de compte, pas de statistique, pas les dépôts d'un autre talent —
 * cette page n'appelle littéralement aucune fonction qui en servirait.
 *
 * DIMENSIONNEMENT. Un rush est le hook seul : 5 à 10 secondes, ~30 Mo, un lot de
 * 30 autour d'1 Go. L'écran l'annonce, et le plafond par fichier est calé à 1 Go —
 * pas les 5 Go du dépôt partenaire. Un écran qui promet 5 Go à quelqu'un qui
 * dépose des prises de 5 secondes lui fait croire qu'on attend autre chose.
 */

/**
 * Bornes du dépôt talent. VIDÉO SEULEMENT : un rush est une prise, pas une photo.
 * 1 Go par fichier laisse ~30× la marge d'une prise 4K60 de 5 s (~33 Mo) tout en
 * arrêtant net le film de 4 Go choisi par erreur dans la pellicule.
 */
const RUSH_LIMITS: DriveUploadLimits = {
  maxBytes: 1024 * 1024 * 1024,
  accept: "video/*,.mov,.MOV",
  kinds: ["video"],
};

const RUSH_COPY: DriveUploadCopy = {
  title: "Dépose tes prises ici",
  hint: "Vidéos uniquement (iPhone .mov accepté) — des prises courtes, 5 à 10 secondes",
  button: "Choisir mes vidéos",
  tooBig: (name) =>
    `${name} : trop lourd (1 Go max). Une prise de quelques secondes fait ~30 Mo.`,
  wrongKind: (name) => `${name} : seules les vidéos sont acceptées.`,
};

/** Teinte du badge par état. Le libellé, lui, vient de convex/rushStatus.ts. */
const STATUS_VARIANT: Record<
  RushStatus,
  "secondary" | "default" | "outline" | "destructive"
> = {
  deposited: "secondary",
  assigned: "default",
  published: "default",
  rejected: "destructive",
  expired: "outline",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </h2>
  );
}

export function TalentSpaceScreen() {
  const { projectId } = useTalentProject();
  const brief = useQuery(api.formats.getMyTalentBrief, { projectId });
  const rushes = useQuery(api.rushes.listMyRushes, { projectId });
  const getDepositSession = useAction(api.rushes.getDepositSession);
  const confirmDeposit = useMutation(api.rushes.confirmDeposit);

  const examples = (brief?.exampleVideos ?? []) as FormatExample[];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Mes vidéos
        </h1>
        <p className="text-sm text-slate-500">
          Filme tes prises, dépose-les ici. On s&apos;occupe du reste.
        </p>
      </header>

      {/* ─── Brief permanent ────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionTitle>Comment filmer</SectionTitle>
        {brief === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : brief === null ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-500">
              Ton brief n&apos;est pas encore prêt. Ton contact te préviendra.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-5">
              <SimpleMarkdown content={brief.brief} />
            </CardContent>
          </Card>
        )}
      </section>

      {/* ─── Vidéos d'exemple ───────────────────────────────────────────── */}
      {examples.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Des exemples</SectionTitle>
          <div className="space-y-4">
            {examples.map((example, i) => (
              <VideoExample key={i} example={example} />
            ))}
          </div>
        </section>
      )}

      {/* ─── Dépôt ──────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionTitle>Déposer</SectionTitle>
        <DriveUploader
          backend={{
            requestSession: (args) => getDepositSession({ projectId, ...args }),
            confirm: (args) => confirmDeposit({ projectId, ...args }),
          }}
          limits={RUSH_LIMITS}
          copy={RUSH_COPY}
        />
      </section>

      {/* ─── Mes dépôts ─────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionTitle>Mes dépôts</SectionTitle>
        {rushes === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : rushes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-500">
              <InboxIcon className="size-6 text-slate-300" />
              Tu n&apos;as encore rien déposé.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {rushes.map((rush) => (
              <li
                key={rush._id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                <span className="mt-0.5 shrink-0 text-slate-400">
                  <FilmIcon className="size-5" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {rush.fileName}
                    </p>
                    <Badge
                      variant={STATUS_VARIANT[rush.status]}
                      className="shrink-0"
                    >
                      {TALENT_STATUS_LABELS[rush.status]}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    {formatDate(rush.depositedAt)} · {formatBytes(rush.sizeBytes)}
                  </p>
                  {/*
                    Motif de refus — TEXTE BRUT, jamais <SimpleMarkdown>. C'est de
                    la saisie libre répétée qui franchit une frontière de rôle
                    (écrite par un admin, lue par le talent) ; le brief, lui, est
                    du contenu éditorial rédigé une fois. Ne pas « harmoniser » les
                    deux rendus sous prétexte que le composant est déjà importé.
                  */}
                  {rush.rejectionReason && (
                    <p className="whitespace-pre-wrap break-words text-xs text-red-600">
                      {rush.rejectionReason}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
