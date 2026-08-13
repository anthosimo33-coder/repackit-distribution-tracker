import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Doc } from "../convex/_generated/dataModel";
import {
  QUOTA_WINDOW_DAYS,
  countOnHandle,
  quotaWindowRange,
  tallyByHandleAndDay,
} from "../convex/clipQuota";
import { utcDayKey } from "../convex/accountPhase";

/**
 * Le comptage du quota. Ce qui est vérifié ici n'est pas « ça compte bien 2 »,
 * c'est que la GARDE et l'ÉCRAN comptent la même chose — un compteur qui annonce
 * un créneau libre pendant que le serveur refuse est le seul défaut de cette PR
 * qui ferait perdre confiance à un clippeur en une seule vue.
 */

/** Publication réduite aux deux champs que le comptage regarde. */
const pub = (compte: string, datePubli: number) =>
  ({ compte, datePubli }) as Doc<"publications">;

// Handles de la forme réelle : un pseudo de clippeur porte un suffixe.
const MARINE = "@marine.bn07";
const LUCAS = "@lucas.clips24";

const MIDI_12 = Date.UTC(2026, 7, 12, 12, 0);
const MIDI_11 = Date.UTC(2026, 7, 11, 12, 0);

describe("countOnHandle — rapprochement par handle", () => {
  it("ne compte que les publications du compte visé", () => {
    const lot = [
      pub(MARINE, MIDI_12),
      pub(LUCAS, MIDI_12),
      pub(MARINE, MIDI_12),
    ];
    expect(countOnHandle(lot, MARINE)).toBe(2);
    expect(countOnHandle(lot, LUCAS)).toBe(1);
    expect(countOnHandle(lot, "@inconnu.99")).toBe(0);
  });

  it("le rapprochement est EXACT, pas une sous-chaîne", () => {
    // Un handle qui en contient un autre (@marine / @marine.bn07) ne doit pas
    // faire fuiter le compteur d'un compte dans celui d'un autre.
    const lot = [pub("@marine", MIDI_12), pub(MARINE, MIDI_12)];
    expect(countOnHandle(lot, "@marine")).toBe(1);
    expect(countOnHandle(lot, MARINE)).toBe(1);
  });
});

describe("tallyByHandleAndDay — seau = journée UTC", () => {
  it("ventile par compte et par jour", () => {
    const lot = [
      pub(MARINE, MIDI_11),
      pub(MARINE, MIDI_12),
      pub(MARINE, MIDI_12 + 3_600_000),
      pub(LUCAS, MIDI_12),
    ];
    const t = tallyByHandleAndDay(lot, [MARINE, LUCAS]);
    expect(t[MARINE]).toEqual({ "2026-08-11": 1, "2026-08-12": 2 });
    expect(t[LUCAS]).toEqual({ "2026-08-12": 1 });
  });

  it("un compte non demandé n'entre pas dans la table", () => {
    const t = tallyByHandleAndDay([pub(LUCAS, MIDI_12)], [MARINE]);
    expect(t).toEqual({ [MARINE]: {} });
  });

  it("les jours sans publication sont ABSENTS (le lecteur applique 0)", () => {
    const t = tallyByHandleAndDay([pub(MARINE, MIDI_12)], [MARINE]);
    expect(t[MARINE]["2026-08-10"]).toBeUndefined();
    expect(Object.keys(t[MARINE])).toEqual(["2026-08-12"]);
  });

  it("LE PIÈGE : un post de 00h30 à Paris est rangé dans la journée UTC de la veille", () => {
    // 22h30 UTC le 12 = 00h30 à Paris le 13. Le message de refus dit « mercredi
    // 12 août » (formatUtcDayFr) : le compteur doit le ranger là aussi, sinon
    // l'écran et le serveur parlent de deux jours différents.
    const minuitTrenteParis = Date.UTC(2026, 7, 12, 22, 30);
    const t = tallyByHandleAndDay([pub(MARINE, minuitTrenteParis)], [MARINE]);
    expect(t[MARINE]).toEqual({ "2026-08-12": 1 });
    expect(utcDayKey(minuitTrenteParis)).toBe("2026-08-12");
  });
});

describe("quotaWindowRange — la fenêtre de lecture de l'écran", () => {
  it("couvre QUOTA_WINDOW_DAYS journées UTC, aujourd'hui inclus", () => {
    const { start, end } = quotaWindowRange(MIDI_12);
    expect(utcDayKey(start)).toBe("2026-07-14");
    expect(utcDayKey(end - 1)).toBe("2026-08-12");
    expect((end - start) / 86_400_000).toBe(QUOTA_WINDOW_DAYS);
  });

  it("la borne haute EXCLUT le lendemain", () => {
    const { end } = quotaWindowRange(MIDI_12);
    expect(end).toBe(Date.UTC(2026, 7, 13));
  });
});

/**
 * VERROU DE SOURCE. Les fonctions ci-dessus ne garantissent l'accord garde↔écran
 * que tant que la garde les APPELLE. Rien n'empêche un futur passage de ré-inliner
 * une requête `publications` dans `assertClipperDailyQuota` « pour aller plus
 * vite » — et la divergence serait alors invisible jusqu'à ce qu'un clippeur la
 * signale. Ce test échoue à ce moment-là, pas des mois après.
 */
const SRC = readFileSync(join(process.cwd(), "convex", "assignments.ts"), "utf8");

function corpsDeLaGarde(): string {
  const debut = SRC.indexOf("async function assertClipperDailyQuota(");
  const fin = SRC.indexOf("async function confirmPublicationCore(");
  expect(debut).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(debut);
  return SRC.slice(debut, fin);
}

describe("la garde de quota lit le comptage PARTAGÉ", () => {
  it("elle appelle publicationsInRange et countOnHandle", () => {
    const corps = corpsDeLaGarde();
    expect(corps).toContain("publicationsInRange(");
    expect(corps).toContain("countOnHandle(");
  });

  it("elle n'interroge plus la table publications elle-même", () => {
    expect(corpsDeLaGarde()).not.toContain('.query("publications")');
  });
});
