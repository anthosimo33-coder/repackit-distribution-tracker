import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { pct, pctFromFraction } from "./percent";

/**
 * DEUX UNITÉS DE POURCENTAGE dans ce dépôt, et ce n'est pas un accident : les
 * RATIOS servent aux calculs (la projection de rétention fait `1/(1−t)`, qui n'a
 * de sens que sur un ratio), les POINTS servent à l'affichage.
 *
 * Le défaut qui en découle est SILENCIEUX. `pct()` ajoute « % » sans convertir :
 * lui passer un ratio affiche la valeur cent fois trop petite, sans erreur, sans
 * warning, sans rien à l'écran qui cloche — le nombre est simplement faux.
 *
 * Relevé sur données de PROD le 2026-08-30, avant correctif : l'onglet Rétention
 * affichait un taux de renouvellement de 0,5417 comme « 0,542 % » au lieu de
 * 54,2 %. Six champs étaient concernés, sur huit sites d'affichage. L'écran
 * disait que le produit ne retenait personne.
 */
describe("pct vs pctFromFraction", () => {
  it("pct attend des POINTS", () => {
    expect(pct(54.2)).toContain("54,2");
    expect(pct(54.2)).toContain("%");
  });

  it("pctFromFraction attend un RATIO et convertit", () => {
    // Les trois valeurs RÉELLES de prod, telles que la Rétention les recevait.
    expect(pctFromFraction(0.5417)).toContain("54,2");
    expect(pctFromFraction(0.52)).toContain("52");
    expect(pctFromFraction(0.4464)).toContain("44,6");
  });

  it("les deux rendent « — » sur null, jamais 0 %", () => {
    expect(pct(null)).toBe("—");
    expect(pctFromFraction(null)).toBe("—");
    expect(pctFromFraction(undefined)).toBe("—");
  });

  it("un ratio passé à pct produit bien la valeur fausse — le défaut, reproduit", () => {
    // Contrôle OPPOSÉ : si ceci changeait, c'est que `pct` se serait mis à
    // convertir, et tous les champs DÉJÀ en points deviendraient faux.
    expect(pct(0.5417)).not.toContain("54,2");
    expect(pct(0.5417)).toContain("0,5");
  });

  it("un ratio de 0 reste 0 %, pas « — »", () => {
    expect(pctFromFraction(0)).toContain("0");
    expect(pctFromFraction(0)).not.toBe("—");
  });
});

/**
 * GARDE — les champs portés en RATIO ne doivent jamais atteindre `pct()`.
 *
 * La liste est nominative parce que l'unité n'est pas lisible dans le type : un
 * `number | null` ne dit pas s'il vaut 0,54 ou 54. Tant que les deux
 * conventions coexistent, c'est le seul filet qui attrape le mélange — et il
 * documente au passage quel champ est dans quelle unité.
 */
describe("garde-fou : aucun ratio passé à pct()", () => {
  /** Champs de `lib/whop-revenue` et `lib/segment-funnel` portés en RATIO. */
  const RATIOS = [
    "renewalRateResolved",
    "renewalRateWorstCase",
    "renewalShare",
    "matureShare",
    "rateResolved",
    "rateWorstCase",
    "unknownShare",
  ];
  const ROOT = process.cwd();
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
    }
    return out;
  }

  it("aucun champ en ratio n'est passé à pct() en direct", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "components"))) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        const m = line.match(/(?<!From)\bpct\(([^)]*)\)/);
        if (!m) return;
        const arg = m[1];
        for (const r of RATIOS) {
          if (new RegExp(`\\b${r}\\b`).test(arg)) {
            offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} — pct(${arg})`);
          }
        }
      });
    }
    expect(
      offenders,
      `Ratios passés à pct(), donc affichés 100× trop petits :\n  ${offenders.join(
        "\n  ",
      )}\nUtilise pctFromFraction().`,
    ).toEqual([]);
  });
});
