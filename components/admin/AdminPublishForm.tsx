"use client";

import { useState } from "react";
import type { FunctionArgs } from "convex/server";
import { Loader2Icon, SendIcon } from "lucide-react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  accountUrlCheck,
  type UrlPlateforme,
} from "@/lib/post-url-account";

/** Plateforme attendue par la mutation de publication (dérivée → toujours en phase). */
type Plateforme =
  FunctionArgs<
    typeof api.assignments.confirmPublicationAsAdmin
  >["urls"][number]["platform"];

export type AdminPublishTarget = {
  platform: Plateforme;
  accountHandle: string | null;
};

/** Jour local au format yyyy-mm-dd (valeur/max de l'input date). */
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Statut de cohérence URL↔compte sous un champ — jamais silencieux. */
function AccountCheckLine({
  url,
  platform,
  expected,
}: {
  url: string;
  platform: Plateforme;
  expected: string | null;
}) {
  if (url.trim() === "") return null;
  const check = accountUrlCheck(url, platform as UrlPlateforme, expected);
  if (check.status === "match") {
    return (
      <p className="text-xs text-emerald-600">
        ✓ Compte cohérent (@{check.detected})
      </p>
    );
  }
  if (check.status === "mismatch") {
    return (
      <p className="text-xs font-medium text-amber-700">
        ⚠️ L&apos;URL pointe vers @{check.detected}, pas {expected ? `@${expected}` : "le compte attendu"} — vérifie
        avant de publier.
      </p>
    );
  }
  // unverifiable — EXPLICITE (un silence se lirait comme une validation).
  const why =
    check.reason === "shortlink"
      ? "Lien raccourci — compte non vérifiable ici."
      : check.reason === "no-handle-in-url"
        ? "Compte non présent dans l'URL — non vérifiable."
        : null;
  return why ? <p className="text-xs text-slate-500">{why}</p> : null;
}

/**
 * PUBLICATION (ADMIN) — l'admin colle le(s) lien(s) à la place de la créatrice.
 * DEUX cas : compte GÉRÉ par l'équipe (nominal) et compte de CRÉATRICE en SECOURS
 * (`managed=false` : elle a oublié). MÊME mutation `confirmPublicationAsAdmin`
 * (accrual/horodatage/passage `published` identiques). Ajoute :
 *  - un contrôle URL↔compte par champ (avertissement, JAMAIS blocage) ;
 *  - une DATE de publication réelle corrigeable (défaut aujourd'hui) — évite de
 *    décaler l'ancre de paie quand le lien est collé après-coup.
 */
export function AdminPublishForm({
  assignmentId,
  targets,
  managed,
  notReady,
  buttonTestId,
  onPublished,
}: {
  assignmentId: Id<"assignments">;
  targets: AdminPublishTarget[];
  /** true = compte géré (nominal) ; false = compte créatrice (secours). */
  managed: boolean;
  /** Statut de production ≠ to_publish (À faire / en cours / en revue / à refaire) :
   *  la saisie passera l'assignation DIRECTEMENT en publiée → avertir, pas bloquer. */
  notReady?: boolean;
  buttonTestId?: string;
  onPublished?: () => void;
}) {
  const publish = useProjectMutation(api.assignments.confirmPublicationAsAdmin);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const today = todayLocal();
  const [dateStr, setDateStr] = useState<string>(today);
  const [busy, setBusy] = useState(false);
  /** Message du serveur quand la date précède la création (porte les 2 horodatages). */
  const [backdate, setBackdate] = useState<string | null>(null);

  async function onPublish(allowBackdate = false) {
    const payload = targets.map((t) => ({
      platform: t.platform,
      url: (urls[t.platform] ?? "").trim(),
    }));
    if (payload.some((u) => u.url.length === 0)) {
      toast.error("Colle l'URL du post pour chaque plateforme.");
      return;
    }
    // Date réelle envoyée UNIQUEMENT si antérieure à aujourd'hui (correction). Le
    // jour même = pas d'override → le serveur pose `now` (évite un faux « futur »).
    const publishedAt =
      dateStr && dateStr < today
        ? new Date(`${dateStr}T12:00:00`).getTime()
        : undefined;
    setBusy(true);
    try {
      await publish({
        id: assignmentId,
        urls: payload,
        ...(publishedAt !== undefined ? { publishedAt } : {}),
        ...(allowBackdate ? { allowBackdate: true } : {}),
      });
      toast.success("Publié — la créatrice voit le post et ses performances.");
      setUrls({});
      setBackdate(null);
      onPublished?.();
    } catch (e) {
      const msg = convexErrorMessage(e, "Échec de la publication");
      // Date antérieure à la création : ce n'est pas une saisie fautive, c'est une
      // RÉGULARISATION (post publié hors de l'app). On montre les deux horodatages
      // rendus par le serveur et on laisse l'admin trancher — jamais un mur.
      if (/précède la\s+création/i.test(msg)) setBackdate(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {!managed && (
        <p className="text-xs text-slate-500">
          Normalement la créatrice colle le lien depuis son espace. En secours, tu
          peux le coller ici — même effet (publié, suivi des vues).
        </p>
      )}
      {notReady && (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs font-medium text-amber-700"
          data-testid="admin-publish-not-ready"
        >
          ⚠️ Cette vidéo n&apos;est pas marquée comme prête. Saisir le lien la
          passera directement en <strong>publiée</strong>.
        </p>
      )}
      <div className="space-y-2">
        {targets.map((t) => {
          const val = urls[t.platform] ?? "";
          return (
            <div key={t.platform} className="space-y-1">
              <Label
                htmlFor={`admin-url-${assignmentId}-${t.platform}`}
                className="text-xs"
              >
                {t.platform}
                {t.accountHandle ? (
                  <span className="ml-1 font-mono text-slate-400">
                    {t.accountHandle}
                  </span>
                ) : null}
              </Label>
              <Input
                id={`admin-url-${assignmentId}-${t.platform}`}
                placeholder="https://…"
                value={val}
                onChange={(e) =>
                  setUrls((u) => ({ ...u, [t.platform]: e.target.value }))
                }
              />
              <AccountCheckLine
                url={val}
                platform={t.platform}
                expected={t.accountHandle}
              />
            </div>
          );
        })}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`admin-date-${assignmentId}`} className="text-xs">
          Date de publication réelle
        </Label>
        <Input
          id={`admin-date-${assignmentId}`}
          type="date"
          value={dateStr}
          max={today}
          onChange={(e) => {
            setDateStr(e.target.value);
            setBackdate(null);
          }}
        />
        <p className="text-xs text-slate-500">
          Par défaut aujourd&apos;hui. Corrige-la si le post a été publié avant
          (l&apos;ancre de paie suit la date réelle, pas la saisie).
        </p>
      </div>
      {backdate && (
        <div
          className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
          data-testid="admin-publish-backdate-warning"
        >
          <p className="font-medium">⚠️ {backdate}</p>
          <p>
            Normal si tu régularises un post publié hors de l&apos;app. La date
            réelle sera conservée telle quelle.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void onPublish(true)}
            data-testid="admin-publish-backdate-confirm"
          >
            Publier quand même à cette date
          </Button>
        </div>
      )}
      <Button
        onClick={() => void onPublish()}
        disabled={busy}
        className="w-full"
        data-testid={buttonTestId}
      >
        {busy ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <SendIcon className="mr-2 size-4" />
        )}
        {managed ? "Publier (coller le lien)" : "Publier à la place de la créatrice"}
      </Button>
    </div>
  );
}
