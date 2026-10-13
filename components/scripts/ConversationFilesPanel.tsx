"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileTextIcon, ImageIcon, Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { useConvexError } from "@/lib/use-convex-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { daysBetween, inspectExport } from "@/convex/conversationExport";
import { parisDayKey } from "@/convex/viewsDaily";

export type ConversationFileRow = {
  storageId: Id<"_storage">;
  name: string;
  kind: "export" | "image";
  size: number;
  selfName?: string;
  participants?: string[];
  gapDays?: number;
  messages?: number;
  url: string | null;
};

/** Valeur du select « ne pas remplacer le prénom » (Select n'accepte pas ""). */
const NO_RENAME = "__none__";
const ACCEPT = ".txt,text/plain,image/png,image/jpeg,image/webp";

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

/**
 * Les FICHIERS d'une brique « conversation » (cf convex/conversationFiles) :
 * déposer un export WhatsApp ou des captures, dire qui est « elle » dans
 * l'export, et à combien de jours du téléchargement tombe le dernier message.
 *
 * L'export est LU ICI avant l'envoi : un fichier sans aucun message reconnu est
 * refusé tout de suite, et ses auteurs remplissent le choix de « elle ». L'écart
 * proposé est celui du jour : un export daté d'hier part avec « 1 jour ».
 */
export function ConversationFilesPanel({
  brickId,
  files,
}: {
  brickId: Id<"scriptBricks">;
  files: readonly ConversationFileRow[];
}) {
  const tr = useTranslations("admin.scripts.ConversationFilesPanel");
  const showError = useConvexError();
  const uploadUrl = useProjectMutation(api.conversationFiles.generateConversationUploadUrl);
  const addFile = useProjectMutation(api.conversationFiles.addConversationFile);
  const updateFile = useProjectMutation(api.conversationFiles.updateConversationFile);
  const removeFile = useProjectMutation(api.conversationFiles.removeConversationFile);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    const isExport = /\.txt$/i.test(file.name);
    let meta: { participants?: string[]; gapDays?: number; messages?: number } = {};
    if (isExport) {
      const inspection = inspectExport(await file.text());
      if (inspection.messages === 0 || !inspection.lastDay) {
        toast.error(tr("pasUnExport", { name: file.name }));
        return;
      }
      meta = {
        participants: inspection.participants.map((p) => p.name),
        gapDays: Math.max(0, daysBetween(inspection.lastDay, parisDayKey(Date.now()))),
        messages: inspection.messages,
      };
    }
    const res = await fetch(await uploadUrl({}), {
      method: "POST",
      headers: { "Content-Type": file.type || (isExport ? "text/plain" : "application/octet-stream") },
      body: file,
    });
    if (!res.ok) throw new Error(`upload ${res.status}`); // i18n-exempt: erreur interne, message générique à l'écran
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    await addFile({ brickId, storageId, name: file.name, ...meta });
  }

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) await upload(f);
    } catch (e) {
      toast.error(showError(e, tr("echecDepot")));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function patch(storageId: Id<"_storage">, change: { selfName?: string | null; gapDays?: number }) {
    try {
      await updateFile({ brickId, storageId, ...change });
    } catch (e) {
      toast.error(showError(e));
    }
  }

  async function remove(storageId: Id<"_storage">) {
    try {
      await removeFile({ brickId, storageId });
    } catch (e) {
      toast.error(showError(e));
    }
  }

  return (
    <div className="space-y-2" data-testid="conversation-files">
      <div className="flex items-center justify-between gap-2">
        <Label>{tr("fichiers")}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          {busy ? <Loader2Icon className="mr-2 size-4 animate-spin" /> : <UploadIcon className="mr-2 size-4" />}
          {tr("deposer")}
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          data-testid="conversation-file-input"
          onChange={(e) => void onPick(e.target.files)}
        />
      </div>
      <p className="text-xs text-slate-400">{tr("aide")}</p>

      {files.length === 0 ? (
        <p className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2 text-xs text-amber-800">
          {tr("aucunFichier")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {files.map((f) => (
            <li key={f.storageId} className="space-y-2 px-3 py-2" data-testid="conversation-file">
              <div className="flex items-center gap-2">
                {f.kind === "export" ? (
                  <FileTextIcon className="size-4 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <ImageIcon className="size-4 shrink-0 text-sky-600" aria-hidden />
                )}
                {f.url ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:underline"
                  >
                    {f.name}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{f.name}</span>
                )}
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {f.kind === "export" && f.messages !== undefined
                    ? tr("messages", { count: f.messages })
                    : sizeLabel(f.size)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:text-rose-700"
                  onClick={() => void remove(f.storageId)}
                  aria-label={tr("retirer", { name: f.name })}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
              {f.kind === "export" && <ExportSettings file={f} onChange={(c) => patch(f.storageId, c)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExportSettings({
  file,
  onChange,
}: {
  file: ConversationFileRow;
  onChange: (change: { selfName?: string | null; gapDays?: number }) => Promise<void>;
}) {
  const tr = useTranslations("admin.scripts.ConversationFilesPanel");
  const [gap, setGap] = useState(String(file.gapDays ?? 0));
  const options = [...new Set([...(file.participants ?? []), ...(file.selfName ? [file.selfName] : [])])];
  const selected = file.selfName ?? NO_RENAME;

  return (
    <div className="grid gap-2 pl-6 sm:grid-cols-2">
      <div className="space-y-1">
        <Label className="text-xs font-normal text-slate-500">{tr("elle")}</Label>
        <Select
          value={selected}
          onValueChange={(v) => v && void onChange({ selfName: v === NO_RENAME ? null : v })}
        >
          <SelectTrigger className="h-8 w-full" aria-label={tr("elle")} data-testid="conversation-self-name">
            <SelectValue>{selected === NO_RENAME ? tr("neRienRemplacer") : selected}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_RENAME}>{tr("neRienRemplacer")}</SelectItem>
            {options.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!file.selfName && <p className="text-xs text-amber-700">{tr("prenomNonRemplace")}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`gap-${file.storageId}`} className="text-xs font-normal text-slate-500">
          {tr("ecart")}
        </Label>
        <Input
          id={`gap-${file.storageId}`}
          type="number"
          min={0}
          max={365}
          inputMode="numeric"
          className="h-8"
          value={gap}
          data-testid="conversation-gap-days"
          onChange={(e) => setGap(e.target.value)}
          onBlur={() => {
            const n = Number(gap);
            if (Number.isFinite(n) && n !== (file.gapDays ?? 0)) void onChange({ gapDays: n });
          }}
        />
        <p className="text-xs text-slate-400">{tr("ecartAide", { count: Number(gap) || 0 })}</p>
      </div>
    </div>
  );
}
