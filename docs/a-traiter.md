# À traiter

Défauts repérés en chemin, **volontairement non corrigés** dans le chantier en
cours pour ne pas mélanger les sujets. Chacun est isolé, décrit avec son coût
réel, et peut être pris seul.

---

## AT-001 — Aucun chemin ADMIN pour corriger un historique de checks de warmup

**Repéré pendant** : chantier fuseaux, en cherchant comment réparer les compteurs
de Janeth.

`convex/comptes.ts` expose bien une mutation qui réécrit `dailyChecks`
(`e2eSetWarmupChecks`), mais elle est **gatée sur `E2E_SECRET`** : c'est un
outil de test, inatteignable depuis l'application.

Conséquence : quand un historique de checks est faux — pour n'importe quelle
raison, y compris le bug de fuseau qu'on vient de corriger — **personne ne peut
le rectifier depuis l'interface**. Ni l'admin, ni la créatrice. Le compteur
« jours manqués » reste faux à vie, et c'est lui qui remonte dans le digest
quotidien et sur le tableau de bord.

**Coût de l'inaction** : des créatrices affichées « en retard » sans recours.

**Piste** : une `adminMutation` `setWarmupChecks`, avec les mêmes gardes que
`applyWarmupCheck` (compte en warmup, dates valides, pas de doublon), plus une
trace de qui a corrigé quoi. À faire dans la fiche compte, section Warmup.

---

## AT-002 — L'INSTANT d'un check de warmup n'est pas stocké ✅ TRAITÉ (2026-09-01)

**Repéré pendant** : chantier fuseaux, en tentant de recalculer les jours manqués
des créatrices américaines.

`comptes.warmupProtocol.dailyChecks` est un tableau de chaînes `"YYYY-MM-DD"`.
Le moment précis où la créatrice a cliqué n'existe **nulle part** :

- `warmupProtocol.updatedAt` **ne bouge pas** au check — `applyWarmupCheck`
  patche `dailyChecks` sans toucher `updatedAt`. Vérifié sur l'export de prod du
  2026-08-31 : `updatedAt` ne tombe le jour du dernier check que dans 10 cas sur
  25, et uniquement par coïncidence (comptes à un seul check, posé le jour de la
  création du protocole).
- Convex ne conserve pas de date de modification de document.

Conséquence : **un historique de checks n'est pas ré-interprétable après coup.**
Le jour du bug de fuseau, il était impossible de distinguer « elle a coché le 2
au soir » de « elle a coché le 3 au matin » — les deux s'écrivaient `"2026-03"`.
C'est ce qui a rendu tout recalcul rétroactif impossible.

**Coût de l'inaction** : le prochain défaut de datation sera, lui aussi,
irrécupérable.

**FAIT** : `comptes.warmupProtocol.checkLog` — un `{ day, at, tz }` par check,
écrit par `applyWarmupCheck`. Additif, zéro migration, **jamais lu par la
logique métier** (`dailyChecks` reste seul juge du décompte et de la garde
1-par-jour) : uniquement de la preuve. Les checks antérieurs au champ n'ont pas
de trace — leur situation ne pouvait pas être améliorée rétroactivement, c'est
tout le propos.

⚠️ Ce qui reste vrai : **l'historique d'AVANT le 2026-09-01 demeure
irrécupérable.** Le journal n'est pas une réparation du passé, seulement l'arrêt
de l'hémorragie.

---

## AT-003 — `daysElapsed` dérive d'une heure aux changements d'heure

**Repéré pendant** : chantier fuseaux (écarté volontairement du correctif).

`lib/warmup.daysElapsed` (et sa réplique `convex/warmup`) compte
`floor((now - warmupStartedAt) / 86 400 000)` : des tranches de **24 h**, pas des
jours calendaires. Or une journée de changement d'heure dure 23 ou 25 heures.

Un warmup qui traverse un changement d'heure voit donc son compteur de jours
écoulés décalé d'une heure — assez, à la frontière, pour basculer le `floor` et
faire apparaître ou disparaître **un jour manqué**.

**Pourquoi ce n'est pas corrigé maintenant** : passer au calendaire change la
SÉMANTIQUE de la fonction, pas seulement sa précision. Un warmup commencé à 22 h
verrait « 1 jour écoulé » dès le lendemain matin (11 h plus tard), et donc un
jour manqué de plus. La correction ferait MONTER des compteurs qui accusent des
gens — l'inverse exact de ce que le chantier cherchait à faire. À trancher à
froid, avec le comptage voulu écrit noir sur blanc.

**Fenêtres concernées** : 2 week-ends par an et par fuseau, et les US et
l'Europe ne basculent pas les mêmes (8 et 29 mars 2026 ; 25 octobre et
1er novembre 2026).

---

## AT-004 — `isSameLocalDay` porte un nom qui ment

**Repéré pendant** : chantier fuseaux, point 3 du diagnostic.

`convex/calendarStatus.ts:69` exporte `isSameLocalDay(a, b)` — qui n'est **pas**
locale : elle est épinglée `Europe/Paris`. Le nom invite à croire qu'elle suit
le fuseau de l'utilisateur, et deux appelants s'en servent déjà sur des écrans
**créatrice** (`components/portal/TodayPostBanner.tsx:65`), où « local » devrait
vouloir dire « chez elle ».

**Coût de l'inaction** : le prochain développeur qui cherche « le jour local »
la trouvera par son nom et posera une troisième horloge sans s'en apercevoir.

**Sera traité par** : l'étape 2 du plan fuseaux (module unique du jour), qui la
renomme et la fait converger vers `convex/creatorDay.ts`. Noté ici pour ne pas
l'oublier si l'étape 2 glisse.
