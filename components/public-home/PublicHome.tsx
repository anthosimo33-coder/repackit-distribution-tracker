import Image from "next/image";
import Link from "next/link";
import { IBM_Plex_Mono } from "next/font/google";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRightIcon, EyeIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { LocaleSwitch } from "@/components/public/LocaleSwitch";
import { clashDisplay, switzer } from "@/app/login/fonts";
import { cn } from "@/lib/utils";
import todayDesktop from "@/public/landing/captures/creator-today-desktop.png";
import scriptMobile from "@/public/landing/captures/creator-script-mobile.png";
import gainsMobile from "@/public/landing/captures/creator-gains-mobile.png";
import todayMobile from "@/public/landing/captures/creator-today-mobile.png";
import styles from "./home.module.css";

const plexMono = IBM_Plex_Mono({
  weight: "500",
  subsets: ["latin"],
  variable: "--font-plex",
  display: "swap",
});

/**
 * Page d'accueil PUBLIQUE (`/` pour un visiteur non connecté) — maquette v2
 * validée : Jarvia présenté comme un STUDIO D'APPS, l'espace créateurs en
 * dessous. Composant serveur : pas d'état, le seul îlot client est le
 * sélecteur de langue.
 *
 * `stats` vient de api.showcase.getShowcaseStats (lu par app/page.tsx) :
 * `null` ou aucune vidéo → le bloc de chiffres n'est pas rendu (jamais de zéros affichés).
 *
 * Les vues des vidéos du mur sont FIGÉES : elles viennent des fichiers fournis
 * le 19/09/2026 (nom du fichier = vues du post à cette date), ces posts
 * n'étant pas reliés à une publication suivie.
 */

export type ShowcaseStats = {
  videos: number;
  views: number;
  accounts: number;
  creators: number;
  firstPublishedAt: number | null;
};

const WALL = [
  { file: "kelly-750k", views: 750_000 },
  { file: "kelly-136k", views: 136_000 },
  { file: "kelly-582k", views: 582_000 },
  { file: "kelly-70k", views: 70_000 },
  { file: "kelly-470k", views: 470_000 },
  { file: "kelly-67k", views: 67_000 },
  { file: "kelly-286k", views: 286_000 },
];
// i18n-exempt: prénom de la créatrice des vidéos du mur (donnée, pas interface)
const WALL_CREATOR = "Kelly";
const PLATFORMS = ["tiktok", "instagram", "youtube"];

const INK = "text-[#0a0a0b]";
const MONO =
  "font-[family-name:var(--font-plex)] text-xs font-medium tracking-[.08em] uppercase";
const DISPLAY =
  "font-[family-name:var(--font-clash)] font-semibold tracking-[-.045em]";

export async function PublicHome({ stats }: { stats: ShowcaseStats | null }) {
  const t = await getTranslations("home");
  const locale = await getLocale();
  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const whole = new Intl.NumberFormat(locale);
  const since =
    stats?.firstPublishedAt != null
      ? new Intl.DateTimeFormat(locale, {
          month: "long",
          year: "numeric",
          timeZone: "Europe/Paris",
        }).format(stats.firstPublishedAt)
      : null;

  return (
    <div
      className={cn(
        clashDisplay.variable,
        switzer.variable,
        plexMono.variable,
        "min-h-screen overflow-x-clip bg-[#0a0a0b] font-[family-name:var(--font-switzer)] text-[#f4f4f5] antialiased selection:bg-[#7c5cbf] selection:text-white",
      )}
    >
      {/* ── Navigation ─────────────────────────────────────────────── */}
      <nav className="relative z-20 flex items-center justify-between gap-4 px-4 py-3.5 md:px-14 md:py-5">
        <Link href="/" aria-label={t("nav.home")} className="flex items-center gap-3">
          <BrandMark size={32} className="rounded-[7px] border border-white/10" />
          <span className={cn(DISPLAY, "text-lg tracking-[.14em]")}>
            {/* i18n-exempt: nom de la marque — ne se traduit pas. */}
            JARVIA
          </span>
        </Link>
        <div className="hidden items-center gap-8 text-[15px] text-[#f4f4f5]/80 lg:flex">
          <a href="#apps" className="hover:text-white">{t("nav.studio")}</a>
          <a href="#studio" className="hover:text-white">{t("nav.creators")}</a>
          <a href="#faq" className="hover:text-white">{t("nav.faq")}</a>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <LocaleSwitch />
          </div>
          <PrimaryLink href="/login" small>
            {t("nav.signIn")}
          </PrimaryLink>
        </div>
      </nav>

      {/* ── Hero : titre + mur de vidéos qui défile ────────────────── */}
      <header className="relative flex flex-col items-center overflow-hidden px-4 pt-10 pb-10 text-center md:px-24 md:pt-20 md:pb-14">
        <Rays />
        <div className="relative flex flex-col items-center gap-5 md:gap-7">
          <span className={cn(MONO, "text-[#f4f4f5]/65")}>{t("hero.label")}</span>
          <h1 className={cn(DISPLAY, "m-0 text-[60px] leading-[.92] md:text-[124px]")}>
            <span className={cn(styles.chrome, "block pb-[.05em]")}>{t("hero.line1")}</span>
            <span className={cn(styles.chrome, "block pb-[.08em]")}>{t("hero.line2")}</span>
          </h1>
          <p className="m-0 max-w-[560px] text-base leading-relaxed text-[#f4f4f5]/75 md:text-xl">
            {t("hero.body")}
          </p>
          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
            <PrimaryLink href="/login">{t("nav.signIn")}</PrimaryLink>
            <GhostLink href="#how">{t("hero.how")}</GhostLink>
          </div>
        </div>

        <section
          aria-label={t("wall.label")}
          className={cn(styles.wall, "relative mt-14 w-screen overflow-hidden pt-2.5 pb-7 md:mt-20")}
        >
          <div className={styles.track}>
            {[false, true].map((duplicate) =>
              WALL.map((v) => (
                <WallCard
                  key={`${v.file}-${duplicate}`}
                  file={v.file}
                  views={compact.format(v.views)}
                  viewsLabel={t("wall.views")}
                  creator={WALL_CREATOR}
                  label={t("wall.videoLabel", {
                    name: WALL_CREATOR,
                    views: compact.format(v.views),
                  })}
                  duplicate={duplicate}
                />
              )),
            )}
          </div>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[#0a0a0b] to-transparent md:w-32" />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#0a0a0b] to-transparent md:w-32" />
        </section>
      </header>

      {/* ── Bandeau plateformes ────────────────────────────────────── */}
      <section
        aria-label={t("platforms.label")}
        className="relative flex h-[76px] items-center overflow-hidden border-y border-white/10 md:h-[120px]"
      >
        <span
          className={cn(
            MONO,
            "relative z-10 hidden h-full shrink-0 items-center border-r border-white/10 bg-[#0a0a0b] pr-10 pl-14 text-[#f4f4f5]/60 md:flex",
          )}
        >
          {t("platforms.label")}
        </span>
        <div className={cn(styles.track, styles.trackFast)} aria-hidden>
          {Array.from({ length: 4 }).flatMap((_, i) =>
            PLATFORMS.map((p) => (
              <span key={`${p}-${i}`} className="flex items-center">
                <span className={cn(DISPLAY, "px-6 text-[26px] tracking-[-.03em] text-[#f4f4f5]/80 md:px-9 md:text-[40px]")}>
                  {p}
                </span>
                <span className="text-[#9d7fe8]">✦</span>
              </span>
            )),
          )}
        </div>
      </section>

      {/* ── Le studio : on construit des apps ──────────────────────── */}
      <section id="apps" className="scroll-mt-4 px-4 py-20 md:px-24 md:py-36">
        <div className="mx-auto flex max-w-[1248px] flex-col gap-10 md:gap-16">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end lg:gap-20">
            <div className="flex flex-col gap-4 md:gap-5">
              <span className={cn(MONO, "text-[#b39bef]")}>{t("apps.label")}</span>
              <h2 className={cn(DISPLAY, "m-0 text-[42px] leading-[.95] md:text-[76px]")}>
                <span className={cn(styles.chrome, "block pb-[.02em]")}>{t("apps.title1")}</span>
                <span className={cn(styles.chrome, "block pb-[.08em]")}>{t("apps.title2")}</span>
              </h2>
            </div>
            <p className="m-0 text-[15px] leading-relaxed text-[#f4f4f5]/70 md:text-[17px]">
              {t("apps.body")}
            </p>
          </div>

          <ol className="m-0 grid list-none gap-0 border-y border-white/10 p-0 md:grid-cols-3 md:gap-7 md:py-9">
            {(["create", "promote", "data"] as const).map((k, i) => (
              <li key={k} className="flex flex-col gap-2 border-t border-white/10 py-5 first:border-t-0 md:border-t-0 md:py-0">
                <span className={cn(MONO, "text-[#b39bef]")}>{`0${i + 1}`}</span>
                <span className={cn(DISPLAY, "text-2xl leading-tight tracking-[-.03em] md:text-[26px]")}>
                  {t(`apps.loop.${k}.title`)}
                </span>
                <span className="text-sm leading-relaxed text-[#f4f4f5]/65">
                  {t(`apps.loop.${k}.body`)}
                </span>
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-5">
            <span className={cn(MONO, "text-[#f4f4f5]/55")}>{t("apps.listLabel")}</span>
            <div className="grid gap-4 lg:grid-cols-4">
              <article className="flex flex-col gap-5 rounded-[18px] border border-[#9d7fe8]/30 bg-gradient-to-b from-[#15122a] to-[#0b0a12] p-5 md:gap-6 md:p-8 lg:col-span-3">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/brand/snytch-logo.jpeg"
                      alt=""
                      className="size-14 rounded-2xl border border-white/15 md:size-16"
                    />
                    <div className="flex flex-col gap-1">
                      <span className={cn(DISPLAY, "text-[26px] tracking-[-.03em] md:text-[32px]")}>
                        {/* i18n-exempt: nom de l'app (marque) — ne se traduit pas. */}
                        Snytch
                      </span>
                      <span className="text-[13px] text-[#f4f4f5]/60">{t("apps.snytchCategory")}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip accent>{t("apps.open")}</Chip>
                    <Chip>{t("apps.platforms")}</Chip>
                    <a
                      href="https://snytch.co"
                      target="_blank"
                      rel="noreferrer"
                      className={cn(MONO, "rounded-full bg-[#f4f4f5] px-2.5 py-1.5 text-[10px] text-[#0a0a0b] hover:bg-white")}
                    >
                      {/* i18n-exempt: nom de domaine de l'app. */}
                      snytch.co ↗
                    </a>
                  </div>
                </div>
                <p className="m-0 max-w-[640px] text-[15px] leading-relaxed text-[#f4f4f5]/75 md:text-[17px]">
                  {t("apps.snytchBody")}
                </p>
                {stats && stats.videos > 0 && (
                  <>
                    <dl className="m-0 grid grid-cols-2 gap-x-4 border-t border-white/10 lg:grid-cols-4 lg:gap-x-0">
                      {(
                        [
                          ["videos", whole.format(stats.videos)],
                          ["views", compact.format(stats.views)],
                          ["accounts", whole.format(stats.accounts)],
                          ["creators", whole.format(stats.creators)],
                        ] as const
                      ).map(([key, value], i) => (
                        <div
                          key={key}
                          className={cn(
                            "flex flex-col-reverse gap-1.5 py-4 lg:px-6 lg:py-5",
                            i > 0 && "lg:border-l lg:border-white/10",
                            i === 0 && "lg:pl-0",
                          )}
                        >
                          <dt className="text-[13px] text-[#f4f4f5]/65 md:text-sm">{t(`apps.stats.${key}`)}</dt>
                          <dd className={cn(DISPLAY, styles.chrome, "m-0 text-4xl leading-none tracking-[-.04em] md:text-[56px]")}>
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {since && (
                      <span className={cn(MONO, "text-[10px] text-[#f4f4f5]/50")}>
                        {t("apps.stats.since", { date: since })}
                      </span>
                    )}
                  </>
                )}
              </article>
              <div className="flex flex-col justify-center gap-3 rounded-2xl border border-dashed border-white/20 p-6">
                <span className={cn(MONO, "text-[#f4f4f5]/55")}>{t("apps.nextLabel")}</span>
                <span className={cn(DISPLAY, "text-[22px] tracking-[-.03em] text-[#f4f4f5]/85")}>
                  {t("apps.nextBody")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Le studio en bref (clair) ───────────────────────────────── */}
      <section id="studio" className={cn("scroll-mt-4 bg-[#f1f2f5] px-4 py-20 md:px-24 md:py-36", INK)}>
        <div className="mx-auto grid max-w-[1248px] gap-8 lg:grid-cols-[420px_minmax(0,1fr)] lg:gap-20">
          <div className="flex flex-col gap-5">
            <span className={cn(MONO, "text-[#7c5cbf]")}>{t("brief.label")}</span>
            <h2 className={cn(DISPLAY, "m-0 text-[40px] leading-[.98] md:text-[56px]")}>{t("brief.title")}</h2>
            <p className="m-0 text-base leading-relaxed text-[#0a0a0b]/65">{t("brief.body")}</p>
            <div className="mt-3 hidden lg:block">
              <PrimaryLink href="/login" dark>
                {t("nav.signIn")}
              </PrimaryLink>
            </div>
          </div>
          <ol className="m-0 flex list-none flex-col border-b border-[#0a0a0b]/10 p-0">
            {(["missions", "scripts", "views", "earnings"] as const).map((k, i) => (
              <li
                key={k}
                className={cn(styles.row, "grid grid-cols-[40px_minmax(0,1fr)] gap-5 border-t border-[#0a0a0b]/10 py-6 md:grid-cols-[72px_minmax(0,1fr)] md:py-9")}
              >
                <span className={cn(MONO, "pt-2 text-sm text-[#7c5cbf]")}>{`0${i + 1}.`}</span>
                <div className="flex flex-col gap-3">
                  <span className={cn(DISPLAY, styles.rowTitle, "text-[28px] leading-none transition-colors md:text-[40px]")}>
                    {t(`brief.${k}.title`)}
                  </span>
                  <span className="max-w-[560px] text-[15px] leading-relaxed text-[#0a0a0b]/65 md:text-base">
                    {t(`brief.${k}.body`)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Ton espace (lilas) : captures réelles ──────────────────── */}
      <section className={cn("flex flex-col items-center gap-10 overflow-hidden bg-[#b39bef] px-4 py-20 text-center md:gap-14 md:px-24 md:py-32", INK)}>
        <div className="flex flex-col items-center gap-5">
          <span className={cn(MONO, "text-[#0a0a0b]/70")}>{t("space.label")}</span>
          <h2 className={cn(DISPLAY, "m-0 text-[40px] leading-[.98] md:text-[72px] md:leading-[.95]")}>
            <span className="block">{t("space.title1")}</span>
            <span className="block">{t("space.title2")}</span>
          </h2>
          <p className="m-0 max-w-[560px] text-base leading-relaxed text-[#0a0a0b]/75 md:text-lg">{t("space.body")}</p>
        </div>

        {/* Desktop : navigateur + deux téléphones. Mobile : deux téléphones. */}
        <div className="relative hidden w-full max-w-[1180px] pr-16 pl-20 lg:block">
          <div className="overflow-hidden rounded-2xl border border-[#0a0a0b]/35 bg-[#0e0c15] shadow-[0_50px_100px_rgba(40,20,80,.35)]">
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className={cn(MONO, "ml-3 text-[10px] text-[#f4f4f5]/45")}>
                {/* i18n-exempt: adresse affichée dans la fausse barre d'URL. */}
                jarvia-creator-studio.com/app
              </span>
            </div>
            <Image src={todayDesktop} alt={t("space.altDesktop")} sizes="1040px" className="block h-auto w-full" />
          </div>
          <Phone src={scriptMobile} alt={t("space.altScript")} className="absolute right-0 -bottom-16 w-[250px] rotate-[4deg]" />
          <Phone src={gainsMobile} alt={t("space.altGains")} className="absolute -bottom-20 left-0 w-[230px] -rotate-[5deg]" />
        </div>
        <div className="flex justify-center gap-3 lg:hidden">
          <Phone src={todayMobile} alt={t("space.altToday")} className="w-[46%] max-w-[220px] -rotate-3" />
          <Phone src={scriptMobile} alt={t("space.altScript")} className="w-[46%] max-w-[220px] rotate-3" />
        </div>
        <span className={cn(MONO, "text-[11px] text-[#0a0a0b]/60 lg:mt-16")}>{t("space.caption")}</span>
      </section>

      {/* ── Comment ça marche (noir) ───────────────────────────────── */}
      <section id="how" className="scroll-mt-4 px-4 py-20 md:px-16 md:py-36">
        <div className="mx-auto flex max-w-[1312px] flex-col gap-10 md:gap-16">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:px-8">
            <div className="flex flex-col gap-5">
              <span className={cn(MONO, "text-[#b39bef]")}>{t("how.label")}</span>
              <h2 className={cn(DISPLAY, "m-0 text-[40px] leading-[.98] md:text-[64px] md:leading-[.95]")}>
                <span className={cn(styles.chrome, "block")}>{t("how.title1")}</span>
                <span className={cn(styles.chrome, "block pb-[.08em]")}>{t("how.title2")}</span>
              </h2>
            </div>
            <div className="hidden md:block">
              <GhostLink href="/login">{t("nav.signIn")}</GhostLink>
            </div>
          </div>
          <ol className="m-0 grid list-none gap-0 p-0 md:grid-cols-4">
            {(["s1", "s2", "s3", "s4"] as const).map((k, i) => (
              <li
                key={k}
                className={cn(
                  "flex flex-col gap-3 border-t border-white/10 pt-6 pb-7 md:gap-4 md:border-t-0 md:px-8 md:py-0",
                  i > 0 && "md:border-l md:border-white/10",
                )}
              >
                <span className={cn(MONO, "text-[#b39bef]")}>{t(`how.${k}.label`)}</span>
                <span className={cn(DISPLAY, "text-[26px] leading-tight md:text-[32px]")}>{t(`how.${k}.title`)}</span>
                <span className="text-[15px] leading-relaxed text-[#f4f4f5]/65">{t(`how.${k}.body`)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Pour qui + FAQ (clair) ─────────────────────────────────── */}
      <section className={cn("bg-[#f1f2f5] px-4 pt-20 pb-10 md:px-24 md:pt-36", INK)}>
        <div className="mx-auto flex max-w-[1248px] flex-col gap-8 md:gap-14">
          <div className="flex flex-col gap-5">
            <span className={cn(MONO, "text-[#7c5cbf]")}>{t("who.label")}</span>
            <h2 className={cn(DISPLAY, "m-0 text-[40px] leading-[.98] md:text-[64px] md:leading-[.95]")}>{t("who.title")}</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3 md:gap-5">
            {(["creators", "managers", "admins"] as const).map((k, i) => (
              <div
                key={k}
                className={cn(
                  "flex flex-col gap-4 rounded-2xl border p-7 md:p-8",
                  i === 0
                    ? "border-white/10 bg-[#0a0a0b] text-[#f4f4f5]"
                    : "border-[#0a0a0b]/10 bg-white",
                )}
              >
                <span className={cn(DISPLAY, "text-[30px] leading-tight")}>{t(`who.${k}.title`)}</span>
                <span className={cn("text-[15px] leading-relaxed", i === 0 ? "text-[#f4f4f5]/65" : "text-[#0a0a0b]/65")}>
                  {t(`who.${k}.body`)}
                </span>
                <ul className="m-0 mt-2 flex list-none flex-col gap-2.5 p-0">
                  {(["i1", "i2", "i3"] as const).map((item) => (
                    <li
                      key={item}
                      className={cn("flex items-center gap-2.5 text-sm", i === 0 ? "text-[#f4f4f5]/65" : "text-[#0a0a0b]/65")}
                    >
                      <span aria-hidden className="size-1.5 rounded-full bg-[#9d7fe8]" />
                      {t(`who.${k}.${item}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className={cn("scroll-mt-4 bg-[#f1f2f5] px-4 pt-10 pb-20 md:px-24 md:pb-36", INK)}>
        <div className="mx-auto grid max-w-[1248px] gap-6 lg:grid-cols-[420px_minmax(0,1fr)] lg:gap-20">
          <div className="flex flex-col gap-5">
            <span className={cn(MONO, "text-[#7c5cbf]")}>{t("faq.label")}</span>
            <h2 className={cn(DISPLAY, "m-0 text-[40px] leading-[.98] md:text-[56px]")}>{t("faq.title")}</h2>
          </div>
          <div className="flex flex-col border-b border-[#0a0a0b]/10">
            {(["account", "password", "platforms", "pay", "language"] as const).map((k, i) => (
              <details key={k} open={i === 0} className={cn(styles.faq, "border-t border-[#0a0a0b]/10 py-6")}>
                <summary className={cn(DISPLAY, "flex items-center justify-between gap-4 text-[19px] tracking-[-.03em] md:text-2xl")}>
                  {t(`faq.${k}.q`)}
                  <span
                    aria-hidden
                    className={cn(styles.plus, "flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0a0a0b] font-[family-name:var(--font-switzer)] text-lg tracking-normal text-[#f4f4f5] transition-transform")}
                  >
                    +
                  </span>
                </summary>
                <p className="m-0 mt-3.5 max-w-[640px] text-base leading-relaxed text-[#0a0a0b]/70">{t(`faq.${k}.a`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Appel final ────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center gap-6 overflow-hidden px-4 py-24 text-center md:gap-8 md:py-36">
        <Rays faint />
        <span className={cn(MONO, "relative text-[#f4f4f5]/60")}>{t("cta.label")}</span>
        <h2 className={cn(DISPLAY, "relative m-0 text-[48px] leading-[.95] md:text-[96px]")}>
          <span className={cn(styles.chrome, "block pb-[.08em]")}>{t("cta.title")}</span>
        </h2>
        <div className="relative">
          <PrimaryLink href="/login">{t("nav.signIn")}</PrimaryLink>
        </div>
      </section>

      {/* ── Pied de page ───────────────────────────────────────────── */}
      <footer className="overflow-hidden border-t border-white/10 px-4 pt-9 md:px-14 md:pt-14">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="flex flex-col gap-3">
            <span className={cn(DISPLAY, "text-[28px] tracking-[-.03em]")}>{t("footer.tagline")}</span>
            <span className="text-sm text-[#f4f4f5]/55">{t("footer.invite")}</span>
          </div>
          <div className="flex flex-col gap-2.5 text-sm">
            <span className={cn(MONO, "text-[#f4f4f5]/45")}>{t("footer.navigate")}</span>
            <Link href="/login" className="hover:text-[#b39bef]">{t("nav.signIn")}</Link>
            <a href="#apps" className="hover:text-[#b39bef]">{t("nav.studio")}</a>
            <a href="#faq" className="hover:text-[#b39bef]">{t("nav.faq")}</a>
          </div>
        </div>
        <div className="mt-10 flex items-center justify-between text-[13px] text-[#f4f4f5]/50">
          <span>
            {/* i18n-exempt: mention de marque — ne se traduit pas. */}
            © Jarvia
          </span>
          <div className="sm:hidden">
            <LocaleSwitch />
          </div>
        </div>
        <div
          aria-hidden
          className={cn(DISPLAY, styles.chrome, "-mx-2 mt-6 -mb-1 text-center text-[31vw] leading-[.78] tracking-[-.06em] md:-mx-5 md:text-[330px]")}
        >
          {/* i18n-exempt: mot-marque décoratif (aria-hidden), ne se traduit pas. */}
          jarvia
        </div>
      </footer>
    </div>
  );
}

function PrimaryLink({
  href,
  children,
  small = false,
  dark = false,
}: {
  href: string;
  children: React.ReactNode;
  small?: boolean;
  dark?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        styles.btn,
        "inline-flex items-center justify-center gap-2.5 rounded-md font-semibold",
        small ? "px-4 py-2.5 text-sm md:px-5" : "px-7 py-[15px] text-[15px]",
        dark ? "bg-[#0a0a0b] text-[#f4f4f5]" : "bg-[#f4f4f5] text-[#0a0a0b] hover:bg-white",
      )}
    >
      {children}
      <ArrowRightIcon className="size-4" aria-hidden />
    </Link>
  );
}

function GhostLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center gap-2.5 rounded-md border border-white/20 bg-white/[.04] px-6 py-3.5 text-[15px] font-medium text-[#f4f4f5] hover:bg-white/10"
    >
      {children}
    </a>
  );
}

function Chip({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        MONO,
        "rounded-full border px-2.5 py-1.5 text-[10px]",
        accent
          ? "border-[#9d7fe8]/35 bg-[#7c5cbf]/15 text-[#b39bef]"
          : "border-white/15 text-[#f4f4f5]/65",
      )}
    >
      {children}
    </span>
  );
}

function WallCard({
  file,
  views,
  viewsLabel,
  creator,
  label,
  duplicate,
}: {
  file: string;
  views: string;
  viewsLabel: string;
  creator: string;
  label: string;
  duplicate: boolean;
}) {
  return (
    <div
      aria-hidden={duplicate || undefined}
      className="relative mr-3 aspect-[9/16] w-[150px] shrink-0 overflow-hidden rounded-[18px] border border-white/10 bg-[#0a0a0b] shadow-[0_30px_60px_rgba(0,0,0,.55)] md:mr-[18px] md:w-[210px]"
    >
      <video
        src={`/landing/videos/${file}.mp4`}
        poster={`/landing/videos/${file}.jpg`}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={duplicate ? undefined : label}
        className="absolute inset-0 size-full object-cover"
      />
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-b from-transparent to-[#0a0a0b]/85" />
      <div className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1 text-left text-white md:inset-x-3.5 md:bottom-3.5">
        <div className="flex items-center gap-1.5">
          <EyeIcon className="size-4 md:size-5" aria-hidden />
          <span className="font-[family-name:var(--font-clash)] text-[22px] leading-none font-semibold tracking-[-.04em] md:text-[31px]">
            {views}
          </span>
        </div>
        <span className="font-[family-name:var(--font-plex)] text-[10px] font-medium tracking-[.08em] text-white/80 uppercase md:text-xs">
          {`${viewsLabel} · ${creator}`}
        </span>
      </div>
    </div>
  );
}

function Phone({
  src,
  alt,
  className,
}: {
  src: typeof scriptMobile;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-[36px] bg-[#0a0a0b] p-2.5 shadow-[0_40px_80px_rgba(20,10,50,.45),inset_0_0_0_1px_rgba(255,255,255,.12)]",
        className,
      )}
    >
      <Image src={src} alt={alt} sizes="250px" className="block h-auto w-full rounded-[28px]" />
    </div>
  );
}

/** Rayons en éventail + lueur, comme le hero de la landing. Décoratif. */
const RAY_COLORS = ["#EAF2F5", "#9D7FE8", "#C9CDD6", "#B39BEF", "#EAF2F5"];
const RAYS = Array.from({ length: 31 }, (_, i) => {
  const d = Math.abs(i - 15) / 15;
  return {
    x: -900 + i * 100,
    color: RAY_COLORS[i % RAY_COLORS.length],
    opacity: 0.04 + 0.15 * (1 - d) ** 1.6,
  };
});

function Rays({ faint = false }: { faint?: boolean }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", faint && "opacity-70")}>
      <svg
        viewBox="0 0 1200 900"
        // i18n-exempt: valeur SVG, pas du texte
        preserveAspectRatio="xMidYMax slice"
        className={cn("absolute top-0 left-0 w-full", faint ? "h-full" : "h-[470px] md:h-[640px]")}
      >
        {RAYS.map((r) => (
          <line key={r.x} x1={600} y1={900} x2={r.x} y2={0} stroke={r.color} strokeWidth={1} opacity={r.opacity} />
        ))}
      </svg>
      <div className={cn("absolute left-1/2", faint ? "bottom-0" : "top-[470px] md:top-[640px]")}>
        <div className="absolute -bottom-10 -left-[380px] h-[280px] w-[760px] bg-[radial-gradient(closest-side,rgba(124,92,191,.30),rgba(124,92,191,0)_70%)] blur-[14px]" />
        <div className="absolute -bottom-[60px] -left-[260px] h-[200px] w-[520px] bg-[radial-gradient(closest-side,rgba(255,255,255,.22),rgba(255,255,255,0)_70%)] blur-[6px]" />
        <div className="absolute -bottom-5 -left-[75px] h-11 w-[150px] bg-[radial-gradient(closest-side,rgba(255,255,255,.9),rgba(255,255,255,0)_72%)] blur-[3px]" />
      </div>
    </div>
  );
}
