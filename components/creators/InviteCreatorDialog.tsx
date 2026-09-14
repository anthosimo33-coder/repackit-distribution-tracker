"use client";

import { useState } from "react";
import { LOCALES, LOCALE_LABELS, DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
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
import {
  CREATOR_KINDS,
  type CreatorKind,
} from "@/convex/roles";
import { CopyableLink } from "./CopyableLink";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/** Une ligne d'explication par population — ce que la personne verra en se
 *  connectant. Vit ici (formulation UI), pas dans convex/roles (algèbre). */
// Une clé par population : `admin.creators.kindHint.<population>`.
const KIND_HINT_KEYS: Record<CreatorKind, string> = {
  partner: "partner",
  talent: "talent",
  clipper: "clipper",
};

/**
 * P1 Créateurs — invitation (nom + email + POPULATION). En 2 temps : le
 * formulaire crée la fiche "invited" + l'invitation, puis on AFFICHE le lien
 * /join copiable (objectif : invité opérationnel en 2 minutes).
 *
 * La population choisie ici décide de l'espace où la personne atterrira à sa
 * première connexion : le littéral `memberships.role` en dérive au signup (cf
 * convex/roles.roleForKind). Défaut « créateur partenaire » = comportement
 * historique inchangé.
 */
export function InviteCreatorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.creators.InviteCreatorDialog");
  const tKind = useTranslations("admin.creators.kind");
  const tHintNs = useTranslations("admin.creators.kindHint");
  const tHint = (key: string) => tHintNs(key as Parameters<typeof tHintNs>[0]);
  const inviteCreator = useProjectMutation(api.creators.inviteCreator);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<CreatorKind>("partner");
  // Le français est PRÉ-SÉLECTIONNÉ mais n'est pas envoyé : normalizeCreatorLocale
  // le ramène à `undefined` côté serveur. On ne stocke que la divergence — « fr »
  // explicite sur toutes les fiches masquerait qui a été invité en anglais.
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [submitting, setSubmitting] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  function reset() {
    setName("");
    setEmail("");
    setKind("partner");
    setLocale(DEFAULT_LOCALE);
    setToken(null);
    setSubmitting(false);
  }

  function handleOpenChange(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await inviteCreator({
        name: name.trim(),
        email: email.trim(),
        kind,
        locale,
      });
      setToken(result.token);
      toast.success(tr("invite", { value: name.trim(), singular: tKind(kind) }));
    } catch (err) {
      toast.error(showError(err, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("inviterUnCreateur")}</DialogTitle>
          <DialogDescription>
            {token === null
              ? tr("creeLaFicheCreateurEt")
              : tr("envoieCeLienAuCreateur")}
          </DialogDescription>
        </DialogHeader>

        {token === null ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="creator-name">{tr("nom")}</Label>
              <Input
                id="creator-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creator-email">{tr("email")}</Label>
              <Input
                id="creator-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("role")}</Label>
              <Select
                value={kind}
                onValueChange={(v) => v !== null && setKind(v as CreatorKind)}
              >
                <SelectTrigger aria-label={tr("role2")} className="w-full">
                  <SelectValue>{tKind(kind)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CREATOR_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {tKind(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {tHint(KIND_HINT_KEYS[kind])}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{tr("langue")}</Label>
              <Select
                value={locale}
                onValueChange={(v) => v !== null && setLocale(v as Locale)}
              >
                <SelectTrigger aria-label={tr("langue2")} className="w-full">
                  <SelectValue>{LOCALE_LABELS[locale]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {LOCALE_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {tr("langueDeLEMail")}
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                {tr("annuler")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                )}
                {tr("inviter")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{tr("lienDActivation")}</Label>
              <CopyableLink token={token} />
              <p className="text-xs text-slate-500">
                {tr("valable14JoursTuPourras")}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>{tr("termine")}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
