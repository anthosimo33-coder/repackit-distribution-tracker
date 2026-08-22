# ARBITRAGES i18n

Décisions **tranchées**, à ne pas rouvrir sans décision explicite. Ce fichier est
la source : ne pas se fier à la mémoire d'une session.

L'audit de départ est dans `I18N-AUDIT.md` (volumétrie, pièges, devises,
quantification `perMembership`).

**Objectif** : rendre l'app bilingue FR/EN. Le **français reste la langue par
défaut** ; l'anglais est **ajouté** pour onboarder des créateurs US. Ce n'est pas
un remplacement.

---

## 1. Librairie et routage

| Point | Décision |
|---|---|
| Librairie | **next-intl** (App Router, Next 16.2.4) |
| Routage | **AUCUN préfixe de locale**. Pas de `/fr`, pas de `/en`. |
| Pourquoi | Le segment dynamique racine est **déjà pris** par `app/[projectSlug]` (login brandé). Un `app/[locale]` casserait les URLs existantes et les 13 redirects de `next.config.ts`, pour zéro bénéfice sur une app entièrement authentifiée. |

## 2. Résolution de la langue

Ordre, du plus autoritaire au plus large — `i18n/request.ts` :

1. `users.locale` — préférence explicite du compte connecté
2. `creators.locale` — langue posée par l'admin sur la fiche
3. cookie `NEXT_LOCALE` — survit **avant** toute session (écran de login)
4. header `Accept-Language`
5. `"fr"`

Les maillons 1 et 2 sont rendus par **une seule** query Convex (`convex/i18n.ts:getMyLocale`).

**Résolue côté SERVEUR**, avant le premier rendu : le premier octet envoyé porte
déjà la bonne langue, il n'y a pas de bascule visible après hydratation.

**La lecture Convex coûte un aller-retour par rendu serveur.** C'est assumé :
sans elle, une préférence changée sur un autre appareil ne s'appliquerait
qu'après un premier rendu dans l'ancienne langue — exactement ce qu'on veut
éviter. L'appel est encapsulé dans un `try/catch` : toute panne retombe sur le
cookie. **La langue de l'interface ne doit jamais pouvoir faire échouer un rendu.**

## 3. Où vit la préférence — les DEUX, et c'est délibéré

| Porteur | Rôle |
|---|---|
| `users.locale` | **Fait foi** une fois le compte créé. Seule entité commune aux 4 identités (admin, partenaire, talent, clippeur). |
| `creators.locale` | Posé par l'admin à la création de la fiche. Sert **avant** l'existence du compte. |

**Pourquoi les deux** : l'e-mail d'**invitation part avant que le compte
existe** (`creators.userId` est encore `undefined`), il n'y a donc pas de
`users.locale` à lire. L'invitation doit pouvoir partir en anglais **dès le
premier envoi**.

Les deux champs sont `v.optional(v.string())` : **absent ⇒ `"fr"`, aucune
migration**, tout compte existant reste en français.

Aucune valeur n'est validée contre la liste des langues côté schéma — c'est
`i18n/locales.ts` qui normalise. Une valeur inconnue retombe sur le défaut ;
la refuser en base coupleraient le schéma à la liste des langues livrées.

## 4. Clés et catalogues

- `messages/fr.json` et `messages/en.json`, **namespacés**.
- Convention **stricte** : `module.composant.element`
  (`nav.item.dashboard`, `settings.language.label`).
- **Interdiction absolue** de clés générées depuis le texte français.
- `en.json` = **exactement les mêmes clés**, valeurs **françaises copiées telles
  quelles**. La traduction est **hors scope**.
- **Clés typées** : `global.d.ts` dérive le type de `messages/fr.json`, qui est la
  source. Une faute de frappe dans `t()` est une **erreur TypeScript**.
- Pluriels et interpolations via **ICU MessageFormat**, jamais par concaténation.

## 5. Frontière Convex — codes d'erreur stables

- Une fonction Convex **ne retourne jamais de texte destiné à l'affichage**.
- Les 342 `ConvexError` français deviennent des **codes stables `ERR_*`**.
  **Pas de locale passée en argument.**
- Tri en **deux classes**, à compter avant extraction :
  - **(a)** atteignable par une action utilisateur → code `ERR_*` + clé i18n
  - **(b)** invariant / état impossible → un seul `ERR_INTERNAL` générique, le
    texte FR reste dans le payload **pour les logs uniquement**
- Le mapping code → `t()` vit dans `lib/convex-error.ts`, **en un seul endroit**.
- Un code **non mappé** rend un message générique **et** incrémente un compteur
  loggé — jamais un code brut à l'écran, jamais un échec silencieux.

**Mine connue** : `components/admin/AdminPublishForm.tsx:141` branche sur le
**texte français** d'un message serveur (`/précède la\s+création/i.test(msg)`,
produit par `convex/assignments.ts:2903`). Traduire ce message **casse le flux de
régularisation de date en silence, sans erreur de compilation**. À corriger dans
la même PR, et à vérifier qu'il n'existe aucun autre branchement de ce type.

## 6. Données en base — jamais renommées

Une valeur française **stockée** et affichée telle quelle n'est **pas** renommée :
on crée une **couche de mapping `valeur_db → clé i18n` côté affichage**.

| Valeur | Où | État |
|---|---|---|
| `angleTonal` : Psycho, Accusatoire, Pédagogique… | `convex/schema.ts`, `v.literal()` | **actif** — exposé brut en label de graphe |
| `statut` : « Publié », « À venir » | `filterPresets.filters.statut` | **actif** |
| `interval` : jour/semaine/mois/trimestre/an | produit FR par `convex/whopApi.ts:231`, relu par un `switch` FR | **actif, protocole serveur↔client** |
| `mecanique`, `niveau` | `convex/schema.ts` | dormant — retirés de l'UI |

**`payments.lineItems[].label`** : phrases françaises **figées au paiement**
(`Fixe — 3 vidéos publiées`). **AUCUNE migration, l'historique reste figé.**
On ajoute des **champs structurés** (type, quantité, période) à la génération des
**nouveaux** `lineItems` ; l'affichage lit la structure si présente, **sinon
fallback sur `label`**. PR dédiée, **pas** dans l'extraction.

## 7. Périmètre exclu

**Ne jamais toucher** : noms de champs du schéma Convex, valeurs d'enums, clés de
statut (`isWarmup`, `remunere`…), noms d'événements PostHog et leurs propriétés,
IDs, slugs, chemins de routes, variables d'env, commentaires de code, noms de
variables, fichiers `.md` internes.

**Contenu saisi par un utilisateur** (briefs, notes, commentaires, libellés de
`project.sidebarLinks`) : c'est de la **donnée**, pas de l'interface. **Jamais extrait.**

**Seeds** (`convex/scriptSeedData.ts`, `convex/demoSeed.ts`,
`convex/demoMultiProject.ts`) : **hors périmètre, confirmé.**
→ `convex/demoSeed.ts` est à **rouvrir si la démo devient commerciale ou
anglophone**.

**Telegram** : **reste en français.** Confirmé par le code — `projects.notify.chatId`
est un chat_id **unique par projet**, l'UI dit « ajoute le bot au groupe », et
`convex/notificationMessage.ts:489` écrit « le canal est un groupe partagé, pas
une boîte personnelle ». **Aucun destinataire humain à résoudre.**

**Noms de fichiers téléchargés** (`paiements-cycles.csv`, `<créateur>-<label>.mp4`) :
**figés, non traduits.**

## 8. E-mails

Un e-mail part dans la locale du **DESTINATAIRE**, jamais celle de l'expéditeur
ni du serveur. Le destinataire est **toujours** une ligne `creators`, résolue par
3 points uniques (`getCreatorContact`, `getAssignmentNotifyData`,
`listDeadlineReminderTargets`).

Le runtime Convex **n'importe jamais `lib/`** (règle A6) : next-intl ne servira
**pas** les e-mails. Il faut un **catalogue serveur autonome**, qui vit dans
`convex/` (que `lib/` peut importer — précédent : `convex/rushStatus.ts`).

## 9. Dates, nombres, devises

- Via `Intl`, avec la **langue active**.
- **La devise ne dérive JAMAIS de la langue.** Elle vient de la **transaction** :
  un payout en dollars s'affiche en dollars dans une interface en français.
  `formatMoney(n, currency, locale)` — la langue ne pilote **que** la mise en
  forme (séparateurs, position du symbole). **Aucune conversion, aucun taux,
  aucun changement de devise sur une donnée existante.**
- Montants **sans champ `currency`** : **ne pas deviner, ne pas backfill.**
- **Formats de date explicites** (mois abrégé) partout où une date est lue vite —
  tableaux de paiement, plannings de publication. `03/09` se lit 3 septembre en
  FR et 3 mars en EN.
- **Fuseau ÉPINGLÉ** à `Europe/Paris` dans la config next-intl. Le produit a
  **trois** conventions d'horodatage qui coexistent volontairement (Paris épinglé
  / UTC délibéré / navigateur), documentées champ par champ. **Ne pas les
  unifier** : cela réintroduirait le décalage d'un jour sur 28 % des publications
  corrigé en #51/#52. `next-intl` ne doit pas deviner un fuseau depuis la langue.
- Le **libellé de paie est PERSISTÉ** : ne pas changer son format.

## 10. Garde CI — `scripts/check-i18n.mjs`, DEUX MODES

Branchée dans `pnpm lint` **et** en CI (étape du job `test` — **clé de job à ne
jamais renommer**).

### Mode STRICT — fichiers déjà extraits (hors baseline). Tolérance ZÉRO.

**Aucun littéral**, accent ou pas, en position de :
- texte JSX entre balises,
- attribut de libellé (`placeholder`, `aria-label`, `title`, `alt`, `label`),
- **valeur de propriété d'objet** servant de libellé (`label:`, `title:`,
  `description:`, `tooltip:`, `cta:`…),
- littéral libre reconnu comme de la prose — c'est ce qui rattrape le
  **ternaire entre accolades JSX**, `{cond ? "Déclare ton premier compte." : "…"}`,
  cas dominant côté créateur.

**C'est ce mode, et lui seul, qui empêche la régression.**

`isProse` est volontairement conservateur : un accent suffit ; sinon il faut un
**espace et une capitale**. Ça écarte les classes utilitaires, les ids, les
chemins et les énumérations techniques. Les fragments de template literal et les
lignes `className`/`import`/`cn(` sont exclus.

**Zéro faux positif vérifié** sur tout le code déjà extrait
(`components/layout/*` reste hors baseline).

### Mode LARGE — reste du dépôt. Estimation grossière.

Heuristique accent/mot-outil. **Elle sous-compte massivement** : l'UI créateur est
faite de labels courts non accentués (« Gains », « Publier », « Mes comptes »).
**Ne plus s'en servir comme métrique d'avancement.**

### Avancement — en FICHIERS, jamais en chaînes

`scripts/i18n-creator-scope.json` porte les **56 fichiers** du périmètre créateur
(clôture d'imports des 22 routes non-admin). La garde affiche
`Parcours créateur : N/56 fichiers extraits`.

### Trois règles bloquantes

1. Un littéral en position de libellé dans un fichier **déjà extrait** → échec.
2. Clés de `fr.json` et `en.json` divergentes → échec.
3. Un fichier de la baseline **sans plus aucun** littéral strict → échec, avec
   demande de le retirer. **La baseline ne peut que rétrécir.**

Exemption ligne à ligne, raison **obligatoire** : `// i18n-exempt: <raison>`

## 10 bis. Méthode — un test vert ne prouve rien

**Un test vert ne prouve rien tant qu'il n'a pas été vu rouge.**

**Une rupture côté Convex n'a d'effet qu'après redéploiement** — sans ça, la
rupture ne teste rien et le vert est faux.

Cas rencontrés :
- **contre-test locale sans cas « fr » explicite** (vert à tort) — le contre-test
  n'envoyait aucune locale, donc le chemin « `fr` explicite → on ne stocke rien »
  n'était jamais exercé. Casser `normalizeCreatorLocale` laissait le test vert.
  C'est la rupture qui l'a révélé, pas la relecture.
- **trois ruptures backend sans redéploiement** — les modifications de
  `convex/locales.ts` et `convex/auth.ts` n'affectaient pas le backend local
  déjà déployé. Les tests restaient verts, ce qui ressemblait à s'y méprendre à
  « la rupture ne casse rien donc l'assertion est faible », alors que la rupture
  n'avait simplement jamais été appliquée.

## 10 ter. Une clé appartient à UN namespace — jamais de réutilisation

**Ne JAMAIS réutiliser une clé existante sans avoir vérifié sa valeur exacte
dans `fr.json`.**

Un texte identique dans deux namespaces = **deux clés**, valeurs dupliquées.
La duplication coûte moins cher qu'une régression silencieuse.

**Cas réel, PR 2b lot 2** : `nav.item.guide` réutilisée pour le lien « Guide »
du portail créateur. Cette clé vaut « **Comment ça marche** » — c'est le libellé
de la sidebar *admin*. Le nom accessible du lien a changé, et
`e2e/creator-portal-nav.spec.ts` est tombé sur
`getByRole("link", { name: "Guide" })`.

Ce n'est pas un accident isolé : sur des centaines d'extractions, le réflexe
« cette chaîne existe déjà quelque part » se répète. Deux clés `nav.item.guide`
= « Comment ça marche » et `portal.nav.guide` = « Guide » coexistent désormais,
et c'est le comportement voulu.

## 11. Découpage — 7 PRs

Ordre imposé par les **dépendances**, pas par le volume.

| PR | Contenu | État |
|---|---|---|
| **B** | CSV « Total dû (€) » sur des USD + `netPerPayment` | ouverte (#77) |
| **1** | **Infra** + layout/nav. Aucun écran. | cette PR |
| **2** | **Frontière Convex** : 342 `ConvexError` → codes. **Doit précéder les écrans.** | à venir |
| **3** | Analytics (hub + tracker + Whop) — le plus gros bloc | à venir |
| **4** | Admin : pages + `components/admin` | à venir |
| **5** | Rôles : comptes, créateurs, talent, clippeur, portail | à venir |
| **6** | E-mails (catalogue serveur, locale destinataire) | à venir |
| **7** | Reste : inspirations, nouveau, scripts, calendrier, `lib/` | à venir |

**Chaque PR** : modules couverts, nombre de clés extraites, ce qui reste, et
**confirmation que le rendu FR est strictement inchangé**.

**Aucun changement fonctionnel, aucun restyling, aucun refacto au-delà de
l'extraction.**

## 12. Gelé — ne pas ouvrir sans feu vert explicite

Défauts **identifiés et quantifiés**, hors chantier i18n :

- `perMembership` — « Abonnés » gonflé (115 affichés / 88 réels), LTV
  sous-estimée. Chiffré dans `I18N-AUDIT.md`.
- `fxRateToRevenue` — taux **unique et rétroactif**. **Ne pas modifier la valeur
  0,86** : le changer réécrirait la marge de tous les mois passés, cycles déjà
  payés compris. Corriger le **modèle** d'abord (taux figé par cycle au paiement,
  doctrine `pricingSnapshot`, + `fxRateUpdatedAt`).
- Échecs de paiement du mensuel.
- Alimentation d'`internalAccounts` (filet de détection, puis plan Whop INTERNE
  en défaut — **en conservant** la possibilité de tests délibérés sur le vrai
  plan, seule vérification bout-en-bout du chemin payant).
- `RetentionTab.tsx:151` — taux appliqué brut, sans `effectiveFxRate`.
- `internalExcludedMembers` — payload mort.

**Si un défaut est croisé pendant l'i18n : le NOTER dans `I18N-DEFAUTS-CROISES.md`,
ne pas le corriger, ne pas proposer de le corriger.**
