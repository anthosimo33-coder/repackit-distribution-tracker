import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import styles from "./home.module.css";

/**
 * Les six cartes « Dans ton studio » : chacune porte une MINI-INTERFACE
 * dessinée en HTML (pas une capture) — carte de mission, script en deux zones,
 * relevé de vues, gains du cycle, palier, notifications.
 *
 * Dessinées plutôt que photographiées pour trois raisons : c'est net à toutes
 * les densités d'écran, c'est traduit comme le reste de la page, et ça ne pèse
 * rien. Les valeurs sont des EXEMPLES cohérents (une créatrice type), sauf les
 * vues cumulées qui reprennent le vrai total du studio.
 */

const INK = "text-[#0a0a0b]";
const MOCK =
  "rounded-[14px] border border-[#0a0a0b]/[.09] bg-white shadow-[0_12px_28px_rgba(10,10,11,.08)]";

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn(styles.mono, "text-[10px]", className)}>{children}</span>;
}

function Line({ w }: { w: string }) {
  return <span className="block h-2 rounded-full bg-[#0a0a0b]/[.09]" style={{ width: w }} />;
}

export async function BentoCards({ mobile = false }: { mobile?: boolean }) {
  const t = await getTranslations("home");
  const locale = await getLocale();
  const n = new Intl.NumberFormat(locale);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });

  const cards = [
    { key: "missions", span: "lg:col-span-4", title: t("brief.missions.title"), body: t("brief.missions.body"), visual: <MissionVisual t={t} /> },
    { key: "scripts", span: "lg:col-span-8", title: t("brief.scripts.title"), body: t("brief.scripts.body"), visual: <ScriptVisual t={t} /> },
    { key: "views", span: "lg:col-span-8", title: t("brief.views.title"), body: t("brief.views.body"), visual: <ViewsVisual t={t} n={n} compact={compact} /> },
    { key: "earnings", span: "lg:col-span-4", title: t("brief.earnings.title"), body: t("brief.earnings.body"), visual: <EarningsVisual t={t} /> },
    { key: "tiers", span: "lg:col-span-4", title: t("bento.tiers.title"), body: t("bento.tiers.body"), visual: <TiersVisual t={t} n={n} /> },
    { key: "notif", span: "lg:col-span-8", title: t("bento.notif.title"), body: t("bento.notif.body"), visual: <NotifVisual t={t} /> },
  ] as const;

  return (
    <>
      {cards.map(({ key, span, title, body, visual }, i) => (
        <article
          key={key}
          data-hover=""
          className={cn(
            styles.card,
            mobile && styles.railItem,
            "flex flex-col justify-between gap-7 overflow-hidden rounded-3xl border border-[#0a0a0b]/[.08] bg-white p-5 shadow-[0_1px_2px_rgba(10,10,11,.04),0_24px_48px_rgba(10,10,11,.05)] md:p-7",
            mobile ? "w-[322px] shrink-0" : span,
          )}
          style={mobile ? undefined : { transitionDelay: `${i * 60}ms` }}
        >
          <div className="flex flex-1 flex-col justify-center">{visual}</div>
          <div className="flex flex-col gap-2.5">
            <h3 className={cn(styles.display, INK, "m-0 text-[22px] leading-tight md:text-[26px]")}>
              {title}
            </h3>
            <p className="m-0 text-[15px] leading-relaxed text-[#0a0a0b]/65 md:text-base">
              {body}
            </p>
          </div>
        </article>
      ))}
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"home">>>;

/** Carte « Ta prochaine action », avec deux cartes empilées derrière. */
function MissionVisual({ t }: { t: T }) {
  return (
    <div className="relative h-[268px] md:h-[250px]">
      <div className={cn(MOCK, "absolute inset-x-7 top-0 h-10 opacity-50")} />
      <div className={cn(MOCK, "absolute inset-x-3.5 top-3.5 h-11 opacity-75")} />
      <div className={cn(MOCK, "absolute inset-x-0 top-7 flex flex-col gap-3 p-4")}>
        <div className="flex items-center justify-between gap-2">
          <Mono className="text-[#7c5cbf]">{t("mock.nextAction")}</Mono>
          <div className="flex shrink-0 gap-1.5">
            <span className={cn(styles.mono, "rounded-full border border-[#0a0a0b]/15 px-2 py-1 text-[9px] whitespace-nowrap text-[#0a0a0b]/55")}>
              {/* i18n-exempt: nom de plateforme (marque). */}
              TikTok
            </span>
            <span className={cn(styles.mono, "rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[9px] whitespace-nowrap text-amber-700")}>
              {/* i18n-exempt: délai affiché tel quel dans l'app. */}
              &lt; 48 h
            </span>
          </div>
        </div>
        <span className={cn(styles.display, INK, "text-[19px] leading-tight")}>
          {t("mock.missionTitle")}
        </span>
        <span className="text-[13px] text-[#0a0a0b]/55">{t("mock.due")}</span>
        <span className="mt-1 inline-flex self-start items-center gap-2 rounded-[10px] bg-[#7c5cbf] px-4 py-2.5 text-[13px] font-semibold text-white">
          {t("mock.start")} →
        </span>
      </div>
      <div className={cn(MOCK, "absolute inset-x-4 bottom-0 flex items-center justify-between gap-2 px-3.5 py-3 md:inset-x-6")}>
        <span className="truncate text-[13px] text-[#0a0a0b]/75">
          {/* i18n-exempt: titre d'un script de démonstration (donnée). */}
          Storytime : j&apos;ai tout vu
        </span>
        <span className={cn(styles.mono, "rounded-full border border-[#0a0a0b]/15 px-2 py-1 text-[9px] text-[#0a0a0b]/55")}>
          {t("mock.todo")}
        </span>
      </div>
    </div>
  );
}

/** Les deux zones du script : ce qui va dans la vidéo, ce qui va en description. */
function ScriptVisual({ t }: { t: T }) {
  return (
    <div className="flex flex-col gap-3.5 sm:flex-row sm:items-stretch">
      <div className={cn(MOCK, "flex flex-1 flex-col gap-2.5 p-4")}>
        <div className="flex items-center gap-2">
          <span className="text-[15px]">🎬</span>
          <Mono className="text-[#7c5cbf]">{t("mock.inVideo")}</Mono>
        </div>
        <span className={cn(INK, "text-sm leading-relaxed")}>{t("mock.hook")}</span>
        <div className="mt-0.5 flex flex-col gap-1.5">
          <Line w="100%" />
          <Line w="86%" />
          <Line w="64%" />
        </div>
      </div>
      <div className={cn(MOCK, "flex flex-1 flex-col gap-2.5 p-4")}>
        <div className="flex items-center gap-2">
          <span className="text-[15px]">📝</span>
          <Mono className="text-teal-700">{t("mock.inCaption")}</Mono>
        </div>
        <span className={cn(INK, "text-sm leading-relaxed")}>{t("mock.cta")}</span>
        <Line w="78%" />
        <span className="mt-auto inline-flex self-start items-center gap-1.5 rounded-lg border border-[#0a0a0b]/15 px-2.5 py-1.5 text-xs text-[#0a0a0b]/70">
          ⧉ {t("mock.copy")}
        </span>
      </div>
    </div>
  );
}

/** Relevé de vues : compteur, courbe, et les deux derniers posts. */
function ViewsVisual({
  t,
  n,
  compact,
}: {
  t: T;
  n: Intl.NumberFormat;
  compact: Intl.NumberFormat;
}) {
  const rows = [
    { meta: t("mock.postMetaTiktok"), views: 48_300, delta: 12_400 },
    { meta: t("mock.postMetaInstagram"), views: 23_900, delta: 3_100 },
  ];
  return (
    <div className={cn(MOCK, "overflow-hidden")}>
      <div className="flex items-end justify-between gap-2.5 px-4 pt-4 pb-1.5">
        <div className="flex flex-col gap-1">
          <Mono className="text-[#0a0a0b]/45">{t("mock.totalViews")}</Mono>
          <span className={cn(styles.display, INK, "text-3xl")}>{compact.format(8_400_000)}</span>
        </div>
        <span className={cn(styles.mono, "rounded-full border border-green-700/25 bg-green-700/[.08] px-2 py-1 text-[9px] text-green-700")}>
          {t("mock.dailyPull")}
        </span>
      </div>
      <svg
        viewBox="0 0 320 70"
        // i18n-exempt: valeur SVG, pas du texte
        preserveAspectRatio="none"
        aria-hidden
        className="block h-[70px] w-full"
      >
        <defs>
          {/* i18n-exempt: valeurs SVG/CSS, pas du texte. */}
          <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
            {/* i18n-exempt: couleurs du dégradé, pas du texte. */}
            <stop offset="0%" stopColor="rgba(124,92,191,.35)" />
            {/* i18n-exempt: couleurs du dégradé, pas du texte. */}
            <stop offset="100%" stopColor="rgba(124,92,191,0)" />
          </linearGradient>
        </defs>
        {/* i18n-exempt: tracé SVG, pas du texte. */}
        <path
          d="M0,58 C40,52 60,30 96,34 C132,38 150,16 190,22 C230,28 250,8 290,6 L320,4 L320,70 L0,70 Z"
          fill="url(#viewsGradient)"
        />
        <path
          d="M0,58 C40,52 60,30 96,34 C132,38 150,16 190,22 C230,28 250,8 290,6 L320,4"
          fill="none"
          stroke="#7c5cbf"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
      {rows.map((r) => (
        <div key={r.meta} className="flex items-center gap-2.5 border-t border-[#0a0a0b]/[.07] px-3 py-2.5">
          <span className="h-[34px] w-[26px] rounded-md bg-gradient-to-br from-[#e7e4f5] to-[#d5d8e4]" />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className={cn(INK, "text-[13px]")}>
              {/* i18n-exempt: pseudo d'exemple (donnée). */}
              @lea.snytch
            </span>
            <Mono className="text-[9px] text-[#0a0a0b]/45">{r.meta}</Mono>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className={cn(styles.display, INK, "text-base")}>{n.format(r.views)}</span>
            <span className="text-[11px] text-green-700">
              {t("mock.yesterday", { n: n.format(r.delta) })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Gains du cycle : le montant, puis la barre fixe / vues / bonus. */
function EarningsVisual({ t }: { t: T }) {
  const legend = [
    { color: "bg-[#0a0a0b]", label: t("mock.fixed"), value: "15,00 $" },
    { color: "bg-[#7c5cbf]", label: t("mock.views"), value: "84,60 $" },
    { color: "bg-green-700", label: t("mock.bonus"), value: "0,00 $" },
  ];
  return (
    <div className={cn(MOCK, "flex flex-col gap-3.5 p-4")}>
      <div className="flex items-baseline justify-between gap-2">
        <Mono className="text-[#0a0a0b]/45">{t("mock.cycle")}</Mono>
        <span className="text-[11px] text-[#0a0a0b]/50">{t("mock.paidIn")}</span>
      </div>
      {/* i18n-exempt: montant d'exemple (donnée chiffrée). */}
      <span className={cn(styles.display, INK, "text-[40px] leading-none")}>99,60 $</span>
      <div className="flex gap-[3px]">
        <span className="h-2 w-[15%] rounded-full bg-[#0a0a0b]" />
        <span className="h-2 w-[83%] rounded-full bg-[#7c5cbf]" />
        <span className="h-2 w-[2%] rounded-full bg-green-700" />
      </div>
      <div className="flex justify-between gap-2.5">
        {legend.map((l) => (
          <div key={l.label} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className={cn("size-[7px] rounded-full", l.color)} />
              <span className="text-[11px] text-[#0a0a0b]/55">{l.label}</span>
            </div>
            <span className={cn(styles.display, INK, "text-[15px]")}>{l.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Palier de bonus : la barre de progression et les deux pastilles. */
function TiersVisual({ t, n }: { t: T; n: Intl.NumberFormat }) {
  return (
    <div className={cn(MOCK, "flex flex-col gap-3.5 p-4")}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-[#7c5cbf]/10 text-lg">🏆</span>
        <div className="flex flex-col gap-0.5">
          <Mono className="text-[#0a0a0b]/45">{t("mock.nextTier")}</Mono>
          <span className={cn(INK, "text-sm font-semibold")}>{t("mock.tierGoal")}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-2.5 overflow-hidden rounded-full bg-[#0a0a0b]/[.07]">
          <span className="block h-full w-[64%] rounded-full bg-gradient-to-r from-[#7c5cbf] to-[#b39bef]" />
        </div>
        <div className="flex justify-between text-[11px] text-[#0a0a0b]/55">
          <span>{n.format(192_000)}</span>
          <span>{n.format(0.64 * 100)} %</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={cn(styles.mono, "rounded-full border border-green-700/25 bg-green-700/[.08] px-2 py-1 text-[9px] text-green-700")}>
          {t("mock.tierUnlocked")}
        </span>
        <span className={cn(styles.mono, "rounded-full border border-[#7c5cbf]/25 bg-[#7c5cbf]/10 px-2 py-1 text-[9px] text-[#7c5cbf]")}>
          {t("mock.tierCurrent")}
        </span>
      </div>
    </div>
  );
}

/** Trois notifications empilées en escalier. */
function NotifVisual({ t }: { t: T }) {
  const notes = [
    { icon: "🚀", bg: "bg-[#7c5cbf]/10", who: t("mock.notifSender"), at: "14:02", body: t("mock.notifViews"), offset: "ml-0" },
    { icon: "✉️", bg: "bg-green-700/10", who: t("mock.reminderSender"), at: "07:30", body: t("mock.reminderBody"), offset: "ml-4" },
    { icon: "💸", bg: "bg-amber-500/12", who: t("mock.paymentSender"), at: "09:00", body: t("mock.paymentBody"), offset: "ml-8" },
  ];
  return (
    <div className="flex flex-col gap-3">
      {notes.map((note) => (
        <div key={note.who} className={cn(MOCK, "flex gap-2.5 px-3.5 py-3", note.offset)}>
          <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-[9px] text-sm", note.bg)}>
            {note.icon}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-baseline gap-1.5">
              <span className={cn(INK, "text-xs font-semibold")}>{note.who}</span>
              <Mono className="text-[9px] text-[#0a0a0b]/40">{note.at}</Mono>
            </div>
            <span className="text-[12.5px] leading-snug text-[#0a0a0b]/70">{note.body}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
