"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
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
import { Loader2Icon } from "lucide-react";

/**
 * P1 Créateurs — onboarding par lien d'invitation (route PUBLIQUE, exclue du
 * gating proxy + rendue nue par AppShell). Un créateur doit être opérationnel
 * en 2 minutes : un seul champ (mot de passe), l'email est pré-rempli depuis
 * le token et NON modifiable.
 *
 * Le signUp est autorisé par le token (transmis via inviteToken → profile →
 * createOrUpdateUser, cf convex/auth.ts) : c'est lui qui crée le compte, le
 * membership creator, lie la fiche et marque l'invitation consommée, le tout
 * atomiquement. Succès → /app.
 *
 * Token invalide / utilisé / expiré → getInvitationPreview renvoie le même
 * `{ status: "invalid" }` (aucun leak) → message propre, pas de formulaire.
 */
export default function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const { signIn } = useAuthActions();
  const preview = useQuery(api.creators.getInvitationPreview, { token });

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (preview?.status !== "valid") return;
    setError(null);
    setSubmitting(true);
    try {
      await signIn("password", {
        email: preview.email,
        password,
        flow: "signUp",
        inviteToken: token,
      });
      router.push("/app");
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Création du compte impossible (mot de passe trop court — 8 caractères minimum — ou invitation invalide).",
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
        ) : preview.status === "invalid" ? (
          <>
            <CardHeader>
              <CardTitle>Lien invalide</CardTitle>
              <CardDescription>
                Ce lien d&apos;invitation est invalide, a expiré ou a déjà été
                utilisé.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                Si tu as déjà créé ton compte, connecte-toi avec ton email et
                ton mot de passe.
              </p>
              <Link href="/login" className={buttonVariants({ className: "w-full" })}>
                Se connecter
              </Link>
              <p className="text-xs text-slate-500">
                Sinon, demande un nouveau lien d&apos;invitation à ton
                administrateur.
              </p>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                  R
                </span>
                {preview.projectName ?? "RepackIt"}
              </CardTitle>
              <CardDescription>
                Bienvenue {preview.name} — choisis un mot de passe pour activer
                ton compte créateur.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={preview.email}
                    readOnly
                    disabled
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Mot de passe</Label>
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
                {error && (
                  <p role="alert" className="text-sm text-rose-600">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && (
                    <Loader2Icon className="size-4 animate-spin" />
                  )}
                  Activer mon compte
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
