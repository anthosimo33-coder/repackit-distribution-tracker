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
import { InviteCreatorDialog } from "@/components/creators/InviteCreatorDialog";
import { DeleteCreatorDialog } from "@/components/creators/DeleteCreatorDialog";
import { joinUrl } from "@/components/creators/CopyableLink";

export default function CreateursPage() {
  const creators = useProjectQuery(api.creators.listCreators, {});
  const regenerate = useProjectMutation(api.creators.regenerateInvitation);
  const projectPath = useProjectPath();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"creators">;
    name: string;
  } | null>(null);

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

      {creators === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : creators.length === 0 ? (
        <EmptyState onInvite={() => setInviteOpen(true)} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Ajouté le</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {creators.map((c) => {
                  const badge = creatorStatusBadge(c.status);
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
