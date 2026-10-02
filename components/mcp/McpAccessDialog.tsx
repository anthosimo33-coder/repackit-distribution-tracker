"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowUpRightIcon, KeyRoundIcon, Loader2Icon, PlugIcon } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * CONNECTER CLAUDE — deux voies vers le serveur MCP de l'app.
 *
 * LE CONNECTEUR (claude.ai, Claude Desktop, mobile) : une adresse à coller dans
 * Claude, qui lance ensuite la connexion OAuth et renvoie la personne sur la
 * page de consentement de l'app (convex/mcpOAuth.ts). Rien à copier d'autre.
 * Les accès ainsi accordés sont listés ici, et révocables.
 *
 * LA CLÉ PERSONNELLE (Claude Code, scripts) :
 *
 * La clé en clair n'existe qu'au moment de sa création (seule son empreinte est
 * stockée) : l'écran la montre ALORS, avec les commandes prêtes à coller, et ne
 * pourra plus jamais la réafficher. La liste ne montre que le début de chaque
 * clé, pour la reconnaître et la révoquer.
 */
export function McpAccessDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {/* Monté à l'ouverture : une clé affichée ne survit pas à la fermeture. */}
        {open && <Contenu />}
      </DialogContent>
    </Dialog>
  );
}

function Contenu() {
  const tr = useTranslations("admin.common.McpAccessDialog");
  const loc = useIntlLocale();
  const showError = useConvexError();
  const cles = useQuery(api.mcpTokens.listMyMcpTokens, {});
  const endpoint = useQuery(api.mcpTokens.getMcpEndpoint, {});
  const oauth = useQuery(api.mcpOAuth.getOAuthStatus, {});
  const applications = useQuery(api.mcpOAuth.listMyOAuthGrants, {});
  const creer = useAction(api.mcpTokens.createMcpToken);
  const revoquer = useMutation(api.mcpTokens.revokeMcpToken);
  const couperAcces = useMutation(api.mcpOAuth.revokeOAuthGrant);
  const ecritureCle = useMutation(api.mcpTokens.setMcpTokenWriteScopes);
  const ecritureApp = useMutation(api.mcpOAuth.setOAuthGrantWriteScopes);
  const journal = useQuery(api.mcpTokens.listMyMcpWrites, {});
  const [nom, setNom] = useState("Claude");
  const [creation, setCreation] = useState(false);
  const [nouvelle, setNouvelle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreation(true);
    try {
      const { token } = await creer({ name: nom });
      setNouvelle(token);
    } catch (err) {
      setError(showError(err, tr("creationImpossible")));
    } finally {
      setCreation(false);
    }
  }

  async function handleRevoquer(id: Id<"mcpTokens">, nomCle: string) {
    try {
      await revoquer({ tokenId: id });
      toast.success(tr("cleRevoquee", { name: nomCle }));
    } catch (err) {
      toast.error(showError(err, tr("revocationImpossible")));
    }
  }

  /** Autoriser ou couper les modifications de la Compta — seulement d'ici, jamais depuis Claude. */
  async function handleEcriture(
    cible: { kind: "token"; id: Id<"mcpTokens"> } | { kind: "oauth"; id: Id<"mcpOAuthGrants"> },
    nomCible: string,
    autorise: boolean,
  ) {
    const scopes = autorise ? ["compta"] : [];
    try {
      if (cible.kind === "token") await ecritureCle({ tokenId: cible.id, scopes });
      else await ecritureApp({ grantId: cible.id, scopes });
      toast.success(autorise ? tr("ecritureOuverte", { name: nomCible }) : tr("ecritureCoupee", { name: nomCible }));
    } catch (err) {
      toast.error(showError(err, tr("ecritureImpossible")));
    }
  }

  async function handleCouper(id: Id<"mcpOAuthGrants">, nomApp: string) {
    try {
      await couperAcces({ grantId: id });
      toast.success(tr("accesCoupe", { name: nomApp }));
    } catch (err) {
      toast.error(showError(err, tr("revocationImpossible")));
    }
  }

  const url = endpoint ?? "";
  // Les deux façons de brancher Claude, avec LA clé qu'on vient de créer.
  // Claude Desktop passe par mcp-remote, qui relaie un serveur distant et son
  // en-tête ; la clé y vit dans une variable d'environnement, pour ne pas
  // dépendre de la façon dont chaque système découpe les arguments.
  const commandes =
    nouvelle === null
      ? null
      : {
          // i18n-exempt: commande shell à coller telle quelle, pas du texte d'interface
          code: `claude mcp add --transport http jarvia ${url} --header "Authorization: Bearer ${nouvelle}"`,
          desktop: JSON.stringify(
            {
              mcpServers: {
                jarvia: {
                  command: "npx",
                  args: ["-y", "mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"],
                  env: { AUTH_HEADER: `Bearer ${nouvelle}` },
                },
              },
            },
            null,
            2,
          ),
        };
  const date = (ts: number) => new Date(ts).toLocaleDateString(loc);
  const instant = (ts: number) =>
    new Intl.DateTimeFormat(loc, { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ts);
  const mois = (m: string) =>
    new Intl.DateTimeFormat(loc, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${m}-01T00:00:00Z`));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{tr("titre")}</DialogTitle>
        <DialogDescription>{tr("description")}</DialogDescription>
      </DialogHeader>

      <div className="min-w-0 space-y-5 py-2">
        {oauth !== undefined && (
          <section className="space-y-1.5" aria-label={tr("connecteurTitre")}>
            <p className="text-sm font-medium text-slate-700">{tr("connecteurTitre")}</p>
            {oauth.pret ? (
              <>
                <p className="text-xs text-slate-500">{tr("connecteurAide")}</p>
                <div className="flex items-center gap-2">
                  <code
                    data-testid="mcp-adresse-connecteur"
                    className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800"
                  >
                    {url}
                  </code>
                  <CopyButton text={url} label={tr("copier")} copiedLabel={tr("copie")} />
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">{tr("connecteurIndisponible")}</p>
            )}
          </section>
        )}

        <p className="text-sm font-medium text-slate-700">{tr("cleTitre")}</p>
        {nouvelle === null || commandes === null ? (
          <form onSubmit={handleCreer} className="space-y-1.5">
            <Label htmlFor="mcp-key-name">{tr("nomDeLaCle")}</Label>
            <div className="flex gap-2">
              <Input
                id="mcp-key-name"
                value={nom}
                maxLength={60}
                onChange={(e) => setNom(e.target.value)}
                placeholder={tr("nomPlaceholder")}
              />
              <Button type="submit" disabled={creation}>
                {creation ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <KeyRoundIcon className="size-4" />
                )}
                {tr("creerUneCle")}
              </Button>
            </div>
            <p className="text-xs text-slate-500">{tr("aideDroits")}</p>
          </form>
        ) : (
          <div className="space-y-4">
            <div
              role="status"
              className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
            >
              <p className="text-sm font-medium text-amber-900">{tr("copieMaintenant")}</p>
              <div className="flex items-center gap-2">
                <code
                  data-testid="mcp-cle-en-clair"
                  className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs text-slate-800"
                >
                  {nouvelle}
                </code>
                <CopyButton text={nouvelle} label={tr("copier")} copiedLabel={tr("copie")} />
              </div>
            </div>

            <Bloc
              titre={tr("claudeCode")}
              texte={commandes.code}
              copier={tr("copier")}
              copie={tr("copie")}
            />
            <Bloc
              titre={tr("claudeDesktop")}
              aide={tr("aideDesktop")}
              texte={commandes.desktop}
              copier={tr("copier")}
              copie={tr("copie")}
            />

            <Button type="button" variant="outline" size="sm" onClick={() => setNouvelle(null)}>
              {tr("termine")}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{tr("applicationsConnectees")}</p>
          {applications === undefined ? null : applications.length === 0 ? (
            <p className="text-sm text-slate-500">{tr("aucuneApplication")}</p>
          ) : (
            <ul
              aria-label={tr("applicationsConnectees")}
              className="divide-y divide-slate-100 rounded-lg border border-slate-200"
            >
              {applications.map((a) => {
                const nomApp = a.clientName || tr("sansNom");
                return (
                  <li key={a._id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {nomApp} <span className="font-normal text-slate-500">· {a.hote}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {tr("connecteeLe", { date: date(a.createdAt) })}
                        {" · "}
                        {a.lastUsedAt === null
                          ? tr("jamaisUtilisee")
                          : tr("utiliseeLe", { date: date(a.lastUsedAt) })}
                      </p>
                    </div>
                    <Ecriture
                      on={a.writeScopes.includes("compta")}
                      nom={nomApp}
                      onChange={(v) => void handleEcriture({ kind: "oauth", id: a._id }, nomApp, v)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                      onClick={() => void handleCouper(a._id, nomApp)}
                    >
                      {tr("couper")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{tr("mesCles")}</p>
          {cles === undefined ? null : cles.length === 0 ? (
            <p className="text-sm text-slate-500">{tr("aucuneCle")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {cles.map((c) => (
                <li key={c._id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono">{c.prefix}…</span>
                      {" · "}
                      {tr("creeeLe", { date: date(c.createdAt) })}
                      {" · "}
                      {c.lastUsedAt === null
                        ? tr("jamaisUtilisee")
                        : tr("utiliseeLe", { date: date(c.lastUsedAt) })}
                    </p>
                  </div>
                  <Ecriture
                    on={c.writeScopes.includes("compta")}
                    nom={c.name}
                    onChange={(v) => void handleEcriture({ kind: "token", id: c._id }, c.name, v)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    onClick={() => void handleRevoquer(c._id, c.name)}
                  >
                    {tr("revoquer")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">{tr("ecritureAide")}</p>
        </div>

        <div className="space-y-2" data-testid="mcp-journal">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">{tr("journalTitre")}</p>
            <span className="text-xs text-slate-400">{tr("journalPeriode")}</span>
          </div>
          {journal === undefined ? null : journal.length === 0 ? (
            <p className="text-sm text-slate-500">{tr("journalVide")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {journal.map((l) => (
                <li key={l._id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2">
                  <span className="pt-0.5 text-xs tabular-nums text-slate-400">{instant(l.at)}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">
                      <span className="font-medium">{tr(`outil.${l.tool as "ventiler_virement"}`)}</span>
                      <span className="text-slate-500"> — {l.summary}</span>
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {l.via.name}
                      {l.project ? ` · ${l.project.name}` : ""}
                    </p>
                  </div>
                  {l.project ? (
                    <Link
                      href={`/admin/${l.project.slug}/compta`}
                      prefetch={false}
                      className="inline-flex items-center gap-1 pt-0.5 text-xs font-medium text-primary hover:underline"
                    >
                      {l.month
                        ? tr(`section.${l.section as "transfers"}`, { mois: mois(l.month) })
                        : tr(`section.${l.section as "treasury"}`)}
                      <ArrowUpRightIcon className="size-3" />
                    </Link>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-400">{tr("journalAide")}</p>
        </div>
      </div>
    </>
  );
}

/** « Peut modifier la Compta » : éteint par défaut, ne s'allume que d'ici. */
function Ecriture({ on, nom, onChange }: { on: boolean; nom: string; onChange: (v: boolean) => void }) {
  const tr = useTranslations("admin.common.McpAccessDialog");
  return (
    <label
      className={
        on
          ? "inline-flex shrink-0 items-center gap-2 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary"
          : "inline-flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-500"
      }
    >
      <Switch checked={on} onCheckedChange={onChange} aria-label={tr("ecritureAria", { name: nom })} />
      {on ? tr("ecritureCompta") : tr("lectureSeule")}
    </label>
  );
}

function Bloc({
  titre,
  aide,
  texte,
  copier,
  copie,
}: {
  titre: string;
  aide?: string;
  texte: string;
  copier: string;
  copie: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">{titre}</p>
        <CopyButton text={texte} label={copier} copiedLabel={copie} />
      </div>
      {aide && <p className="text-xs text-slate-500">{aide}</p>}
      <pre className="max-h-48 overflow-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all text-slate-100">
        {texte}
      </pre>
    </div>
  );
}

/**
 * Entrée du pied de barre latérale. Le bouton porte son dialog : la barre n'a
 * qu'une ligne à ajouter, et rien à savoir des clés.
 */
export function ConnecterClaudeBouton({ collapsed }: { collapsed: boolean }) {
  const tr = useTranslations("admin.common.McpAccessDialog");
  const [open, setOpen] = useState(false);
  const bouton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setOpen(true)}
      className={
        collapsed
          ? "w-full justify-center px-0 text-slate-600 hover:text-slate-900"
          : "w-full justify-start gap-2 text-slate-600 hover:text-slate-900"
      }
      aria-label={tr("connecterClaude")}
    >
      <PlugIcon className="size-4" />
      {!collapsed && <span>{tr("connecterClaude")}</span>}
    </Button>
  );
  return (
    <>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger render={bouton} />
          <TooltipContent side="right" sideOffset={8}>
            {tr("connecterClaude")}
          </TooltipContent>
        </Tooltip>
      ) : (
        bouton
      )}
      <McpAccessDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
