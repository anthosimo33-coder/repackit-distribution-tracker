# Cartographie du parcours CRÉATEUR — périmètre de la PR 2

Lecture seule, établie le 2026-08-22 sur `feat/i18n-infra` (commit `05883aa`).
3 axes cartographiés, 3 contrôles sceptiques indépendants — **aucun n'a réfuté le
fond**, tous ont corrigé des chiffres. Les corrections sont intégrées ici.

**Objectif de la PR 2** : Kevin invite un créateur US, et le créateur travaille de
bout en bout en anglais. Rien d'autre.

---

## 1. Routes atteignables par un non-admin — 22

### Pré-session (5) — le créateur US les voit AVANT d'avoir un compte

| Route | Fichier | Rôle |
|---|---|---|
| `/join/[token]` | `app/join/[token]/page.tsx` | **Premier écran après l'e-mail d'invitation** |
| `/[projectSlug]/login` | `app/[projectSlug]/login/page.tsx` | Login brandé — l'URL d'entrée donnée au créateur |
| `/login` | `app/login/page.tsx` | Login générique |
| `/reset-password/[token]` | `app/reset-password/[token]/page.tsx` | Mot de passe oublié |
| `/` | `app/page.tsx` | Routeur par rôle → `/app`, `/talent`, `/clip` |

### Partenaire (11)

`/app` (dashboard), `/app/comptes`, `/app/paiements`, `/app/profil`, `/app/guide`,
`/app/progression`, `/app/assignments/[id]`, `/app/videos`, `/app/fichiers`
(Snytch seulement), `/app/outils`.

### Clippeur (2) — `/clip`, `/clip/clips/[id]`
### Talent (1) — `/talent`

### Deux pièges

- **`/p/[carouselId]`** — deeplink legacy **sans garde de rôle** : un créateur qui
  suit un vieux lien atterrit sur une route `/admin/...` et n'est ré-éjecté qu'au
  rendu du `ProjectProvider`.
- **`app/not-found.tsx`** — sert « Retour au Dashboard » aux créateurs.

---

## 2. Volume — 402 chaînes sur 56 fichiers

| | Créateur | Baseline totale | Part |
|---|---:|---:|---:|
| Fichiers | **56** | 140 | 40 % |
| Chaînes | **~402** | 629 | **64 %** |

### ⚠️ Le cliquet CI ment sur ce périmètre

L'intersection « clôture créateur × `scripts/i18n-baseline.json` » ne fait que
**32 fichiers / 84 chaînes**. Le scan large en trouve **~402 sur 56 fichiers**.

`scripts/check-i18n.mjs` (livré en #78) ne regarde que trois positions — texte JSX
inter-balises, 5 attributs, `toast.*`/`ConvexError`/`new Error` — et ne déclenche
que sur **accent ou mot-outil**. Or l'UI créateur est faite de **labels courts non
accentués** (« Mes comptes », « Publier », « Gains », « Se connecter ») et de
**ternaires dans des accolades JSX**. Tout passe au travers.

Cas prouvés, **invisibles** pour le cliquet : `app/login/page.tsx`,
`ComptesScreen.tsx`, et `components/portal/CreatorBottomNav.tsx` — **8 labels
d'onglets, zéro détecté** (ce sont des valeurs de propriété d'objet).

**Conséquence de cadrage : la PR 2 ne peut pas se piloter au compteur de la
baseline. Prévoir ~400 chaînes, pas 84.**

### Fichiers partagés admin ↔ créateur

`WarmupGuideAccordion` (~88 fragments, rendu aussi sur `/admin/[slug]/comptes`)
est le plus gros partage — il n'était pas dans la première liste. Plus
`CreatorLeaderboard`, `VideoExample`, `StreamPlayer`, `ScriptDestinationZones`,
`ModelVideoEmbed`, `calendar-status-meta`, `VerdictBadge`, `CopyButton`.

**Le view-as** (`/admin/voir/[slug]/[id]/*`) rend 8 des 9 `portal/screens/*` **plus**
`TalentSpaceScreen` et `ClipperSpaceScreen` : surface sous-estimée d'un facteur ~4.
**À arbitrer** : en view-as, l'admin verra l'écran dans **sa** langue, pas dans
celle de la créatrice observée.

---

## 3. ConvexError — 41 codes à écrire, pas 342

Recompte indépendant : **351** `throw new ConvexError` sur 31 fichiers à ce commit
(le « 342 » du brief est périmé — dérive de branche).

| Population | Sites | Part |
|---|---:|---:|
| **Créateur (en session)** | **37** | 10,5 % |
| **Public / pré-session** | **9** | 2,6 % |
| Admin seul | 278 | 79 % |
| Interne (`internalMutation`, cron, e2e) | 27 | 7,7 % |

**46 sites créateur → 41 messages DISTINCTS** (35 en session + 6 pré-session).
Doublons réels : « Non authentifié. » ×2, « Assignment introuvable. » ×2,
« Compte introuvable. » ×2, « Invitation invalide ou expirée. » ×3, « Lien de
réinitialisation invalide ou expiré. » ×2. À l'inverse, deux sites portent
3 variantes chacun (`PORTAL_REJECTION`, `quotaRefusalMessage`).

**Les 37 tiennent dans 6 fichiers** : `assignments.ts` (19), `comptes.ts` (9),
`functions.ts` (5), `rushes.ts` (2), `snytchDrive.ts` (2), + pré-session
`auth.ts` (4) et `passwordReset.ts` (5).

### Surprise du tri

**`convex/scripts.ts` est hors périmètre.** C'est le 2ᵉ fichier du repo en
`ConvexError` (45–53), et il est **100 % admin** : un créateur ne « réclame »
jamais un script, il le **reçoit** (`assignScript` est admin). Idem
`publications.ts` (33), `pricing.ts`, `assets.ts`, `formats.ts`.

### Le point dur

**18 des 37** vivent dans des **cœurs partagés créateur ↔ admin** —
`confirmPublicationCore` (×7), `materializeTargetPublication` (×2),
`assertClipperDailyQuota` (×2), `assertPublishedAtInRange` (×2),
`declareCompteCore`, `applyWarmupCheck`… Ces mêmes messages sortent quand **Kevin**
utilise le chemin de secours (`confirmPublicationAsAdmin`, `declareManagedCompte`).

**Conséquence de conception : le code `ERR_*` doit être rendu dans la langue de
L'APPELANT, côté client.** Une chaîne figée côté serveur angliciserait Kevin en
même temps que le créateur.

### Trois pièges hors `throw`

1. **`convex/accountPhase.ts`** — `quotaRefusalMessage()` + `PHASE_LABELS` +
   `formatUtcDayFr`, qui rend « lundi 10 août » depuis **deux tables FR en dur**
   (`JOURS_FR` 7 entrées, `MOIS_FR` 12) et un cas ordinal « 1er ». **~24 chaînes**,
   pas 3. Le clippeur US lit ce message à **chaque** refus de quota. Aucun grep sur
   `ConvexError` ne le trouve.
2. **Dates interpolées dans deux messages créateur** (`formatDayMonthFr`,
   `formatDateTimeFr`). ⚠️ Le **libellé de paie persisté** ne doit pas changer de
   format — ne toucher que les messages d'erreur.
3. **`app/api/snytch-drive/upload/route.ts`** — messages JSON français.

---

## 4. E-mails — 7, dont l'invitation

| E-mail | Sujet | ≈ chaînes |
|---|---|---:|
| **Invitation** | « Bienvenue chez Jarvia 👋 » | 6 |
| Vidéo validée | « Ta vidéo est validée ✅ » | 6 |
| Vidéo refusée | « Petite correction sur ta vidéo » | 7 |
| Paiement effectué | « {montant} en route 💸 » | 6 |
| Nouvelle mission | « Nouvelle mission pour toi 🎬 » | 10 |
| Relance manuelle | « Tu as un retour à traiter » / « Où en es-tu ? 🙂 » | 10 |
| Rappel de deadline (cron) | « On attend ta vidéo 👀 » | 10 |

Signature « Anthony » (`convex/emailApi.ts:141`) : **endonyme, ne pas traduire.**

### L'invitation — la question qui décidait de tout

**`creators.locale` est-il lisible au moment de l'envoi ? OUI, structurellement.**
Vérifié ligne à ligne, dans **une seule mutation transactionnelle**
(`convex/creators.ts:inviteCreator`, l.133-204) :

```
l.166  ctx.db.insert("creators", {...})
l.182  ctx.db.insert("invitations", {token, creatorId, ...})
l.198  ctx.scheduler.runAfter(0, internal.emails.sendCreatorInvite, {creatorId, token})
```

L'insert de la fiche **précède de 32 lignes** la planification de l'envoi, et une
action planifiée ne démarre qu'**après commit**. Quand `sendCreatorInvite` tourne,
`ctx.db.get(creatorId)` rend une ligne complète.

### Trois blocages, tous dans le périmètre de la PR 2

**(a) `creators.locale` n'a AUCUN écrivain dans tout le dépôt.** Vérifié
moi-même : le champ n'apparaît qu'en déclaration (`convex/schema.ts:862`) et en
lecture (`convex/i18n.ts:46`). `inviteCreator` ne prend pas l'argument,
`updateCreator` non plus, et `InviteCreatorDialog.tsx` n'a pas de champ langue.
**#78 a livré le porteur sans le formulaire : la valeur est toujours `undefined`.**

→ À poser : un `<Select>` « Langue » dans `InviteCreatorDialog` (à côté de
« Rôle »), l'argument dans `inviteCreator`, et dans `updateCreator` pour corriger
sans régénérer l'invitation.

**(b) `getCreatorContact` jette la locale.** `convex/emails.ts:106-113` renvoie
`{ email, name }` et rien d'autre. Même chose pour `getAssignmentNotifyData` et
`listDeadlineReminderTargets`, qui servent les 6 autres e-mails.

**(c) La page `/join` restera en français même si l'e-mail part en anglais.**
`getInvitationPreview` ne rend pas la locale, et le créateur US n'a **ni session ni
cookie** sur son appareil — `i18n/request.ts` retomberait sur `Accept-Language`,
ce qui marche par chance mais n'est pas piloté par le choix de l'admin.
Deux options : porter la langue dans le lien (`/join/{token}?lang=en`) ou exposer
`locale` dans `getInvitationPreview` (le token garde déjà la lecture ; c'est une
valeur choisie par l'admin, pas une donnée personnelle).

### Confirmé : le runtime Convex n'importe jamais `lib/`

next-intl **ne servira pas** les e-mails. Le catalogue doit vivre dans `convex/`,
que `lib/` peut importer (précédent : `convex/rushStatus.ts`).

---

## 5. Défaut dans le code livré par #78

**`convex/i18n.ts:41-44` fait un scan de table complet.**

```ts
const fiches = await ctx.db
  .query("creators")
  .filter((q) => q.eq(q.field("userId"), ctx.userId))
  .collect();
```

Aucun index, aucune borne de projet. Le commentaire que j'ai écrit dit lui-même
« `by_user` n'existe pas » — sans en tirer la conséquence. Appelé par
`i18n/request.ts` à **chaque rendu serveur** d'un utilisateur authentifié dont
`users.locale` est absent — c'est-à-dire **tout le monde aujourd'hui**, puisque
personne n'écrit encore la locale.

Atténuation partielle : `localeFromConvex` sort tôt si `users.locale` est posé.
Mais tant que (a) n'est pas fait, aucun `users.locale` n'existe et le scan a lieu
systématiquement.

**Correctifs possibles** : un index `by_user` sur `creators`, ou recopier
`locale: creator.locale` dans l'insert `users` de `convex/auth.ts:133` au signup
(supprime le repli pour tout compte créé ensuite).

---

## 6. L'analytics est bien hors périmètre

`components/analytics/**` **ne figure nulle part** dans la clôture d'imports
créateur, et pèse à lui seul **165 des 629** chaînes. Le reséquencement tient.

---

# 7. Vérifications préalables à la PR 2a

Lecture seule, établies avant de coder.

## (a) Le `<Select>` a-t-il besoin d'un défaut explicite ?

**Non. `undefined` tombe correctement sur `fr` chez TOUS les lecteurs.**

`normalizeLocale` (`i18n/locales.ts`) rend `null` pour tout ce qui n'est pas une
langue supportée — exécuté, pas supposé :

| entrée | sortie |
|---|---|
| `undefined`, `null`, `""`, `"   "` | `null` |
| `"es"`, `42` | `null` |
| `"fr"`, `"en"` | inchangé |
| `"EN"`, `"en-US"` | `"en"` |

Et chaque maillon garde sur la vérité avant de passer au suivant
(`i18n/request.ts:resolveLocale`) : `users.locale` → `creators.locale` → cookie →
`Accept-Language` → `DEFAULT_LOCALE = "fr"`. `getMyLocale` rend `{locale: null}`
quand rien n'est posé, et `convex/i18n.ts` teste `f.locale && f.locale.trim() !== ""`.

**Décision** : le `<Select>` **affiche** « Français » pré-sélectionné, mais
n'envoie **rien** tant que l'admin ne choisit pas l'anglais. On ne stocke que la
DIVERGENCE — même invariant que `remunere` : une valeur explicite épingle la
fiche, et « fr » explicite sur 40 fiches existantes serait du bruit qui masque
qui a réellement été invité en anglais.

**Un seul endroit exigera un défaut explicite** : le rendu des e-mails. Il n'a ni
cookie ni `Accept-Language` — la chaîne s'arrête au premier maillon. Le catalogue
serveur devra donc faire `locale ?? "fr"` lui-même. Et il vivra dans `convex/`,
pas dans `i18n/` : le runtime Convex n'importe pas hors de `convex/` (règle A6).

## (b) Où la locale peut-elle se perdre, maillon par maillon ?

Chaîne complète : invitation → clic → `/join` → signup → dashboard.
**9 maillons, 6 perdent la locale aujourd'hui.**

| # | Maillon | Fichier | Aujourd'hui |
|---|---|---|---|
| 1 | L'admin choisit la langue | `InviteCreatorDialog.tsx` | **PERDUE** — le champ n'existe pas |
| 2 | `inviteCreator` écrit la fiche | `convex/creators.ts:166` | **PERDUE** — pas d'argument, rien écrit |
| 3 | `sendCreatorInvite` lit le contact | `convex/emails.ts:106-113` | **PERDUE** — `getCreatorContact` rend `{email, name}` |
| 4 | Rendu de l'e-mail | `convex/emails.ts:203-234` | **PERDUE** — littéraux FR, aucun paramètre de langue |
| 5 | Le créateur clique | — | **RIEN À PERDRE** — mais son appareil n'a **ni session ni cookie** |
| 6 | `getInvitationPreview` | `convex/creators.ts:716-721` | **PERDUE** — rend `{status, email, name, projectName}` |
| 7 | Rendu de `/join` | `i18n/request.ts` | **PERDUE** — pas de session ⇒ pas de Convex, pas de cookie ⇒ `Accept-Language`, puis `fr`. **L'écran est français même si l'e-mail était anglais.** |
| 8 | Signup | `convex/auth.ts:133` | **PERDUE** — `db.insert("users", {email, role})`, pas de locale. La fiche `creator` est pourtant **déjà chargée** ligne 128 |
| 9 | Redirection `/app` | `convex/i18n.ts:getMyLocale` | **CONSERVÉE** — le repli sur `creators.locale` rattrape, *si* le maillon 2 est corrigé |

### Trois conséquences pour le cadrage

1. **Le maillon 9 marche déjà.** Une fois `creators.locale` écrit, le dashboard
   est en anglais **sans** toucher `auth.ts` : `getMyLocale` fait le repli. Le
   maillon 8 n'est donc pas une correction de bug, c'est une **optimisation** —
   il rend `users.locale` autoritaire et supprime la lecture `creators` à chaque
   rendu. À faire, mais ce n'est pas lui qui débloque l'anglais.

2. **Le maillon 7 est le seul vrai trou d'expérience.** Sans le cookie posé
   depuis la preview, le créateur US clique un e-mail anglais et atterrit sur un
   écran français, puis sur un login français. `Accept-Language` peut le sauver
   **par chance** si son navigateur annonce `en-US` — mais ce n'est pas piloté
   par le choix de l'admin, et ça ne marche pas pour un francophone qu'on aurait
   délibérément invité en anglais.

3. **Le maillon 6 est le seul à débattre.** Exposer `locale` dans
   `getInvitationPreview` n'ajoute aucune fuite : le token garde déjà la lecture,
   et c'est une valeur **choisie par l'admin**, pas une donnée personnelle du
   créateur. L'alternative — porter la langue dans l'URL (`/join/{token}?lang=en`) —
   met une préférence dans un lien qui circule par e-mail et peut être modifiée à
   la main. **Retenu : l'exposer dans la preview.**
