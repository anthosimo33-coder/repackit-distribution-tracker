"use client";

import { useEffect, useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
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
import { convexErrorMessage } from "@/lib/convex-error";
import type { Plateforme } from "@/lib/compte-status";
import { useTranslations } from "next-intl";

/**
 * Compte GÉRÉ PAR L'ÉQUIPE — l'admin déclare un compte social pour une créatrice
 * qu'il tient PHYSIQUEMENT (il cochera le warmup, publiera, mettra le lien). Le
 * compte est rattaché à la créatrice (creatorId) — elle voit scripts + posts +
 * perfs — mais elle ne publie/dépose rien (managedByAdmin=true). Créé en warmup :
 * l'admin coche puis active depuis la fiche compte. Mobile-first.
 */
export function ManagedCompteDialog({
  open,
  onOpenChange,
  creatorId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  creatorId: Id<"creators">;
}) {
  const tr = useTranslations("admin.creators.ManagedCompteDialog");
  const declareManaged = useProjectMutation(api.comptes.declareManagedCompte);
  const [plateforme, setPlateforme] = useState<Plateforme>("TikTok");
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPlateforme("TikTok");
      setHandle("");
      setUrl("");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open]);

  async function submit() {
    const trimmed = handle.trim();
    if (!trimmed || trimmed === "@") {
      toast.error(tr("handleRequis"));
      return;
    }
    setSubmitting(true);
    try {
      await declareManaged({
        creatorId,
        plateforme,
        handle: trimmed,
        url: url.trim() || undefined,
      });
      toast.success(tr("compteGereCreeSur", { trimmed: trimmed, plateforme: plateforme }));
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("creerUnCompteGerePar")}</DialogTitle>
          <DialogDescription>
            {tr("compteTenuParLEquipe")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{tr("plateforme")}</Label>
            <Select
              value={plateforme}
              onValueChange={(v) => v !== null && setPlateforme(v as Plateforme)}
            >
              <SelectTrigger aria-label={tr("plateforme")}>
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
            <Label htmlFor="managed-handle">{tr("handle")}</Label>
            <Input
              id="managed-handle"
              placeholder={tr("handlePlaceholder")}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              {tr("leEstAjouteAutomatiquementSi")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="managed-url">{tr("urlDuCompteOptionnel")}</Label>
            <Input
              id="managed-url"
              placeholder="https://www.tiktok.com/@compte_pro"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tr("annuler")}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("creerLeCompteGere")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
