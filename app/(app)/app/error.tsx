"use client";

import { useEffect } from "react";
import { RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { convexRequestId } from "@/lib/convex-request-id";

/**
 * Frontière d'ERREUR de l'espace créatrice (/app/*).
 *
 * POURQUOI ELLE EXISTE. Les écrans lisent leurs données avec `useQuery`
 * (convex/react) : une query qui échoue LANCE pendant le rendu. Sans frontière,
 * React démonte tout et la créatrice voit une page blanche, sans onglets ni
 * moyen d'en sortir. Le 18/11/2026, `progression:getMyProgression` expirait
 * (plafond de ~15 s de Convex) et tout l'espace d'une créatrice est tombé.
 *
 * OÙ ELLE EST POSÉE. Au segment `app`, donc SOUS son `layout.tsx` et son
 * `template.tsx` (doc Next : error.js n'enveloppe pas le layout du même
 * segment) : la barre d'onglets et la sidebar restent montées, on peut changer
 * d'écran sans recharger. Contrepartie : une erreur levée DANS le layout
 * (sidebar, switcher, overlay de palier) n'est pas rattrapée ici — d'où le
 * `SansBlocSiEchec` autour de l'overlay de palier.
 *
 * CE QU'ON MONTRE. Ni pile ni message technique : un titre, une action, et le
 * code de requête Convex quand il y en a un — la créatrice peut l'envoyer, et
 * il retrouve l'appel exact dans les journaux de production. Le message complet
 * part dans la console.
 *
 * `unstable_retry` remonte le segment : les `useQuery` démontés se
 * réabonnent et la query est rejouée (cf node_modules/next/dist/docs/01-app/
 * 03-api-reference/03-file-conventions/error.md).
 */
export default function CreatorSpaceError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useTranslations("portal.error");
  useEffect(() => {
    // i18n-exempt: étiquette de journal (console du navigateur), jamais affichée.
    console.error("[espace créatrice] rendu interrompu :", error);
  }, [error]);

  const code = convexRequestId(error) ?? error.digest ?? null;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold text-slate-900">{t("title")}</h1>
        <p className="text-sm text-slate-600">{t("body")}</p>
      </div>
      <Button type="button" onClick={() => unstable_retry()} className="gap-1.5">
        <RotateCcwIcon className="size-4" />
        {t("retry")}
      </Button>
      {code && (
        <p className="max-w-sm text-xs text-slate-400">
          {t("reference")}{" "}
          <code className="font-mono break-all text-slate-500 select-all">{code}</code>
        </p>
      )}
    </div>
  );
}
