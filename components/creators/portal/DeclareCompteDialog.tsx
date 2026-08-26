"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useConvexError } from "@/lib/use-convex-error";
import { useTranslations } from "next-intl";

type Plateforme = "TikTok" | "Instagram" | "YouTube";

/**
 * P5 — déclaration d'un compte par le créateur. Hors ProjectProvider (portail
 * /app) : projectId passé explicitement à la creatorMutation. Le compte naît en
 * warmup (warmupStartedAt = now, targetDays au défaut plateforme, côté serveur).
 */
const NETWORK_KEY = {
  TikTok: "tiktok",
  Instagram: "instagram",
  YouTube: "youtube",
} as const;

export function DeclareCompteDialog({
  open,
  onOpenChange,
  projectId,
  expectedHandles,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: Id<"projects">;
  /** @ attendu par réseau (consigne admin) — rappel pour guider la correspondance. */
  expectedHandles?: {
    tiktok?: string;
    youtube?: string;
    instagram?: string;
  } | null;
}) {
  const showError = useConvexError();
  const td = useTranslations("portal.declare");
  const declareCompte = useMutation(api.comptes.declareCompte);
  const [plateforme, setPlateforme] = useState<Plateforme>("TikTok");
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // @ attendu pour la plateforme sélectionnée (si l'admin l'a renseigné).
  const expected = expectedHandles?.[NETWORK_KEY[plateforme]];

  function reset() {
    setPlateforme("TikTok");
    setHandle("");
    setUrl("");
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await declareCompte({
        projectId,
        plateforme,
        handle: handle.trim(),
        url: url.trim() || undefined,
      });
      toast.success(td("declared"));
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(showError(err, td("error")));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{td("title")}</DialogTitle>
          <DialogDescription>{td("subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{td("platform")}</Label>
            <Select
              value={plateforme}
              onValueChange={(v) => v && setPlateforme(v as Plateforme)}
            >
              <SelectTrigger aria-label={td("platform")}>
                <SelectValue>{plateforme}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {/* i18n-exempt: le texte EST la valeur d'enum envoyée au serveur (plateforme, v.literal côté Convex) — et une marque ne se traduit pas. */}
                <SelectItem value="TikTok">TikTok</SelectItem>
                {/* i18n-exempt: le texte EST la valeur d'enum envoyée au serveur (plateforme, v.literal côté Convex) — et une marque ne se traduit pas. */}
                <SelectItem value="Instagram">Instagram</SelectItem>
                {/* i18n-exempt: le texte EST la valeur d'enum envoyée au serveur (plateforme, v.literal côté Convex) — et une marque ne se traduit pas. */}
                <SelectItem value="YouTube">YouTube</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="declare-handle">{td("handle")}</Label>
            <Input
              id="declare-handle"
              placeholder="@mon_compte"
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              autoFocus
            />
            {expected && (
              <p className="text-xs text-slate-500">
                @ attendu :{" "}
                <span className="font-mono font-medium text-slate-700">
                  {expected}
                </span>
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="declare-url">{td("url")}</Label>
            <Input
              id="declare-url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >{td("cancel")}</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Déclarer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
