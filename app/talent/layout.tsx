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
 * Shell du portail TALENT (/talent/*) — la personne qui tourne et dépose les
 * rushes bruts. Garde de rôle déléguée à `usePortalGate("talent")` (matrice de
 * redirection unique, partagée avec /app et /clip).
 *
 * MOBILE D'ABORD, et mobile SEULEMENT en pratique : le talent n'ouvrira jamais un
 * desktop. Le shell reste donc volontairement nu — pas de sidebar, pas de barre
 * d'onglets : son espace tient en UN écran (brief permanent, vidéos d'exemple,
 * dépôt, mes dépôts), il n'y a rien à naviguer. La déconnexion est le seul geste
 * d'en-tête.
 *
 * ⚠️ Le talent ne voit ni script, ni compte, ni statistique, ni les rushes d'un
 * autre talent. Ce n'est pas ce layout qui le garantit (il n'est que du confort de
 * routage) mais `talentQuery`/`talentMutation` côté serveur, qui filtrent tout par
 * `ctx.creatorId`.
 */
export default function TalentPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const gate = usePortalGate("talent");

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
