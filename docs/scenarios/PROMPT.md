# Mission : construire les « Scénarios » dans Jarvia

Tu travailles sur Jarvia Creator Studio (jarvia-creator-studio.com), l'app qui gère les créatrices UGC, leurs missions, les scripts et les analytics. Le MCP Jarvia tourne sur Convex : vérifie la stack dans le repo avant de commencer.

Anthony, le fondateur, n'est pas développeur. Explique-lui chaque étape simplement, travaille sur une branche, et demande-lui avant toute action destructive (migration, suppression, déploiement en production).

## Ce qu'on veut
Pour le projet BLUSH, Jarvia doit fabriquer des **fausses conversations WhatsApp personnalisées** que les créatrices filment et importent sur askblush.com.

Pour chaque mission, la créatrice reçoit à son prénom :
- un **export WhatsApp .txt**, à importer sur BLUSH ;
- un **écran choc** en PNG, la fin de la conv façon WhatsApp iOS, à filmer vers 3 s de sa vidéo.

Tout se pilote dans Jarvia : écrire un scénario, le tester, le mettre en rotation dans une campagne, le mesurer, et le faire depuis le MCP par Claude.

Lis `CONTEXTE.md` pour le pourquoi : BLUSH, les squelettes vidéo, le système concurrent, les leçons du premier test.

## Ce qui t'est fourni
| Fichier | Rôle |
| --- | --- |
| `reference/moteur.py` | Moteur de référence en Python : bible + prénom → export .txt + stats. Il marche, il a été testé sur askblush.com. |
| `reference/ecran.py` | Rendu de l'écran choc (PNG 1170×2532) à partir de l'export. |
| `reference/fonts/` | Police Inter (licence OFL incluse). |
| `bibles/bible_C2.json` | Le premier scénario, validé. |
| `bibles/bible.schema.json` | Le schéma JSON d'une bible, à utiliser pour valider. |
| `samples/` | Sorties attendues pour le prénom « Kelly » : export, zip, PNG, stats. |

Lance les scripts Python une fois pour voir ce qu'ils produisent :
```
python3 reference/moteur.py --bible bibles/bible_C2.json --prenom Kelly --out /tmp/test
python3 reference/ecran.py --prenom Kelly --lui Yanis --export "/tmp/test/WhatsApp Chat - Kelly, Yanis.txt" --out /tmp/test/ecran.png
```

## Principe du moteur (à conserver)
- **La bible porte tout ce qui est unique** au scénario : dates, rythme, mot à vous, vocaux, munitions, dernière semaine, écran choc. Le moteur fournit le reste : le remplissage banal d'un couple, le timing, le format.
- **L = la créatrice.** Son prénom est injecté à la génération. **Y = lui**, prénom fixé dans la bible.
- **Déterminisme** : même bible + même prénom + même graine = fichier identique, octet pour octet.
- **Le remplissage** est fait de mini-dialogues cohérents (pas de lignes au hasard), pondérés selon la période (lune de miel, avant et après le tournant). Une pause explicite (`"P"`) est possible dans un dialogue.
- **Le timing** : elle répond en ~2 min. Lui répond lentement le jour, vite la nuit, très vite le jour du record. Ses délais sont plafonnés sous 3 h pour rester dans le même échange.
- **Le mot à vous** : des mini-dialogues dédiés, injectés avec une probabilité par jour, pour qu'il sorte premier des mots partagés.
- **Les vocaux omis** sont glissés juste après certains messages, plus souvent pour lui la nuit.
- **Les munitions, la dernière semaine et l'écran choc** sont posés à leurs dates. Tout dialogue de remplissage qui chevauche leurs fenêtres (±20 min) est retiré en entier, jamais coupé. Aucun remplissage le dernier jour, aucune répétition de dialogue dans les 15 derniers jours.
- **Les marqueurs** `[image]`, `[supprimé]`, `[vocal]` deviennent les libellés iOS FR, préfixés par U+200E.

### Format de sortie (export WhatsApp iOS, FR)
```
[03/08/2025 14:02:11] Yanis: ‎Les messages et les appels sont chiffrés de bout en bout. Personne en dehors de cette discussion, pas même WhatsApp, ne peut les lire ou les écouter.
[03/08/2025 14:05:20] Yanis: c'était cool hier soir
```
- Fichier `WhatsApp Chat - {Prénom}, {Lui}.txt`, en UTF-8, avec un saut de ligne par message.
- Le zip `WhatsApp Chat - {Lui}.zip` contient `_chat.txt`.

## Ce qu'il faut construire, dans cet ordre
Arrête-toi à la fin de chaque étape pour montrer le résultat à Anthony.

### Étape 1 — Le moteur dans Jarvia + un écran de test
1. **Porter `moteur.py` en TypeScript**, dans une action Convex (ou ce que la stack impose).
   - Graine : un PRNG déterministe initialisé avec `"{id}-{prénom}-{graine}"`. Un octet-pour-octet avec le Python est impossible (graines différentes), donc on vérifie le déterminisme côté TS et des stats équivalentes (voir critères).
   - Exposer une fonction `stats()` identique à celle du Python.
2. **Porter `ecran.py`** pour produire le PNG 1170×2532 : par exemple un SVG rendu en PNG avec `@resvg/resvg-js` dans une action Node, police Inter embarquée. Le rendu doit ressembler à `samples/C2 - Kelly - ecran choc.png`. Jarvia a déjà un générateur de captures Instagram (outils MCP `conversations` et `creer_conversation`) : regarde comment il dessine et réutilise ce qui peut l'être.
3. **Stocker les bibles** : une table `scenarios` avec `projet`, `id` (ex. C2, unique par projet), `titre`, `type`, `bible` (JSON validé contre le schéma), `statut` (brouillon, actif, archivé) et les dates.
4. **Écran admin « Scénarios »**, dans la barre latérale CONTENU, à côté de Scripts :
   - la liste des scénarios, avec leur statut ;
   - créer, dupliquer et modifier une bible (éditeur JSON, avec les erreurs de schéma affichées en clair) ;
   - un bouton **« Tester »** : on tape un prénom, Jarvia génère, puis affiche les stats, l'aperçu du PNG, et deux boutons de téléchargement (.txt et .zip).
5. Importer `bible_C2.json` comme premier scénario.

### Étape 2 — Les scénarios dans les campagnes et les missions
1. Sur une campagne : un interrupteur **« Scénario dans la vidéo »** et une liste de scénarios actifs en rotation, exactement comme les notifs. Si l'interrupteur est allumé sans scénario actif, l'assignation est bloquée avec un message clair, comme pour les notifs.
2. **À l'assignation**, chaque mission tire un scénario (rotation équilibrée), génère les fichiers au prénom de la créatrice (le prénom de sa fiche), les stocke et les rattache à la mission.
3. **Page mission de la créatrice** :
   - **« 1. Récupère la conv »** : bouton de téléchargement du .txt (« enregistre-le dans Fichiers, puis importe-le sur askblush.com »), et l'écran choc en grand (« ouvre-le en plein écran, touche l'image pour masquer les boutons, et filme-le avec un autre téléphone ») ;
   - **« 2. Filme »** : les beats du flux, déjà existants.

### Étape 3 — Analytics
« Scénario » devient une dimension mesurée, comme hook, flux, description et notif : nombre de posts, vues médianes à J+7, verdict à partir de 50 posts.

### Étape 4 — MCP
Ajoute des outils au MCP Jarvia, en suivant les conventions existantes : préfixe « MODIFIE » pour les écritures, `pourDefaire`, journal des modifications faites par Claude.

| Outil | Rôle |
| --- | --- |
| `scenarios` | Lister les scénarios d'un projet |
| `lire_scenario` | Lire une bible |
| `creer_scenario` | Créer une bible (en brouillon), validée contre le schéma |
| `modifier_scenario` | Remplacer une bible |
| `tester_scenario` | Un prénom → les stats + les liens vers le .txt et le PNG |
| `activer_scenario` | Passer en actif ou en archivé |
| `scenarios_campagne` | Mettre des scénarios en rotation dans une campagne |

Bonus, deux trous du MCP repérés aujourd'hui :
- **`ajouter_hooks`** doit accepter les champs du hook libre : `libre`, `direction`, `exemples`.
- **Il manque un outil pour créer des notifs** (`ajouter_notifs`).

## Critères d'acceptation
Pour `bible_C2.json` avec le prénom « Kelly » (référence : `samples/stats_attendues.txt`) :
- environ 5 900 messages, à ±10 % ;
- réponse médiane de Kelly entre 2 et 3 min, celle de Yanis entre 30 et 40 min ;
- Kelly lance 70 à 80 % des échanges ;
- jour record ≥ 190 messages, le 14/02/2026 ;
- « je t'aime » : Yanis 0 ;
- « bernadette » est le premier mot partagé ;
- le fichier se termine exactement par les 5 messages de l'écran choc, aux secondes près ;
- deux générations identiques donnent le même hash de fichier ;
- le PNG ressemble à celui de référence ;
- **test réel** : le .txt s'importe sur askblush.com et donne un rapport.

## À vérifier avec le code BLUSH (askblush.com)
1. Quel libellé le parseur reconnaît comme vocal ? Le premier test a donné « 0 vocaux » ; on envoie `‎audio omis`.
2. Le parseur accepte-t-il le .txt seul, le .zip, ou les deux ?
3. Le même fichier donne-t-il toujours le même rapport et le même vocal ? C'est nécessaire pour citer le vocal dans les hooks.
4. Le prénom de la créatrice est-il bien repris par le vocal, quel que soit le prénom ?

Commence par lire tous les fichiers fournis, puis propose à Anthony ton plan d'implémentation de l'étape 1 : ce que tu vas créer ou modifier dans le repo, dans quel ordre. Attends son go avant de coder.
