/**
 * QUI PEUT OBSERVER L'ESPACE D'UNE CRÉATRICE, ET QUI Y VOIT L'ARGENT.
 *
 * ⚠️ CES FONCTIONS NE PROTÈGENT RIEN. Les barrières sont
 * `requireCreatorObservable` et `requireCreatorMoneyObservable`
 * (convex/functions), exécutées à chaque requête. Ceci ne sert qu'à ne pas
 * proposer une porte qu'on sait fermée — et à ne pas lancer une query qui
 * lèverait.
 *
 * ── DEUX RÈGLES, ET POURQUOI ELLES SONT DEUX ────────────────────────────────
 * Observer une créatrice qu'on gère déjà — dont on lit la fiche, les comptes et
 * les missions — n'ouvre rien de neuf : `creators.read` suffit. Mais l'espace
 * observé porte ses GAINS (ses paiements, le gain de chaque vidéo, le montant de
 * ses paliers, le classement du projet) : ceux-là exigent EN PLUS
 * `payments.manage`, sinon l'observation serait un contournement de la frontière
 * argent que le catalogue de droits pose exprès.
 *
 * Arbitré le 12/09/2026, après qu'une manageuse eut cliqué « Voir son espace »
 * pour tomber sur un refus : la garde lisait le RÔLE quand tout le reste de son
 * travail passe par des BLOCS.
 *
 * ── LE DOUTE, DANS LES DEUX SENS ────────────────────────────────────────────
 * `has()` répond OUI tant que les droits ne sont pas chargés (doctrine du
 * dépôt : cacher à tort casse un rôle en silence, montrer à tort coûte un refus
 * propre). `canObserveCreatorSpace` en hérite : le bouton s'affiche pendant le
 * chargement.
 *
 * `canObserveMoney` fait l'INVERSE, et c'est délibéré : elle décide si des
 * QUERIES partent, pas si un bouton s'affiche. Une query refusée par le serveur
 * LÈVE, et une exception dans le portail démonte l'écran — le défaut du
 * 08/09/2026, où un agrégat en échec emportait six onglets. Attendre un instant
 * coûte un écran de chargement que l'observation affiche déjà ; se tromper coûte
 * une page blanche.
 */

type Droits = {
  /** `usePermissions().has` — vrai par défaut tant que les droits chargent. */
  has: (bloc: "creators.read" | "payments.manage") => boolean;
  /** `usePermissions().chargement` — les droits ne sont pas encore connus. */
  chargement: boolean;
};

/** Le bouton « Voir son espace » doit-il s'afficher ? (doute → on montre) */
export function canObserveCreatorSpace(d: Droits): boolean {
  return d.has("creators.read");
}

/** L'observateur voit-il les GAINS de l'espace observé ? (doute → on attend) */
export function canObserveMoney(d: Droits): boolean {
  return !d.chargement && d.has("payments.manage");
}

/**
 * LES SOUS-CHEMINS DE L'ESPACE OBSERVÉ QUI PORTENT DE L'ARGENT.
 *
 * Une seule liste, deux usages dans la coque d'observation (ViewAsShell) : on
 * retire ces entrées de la nav, et on refuse l'URL tapée à la main. Deux listes
 * finiraient par diverger, et la divergence ne se verrait que dans un sens —
 * celui qui fuit.
 *
 * Ce sont les trois écrans faits de gains : les cycles de paie, le gain de
 * chaque vidéo, le montant des paliers.
 */
export const MONEY_SUBS = ["/paiements", "/videos", "/progression"] as const;

/** `sub` (relatif à la base d'observation) est-il un écran de gains ? */
export function isMoneySub(sub: string): boolean {
  return MONEY_SUBS.some((m) => sub === m || sub.startsWith(`${m}/`));
}
