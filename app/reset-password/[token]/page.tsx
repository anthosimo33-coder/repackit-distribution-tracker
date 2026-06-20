"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * Reset mot de passe (Voie B) — route PUBLIQUE (pré-session, comme /join,
 * exclue du gating proxy + rendue nue par AppShell). Le créateur arrive ici via
 * un lien à usage unique généré par l'admin et transmis (WhatsApp).
 *
 * Token invalide / expiré / déjà utilisé → getPasswordResetPreview renvoie le
 * même `{ status: "invalid" }` (aucun leak) → message propre, pas de formulaire.
 * Token valide → formulaire (nouveau mot de passe + confirmation) → l'action
 * resetPasswordWithToken re-hashe le secret, marque le token utilisé, invalide
 * les sessions, puis redirection /login.
 */
export default function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const preview = useQuery(api.passwordReset.getPasswordResetPreview, { token });
  const resetPassword = useAction(api.passwordReset.resetPasswordWithToken);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (preview?.status !== "valid") return;
    setError(null);
    if (password.length < 8) {
      setError("Le mot de passe doit faire au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ token, newPassword: password });
      setDone(true);
      // Laisse le message de succès visible un instant puis bascule sur /login.
      setTimeout(() => router.replace("/login"), 1500);
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Réinitialisation impossible. Demande un nouveau lien à ton administrateur.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        {preview === undefined ? (
          <CardContent className="flex items-center justify-center py-16">
            <Loader2Icon className="size-6 animate-spin text-slate-400" />
          </CardContent>
        ) : done ? (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2Icon className="size-5 text-emerald-600" />
                Mot de passe réinitialisé
              </CardTitle>
              <CardDescription>
                Tu peux maintenant te connecter avec ton nouveau mot de passe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/login"
                className={buttonVariants({ className: "w-full" })}
              >
                Se connecter
              </Link>
            </CardContent>
          </>
        ) : preview.status === "invalid" ? (
          <>
            <CardHeader>
              <CardTitle>Lien invalide</CardTitle>
              <CardDescription>
                Ce lien de réinitialisation est invalide ou expiré. Demande un
                nouveau lien à ton administrateur.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/login"
                className={buttonVariants({ className: "w-full" })}
              >
                Se connecter
              </Link>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BrandMark size={32} />
                Réinitialise ton mot de passe
              </CardTitle>
              <CardDescription>
                {preview.projectName
                  ? `Choisis un nouveau mot de passe pour ${preview.projectName}.`
                  : "Choisis un nouveau mot de passe."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">Nouveau mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirmer le mot de passe</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-rose-600">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2Icon className="size-4 animate-spin" />}
                  Réinitialiser le mot de passe
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
