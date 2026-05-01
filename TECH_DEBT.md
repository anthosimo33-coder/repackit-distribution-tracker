# Tech Debt

Ce fichier liste les anti-patterns repérés dans la zone touchée par chaque feature shippée. Ils ne sont **pas fixés dans le commit qui les détecte** (anti-tilt de complétude). À traiter dans une session dédiée.

---

## Détectés pendant Feature 2 (split à venir / publié)

### TD-001 — `compte` stocké comme `string` au lieu de `Id<"comptes">`
- **Fichier** : `convex/schema.ts` (table `publications`, champ `compte`)
- **Impact** : aucune contrainte référentielle. Renommer un compte (mutation `updateCompte` change le `handle`) ne propage pas aux publications déjà créées — elles continuent d'afficher l'ancien handle.
- **Remarque** : visible aussi dans `convex/comptes.ts` `deleteCompte` qui filtre `pubs.filter(p => p.compte === compte.handle)` (string match au lieu de FK).

### TD-002 — Métadonnées hook dénormalisées dans `publications`
- **Fichier** : `convex/schema.ts` (table `publications`, champs `hookText`, `mecanique`, `niveau`, `langue`, `angleTonal`)
- **Impact** : si un hook est édité plus tard (ex: typo dans `hooks.text`), les publications créées avant gardent l'ancien snapshot. Pas de moyen de re-synchroniser.
- **Note** : c'est probablement intentionnel (snapshot du hook au moment de la création) mais ce n'est documenté nulle part.

### TD-003 — Aggregations dashboard et tracker faites client-side sur la collection complète
- **Fichiers** : `app/page.tsx` (Dashboard appelle `getGlobalStats`, `aggregateByMecanique`, etc.), `app/tracker/page.tsx` (`stats` useMemo, `filtered` useMemo)
- **Impact** : à 50 publications c'est OK, à 5000 le rendu initial sera lent. Pas de pagination, pas d'aggregation côté Convex.
- **Reco future** : query Convex dédiée qui retourne les stats agrégées au lieu de transférer toutes les rows au client.

### TD-004 — `carouselId` est un string libre (`"C001"`) au lieu d'un identifiant typé
- **Fichier** : `convex/schema.ts` (champ `carouselId` sur `publications`), `convex/publications.ts` (`getNextCarouselId` parse `parseInt(id.replace(/^C/, ""))`)
- **Impact** : pas de table dédiée `carousels`, pas de FK. Si deux mutations parallèles appellent `getNextCarouselId`, elles peuvent recevoir le même ID (race condition non gérée).
- **Note** : la logique métier "1 carrousel = N rows partageant le même string" repose entièrement sur la cohérence côté client.
