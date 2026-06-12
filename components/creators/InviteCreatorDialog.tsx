"use client";

import { useState } from "react";
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
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { CopyableLink } from "./CopyableLink";

/**
 * P1 Créateurs — invitation d'un créateur (nom + email). En 2 temps : le
 * formulaire crée la fiche "invited" + l'invitation, puis on AFFICHE le lien
 * /join copiable (objectif : créateur opérationnel en 2 minutes).
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
  const [submitting, setSubmitting] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  function reset() {
    setName("");
    setEmail("");
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
      const result = await inviteCreator({ name: name.trim(), email: email.trim() });
      setToken(result.token);
      toast.success(`${name.trim()} invité`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
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
