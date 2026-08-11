"use client";

import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOutIcon } from "lucide-react";
import { AccentStyle } from "@/components/project/AccentStyle";
import {
  PortalEmpty,
  PortalPending,
  usePortalGate,
} from "@/components/portal/PortalRoleGate";
import { Button } from "@/components/ui/button";

/**
 * Shell du portail CLIPPEUR (/clip/*) — celui qui déclare ses comptes, les
 * chauffe, monte les rushes de SES talents, soumet et publie. Garde de rôle
 * déléguée à `usePortalGate("clipper")` (matrice de redirection unique).
 *
 * Shell nu pour l'instant : la navigation (ses comptes / sa file de rushes / ses
 * gains) est posée par le chantier « espace clippeur », avec la même mécanique
 * mobile que le portail partenaire (bottom nav < md, sidebar ≥ md). On ne
 * pré-construit pas cette navigation ici pour ne pas figer des onglets vides.
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
  const router = useRouter();
  const { signOut } = useAuthActions();
  const gate = usePortalGate("clipper");

  if (gate.state === "pending") return <PortalPending />;
  if (gate.state === "empty") return <PortalEmpty />;

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
          {gate.creatorName ?? "Mon espace"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleSignOut}
          aria-label="Se déconnecter"
          className="shrink-0 text-slate-600 hover:text-slate-900"
        >
          <LogOutIcon className="size-5" />
        </Button>
      </header>
      <main className="overflow-x-hidden">
        <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
