"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import {
  ExternalLinkIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { convexErrorMessage } from "@/lib/convex-error";
import { formatCount, formatRelative } from "./radar-format";

type RadarAccount = FunctionReturnType<
  typeof api.radar.listRadarAccounts
>["accounts"][number];

export function RadarAccountsList({ accounts }: { accounts: RadarAccount[] }) {
  const [deleteTarget, setDeleteTarget] = useState<RadarAccount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const removeAccount = useProjectMutation(api.radar.removeRadarAccount);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await removeAccount({ accountId: deleteTarget._id });
      toast.success(`@${deleteTarget.handle} retiré`);
      setDeleteTarget(null);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Suppression impossible."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => (
          <RadarAccountCard
            key={account._id}
            account={account}
            onRequestDelete={() => setDeleteTarget(account)}
          />
        ))}
      </ul>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Retirer @{deleteTarget?.handle} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.videoCount > 0
                ? `Les ${deleteTarget.videoCount} vidéos suivies de ce compte seront supprimées du Radar. Action irréversible.`
                : "Le compte sera retiré du Radar. Action irréversible."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RadarAccountCard({
  account,
  onRequestDelete,
}: {
  account: RadarAccount;
  onRequestDelete: () => void;
}) {
  const updateNote = useProjectMutation(api.radar.updateRadarAccountNote);
  const syncAccount = useProjectMutation(api.radar.requestRadarAccountSync);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(account.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function handleSaveNote() {
    setSavingNote(true);
    try {
      await updateNote({
        accountId: account._id,
        note: noteDraft.trim() || undefined,
      });
      toast.success("Note mise à jour");
      setNoteOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Mise à jour impossible."));
    } finally {
      setSavingNote(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await syncAccount({ accountId: account._id });
      toast.success(`Synchronisation de @${account.handle} lancée`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Synchronisation impossible."));
    } finally {
      setSyncing(false);
    }
  }

  const initials = account.handle.slice(0, 2).toUpperCase();

  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white"
        aria-hidden
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <a
            href={`https://www.tiktok.com/@${account.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-medium text-slate-900 hover:underline"
          >
            @{account.handle}
          </a>
          <ExternalLinkIcon className="size-3 shrink-0 text-slate-400" />
        </div>
        <p className="text-xs text-slate-500">
          {account.authorFansSnapshot !== null
            ? `${formatCount(account.authorFansSnapshot)} abonnés · `
            : ""}
          {account.videoCount} vidéo{account.videoCount > 1 ? "s" : ""}
        </p>
        <p className="text-xs text-slate-400">
          Sync {formatRelative(account.lastSyncAt)}
        </p>
        {account.note && (
          <span className="mt-1 inline-block max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
            {account.note}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Synchroniser @${account.handle}`}
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCwIcon className={cn("size-4", syncing && "animate-spin")} />
        </Button>
        <Popover open={noteOpen} onOpenChange={setNoteOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Modifier la note de @${account.handle}`}
                onClick={() => setNoteDraft(account.note ?? "")}
              >
                <PencilIcon className="size-4" />
              </Button>
            }
          />
          <PopoverContent align="end" className="w-64 space-y-2 p-2">
            <Input
              autoFocus
              placeholder="Note / tag"
              value={noteDraft}
              maxLength={200}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !savingNote) {
                  e.preventDefault();
                  void handleSaveNote();
                }
              }}
            />
            <Button
              size="sm"
              className="w-full"
              onClick={handleSaveNote}
              disabled={savingNote}
            >
              {savingNote && <Loader2Icon className="size-4 animate-spin" />}
              Enregistrer
            </Button>
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Retirer @${account.handle}`}
          onClick={onRequestDelete}
          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </li>
  );
}
