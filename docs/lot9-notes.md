# Notes LOT 9 (funnel / contrat / libellés) & LOT 10 (garde-fous)

> Issu de l'investigation checkout du 27/07/2026 (lecture seule, prod PostHog + Whop).
> **À APPLIQUER quand les LOTs 9/10 seront ouverts — rien n'est traité ici.** Ce sont
> des directives d'implémentation, pas un constat neutre.

## Contexte — le goulet est au CHECKOUT (pas à l'acquisition)

Sur les données réelles (fenêtre du 23 au 27/07) :

| Étape | personnes |
|---|---|
| `checkout_started` | 54 |
| → abandon silencieux (aucun event, dernier signal ~13 s après) | **37 (68 %)** |
| → `payment_failed` | 16 |
| → `subscription_completed` | 10 |
| → `purchase_celebrated` (payé confirmé) | 8 |
| Clients payants Whop (vérité terrain) | **8** |

85 % des checkouts et 81 % des `payment_failed` sont en **iOS Mobile Safari** → le
handoff paiement mobile (webview) est le point de rupture. Correctif = **côté app
Snytch**, hors de ce repo.

## Note 1 (LOT 9) — `payment_failed` n'est PAS un échec de paiement

- Cause **unique** observée : `reason = no_confirmation_60s` (100 % des cas). C'est un
  **timeout de confirmation côté client à 60 s**, réglé SOUS le délai médian de succès
  (72 s checkout→abo). Ce n'est **pas un refus de carte**.
- 10 des 16 personnes `payment_failed` finissent abonnées, 8 payées → le « failed » est
  souvent **transitoire**.
- **Le dashboard devra distinguer les vrais refus des timeouts.** Afficher `payment_failed`
  brut comme « échecs de paiement » ferait **mentir la carte**. En attendant un renommage
  d'event côté Snytch, **filtrer sur `properties.reason`** (exclure/ségréguer
  `no_confirmation_60s`).

## Note 2 (LOT 10) — aucune clé commune PostHog ↔ Whop

- **`membershipId` est absent des events PostHog** ; **`distinct_id` est absent de Whop.**
  Il n'existe aucune jointure 1-à-1 entre une personne PostHog et un membership Whop.
- La réconciliation trouvée (compter `subscription_completed` où `server_side = true`,
  plans `snytch_pro_*`/`snytch_target_*`, pour approcher les 8 payés) est un
  **CONTOURNEMENT, pas une solution**.
- **Le garde-fou LOT 10** (bandeau de cohérence « clients dashboard vs clients Whop »)
  **doit s'appuyer sur le compte Whop UNIQUEMENT, jamais sur les events PostHog.** Whop
  est la seule source de vérité sur les clients payants.

## À reprendre au LOT 9 (funnel + contrat), pour mémoire

- **Contrat d'events à compléter** dans `convex/posthogSync.ts` (aujourd'hui ignorés) :
  `checkout_started`, `payment_failed`, `purchase_celebrated`, `free_tier_started`,
  `target_removed`, `squad_invite_sent`. Sans eux, le dashboard est **structurellement
  aveugle** au goulet checkout.
- **Nouvelle structure de funnel** (actée) :
  - Acquisition : `visite → inscription → offre vue → checkout démarré → payé`
  - Activation (post-paiement, séparé) : `username saisi → cible ajoutée → 1re alerte`
- **`subscription_completed` compte double** : `server_side=true` (confirmé, ≈ Whop) vs
  client-side (à la tentative, plan `weekly`/`monthly`, gonfle le compte). Ne compter les
  payés que sur `server_side=true` — et le garde-fou reste sur Whop (Note 2).
- **Trou d'instrumentation le plus coûteux** : la 1re saisie (le **handle à l'onboarding**,
  pré-paywall, + le résultat de la recherche) n'a **aucun event nommé**
  (`username_entered` = la 2e saisie, le compte cible, collée à `target_added` à 6 s).
  À instrumenter côté Snytch : **`handle_submitted`** avec résultat `trouvé / non trouvé /
  erreur`.
- **Fuite mineure** : 8 personnes voient le paywall sans `signup_completed` capturé
  (explique « paywall 234 > signup 226 »). Fuite d'event à corriger côté Snytch, pas une
  impossibilité logique.

## Hors périmètre de ce repo (app Snytch)

Le plan Whop du gratuit (`free_tier_started`, 10 pers. iOS le 27/07, plan
`snytch_free_week`), ses limites, le commit de lancement, et surtout **le déclenchement
éventuel d'un scan HikerAPI** ne sont **pas visibles d'ici** — ni dans ce repo (tracker),
ni dans PostHog (aucun event `scan_*`). Le coût par scan doit être instrumenté par
l'équipe app Snytch.
