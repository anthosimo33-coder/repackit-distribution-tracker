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

### TD-007 — Le filtre `Compte` du tracker ne scale pas au-delà de ~15 comptes
- **Fichier** : `app/tracker/page.tsx` (FilterSelect `Compte`)
- **Symptôme** : à 7 comptes actuels, le `<FilterSelect>` shadcn (dropdown sans recherche) reste ergonomique. Au-delà de ~15 entrées, scroller dans une liste plate devient pénible.
- **Reco** : passer à une combobox cherchable type `<HookCombobox>` de `app/nouveau/page.tsx` (Popover + Command de cmdk). Pattern déjà rodé sur le repo.
- **Trigger** : si la table `comptes` dépasse 15 lignes actives, faire la migration. Pas avant — change UI sans valeur tant qu'on est sous le seuil.

### TD-006 — Configurer Vercel pour push automatique Convex au deploy ✅ RÉSOLU (juin 2026)
- **Résolution** : commité dans la remédiation sécurité auth. `vercel.json` définit `buildCommand: "npx convex deploy --cmd 'pnpm build'"` (le build command de l'UI Vercel n'est plus nécessaire). Reste à faire UNE FOIS côté dashboards (non commitable) : générer la Production Deploy Key Convex (fiery-wolf-460) et la poser en `CONVEX_DEPLOY_KEY` (scope Production) sur Vercel — cf README §Déploiement. Procédure ci-dessous conservée pour mémoire.
- **Note (mai 2026)** : le pattern push code → deploy Convex manuel est désormais récurrent à chaque touch schéma/fonctions. Priorité montée vu la fréquence.
- **Symptôme** : aujourd'hui le build Vercel ne fait que `next build`. Le schéma Convex prod (`fiery-wolf-460`) doit être poussé manuellement via `pnpm dlx convex@latest deploy` à chaque changement de schéma ou de fonction. Ça crée un mismatch potentiel entre le code Vercel (à jour) et le backend Convex prod (en retard) si on oublie le push manuel — c'est exactement ce qui s'est passé au deploy des 4 features (étapes 1-4) où le code est arrivé sur Vercel sans le schéma associé, et ça se répète à chaque session qui touche `convex/`.
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

---

## Détectés pendant Batch 1 Shorts (foundation YouTube)

### TD-008 — Constante `PLATEFORMES` dupliquée 4× dans le front
- **Fichiers** : `app/comptes/page.tsx` (type `Plateforme` local), `app/nouveau/page.tsx` (`const PLATEFORMES`), `app/tracker/page.tsx` (DuplicateCarouselDialog), `components/PublicationDetailDialog.tsx` (`const PLATEFORMES`)
- **Impact** : ajouter une plateforme (ex: YouTube en Batch 1) force à éditer 4 fichiers en parallèle. Risque oubli + drift entre fichiers (ex: l'un en `["TikTok", "Instagram"]`, l'autre en `["TikTok", "Instagram", "YouTube"]`).
- **Reco** : centraliser dans `lib/platforms.ts` (ou étendre `lib/media-type.ts` qui contient déjà `ALLOWED_PLATFORMS_FOR_*`) avec une const exportée `ALL_PLATFORMS = ["TikTok", "Instagram", "YouTube"] as const` et un type `Plateforme = (typeof ALL_PLATFORMS)[number]`. Tous les callsites importent.
- **Bénéfice** : un seul endroit à éditer pour ajouter/retirer une plateforme. Garantit la cohérence du front avec le validator Convex (qui reste la source de vérité côté serveur).

---

## Détectés pendant P2 (multi-tenant)

### TD-018 — Déflaker les specs e2e qui tombent sous charge CI
- **Specs restants** : `carrousel-biblio.spec.ts:30` (flow biblio → carrousel), `compte-assign-personne.spec.ts:27` (assignation gestionnaire), `compte-calendar-navigation.spec.ts:58` (navigation calendrier).
- **Spec traité** : `hook-variants-view.spec.ts:24` ✅ **DÉFLAKÉ (juillet 2026, PR #134)** — voir ci-dessous.
- **Symptôme** : échecs `toBeVisible`/`toHaveURL` **sous charge CI** (run 27439582935 : 2 failed malgré `retries:2`), mais **verts en local** sur le même déploiement (laudable-viper-831) et **verts au simple rerun** (même commit). `compte-calendar-navigation` est un flake déjà connu de longue date.
- **Cause probable** : instabilité de timing sur la DB de test partagée (re-render après mutation), amplifiée par la charge/latence du runner GitHub. PAS une régression P2 (la phase 2 ne change que le schéma, aucun comportement runtime).
- **⚠️ Le trigger est ATTEINT (juillet 2026)** : sur `hook-variants-view.spec.ts`, **le rerun n'a PAS suffi** — 2 échecs consécutifs (~6 tentatives avec `retries:2`), après un premier échec sur `main` (run 30008290752). La ligne d'échec bougeait d'un run à l'autre (131/132/133 puis 131/138), signature d'une course et non d'une régression. Le « un rerun suffit » de la reco initiale n'est donc plus une hypothèse fiable.
- **Correction appliquée à `hook-variants-view`** — deux courses RÉELLES, pas un simple timing :
  1. le clic sur « Voir les N variantes » pouvait tomber pendant un re-render (le libellé du bouton porte un **compteur** qui change quand `getHookVariants` se rafraîchit) → le popover ne s'ouvrait jamais ;
  2. le popover pouvait s'ouvrir **avant** que la publication tout juste créée soit propagée par la query réactive → il s'affichait sans les `carouselId` attendus (cas observé : popover visible, ids absents).
  Remèdes : `.first()` sur un locator ambigu en strict mode ; ouverture **réessayée** via `expect().toPass()` jusqu'à présence du CONTENU attendu (le clic n'étant rejoué que si le popover est fermé — le trigger est un toggle) ; `toBeEnabled` avant de cliquer une entrée ; timeouts élargis. **Aucune assertion affaiblie** — déflaker en relâchant ce qui est vérifié ne ferait que masquer le problème.
- **Reco** : appliquer le même traitement aux 3 specs restants (attendre l'ÉTAT post-mutation, pas le 1er rendu ; réessayer l'action plutôt que d'allonger un timeout ; éventuellement isoler les données par projet e2e dédié au lieu du marker `[E2E_TEST]`).

---

## Détectés pendant le chantier warmup / analytics (juillet 2026)

### TD-019 — Biais warmup systémique dans les agrégats analytics
- **Constat** : `publications.isWarmup` (flag PAR POST, cf PR #119) est correctement exclu de la **paie** et de la **rentabilité**, mais **~20 agrégats analytics somment les métriques de publications sans jamais le lire**. Les posts de chauffe gonflent donc vues/likes/commentaires — et faussent les ratios **dans les deux sens** selon que le warmup tombe au numérateur ou au dénominateur.
- **Déjà traité** : `convex/trackerData.ts` (Vue tracker du Dashboard) — filtre tri-état, défaut « Hors warmup », appliqué dans `publishedAndMatches`, source unique d'inclusion des 2 queries (PR #134). `components/analytics/hub/AttributionTab.tsx` + `convex/assignments.ts:listValidatedForBonus` — bascule sur les vues PAYABLES (PR #135).
- **Surfaces atteintes, non corrigées** :
  - `convex/metricSnapshots.ts:130` `aggregateTimeseries` — **la plus large** : chart « Évolution » de CHAQUE page format. Somme les `metricSnapshots` sans jamais charger `isWarmup` ; le join `mediaType` déjà présent (:156-167) montre le pattern à suivre.
  - `convex/scriptAnalytics.ts` `perfByBrick` / `perfByTier` / `perfByCombo` (échantillon commun `gatherCampaignViews:129`) — **surface de DÉCISION** (verdicts de bulk-testing, `signal`, alimente `scriptDecision`). Le warmup pollue les médianes par variable **ET** la médiane de campagne qui leur sert de référence → le biais est compté **deux fois**.
  - `components/analytics/KpiGrid.tsx:85` + `lib/dashboard-stats.ts` (`getGlobalStats*`, `getTopHooks*`, `aggregateBy*`) — les KPI en tête de chaque page format. **Cas contre-intuitif** : sur `engagementRate` et `ratioSubsViews`, le warmup est au **DÉNOMINATEUR** → ces ratios sont **sous-estimés**, pas gonflés comme ailleurs. Un post warmup peut aussi prendre la 1re place du « Top hooks ».
  - `convex/comptes.ts:82` `buildPerfMap` → `components/admin/ActionDashboard.tsx:181` + `app/admin/[projectSlug]/comptes/page.tsx:166` — les vues cumulées servent de **clé de tri** → le warmup **réordonne des classements** de comptes et de créateurs.
- **⚠️ Ce n'est PAS un patch mécanique.** La correction demande de trancher **surface par surface**, et c'est une **décision produit**, pas technique. Trois options selon l'usage de la surface :
  1. **exclusion par défaut** (la surface juge la performance du contenu → le warmup n'a rien à y faire) ;
  2. **filtre tri-état** comme le tracker (l'utilisateur doit pouvoir vérifier le volume de chauffe explicitement) ;
  3. **affichage des deux** (ségrégation monetized/warmup, modèle `convex/profitability.ts:161`) quand les deux lectures ont une valeur propre.
  Choisir « exclusion partout » sans réfléchir casserait les surfaces de suivi où le warmup DOIT rester visible (ex. `convex/creatorVideos.ts:158`, où l'inclusion est délibérée et documentée : un post warmup reste tracké normalement côté créatrice).
- **Helper** : réutiliser l'existant, **ne pas créer une seconde logique d'exclusion**. `payableAssignmentViews` (`lib/pricing-engine.ts:151`, réplique privée `convex/pricing.ts:97`) rend une SOMME de vues payables, keyée assignment ; `assignmentViewsAndMetrics` (`convex/pricing.ts:262`) est son pendant serveur. Pour filtrer une LISTE de publications, le prédicat est `matchesWarmupFilter(isWarmup, mode)` (`lib/tracker-data.ts` + réplique convex, A6).
- **⚠️ Piège** : `lib/warmup.ts` est le warmup de **COMPTE** (rodage d'un compte : `warmupProtocol`, `isWarmupComplete`) — concept **sans aucun rapport** avec le flag par post. Ne jamais l'utiliser pour ces agrégats.

---

## Détecté pendant le chantier calendrier de publication (juillet 2026)

### TD-020 — Statut calendrier basé sur la date de CONFIRMATION, pas le go-live réel
- **Constat** : le statut calendrier (à l'heure / en retard / manqué / prévu, `lib/calendar-status.ts`) compare la date de post **planifiée** (`assignments.postDate`) à la date de publication **réelle**. Mais cette « date réelle » est la date de **CONFIRMATION** de publication (`target.publishedAt`, posée à `Date.now()` quand la créatrice/l'admin confirme via `confirmPublication`), **PAS** le vrai timestamp de mise en ligne sur la plateforme.
- **Décision cadrée** (chantier, PR #145) : on accepte la date de confirmation — dans le workflow managé, confirmation ≈ posting. C'est **suffisant** tant que la confirmation se fait au moment du post.
- **Imprécision** : si la confirmation est **décalée** (créatrice qui poste lundi mais confirme mercredi), le statut affichera « en retard » à tort (ou « à l'heure » si le décalage compense). Aucune tolérance dans le calcul → le décalage de confirmation se voit directement, côté pilotage admin **ET** côté créatrice (mêmes statuts, `CALENDAR_STATUS_META` partagé).
- **Vrai fix (non fait, scope volontairement exclu)** : ingérer le vrai timestamp plateforme. Il est **déjà récupéré mais jeté** par la synchro — `convex/apifyApi.ts` (Apify `createTime`) et `convex/youtubeApi.ts` (`snippet.publishedAt`, `part: "snippet"` déjà demandé). Le persister (nouveau champ, p.ex. `publications.platformPublishedAt` + backfill) puis le préférer à `target.publishedAt` dans `representativePostedAt` (`lib/calendar-status.ts` + réplique convex A6). La fonction de statut ne bouge pas (elle prend `postedAt` en paramètre).
- **Où** : `lib/calendar-status.ts` (`calendarStatus`, `representativePostedAt`), réplique convex `convex/assignments.ts:representativePostedAt` (exposé en `listAssignments.postedAt`).

## Détecté en rétablissant le filet e2e (août 2026)

### TD-021 — `carouselId` réutilisé après suppression (rattaché à TD-004)
- **Constat** : `getNextCarouselId` / `computeNextPublicationId` dérivent le
  prochain identifiant du **maximum des lignes existantes** du projet. Supprimer
  une publication fait donc **redescendre le compteur**, et la création suivante
  **réutilise** un identifiant déjà porté par une ligne **publiée** subsistante
  (`carouselId` n'est pas unique en base : plusieurs lignes le partagent, une par
  plateforme, cf `by_project_carouselId`).
- **Symptôme observé** : `updateDraft` refuse l'édition avec « Carrousel
  partiellement publié, édition impossible. Vide d'abord les liens de
  publication » (`convex/publications.ts:1266`) sur un carrousel que l'appelant
  vient de créer et croit vierge. Reproduit par `e2e/tracker-metrics.spec.ts` en
  suite complète (une spec antérieure supprime des publications, la spec suivante
  récupère un id déjà publié). Le symptôme e2e est éteint par l'isolation d'état
  par fichier (fixture `freshProjectData`), mais **la cause reste**.
- **Portée réelle** : suppose qu'une publication soit **supprimée**, ce qui
  n'arrive quasiment jamais en production → fragilité, pas incident. Décision
  cadrée : **on ne touche pas au compteur** (le chantier rôles ne dérive pas pour
  ça). Documenté ici pour ne pas le redécouvrir à ses dépens.
- **Vrai fix (non fait)** : rendre le compteur monotone — le persister au niveau
  du projet plutôt que de le recalculer depuis les lignes (le déduire du max
  historique, pas du max vivant). Alternative plus légère : refuser la création
  quand l'id calculé existe déjà, au lieu de le réutiliser en silence.
- **Où** : `convex/publications.ts` (`computeNextPublicationId`,
  `getNextCarouselId`, `getNextPublicationId`, garde `updateDraft:1266`).
  Parent : TD-004 (`carouselId` est une string libre, pas un identifiant typé).

---

## Détecté pendant le chantier notifications hors-app (août 2026)

### TD-022 — Les notifications RELISENT la donnée au lieu de la figer à l'émission
- **Fichiers** : `convex/notifications.ts` (`getSubmissionContext`, `getAssignmentEventContext`), appelés par `notifySubmission` / `notifyPublication` / `notifyVideoReviewed`.
- **Constat** : la mutation planifie l'action avec le seul `assignmentId` ; l'action relit l'assignation pour composer le message. Le contenu du message est donc l'état AU MOMENT DE L'ENVOI, pas au moment du geste.
- **Pourquoi c'est une dette et pas un bug** : entre planification et exécution il s'écoule des millisecondes, et les bornes d'ordre de `confirmPublicationCore` (cf `lib/notification-wiring.test.ts`) garantissent que tout ce que le message lit est déjà persisté. Le mode d'échec est un mode d'échec de DÉVELOPPEMENT — un chantier qui déplacerait une écriture — et il est désormais attrapé par test.
- **Ce qui tranchera le jour du correctif** : le dépôt a déjà répondu à cette question partout ailleurs. `rateSnapshot`, `pricingSnapshot`, `scriptCombo.assembledScript`, `creatorNameSnapshot` : la convention est de FIGER ce qu'on communique au moment où on le communique. Une notification est par nature une affirmation sur un instant.
- **Condition** : basculer les DEUX mécanismes ensemble (soumission ET publication/revue). Deux notifications voisines avec deux mécanismes différents seraient pires que le risque latent.

---

## Détecté pendant le chantier talent/clippeur (août 2026)

### TD-023 — Unicité du combo par (créateur, plateforme) : bloquera au 2ᵉ compte d'une même plateforme
- **Fichiers** : `lib/script-combo-uniqueness.ts` + sa réplique
  `convex/scripts.usedComboKeysForPlatforms`, consommées par
  `assignScriptCampaign` (partenaires) ET `assignScriptToRush` (clips, PR 4).
- **Constat** : la clé d'anti-coordination est `(créateur, plateforme)`.
  L'arbitrage **B1** ([ARBITRAGES-ROLES.md](./ARBITRAGES-ROLES.md)) prévoyait de
  la passer à `(accountId)` **pour les seuls clippeurs**, discriminée par le
  `kind` du propriétaire. Ce n'est PAS fait : la PR 4 a délibérément conservé la
  règle partenaire, qui est plus stricte donc incapable de produire un doublon.
- **DÉCLENCHEUR — la date à laquelle ça cesse d'être inoffensif** : aujourd'hui un
  clippeur a UN compte TikTok et UN compte Instagram, donc `(créateur,
  plateforme)` désigne déjà un compte par plateforme et les deux règles
  coïncident. **Le jour où un clippeur exploite DEUX comptes de la même
  plateforme** — c'est la trajectoire de montée en charge — un script consommé
  sur son premier TikTok deviendra INASSIGNABLE sur le second. L'admin lira
  « Tous les scripts affichables de cette campagne ont déjà été utilisés sur ces
  comptes » sans comprendre pourquoi, alors que le stock est intact.
- **Ce que le correctif ne doit PAS faire** : remplacer la règle globalement.
  Relevé du 2026-08-11 : **2 couples (créateur, plateforme) portent déjà 2 comptes
  chez les PARTENAIRES**. Un remplacement global rendrait un combo déjà consommé
  sur leur compte A repiochable sur leur compte B — soit le même script publié
  deux fois par la même personne sur la même plateforme, précisément ce que
  l'anti-coordination existe pour empêcher.
- **Forme du correctif** : discriminer par `resolveCreatorKind(propriétaire)`
  dans les deux fonctions pures, et une spec par population (le partenaire reste
  bloqué cross-comptes, le clippeur ne l'est plus).

### TD-025 — Le mode « voir l'espace » ne sait rendre que le portail PARTENAIRE
- **Fichiers** : `app/admin/voir/[projectSlug]/[id]/**` (ré-exporte les écrans de
  `components/portal/screens/`), garde dans `components/portal/ViewAsShell.tsx`.
- **Constat** : la route ré-exporte STATIQUEMENT les écrans partenaire et ne lit
  ni `kind` ni `portalRole`. Rendue pour un talent ou un clippeur, elle affichait
  « Mes vidéos », des paliers de bonus et un warmup partenaire — une vue FAUSSE.
  Depuis le correctif, elle s'abstient explicitement et dit quoi faire à la place.
- **DÉCLENCHEUR** : le jour où un clippeur aura des comptes et des clips à
  observer, et où il faudra diagnostiquer à distance sans lui demander une
  capture d'écran. Aujourd'hui il n'a ni l'un ni l'autre — l'abstention ne coûte
  rien.
- **CHIFFRÉ le 2026-08-13** : **six queries** à rendre observables — talent
  (`getMyTalentBrief`, `listMyRushes`), clippeur (`myQuotaWindow`,
  `listMyClips`, `getMyClip`, `listMyClipperComptes`). C'est une PR, pas un
  chantier. La note ci-dessous parlait d'un « ordre de grandeur » : le principe
  était juste (le travail est serveur), le volume était surestimé. Un chiffre
  non remesuré finit par être cru — cf le correctif des 7 briques devenues 77.
- **FORME DU CORRECTIF** : extraire les six cœurs en fonctions partagées et les
  exposer une seconde fois via `adminViewAsQuery`, comme le fait déjà
  `comptes.listComptesAsAdmin`. JAMAIS un `creatorId` optionnel sur les fonctions
  gatées — cf la règle écrite en tête de `adminViewAsQuery` dans
  `convex/functions.ts`.
- **LECTURE SEULE** : pas de `adminViewAsMutation`. La spec doit APPELER les
  mutations talent/clippeur avec une session admin et vérifier qu'elles
  refusent — un bouton grisé est du confort, le refus serveur est la garantie.
- **⚠️ LE COÛT N'EST PAS LE ROUTAGE.** Faire rendre ces espaces demande un
  `adminViewAs*` PAR POPULATION côté SERVEUR : les `talentQuery`/`clipperQuery`
  filtrent par `ctx.creatorId` de la personne CONNECTÉE, donc un admin n'en
  obtient rien. Il faut le pendant de `adminViewAsQuery` pour chaque famille de
  fonctions exposée aux deux nouveaux portails, plus l'extraction des écrans
  correspondants. Ce n'est pas une PR d'une journée, et quiconque lit « il suffit
  de router sur le kind » se trompe d'un ordre de grandeur.
