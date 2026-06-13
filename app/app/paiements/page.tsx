"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletIcon } from "lucide-react";

/**
 * P7 — placeholder « Mes paiements ». Les montants réels (accrual sur posts
 * validés) arrivent au chantier paiements.
 */
export default function CreatorPaiementsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Mes paiements
      </h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletIcon className="size-4 text-slate-400" />
            Bientôt disponible
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-500">
          <p>
            Le détail de tes gains (posts validés, vues comptabilisées, montants
            dus et versés) apparaîtra ici dès le prochain chantier.
          </p>
          <p>
            En attendant, chaque brief affiche le calculateur de gains basé sur
            sa grille de rémunération.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
