"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageUpIcon, LinkIcon, Loader2Icon, SparklesIcon, Undo2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectAction } from "@/components/project/use-project-convex";
import { useConvexError } from "@/lib/use-convex-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applyReading, fromLlmItems, toLlmItems, type Conversation } from "@/lib/insta-conv";

/** Une capture d'iPhone tient sous 2 048 px : au-delà, le modèle la réduit de toute façon. */
const MAX_SIDE = 2048;

async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

type Busy = null | "reading" | "tiktok" | "rewrite";

/**
 * L'IA en entrée du générateur : LIRE une capture (fichier ou image d'un
 * TikTok) et RÉÉCRIRE la conversation selon une consigne. Elle ne rend que des
 * données ; l'écran reste dessiné par `InstaScreen`.
 */
export function ConvAiPanel({
  conv,
  onApply,
  canUndo,
  onUndo,
}: {
  conv: Conversation;
  onApply: (next: Conversation) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const tr = useTranslations("admin.ops.ConvStudio");
  const errorText = useConvexError();
  const analyze = useProjectAction(api.instaConv.analyzeScreenshot);
  const rewrite = useProjectAction(api.instaConv.rewriteConversation);
  const fetchPost = useProjectAction(api.instaConv.fetchTikTokPost);
  const fetchImage = useProjectAction(api.instaConv.fetchTikTokImage);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [tiktok, setTiktok] = useState<{ kind: "photos" | "video"; images: string[] } | null>(null);
  const [instruction, setInstruction] = useState("");

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e, tr("echecGenerique")));
    } finally {
      setBusy(null);
    }
  }

  async function read(dataUrl: string) {
    const reading = await analyze({ image: dataUrl });
    if (reading.items.length === 0) {
      setError(tr("aucunMessageLu"));
      return;
    }
    onApply(applyReading(conv, reading));
    setNotice(tr("importReussi", { count: reading.items.length }));
  }
  const readImage = (dataUrl: string) => run("reading", () => read(dataUrl));

  const loadTikTok = () =>
    run("tiktok", async () => {
      setTiktok(null);
      const media = await fetchPost({ url: tiktokUrl });
      if (media.kind === "unreadable") return;
      const images = await Promise.all(media.images.slice(0, 12).map((url) => fetchImage({ url })));
      setTiktok({ kind: media.kind, images });
    });

  const applyPrompt = () =>
    run("rewrite", async () => {
      const items = await rewrite({
        instruction,
        locale: conv.locale,
        contactName: conv.contact.name,
        items: toLlmItems(conv.items),
      });
      onApply({ ...conv, items: fromLlmItems(items) });
      setInstruction("");
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{tr("importer")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500">{tr("importerAide")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="conv-import-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void run("reading", async () => read(await fileToDataUrl(file)));
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              <ImageUpIcon className="size-4" />
              {tr("importerScreen")}
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label={tr("lienTiktok")}
              placeholder={tr("lienTiktokExemple")}
              value={tiktokUrl}
              onChange={(e) => setTiktokUrl(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              disabled={busy !== null || !tiktokUrl.trim()}
              onClick={loadTikTok}
            >
              <LinkIcon className="size-4" />
              {tr("recuperer")}
            </Button>
          </div>
          {tiktok && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                {tiktok.kind === "video" ? tr("couvertureVideo") : tr("choisirImage")}
              </p>
              <div className="flex flex-wrap gap-2">
                {tiktok.images.map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => readImage(src)}
                    className="overflow-hidden rounded-md ring-1 ring-slate-200 transition hover:ring-2 hover:ring-slate-900 disabled:opacity-50"
                    aria-label={tr("lireImage", { n: i + 1 })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL renvoyée par le proxy */}
                    <img src={src} alt="" className="h-28 w-auto" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr("prompt")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            aria-label={tr("prompt")}
            rows={3}
            placeholder={tr("promptExemple")}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <Button type="button" size="sm" disabled={busy !== null || !instruction.trim()} onClick={applyPrompt}>
            <SparklesIcon className="size-4" />
            {tr("appliquer")}
          </Button>
        </CardContent>
      </Card>

      {(busy || error || notice || canUndo) && (
        <div className="space-y-2" aria-live="polite">
          {busy && (
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2Icon className="size-4 animate-spin" />
              {busy === "tiktok" ? tr("recuperationEnCours") : busy === "rewrite" ? tr("reecritureEnCours") : tr("lectureEnCours")}
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-emerald-700">{notice}</p>}
          {canUndo && !busy && (
            <Button type="button" variant="ghost" size="sm" onClick={onUndo}>
              <Undo2Icon className="size-4" />
              {tr("annulerDernier")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
