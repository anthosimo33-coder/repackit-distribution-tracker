"use client";

import { useState, useSyncExternalStore } from "react";
import { useAction, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import {
  CheckIcon,
  Loader2Icon,
  MonitorIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/brand/BrandMark";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * CONSENTEMENT OAUTH — la page où Claude envoie la personne pour autoriser le
 * connecteur (cf convex/mcpOAuth.ts).
 *
 * Ce que l'écran doit rendre impossible à mal lire :
 *   - À QUI part l'accès. Le nom d'une application est déclaré par elle-même :
 *     l'écran ne dit « Claude » que si le code repart vers claude.ai, et montre
 *     TOUJOURS l'hôte de retour ;
 *   - CE QUI est accordé : lire, avec ses droits, rien de plus ;
 *   - comment le reprendre.
 *
 * Jamais dans un cadre : une page d'autorisation encadrée par un autre site
 * peut être cliquée à l'insu de la personne. Pas d'en-tête de sécurité ici
 * (next.config n'en pose aucun), donc la page le vérifie elle-même et n'offre
 * alors aucun bouton.
 */
/** Paramètres de la demande, tels que la page les a lus dans l'URL. */
export type ParametresAutorisation = FunctionArgs<typeof api.mcpOAuth.describeAuthorization>;

export function OAuthConsent({ params }: { params: ParametresAutorisation }) {
  const tr = useTranslations("admin.common.OAuthConsent");
  const trDomaine = useTranslations("admin.common.McpAccessDialog.domaine");
  const showError = useConvexError();
  const demande = useQuery(api.mcpOAuth.describeAuthorization, params);
  const approuver = useAction(api.mcpOAuth.approveAuthorization);
  const [envoi, setEnvoi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const encadre = useSyncExternalStore(
    () => () => {},
    () => window.top !== window.self,
    () => false,
  );

  async function handleAutoriser() {
    setError(null);
    setEnvoi(true);
    try {
      const { url } = await approuver(params);
      window.location.assign(url);
    } catch (err) {
      setError(showError(err, tr("autorisationImpossible")));
      setEnvoi(false);
    }
  }

  function handleRefuser(url: string) {
    setEnvoi(true);
    window.location.assign(url);
  }

  let contenu: React.ReactNode;
  if (demande === undefined) {
    contenu = (
      <CardContent className="flex items-center justify-center py-16">
        <Loader2Icon className="size-6 animate-spin text-slate-400" />
      </CardContent>
    );
  } else if (encadre) {
    contenu = <Message titre={tr("encadreTitre")} texte={tr("encadre")} />;
  } else if (demande.kind === "client_inconnu" || demande.kind === "redirection_invalide") {
    contenu = (
      <Message
        titre={tr("lienInvalideTitre")}
        texte={
          demande.kind === "client_inconnu" ? tr("clientInconnu") : tr("redirectionInvalide")
        }
      />
    );
  } else if (demande.kind === "demande_invalide") {
    contenu = (
      <Message titre={tr("demandeInvalideTitre")} texte={tr("demandeInvalide")}>
        <a href={demande.retour} className={buttonVariants({ variant: "outline", className: "w-full" })}>
          {tr("retourner", { host: demande.hote })}
        </a>
      </Message>
    );
  } else if (demande.kind === "non_autorise") {
    contenu = (
      <Message titre={tr("nonAutoriseTitre")} texte={tr("nonAutorise")}>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={envoi}
          onClick={() => handleRefuser(demande.refus)}
        >
          {tr("retourner", { host: demande.hote })}
        </Button>
      </Message>
    );
  } else {
    const nom = demande.nomClient || tr("sansNom");
    contenu = (
      <>
        <CardHeader className="space-y-3">
          <BrandMark size={32} />
          <CardTitle className="text-lg">
            <h1>{demande.claude ? tr("titreClaude") : tr("titreApp", { name: nom })}</h1>
          </CardTitle>
          <CardDescription>{tr("compte", { account: demande.compte })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {demande.claude ? (
            <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
              <span>{tr("verifie", { host: demande.hote })}</span>
            </p>
          ) : (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="flex items-start gap-2">
                <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
                <span>{tr("nonVerifie")}</span>
              </p>
              {demande.boucleLocale && (
                <p className="flex items-start gap-2">
                  <MonitorIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{tr("boucleLocale")}</span>
                </p>
              )}
              <p className="font-medium" data-testid="oauth-hote-retour">
                {tr("retourVers", { host: demande.hote })}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">{tr("ceQuiEstAccorde")}</p>
            <ul className="space-y-1.5 text-sm text-slate-600">
              {[
                tr("droitLecture"),
                // Reconnexion depuis le même hôte : les domaines ouverts à l'écriture sur
                // la connexion précédente sont repris — l'écran le dit, nommément.
                demande.reprise.length > 0
                  ? tr("droitReprise", {
                      host: demande.hote,
                      domains: demande.reprise.map((d) => trDomaine(`${d}.titre`)).join(", "),
                    })
                  : tr("droitAucuneEcriture"),
                tr("droitRevocable"),
              ].map((d) => (
                <li key={d} className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>

          {error && (
            <p role="alert" className="text-sm text-rose-600">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={envoi}
              onClick={() => handleRefuser(demande.refus)}
            >
              {tr("refuser")}
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={envoi}
              onClick={() => void handleAutoriser()}
            >
              {envoi && <Loader2Icon className="size-4 animate-spin" />}
              {tr("autoriser")}
            </Button>
          </div>
          {envoi && (
            <p role="status" className="text-center text-xs text-slate-500">
              {tr("redirection", { host: demande.hote })}
            </p>
          )}
        </CardContent>
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">{contenu}</Card>
    </div>
  );
}

function Message({
  titre,
  texte,
  children,
}: {
  titre: string;
  texte: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <CardHeader className="space-y-3">
        <BrandMark size={32} />
        <CardTitle className="text-lg">
          <h1>{titre}</h1>
        </CardTitle>
        <CardDescription>{texte}</CardDescription>
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </>
  );
}
