/**
 * NAVIGATION DE L'ESPACE CRÉATRICE — quatre onglets, et qui possède quelle page.
 *
 * Module PUR : partagé par la barre mobile, la sidebar desktop et la coque
 * d'observation (« voir son espace »). Trois navs qui décideraient chacune de
 * l'onglet actif finiraient par se contredire — la preview admin montrerait
 * « Gains » allumé là où la créatrice voit « Moi ».
 *
 * ── POURQUOI QUATRE ──────────────────────────────────────────────────────────
 * La barre montait à six ou sept onglets (Accueil, Missions, Comptes, Gains,
 * Profil, Guide/Outils, Plus). Chaque écran rarement ouvert coûtait une place au
 * pouce. On garde ce qui se fait CHAQUE jour (Aujourd'hui, Missions), ce qui
 * motive (Gains), et on range le reste sous « Moi ».
 *
 * ── LES ANCIENNES PAGES RESTENT ─────────────────────────────────────────────
 * `/comptes`, `/paiements`, `/progression`, `/videos`, `/profil`, `/guide`,
 * `/fichiers`, `/outils` existent toujours : ce sont des SOUS-PAGES d'un onglet.
 * `owns` dit à quel onglet chacune appartient, pour que la barre reste allumée
 * au bon endroit quand on y descend. Une page qui n'appartient à aucun onglet
 * n'en allume aucun — mieux vaut rien qu'un onglet faux.
 */

export type CreatorTabKey = "today" | "missions" | "gains" | "moi";

export type CreatorTab = {
  key: CreatorTabKey;
  /** Chemin RELATIF à la base du portail ("/app" ou la base d'observation). */
  sub: string;
  /** Sous-pages possédées (préfixes). La racine se compare à l'égalité. */
  owns: readonly string[];
  /** Compteur porté par l'onglet. */
  badge?: "actionable" | "warmupDue";
  /** Onglet fait d'argent : retiré de la nav d'un observateur sans le droit. */
  money?: boolean;
};

export const CREATOR_TABS: readonly CreatorTab[] = [
  { key: "today", sub: "/", owns: [], badge: "actionable" },
  { key: "missions", sub: "/missions", owns: ["/missions", "/assignments"] },
  {
    key: "gains",
    sub: "/gains",
    owns: ["/gains", "/paiements", "/progression", "/videos"],
    money: true,
  },
  {
    key: "moi",
    sub: "/moi",
    owns: ["/moi", "/comptes", "/profil", "/guide", "/fichiers", "/outils"],
    badge: "warmupDue",
  },
];

/** Normalise un sous-chemin : "" et "/" désignent tous deux la racine. */
function normalize(sub: string): string {
  if (sub === "" || sub === "/") return "/";
  return sub.endsWith("/") ? sub.slice(0, -1) : sub;
}

/**
 * L'onglet qui possède ce sous-chemin, ou `null`.
 *
 * ⚠️ Correspondance par SEGMENT, jamais par préfixe de chaîne : « /moisson »
 * n'est pas une sous-page de « /moi ».
 */
export function activeCreatorTab(sub: string): CreatorTabKey | null {
  const path = normalize(sub);
  if (path === "/") return "today";
  for (const tab of CREATOR_TABS) {
    if (tab.owns.some((o) => path === o || path.startsWith(`${o}/`))) {
      return tab.key;
    }
  }
  return null;
}

/** Les onglets à montrer. Sans le droit d'argent, « Gains » disparaît. */
export function creatorTabsFor(opts: { argent: boolean }): CreatorTab[] {
  return CREATOR_TABS.filter((t) => opts.argent || !t.money);
}
