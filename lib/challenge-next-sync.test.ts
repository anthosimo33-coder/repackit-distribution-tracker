/**
 * PROCHAIN RELEVÉ annoncé à la créatrice — « prochain relevé dans X h ».
 *
 * ── Pourquoi ce fichier existe ───────────────────────────────────────────────
 * La première version de `nextNightlySyncAt` était FAUSSE et parfaitement
 * silencieuse. Elle comparait `Number(Intl.format(...))` à 23 ; or en français
 * `format` rend « 23 h », `Number("23 h")` vaut NaN, la comparaison échouait
 * toujours, et la fonction retombait sur son filet `now + 24 h`. Résultat à
 * l'écran : « relevé vers 15h46 » et « prochain relevé dans 23 h » — assez
 * plausible pour ne réveiller personne, et faux pour tout le monde.
 *
 * Ni le typage ni la relecture ne l'ont vu. C'est l'APERÇU VISUEL qui l'a
 * montré. Ces tests sont le filet qui manquait.
 *
 * Les instants sont réels et couvrent les DEUX saisons : le relevé est à 23h30
 * heure de PARIS, soit 21:30 UTC en été et 22:30 UTC en hiver. Une arithmétique
 * qui ajouterait « 23h30 » à un minuit UTC passerait l'un et raterait l'autre.
 */
import { describe, expect, it } from "vitest";
import { nextNightlySyncAt } from "../convex/challengePortal";

/** L'heure de Paris d'un instant, lue proprement (cf le piège ci-dessus). */
function parisTime(ts: number): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Paris",
  }).formatToParts(new Date(ts));
  const h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${m}`;
}

describe("le prochain relevé tombe toujours à 23h30 heure de Paris", () => {
  it("en ÉTÉ (heure d'été, UTC+2)", () => {
    // Samedi 29/08/2026, 15h46 à Paris = 13:46 UTC.
    const now = Date.UTC(2026, 7, 29, 13, 46);
    const next = nextNightlySyncAt(now);
    expect(parisTime(next)).toBe("23:30");
    // Le même jour, dans ~7 h 44 — pas « dans 24 h ».
    expect(next - now).toBeGreaterThan(7 * 3_600_000);
    expect(next - now).toBeLessThan(8 * 3_600_000);
  });

  it("en HIVER (heure normale, UTC+1)", () => {
    // Mardi 12/01/2027, 10h00 à Paris = 09:00 UTC.
    const now = Date.UTC(2027, 0, 12, 9, 0);
    const next = nextNightlySyncAt(now);
    expect(parisTime(next)).toBe("23:30");
  });

  it("juste APRÈS le relevé : c'est celui de DEMAIN qui est annoncé", () => {
    // 23h31 à Paris, en été = 21:31 UTC.
    const now = Date.UTC(2026, 7, 29, 21, 31);
    const next = nextNightlySyncAt(now);
    expect(parisTime(next)).toBe("23:30");
    expect(next).toBeGreaterThan(now);
    // ~24 h plus tard — et cette fois c'est légitime, pas un filet.
    expect(next - now).toBeGreaterThan(23 * 3_600_000);
    expect(next - now).toBeLessThan(25 * 3_600_000);
  });

  it("juste AVANT le relevé : c'est celui de ce soir", () => {
    // 23h29 à Paris = 21:29 UTC.
    const now = Date.UTC(2026, 7, 29, 21, 29);
    const next = nextNightlySyncAt(now);
    expect(parisTime(next)).toBe("23:30");
    expect(next - now).toBeLessThan(2 * 60_000);
  });

  it("la NUIT du changement d'heure d'octobre reste à 23h30 Paris", () => {
    // Le 25/10/2026 la France repasse en UTC+1. Un calcul qui ajouterait un
    // décalage FIXE glisserait d'une heure ici — c'est le défaut que le cron
    // lui-même a été écrit pour éviter (cron horaire + garde sur l'heure de
    // Paris), et cette fonction doit suivre la même règle.
    const veille = nextNightlySyncAt(Date.UTC(2026, 9, 24, 12, 0));
    const lendemain = nextNightlySyncAt(Date.UTC(2026, 9, 25, 12, 0));
    expect(parisTime(veille)).toBe("23:30");
    expect(parisTime(lendemain)).toBe("23:30");
    // Et les deux instants UTC DIFFÈRENT d'une heure de plus qu'un jour plein :
    // la preuve que le fuseau a bien été pris en compte, et non contourné.
    expect(lendemain - veille).toBe(25 * 3_600_000);
  });

  it("ne retombe JAMAIS sur le filet « dans 24 h »", () => {
    // Le défaut d'origine rendait exactement `now + 24 h` à toute heure. On
    // balaie une journée entière : aucun instant ne doit produire cet écart,
    // sauf celui qui suit immédiatement le relevé (cas légitime testé ci-dessus).
    for (let h = 0; h < 24; h++) {
      const now = Date.UTC(2026, 7, 29, h, 5);
      const next = nextNightlySyncAt(now);
      expect(parisTime(next)).toBe("23:30");
      expect(next - now).not.toBe(86_400_000);
    }
  });
});
