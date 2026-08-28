"use client";

import { useState } from "react";
import Link from "next/link";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { creatorStatusBadge } from "@/lib/creator-status";
import { cn } from "@/lib/utils";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";
import {
  CREATOR_KINDS,
  resolveCreatorKind,
  type CreatorKind,
} from "@/convex/roles";
import { InviteCreatorDialog } from "@/components/creators/InviteCreatorDialog";
import { DeleteCreatorDialog } from "@/components/creators/DeleteCreatorDialog";
import { joinUrl } from "@/components/creators/CopyableLink";
import { CreatorLeaderboard } from "@/components/admin/leaderboard/CreatorLeaderboard";
import { AppariementSection } from "@/components/creators/AppariementSection";

/**
 * Pastilles de POPULATION — teintes délibérément DISJOINTES de celles du statut
 * (ambre, ciel, émeraude, ardoise, rose) : deux colonnes voisines de pastilles
 * dont les couleurs se recoupent se lisent comme une seule information.
 * Violet et sarcelle reprennent celles des lignes de paie `clip` et `retainer`,
 * pour qu'une population garde la même couleur d'un écran à l'autre.
 */
const KIND_BADGE: Record<CreatorKind, { label: string; className: string }> = {
  partner: {
    label: "Partenaire",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  talent: {
    label: "Talent",
    className: "border-teal-200 bg-teal-50 text-teal-700",
  },
  clipper: {
    label: "Clippeur",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
};

export default function CreateursPage() {
  const creators = useProjectQuery(api.creators.listCreators, {});
  const regenerate = useProjectMutation(api.creators.regenerateInvitation);
  const projectPath = useProjectPath();
  const [inviteOpen, setInviteOpen] = useState(false);
  // Filtre de population. `null` = toutes — le compte par population est autant
  // l'information que le filtre lui-même.
  const [filtre, setFiltre] = useState<CreatorKind | null>(null);
  const [filtreLangue, setFiltreLangue] = useState<Locale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"creators">;
    name: string;
  } | null>(null);

  // Comptes par population, calculés sur la liste COMPLÈTE : ils ne bougent pas
  // quand on filtre — sinon le filtre effacerait l'information qu'il donne.
  // DEUX AXES INDÉPENDANTS : population et langue se combinent (« Partenaire +
  // English »). Un seul état les rendrait exclusifs.
  const tousLesCreateurs = creators ?? [];
  const parKind = (c: (typeof tousLesCreateurs)[number]) =>
    filtre === null || resolveCreatorKind(c.kind) === filtre;
  const parLangue = (c: (typeof tousLesCreateurs)[number]) =>
    filtreLangue === null || c.locale === filtreLangue;
  const visibles = tousLesCreateurs.filter((c) => parKind(c) && parLangue(c));

  // COMPTEURS CROISÉS : chaque axe compte sur la liste déjà filtrée par
  // L'AUTRE. Sans ça, la pastille « English » annoncerait 6 alors qu'un clic
  // sur « Partenaire » n'en donne que 2 — un compteur qui ment sur ce qu'il
  // va produire est pire que pas de compteur.
  const pourKind = tousLesCreateurs.filter(parLangue);
  const pourLangue = tousLesCreateurs.filter(parKind);
  const parPopulation = pourKind.reduce<Partial<Record<CreatorKind, number>>>(
    (acc, c) => {
      const k = resolveCreatorKind(c.kind);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const parLangueCount = pourLangue.reduce<Record<string, number>>((acc, c) => {
    acc[c.locale] = (acc[c.locale] ?? 0) + 1;
    return acc;
  }, {});

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(joinUrl(token));
      toast.success("Lien copié");
    } catch {
      toast.error("Copie impossible");
    }
  }

  async function handleRegenerate(creatorId: Id<"creators">) {
    try {
      const { token } = await regenerate({ creatorId });
      await copyLink(token);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  const subtitle =
    creators === undefined
      ? "Chargement…"
      : `${creators.length} créateur${creators.length > 1 ? "s" : ""}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Créateurs
          </h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          Inviter un créateur
        </Button>
      </header>

      <CreatorLeaderboard />

      {/* Appariement clippeur ↔ talent. Ne s'affiche que sur un projet qui a des
          talents ou des clippeurs — invisible sur un projet 100 % partenaires. */}
      <AppariementSection />

      {creators === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : creators.length === 0 ? (
        <EmptyState onInvite={() => setInviteOpen(true)} />
      ) : (
        <>
        <div className="flex flex-wrap items-center gap-2">
          {[null, ...CREATOR_KINDS].map((k) => {
            const actif = filtre === k;
            const n =
              k === null ? pourKind.length : (parPopulation[k] ?? 0);
            return (
              <button
                key={k ?? "tous"}
                type="button"
                onClick={() => setFiltre(k)}
                aria-pressed={actif}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  actif
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
              >
                {k === null ? "Tous" : KIND_BADGE[k].label}
                <span className="ml-1.5 tabular-nums text-slate-400">{n}</span>
              </button>
            );
          })}
        </div>

        {/* Seconde barre — la LANGUE, axe indépendant de la population. Les
            endonymes ne sont jamais traduits (LOCALE_LABELS). */}
        <div className="flex flex-wrap items-center gap-2">
          {[null, ...LOCALES].map((l) => {
            const actif = filtreLangue === l;
            const n = l === null ? pourLangue.length : (parLangueCount[l] ?? 0);
            return (
              <button
                key={l ?? "toutes"}
                type="button"
                onClick={() => setFiltreLangue(l)}
                aria-pressed={actif}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  actif
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
              >
                {l === null ? "Toutes langues" : LOCALE_LABELS[l]}
                <span className="ml-1.5 tabular-nums text-slate-400">{n}</span>
              </button>
            );
          })}
        </div>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Population</TableHead>
                  <TableHead>Langue</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Ajouté le</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((c) => {
                  const badge = creatorStatusBadge(c.status);
                  const pop = KIND_BADGE[resolveCreatorKind(c.kind)];
                  return (
                    <TableRow key={c._id}>
                      <TableCell className="font-medium text-slate-900">
                        <Link
                          href={projectPath(`/createurs/${c._id}`)}
                          className="transition-colors hover:text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {c.email}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold",
                            pop.className,
                          )}
                        >
                          {pop.label}
                        </span>
                      </TableCell>
                      {/* Langue RÉSOLUE (users.locale → creators.locale → fr),
                          servie par le serveur. Sans cette colonne, on filtre à
                          l'aveugle : rien ne dirait que le filtre a raison. */}
                      <TableCell className="text-sm text-slate-600">
                        {LOCALE_LABELS[c.locale as Locale] ?? c.locale}
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
                      <TableCell className="text-sm text-slate-500">
                        {new Date(c.createdAt).toLocaleDateString("fr-FR")}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-8 p-0"
                                aria-label={`Actions ${c.name}`}
                              >
                                <MoreHorizontalIcon className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            {c.invitation ? (
                              <>
                                <DropdownMenuItem
                                  onClick={() => copyLink(c.invitation!.token)}
                                >
                                  Copier le lien
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleRegenerate(c._id)}
                                >
                                  Régénérer le lien
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            ) : null}
                            <DropdownMenuItem
                              onClick={() =>
                                setDeleteTarget({ id: c._id, name: c.name })
                              }
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
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </>
      )}

      <InviteCreatorDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      {deleteTarget && (
        <DeleteCreatorDialog
          creatorId={deleteTarget.id}
          creatorName={deleteTarget.name}
          open={deleteTarget !== null}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ onInvite }: { onInvite: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <UserPlusIcon className="size-16 text-slate-300" strokeWidth={1.5} />
        <p className="text-sm text-slate-500">
          Aucun créateur. Invite ton premier créateur — il sera opérationnel en
          deux minutes.
        </p>
        <Button onClick={onInvite}>
          <PlusIcon className="mr-2 size-4" />
          Inviter un créateur
        </Button>
      </CardContent>
    </Card>
  );
}
