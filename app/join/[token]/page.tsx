"use client";

import { use, useState, useEffect} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useLocale } from "next-intl";
import { normalizeLocale } from "@/i18n/locales";
import { writeLocaleCookie } from "@/i18n/locale-cookie";
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
import { BrandMark } from "@/components/brand/BrandMark";

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

  const currentLocale = useLocale();

  // MAILLON 7 — le seul endroit où la langue choisie par l'admin peut atteindre
  // le créateur avant qu'il ait un compte. Il arrive ici sans session (rien à
  // lire côté users) et sans cookie (premier passage sur le domaine) : sans ce
  // report, il clique un e-mail en anglais et lit un écran français, puis un
  // login français.
  //
  // `router.refresh()` redemande le rendu SERVEUR, qui relit le cookie via
  // i18n/request.ts — c'est lui qui rebascule la page. Pas de boucle : après le
  // rafraîchissement `currentLocale` vaut la nouvelle langue et la condition
  // devient fausse.
  //
  // Invitation SANS langue ⇒ `preview.locale` est null ⇒ AUCUN cookie posé, on
  // laisse la chaîne de résolution faire son travail (Accept-Language, puis fr).
  const inviteLocale =
    preview?.status === "valid" ? normalizeLocale(preview.locale) : null;
  useEffect(() => {
    if (inviteLocale === null || inviteLocale === currentLocale) return;
    writeLocaleCookie(inviteLocale);
    router.refresh();
  }, [inviteLocale, currentLocale, router]);

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
                <BrandMark size={32} />
                {preview.projectName ?? "Jarvis Creator Studio"}
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
