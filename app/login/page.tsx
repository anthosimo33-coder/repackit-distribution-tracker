"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button";
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
 * Remédiation sécurité — page de connexion (email + mot de passe, Convex
 * Auth provider Password). Volontairement sobre : le theming arrive en P10.
 *
 * Deux modes :
 *  - signIn : connexion d'un compte existant.
 *  - signUp : création de compte. FERMÉE par défaut côté serveur (cf
 *    convex/auth.ts) — seule exception : la fenêtre bootstrap (table users
 *    vide → premier compte = superadmin). Le toggle reste visible pour ce
 *    cas (initialisation d'un deployment) ; hors bootstrap le serveur
 *    rejette avec un message explicite.
 */
export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn("password", { email, password, flow });
      // P3 — `/` résout le projet par défaut puis redirige vers son dashboard
      // scopé (le projet dépend de l'utilisateur, pas de route codée en dur).
      router.push("/");
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : flow === "signIn"
            ? "Identifiants invalides."
            : "Création de compte impossible (mot de passe trop court — 8 caractères minimum — ou inscription fermée).",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">
              R
            </span>
            RepackIt Distribution
          </CardTitle>
          <CardDescription>
            {flow === "signIn"
              ? "Connecte-toi pour accéder au tracker."
              : "Création du compte initial (premier démarrage uniquement)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                autoComplete={
                  flow === "signIn" ? "current-password" : "new-password"
                }
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
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              {flow === "signIn" ? "Se connecter" : "Créer le compte"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-4 w-full text-center text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            onClick={() => {
              setError(null);
              setFlow(flow === "signIn" ? "signUp" : "signIn");
            }}
          >
            {flow === "signIn"
              ? "Premier démarrage ? Créer le compte initial"
              : "Déjà un compte ? Se connecter"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
