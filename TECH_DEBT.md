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

### TD-006 — Configurer Vercel pour push automatique Convex au deploy
- **Symptôme** : aujourd'hui le build Vercel ne fait que `next build`. Le schéma Convex prod (`fiery-wolf-460`) doit être poussé manuellement via `pnpm dlx convex@latest deploy` à chaque changement de schéma ou de fonction. Ça crée un mismatch potentiel entre le code Vercel (à jour) et le backend Convex prod (en retard) si on oublie le push manuel — c'est exactement ce qui s'est passé au deploy des 4 features (étapes 1-4) où le code est arrivé sur Vercel sans le schéma associé.
- **Fix** :
  1. Convex dashboard → projet `repackit-distribution-tracker` → Settings → fiery-wolf-460 → **Generate Production Deploy Key**
  2. Vercel → Project repackit-distribution-tracker → Settings → Environment Variables → ajouter `CONVEX_DEPLOY_KEY` (Production scope) avec la valeur générée
  3. Vercel → Settings → Build & Development → Build Command : `npx convex deploy --cmd 'pnpm build'`
- **Bénéfice** : élimine le mismatch schéma/code. Chaque deploy Vercel pousse le schéma Convex en amont du build Next.js, atomiquement. Plus jamais besoin de `convex deploy` manuel.

### TD-005 — `listHooksWithUsage` agrège côté serveur sur la collection complète
- **Fichier** : `convex/hooks.ts` (`listHooksWithUsage`)
- **Impact** : la query `collect()` toutes les publications puis groupe en mémoire par `hookId`. À 6-100 publications c'est sous 50 ms, OK. À 5000+ publications, le payload + le group-by deviennent significatifs (latence query Convex, taille de la réponse côté client).
- **Reco future** : dénormaliser un `usageCount: number` (et éventuellement `lastPublishedAt`) directement sur la table `hooks`, mis à jour par une mutation post-publish (post-`updateMetrics` quand `postUrl` passe à non-vide). Permet une query `listHooks` simple sans collect croisé.
- **Note** : l'index `by_hookId` ajouté dans le même commit n'est pas utilisé par cette query (le pattern collect+groupBy en mémoire est plus rapide qu'un withIndex per-hook). L'index reste là pour les futurs lookups ponctuels.

### TD-004 — `carouselId` est un string libre (`"C001"`) au lieu d'un identifiant typé
- **Fichier** : `convex/schema.ts` (champ `carouselId` sur `publications`), `convex/publications.ts` (`getNextCarouselId` parse `parseInt(id.replace(/^C/, ""))`)
- **Impact** : pas de table dédiée `carousels`, pas de FK. Si deux mutations parallèles appellent `getNextCarouselId`, elles peuvent recevoir le même ID (race condition non gérée).
- **Note** : la logique métier "1 carrousel = N rows partageant le même string" repose entièrement sur la cohérence côté client.
