/**
 * HOOK LIBRE — un hook donné comme une DIRECTION, pas comme une phrase à dire.
 *
 * Module PUR (aucun import Convex) : importable depuis `convex/` et le client,
 * testable en vitest via `lib/hookLibre.test.ts`. Même arrangement que
 * `convex/graduation.ts`.
 *
 * ── Le modèle ────────────────────────────────────────────────────────────────
 * Une brique hook marquée `libre` reste UNE brique : son `content` est l'EXEMPLE
 * principal (c'est lui qui part dans le texte figé de la mission, et qui sert de
 * libellé partout), `direction` dit l'idée à garder, `autresExemples` donne
 * d'autres formulations. La créatrice tourne SA version.
 *
 * Ce qu'on mesure devient donc la DIRECTION : vues, verdicts, cooldown et
 * unicité de combo travaillent déjà par identifiant de brique, jamais par texte
 * — toutes les reformulations d'une même direction s'additionnent sans rien
 * changer aux agrégats. Ne JAMAIS en faire une brique par variante : les stats
 * s'éparpilleraient et le cooldown ne verrait plus les doublons.
 *
 * ── Pourquoi l'exemple reste dans le texte figé ─────────────────────────────
 * Si l'affichage « libre » ne peut pas s'appliquer (exemple corrigé depuis
 * l'assignation, écran qui ne connaît pas le mode libre), la fiche retombe sur
 * le texte figé : la créatrice y lit alors une vraie phrase de hook, jamais une
 * consigne de production prise pour du texte à dire.
 */

/** Nombre maximal d'exemples EN PLUS de l'exemple principal. */
export const MAX_AUTRES_EXEMPLES = 5;

/** Ce que la fiche affiche d'un hook libre : l'idée, puis les formulations. */
export type HookLibre = {
  direction: string | null;
  /** L'exemple principal d'abord, puis les autres — jamais vide. */
  exemples: string[];
};

/** Les champs d'une brique dont le mode libre dépend. */
export type BriqueHook = {
  kind: string;
  content: string;
  libre?: boolean;
  direction?: string;
  autresExemples?: readonly string[];
};

/** Lignes nettoyées : blancs retirés, vides et doublons écartés, ordre gardé. */
function lignesPropres(lignes: readonly string[]): string[] {
  const vues = new Set<string>();
  const out: string[] = [];
  for (const l of lignes) {
    const t = l.trim();
    if (t === "" || vues.has(t)) continue;
    vues.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Les AUTRES exemples tels qu'on les enregistre : nettoyés, sans répéter
 * l'exemple principal (il est déjà affiché en premier). Accepte la saisie brute
 * de l'écran (un exemple par ligne) ou une liste (outil MCP).
 */
export function normaliserAutresExemples(
  saisie: string | readonly string[],
  exemplePrincipal: string,
): string[] {
  const lignes = typeof saisie === "string" ? saisie.split("\n") : saisie;
  const principal = exemplePrincipal.trim();
  return lignesPropres(lignes).filter((l) => l !== principal);
}

/**
 * La vue « libre » d'une brique, ou null si elle doit s'afficher comme un hook
 * ordinaire : pas un hook, interrupteur éteint, ou rien à montrer.
 */
export function hookLibreOf(
  b: BriqueHook | null | undefined,
): HookLibre | null {
  if (!b || b.kind !== "hook" || b.libre !== true) return null;
  const exemples = lignesPropres([b.content, ...(b.autresExemples ?? [])]);
  if (exemples.length === 0) return null;
  return { direction: b.direction?.trim() || null, exemples };
}

/**
 * Le texte figé SANS son hook — ce qui suit l'accroche (flux puis cta), pour
 * l'afficher sous le bloc libre.
 *
 * Le texte figé est monté par `assembleNoLabels` : parties rognées, jointes par
 * une ligne vide. On ne retire le hook QUE si le texte commence exactement par
 * l'exemple actuel de la brique ; sinon (exemple corrigé depuis l'assignation)
 * null, et la fiche garde l'affichage ordinaire — la même prudence que la garde
 * anti-divergence des deux zones.
 */
export function resteApresHook(
  texte: string | undefined,
  hookContent: string,
): string | null {
  if (texte === undefined) return null;
  const hook = hookContent.trim();
  if (hook === "") return null;
  if (texte === hook) return "";
  const prefixe = `${hook}\n\n`;
  return texte.startsWith(prefixe) ? texte.slice(prefixe.length) : null;
}

/**
 * Ce que la CARTE UNIQUE affiche d'un script dont le hook est libre : la vue
 * libre et la suite du texte. Null = afficher le texte tel quel (hook ordinaire,
 * ou texte qui ne commence plus par l'exemple). Partagé par la fiche (serveur)
 * et les aperçus admin, pour qu'ils découpent de la même façon.
 */
export function hookLibreDuTexte(
  b: BriqueHook | null | undefined,
  texte: string | undefined,
): (HookLibre & { reste: string }) | null {
  const vue = hookLibreOf(b);
  if (!b || !vue) return null;
  const reste = resteApresHook(texte, b.content);
  return reste === null ? null : { ...vue, reste };
}
