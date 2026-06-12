import { createE2eClient } from "../e2e/helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const client = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

type Mecanique =
  | "Erreur"
  | "Volume"
  | "Comparaison"
  | "Contradiction"
  | "Universalité"
  | "Question";
type Niveau = "Broad-A" | "Broad-B" | "Niché";
type Format = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
type Angle = "Psycho" | "Accusatoire" | "Pédagogique" | "Observation" | "Provocant";
type Plateforme = "TikTok" | "Instagram";
type Langue = "FR" | "EN";

type SeedSpec = {
  hookText: string;
  mecanique: Mecanique;
  niveau: Niveau;
  format: Format;
  angleTonal: Angle;
  langue: Langue;
  compte: string;
  // metrics per plateforme
  metrics: Partial<Record<Plateforme, { vuesJ7: number; saves: number } | null>>;
};

const SLIDES_5 = Array.from({ length: 7 }, (_, i) => ({
  position: i + 1,
  texte: `Slide ${i + 1} (placeholder)`,
}));

const todayMs = Date.now();
const day = 86_400_000;

const SPECS: SeedSpec[] = [
  {
    hookText:
      "5 erreurs que tu fais à chaque fois que tu scrolles YouTube",
    mecanique: "Erreur",
    niveau: "Broad-A",
    format: "A",
    angleTonal: "Psycho",
    langue: "FR",
    compte: "@compte_1",
    metrics: {
      TikTok: { vuesJ7: 1500, saves: 60 }, // 4.00% WINNER
      Instagram: { vuesJ7: 1200, saves: 30 }, // 2.50% MOYEN
    },
  },
  {
    hookText:
      "J'ai analysé 1000 vidéos YouTube — voilà le pattern caché des viraux",
    mecanique: "Volume",
    niveau: "Broad-B",
    format: "B",
    angleTonal: "Accusatoire",
    langue: "FR",
    compte: "@compte_2",
    metrics: {
      TikTok: { vuesJ7: 2000, saves: 70 }, // 3.50% WINNER
      Instagram: { vuesJ7: 800, saves: 12 }, // 1.50% MOYEN
    },
  },
  {
    hookText:
      "Stranger Things vs MrBeast : exactement la même mécanique d'accroche",
    mecanique: "Comparaison",
    niveau: "Niché",
    format: "C",
    angleTonal: "Pédagogique",
    langue: "FR",
    compte: "@compte_3",
    metrics: {
      TikTok: { vuesJ7: 500, saves: 3 }, // 0.60% FOLD
      Instagram: null, // pending
    },
  },
];

async function main() {
  // Make sure DB is empty (or known-empty after wipe)
  const existing = await client.query(api.publications.listPublications, {});
  if (existing.length > 0) {
    console.error(
      `❌ Found ${existing.length} existing publications. Run wipe-publications.ts first.`,
    );
    process.exit(1);
  }

  console.log("Seeding 3 carrousels (6 publications)...\n");

  for (let i = 0; i < SPECS.length; i++) {
    const spec = SPECS[i];
    // Get next carousel ID (will be C001, C002, C003 progressively)
    const carouselId = await client.query(
      api.publications.getNextCarouselId,
    );

    const platforms = Object.keys(spec.metrics) as Plateforme[];
    const result = await client.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null, // custom hook
      hookText: spec.hookText,
      mecanique: spec.mecanique,
      niveau: spec.niveau,
      format: spec.format,
      nbSlides: 7,
      slides: SLIDES_5,
      angleTonal: spec.angleTonal,
      langue: spec.langue,
      plateformes: platforms,
      compte: spec.compte,
      datePubli: todayMs - i * day, // spread over 3 days desc
      notes: "",
    });

    console.log(
      `Created ${carouselId} on ${platforms.join(" + ")} — ${spec.mecanique}/${spec.niveau}/${spec.format}/${spec.angleTonal}`,
    );

    // Now update metrics on each row
    const allPubs = await client.query(api.publications.listPublications, {});
    const newPubs = allPubs.filter((p) => p.carouselId === carouselId);

    for (const pub of newPubs) {
      const metrics = spec.metrics[pub.plateforme as Plateforme];
      if (metrics) {
        await client.mutation(api.publications.updateMetrics, {
          id: pub._id,
          vuesJ7: metrics.vuesJ7,
          saves: metrics.saves,
        });
        const rate = metrics.saves / metrics.vuesJ7;
        const verdict =
          rate >= 0.03 ? "WINNER" : rate >= 0.01 ? "MOYEN" : "FOLD";
        console.log(
          `  ${pub.plateforme}: ${metrics.vuesJ7} vues, ${metrics.saves} saves → ${(rate * 100).toFixed(2)}% ${verdict}`,
        );
      } else {
        console.log(`  ${pub.plateforme}: pending (no metrics)`);
      }
    }
  }

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
