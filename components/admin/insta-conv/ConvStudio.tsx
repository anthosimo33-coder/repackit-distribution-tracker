"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, ImageUpIcon, PlusIcon, ScissorsIcon, Trash2Icon } from "lucide-react";
import { domToPng } from "modern-screenshot";
import { zipSync } from "fflate";
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
  VISIBLE_HEIGHT,
  autoCuts,
  conversationDeData,
  slideEnds,
  defaultConversation,
  imagesDeConversation,
  newItemId,
  PARAM_EXPORT,
  type Conversation,
  type ConvItem,
  type ConvMedia,
  type ConvMessage,
  type ConvLocale,
  type Side,
  type ThemeId,
} from "@/lib/insta-conv";
import { InstaScreen, type InstaScreenHandle } from "./InstaScreen";
import type { ConvImages } from "./InstaMedia";

const PREVIEW_SCALE = 0.75;
const THUMB_SCALE = 0.17;
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

/** Plus grand côté d'une image déposée : de quoi rester nette à l'export ×2 (story 170×306 pt). */
const IMAGE_PX = 1600;

/** Image réduite et réencodée en JPEG (sans ses métadonnées) avant d'aller dans le storage. */
async function toUploadJpeg(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, IMAGE_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * k);
  const h = Math.round(bitmap.height * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.9));
  if (!blob) throw new Error("jpeg");
  return { blob, w, h };
}

const baseDe = (titre: string) =>
  titre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "conversation";
const fichierDe = (titre: string) => `${baseDe(titre)}.png`;

/** Attend que les images de l'écran soient chargées (ou en échec) : rastérisées trop tôt, elles manqueraient. */
async function attendreImages(node: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(node.querySelectorAll("img"))
      .filter((img) => !img.complete)
      .map((img) => new Promise<void>((ok) => {
        img.addEventListener("load", () => ok(), { once: true });
        img.addEventListener("error", () => ok(), { once: true });
      })),
  );
}

/** Rastérise un écran (414×896 pt) en PNG ×2 — polices système seulement, rien à embarquer. */
const versPng = async (node: HTMLElement) => {
  await attendreImages(node);
  return domToPng(node, { width: SCREEN.width, height: SCREEN.height, scale: SCREEN.exportScale, font: false });
};


const octetsDe = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));

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
  const exportAuto = params.get(PARAM_EXPORT) === "1";
  const selectedId: Id<"instaConversations"> | null =
    liste?.find((c) => c._id === idUrl)?._id ?? liste?.[0]?._id ?? null;
  const doc = useProjectQuery(api.instaConversations.getInstaConversation, selectedId ? { id: selectedId } : "skip");
  const create = useProjectMutation(api.instaConversations.createInstaConversation);
  const save = useProjectMutation(api.instaConversations.saveInstaConversation);
  const remove = useProjectMutation(api.instaConversations.deleteInstaConversation);
  const uploadUrl = useProjectMutation(api.instaConvImages.generateInstaConvUploadUrl);
  const registerImage = useProjectMutation(api.instaConvImages.registerInstaConvImage);

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
  const measureRef = useRef<InstaScreenHandle>(null);
  const slideRefs = useRef<(InstaScreenHandle | null)[]>([]);
  const [slide, setSlide] = useState(0);
  const [serieProgress, setSerieProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Images : celles que la conversation cite (résolues par le serveur), plus celles
  // qu'on vient de déposer (visibles avant que la requête ne se rafraîchisse).
  const [deposees, setDeposees] = useState<ConvImages>({});
  const idsImages = conv ? imagesDeConversation(conv) : [];
  const resolues = useProjectQuery(api.instaConvImages.getInstaConvImages, idsImages.length ? { ids: idsImages } : "skip");
  const images: ConvImages = { ...deposees, ...(resolues ?? {}) };

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

  // Série : chaque slide montre le fil jusqu'à sa coupure, la plus récente en bas.
  const ends = slideEnds(conv.items);
  const serie = ends.length > 1;
  const sel = Math.min(slide, ends.length - 1);
  const slideConv = (k: number): Conversation => ({ ...conv, items: conv.items.slice(0, ends[k] + 1), scroll: 0 });
  const apercu = serie ? slideConv(sel) : conv;

  const sansCoupure = (it: ConvItem): ConvItem => {
    const copie = { ...it };
    delete copie.cut;
    return copie;
  };
  const setCoupures = (cuts: ReadonlySet<number>) =>
    patch({ items: conv.items.map((it, i) => (cuts.has(i) ? { ...it, cut: true } : sansCoupure(it))) });

  /** Mesure le fil COMPLET (écran caché, échelle 1) et coupe dès qu'un écran est plein. */
  const decouper = () => {
    const root = measureRef.current?.node;
    if (!root) return;
    const haut = root.getBoundingClientRect().top;
    const spans: { top: number; bottom: number }[] = conv.items.map(() => ({ top: Infinity, bottom: -Infinity }));
    root.querySelectorAll<HTMLElement>("[data-item]").forEach((el) => {
      const i = Number(el.dataset.item);
      const r = el.getBoundingClientRect();
      const s = spans[i];
      if (!s) return;
      s.top = Math.min(s.top, r.top - haut);
      s.bottom = Math.max(s.bottom, r.bottom - haut + parseFloat(getComputedStyle(el).marginBottom || "0"));
    });
    setCoupures(new Set(autoCuts(spans, VISIBLE_HEIGHT)));
    setSlide(0);
  };

  async function telecharger(href: string, nom: string) {
    const a = document.createElement("a");
    a.href = href;
    a.download = nom;
    a.click();
  }

  async function onExport() {
    const node = screenRef.current?.node;
    if (!node) return;
    setExporting(true);
    setExportError(false);
    try {
      const nom = serie ? `${baseDe(titre)}-${String(sel + 1).padStart(2, "0")}.png` : fichierDe(titre);
      await telecharger(await versPng(node), nom);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  async function onExportSerie() {
    setExporting(true);
    setExportError(false);
    try {
      const fichiers: Record<string, Uint8Array> = {};
      for (let k = 0; k < ends.length; k++) {
        setSerieProgress(tr("exportSerieEnCours", { n: k + 1, total: ends.length }));
        const node = slideRefs.current[k]?.node;
        if (!node) throw new Error("slide"); // i18n-exempt: erreur interne, jamais affichée (message générique à l'écran)
        fichiers[`${baseDe(titre)}-${String(k + 1).padStart(2, "0")}.png`] = octetsDe(await versPng(node));
      }
      // Niveau 0 : un PNG est déjà compressé.
      const zip = zipSync(fichiers, { level: 0 });
      const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
      await telecharger(url, `${baseDe(titre)}.zip`);
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setExportError(true);
    } finally {
      setSerieProgress(null);
      setExporting(false);
    }
  }

  /** Lien `&exporter=1` : la série en ZIP, sinon la capture ; puis le paramètre part (un rechargement ne retélécharge pas). */
  async function exporterAuto() {
    await (serie ? onExportSerie() : onExport());
    router.replace(`${pathname}?c=${base!.id}`);
  }

  async function deposerImage(file: File): Promise<string | null> {
    try {
      const { blob, w, h } = await toUploadJpeg(file);
      const res = await fetch(await uploadUrl({}), { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      if (!res.ok) throw new Error(`upload ${res.status}`); // i18n-exempt: erreur interne, message générique à l'écran
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const img = await registerImage({ storageId, w, h });
      if (img.url) setDeposees((d) => ({ ...d, [img.id]: { url: img.url!, w: img.w, h: img.h } }));
      setError(null);
      return img.id;
    } catch (e) {
      setError(errorText(e, tr("echecImage")));
      return null;
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
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={decouper} disabled={conv.items.length < 2}>
                <ScissorsIcon className="size-4" />
                {tr("decoupageAuto")}
              </Button>
              {serie && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setCoupures(new Set())}>
                  {tr("retirerCoupures")}
                </Button>
              )}
              <span className="text-xs text-slate-500">{tr("slides", { count: ends.length })}</span>
            </div>
            {conv.items.length === 0 && <p className="text-sm text-slate-500">{tr("aucunMessage")}</p>}
            {conv.items.map((it, i) => (
              <div key={it.id} className="space-y-3">
              <div
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
                      aria-label={tr("finDeSlide")}
                      aria-pressed={!!it.cut}
                      disabled={i === conv.items.length - 1}
                      className={cn(it.cut && "bg-slate-900 text-white hover:bg-slate-800 hover:text-white")}
                      onClick={() => patchItem(it.id, it.cut ? { cut: undefined } : { cut: true })}
                    >
                      <ScissorsIcon />
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
                    {/* Un média (vocal, photo, reel…) n'a pas de texte. */}
                    {!it.media && (
                      <Textarea
                        aria-label={tr("texte")}
                        rows={2}
                        value={it.text}
                        onChange={(e) => patchItem(it.id, { text: e.target.value })}
                      />
                    )}
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
                    <MessageOptions
                      item={it}
                      tr={tr}
                      onUpload={deposerImage}
                      onChange={(p) => patchItem(it.id, p)}
                      onLongPress={(on) =>
                        patch({
                          items: conv.items.map((x) =>
                            x.kind !== "message" ? x : x.id === it.id ? { ...x, longPress: on || undefined } : { ...x, longPress: undefined },
                          ),
                        })
                      }
                    />
                  </>
                ) : (
                  <Input
                    aria-label={tr("texteSeparateur")}
                    value={it.text}
                    onChange={(e) => patchItem(it.id, { text: e.target.value })}
                  />
                )}
              </div>
              {it.cut && i < conv.items.length - 1 && (
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  {tr("slideN", { n: ends.indexOf(i) + 2 })}
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
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
              <InstaScreen ref={screenRef} conversation={apercu} images={images} />
            </div>
          </div>
          {serie && (
            <div className="space-y-1.5">
              <p className="max-w-[310px] text-xs text-slate-500">{tr("serieAide")}</p>
              <div className="flex max-w-[310px] gap-1.5 overflow-x-auto pb-1" role="list" aria-label={tr("slides", { count: ends.length })}>
                {ends.map((_, k) => (
                  <button
                    key={k}
                    type="button"
                    role="listitem"
                    aria-label={tr("slideN", { n: k + 1 })}
                    aria-current={k === sel ? "true" : undefined}
                    onClick={() => setSlide(k)}
                    className={cn(
                      "relative shrink-0 overflow-hidden rounded-md ring-1 transition",
                      k === sel ? "ring-2 ring-slate-900" : "ring-slate-200 hover:ring-slate-400",
                    )}
                    style={{ width: SCREEN.width * THUMB_SCALE, height: SCREEN.height * THUMB_SCALE }}
                  >
                    <div style={{ transform: `scale(${THUMB_SCALE})`, transformOrigin: "top left" }} aria-hidden>
                      <InstaScreen ref={(h) => { slideRefs.current[k] = h; }} conversation={slideConv(k)} images={images} />
                    </div>
                    <span className="absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                      {k + 1}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Button type="button" className="w-full" onClick={onExport} disabled={exporting}>
            <DownloadIcon className="size-4" />
            {exporting && !serieProgress ? tr("exportEnCours") : serie ? tr("exporterSlide", { n: sel + 1 }) : tr("exporter")}
          </Button>
          {serie && (
            <Button type="button" variant="outline" className="w-full" onClick={onExportSerie} disabled={exporting}>
              <DownloadIcon className="size-4" />
              {serieProgress ?? tr("exporterSerie", { count: ends.length })}
            </Button>
          )}
          {exportError && <p className="text-sm text-red-600">{tr("exportEchec")}</p>}
          {exportAuto && <AutoExport pret={idsImages.length === 0 || resolues !== undefined} lancer={exporterAuto} />}
          {/* Fil complet, hors écran, à l'échelle 1 : sert à mesurer pour la découpe automatique. */}
          <div aria-hidden style={{ position: "fixed", left: -10_000, top: 0, visibility: "hidden", pointerEvents: "none" }}>
            <InstaScreen ref={measureRef} conversation={{ ...conv, scroll: 0 }} images={images} />
          </div>
        </div>
      </div>
    </div>
  );
}

type Tr = ReturnType<typeof useTranslations<"admin.ops.ConvStudio">>;

/**
 * Export lancé par le lien de Claude, UNE fois, quand les images citées sont
 * résolues ; un court délai laisse la mise en page (largeurs serrées, dégradé)
 * se poser avant la rastérisation.
 */
function AutoExport({ pret, lancer }: { pret: boolean; lancer: () => Promise<void> }) {
  // `lancer` change à chaque rendu (enregistrement, requêtes) : on garde la
  // dernière dans une ref plutôt que de la mettre en dépendance — un nettoyage à
  // chaque rendu annulerait le minuteur, et l'export ne partirait jamais.
  const lancerRef = useRef(lancer);
  useEffect(() => {
    lancerRef.current = lancer;
  });
  const fait = useRef(false);
  useEffect(() => {
    if (!pret || fait.current) return;
    fait.current = true;
    window.setTimeout(() => void lancerRef.current(), 400);
  }, [pret]);
  return null;
}

type Nature = ConvMedia["type"] | "text";

/** La nature choisie → le média, en gardant l'image et le compte déjà posés. */
function mediaPour(v: Nature, prev: ConvMedia | undefined): ConvMedia | undefined {
  const image = prev && "image" in prev && prev.image ? { image: prev.image } : {};
  const compte = prev && "account" in prev ? { account: prev.account, ...(prev.avatar ? { avatar: prev.avatar } : {}), ...(prev.verified ? { verified: true } : {}) } : { account: "" };
  if (v === "text") return undefined;
  if (v === "voice") return { type: "voice", seconds: 3 };
  if (v === "photoOnce" || v === "videoOnce") return { type: v };
  if (v === "photo" || v === "video") return { type: v, ...image };
  if (v === "storyShare") return { type: v, ...image, ...compte };
  return { type: v, ...image, ...compte };
}

/**
 * Options d'un message, repliées par défaut : nature (texte, vocal, éphémère,
 * photo/vidéo, reel, publication, story partagée) et son image, réponse citée,
 * réponse à une story (et sa miniature), appui long, heure.
 */
function MessageOptions({
  item,
  tr,
  onUpload,
  onChange,
  onLongPress,
}: {
  item: ConvMessage;
  tr: Tr;
  onUpload: (file: File) => Promise<string | null>;
  onChange: (p: Partial<ConvMessage>) => void;
  onLongPress: (on: boolean) => void;
}) {
  const md = item.media;
  const nature: Nature = md?.type ?? "text";
  const card = md && (md.type === "reel" || md.type === "post" || md.type === "storyShare") ? md : null;
  const withImage = md && "image" in md ? md : md?.type === "photo" || md?.type === "video" ? md : null;
  const reply = item.reply;
  const actives = [item.media, item.reply, item.story, item.longPress, item.time].filter(Boolean).length;
  return (
    <details className="group rounded-md bg-slate-50 px-2.5 py-1.5" open={actives > 0 ? true : undefined}>
      <summary className="cursor-pointer text-xs font-medium text-slate-600 select-none">
        {tr("options")}
        {actives > 0 && <span className="ml-1 text-slate-400">({actives})</span>}
      </summary>
      <div className="mt-2 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Choice<Nature>
            value={nature}
            options={[
              ["text", tr("natures.texte")],
              ["voice", tr("natures.vocal")],
              ["photoOnce", tr("natures.photo")],
              ["videoOnce", tr("natures.video")],
              ["photo", tr("natures.photoEnvoyee")],
              ["video", tr("natures.videoEnvoyee")],
              ["reel", tr("natures.reel")],
              ["post", tr("natures.post")],
              ["storyShare", tr("natures.storyPartagee")],
            ]}
            onChange={(v) => onChange({ media: mediaPour(v, md) })}
          />
          {withImage && (
            <ImagePick
              label={tr("image")}
              value={withImage.image}
              tr={tr}
              onUpload={onUpload}
              onChange={(image) => onChange({ media: { ...withImage, image } })}
            />
          )}
          {item.media?.type === "voice" && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              {tr("duree")}
              <Input
                className="h-8 w-20"
                type="number"
                min={1}
                max={600}
                value={item.media.seconds}
                onChange={(e) => onChange({ media: { type: "voice", seconds: Math.max(1, Math.min(600, Number(e.target.value) || 1)) } })}
              />
            </label>
          )}
        </div>
        {card && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              {tr("compte")}
              <Input
                className="h-8 w-40"
                placeholder={tr("compteExemple")}
                value={card.account}
                onChange={(e) => onChange({ media: { ...card, account: e.target.value.replace(/^@+/, "") } })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Switch checked={!!card.verified} onCheckedChange={(on) => onChange({ media: { ...card, verified: on || undefined } })} />
              {tr("certifie")}
            </label>
            <ImagePick
              label={tr("photoCompte")}
              value={card.avatar}
              tr={tr}
              onUpload={onUpload}
              onChange={(avatar) => onChange({ media: { ...card, avatar } })}
            />
            {card.type !== "storyShare" && (
              <Textarea
                className="min-h-0"
                rows={2}
                aria-label={tr("legende")}
                placeholder={tr("legende")}
                value={card.caption ?? ""}
                onChange={(e) => onChange({ media: { ...card, caption: e.target.value || undefined } })}
              />
            )}
          </div>
        )}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Switch
              checked={!!reply}
              onCheckedChange={(on) => onChange({ reply: on ? { side: item.side === "in" ? "out" : "in", text: "" } : undefined })}
            />
            {tr("repondA")}
          </label>
          {reply && (
            <div className="flex flex-wrap items-center gap-2 pl-1">
              <Choice
                value={reply.side}
                options={[
                  ["in", tr("citationRecu")],
                  ["out", tr("citationEnvoye")],
                ]}
                onChange={(side) => onChange({ reply: { ...reply, side } })}
              />
              <Choice
                value={reply.kind ?? "text"}
                options={[
                  ["text", tr("natures.texte")],
                  ["photo", tr("natures.photo")],
                  ["video", tr("natures.video")],
                  ["voice", tr("natures.vocal")],
                ]}
                onChange={(k) =>
                  onChange({
                    reply: { side: reply.side, text: reply.text, ...(k === "text" ? {} : { kind: k }), ...(k === "voice" ? { seconds: reply.seconds ?? 3 } : {}) },
                  })
                }
              />
              {!reply.kind && (
                <Input
                  className="h-8 min-w-48 flex-1"
                  aria-label={tr("texteCite")}
                  placeholder={tr("texteCite")}
                  value={reply.text}
                  onChange={(e) => onChange({ reply: { ...reply, text: e.target.value } })}
                />
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Switch checked={!!item.story} onCheckedChange={(on) => onChange({ story: on ? {} : undefined })} />
            {tr("story")}
          </label>
          {item.story && item.side === "in" && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Switch
                checked={!!item.story.closeFriends}
                onCheckedChange={(on) => onChange({ story: { ...item.story, closeFriends: on || undefined } })}
              />
              {tr("amisProches")}
            </label>
          )}
          {item.story && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Switch
                checked={!!item.story.unavailable}
                onCheckedChange={(on) => onChange({ story: { ...item.story, unavailable: on || undefined } })}
              />
              {tr("storyIndisponible")}
            </label>
          )}
          {item.story && !item.story.unavailable && (
            <ImagePick
              label={tr("miniatureStory")}
              value={item.story.image}
              tr={tr}
              onUpload={onUpload}
              onChange={(image) => onChange({ story: { ...item.story, image } })}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Switch checked={!!item.longPress} onCheckedChange={onLongPress} />
            {tr("appuiLong")}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            {tr("heureMessage")}
            <Input
              className="h-8 w-24"
              placeholder={tr("heureExemple")}
              value={item.time ?? ""}
              onChange={(e) => onChange({ time: e.target.value || undefined })}
            />
          </label>
        </div>
      </div>
    </details>
  );
}

/** Dépôt d'une image : bouton (le champ fichier est caché), remplacer, retirer. */
function ImagePick({
  label,
  value,
  tr,
  onUpload,
  onChange,
}: {
  label: string;
  value: string | undefined;
  tr: Tr;
  onUpload: (file: File) => Promise<string | null>;
  onChange: (id: string | undefined) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700">
      <span>{label}</span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
        <ImageUpIcon className="size-4" />
        {busy ? tr("imageEnCours") : value ? tr("changerImage") : tr("choisirImage")}
      </Button>
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
          {tr("retirerImage")}
        </Button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const id = await onUpload(file);
            if (id) onChange(id);
          } finally {
            setBusy(false);
          }
        }}
      />
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
