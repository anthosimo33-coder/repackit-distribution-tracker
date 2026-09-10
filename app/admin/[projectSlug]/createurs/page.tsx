"use client";

import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import { InviteCreatorDialog } from "@/components/creators/InviteCreatorDialog";
import { DeleteCreatorDialog } from "@/components/creators/DeleteCreatorDialog";
import { CreatorsDirectory } from "@/components/creators/CreatorsDirectory";
import { AppariementSection } from "@/components/creators/AppariementSection";

/**
 * ÉCRAN CRÉATEURS — coquille.
 *
 * La page ne porte plus que ce qui lui appartient vraiment : le titre, le bouton
 * d'invitation, et les deux modales. Tout ce qui relève de la LISTE (recherche,
 * filtres croisés, regroupement, sélection, colonnes) vit dans
 * `CreatorsDirectory` ; le classement du cycle est replié dans son bandeau.
 *
 * `AppariementSection` reste EN DESSOUS de la liste et ne se rend que sur un
 * projet qui a des talents ou des clippeurs : sur un projet 100 % partenaires,
 * elle n'existe pas, et l'écran commence donc par les créateurs.
 */
export default function CreateursPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"creators">;
    name: string;
  } | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Créateurs
        </h1>
        <Button onClick={() => setInviteOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          Inviter un créateur
        </Button>
      </header>

      <CreatorsDirectory
        onInvite={() => setInviteOpen(true)}
        onDelete={setDeleteTarget}
      />

      {/* Appariement clippeur ↔ talent. Ne s'affiche que sur un projet qui a des
          talents ou des clippeurs — invisible sur un projet 100 % partenaires. */}
      <AppariementSection />

      <InviteCreatorDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      {deleteTarget && (
        <DeleteCreatorDialog
          creatorId={deleteTarget.id}
          creatorName={deleteTarget.name}
          open={deleteTarget !== null}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
