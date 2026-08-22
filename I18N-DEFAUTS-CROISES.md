# Défauts croisés pendant l'i18n

Registre des défauts **rencontrés en passant** pendant l'extraction i18n.

**Règle : on NOTE, on ne corrige pas, on ne propose pas de corriger.**
Ils sont traités dans le chantier analytics, après l'i18n, sur feu vert explicite.

Format : date · fichier:ligne · ce qui est faux · pourquoi ça n'a pas été corrigé.

---

## 2026-08-22 · PROCESS — #77 a mergé 26 fichiers au lieu de 4

**Défaut de process, pas de code.** Il se reproduira si la cause n'est pas
retenue.

**Ce qui s'est passé.** La PR #77 est étiquetée « CSV — la devise vient de la
donnée ». Son squash contient en réalité **toute l'infra i18n** : `next.config.ts`,
`i18n/`, `messages/`, `global.d.ts`, `app/layout.tsx`, `components/layout/*`,
`convex/schema.ts`, le workflow CI — 26 fichiers.

**Cause.** Le travail i18n a été commencé **sans quitter la branche de #77**. Au
moment de le déplacer, il a été commité là en WIP, puis `cherry-pick` vers
`feat/i18n-infra`. Le cherry-pick **copie**, il ne déplace pas : le commit
d'origine est resté sur la branche de #77 et a été emporté par le squash.

**Ce qui l'a détecté.** La vérification du squash **par contenu** (sondes `git show
origin/main:<fichier> | grep`), pas le message de commit — qui, lui, ne parle que
du CSV. Une vérification par message serait passée à côté.

**Conséquence.** Limitée : `main` est cohérente, la CI est verte à chaque étape, et
#78 s'est réduite d'elle-même au vrai delta. Mais **l'historique ment** : chercher
« quand l'infra i18n est-elle arrivée » sur `main` mène à une PR « CSV ».

**Ce qui l'évite.** Deux gestes, dans cet ordre :
1. La vérification « sur quelle branche suis-je » en **ouverture** de session —
   déjà adoptée, et c'est précisément ce qu'elle sert à éviter.
2. Après un `cherry-pick` de déplacement, **retirer le commit de la branche
   d'origine** (`git reset --hard <sha précédent>` puis `push --force-with-lease`),
   ou mieux : ne jamais commiter le travail de la PR N+1 sur la branche de la PR N.

## 2026-08-22 · `e2e/scripts-calendar-status.spec.ts:16` (helper `dayMs`)

**Le spec échoue déterministiquement pour tout run CI entre 22h00 et 23h59 UTC** —
2 heures sur 24, soit ~8 % des runs. Ce n'est pas un flake aléatoire et ce n'est
pas TD-018 (qui est une instabilité sous charge).

**Ce qui est faux.** Le helper construit la date planifiée à minuit dans le fuseau
**du runner** :

```js
const dayMs = (off) => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() + off*DAY; };
```

Le runner GitHub est en **UTC**, mais `calendarStatus` bucketise en **Europe/Paris**
(`convex/calendarStatus.ts:63`, `parisDayIndex`). En été (Paris = UTC+2) :

| | instant | jour Paris |
|---|---|---|
| `postDate` = `dayMs(0)` | 2026-08-21 00:00 **UTC** | 21 août |
| `postedAt` = instant du run | 2026-08-21 22:18 UTC | **22 août** |

Jours différents ⇒ `late` au lieu de `on_time` (`calendarStatus.ts:102`, tolérance
zéro et volontaire). Vérifié numériquement : les heures UTC qui échouent sont
**22 et 23**, et elles seules.

**Constaté sur** : run 32531839026 (PR #77), à 22:18 UTC. Le commit précédent, à
une heure plus tôt dans la journée, était vert avec le même code — c'est bien
l'heure du run qui décide, pas le contenu de la PR.

**Pourquoi ce n'est pas corrigé ici** : hors périmètre i18n, et hors des deux PRs
en cours. C'est le piège des trois horloges déjà documenté
(`convex/dateFr.ts`, chantier #51/#52) — le corriger demande de trancher si le
spec doit ancrer sa date en Paris ou injecter une horloge, ce qui touche l'infra
de test, pas l'extraction.

**À rapprocher de** : TD-018 dans `TECH_DEBT.md`, dont ce spec ne fait PAS partie.

