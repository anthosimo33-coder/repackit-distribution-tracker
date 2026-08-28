/**
 * MODULE WARM-UP FUSIONNÉ — le protocole de la modale versé dans le guide.
 *
 * POURQUOI FUSIONNER. Deux documents décrivaient le même sujet pour le même
 * lecteur avec la même autorité : le module « Warmup » du guide (résumé, en
 * base, par projet) et la modale `warmupGuide` (protocole, en catalogue,
 * globale). Ils se sont contredits sur trois points en quelques mois — durée,
 * plateformes, et l'ordre de supprimer ou non une vidéo qui flope. Ce n'était
 * pas un accident : rien ne forçait à les mettre à jour ensemble.
 *
 * UN SEUL TEXTE, pas un résumé collé à un protocole : l'intro du module ouvre,
 * les « Étape 1 à 4 » du résumé sont fondues dans les règles communes et les
 * phases par plateforme, la rétention et le « à savoir aussi » ferment.
 *
 * AUCUN NOMBRE DE JOURS dans le texte, et c'est une contrainte, pas un oubli :
 * la durée vit dans le code (`projects.warmupTargetDays`) et s'affiche dans le
 * tracker. L'écrire ici la dupliquerait en base, où elle divergerait au premier
 * changement de barème — exactement ce que le lot précédent a supprimé. Les
 * phases sont donc décrites en PROPORTIONS (« au début », « sur la fin »), ce
 * qui les rend justes à 3 jours comme à 14.
 *
 * PAR PROJET : Snytch n'a pas de section YouTube et lit « les deux
 * plateformes » là où RepackIt lit « les 3 ».
 */

export type WarmupGuideSeed = { fr: string; en: string };

/** Titre du module, par langue — il porte le `slot` "warmup". */
export const WARMUP_MODULE_TITLE = {
  fr: "Warmup & éviter le shadowban",
  en: "Warm-up & avoiding shadowbans",
} as const;

export const WARMUP_GUIDE_BY_PROJECT: Record<string, WarmupGuideSeed> = {
  repackit: {
    fr: `Le warmup, c'est l'étape la plus importante si tu veux que tes vidéos soient vues. Même avec les meilleures vidéos du monde, si ton compte n'est pas chauffé correctement, l'algo ne les poussera pas. Pire : tu peux te faire shadowban, et tes vues resteront bloquées à zéro.

**Ta durée de chauffe est affichée dans le tracker**, compte par compte, avec le nombre de checks déjà posés. C'est elle qui fait foi : elle dépend du projet, un admin peut l'ajuster, et c'est ce décompte que suit ta progression. Les phases ci-dessous se lisent donc en proportions, pas en dates.

## Les règles communes

- Un e-mail dédié par compte, sans alias \`+\`.
- Appli mobile native uniquement, pendant la chauffe et tes 10 premiers posts — pas de web, pas d'API ni de planificateur.
- Pas de VPN, et cohérence géographique stricte : appareil, SIM et IP dans le même pays.
- Profil minimal les premiers jours : pas de bio commerciale, pas de lien externe agressif.
- N'interagis que dans ta niche, dès le premier jour.

## TikTok

### Pendant toute la chauffe — tu ne publies rien

- **Recherches quotidiennes avec TES mots-clés** dans la barre de recherche.
- 15 à 30 min par jour à faire défiler ton fil, sur ta niche.
- Regarde les vidéos de ta niche **en entier**, sans scroller vite.
- 10 à 20 likes par jour, et 2 ou 3 vrais commentaires — pas des « 🔥 ».
- **5 à 10 abonnements par jour maximum**, sur des comptes de ta niche.

### La progression, sur la durée de TA chauffe

- **Au début** : observe surtout. Des recherches, du scroll, quelques likes, et c'est tout — zéro abonnement, zéro commentaire.
- **Ensuite** : engage-toi doucement. Les abonnements et les premiers vrais commentaires arrivent là.
- **Sur la fin** : activité normale. Enregistre les posts pertinents, c'est un signal fort.
- Remplis ta bio et ta photo de profil pendant cette période.

### Ton premier post — le lendemain du dernier check

- **Ne publie rien avant que le tracker n'affiche ta chauffe terminée.** Un jour manqué décale la fin d'autant : c'est le nombre de checks posés qui compte, pas le temps passé.
- Ensuite, 1 post par jour pendant une semaine à dix jours avant d'augmenter le rythme.

## Instagram

### Mise en place

- Crée le compte, puis laisse le profil vide au début.
- Ajoute la bio, la photo de profil et une story à la une pendant la chauffe.

### Pendant toute la chauffe — tu ne publies rien

- **Recherches quotidiennes avec TES mots-clés** dans la barre de recherche.
- 15 à 30 min par jour à faire défiler ton fil, sur ta niche.
- Regarde les vidéos de ta niche **en entier**, sans scroller vite.
- 10 à 20 likes par jour, et 2 ou 3 vrais commentaires — pas des « 🔥 ».
- **5 à 10 abonnements par jour maximum**, sur des comptes de ta niche.
- Like et **enregistre** des Reels de ta niche.

### La progression, sur la durée de TA chauffe

- **Au début** : observe surtout. Des recherches, du scroll, quelques likes, et c'est tout — zéro abonnement, zéro commentaire.
- **Ensuite** : engage-toi doucement. Les abonnements et les premiers vrais commentaires arrivent là.
- **Sur la fin** : activité normale. Enregistre les posts pertinents, c'est un signal fort.
- Remplis ta bio et ta photo de profil pendant cette période.

### Ton premier Reel — le lendemain du dernier check

- **Ne publie rien avant que le tracker n'affiche ta chauffe terminée.** Un jour manqué décale la fin d'autant : c'est le nombre de checks posés qui compte, pas le temps passé.
- Ensuite, 1 Reel par jour pendant une semaine à dix jours avant d'augmenter le rythme.

## YouTube Shorts

YouTube est bien plus permissif : le compte est rattaché à ton compte Google existant, donc il inspire moins de méfiance.

### Mise en place

- Bannière, photo de profil, description de la chaîne, page « À propos » complète.
- Crée une playlist, même vide.
- Mets tes autres comptes en lien dans la description.

### Pendant toute la chauffe — tu ne publies rien

- **Recherches quotidiennes avec TES mots-clés** dans la barre de recherche.
- 15 à 30 min par jour à faire défiler ton fil, sur ta niche.
- Regarde les vidéos de ta niche **en entier**, sans scroller vite.
- 10 à 20 likes par jour, et 2 ou 3 vrais commentaires — pas des « 🔥 ».
- **5 à 10 abonnements par jour maximum**, sur des comptes de ta niche.
- 1 ou 2 vidéos longues par jour dans ta niche — c'est un signal fort pour YouTube.

### La progression, sur la durée de TA chauffe

- **Au début** : observe surtout. Des recherches, du scroll, quelques likes, et c'est tout — zéro abonnement, zéro commentaire.
- **Ensuite** : engage-toi doucement. Les abonnements et les premiers vrais commentaires arrivent là.
- **Sur la fin** : activité normale. Enregistre les posts pertinents, c'est un signal fort.
- Remplis ta bio et ta photo de profil pendant cette période.

### Ton premier Short — le lendemain du dernier check

- **Ne publie rien avant que le tracker n'affiche ta chauffe terminée.** Un jour manqué décale la fin d'autant : c'est le nombre de checks posés qui compte, pas le temps passé.
- Ensuite, 1 Short par jour pendant une semaine à dix jours avant d'augmenter le rythme.

## Ce qui compte vraiment pour percer

La chauffe évite de te faire flaguer, mais ce n'est pas elle qui fait décoller tes vues. Ce qui débloque la portée aujourd'hui, c'est la **rétention** :

- **Le hook des 3 premières secondes.** L'algo regarde si les gens restent au-delà des premières secondes. Une accroche faible, et la vidéo est testée puis abandonnée. Soigne tes 3 premières secondes par-dessus tout.
- **Le taux de complétion.** Vise à ce que les gens regardent ta vidéo en entier, ou la rematent. C'est le signal numéro un : une vidéo courte regardée en entier vaut mieux qu'une longue lâchée à la moitié.
- **Les partages et les enregistrements.** Ils pèsent plus lourd que les likes. Donne aux gens une raison d'enregistrer ou de partager.

## Vérifier que ton compte est clean

Une fois ton premier post en ligne, ces signaux disent si la chauffe a marché :

- **TikTok, vues du premier post à H+6** : 200 à 500+.
- **TikTok, source de trafic « Pour toi »** (Analytics → Portée) : plus de 30 %, idéalement plus de 50 %.
- **Instagram, vues du Reel à H+24** : 200 à 1 000+.
- **Instagram, portée hors abonnés** : plus de 40 %.
- **YouTube, vues du Short à H+48** : 100 à 500+.
- **YouTube, source « fil Shorts »** : présente.
- **Les 3 plateformes, test du hashtag unique** : ta vidéo se retrouve depuis un autre compte.
- **Les 3 plateformes, ton propre fil est devenu « niche »** : oui.

### Les signaux d'alerte

- Des vues bloquées entre 0 et 50, ou exactement 200 à répétition.
- Une source de trafic « Pour toi » / fil Reels / fil Shorts à 0 % dans les statistiques.
- Une vidéo bloquée en « Stuck Processing » plus de 2 h.
- Un pop-up « Action bloquée » sur Instagram.
- Des posts visibles seulement par tes abonnés existants.
- Une notification « Inéligible au fil Pour toi » (TikTok).
- Une chute de 70 % ou plus par rapport à la moyenne des 28 derniers jours.

## Si la chauffe a raté

1. **Arrête de poster immédiatement.** C'est ce qui compte le plus.
2. Prends une pause de 5 à 7 jours, mais **active** : fais défiler ta niche 20 à 30 min par jour, ne publie rien.
3. Reposte UNE vidéo et observe ce qui se passe.
4. Toujours 0 vue ? Abandonne le compte et crées-en un neuf.

**Ne supprime pas tes vidéos qui marchent mal.** Supprimer envoie un mauvais signal et peut déclencher les filtres anti-spam. Si tu veux en cacher une, passe-la en « Moi uniquement » plutôt que de la supprimer.

## Les trucs à ne PAS faire

### Pendant la chauffe

- Publier avant que le tracker n'affiche la chauffe terminée.
- T'abonner à 50 comptes le premier jour.
- Enchaîner les commentaires génériques (« nice », « 🔥 »).
- Interagir hors de ta niche : ça brouille la classification de ton compte.
- Changer ta bio ou ta photo de profil tous les jours.
- Passer d'un VPN à l'autre, ou d'une IP à l'autre.

### Au lancement, juste après la chauffe

- Lâcher 3 vidéos d'un coup.
- Utiliser un planificateur ou une API pour tes 10 premiers posts.
- Des hashtags douteux ou bannis — vérifie-les toujours dans la barre de recherche.
- L'appât à engagement (« like si t'es d'accord », « abonne-toi pour la partie 2 ») : c'est un flag immédiat.
- De la musique sous droits sur un compte professionnel.
- Publier **le même fichier vidéo** sur plusieurs comptes : l'empreinte du fichier est détectée.

### En continu

- Arrêter de faire défiler la plateforme une fois en mode publication : l'algo suit aussi ta consommation.
- Spammer après un succès — passer de 1 à 10 posts par jour est un flag.
- Sauter d'un compte à l'autre toutes les dix minutes.

## À savoir aussi

- **Sois patient(e).** Un compte neuf met du temps à gagner la confiance de l'algo. Tes premières vidéos peuvent faire peu de vues : c'est normal, surtout les 2-3 premières semaines. Ne juge pas trop vite.
- **Évite que ton contenu paraisse trop automatisé ou répétitif.** Les plateformes poussent moins ce qui semble produit en masse. Apporte ta touche, varie tes accroches.`,
    en: `Warming up is the most important step if you want your videos to be seen. Even with the best videos in the world, if your account isn't warmed up properly the algorithm won't push them. Worse: you can get shadowbanned, and your views stay stuck at zero.

**Your warm-up length is shown in the tracker**, account by account, along with how many checks you've posted. That's what counts: it depends on the project, an admin can adjust it, and it's that countdown your progress follows. So read the phases below as proportions, not dates.

## Common rules

- A dedicated email per account, no \`+\` aliases.
- Native mobile app only, during the warm-up and your first 10 posts — no web, no API, no scheduler.
- No VPN, and strict geo-consistency: device, SIM and IP in the same country.
- Keep your profile minimal for the first few days: no sales bio, no aggressive external link.
- Only engage inside your niche, from day one.

## TikTok

### Through the whole warm-up — you post nothing

- **Daily searches with YOUR keywords** in the search bar.
- 15 to 30 min a day scrolling your feed, inside your niche.
- Watch videos in your niche **all the way through**, no fast scrolling.
- 10 to 20 likes a day, and 2 or 3 genuine comments — not "🔥".
- **5 to 10 follows a day, max**, on accounts in your niche.

### How it ramps, across YOUR warm-up

- **Early on**: mostly observe. Searches, scrolling, a few likes, and that's it — zero follows, zero comments.
- **Then**: engage gently. Follows and your first real comments belong here.
- **Toward the end**: normal activity. Save the posts that matter — that's a strong signal.
- Fill in your bio and profile picture during this stretch.

### Your first post — the day after your last check

- **Don't post anything until the tracker shows your warm-up complete.** A missed day pushes the end back by one: what counts is the number of checks posted, not the time elapsed.
- After that, 1 post a day for a week to ten days before you pick up the pace.

## Instagram

### Setting up

- Create the account, then leave the profile empty at first.
- Add your bio, profile picture and one highlight during the warm-up.

### Through the whole warm-up — you post nothing

- **Daily searches with YOUR keywords** in the search bar.
- 15 to 30 min a day scrolling your feed, inside your niche.
- Watch videos in your niche **all the way through**, no fast scrolling.
- 10 to 20 likes a day, and 2 or 3 genuine comments — not "🔥".
- **5 to 10 follows a day, max**, on accounts in your niche.
- Like and **save** Reels from your niche.

### How it ramps, across YOUR warm-up

- **Early on**: mostly observe. Searches, scrolling, a few likes, and that's it — zero follows, zero comments.
- **Then**: engage gently. Follows and your first real comments belong here.
- **Toward the end**: normal activity. Save the posts that matter — that's a strong signal.
- Fill in your bio and profile picture during this stretch.

### Your first Reel — the day after your last check

- **Don't post anything until the tracker shows your warm-up complete.** A missed day pushes the end back by one: what counts is the number of checks posted, not the time elapsed.
- After that, 1 Reel a day for a week to ten days before you pick up the pace.

## YouTube Shorts

YouTube is far more permissive: the account is tied to your existing Google account, so it draws less suspicion.

### Setting up

- Banner, profile picture, channel description, full About page.
- Create a playlist, even an empty one.
- Link your other accounts in the description.

### Through the whole warm-up — you post nothing

- **Daily searches with YOUR keywords** in the search bar.
- 15 to 30 min a day scrolling your feed, inside your niche.
- Watch videos in your niche **all the way through**, no fast scrolling.
- 10 to 20 likes a day, and 2 or 3 genuine comments — not "🔥".
- **5 to 10 follows a day, max**, on accounts in your niche.
- 1 or 2 long videos a day in your niche — a strong signal for YouTube.

### How it ramps, across YOUR warm-up

- **Early on**: mostly observe. Searches, scrolling, a few likes, and that's it — zero follows, zero comments.
- **Then**: engage gently. Follows and your first real comments belong here.
- **Toward the end**: normal activity. Save the posts that matter — that's a strong signal.
- Fill in your bio and profile picture during this stretch.

### Your first Short — the day after your last check

- **Don't post anything until the tracker shows your warm-up complete.** A missed day pushes the end back by one: what counts is the number of checks posted, not the time elapsed.
- After that, 1 Short a day for a week to ten days before you pick up the pace.

## What really matters to break through

The warm-up keeps you from getting flagged, but it's not what makes your views take off. What unlocks reach today is **retention**:

- **The hook in the first 3 seconds.** The algorithm watches whether people stay past the first few seconds. A weak hook and the video gets tested, then dropped. Obsess over your first 3 seconds above everything else.
- **Completion rate.** Aim for people watching your video all the way through, or rewatching it. That's signal number one: a short video watched to the end beats a long one people bail on halfway.
- **Shares and saves.** They count for more than likes. Give people a reason to save or share.

## Check that your account is clean

Once your first post is live, these signals tell you whether the warm-up worked:

- **TikTok, views on your first post at H+6**: 200 to 500+.
- **TikTok, For You traffic source** (Analytics → Reach): over 30%, ideally over 50%.
- **Instagram, Reel views at H+24**: 200 to 1,000+.
- **Instagram, non-follower reach**: over 40%.
- **YouTube, Short views at H+48**: 100 to 500+.
- **YouTube, "Shorts feed" source**: present.
- **All 3 platforms, unique hashtag test**: your video is findable from another account.
- **All 3 platforms, your own feed has gone niche**: yes.

### The warning signs

- Views stuck between 0 and 50, or exactly 200 over and over.
- For You / Reels feed / Shorts feed traffic at 0% in your analytics.
- A video stuck on "Stuck Processing" for more than 2 hours.
- An "Action blocked" pop-up on Instagram.
- Posts visible only to your existing followers.
- An "Ineligible for the For You feed" notification (TikTok).
- A drop of 70% or more against your 28-day average.

## If the warm-up failed

1. **Stop posting immediately.** That's the one that matters most.
2. Take a 5 to 7 day break, but an **active** one: scroll your niche 20 to 30 min a day, post nothing.
3. Repost ONE video and watch what happens.
4. Still zero views? Drop the account and create a fresh one.

**Don't delete videos that flop.** Deleting sends a bad signal and can trip the anti-spam filters. If you want one out of sight, set it to **Only me** on TikTok or **archive** it on Instagram instead of deleting it.

## What NOT to do

### During the warm-up

- Posting before the tracker shows the warm-up complete.
- Following 50 accounts on day one.
- Firing off generic comments ("nice", "🔥").
- Engaging outside your niche: it muddles how your account gets classified.
- Changing your bio or profile picture every day.
- Hopping between VPNs, or between IPs.

### At launch, right after the warm-up

- Dropping 3 videos at once.
- Using a scheduler or an API for your first 10 posts.
- Shady or banned hashtags — always check them in the search bar.
- Engagement bait ("like if you agree", "follow for part 2"): an instant flag.
- Copyrighted music on a business account.
- Posting **the same video file** to several accounts: file fingerprinting is detected.

### Ongoing

- Stopping scrolling the platform once you're in posting mode: the algorithm tracks your consumption too.
- Spam-posting after a hit — going from 1 to 10 posts a day is a flag.
- Hopping between accounts every ten minutes.

## Also worth knowing

- **Be patient.** A new account takes time to earn the algorithm's trust. Your first videos may not get many views: that's normal, especially the first 2-3 weeks. Don't judge too fast.
- **Don't let your content look automated or repetitive.** Platforms push mass-produced content less. Add your own spin, vary your hooks.`,
  },
  snytch: {
    fr: `Le warmup, c'est l'étape la plus importante si tu veux que tes vidéos soient vues. Même avec les meilleures vidéos du monde, si ton compte n'est pas chauffé correctement, l'algo ne les poussera pas. Pire : tu peux te faire shadowban, et tes vues resteront bloquées à zéro.

**Ta durée de chauffe est affichée dans le tracker**, compte par compte, avec le nombre de checks déjà posés. C'est elle qui fait foi : elle dépend du projet, un admin peut l'ajuster, et c'est ce décompte que suit ta progression. Les phases ci-dessous se lisent donc en proportions, pas en dates.

## Les règles communes

- Un e-mail dédié par compte, sans alias \`+\`.
- Appli mobile native uniquement, pendant la chauffe et tes 10 premiers posts — pas de web, pas d'API ni de planificateur.
- Pas de VPN, et cohérence géographique stricte : appareil, SIM et IP dans le même pays.
- Profil minimal les premiers jours : pas de bio commerciale, pas de lien externe agressif.
- N'interagis que dans ta niche, dès le premier jour.

## TikTok

### Pendant toute la chauffe — tu ne publies rien

- **Recherches quotidiennes avec TES mots-clés** dans la barre de recherche.
- 15 à 30 min par jour à faire défiler ton fil, sur ta niche.
- Regarde les vidéos de ta niche **en entier**, sans scroller vite.
- 10 à 20 likes par jour, et 2 ou 3 vrais commentaires — pas des « 🔥 ».
- **5 à 10 abonnements par jour maximum**, sur des comptes de ta niche.

### La progression, sur la durée de TA chauffe

- **Au début** : observe surtout. Des recherches, du scroll, quelques likes, et c'est tout — zéro abonnement, zéro commentaire.
- **Ensuite** : engage-toi doucement. Les abonnements et les premiers vrais commentaires arrivent là.
- **Sur la fin** : activité normale. Enregistre les posts pertinents, c'est un signal fort.
- Remplis ta bio et ta photo de profil pendant cette période.

### Ton premier post — le lendemain du dernier check

- **Ne publie rien avant que le tracker n'affiche ta chauffe terminée.** Un jour manqué décale la fin d'autant : c'est le nombre de checks posés qui compte, pas le temps passé.
- Ensuite, 1 post par jour pendant une semaine à dix jours avant d'augmenter le rythme.

## Instagram

### Mise en place

- Crée le compte, puis laisse le profil vide au début.
- Ajoute la bio, la photo de profil et une story à la une pendant la chauffe.

### Pendant toute la chauffe — tu ne publies rien

- **Recherches quotidiennes avec TES mots-clés** dans la barre de recherche.
- 15 à 30 min par jour à faire défiler ton fil, sur ta niche.
- Regarde les vidéos de ta niche **en entier**, sans scroller vite.
- 10 à 20 likes par jour, et 2 ou 3 vrais commentaires — pas des « 🔥 ».
- **5 à 10 abonnements par jour maximum**, sur des comptes de ta niche.
- Like et **enregistre** des Reels de ta niche.

### La progression, sur la durée de TA chauffe

- **Au début** : observe surtout. Des recherches, du scroll, quelques likes, et c'est tout — zéro abonnement, zéro commentaire.
- **Ensuite** : engage-toi doucement. Les abonnements et les premiers vrais commentaires arrivent là.
- **Sur la fin** : activité normale. Enregistre les posts pertinents, c'est un signal fort.
- Remplis ta bio et ta photo de profil pendant cette période.

### Ton premier Reel — le lendemain du dernier check

- **Ne publie rien avant que le tracker n'affiche ta chauffe terminée.** Un jour manqué décale la fin d'autant : c'est le nombre de checks posés qui compte, pas le temps passé.
- Ensuite, 1 Reel par jour pendant une semaine à dix jours avant d'augmenter le rythme.

## Ce qui compte vraiment pour percer

La chauffe évite de te faire flaguer, mais ce n'est pas elle qui fait décoller tes vues. Ce qui débloque la portée aujourd'hui, c'est la **rétention** :

- **Le hook des 3 premières secondes.** L'algo regarde si les gens restent au-delà des premières secondes. Une accroche faible, et la vidéo est testée puis abandonnée. Soigne tes 3 premières secondes par-dessus tout.
- **Le taux de complétion.** Vise à ce que les gens regardent ta vidéo en entier, ou la rematent. C'est le signal numéro un : une vidéo courte regardée en entier vaut mieux qu'une longue lâchée à la moitié.
- **Les partages et les enregistrements.** Ils pèsent plus lourd que les likes. Donne aux gens une raison d'enregistrer ou de partager.

## Vérifier que ton compte est clean

Une fois ton premier post en ligne, ces signaux disent si la chauffe a marché :

- **TikTok, vues du premier post à H+6** : 200 à 500+.
- **TikTok, source de trafic « Pour toi »** (Analytics → Portée) : plus de 30 %, idéalement plus de 50 %.
- **Instagram, vues du Reel à H+24** : 200 à 1 000+.
- **Instagram, portée hors abonnés** : plus de 40 %.
- **Les deux plateformes, test du hashtag unique** : ta vidéo se retrouve depuis un autre compte.
- **Les deux plateformes, ton propre fil est devenu « niche »** : oui.

### Les signaux d'alerte

- Des vues bloquées entre 0 et 50, ou exactement 200 à répétition.
- Une source de trafic « Pour toi » / fil Reels / fil Shorts à 0 % dans les statistiques.
- Une vidéo bloquée en « Stuck Processing » plus de 2 h.
- Un pop-up « Action bloquée » sur Instagram.
- Des posts visibles seulement par tes abonnés existants.
- Une notification « Inéligible au fil Pour toi » (TikTok).
- Une chute de 70 % ou plus par rapport à la moyenne des 28 derniers jours.

## Si la chauffe a raté

1. **Arrête de poster immédiatement.** C'est ce qui compte le plus.
2. Prends une pause de 5 à 7 jours, mais **active** : fais défiler ta niche 20 à 30 min par jour, ne publie rien.
3. Reposte UNE vidéo et observe ce qui se passe.
4. Toujours 0 vue ? Abandonne le compte et crées-en un neuf.

**Ne supprime pas tes vidéos qui marchent mal.** Supprimer envoie un mauvais signal et peut déclencher les filtres anti-spam. Si tu veux en cacher une, passe-la en « Moi uniquement » plutôt que de la supprimer.

## Les trucs à ne PAS faire

### Pendant la chauffe

- Publier avant que le tracker n'affiche la chauffe terminée.
- T'abonner à 50 comptes le premier jour.
- Enchaîner les commentaires génériques (« nice », « 🔥 »).
- Interagir hors de ta niche : ça brouille la classification de ton compte.
- Changer ta bio ou ta photo de profil tous les jours.
- Passer d'un VPN à l'autre, ou d'une IP à l'autre.

### Au lancement, juste après la chauffe

- Lâcher 3 vidéos d'un coup.
- Utiliser un planificateur ou une API pour tes 10 premiers posts.
- Des hashtags douteux ou bannis — vérifie-les toujours dans la barre de recherche.
- L'appât à engagement (« like si t'es d'accord », « abonne-toi pour la partie 2 ») : c'est un flag immédiat.
- De la musique sous droits sur un compte professionnel.
- Publier **le même fichier vidéo** sur plusieurs comptes : l'empreinte du fichier est détectée.

### En continu

- Arrêter de faire défiler la plateforme une fois en mode publication : l'algo suit aussi ta consommation.
- Spammer après un succès — passer de 1 à 10 posts par jour est un flag.
- Sauter d'un compte à l'autre toutes les dix minutes.

## À savoir aussi

- **Sois patient(e).** Un compte neuf met du temps à gagner la confiance de l'algo. Tes premières vidéos peuvent faire peu de vues : c'est normal, surtout les 2-3 premières semaines. Ne juge pas trop vite.
- **Évite que ton contenu paraisse trop automatisé ou répétitif.** Les plateformes poussent moins ce qui semble produit en masse. Apporte ta touche, varie tes accroches.`,
    en: `Warming up is the most important step if you want your videos to be seen. Even with the best videos in the world, if your account isn't warmed up properly the algorithm won't push them. Worse: you can get shadowbanned, and your views stay stuck at zero.

**Your warm-up length is shown in the tracker**, account by account, along with how many checks you've posted. That's what counts: it depends on the project, an admin can adjust it, and it's that countdown your progress follows. So read the phases below as proportions, not dates.

## Common rules

- A dedicated email per account, no \`+\` aliases.
- Native mobile app only, during the warm-up and your first 10 posts — no web, no API, no scheduler.
- No VPN, and strict geo-consistency: device, SIM and IP in the same country.
- Keep your profile minimal for the first few days: no sales bio, no aggressive external link.
- Only engage inside your niche, from day one.

## TikTok

### Through the whole warm-up — you post nothing

- **Daily searches with YOUR keywords** in the search bar.
- 15 to 30 min a day scrolling your feed, inside your niche.
- Watch videos in your niche **all the way through**, no fast scrolling.
- 10 to 20 likes a day, and 2 or 3 genuine comments — not "🔥".
- **5 to 10 follows a day, max**, on accounts in your niche.

### How it ramps, across YOUR warm-up

- **Early on**: mostly observe. Searches, scrolling, a few likes, and that's it — zero follows, zero comments.
- **Then**: engage gently. Follows and your first real comments belong here.
- **Toward the end**: normal activity. Save the posts that matter — that's a strong signal.
- Fill in your bio and profile picture during this stretch.

### Your first post — the day after your last check

- **Don't post anything until the tracker shows your warm-up complete.** A missed day pushes the end back by one: what counts is the number of checks posted, not the time elapsed.
- After that, 1 post a day for a week to ten days before you pick up the pace.

## Instagram

### Setting up

- Create the account, then leave the profile empty at first.
- Add your bio, profile picture and one highlight during the warm-up.

### Through the whole warm-up — you post nothing

- **Daily searches with YOUR keywords** in the search bar.
- 15 to 30 min a day scrolling your feed, inside your niche.
- Watch videos in your niche **all the way through**, no fast scrolling.
- 10 to 20 likes a day, and 2 or 3 genuine comments — not "🔥".
- **5 to 10 follows a day, max**, on accounts in your niche.
- Like and **save** Reels from your niche.

### How it ramps, across YOUR warm-up

- **Early on**: mostly observe. Searches, scrolling, a few likes, and that's it — zero follows, zero comments.
- **Then**: engage gently. Follows and your first real comments belong here.
- **Toward the end**: normal activity. Save the posts that matter — that's a strong signal.
- Fill in your bio and profile picture during this stretch.

### Your first Reel — the day after your last check

- **Don't post anything until the tracker shows your warm-up complete.** A missed day pushes the end back by one: what counts is the number of checks posted, not the time elapsed.
- After that, 1 Reel a day for a week to ten days before you pick up the pace.

## What really matters to break through

The warm-up keeps you from getting flagged, but it's not what makes your views take off. What unlocks reach today is **retention**:

- **The hook in the first 3 seconds.** The algorithm watches whether people stay past the first few seconds. A weak hook and the video gets tested, then dropped. Obsess over your first 3 seconds above everything else.
- **Completion rate.** Aim for people watching your video all the way through, or rewatching it. That's signal number one: a short video watched to the end beats a long one people bail on halfway.
- **Shares and saves.** They count for more than likes. Give people a reason to save or share.

## Check that your account is clean

Once your first post is live, these signals tell you whether the warm-up worked:

- **TikTok, views on your first post at H+6**: 200 to 500+.
- **TikTok, For You traffic source** (Analytics → Reach): over 30%, ideally over 50%.
- **Instagram, Reel views at H+24**: 200 to 1,000+.
- **Instagram, non-follower reach**: over 40%.
- **Both platforms, unique hashtag test**: your video is findable from another account.
- **Both platforms, your own feed has gone niche**: yes.

### The warning signs

- Views stuck between 0 and 50, or exactly 200 over and over.
- For You / Reels feed / Shorts feed traffic at 0% in your analytics.
- A video stuck on "Stuck Processing" for more than 2 hours.
- An "Action blocked" pop-up on Instagram.
- Posts visible only to your existing followers.
- An "Ineligible for the For You feed" notification (TikTok).
- A drop of 70% or more against your 28-day average.

## If the warm-up failed

1. **Stop posting immediately.** That's the one that matters most.
2. Take a 5 to 7 day break, but an **active** one: scroll your niche 20 to 30 min a day, post nothing.
3. Repost ONE video and watch what happens.
4. Still zero views? Drop the account and create a fresh one.

**Don't delete videos that flop.** Deleting sends a bad signal and can trip the anti-spam filters. If you want one out of sight, set it to **Only me** on TikTok or **archive** it on Instagram instead of deleting it.

## What NOT to do

### During the warm-up

- Posting before the tracker shows the warm-up complete.
- Following 50 accounts on day one.
- Firing off generic comments ("nice", "🔥").
- Engaging outside your niche: it muddles how your account gets classified.
- Changing your bio or profile picture every day.
- Hopping between VPNs, or between IPs.

### At launch, right after the warm-up

- Dropping 3 videos at once.
- Using a scheduler or an API for your first 10 posts.
- Shady or banned hashtags — always check them in the search bar.
- Engagement bait ("like if you agree", "follow for part 2"): an instant flag.
- Copyrighted music on a business account.
- Posting **the same video file** to several accounts: file fingerprinting is detected.

### Ongoing

- Stopping scrolling the platform once you're in posting mode: the algorithm tracks your consumption too.
- Spam-posting after a hit — going from 1 to 10 posts a day is a flag.
- Hopping between accounts every ten minutes.

## Also worth knowing

- **Be patient.** A new account takes time to earn the algorithm's trust. Your first videos may not get many views: that's normal, especially the first 2-3 weeks. Don't judge too fast.
- **Don't let your content look automated or repetitive.** Platforms push mass-produced content less. Add your own spin, vary your hooks.`,
  },
};
