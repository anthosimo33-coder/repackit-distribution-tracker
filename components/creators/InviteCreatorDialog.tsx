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
import { convexErrorMessage } from "@/lib/convex-error";
import {
  CREATOR_KINDS,
  KIND_LABELS,
  type CreatorKind,
} from "@/convex/roles";
import { CopyableLink } from "./CopyableLink";

/** Une ligne d'explication par population — ce que la personne verra en se
 *  connectant. Vit ici (formulation UI), pas dans convex/roles (algèbre). */
const KIND_HINTS: Record<CreatorKind, string> = {
  partner:
    "Publie sur ses propres comptes, avec ses missions et sa rémunération au CPM.",
  talent: "Dépose ses rushes bruts depuis son téléphone. Ne voit aucun script.",
  clipper:
    "Déclare ses comptes, monte les rushes de ses talents, publie et colle le lien.",
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
      toast.success(`${name.trim()} invité — ${KIND_LABELS[kind].singular}`);
    } catch (err) {
      toast.error(convexErrorMessage(err, "Une erreur est survenue."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter un créateur</DialogTitle>
          <DialogDescription>
            {token === null
              ? "Crée la fiche créateur et génère un lien d'activation."
              : "Envoie ce lien au créateur. Il choisit son mot de passe et accède à son espace."}
          </DialogDescription>
        </DialogHeader>

        {token === null ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="creator-name">Nom *</Label>
              <Input
                id="creator-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creator-email">Email *</Label>
              <Input
                id="creator-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rôle *</Label>
              <Select
                value={kind}
                onValueChange={(v) => v !== null && setKind(v as CreatorKind)}
              >
                <SelectTrigger aria-label="Rôle" className="w-full">
                  <SelectValue>{KIND_LABELS[kind].singular}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CREATOR_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k].singular}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">{KIND_HINTS[kind]}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Langue *</Label>
              <Select
                value={locale}
                onValueChange={(v) => v !== null && setLocale(v as Locale)}
              >
                <SelectTrigger aria-label="Langue" className="w-full">
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
                Langue de l&apos;e-mail d&apos;invitation et de son espace.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                )}
                Inviter
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Lien d&apos;activation</Label>
              <CopyableLink token={token} />
              <p className="text-xs text-slate-500">
                Valable 14 jours. Tu pourras le régénérer depuis la fiche du
                créateur s&apos;il expire.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Terminé</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
