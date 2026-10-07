"use client";

import dynamic from "next/dynamic";
import { MessagesSquareIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePermissions } from "@/components/project/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Sans rendu serveur : l'éditeur lit son brouillon dans le stockage local dès
// son premier rendu, et la mise en page de l'écran se mesure dans le DOM.
const ConvStudio = dynamic(
  () => import("@/components/admin/insta-conv/ConvStudio").then((m) => m.ConvStudio),
  { ssr: false, loading: () => <Skeleton className="h-[672px] w-full" /> },
);

/**
 * CONVERSATIONS INSTAGRAM — reproduit une capture de DM pour les carrousels.
 * Outil 100 % navigateur (aucune donnée serveur), réservé aux ADMINS : le
 * gate est du confort, il n'y a rien derrière à protéger côté serveur.
 */
export default function ConversationsPage() {
  const tr = useTranslations("admin.ops.ConvStudio");
  const { role, chargement } = usePermissions();

  if (chargement) return <Skeleton className="h-96 w-full" />;
  if (role !== "admin" && role !== "superadmin") {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="text-sm font-medium text-slate-900">{tr("accesRefuse")}</p>
          <p className="mt-1 text-sm text-slate-500">{tr("reserveAdmins")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
          <MessagesSquareIcon className="size-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tr("titre")}</h1>
          <p className="text-sm text-slate-500">{tr("sousTitre")}</p>
        </div>
      </header>
      <ConvStudio />
    </div>
  );
}
