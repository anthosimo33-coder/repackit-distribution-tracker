"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

/**
 * « Mot de passe oublié ? » en libre-service, sous le champ mot de passe des
 * deux pages de connexion (/login, sombre, et /[projectSlug]/login, claire).
 *
 * Réutilise l'email déjà saisi dans le formulaire : rien à retaper. Le serveur
 * (passwordReset.requestPasswordReset) répond pareil que l'email ait un compte
 * ou non — le message de confirmation est donc conditionnel (« si un compte
 * existe… ») et ne doit jamais devenir affirmatif.
 *
 * Bouton `type="button"` : le panneau vit DANS le <form> de connexion, un
 * submit enverrait la connexion avec un mot de passe vide.
 */
export function ForgotPasswordPanel({
  email,
  tone,
}: {
  email: string;
  tone: "dark" | "light";
}) {
  const t = useTranslations("auth.forgot");
  const request = useMutation(api.passwordReset.requestPasswordReset);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = email.trim();
  // Changer l'email après un envoi rouvre la demande pour le nouvel email.
  const sent = sentTo !== null && sentTo === typed;

  async function send() {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) {
      setError(t("needEmail"));
      return;
    }
    setSending(true);
    try {
      await request({ email: typed });
      setSentTo(typed);
    } catch {
      setError(t("failed"));
    } finally {
      setSending(false);
    }
  }

  const dark = tone === "dark";
  return (
    <div
      id="forgot-panel"
      className={cn(
        "space-y-2 rounded-lg border px-3 py-2.5 text-[13px] leading-snug",
        dark
          ? "border-[#9d7fe8]/25 bg-[#7c5cbf]/10 text-[#f4f4f5]/80"
          : "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {sent ? (
        <>
          <p role="status" className="m-0">
            {t("sent", { email: typed })}
          </p>
          <p className={cn("m-0", dark ? "text-[#f4f4f5]/60" : "text-slate-500")}>
            {t("adminFallback")}
          </p>
        </>
      ) : (
        <>
          <p className="m-0">{t("intro")}</p>
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold disabled:opacity-70",
              dark
                ? "bg-[#f4f4f5] text-[#0a0a0b] hover:bg-white"
                : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            {sending && <Loader2Icon className="size-3.5 animate-spin" />}
            {t("send")}
          </button>
          {error && (
            <p
              role="alert"
              className={cn("m-0", dark ? "text-rose-300" : "text-rose-600")}
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
