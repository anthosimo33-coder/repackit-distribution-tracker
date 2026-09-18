import { ImageResponse } from "next/og";
import { fetchQuery } from "convex/nextjs";
import { getLocale, getTranslations } from "next-intl/server";
import { api } from "@/convex/_generated/api";
import { intlTag } from "@/lib/intl-locale";
import { formatPercent } from "@/lib/format";

/**
 * L'image d'aperçu du lien (1200×630), celle que WhatsApp, Slack ou iMessage
 * affichent quand on colle `/s/<token>`. Elle ne montre que ce que le lien
 * montre déjà : le chiffre de tête n'apparaît que si son bloc est partagé.
 */
// i18n-exempt: texte alternatif générique, nom de marque
export const alt = "Jarvia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("publicShare");
  const loc = intlTag(await getLocale());

  let share: Awaited<ReturnType<typeof fetchQuery<typeof api.publicShares.getPublicShare>>> | null =
    null;
  try {
    share = await fetchQuery(api.publicShares.getPublicShare, { token });
  } catch {
    share = null;
  }

  const valid = share !== null && share.status === "valid" ? share : null;
  const accent = valid?.accentColor ?? "#0f172a";
  const compact = (n: number) =>
    new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1 }).format(n);

  let headline: { value: string; label: string } | null = null;
  if (valid?.view.kpi?.views !== undefined) {
    headline = { value: compact(valid.view.kpi.views), label: t("kpi.views") };
  } else if (valid?.view.kpi && "engagement" in valid.view.kpi && valid.view.kpi.engagement != null) {
    headline = {
      value: formatPercent(valid.view.kpi.engagement, 1, loc),
      label: t("kpi.engagement"),
    };
  }

  const fmtDay = (ts: number) =>
    new Date(ts).toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "Europe/Paris" });
  const period =
    valid === null
      ? null
      : valid.period.from === null
        ? t("period.all")
        : t("period.range", { from: fmtDay(valid.period.from), to: fmtDay(valid.period.to ?? Date.now()) });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: accent,
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              fontWeight: 700,
            }}
          >
            {(valid?.projectName ?? "J").slice(0, 1).toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: "#0f172a" }}>
              {valid?.name ?? "Jarvia"}
            </div>
            {valid && (
              <div style={{ fontSize: 28, color: "#64748b" }}>
                {`${valid.projectName} · ${period}`}
              </div>
            )}
          </div>
        </div>

        {headline ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
            <div style={{ fontSize: 168, fontWeight: 800, color: "#0f172a", letterSpacing: -6 }}>
              {headline.value}
            </div>
            <div style={{ fontSize: 44, color: "#64748b" }}>{headline.label.toLowerCase()}</div>
          </div>
        ) : (
          <div style={{ display: "flex", height: 12, width: 240, borderRadius: 6, background: accent }} />
        )}

        <div style={{ display: "flex", fontSize: 26, color: "#94a3b8" }}>{t("poweredBy")}</div>
      </div>
    ),
    size,
  );
}
