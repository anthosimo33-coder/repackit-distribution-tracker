# Contexte — pourquoi on construit les Scénarios

## BLUSH
BLUSH (askblush.com) analyse une conversation. L'utilisateur importe un export WhatsApp (.txt) ou des captures (Instagram, iMessage). BLUSH rend :
- un écran de chargement « BLUSH analyse tes N messages » avec 3 pastilles (qui ouvre la conv, temps de réponse de chacun, « Votre mot à vous ») ;
- un rapport écrit (verdict, sections « Le 22 juin », « Ce qui coince », « Ton prochain pas »…) ;
- un vocal de ~25 s, sous-titré, qui interpelle l'utilisatrice par son prénom et affiche les messages qu'il cite ;
- un chat avec l'IA qui continue après le rapport.

## L'acquisition : vidéos UGC pilotées dans Jarvia
Le projet Jarvia « blush » contient les campagnes A, B, C, D (squelette S1) et E (squelette S2). Une campagne = des briques en rotation (hook, flux, description, notif), mesurées à J+7, jugées à partir de 50 posts. Les hooks sont en « hook libre » (direction + exemples) et les flux sont écrits en beats.

**S1 · Rapport** : hook + fond + tenue + expression (0 s) → la conv qui choque, présentée comme normale (~3 s) → retour face cam → import sur BLUSH, nombre de messages → la notif tombe → titres du verdict + question à BLUSH dans le chat → réaction.

**S2 · Vocal suspendu** : le vocal démarre à 0 s, son à fond → alternance gros plan / écran BLUSH → question vocale dans le chat → on coupe sans expliquer, pour récolter des « c'est quoi le site ? ».

## Le problème
Les flux disent « montre la conv qu'on t'envoie ». Il faut donc fournir à chaque créatrice, pour chaque vidéo :
1. un **écran choc** à filmer vers 3 s (les derniers messages, lisibles en 2 s) ;
2. un **fichier** à importer sur le vrai BLUSH, cohérent avec cet écran ;
3. un **rapport et un vocal** qui tapent ;
4. le tout **à son prénom**, pour que le vocal l'interpelle (« Kelly, assieds-toi, faut qu'on parle »).

Jamais une vraie conv.

## Ce que fait la concurrence (Moka / What Brandon Thinks)
Portail créateurs gumgumcreators.com :
- une liste de scénarios par type (Romantic, Family, Friends group) aux titres dramatiques ;
- pour chacun, un aperçu du rapport et deux boutons : « 1. Get the chat » (télécharge un .txt d'export WhatsApp) et « 2. Film it » ;
- la conv est au prénom de la créatrice, et l'historique est énorme (38 412 messages) et truffé de détails absurdes que l'IA ressort.

**Leur trou** : l'écran filmé à 3 s est choisi au hasard par la créatrice. Nous, on le fabrique.

## Ce que le premier test a appris (scénario C2, testé sur askblush.com)
- Les 3 pastilles de chargement sont pilotables : « Tu ouvres la conv 8 jours sur 10 », « Il te répond en 35 min, toi en 3 min »… et « Votre mot à vous : « mange » × 135 », un déchet du remplissage. Correction : le mot à vous se **plante** (C2 : « bernadette »).
- Le **rapport écrit** se nourrit des munitions de l'historique (running gag, tournant daté → section « Le 22 juin »).
- Le **vocal** se nourrit de la **fin** : l'écran choc et les 7 derniers jours. Les munitions anciennes n'y apparaissent pas. D'où le champ `derniere_semaine` dans la bible.
- Une répétition accidentelle du remplissage en fin de conv a été lue comme un schéma : le moteur interdit désormais les répétitions dans les 15 derniers jours.
- BLUSH a compté « 0 vocaux » : la v2 ajoute des vocaux omis (`‎audio omis`). Le libellé exact reconnu par le parseur BLUSH reste à vérifier.

## Les règles d'écriture d'un scénario (pour les bibles)
- Clivant, pas juste choquant : la moitié des gens doit trouver ça normal, l'autre moitié red flag. La créatrice dit « c'est normal », l'écran prouve le contraire.
- Des red flags du quotidien (jalousie, ghosting, mauvaise foi), jamais de violence ni d'abus.
- Six types de munitions : le running gag absurde, les pièges à stats, les contradictions datées, le tournant daté, les répliques citables, la question jamais posée.
- Du banal entre les munitions : c'est ce qui rend le reste crédible.
- On ne devine pas ce que le moteur BLUSH retient : on génère, on importe, on lit, on écoute, on corrige.

## Scénarios à écrire ensuite (écrans choc déjà définis)
| Id | Campagne | Écran choc |
| --- | --- | --- |
| A1 | Il répond plus pareil | Long message vulnérable à 23:14, il répond « mdr » à 05:52 |
| A2 | Il répond plus pareil | « tu fais quoi ce soir ? » / « ? » … à 02:17 « dsl j'étais avec les gars » / « tu dors ? » |
| B1 | Mon meilleur ami | « il m'a invitée au resto » → « tu mérites mieux que lui » à 01:58, puis « laisse tomber je dis n'importe quoi » |
| B2 | Mon meilleur ami | « je peux dormir chez toi ? » → « ton copain il sait qu'on dort dans le même lit ? » |
| C1 | La dispute | « t'étais où ? » → « tu recommences » → « t'es vraiment fatigante parfois » |
| C2 | La dispute | **Fait** — « pourquoi t'as liké la photo de ton ex ? » → « t'as raison pardon » |
| D1 | Quoi lui répondre | « j'ai trop kiffé hier soir 🙈 », deux coches bleues, rien depuis 2 jours |
| D2 | Quoi lui répondre | « t'es où ? » / « chez moi pourquoi ? » / « allo ? » / « t'es en vie ? », coches bleues |
