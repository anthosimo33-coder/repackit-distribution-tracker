"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLinkIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useConvexError } from "@/lib/use-convex-error";
import { formatDate, formatNumber } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import type { FunctionReturnType } from "convex/server";

type PostDeFiche = NonNullable<FunctionReturnType<typeof api.playbook.getFiche>>["posts"][number];

/**
 * Les POSTS qui prouvent la fiche, relus à chaque ouverture (vues, likes et
 * saves du dernier relevé). On en ajoute un en collant son lien : le serveur
 * retrouve la publication du projet, et une même vidéo publiée sur deux comptes
 * n'entre qu'une fois.
 */
export function PostsFiche({ ficheId, posts }: { ficheId: Id<"playbookFiches">; posts: PostDeFiche[] }) {
  const tr = useTranslations("admin.scripts.PlaybookPosts");
  const showError = useConvexError();
  const loc = useIntlLocale();
  const ajouter = useProjectMutation(api.playbook.ajouterPostFiche);
  const retirer = useProjectMutation(api.playbook.retirerPostFiche);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function valider() {
    if (url.trim() === "") return;
    setBusy(true);
    try {
      await ajouter({ id: ficheId, url });
      setUrl("");
      toast.success(tr("ajoute"));
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  async function enlever(publicationId: Id<"publications">) {
    try {
      await retirer({ id: ficheId, publicationId });
    } catch (e) {
      toast.error(showError(e));
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{tr("titre")}</CardTitle>
        <p className="text-xs text-slate-500">{tr("aide")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void valider()}
            placeholder={tr("lienExemple")}
            aria-label={tr("lien")}
            data-testid="playbook-post-url"
          />
          <Button onClick={valider} disabled={busy || url.trim() === ""} data-testid="playbook-post-ajouter">
            {busy ? <Loader2Icon className="mr-2 size-4 animate-spin" /> : <PlusIcon className="mr-2 size-4" />}
            {tr("ajouter")}
          </Button>
        </div>
        {posts.length === 0 ? (
          <p className="text-sm text-slate-500">{tr("aucun")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="playbook-posts">
            {posts.map((p) => (
              <li key={p.publicationId} className="flex items-start gap-3 px-3 py-2.5" data-testid="playbook-post">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <Badge variant="outline" className="text-[10px] text-slate-500">
                      {p.plateforme}
                    </Badge>
                    <span className="truncate font-medium text-slate-900">{p.compte}</span>
                    <span className="text-xs text-slate-400">{formatDate(p.datePubli, loc)}</span>
                  </div>
                  <p className="truncate text-xs text-slate-500">{p.campagne ?? tr("sansCampagne")}</p>
                  <p className="text-xs tabular-nums text-slate-700" data-testid="playbook-post-chiffres">
                    {p.vues === null
                      ? tr("nonReleve")
                      : [
                          tr("vues", { n: formatNumber(p.vues, loc) }),
                          ...(p.likes !== null ? [tr("likes", { n: formatNumber(p.likes, loc) })] : []),
                          ...(p.saves !== null ? [tr("saves", { n: formatNumber(p.saves, loc) })] : []),
                        ].join(" · ")}
                  </p>
                </div>
                {p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 text-slate-400 hover:text-slate-900"
                    aria-label={tr("ouvrir")}
                  >
                    <ExternalLinkIcon className="size-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void enlever(p.publicationId)}
                  className="mt-0.5 text-slate-400 hover:text-rose-600"
                  aria-label={tr("retirer")}
                  data-testid="playbook-post-retirer"
                >
                  <XIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
