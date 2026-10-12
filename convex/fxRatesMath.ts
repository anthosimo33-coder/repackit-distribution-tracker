import { referenceCurrency } from "./comptaMath";
import { projectFx } from "./whopRevenue";
import { isCurrencyCode, isPayCurrencyConvertible, normalizeCurrency } from "./payCurrency";

/**
 * TAUX DE CHANGE D'UN PROJET — la règle, sans base (module pur, testé dans
 * lib/fx-rates.test.ts). convex/fxRates la sert à l'écran et l'applique à
 * l'écriture ; les setters internes de convex/projects passent par la même.
 *
 * Un projet porte DEUX sortes de taux, tous vers la MÊME cible :
 *  - `fxRateToRevenue` : 1 unité de la devise de PAIE = x unités de la cible ;
 *  - `fxRatesToRevenue` : la même chose pour chaque AUTRE devise (encaissée en
 *    Whop, ou d'un barème).
 * La cible n'est écrite nulle part : c'est la seule devise encaissée SANS taux
 * (cf comptaMath.referenceCurrency, summarizeWhopRevenue). D'où la règle qui
 * tient tout le reste : la cible n'a jamais de taux.
 *
 * Les taux ne changent jamais ce qu'une créatrice touche — la paie se règle
 * dans la devise de son barème, sans conversion. Ils servent aux analyses
 * (marge, coûts, totaux multi-devises) et à l'admission d'un barème dans une
 * autre devise que celle du projet.
 */

/** Ce qu'il faut d'un projet pour raisonner sur ses taux. */
export type FxProject = {
  payCurrency?: string;
  fxRateToRevenue?: number;
  fxRatesToRevenue?: { currency: string; rate: number }[];
};

/** Devises encaissées : ventes Whop récentes + devise retenue par le grand livre. */
export type FxCollected = {
  seen: readonly string[];
  comptaReference: string | null;
};

/**
 * LA CIBLE DES TAUX — la devise vers laquelle chaque taux ramène.
 *
 *  - le projet encaisse : c'est la devise du REVENU (`source: "revenue"`) ;
 *  - il n'encaisse rien : c'est sa devise de PAIE (`source: "pay"`). Les taux y
 *    convertissent les barèmes d'une autre devise ; le jour où le revenu arrive
 *    dans cette même devise, rien n'est à refaire ;
 *  - plusieurs devises encaissées sans taux (ou toutes en ont un) : `null`.
 *    `candidates` nomme celles entre lesquelles choisir.
 */
export type FxTargetState = {
  target: string | null;
  source: "revenue" | "pay" | null;
  /** Devises encaissées, triées. */
  collected: string[];
  /** Cibles possibles quand `target` est indéterminée. */
  candidates: string[];
};

export function fxTargetFrom(collected: FxCollected, project: FxProject): FxTargetState {
  const seen = new Set(
    collected.seen.map((c) => normalizeCurrency(c)).filter((c): c is string => c !== null),
  );
  const compta = normalizeCurrency(collected.comptaReference);
  if (compta) seen.add(compta);
  const sorted = [...seen].sort();
  const fx = projectFx(project);
  const reference = referenceCurrency(seen, fx) ?? compta;
  if (reference !== null) {
    return { target: reference, source: "revenue", collected: sorted, candidates: [] };
  }
  if (seen.size === 0) {
    const pay = normalizeCurrency(project.payCurrency);
    return {
      target: pay,
      source: pay === null ? null : "pay",
      collected: sorted,
      candidates: [],
    };
  }
  const withRate = new Set((fx ?? []).map((x) => x.from));
  const sansTaux = sorted.filter((c) => !withRate.has(c));
  return {
    target: null,
    source: null,
    collected: sorted,
    candidates: sansTaux.length > 0 ? sansTaux : sorted,
  };
}

/** Taux posé sur une devise (celui de la paie, ou le sien), `null` si aucun. */
export function fxRateOf(project: FxProject, currency: string): number | null {
  const c = normalizeCurrency(currency);
  if (c === null) return null;
  if (c === normalizeCurrency(project.payCurrency)) {
    const r = project.fxRateToRevenue;
    return typeof r === "number" && r > 0 ? r : null;
  }
  const own = (project.fxRatesToRevenue ?? []).find(
    (r) => normalizeCurrency(r.currency) === c && r.rate > 0,
  );
  return own ? own.rate : null;
}

/**
 * La première devise de barème que ces taux ne savent plus ramener dans la
 * devise du projet, `null` si toutes le peuvent. Une telle devise ferait
 * mentir `payCurrencyFactor` sur tous les écrans d'analyse.
 */
export function unconvertiblePricingCurrency(
  project: FxProject,
  collected: FxCollected,
  pricingCurrencies: readonly string[],
): string | null {
  const pay = normalizeCurrency(project.payCurrency);
  const target = fxTargetFrom(collected, project).target;
  for (const raw of pricingCurrencies) {
    const c = normalizeCurrency(raw);
    if (c === null || c === pay) continue;
    if (!isPayCurrencyConvertible(c, project, target)) return c;
  }
  return null;
}

export type FxRefusal =
  | { code: "FX_CURRENCY_INVALID"; params: { currency: string } }
  | { code: "FX_RATE_INVALID"; params: Record<string, never> }
  | { code: "FX_TARGET_UNKNOWN"; params: { currencies: string } }
  | { code: "FX_RATE_ON_TARGET"; params: { currency: string } }
  | { code: "FX_RATE_NEEDED_BY_REVENUE"; params: { currency: string } }
  | { code: "FX_RATE_NEEDED_BY_MARGIN"; params: { currency: string; target: string } }
  | { code: "FX_RATE_NEEDED_BY_PRICING"; params: { currency: string } };

export type FxPatch = Pick<FxProject, "fxRateToRevenue" | "fxRatesToRevenue">;

/**
 * UN CHANGEMENT DE TAUX — poser (`rate` > 0) ou retirer (`rate: null`) le taux
 * d'une devise. Rend le patch du projet, ou le refus.
 *
 * `target` n'est lu que si la cible est indéterminée (`candidates`) : c'est
 * l'écran qui la fait choisir, et elle doit être l'une des candidates.
 *
 * Refus :
 *  - un taux SUR la cible : elle cesserait d'être la cible, et les totaux du
 *    revenu multi-devises retomberaient à zéro ;
 *  - retirer le taux d'une devise ENCAISSÉE (ses ventes ne s'additionneraient
 *    plus), ou celui de la paie quand le revenu est ailleurs (plus de marge) :
 *    un taux faux se CORRIGE, il ne se retire pas. Seule exception : le taux
 *    posé à tort sur la cible elle-même, que l'on retire pour réparer ;
 *  - tout changement après lequel un barème ne serait plus convertible.
 */
export function applyFxChange(
  project: FxProject,
  collected: FxCollected,
  pricingCurrencies: readonly string[],
  change: { currency: string; rate: number | null; target?: string | null },
): { ok: true; patch: FxPatch } | { ok: false; refusal: FxRefusal } {
  const c = normalizeCurrency(change.currency);
  if (c === null || !isCurrencyCode(c)) {
    return {
      ok: false,
      refusal: {
        code: "FX_CURRENCY_INVALID",
        params: { currency: change.currency.trim().toUpperCase() || "—" },
      },
    };
  }
  const C = c.toUpperCase();
  if (change.rate !== null && !(Number.isFinite(change.rate) && change.rate > 0)) {
    return { ok: false, refusal: { code: "FX_RATE_INVALID", params: {} } };
  }

  const state = fxTargetFrom(collected, project);
  let target = state.target;
  if (target === null) {
    const chosen = normalizeCurrency(change.target);
    if (chosen === null || !state.candidates.includes(chosen)) {
      return {
        ok: false,
        refusal: {
          code: "FX_TARGET_UNKNOWN",
          params: { currencies: state.candidates.map((x) => x.toUpperCase()).join(", ") },
        },
      };
    }
    target = chosen;
  }

  const pay = normalizeCurrency(project.payCurrency);
  if (change.rate !== null && c === target) {
    return { ok: false, refusal: { code: "FX_RATE_ON_TARGET", params: { currency: C } } };
  }
  if (change.rate === null && c !== target && fxRateOf(project, c) !== null) {
    if (state.collected.includes(c)) {
      return {
        ok: false,
        refusal: { code: "FX_RATE_NEEDED_BY_REVENUE", params: { currency: C } },
      };
    }
    if (c === pay && state.source === "revenue") {
      return {
        ok: false,
        refusal: {
          code: "FX_RATE_NEEDED_BY_MARGIN",
          params: { currency: C, target: target.toUpperCase() },
        },
      };
    }
  }

  const patch: FxPatch = {};
  if (c === pay) {
    patch.fxRateToRevenue = change.rate ?? undefined;
  } else {
    const rates = (project.fxRatesToRevenue ?? []).filter(
      (r) => normalizeCurrency(r.currency) !== c,
    );
    if (change.rate !== null) rates.push({ currency: c, rate: change.rate });
    rates.sort((a, b) => a.currency.localeCompare(b.currency));
    patch.fxRatesToRevenue = rates.length > 0 ? rates : undefined;
  }
  const blocked = unconvertiblePricingCurrency(
    { ...project, ...patch },
    collected,
    pricingCurrencies,
  );
  if (blocked !== null) {
    return {
      ok: false,
      refusal: {
        code: "FX_RATE_NEEDED_BY_PRICING",
        params: { currency: blocked.toUpperCase() },
      },
    };
  }
  return { ok: true, patch };
}

/** Phrase française d'un refus — repli du code, que le client traduit (error.ERR_*). */
export function fxRefusalMessage(r: FxRefusal): string {
  switch (r.code) {
    case "FX_CURRENCY_INVALID":
      // i18n-exempt: repli FR du code ERR_FX_*, traduit côté client (error.*)
      return `« ${r.params.currency} » n'est pas un code devise : trois lettres, comme EUR, USD ou RSD.`;
    case "FX_RATE_INVALID":
      // i18n-exempt: repli FR du code ERR_FX_*, traduit côté client (error.*)
      return "Un taux de change est un nombre strictement positif.";
    case "FX_TARGET_UNKNOWN":
      // i18n-exempt: repli FR du code ERR_FX_*, traduit côté client (error.*)
      return `La devise du revenu est indéterminée (${r.params.currencies}) : choisis laquelle reste sans taux.`;
    case "FX_RATE_ON_TARGET":
      // i18n-exempt: repli FR du code ERR_FX_*, traduit côté client (error.*)
      return `${r.params.currency} est la devise du revenu : les autres taux ramènent vers elle, elle n'en a pas.`;
    case "FX_RATE_NEEDED_BY_REVENUE":
      // i18n-exempt: repli FR du code ERR_FX_*, traduit côté client (error.*)
      return `Des ventes sont encaissées en ${r.params.currency} : sans ce taux, le revenu ne s'additionnerait plus. Corrige-le plutôt que de le retirer.`;
    case "FX_RATE_NEEDED_BY_MARGIN":
      // i18n-exempt: repli FR du code ERR_FX_*, traduit côté client (error.*)
      return `${r.params.currency} est la devise de paie et le revenu est en ${r.params.target} : sans ce taux, la marge ne se calculerait plus. Corrige-le plutôt que de le retirer.`;
    case "FX_RATE_NEEDED_BY_PRICING":
      // i18n-exempt: repli FR du code ERR_FX_*, traduit côté client (error.*)
      return `Des barèmes sont en ${r.params.currency} : sans ce taux, leur coût ne pourrait plus être ramené dans la devise du projet.`;
  }
}
