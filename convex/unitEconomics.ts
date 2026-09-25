/**
 * ÉCONOMIE UNITAIRE de la Vue d'ensemble (hub Analytics) — logique PURE.
 *
 * Marge nette, revenu net, coût créateurs sur une fenêtre ; puis l'équation par
 * client : revenu par client − coût d'acquisition = marge par client, et le
 * retour sur acquisition. Ce calcul vivait DANS le composant (`aggregatesFor`
 * d'OverviewTab) : il vit ici pour que l'outil MCP `economie_unitaire` rende les
 * MÊMES nombres que l'écran — le runtime Convex n'importe rien de lib/ ni de
 * components/ (règle A6). L'écran appelle ces fonctions ; il n'en garde que
 * l'affichage.
 *
 * Deux devises, jamais additionnées sans taux : le REVENU (Whop, euros) et la
 * PAIE (créatrices, dollars). Tout montant de paie passe par `toDisplayAmount`,
 * qui le ramène dans la devise du revenu quand le projet a un taux — sinon il
 * reste en dollars et la marge n'existe pas.
 */

import { sumInWindow, type AnalyticsWindow } from "./analyticsDates";
import { windowCosts, type AttributionRowLike } from "./attributionWindow";
import { toDisplayAmount, type CurrencyContext, type DisplayAmount } from "./currencyRate";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Un montant de paie est-il SOUSTRACTIBLE du revenu ? Seulement s'il est dans la
 * devise du revenu (même devise, ou converti au taux du projet). Sans taux, il
 * reste en dollars : le soustraire d'euros produirait un nombre faux — la marge,
 * la marge par client et le retour sur acquisition valent alors `null` (« — »),
 * jamais une différence entre deux monnaies.
 */
function soustractible(d: DisplayAmount | null): d is DisplayAmount {
  return d !== null && d.rate !== null;
}
const roundPct = (n: number) => Math.round(n * 10) / 10;

// ─── Évolution vs période précédente ─────────────────────────────────────────

export interface Delta {
  abs: number;
  /** Variation en %. null si la base précédente est nulle (pas de % depuis 0). */
  pct: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * Évolution d'un KPI vs la période précédente. Une base précédente à 0 ne donne
 * PAS +100 % (division par zéro maquillée) mais `pct: null` → l'UI affiche la
 * variation absolue et « — » en relatif.
 */
export function computeDelta(current: number, previous: number): Delta {
  const abs = round2(current - previous);
  return {
    abs,
    pct: previous > 0 ? roundPct((abs / previous) * 100) : null,
    // i18n-exempt: identifiants de direction (up/down/flat) lus par le code, jamais affichés
    direction: abs > 0 ? "up" : abs < 0 ? "down" : "flat",
  };
}

// ─── Garde-fou « clients dashboard vs Whop » ─────────────────────────────────

/** Écart relatif toléré (points de %) entre clients dashboard et Whop. */
export const DASHBOARD_WHOP_TOLERANCE_PCT = 5;
/** Écart ABSOLU toléré (clients). Le masquage exige de franchir % ET absolu. */
export const DASHBOARD_WHOP_TOLERANCE_ABS = 5;

export interface EntreesEcartDashboardWhop {
  reachSteps: readonly { key: string; count: number }[];
  dashboardClients: number | null;
  whopClients: number | null;
  windowReconciliation?: {
    ghostClients: number;
    missingEvents: number;
    unlinkedBeforeBreak: number;
    unlinkedAfterBreak: number;
  };
}

export interface EcartDashboardWhop {
  /** Atteinte brute PostHog (subscription_completed) ; null = tunnel séquentiel seul. */
  posthogReach: number | null;
  posthogClients: number;
  whopClients: number;
  /** Écart SIGNÉ PostHog − Whop, en personnes. */
  signed: number;
  /** Ce que la décomposition prédit (fantômes − paiements sans event). */
  predicted: number;
  unexplained: number;
  /** Bande d'incertitude (events sans membership_id antérieurs à la rupture). */
  band: number;
  diff: number;
  pct: number;
  /** Events sans membership_id APRÈS la rupture : régression d'instrumentation. */
  regression: boolean;
  /** true = les chiffres par client sont SUSPENDUS. */
  masks: boolean;
}

/**
 * La DÉCISION du contrôle « Clients dashboard vs Whop » — lib/analytics-hub
 * (`buildCoherenceChecks`) en tire son libellé, l'écran et l'outil MCP en tirent
 * la suspension des chiffres par client. `null` = PostHog et/ou Whop absent :
 * rien à comparer, donc rien à suspendre.
 *
 * Même unité des deux côtés (des PERSONNES), atteinte BRUTE côté PostHog (repli
 * sur le séquentiel), et masquage seulement si les DEUX seuils sont franchis —
 * sur petits nombres, ±1-2 clients ne suspendent rien.
 */
export function ecartDashboardWhop(i: EntreesEcartDashboardWhop): EcartDashboardWhop | null {
  const posthogReach = i.reachSteps.find((s) => s.key === "subscription_completed")?.count ?? null;
  const posthogClients = posthogReach ?? i.dashboardClients;
  if (posthogClients === null || i.whopClients === null) return null;
  const rec = i.windowReconciliation;
  // Écart SIGNÉ : les deux termes de la décomposition tirent en sens opposés,
  // les confondre en valeur absolue effacerait justement l'information.
  const signed = posthogClients - i.whopClients;
  // Ce que la décomposition PRÉDIT : les fantômes gonflent, les paiements
  // sans event creusent. Ce qui reste est inexpliqué.
  const predicted = rec ? rec.ghostClients - rec.missingEvents : 0;
  const unexplained = rec ? Math.abs(signed - predicted) : Math.abs(signed);
  // Hors bande = ce que les events non liés de juillet ne peuvent PAS couvrir.
  const band = rec ? rec.unlinkedBeforeBreak : 0;
  const diff = Math.max(0, unexplained - band);
  const pct = Math.round((diff / Math.max(1, i.whopClients)) * 1000) / 10;
  const regression = rec !== undefined && rec.unlinkedAfterBreak > 0;
  const masks =
    regression ||
    (pct > DASHBOARD_WHOP_TOLERANCE_PCT && diff > DASHBOARD_WHOP_TOLERANCE_ABS);
  return {
    posthogReach,
    posthogClients,
    whopClients: i.whopClients,
    signed,
    predicted,
    unexplained,
    band,
    diff,
    pct,
    regression,
    masks,
  };
}

// ─── Agrégats d'une fenêtre ──────────────────────────────────────────────────

export interface EntreesEconomieUnitaire<T extends AttributionRowLike = AttributionRowLike> {
  /** Nouveaux clients payants par jour Paris (Whop, en PERSONNES). */
  dailyPaidClients: readonly { day: string; clients: number }[];
  revenu:
    | {
        configured: boolean;
        mixedCurrency: boolean;
        dailyNet: readonly { day: string; net: number }[];
      }
    | null
    | undefined;
  attributionRows: readonly T[];
  promoBonusByDay: readonly { day: string; amount: number }[];
  fx: CurrencyContext;
  /** Garde-fou dashboard/Whop en écart : aucune division par client. */
  suspendu: boolean;
}

export interface AgregatsFenetre {
  /** Clients acquis dans la fenêtre (personnes) — le dénominateur. */
  clients: number | null;
  /** Revenu net Whop de la fenêtre (devise du revenu). */
  net: number | null;
  /** Coût créateurs complet (fixe + CPM + bonus + défis), converti. */
  costAll: DisplayAmount | null;
  /** Revenu net − coût converti. */
  marge: number | null;
  promoViews: number;
  canDivide: boolean;
  /** Coût d'acquisition par client : (promo + bonus) ÷ clients, converti. */
  acquisition: DisplayAmount | null;
  /** Coût complet du moteur par client (warmup inclus), converti. */
  fullEngine: DisplayAmount | null;
  revenuePer: number | null;
  viewsPer: number | null;
}

/**
 * Agrégats d'UNE fenêtre. Appelée pour la fenêtre courante et pour la
 * précédente : c'est ce qui garantit qu'un delta compare deux choses calculées
 * à l'identique.
 *
 * Le dénominateur `clients` est en PERSONNES (cf convex/whopClients) : Σ des
 * jours = whopClientsTotal par construction. On ne divise PAS pendant que le
 * garde-fou suspend ce même nombre.
 */
export function agregatsFenetre<T extends AttributionRowLike>(
  e: EntreesEconomieUnitaire<T>,
  w: AnalyticsWindow | null,
): AgregatsFenetre {
  const clients = sumInWindow(e.dailyPaidClients, w, (d) => d.day, (d) => d.clients);
  const net =
    e.revenu?.configured && !e.revenu.mixedCurrency
      ? sumInWindow(e.revenu.dailyNet, w, (d) => d.day, (d) => d.net)
      : null;
  // Les coûts viennent du POINT UNIQUE (attributionWindow) : les autres onglets
  // lisent le même calcul, donc deux écrans ne peuvent pas afficher deux coûts
  // pour la même période.
  const { promo: promoCost, full: fullCost, bonus, promoViews } = windowCosts(
    e.attributionRows,
    e.promoBonusByDay,
    w,
  );
  // Coût TOTAL en devise du REVENU : c'est le seul terme soustractible du net.
  const costAll =
    fullCost !== null && bonus !== null ? toDisplayAmount(fullCost + bonus, e.fx) : null;
  const marge =
    net !== null && soustractible(costAll)
      ? Math.round((net - costAll.value) * 100) / 100
      : null;
  const canDivide = clients !== null && clients > 0 && !e.suspendu;
  const per = (n: number | null): number | null =>
    n !== null && canDivide ? Math.round((n / (clients as number)) * 100) / 100 : null;
  return {
    clients,
    net,
    costAll,
    marge,
    promoViews,
    canDivide,
    acquisition: toDisplayAmount(
      promoCost !== null && bonus !== null ? per(promoCost + bonus) : null,
      e.fx,
    ),
    // Le coût complet fenêtré n'inclut PAS les récompenses en nature : dues
    // sans date d'exigibilité exploitable. Le cumul, lui, les porte.
    fullEngine: toDisplayAmount(
      fullCost !== null && bonus !== null ? per(fullCost + bonus) : null,
      e.fx,
    ),
    revenuePer: net !== null && canDivide ? per(net) : null,
    viewsPer:
      canDivide && promoViews > 0 ? Math.round(promoViews / (clients as number)) : null,
  };
}

/**
 * L'équation du rang 2. `margePerClient` se calcule sur les MÊMES termes que
 * ceux affichés, jamais sur la marge globale divisée : sinon la ligne ne se
 * vérifierait pas de tête.
 */
export function equationUnitaire(cur: AgregatsFenetre): {
  margePerClient: number | null;
  roas: number | null;
} {
  const acquisition = soustractible(cur.acquisition) ? cur.acquisition : null;
  const margePerClient =
    cur.revenuePer !== null && acquisition !== null
      ? Math.round((cur.revenuePer - acquisition.value) * 100) / 100
      : null;
  const roas =
    cur.revenuePer !== null && acquisition !== null && acquisition.value > 0
      ? Math.round((cur.revenuePer / acquisition.value) * 10) / 10
      : null;
  return { margePerClient, roas };
}
