"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2Icon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { detectInspirationType } from "@/lib/inspiration-url";
import { HookPicker } from "./HookPicker";
import { VideoUploader, type UploadedVideo } from "@/components/VideoUploader";

type FullFormat = NonNullable<FunctionReturnType<typeof api.formats.getFormat>>;

type FormatType = "carousel" | "short" | "screenrecorder" | "custom";
type Platform = "tiktok" | "youtube" | "instagram";
type EditorExample =
  | { kind: "file"; storageId: Id<"_storage">; title: string; mimeType: string; url?: string | null }
  | { kind: "url"; url: string; platform: Platform; title: string };

const TYPE_OPTIONS: { value: FormatType; label: string }[] = [
  { value: "carousel", label: "Carrousel" },
  { value: "short", label: "Short" },
  { value: "screenrecorder", label: "ScreenRecorder" },
  { value: "custom", label: "Custom" },
];

export function FormatEditor({ format }: { format: FullFormat }) {
  const update = useProjectMutation(api.formats.updateFormat);

  const [name, setName] = useState(format.name);
  const [type, setType] = useState<FormatType>(format.type);
  const [brief, setBrief] = useState(format.brief);
  const [hooks, setHooks] = useState<string[]>(format.hooks);
  const [doList, setDoList] = useState<string[]>(format.guidelines.do);
  const [dontList, setDontList] = useState<string[]>(format.guidelines.dont);
  const [examples, setExamples] = useState<EditorExample[]>(
    format.exampleVideos as EditorExample[],
  );
  const [basePerPost, setBasePerPost] = useState(
    String(format.rateModel.basePerPost),
  );
  const [viewBonus, setViewBonus] = useState(
    format.rateModel.viewBonusPer1k != null
      ? String(format.rateModel.viewBonusPer1k)
      : "",
  );
  const [bounties, setBounties] = useState(
    (format.rateModel.bounties ?? []).map((b) => ({
      thresholdViews: String(b.thresholdViews),
      amount: String(b.amount),
    })),
  );
  const [saving, setSaving] = useState(false);

  const isArchived = format.status === "archived";

  async function handleSave() {
    const base = Number(basePerPost);
    if (!Number.isFinite(base) || base < 0) {
      toast.error("Tarif de base invalide.");
      return;
    }
    const rateModel = {
      basePerPost: base,
      viewBonusPer1k: viewBonus.trim() === "" ? undefined : Number(viewBonus),
      bounties: bounties
        .filter((b) => b.thresholdViews.trim() !== "" && b.amount.trim() !== "")
        .map((b) => ({
          thresholdViews: Number(b.thresholdViews),
          amount: Number(b.amount),
        })),
    };
    setSaving(true);
    try {
      await update({
        id: format._id,
        name: name.trim(),
        type,
        brief,
        hooks,
        guidelines: { do: doList, dont: dontList },
        // Retire `url` (résolu serveur, hors validateur).
        exampleVideos: examples.map((e) =>
          e.kind === "file"
            ? {
                kind: "file" as const,
                storageId: e.storageId,
                title: e.title,
                mimeType: e.mimeType,
              }
            : e,
        ),
        rateModel,
      });
      toast.success("Format enregistré");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    try {
      await update({ id: format._id, status: isArchived ? "active" : "archived" });
      toast.success(isArchived ? "Format réactivé" : "Format archivé");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Informations</CardTitle>
          <Button variant="outline" size="sm" onClick={toggleArchive}>
            {isArchived ? "Réactiver" : "Archiver"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="format-name">Nom</Label>
            <Input
              id="format-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => v && setType(v as FormatType)}>
              <SelectTrigger aria-label="Type de format">
                <SelectValue>
                  {TYPE_OPTIONS.find((o) => o.value === type)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brief (markdown)</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={8}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Objectif du format, structure, ton, durée…"
            className="font-mono text-xs"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hooks embarqués</CardTitle>
        </CardHeader>
        <CardContent>
          <HookPicker value={hooks} onChange={setHooks} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-emerald-700">À faire</CardTitle>
          </CardHeader>
          <CardContent>
            <StringListEditor
              value={doList}
              onChange={setDoList}
              placeholder="Ajouter une règle à faire…"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-rose-700">À éviter</CardTitle>
          </CardHeader>
          <CardContent>
            <StringListEditor
              value={dontList}
              onChange={setDontList}
              placeholder="Ajouter une règle à éviter…"
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vidéos exemples</CardTitle>
        </CardHeader>
        <CardContent>
          <ExampleVideosEditor value={examples} onChange={setExamples} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rémunération</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="base-per-post">Tarif de base / post (€)</Label>
              <Input
                id="base-per-post"
                type="number"
                min={0}
                step="0.01"
                value={basePerPost}
                onChange={(e) => setBasePerPost(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-bonus">Bonus / 1 000 vues (€, optionnel)</Label>
              <Input
                id="view-bonus"
                type="number"
                min={0}
                step="0.01"
                value={viewBonus}
                onChange={(e) => setViewBonus(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Primes par paliers de vues</Label>
            {bounties.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder="Seuil vues"
                  value={b.thresholdViews}
                  onChange={(e) =>
                    setBounties((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, thresholdViews: e.target.value } : x,
                      ),
                    )
                  }
                  aria-label={`Seuil de vues prime ${i + 1}`}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Montant €"
                  value={b.amount}
                  onChange={(e) =>
                    setBounties((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, amount: e.target.value } : x,
                      ),
                    )
                  }
                  aria-label={`Montant prime ${i + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    setBounties((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label="Retirer la prime"
                >
                  <Trash2Icon className="size-4 text-rose-600" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setBounties((prev) => [...prev, { thresholdViews: "", amount: "" }])
              }
            >
              <PlusIcon className="mr-1.5 size-4" />
              Ajouter une prime
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          Enregistrer le format
        </Button>
      </div>
    </div>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────

function StringListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  function add() {
    const t = input.trim();
    if (!t) return;
    onChange([...value, t]);
    setInput("");
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {value.map((v, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-sm text-slate-800"
          >
            <span className="flex-1">{v}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label="Retirer"
              className="mt-0.5 text-slate-400 hover:text-slate-700"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" onClick={add}>
          Ajouter
        </Button>
      </div>
    </div>
  );
}

function ExampleVideosEditor({
  value,
  onChange,
}: {
  value: EditorExample[];
  onChange: (v: EditorExample[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [urlPlatform, setUrlPlatform] = useState<Platform>("tiktok");

  function onUploaded(v: UploadedVideo) {
    onChange([
      ...value,
      { kind: "file", storageId: v.storageId, title: v.title, mimeType: v.mimeType },
    ]);
  }

  function onUrlChange(next: string) {
    setUrl(next);
    const detected = detectInspirationType(next);
    if (detected) {
      setUrlPlatform(
        detected.plateforme === "TikTok"
          ? "tiktok"
          : detected.plateforme === "Instagram"
            ? "instagram"
            : "youtube",
      );
    }
  }

  function addUrl() {
    const u = url.trim();
    if (!u) return;
    onChange([
      ...value,
      { kind: "url", url: u, platform: urlPlatform, title: urlTitle.trim() || u },
    ]);
    setUrl("");
    setUrlTitle("");
  }

  return (
    <div className="space-y-4">
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((e, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2"
            >
              <Badge variant="secondary" className="shrink-0">
                {e.kind === "file" ? "Fichier" : e.platform}
              </Badge>
              <Input
                value={e.title}
                onChange={(ev) =>
                  onChange(
                    value.map((x, j) =>
                      j === i ? { ...x, title: ev.target.value } : x,
                    ),
                  )
                }
                aria-label={`Titre exemple ${i + 1}`}
                className="h-8 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label="Retirer l'exemple"
              >
                <Trash2Icon className="size-4 text-rose-600" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <VideoUploader onUploaded={onUploaded} />

      <div className="space-y-2 rounded-md border border-slate-200 p-3">
        <Label className="text-xs uppercase tracking-wide text-slate-400">
          Ou ajouter un lien (TikTok / YouTube / Instagram)
        </Label>
        <Input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://…"
          aria-label="URL de la vidéo exemple"
        />
        <div className="flex gap-2">
          <Select
            value={urlPlatform}
            onValueChange={(v) => v && setUrlPlatform(v as Platform)}
          >
            <SelectTrigger className="w-36" aria-label="Plateforme du lien">
              <SelectValue>{urlPlatform}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tiktok">tiktok</SelectItem>
              <SelectItem value="youtube">youtube</SelectItem>
              <SelectItem value="instagram">instagram</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={urlTitle}
            onChange={(e) => setUrlTitle(e.target.value)}
            placeholder="Titre (optionnel)"
            aria-label="Titre du lien"
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={addUrl}>
            Ajouter
          </Button>
        </div>
      </div>
    </div>
  );
}
