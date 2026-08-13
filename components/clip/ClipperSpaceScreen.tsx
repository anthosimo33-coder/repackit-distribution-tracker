"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ChevronRightIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useClipperProject } from "@/components/clip/ClipperProjectProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { convexErrorMessage } from "@/lib/convex-error";
import { ASSIGNMENT_STATUS, type AssignmentStatus } from "@/lib/assignment-status";
import { formatDate } from "@/lib/format";
import {
  PHASE_LABELS,
  accountPhaseAt,
  formatUtcDayFr,
  postsPerDayAt,
  utcDayKey,
} from "@/convex/accountPhase";

/**
 * ESPACE CLIPPEUR — une page qui défile, deux objets : SES COMPTES et SES CLIPS.
 *
 * Pas de navigation : deux sections ne justifient pas une bottom-nav, et ses
 * gains n'existent pas encore (chantier pricing). Le montage, lui, se fait sur
 * une route dédiée (`/clip/clips/[id]`) — écran plein, script et dépôt.
 *
 * ⚠️ La phase et le quota sont DÉRIVÉS ici avec `convex/accountPhase.ts`, le
 * module que la garde serveur utilise. On reçoit l'ancre (`validatedAt`), jamais
 * une phase pré-calculée : un second calcul finirait par dériver du premier.
 */

const PLATEFORMES = ["TikTok", "Instagram", "YouTube"] as const;
type Plateforme = (typeof PLATEFORMES)[number];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </h2>
  );
}

/**
 * Ce qu'un compte permet AUJOURD'HUI, en une phrase. La journée nommée est la
 * journée UTC — le même repère que le compteur et que le refus serveur.
 */
function EtatDuCompte({
  validatedAt,
  publiable,
  refusedReason,
  postsAujourdhui,
  at,
}: {
  validatedAt: number | null;
  publiable: boolean;
  refusedReason: string | null;
  postsAujourdhui: number;
  /**
   * Instant de référence — venu du SERVEUR (borne haute de la fenêtre de quota),
   * jamais de `Date.now()` côté client. Deux raisons : l'horloge du navigateur
   * peut être décalée de la journée UTC que le serveur compte, et la règle de
   * pureté React interdit un appel impur au rendu.
   */
  at: number;
}) {
  if (refusedReason !== null) {
    return (
      <p className="text-xs text-rose-700">
        Compte refusé — {refusedReason}
      </p>
    );
  }
  if (validatedAt === null) {
    return (
      <p className="text-xs text-slate-500">
        En attente de validation — rien ne peut sortir tant qu&apos;un admin ne
        l&apos;a pas validé.
      </p>
    );
  }
  const phase = accountPhaseAt(validatedAt, at);
  const quota = postsPerDayAt(validatedAt, at);
  const reste = Math.max(0, quota - postsAujourdhui);
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-slate-600">
        Phase de {phase ? PHASE_LABELS[phase].toLowerCase() : "—"}
        {quota === 0
          ? " — aucune publication à cette étape."
          : ` — ${postsAujourdhui} publication${
              postsAujourdhui > 1 ? "s" : ""
            } sur ${quota} pour le ${formatUtcDayFr(at)}.`}
      </p>
      {quota > 0 && (
        <p className="text-xs font-medium text-slate-900">
          {reste === 0
            ? "Quota du jour atteint."
            : `${reste} publication${reste > 1 ? "s" : ""} possible${
                reste > 1 ? "s" : ""
              } aujourd'hui.`}
        </p>
      )}
      {!publiable && quota > 0 && (
        <p className="text-xs text-amber-700">
          Ce compte n&apos;est pas encore activé par l&apos;admin.
        </p>
      )}
    </div>
  );
}

function DeclarerCompte() {
  const { projectId } = useClipperProject();
  const declarer = useMutation(api.comptes.declareClipperCompte);
  const [ouvert, setOuvert] = useState(false);
  const [plateforme, setPlateforme] = useState<Plateforme>("TikTok");
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await declarer({
        projectId,
        plateforme,
        handle,
        ...(url.trim() ? { url: url.trim() } : {}),
      });
      toast.success("Compte déclaré — un admin doit le valider avant publication.");
      setHandle("");
      setUrl("");
      setOuvert(false);
    } catch (err) {
      toast.error(convexErrorMessage(err, "Échec de la déclaration"));
    } finally {
      setBusy(false);
    }
  }

  if (!ouvert) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOuvert(true)}>
        <PlusIcon className="mr-2 size-4" />
        Déclarer un compte
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="clip-plateforme" className="text-xs">
              Plateforme
            </Label>
            <select
              id="clip-plateforme"
              value={plateforme}
              onChange={(e) => setPlateforme(e.target.value as Plateforme)}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              {PLATEFORMES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="clip-handle" className="text-xs">
              Pseudo du compte
            </Label>
            <Input
              id="clip-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@monpseudo"
              required
            />
            <p className="text-xs text-slate-500">
              Évite d&apos;y mettre le nom du produit ou celui d&apos;un talent :
              un pseudo qui annonce la marque ne peut plus accrocher.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="clip-url" className="text-xs">
              Lien du profil (facultatif)
            </Label>
            <Input
              id="clip-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Déclarer
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOuvert(false)}
            >
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function MesComptes() {
  const { projectId } = useClipperProject();
  const comptes = useQuery(api.comptes.listMyClipperComptes, { projectId });
  const quota = useQuery(api.clipQuota.myQuotaWindow, { projectId });

  // On attend AUSSI le quota : il porte l'instant de référence du serveur, et
  // afficher les comptes sans lui reviendrait à annoncer « 0 publié » avant de
  // savoir. Un compteur faux est pire que pas de compteur.
  if (comptes === undefined || quota === undefined) {
    return <Skeleton className="h-24 w-full" />;
  }

  // Dernier instant de la journée UTC courante CÔTÉ SERVEUR (borne exclusive de
  // la fenêtre − 1 ms). Le champ, le compteur et le refus parlent donc du même
  // jour, sans dépendre de l'horloge du navigateur.
  const maintenant = quota.windowEnd - 1;
  const aujourdhui = utcDayKey(maintenant);
  const postsDuJour = (handle: string) =>
    quota.comptes.find((c) => c.handle === handle)?.parJour[aujourdhui] ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Mes comptes</SectionTitle>
        <DeclarerCompte />
      </div>
      {comptes.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-slate-500">
            Aucun compte déclaré. Déclare celui sur lequel tu vas publier — un
            admin le validera, puis il chauffera trois jours.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {comptes.map((c) => (
            <Card key={c._id}>
              <CardContent className="space-y-1.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm text-slate-900">
                    {c.handle}
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {c.plateforme}
                  </Badge>
                </div>
                <EtatDuCompte
                  validatedAt={c.validatedAt}
                  publiable={c.publiable}
                  refusedReason={c.refusedReason}
                  postsAujourdhui={postsDuJour(c.handle)}
                  at={maintenant}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function MesClips() {
  const { projectId } = useClipperProject();
  const clips = useQuery(api.assignments.listMyClips, { projectId });

  if (clips === undefined) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-3">
      <SectionTitle>Mes clips</SectionTitle>
      {clips.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-slate-500">
            Rien à monter pour l&apos;instant. Les clips arrivent quand un admin
            associe un script à un rush de tes talents.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {clips.map((c) => {
            const badge = ASSIGNMENT_STATUS[c.status as AssignmentStatus];
            return (
              <Link key={c._id} href={`/clip/clips/${c._id}`} className="block">
                <Card className="transition-colors hover:border-slate-300">
                  <CardContent className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={badge?.className}>
                          {badge?.label ?? c.status}
                        </Badge>
                        {c.dueDate !== undefined && (
                          <span className="text-xs text-slate-500">
                            à rendre le {formatDate(c.dueDate)}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-slate-600">
                        {c.targets.length === 0
                          ? "Aucune cible"
                          : c.targets
                              .map((t) =>
                                t.accountHandle
                                  ? `${t.platform} · ${t.accountHandle}`
                                  : t.platform,
                              )
                              .join(", ")}
                      </p>
                    </div>
                    <ChevronRightIcon className="size-4 shrink-0 text-slate-400" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ClipperSpaceScreen() {
  return (
    <div className="space-y-8">
      <MesComptes />
      <MesClips />
    </div>
  );
}
