"use client";

import { GuideModulesManager } from "@/components/guides/GuideModulesManager";

/**
 * Section admin « Comment ça marche » — gestion des MODULES markdown du projet
 * (CRUD + réordonnancement + published/draft, avec aperçu live). Remplace
 * l'ancien éditeur mono-bloc (projectGuide, conservé en fallback créateur).
 */
export default function GuideAdminPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <GuideModulesManager />
    </div>
  );
}
