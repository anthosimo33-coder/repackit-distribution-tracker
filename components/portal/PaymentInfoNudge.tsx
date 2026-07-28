"use client";

import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { WalletIcon, ArrowRightIcon } from "lucide-react";
import { formatMoney } from "@/lib/format-rate";
import { amountOwed, shouldPromptPaymentInfo } from "@/lib/creator-payment";
import { portalHref } from "@/lib/view-as";
import { useMyProfile, useMyPayments } from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";

/**
 * QW3 — bandeau d'action « coordonnées de paiement manquantes ». S'affiche
 * UNIQUEMENT si le créateur a des gains DUS (> 0) ET n'a pas renseigné sa méthode
 * + ses coordonnées de paiement ; sinon il ne rend rien. Sans ces coordonnées,
 * l'admin ne peut pas le payer et rien d'autre ne le lui signale.
 *
 * LECTURE seule : getMyProfile + getMyPayments (montant = total dû non payé déjà
 * calculé serveur, jamais recalculé ici). Réutilisé sur le dashboard et
 * /paiements ; Convex mutualise les souscriptions identiques → pas de sur-fetch.
 * Renvoie vers /app/profil (section coordonnées de paiement).
 */
export function PaymentInfoNudge({ projectId }: { projectId: Id<"projects"> }) {
  const profile = useMyProfile(projectId);
  const payments = useMyPayments(projectId);
  const base = usePortalBase();
  // Devise de la paie créatrices ($ Snytch ; null → sans symbole).
  const payCurrency = useCreatorProject().current.payCurrency;

  if (!shouldPromptPaymentInfo(profile, payments)) return null;

  return (
    <Link
      href={portalHref(base, "/profil")}
      data-testid="payment-info-nudge"
      className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
        <WalletIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold text-amber-900">
          Ajoute tes coordonnées de paiement
        </p>
        <p className="text-sm text-amber-800">
          Sans elles, on ne peut pas te verser tes{" "}
          {formatMoney(amountOwed(payments), payCurrency)}.
        </p>
      </div>
      <ArrowRightIcon className="size-4 shrink-0 text-amber-700" />
    </Link>
  );
}
