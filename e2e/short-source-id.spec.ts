import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/** Texte d'erreur d'un rejet ConvexError (data string OU message). */
function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { data?: unknown; message?: unknown };
    const data = typeof o.data === "string" ? o.data : "";
    const msg = typeof o.message === "string" ? o.message : "";
    return `${data} ${msg}`;
  }
  return String(e);
}

async function ensureCompte(
  handle: string,
  plateforme: "TikTok" | "Instagram" | "YouTube",
) {
  const comptes = await convex.query(api.comptes.listComptes, {});
  const existing = comptes.find(
    (c) => c.handle === handle && c.plateforme === plateforme,
  );
  if (existing) {
    if (!existing.actif) {
      await convex.mutation(api.comptes.updateCompte, {
        id: existing._id,
        actif: true,
      });
    }
    return;
  }
  await convex.mutation(api.comptes.createCompte, {
    handle,
    plateforme,
    notes: `${E2E_MARKER} source-id spec`,
  });
}

/**
 * Anti-shadowban — validation sourceId côté serveur (createPublication).
 *
 * Un seul test stateful (DB partagée, séquentiel) : TikTok strict bloquant,
 * Instagram bloquant sauf override, puis vérif matrice listSources.
 */
test.describe("Anti-shadowban — validation sourceId (serveur)", () => {
  test("TikTok strict bloquant / Instagram override / matrice", async () => {
    const ts = Date.now();
    const source = `e2e_src_${ts}.mp4`; // normalisé → "e2e_src_<ts>"
    const normalized = `e2e_src_${ts}`;

    const icpId = await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} src ${ts}`,
    });
    await ensureCompte("@e2e_src_tt1", "TikTok");
    await ensureCompte("@e2e_src_tt2", "TikTok");
    await ensureCompte("@e2e_src_ig1", "Instagram");

    const base = {
      hookId: null,
      hookText: `${E2E_MARKER} hook ${ts}`,
      mecanique: "Erreur" as const,
      niveau: "Broad-A" as const,
      angleTonal: "Psycho" as const,
      langue: "FR" as const,
      mediaType: "short" as const,
      icpId,
      datePubli: ts,
      notes: `${E2E_MARKER} src spec`,
    };

    // Test 1 — source inédite sur TikTok → succès.
    await convex.mutation(api.publications.createPublication, {
      ...base,
      carouselId: `E2ESRC${ts}1`,
      plateformes: ["TikTok"],
      compte: "@e2e_src_tt1",
      sourceId: source,
    });

    // Test 2 — même source sur TikTok (autre compte) → ConvexError bloquant.
    let err2: unknown = null;
    try {
      await convex.mutation(api.publications.createPublication, {
        ...base,
        carouselId: `E2ESRC${ts}2`,
        plateformes: ["TikTok"],
        compte: "@e2e_src_tt2",
        sourceId: source,
      });
    } catch (e) {
      err2 = e;
    }
    expect(err2).not.toBeNull();
    expect(errText(err2)).toMatch(/TikTok/i);

    // Test 3 — repost cross-plateforme TikTok → Instagram (1ère fois sur IG).
    // Autorisé sans override (la feature anti-shadowban autorise le cross-
    // plateforme ; seul le même plateforme est contraint).
    await convex.mutation(api.publications.createPublication, {
      ...base,
      carouselId: `E2ESRC${ts}3`,
      plateformes: ["Instagram"],
      compte: "@e2e_src_ig1",
      sourceId: source,
    });

    // Test 4 — RE-post sur Instagram (déjà posté) SANS override → soft block.
    let err4: unknown = null;
    try {
      await convex.mutation(api.publications.createPublication, {
        ...base,
        carouselId: `E2ESRC${ts}4`,
        plateformes: ["Instagram"],
        compte: "@e2e_src_ig1",
        sourceId: source,
      });
    } catch (e) {
      err4 = e;
    }
    expect(err4).not.toBeNull();
    expect(errText(err4)).toMatch(/Instagram/i);

    // Test 5 — re-post Instagram AVEC override → succès.
    await convex.mutation(api.publications.createPublication, {
      ...base,
      carouselId: `E2ESRC${ts}5`,
      plateformes: ["Instagram"],
      compte: "@e2e_src_ig1",
      sourceId: source,
      confirmDuplicateOverride: true,
    });

    // Vérif matrice : couverture TikTok + Instagram, pas YouTube.
    const sources = await convex.query(api.publications.listSources, {});
    const entry = sources.find((s) => s.sourceId === normalized);
    expect(entry).toBeTruthy();
    expect(entry?.coverage.tiktok).toBe(true);
    expect(entry?.coverage.instagram).toBe(true);
    expect(entry?.coverage.youtube).toBe(false);
  });
});
