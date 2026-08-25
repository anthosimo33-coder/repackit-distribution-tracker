"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { Collapsible } from "@base-ui/react/collapsible";
import { api } from "@/convex/_generated/api";
import { useTalentProject } from "@/components/talent/TalentProjectProvider";
import { useMyRushes, useTalentBrief } from "@/components/talent/talent-data";
import { useReadOnly } from "@/components/portal/ViewAsContext";
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
import { ChevronDownIcon, FilmIcon, InboxIcon } from "lucide-react";
import { TALENT_STATUS_LABELS, type RushStatus } from "@/convex/rushStatus";
import { formatBytes } from "@/lib/snytch-drive";
import { formatDate } from "@/lib/format";
import { isPlaceholderExampleTitle } from "@/lib/talent-brief";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";

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
  const loc = useIntlLocale();
  const { projectId } = useTalentProject();
  const readOnly = useReadOnly();
  const brief = useTalentBrief(projectId);
  const rushes = useMyRushes(projectId);
  const getDepositSession = useAction(api.rushes.getDepositSession);
  const confirmDeposit = useMutation(api.rushes.confirmDeposit);

  /**
   * Le brief est REPLIÉ par défaut, sauf au tout premier passage — aucun dépôt.
   * On le lit une fois en arrivant, puis on ne le rouvre que pour vérifier un
   * point : le défaut doit servir le second cas, pas le premier.
   *
   * `null` = personne n'a encore touché au bloc, le défaut s'applique et se
   * recalcule à l'arrivée des dépôts (ils sont chargés en asynchrone). Dès le
   * premier clic, le choix de la personne l'emporte et ne bouge plus sous ses
   * doigts. Pas d'effet : la valeur dérive du rendu.
   */
  const [briefOuvertParElle, setBriefOuvertParElle] = useState<boolean | null>(
    null,
  );
  const premierPassage = rushes !== undefined && rushes.length === 0;
  const briefOuvert = briefOuvertParElle ?? premierPassage;

  /**
   * « Exemple » était estampillé sur chaque exemple à la création du brief (cf
   * lib/talent-brief.ts) : un placeholder, pas une saisie. Sous une rangée de
   * petits lecteurs, il ajoute une ligne qui n'apprend rien. Un vrai titre, lui,
   * reste affiché.
   */
  const examples = ((brief?.exampleVideos ?? []) as FormatExample[]).map((ex) =>
    isPlaceholderExampleTitle(ex.title) ? { ...ex, title: "" } : ex,
  );

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

      {/* ─── Dépôt ──────────────────────────────────────────────────────── */}
      {/*
        EN TÊTE DE PAGE, avant le brief : c'est le geste qu'elle vient faire.
        Un brief déplié le repoussait sous la ligne de flottaison, et il fallait
        faire défiler plusieurs écrans pour trouver l'uploader.

        En OBSERVATION, l'uploader n'est pas rendu du tout — pas grisé. Un
        sélecteur de fichiers désactivé se lit comme une panne ; la phrase dit ce
        que le talent, lui, aurait à cet endroit. La garantie n'est de toute
        façon pas ici : aucune mutation n'est atteignable par le chemin
        d'observation, et `confirmDeposit` refuse une session admin.
      */}
      <section className="space-y-2">
        <SectionTitle>Déposer</SectionTitle>
        {readOnly ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-slate-500">
              Le dépôt de prises est à sa main — il n&apos;est pas actionnable
              depuis l&apos;observation.
            </CardContent>
          </Card>
        ) : (
          <DriveUploader
            backend={{
              requestSession: (args) =>
                getDepositSession({ projectId, ...args }),
              confirm: (args) => confirmDeposit({ projectId, ...args }),
            }}
            limits={RUSH_LIMITS}
            copy={RUSH_COPY}
          />
        )}
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
                    {formatDate(rush.depositedAt, loc)} · {formatBytes(rush.sizeBytes, loc)}
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

      {/* ─── Brief permanent, REPLIÉ ────────────────────────────────────── */}
      <Collapsible.Root
        open={briefOuvert}
        onOpenChange={setBriefOuvertParElle}
        render={<section className="space-y-2" />}
      >
        <Collapsible.Trigger className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left hover:opacity-80">
          {/* Un <h2> ne peut pas vivre dans un <button> (contenu de flux dans
              du phrasé) : le titre est ici un <span> de même style. */}
          <span className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Comment filmer
          </span>
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-slate-400 transition-transform",
              briefOuvert && "rotate-180",
            )}
          />
        </Collapsible.Trigger>
        <Collapsible.Panel>
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
        </Collapsible.Panel>
      </Collapsible.Root>

      {/* ─── Vidéos d'exemple ───────────────────────────────────────────── */}
      {/*
        UNE RANGÉE, pas une pile : ces vidéos sont verticales et petites, trois
        tiennent de front sur un écran d'ordinateur. Empilées, elles ajoutaient
        trois écrans de défilement.
        Sur mobile, le débordement défile HORIZONTALEMENT dans son propre
        conteneur — la page, elle, ne défile jamais de côté. La largeur fixe des
        éléments laisse voir le bord du suivant : c'est ce qui dit qu'il y en a.
      */}
      {examples.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Des exemples</SectionTitle>
          <div className="flex snap-x gap-3 overflow-x-auto pb-2">
            {examples.map((example, i) => (
              <div key={i} className="w-[200px] shrink-0 snap-start">
                <VideoExample example={example} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
