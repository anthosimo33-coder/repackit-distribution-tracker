"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, ImageUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { domToPng } from "modern-screenshot";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useConvexError } from "@/lib/use-convex-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  SCREEN,
  THEME_IDS,
  conversationDeData,
  defaultConversation,
  newItemId,
  type Conversation,
  type ConvItem,
  type ConvLocale,
  type Side,
  type ThemeId,
} from "@/lib/insta-conv";
import { InstaScreen, type InstaScreenHandle } from "./InstaScreen";

const PREVIEW_SCALE = 0.75;
const AVATAR_PX = 192;
/** Délai d'enregistrement après la dernière frappe. */
const SAVE_DELAY_MS = 600;

/** Photo recadrée au carré et réduite (~20 Ko) : elle voyage dans la conversation. */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_PX,
    AVATAR_PX,
  );
  return canvas.toDataURL("image/jpeg", 0.9);
}

const fichierDe = (titre: string) =>
  (titre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "conversation") + ".png";

/**
 * L'ÉCRAN — une bibliothèque de brouillons enregistrés dans Jarvia (bloc
 * `conversations.use`), écrits ici ou par Claude (outils MCP, convex/mcpConversations).
 * `?c=<id>` ouvre un brouillon : c'est le lien que rend Claude.
 *
 * Synchronisation : chaque frappe s'enregistre après un court délai ; une version
 * qui change côté serveur SANS venir de nous (Claude l'a réécrite) est adoptée
 * telle quelle.
 */
export function ConvStudio() {
  const tr = useTranslations("admin.ops.ConvStudio");
  const errorText = useConvexError();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const liste = useProjectQuery(api.instaConversations.listInstaConversations, {});
  const idUrl = params.get("c");
  const selectedId: Id<"instaConversations"> | null =
    liste?.find((c) => c._id === idUrl)?._id ?? liste?.[0]?._id ?? null;
  const doc = useProjectQuery(api.instaConversations.getInstaConversation, selectedId ? { id: selectedId } : "skip");
  const create = useProjectMutation(api.instaConversations.createInstaConversation);
  const save = useProjectMutation(api.instaConversations.saveInstaConversation);
  const remove = useProjectMutation(api.instaConversations.deleteInstaConversation);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [titre, setTitre] = useState("");
  // Ce que le serveur porte de NOTRE fait (dernier enregistrement ou dernière adoption).
  const [base, setBase] = useState<{ id: string; data: string; titre: string } | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const screenRef = useRef<InstaScreenHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Adoption PENDANT le rendu (et non dans un effet) : la version serveur ne
  // remplace la locale que si elle ne vient pas de notre propre enregistrement.
  const docKey = doc ? `${doc._id}:${doc.updatedAt}` : null;
  if (doc && docKey !== seen) {
    setSeen(docKey);
    if (!base || base.id !== doc._id || base.data !== doc.data || base.titre !== doc.titre) {
      setConv(conversationDeData(doc.data));
      setTitre(doc.titre);
      setBase({ id: doc._id, data: doc.data, titre: doc.titre });
      setConfirmDelete(false);
      setError(null);
    }
  }

  const data = conv ? JSON.stringify(conv) : null;
  useEffect(() => {
    if (!base || data === null || data === base.data) return;
    const id = base.id as Id<"instaConversations">;
    const t = window.setTimeout(() => {
      setSaving(true);
      save({ id, data })
        .then(() => {
          setBase((b) => (b && b.id === id ? { ...b, data } : b));
          setError(null);
        })
        .catch((e) => setError(errorText(e, tr("echecEnregistrement"))))
        .finally(() => setSaving(false));
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [data, base, save, errorText, tr]);

  const ouvrir = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname);

  async function nouvelle() {
    const pris = new Set((liste ?? []).map((c) => c.titre));
    let n = (liste?.length ?? 0) + 1;
    while (pris.has(tr("titreParDefaut", { n }))) n++;
    try {
      const id = await create({ titre: tr("titreParDefaut", { n }), data: JSON.stringify(defaultConversation()) });
      ouvrir(id);
    } catch (e) {
      setError(errorText(e, tr("echecEnregistrement")));
    }
  }

  async function renommer() {
    if (!base || titre.trim() === base.titre) return;
    try {
      await save({ id: base.id as Id<"instaConversations">, titre });
      setBase({ ...base, titre: titre.trim() });
      setError(null);
    } catch (e) {
      setError(errorText(e, tr("echecEnregistrement")));
    }
  }

  async function supprimer() {
    if (!base) return;
    try {
      await remove({ id: base.id as Id<"instaConversations"> });
      setConv(null);
      setBase(null);
      ouvrir(null);
    } catch (e) {
      setError(errorText(e, tr("echecEnregistrement")));
    }
  }

  if (liste === undefined) return <Skeleton className="h-[672px] w-full" />;

  if (liste.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-4 py-12 text-center">
          <p className="text-sm font-medium text-slate-900">{tr("aucuneConversation")}</p>
          <p className="mx-auto max-w-xl text-sm text-slate-500">{tr("avecClaude")}</p>
          <Button type="button" onClick={nouvelle}>
            <PlusIcon className="size-4" />
            {tr("nouvelle")}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  if (!conv || !base) return <Skeleton className="h-[672px] w-full" />;

  const patch = (p: Partial<Conversation>) => setConv({ ...conv, ...p });
  const patchItem = (id: string, p: Partial<ConvItem>) =>
    patch({ items: conv.items.map((it) => (it.id === id ? ({ ...it, ...p } as ConvItem) : it)) });
  const move = (index: number, delta: number) => {
    const items = [...conv.items];
    const [it] = items.splice(index, 1);
    items.splice(index + delta, 0, it);
    patch({ items });
  };
  const addMessage = (side: Side) =>
    patch({ items: [...conv.items, { id: newItemId(), kind: "message", side, text: "" }] });

  async function onExport() {
    const node = screenRef.current?.node;
    if (!node) return;
    setExporting(true);
    setExportError(false);
    try {
      const url = await domToPng(node, {
        width: SCREEN.width,
        height: SCREEN.height,
        scale: SCREEN.exportScale,
        // Polices système uniquement (SF Pro, emojis Apple) : rien à embarquer.
        font: false,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = fichierDe(titre);
      a.click();
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  async function onAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const avatar = await toAvatarDataUrl(file);
      setConv((c) => (c ? { ...c, contact: { ...c.contact, avatar } } : c));
    } catch {
      // image illisible : on garde la précédente
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{tr("bibliotheque")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1.5" role="list" aria-label={tr("bibliotheque")}>
              {liste.map((c) => (
                <button
                  key={c._id}
                  type="button"
                  role="listitem"
                  aria-current={c._id === base.id ? "true" : undefined}
                  onClick={() => ouvrir(c._id)}
                  className={cn(
                    "max-w-[16rem] truncate rounded-md border px-2.5 py-1 text-sm transition-colors",
                    c._id === base.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-700 hover:border-slate-400",
                  )}
                >
                  {c.titre}
                </button>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={nouvelle}>
                <PlusIcon className="size-4" />
                {tr("nouvelle")}
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Field label={tr("titreConversation")} htmlFor="conv-titre">
                  <Input
                    id="conv-titre"
                    value={titre}
                    maxLength={80}
                    onChange={(e) => setTitre(e.target.value)}
                    onBlur={renommer}
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                  />
                </Field>
              </div>
              {confirmDelete ? (
                <div className="flex gap-2">
                  <Button type="button" variant="destructive" size="sm" onClick={supprimer}>
                    {tr("confirmerSuppression")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    {tr("annuler")}
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2Icon className="size-4" />
                  {tr("supprimerConversation")}
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500" aria-live="polite">
              {error ? <span className="text-red-600">{error}</span> : saving ? tr("enregistrement") : tr("enregistre")}
            </p>
            <p className="text-xs text-slate-500">{tr("avecClaude")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tr("ecran")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label={tr("theme")}>
              <Choice
                value={conv.themeId}
                options={THEME_IDS.map((id) => [id, tr(`themes.${id}`)] as const)}
                onChange={(themeId: ThemeId) => patch({ themeId })}
              />
            </Field>
            <Field label={tr("langue")}>
              <Choice
                value={conv.locale}
                options={(["fr", "en"] as const).map((l) => [l, tr(`langues.${l}`)] as const)}
                onChange={(locale: ConvLocale) => patch({ locale })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tr("heure")} htmlFor="conv-time">
                <Input
                  id="conv-time"
                  value={conv.status.time}
                  onChange={(e) => patch({ status: { ...conv.status, time: e.target.value } })}
                />
              </Field>
              <Field label={tr("batterie")} htmlFor="conv-battery">
                <Input
                  id="conv-battery"
                  type="number"
                  min={0}
                  max={100}
                  value={conv.status.battery}
                  onChange={(e) =>
                    patch({
                      status: {
                        ...conv.status,
                        battery: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      },
                    })
                  }
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Switch
                  checked={conv.status.lowPower}
                  onCheckedChange={(lowPower) => patch({ status: { ...conv.status, lowPower } })}
                />
                {tr("economie")}
              </label>
              <Field label={tr("reseau")}>
                <Choice
                  value={String(conv.status.signal)}
                  options={["0", "1", "2", "3", "4"].map((n) => [n, n] as const)}
                  onChange={(n: string) => patch({ status: { ...conv.status, signal: Number(n) } })}
                />
              </Field>
            </div>
            <Field label={tr("defilement")} htmlFor="conv-scroll" hint={tr("defilementAide")}>
              <input
                id="conv-scroll"
                type="range"
                min={-200}
                max={1200}
                step={1}
                value={conv.scroll}
                onChange={(e) => patch({ scroll: Number(e.target.value) })}
                className="w-full accent-slate-900"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr("contact")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tr("nom")} htmlFor="conv-name">
                <Input
                  id="conv-name"
                  value={conv.contact.name}
                  onChange={(e) => patch({ contact: { ...conv.contact, name: e.target.value } })}
                />
              </Field>
              <Field label={tr("pseudo")} htmlFor="conv-username">
                <Input
                  id="conv-username"
                  value={conv.contact.username}
                  onChange={(e) => patch({ contact: { ...conv.contact, username: e.target.value } })}
                />
              </Field>
            </div>
            <Field label={tr("photo")}>
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void onAvatar(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <ImageUpIcon className="size-4" />
                  {tr("choisirPhoto")}
                </Button>
                {conv.contact.avatar && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ contact: { ...conv.contact, avatar: null } })}
                  >
                    {tr("retirerPhoto")}
                  </Button>
                )}
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr("messages")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {conv.items.length === 0 && <p className="text-sm text-slate-500">{tr("aucunMessage")}</p>}
            {conv.items.map((it, i) => (
              <div
                key={it.id}
                data-testid="conv-item"
                className={cn(
                  "space-y-2 rounded-lg border p-3",
                  it.kind === "message" && it.side === "out" ? "border-violet-200 bg-violet-50/40" : "border-slate-200",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {it.kind === "message" ? (
                    <Choice
                      value={it.side}
                      options={[
                        ["in", tr("recu")],
                        ["out", tr("envoye")],
                      ]}
                      onChange={(side: Side) => patchItem(it.id, { side })}
                    />
                  ) : (
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {tr("separateur")}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tr("monter")}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tr("descendre")}
                      disabled={i === conv.items.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tr("supprimer")}
                      onClick={() => patch({ items: conv.items.filter((x) => x.id !== it.id) })}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
                {it.kind === "message" ? (
                  <>
                    <Textarea
                      aria-label={tr("texte")}
                      rows={2}
                      value={it.text}
                      onChange={(e) => patchItem(it.id, { text: e.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <Switch
                          checked={!!it.edited}
                          onCheckedChange={(edited) => patchItem(it.id, { edited })}
                        />
                        {tr("modifie")}
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        {tr("reaction")}
                        <Input
                          className="h-8 w-20"
                          maxLength={8}
                          placeholder={tr("reactionExemple")}
                          value={it.reaction ?? ""}
                          onChange={(e) => patchItem(it.id, { reaction: e.target.value || undefined })}
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <Input
                    aria-label={tr("texteSeparateur")}
                    value={it.text}
                    onChange={(e) => patchItem(it.id, { text: e.target.value })}
                  />
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => addMessage("in")}>
                {tr("ajouterRecu")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addMessage("out")}>
                {tr("ajouterEnvoye")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({ items: [...conv.items, { id: newItemId(), kind: "date", text: tr("dateParDefaut") }] })
                }
              >
                {tr("ajouterSeparateur")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="space-y-3">
          <div
            className="overflow-hidden rounded-[28px] shadow-lg ring-1 ring-slate-200"
            style={{ width: SCREEN.width * PREVIEW_SCALE, height: SCREEN.height * PREVIEW_SCALE }}
            aria-label={tr("apercu")}
            role="img"
          >
            <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left" }}>
              <InstaScreen ref={screenRef} conversation={conv} />
            </div>
          </div>
          <Button type="button" className="w-full" onClick={onExport} disabled={exporting}>
            <DownloadIcon className="size-4" />
            {exporting ? tr("exportEnCours") : tr("exporter")}
          </Button>
          {exportError && <p className="text-sm text-red-600">{tr("exportEchec")}</p>}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Choix exclusif en boutons — plus lisible qu'un menu pour 2 à 5 options. */
function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm transition-colors",
            v === value ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
