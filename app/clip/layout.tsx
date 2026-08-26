"use client";

import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOutIcon } from "lucide-react";
import { AccentStyle } from "@/components/project/AccentStyle";
import { ClipperProjectProvider } from "@/components/clip/ClipperProjectProvider";
import {
  PortalEmpty,
  PortalPending,
  usePortalGate,
} from "@/components/portal/PortalRoleGate";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

/**
 * Shell du portail CLIPPEUR (/clip/*) — celui qui déclare ses comptes, les
 * chauffe, monte les rushes de SES talents, soumet et publie. Garde de rôle
 * déléguée à `usePortalGate("clipper")` (matrice de redirection unique).
 *
 * PAS de navigation, délibérément : le clippeur a deux objets — ses comptes et
 * ses clips — et ils tiennent sur une page qui défile. Une bottom-nav pour deux
 * sections figerait des onglets qu'on ne sait pas encore remplir (ses gains
 * viennent au chantier pricing). La fiche d'un clip est une route à part
 * (`/clip/clips/[id]`) parce qu'un montage se fait écran plein, pas dans une
 * carte de liste.
 *
 * ⚠️ Un clippeur ne voit que SES comptes et les rushes des talents qui lui sont
 * assignés. Garantie serveur (`clipperQuery`/`clipperMutation`, filtrage par
 * `ctx.creatorId`), pas par ce layout.
 */
export default function ClipPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("portal");
  const router = useRouter();
  const { signOut } = useAuthActions();
  const gate = usePortalGate("clipper");

  if (gate.state === "pending") return <PortalPending />;
  // `projectId` null est traité comme « pas d'espace » : les écrans clippeur
  // n'existent qu'au sein d'un projet, et les rendre sans lui produirait une
  // première requête en échec plutôt qu'un message (même choix que le talent).
  if (gate.state === "empty" || gate.projectId === null) return <PortalEmpty />;

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  const accent = gate.accentColor || "#FF5200";

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ "--primary": accent, "--ring": accent } as React.CSSProperties}
    >
      <AccentStyle accent={accent} />
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4">
        <span className="truncate text-sm font-medium text-slate-900">
          {gate.creatorName ?? t("mySpace")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleSignOut}
          aria-label={t("sidebar.logout")}
          className="shrink-0 text-slate-600 hover:text-slate-900"
        >
          <LogOutIcon className="size-5" />
        </Button>
      </header>
      <main className="overflow-x-hidden">
        <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
          <ClipperProjectProvider projectId={gate.projectId}>
            {children}
          </ClipperProjectProvider>
        </div>
      </main>
    </div>
  );
}
