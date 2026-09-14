"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PlusIcon,
  MoreHorizontalIcon,
  ClapperboardIcon,
  Loader2Icon,
} from "lucide-react";
import { ComboCooldownSettingsButton } from "@/components/scripts/ComboCooldownSettingsButton";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

type Campaign = FunctionReturnType<typeof api.scripts.listCampaigns>[number];

export default function ScriptsPage() {
  const tr = useTranslations("admin.scripts.ScriptsPage");
  const campaigns = useProjectQuery(api.scripts.listCampaigns, {});
  const projectPath = useProjectPath();
  const [editTarget, setEditTarget] = useState<Campaign | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {tr("scripts")}
          </h1>
          <p className="text-sm text-slate-500">
            {tr("campagnesCombinatoiresHookFluxCta")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ComboCooldownSettingsButton />
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-2 size-4" />
            {tr("nouvelleCampagne")}
          </Button>
        </div>
      </header>

      {campaigns === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ClapperboardIcon
              className="size-12 text-slate-300"
              strokeWidth={1.5}
            />
            <p className="text-sm text-slate-500">
              {tr("aucuneCampagneCreeTaPremiere")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("campagne")}</TableHead>
                  <TableHead>{tr("statut")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow
                    key={c._id}
                    className={cn(c.status === "archived" && "opacity-50")}
                  >
                    <TableCell className="font-medium text-slate-900">
                      <Link
                        href={projectPath(`/scripts/${c._id}`)}
                        className="transition-colors hover:text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          c.status === "active"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-500",
                        )}
                      >
                        {c.status === "active" ? tr("active") : tr("archivee")}
                      </span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <CampaignActions
                        campaign={c}
                        onEdit={() => setEditTarget(c)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        campaign={null}
      />
      <CampaignDialog
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
        campaign={editTarget}
      />
    </div>
  );
}

function CampaignActions({
  campaign,
  onEdit,
}: {
  campaign: Campaign;
  onEdit: () => void;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.scripts.CampaignActions");
  const update = useProjectMutation(api.scripts.updateCampaign);
  const remove = useProjectMutation(api.scripts.deleteCampaign);
  const isArchived = campaign.status === "archived";

  async function toggleArchive() {
    try {
      await update({
        id: campaign._id,
        status: isArchived ? "active" : "archived",
      });
      toast.success(isArchived ? tr("reactivee") : tr("archivee"));
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    }
  }

  async function onDelete() {
    try {
      await remove({ id: campaign._id });
      toast.success(tr("campagneSupprimee"));
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="size-8 p-0">
            <MoreHorizontalIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>{tr("modifier")}</DropdownMenuItem>
        <DropdownMenuItem onClick={toggleArchive}>
          {isArchived ? tr("reactiver") : tr("archiver")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onDelete}
          className="text-rose-600 focus:text-rose-700"
        >
          {tr("supprimer")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CampaignDialog({
  open,
  onOpenChange,
  campaign,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: Campaign | null;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.scripts.CampaignDialog");
  const create = useProjectMutation(api.scripts.createCampaign);
  const update = useProjectMutation(api.scripts.updateCampaign);
  const isEdit = campaign !== null;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Réinitialise les champs à l'ouverture (key force le remount via `open`).
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(campaign?.name ?? "");
    }
  }

  async function onSubmit() {
    if (name.trim().length === 0) {
      toast.error(tr("leNomEstRequis"));
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await update({ id: campaign._id, name });
        toast.success(tr("campagneMiseAJour"));
      } else {
        await create({ name });
        toast.success(tr("campagneCreee"));
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? tr("modifierLaCampagne") : tr("nouvelleCampagne")}
          </DialogTitle>
          <DialogDescription>
            {tr("uneCampagneRegroupeLesHooks")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-name">{tr("nom")}</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr("exAngleGainDeTemps")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tr("annuler")}
          </Button>
          <Button onClick={onSubmit} disabled={busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {isEdit ? tr("enregistrer") : tr("creer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
