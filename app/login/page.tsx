"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { ArrowRightIcon, Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/brand/BrandMark";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";
import { writeLocaleCookie } from "@/i18n/locale-cookie";
import { cn } from "@/lib/utils";
import { clashDisplay, switzer } from "./fonts";
import styles from "./login.module.css";

/**
 * Page d'accueil + connexion (email + mot de passe, Convex Auth provider
 * Password), dans le style de la landing Jarvia : fond noir, rayons, titre
 * chromé, Clash Display + Switzer.
 *
 * Deux modes :
 *  - signIn : connexion d'un compte existant.
 *  - signUp : création de compte. FERMÉE par défaut côté serveur (cf
 *    convex/auth.ts) — seule exception : la fenêtre bootstrap (table users
 *    vide → premier compte = superadmin). Le toggle n'est affiché QUE
 *    pendant cette fenêtre (api.bootstrap.isBootstrapOpen) : hors bootstrap,
 *    le serveur rejetait tout signup et le lien ne menait qu'à une erreur.
 *    Les comptes se créent par invitation (/join/<token>).
 *
 * Mot de passe oublié : pas de parcours en libre-service — le lien de
 * réinitialisation est généré par l'admin (/reset-password/<token>). Le bouton
 * ne fait donc qu'afficher la marche à suivre.
 *
 * Les libellés « Email », « Mot de passe », « Se connecter » et le toggle
 * bootstrap sont ceux que lit e2e/auth.setup.ts : ne pas les renommer.
 */

/** Rayons en éventail depuis le bas, comme le hero de la landing. */
const RAY_COLORS = ["#EAF2F5", "#9D7FE8", "#C9CDD6", "#B39BEF", "#EAF2F5"];
const RAY_COUNT = 27;
const RAYS = Array.from({ length: RAY_COUNT }, (_, i) => {
  const half = (RAY_COUNT - 1) / 2;
  const distance = Math.abs(i - half) / half;
  return {
    x: -700 + (i * 2600) / (RAY_COUNT - 1),
    color: RAY_COLORS[i % RAY_COLORS.length],
    opacity: 0.05 + 0.16 * (1 - distance) ** 1.5,
  };
});

const FEATURES = ["missions", "posts", "earnings"] as const;
const ROLES = ["admin", "manager", "creator"] as const;

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { signIn } = useAuthActions();
  const bootstrapOpen = useQuery(api.bootstrap.isBootstrapOpen, {}) === true;
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

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
            ? t("login.badCredentials")
            : t("login.signupFailed"),
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className={cn(
        clashDisplay.variable,
        switzer.variable,
        "relative flex min-h-screen flex-col overflow-clip bg-[#0a0a0b] font-[family-name:var(--font-switzer)] text-[#f4f4f5] antialiased selection:bg-[#7c5cbf] selection:text-white",
      )}
    >
      <Backdrop />

      <nav className="relative z-10 flex items-center justify-between gap-4 border-b border-white/[.08] bg-[#0a0a0b]/60 px-4 py-3.5 backdrop-blur-md sm:px-8 lg:px-14">
        <div className="flex items-center gap-3">
          <BrandMark size={34} className="rounded-[7px] border border-white/10" />
          <span className="font-[family-name:var(--font-clash)] text-[17px] font-semibold tracking-[.14em]">
            {/* i18n-exempt: nom de la marque — ne se traduit pas. */}
            JARVIA
          </span>
          <span className="hidden border-l border-white/[.14] pl-3.5 text-xs tracking-[.22em] text-[#f4f4f5]/60 uppercase sm:inline">
            {/* i18n-exempt: nom du produit (marque) — ne se traduit pas. */}
            Creator Studio
          </span>
        </div>
        <LocaleSwitch />
      </nav>

      <main className="relative z-10 mx-auto grid w-full max-w-[1440px] flex-1 items-center gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-24 lg:py-12 lg:pr-24 lg:pl-[72px]">
        <section className="flex flex-col items-center gap-5 text-center lg:items-start lg:gap-7 lg:text-left">
          <span className="text-[11px] tracking-[.22em] text-[#f4f4f5]/60 uppercase lg:text-xs">
            {t("home.eyebrow")}
          </span>
          <h1 className="m-0 font-[family-name:var(--font-clash)] text-[46px] leading-[1.02] font-semibold tracking-[-.03em] sm:text-[64px] xl:text-[92px]">
            <span className={cn(styles.chrome, "block pb-[.04em]")}>
              {t("home.titleLine1")}
            </span>
            <span className={cn(styles.chrome, "block pb-[.06em]")}>
              {t("home.titleLine2")}
            </span>
          </h1>
          <p className="m-0 max-w-[540px] text-[15px] leading-relaxed text-[#f4f4f5]/70 sm:text-[19px]">
            {t("home.subtitle")}
          </p>
          <ul className="mt-7 hidden list-none grid-cols-3 gap-7 p-0 lg:grid">
            {FEATURES.map((key, i) => (
              <li
                key={key}
                className="relative flex flex-col gap-2.5 border-t border-white/10 pt-6 pr-6"
              >
                <span
                  aria-hidden
                  className="absolute -top-px left-0 h-px w-10 bg-gradient-to-r from-[#7c5cbf] to-[#9d7fe8]"
                />
                <span className="font-[family-name:var(--font-clash)] text-[13px] font-medium tracking-[.12em] text-[#b39bef]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-[family-name:var(--font-clash)] text-lg font-semibold">
                  {t(`home.features.${key}.title`)}
                </span>
                <span className="text-sm leading-relaxed text-[#f4f4f5]/65">
                  {t(`home.features.${key}.body`)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="relative mx-auto flex w-full max-w-[440px] flex-col gap-[22px] overflow-clip rounded-2xl border border-white/[.09] bg-gradient-to-b from-[#161422]/[.86] to-[#0b0a12]/[.92] px-[22px] pt-[26px] pb-[22px] shadow-[0_40px_90px_rgba(0,0,0,.55)] backdrop-blur-xl sm:px-9 sm:pt-9 sm:pb-[30px]">
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#9d7fe8]/0 via-[#9d7fe8] to-[#9d7fe8]/0 shadow-[0_0_12px_rgba(157,127,232,.8)]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -top-[120px] left-1/2 h-[220px] w-[130%] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(124,92,191,.28),rgba(124,92,191,0)_72%)]"
          />

          <div className="relative flex flex-col gap-2">
            <h2 className="m-0 font-[family-name:var(--font-clash)] text-[23px] leading-tight font-semibold tracking-[-.01em] sm:text-[28px]">
              {flow === "signIn"
                ? t("home.cardTitle")
                : t("home.cardTitleSignUp")}
            </h2>
            <p className="m-0 text-sm leading-normal text-[#f4f4f5]/70">
              {flow === "signIn"
                ? t("home.cardSubtitle")
                : t("login.subtitleSignUp")}
            </p>
          </div>

          {flow === "signIn" && (
            <ul className="relative m-0 flex list-none flex-wrap gap-1.5 p-0">
              {ROLES.map((role) => (
                <li
                  key={role}
                  className="rounded-full border border-[#9d7fe8]/35 bg-[#7c5cbf]/[.12] px-2.5 py-1.5 text-[11px] tracking-[.14em] text-[#c9b8f2] uppercase"
                >
                  {t(`home.roles.${role}`)}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleSubmit} className="relative flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="text-[13px] font-medium text-[#f4f4f5]/80"
              >
                {t("field.email")}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={cn(
                  styles.input,
                  "h-12 rounded-lg border border-white/10 bg-white/[.03] px-3.5 text-[15px] text-[#f4f4f5]",
                )}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label
                  htmlFor="password"
                  className="text-[13px] font-medium text-[#f4f4f5]/80"
                >
                  {t("field.password")}
                </label>
                {flow === "signIn" && (
                  <button
                    type="button"
                    aria-expanded={showForgot}
                    onClick={() => setShowForgot((v) => !v)}
                    className="text-xs text-[#f4f4f5]/60 underline-offset-2 hover:text-[#b39bef] hover:underline"
                  >
                    {t("home.forgot")}
                  </button>
                )}
              </div>
              <input
                id="password"
                type="password"
                autoComplete={
                  flow === "signIn" ? "current-password" : "new-password"
                }
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(
                  styles.input,
                  "h-12 rounded-lg border border-white/10 bg-white/[.03] px-3.5 text-[15px] text-[#f4f4f5]",
                )}
              />
              {flow === "signIn" && showForgot && (
                <p
                  id="forgot-hint"
                  className="m-0 rounded-lg border border-[#9d7fe8]/25 bg-[#7c5cbf]/10 px-3 py-2 text-[13px] leading-snug text-[#f4f4f5]/80"
                >
                  {t("home.forgotHint")}
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="m-0 text-sm text-rose-300">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                styles.submit,
                "relative mt-1.5 flex h-[50px] items-center justify-center gap-2.5 rounded-lg bg-[#f4f4f5] text-[15px] font-semibold text-[#0a0a0b] hover:bg-white disabled:opacity-70",
              )}
            >
              {submitting ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : null}
              {flow === "signIn"
                ? t("login.submitSignIn")
                : t("login.submitSignUp")}
              {!submitting && <ArrowRightIcon className="size-4" />}
              <span aria-hidden className={styles.iris} />
            </button>
          </form>

          {(bootstrapOpen || flow === "signUp") && (
            <div className="relative flex items-center gap-3">
              <span className="h-px flex-1 bg-white/[.08]" />
              <button
                type="button"
                className="text-center text-[13px] text-[#f4f4f5]/65 underline-offset-2 hover:text-[#f4f4f5] hover:underline"
                onClick={() => {
                  setError(null);
                  setShowForgot(false);
                  setFlow(flow === "signIn" ? "signUp" : "signIn");
                }}
              >
                {flow === "signIn" ? t("login.toSignUp") : t("login.toSignIn")}
              </button>
              <span className="h-px flex-1 bg-white/[.08]" />
            </div>
          )}
          {!bootstrapOpen && flow === "signIn" && (
            <p className="relative m-0 border-t border-white/[.08] pt-4 text-center text-[13px] leading-snug text-[#f4f4f5]/60">
              {t("home.noAccount")}
            </p>
          )}
        </div>
      </main>

      <footer className="relative z-10 px-4 pt-4 pb-6 text-center text-[13px] text-[#f4f4f5]/55 sm:px-8 lg:px-14 lg:text-left">
        {/* i18n-exempt: mention de marque — ne se traduit pas. */}
        © Jarvia
      </footer>
    </div>
  );
}

/** Rayons + lueurs du hero de la landing, purement décoratifs. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <svg
        viewBox="0 0 1200 900"
        // i18n-exempt: valeur SVG, pas du texte
        preserveAspectRatio="xMidYMax slice"
        className="absolute top-0 left-0 h-[42vh] w-full lg:h-full lg:w-[72%]"
      >
        {RAYS.map((r, i) => (
          <line
            key={i}
            x1={600}
            y1={900}
            x2={r.x}
            y2={0}
            stroke={r.color}
            strokeWidth={1}
            opacity={r.opacity}
          />
        ))}
      </svg>
      <div className="absolute top-[42vh] left-1/2 opacity-40 lg:top-auto lg:bottom-0 lg:left-[36%] lg:opacity-100">
        <div className="absolute -bottom-10 -left-[380px] h-[280px] w-[760px] bg-[radial-gradient(closest-side,rgba(124,92,191,.30),rgba(124,92,191,0)_70%)] blur-[14px]" />
        <div className="absolute -bottom-[60px] -left-[260px] h-[200px] w-[520px] bg-[radial-gradient(closest-side,rgba(255,255,255,.26),rgba(255,255,255,0)_70%)] blur-[6px]" />
        <div className="absolute -bottom-5 -left-[75px] h-11 w-[150px] bg-[radial-gradient(closest-side,rgba(255,255,255,.95),rgba(255,255,255,0)_72%)] blur-[3px]" />
        <div className="absolute -bottom-2 -left-[190px] h-[26px] w-[380px] bg-[linear-gradient(90deg,rgba(232,220,200,0),rgba(232,220,200,.16)_24%,rgba(234,242,245,.30)_50%,rgba(157,127,232,.22)_76%,rgba(157,127,232,0))] blur-[10px]" />
      </div>
      <div
        className={cn(
          styles.breathe,
          "absolute top-1/2 left-[75%] hidden h-[620px] w-[760px] bg-[radial-gradient(closest-side,rgba(124,92,191,.16),rgba(124,92,191,0)_72%)] lg:block",
        )}
      />
    </div>
  );
}

/**
 * Choix de la langue AVANT session : seul le cookie NEXT_LOCALE existe ici
 * (pas de compte à mettre à jour), puis `router.refresh()` redemande le rendu
 * serveur dans la nouvelle langue. Toutes les langues : les créatrices
 * ES/PT passent aussi par cet écran.
 */
function LocaleSwitch() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === current) return;
    writeLocaleCookie(next);
    startTransition(() => router.refresh());
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-white/10 p-[3px]",
        pending && "opacity-60",
      )}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-label={LOCALE_LABELS[locale]}
          aria-pressed={locale === current}
          onClick={() => choose(locale)}
          className={cn(
            "h-[30px] min-w-10 rounded-md px-2 text-xs font-semibold tracking-[.08em] uppercase",
            locale === current
              ? "bg-white/10 text-[#f4f4f5]"
              : "text-[#f4f4f5]/60 hover:text-[#f4f4f5]",
          )}
        >
          {locale}
        </button>
      ))}
    </div>
  );
}
