"use client";

import { use, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/brand/BrandMark";
import { AccentStyle } from "@/components/project/AccentStyle";
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
 * Login BRANDÉ par projet — URL d'entrée /[projectSlug]/login (ex.
 * /repackit/login). Affiche le NOM et l'ACCENT du projet (résolus par
 * api.projects.getProjectBrandingBySlug, query PUBLIQUE qui ne renvoie QUE ce
 * projet — jamais la liste). L'auth elle-même est inchangée (signIn Convex) ;
 * après succès, `/` route par rôle (creator → /app, admin → /admin/<slug>),
 * exactement comme le /login générique.
 *
 * Page PUBLIQUE (pré-session) : exclue du gating dans proxy.ts + rendue nue par
 * AppShell. Slug inconnu → écran « Projet introuvable » propre (pas de leak).
 */
export default function ProjectLoginPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const t = useTranslations("auth");
  const { projectSlug } = use(params);
  const router = useRouter();
  const { signIn } = useAuthActions();
  const branding = useQuery(api.projects.getProjectBrandingBySlug, {
    slug: projectSlug,
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn("password", { email, password, flow: "signIn" });
      // Routing par rôle géré par `/` (getMyPortal) — identique au /login.
      router.push("/");
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : t("login.badCredentials"),
      );
      setSubmitting(false);
    }
  }

  if (branding === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (branding === null) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t("login.projectNotFound")}</CardTitle>
            <CardDescription>{t("login.projectNotFoundBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login" className={"text-sm text-primary underline-offset-2 hover:underline"}>
              {t("login.goToGeneralLogin")}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const accent = branding.accentColor || "#FF5200";

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={
        { "--primary": accent, "--ring": accent } as React.CSSProperties
      }
    >
      <AccentStyle accent={accent} />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrandMark size={32} />
            {branding.name}
          </CardTitle>
          <CardDescription>
            {t("login.subtitleProject", { project: branding.name })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("field.email")}</Label>
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
              <Label htmlFor="password">{t("field.password")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
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
              {t("login.submitSignIn")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
