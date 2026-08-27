/**
 * GUIDE « Comment ça marche » — JEU ANGLAIS (locale « en »).
 *
 * Traduction des 11 modules français en anglais US, ton informel, aligné sur la
 * voix du catalogue `messages/en.json`. Un jeu par langue (cf
 * convex/guideModuleLocale.ts) : ces modules N'ALTÈRENT AUCUN module français,
 * ils vivent à côté, avec leur propre ordre.
 *
 * POURQUOI LE CONTENU VIT DANS LE DÉPÔT plutôt que d'être collé à la main dans
 * l'éditeur admin : 16 000 caractères saisis à la main ne se relisent pas en
 * diff, ne se rejouent pas sur un autre déploiement, et se perdent. Ici il est
 * revu comme du code, et `migrations:seedGuideModulesEn` le pose — la même
 * mutation, idempotente, sur le dev comme sur la prod.
 *
 * CE QUI N'EST PAS UNE TRADUCTION LITTÉRALE est signalé par un commentaire
 * `ADAPTÉ —` juste au-dessus : la réalité d'une créatrice US diffère du texte
 * français sur le mode de paiement, les libellés d'interface des plateformes et
 * le fuseau des échéances. Traduire ces passages en aveugle donnerait des
 * instructions fausses, pas de l'anglais.
 *
 * Les ORDRES reproduisent ceux du jeu français, projet par projet.
 */

export type GuideModuleSeed = {
  order: number;
  title: string;
  contentMarkdown: string;
};

/** Jeu anglais du projet `repackit` — 5 modules, même ordre que le français. */
export const REPACKIT_EN: GuideModuleSeed[] = [
  {
    // ADAPTÉ — l'étape 5 du français est hors de la liste numérotée (le « 5. »
    // manque, contrairement au même module chez Snytch). Rendue au format des
    // quatre autres : c'est un défaut de saisie, pas une intention.
    order: 0,
    title: "Welcome & how it works",
    contentMarkdown: `**Welcome to the RepackIt creator crew 👋**

RepackIt is the tool that helps YouTubers build thumbnails and hooks people actually click. Your job: make short videos that show and explain what RepackIt does, so creators come check out the tool.

**Here's how it goes, step by step:**

1. **You create your accounts** on social (TikTok, Instagram, YouTube) — the exact handle to use is shown in the app.
2. **You warm up your accounts** for a few days before you post anything. It's not optional, and there's a whole module on it.
3. **You get your missions** in the app: each one tells you which video to make, with the script and the brief.
4. **You make your video and submit it** right in the mission, once it's live on your account.
5. **You get paid** based on your views, tracked automatically in the app.

Everything happens here, in this app. Your accounts, your missions, your views, your earnings — you follow all of it from your space. Got a question? Ask.

Take the time to read every module before you start. It'll save you the mistakes that cost views (or an account).`,
  },
  {
    // ADAPTÉ — « renseigner tes coordonnées de paiement » n'a pas le même sens
    // ici : le profil propose SEPA / PayPal / USDT / Autre, et SEPA suppose un
    // IBAN européen qu'une créatrice US n'a pas. Le paragraphe nomme donc les
    // méthodes réellement utilisables et écarte SEPA explicitement. La devise,
    // elle, ne bouge pas : projects.payCurrency vaut déjà « usd ».
    order: 1,
    title: "How you get paid",
    contentMarkdown: `At RepackIt you're paid on CPM — meaning on the views your videos bring in. Your deal has three parts:

- **A fixed base**: a guaranteed amount for a set volume of videos.
- **A variable share on views**: an amount per 1,000 views on your videos.
- **Bonus tiers**: rewards you unlock when you hit certain totals of cumulative views.

**The exact numbers on YOUR deal** (your base, your view rate, your tiers) are in your contract. You can also see an estimate of your earnings right on each mission in the app.

**How it's tracked**: once your video is live and submitted in the app, we pull its views automatically. Your earnings update as the video racks up views. Nothing for you to calculate — it's all in your space, under Earnings.

**Two simple conditions to get paid:**

- Your video has to follow the content rules (see the Rules & requirements module).
- You have to submit your video link in the app after you publish, so we can track its views.

Add your payout details in your profile as soon as you start earning — otherwise we can't send you what you're owed.

**Getting paid from the US.** Everything is paid in **US dollars**. In your profile, pick **PayPal**, **USDT (crypto)**, or **Other** and tell us how you'd rather be paid. The SEPA option is for European bank accounts — skip it, it won't work with a US bank.`,
  },
  {
    order: 2,
    title: "Setting up your accounts",
    contentMarkdown: `Before you make anything, you need clean accounts on social.

**Step 1 — Create brand-new accounts**

Create fresh accounts on TikTok, Instagram and YouTube (depending on what you're asked for). Start from blank accounts, not an existing personal one.

**Step 2 — Use the right handle (@)**

The exact handle to create on each platform **is shown in the app** (in your space, under "Create these accounts on your socials"). Create that exact handle on every platform, then declare the account in the app. This matters — it's how we track your videos and your views.

**Step 3 — Profile picture & bio**

- Put up a clean profile picture that fits RepackIt.
- Mention **@repackit.io** in your bio on every account.

**Step 4 — Basic settings**

Link an email and a phone number to each account. It makes the account look legit to the platforms and lowers the risk of your reach getting capped.

**Step 5 — Declare your accounts in the app**

Once your accounts exist, declare them in your space. That's what connects your accounts to your missions and tracks your views.

Accounts ready and declared? **Don't post yet.** Head to the warmup module.`,
  },
  {
    // ADAPTÉ — « passe-la en Moi uniquement » cite un LIBELLÉ d'interface. En
    // anglais TikTok l'affiche « Only me », et Instagram n'a pas d'équivalent :
    // on y archive. Traduire le libellé français mot à mot enverrait chercher
    // un réglage qui n'existe pas sous ce nom.
    order: 3,
    title: "Warmup & avoiding shadowbans",
    contentMarkdown: `This is the most important step if you want your videos to be seen. Even with the best videos in the world, if your account isn't warmed up properly the algorithm won't push them. Worse: you can get shadowbanned, and your views stay stuck at zero.

**Applies to every platform (TikTok, Instagram, YouTube).**

**Step 1 — Don't rush it**

Just made your account? Great. Don't post anything yet. For the first 7 days, behave like a normal user: scroll, watch videos all the way through, like, comment, follow a few creators in your niche. That tells the algorithm you're a real person, not a bot.

**Step 2 — Stay in your niche**

Only interact with content close to what you're going to post. If you make content about content creation / YouTube, watch and engage with that kind of video. It helps the algorithm understand what your account is about and who to show your videos to.

**Step 3 — No spammy behavior**

Don't go following hundreds of people or liking at full speed. That's a red flag. Take it easy: around twenty follows a day max, a reasonable number of likes.

**Step 4 — Set your account up properly**

Link an email and a phone number. A complete account looks more legit and is less likely to get throttled.

**What REALLY matters to break through (the biggest thing right now):**

Warmup keeps you from getting flagged, but it's not what makes your views take off. What unlocks reach today is **retention**:

- **The hook in the first 3 seconds**. The algorithm watches whether people stay past the first few seconds. A weak hook = the video gets tested, then dropped. Obsess over your first 3 seconds above everything else.
- **Completion rate**. Aim for people watching your video all the way through (or rewatching it). That's signal number one. A short video watched to the end beats a long one people bail on halfway.
- **Shares and saves**. They count for more than likes. Give people a reason to save or share your video.

**Also worth knowing:**

- **Be patient**. A new account takes time to earn the algorithm's trust. Your first videos may not get many views — that's normal, especially the first 2-3 weeks. Don't judge too fast.
- **Don't delete videos that flop**. Deleting sends a bad signal and can trip the anti-spam filters. If you want one out of sight, set it to **Only me** on TikTok or **archive** it on Instagram instead of deleting it.
- **Don't let your content look automated or repetitive**. Platforms push mass-produced content less. Add your own spin, vary your hooks.

Once your account is warm: you can start posting your missions.`,
  },
  {
    order: 4,
    title: "Posting rules & requirements",
    contentMarkdown: `Here are the rules your videos have to follow to get approved and paid. **If you don't follow them, you don't get paid.**

**Content:**

- Every video has to **tag @repackit.io** on the matching platform.
- You have to **mention @repackit.io in your bio** on the account you post from.
- **Minimum length: 10 seconds** per video.

**Quality:**

- Your videos have to follow the brief and the script provided in each mission.
- No cheating: views and engagement must never be boosted artificially (bots are banned, and we catch them).

**Submitting:**

- Once your video is live, **submit its link in the app** (in the matching mission) so we can track its views. Do it soon after you publish.

Follow these and you're golden. We're in this together: you make good content, you get paid for your views. Question? We're around 24/7!`,
  },
];

/** Jeu anglais du projet `snytch` — 6 modules, même ordre que le français. */
export const SNYTCH_EN: GuideModuleSeed[] = [
  {
    order: 0,
    title: "Welcome & how it works",
    contentMarkdown: `**Welcome to the Snytch creator crew 👋**

Snytch is the Gen Z app for tracking what's happening on an Instagram account: new followers, unfollows, who interacts with you the most — on private accounts as well as public ones.

Your job: make short videos that show and explain what Snytch does, so people come try the app.

**Here's how it goes, step by step:**

1. **You create your accounts** on social (TikTok and Instagram, depending on your deal) — the exact handle to use is shown in the app.
2. **You warm up your accounts** for a few days before you post anything. It's not optional, and there's a whole module on it.
3. **You get your missions** in the app: each one tells you which video to make, with the script and the brief.
4. **You make your video and submit it** right in the mission, once it's live on your account.
5. **You get paid** according to your contract and your views, tracked automatically in the app.

Everything happens here, in this app. Your accounts, your missions, your views, your earnings — you follow all of it from your space. Got a question? Ask.

Take the time to read every module before you start. It'll save you the mistakes that cost views (or an account).`,
  },
  {
    // ADAPTÉ — deux fois.
    //
    // (1) Le français se contredit : il annonce « ton contrat peut varier … ou
    // d'un fixe + d'un variable » puis « ton deal se compose de DEUX parties »
    // en n'en listant que les deux variables. L'anglais garde le fixe POSSIBLE
    // et présente les deux points listés pour ce qu'ils sont : les deux parts
    // qui suivent les vues.
    //
    // ⚠️ NE PAS « CORRIGER » EN REGARDANT LES BARÈMES. La table `pricings` de
    // prod donne montantFixe = 0 sur l'unique barème Snytch (contre 100 chez
    // RepackIt), et la parenthèse du français plus bas — « ton taux aux vues,
    // tes paliers » — omet toute base. Tout pousse donc à écrire « paid on CPM,
    // two parts » et à supprimer le fixe. C'est un ARBITRAGE PRODUIT, tranché
    // par le user le 2026-08-27 : un barème en base n'est pas un contrat signé,
    // et le module ne doit pas fermer une porte que le contrat peut ouvrir.
    //
    // (2) Même adaptation du paiement que chez RepackIt : SEPA écarté, méthodes
    // réellement utilisables nommées.
    order: 1,
    title: "How you get paid",
    contentMarkdown: `At Snytch, what your contract covers depends on your deal: views only, or a fixed amount plus a share on views. Here are the two parts that follow your views:

- **A variable share on views**: an amount per 1,000 views on your videos.
- **Bonus tiers**: rewards you unlock when you hit certain totals of cumulative views.

**The exact numbers on YOUR deal** (your view rate, your tiers) are in your contract. You can also see an estimate of your earnings right on each mission in the app.

**How it's tracked**: once your video is live and submitted in the app, we pull its views automatically. Your earnings update as the video racks up views. Nothing for you to calculate — it's all in your space, under Earnings.

**Two simple conditions to get paid:**

- Your video has to follow the content rules (see the Rules & requirements module).
- You have to submit your video link in the app after you publish, so we can track its views.

Add your payout details in your profile as soon as you start earning — otherwise we can't send you what you're owed.

**Getting paid from the US.** Everything is paid in **US dollars**. In your profile, pick **PayPal**, **USDT (crypto)**, or **Other** and tell us how you'd rather be paid. The SEPA option is for European bank accounts — skip it, it won't work with a US bank.`,
  },
  {
    order: 2,
    title: "Setting up your accounts",
    contentMarkdown: `Before you make anything, you need clean accounts on social.

**Step 1 — Create brand-new accounts**

Create fresh accounts on TikTok, Instagram and YouTube (depending on what you're asked for). Start from blank accounts, not an existing personal one.

**Step 2 — Use the right handle (@)**

The exact handle to create on each platform **is shown in the app** (in your space, under "Create these accounts on your socials"). Create that exact handle on every platform, then declare the account in the app. This matters — it's how we track your videos and your views.

**Step 3 — Profile picture & bio**

- Put up a clean profile picture that fits Snytch.
- Mention the site **snytch.co** in your bio on every account.

**Step 4 — Basic settings**

Link an email and a phone number to each account. It makes the account look legit to the platforms and lowers the risk of your reach getting capped.

**Step 5 — Declare your accounts in the app**

Once your accounts exist, declare them in your space. That's what connects your accounts to your missions and tracks your views.

Accounts ready and declared? **Don't post yet.** Head to the warmup module.`,
  },
  {
    // ADAPTÉ — « passe-la en Moi uniquement » cite un LIBELLÉ d'interface. En
    // anglais TikTok l'affiche « Only me », et Instagram n'a pas d'équivalent :
    // on y archive. Traduire le libellé français mot à mot enverrait chercher
    // un réglage qui n'existe pas sous ce nom.
    order: 3,
    title: "Warmup & avoiding shadowbans",
    contentMarkdown: `This is the most important step if you want your videos to be seen. Even with the best videos in the world, if your account isn't warmed up properly the algorithm won't push them. Worse: you can get shadowbanned, and your views stay stuck at zero.

**Applies to every platform (TikTok, Instagram, YouTube).**

**Step 1 — Don't rush it**

Just made your account? Great. Don't post anything yet. For the first 3 days, behave like a normal user: scroll, watch videos all the way through, like, comment, follow a few creators in your niche. That tells the algorithm you're a real person, not a bot.

**Step 2 — Stay in your niche**

Only interact with content close to what you're going to post. If you make content around Instagram / social media tools, watch and engage with that kind of video. It helps the algorithm understand what your account is about and who to show your videos to.

**Step 3 — No spammy behavior**

Don't go following hundreds of people or liking at full speed. That's a red flag. Take it easy: around twenty follows a day max, a reasonable number of likes.

**Step 4 — Set your account up properly**

Link an email and a phone number. A complete account looks more legit and is less likely to get throttled.

**What REALLY matters to break through (the biggest thing right now):**

Warmup keeps you from getting flagged, but it's not what makes your views take off. What unlocks reach today is **retention**:

- **The hook in the first 3 seconds**. The algorithm watches whether people stay past the first few seconds. A weak hook = the video gets tested, then dropped. Obsess over your first 3 seconds above everything else.
- **Completion rate**. Aim for people watching your video all the way through (or rewatching it). That's signal number one. A short video watched to the end beats a long one people bail on halfway.
- **Shares and saves**. They count for more than likes. Give people a reason to save or share your video.

**Also worth knowing:**

- **Be patient**. A new account takes time to earn the algorithm's trust. Your first videos may not get many views — that's normal, especially the first 2-3 weeks. Don't judge too fast.
- **Don't delete videos that flop**. Deleting sends a bad signal and can trip the anti-spam filters. If you want one out of sight, set it to **Only me** on TikTok or **archive** it on Instagram instead of deleting it.
- **Don't let your content look automated or repetitive**. Platforms push mass-produced content less. Add your own spin, vary your hooks.

Once your account is warm: you can start posting your missions.`,
  },
  {
    // ADAPTÉ — le module le plus sensible pour une créatrice US, et le seul
    // rédigé en registre juridique. Deux réalités que le français laisse
    // implicites parce qu'elles vont de soi à Paris, et pas ailleurs : « le
    // mois » est le mois CALENDAIRE (paiement le 10, projects.payoutDay), et
    // toutes les échéances affichées dans l'app sont en heure de Paris —
    // fuseau ÉPINGLÉ côté serveur (i18n/request.ts). Une échéance « vendredi »
    // tombe donc le vendredi matin sur la côte Ouest, pas le vendredi soir.
    //
    // AUCUN CHIFFRE D'ÉCART n'est donné, et c'est délibéré : la France et les
    // États-Unis ne changent pas d'heure aux mêmes dates, donc « 9 heures » est
    // FAUX plusieurs semaines par an. Un décalage écrit en dur dans un texte que
    // personne ne relira deux fois par an est un piège ; « Paris est en avance »
    // reste vrai toute l'année. La phrase qui sert vraiment est la dernière.
    order: 4,
    title: "Creator payment terms",
    contentMarkdown: `**Creator payment terms**

To be paid for their work, all partner creators must meet every commitment set out in their collaboration.

Payment depends on all of the following:

* Delivering every requested post within the agreed deadlines.
* Following the briefs, formats, content requirements and publication dates communicated for the campaign.
* Getting content approved in advance by the site's managers, owners or founders before anything goes live.
* Completing all planned placements across the entire month in question.

Monthly payments are made only after the work planned for that month has been confirmed as fully delivered. In the event of a delay, a post that was not published, content that does not conform, or any failure to meet the agreed commitments, payment may be held until the situation is resolved.

Final approval of the work delivered is at the sole discretion of the site's managers, owners and founders.

**Two notes on timing.** "Month" means the calendar month, and payouts go out on the 10th. Deadlines and publication dates shown in the app are in **Paris time**, which runs ahead of every US time zone. In practice: a post due "Friday" is due at the end of Friday in Paris — so plan on your morning, not your evening.`,
  },
  {
    order: 5,
    title: "Posting rules & requirements",
    contentMarkdown: `Here are the rules your videos have to follow to get approved and paid. **If you don't follow them, you don't get paid.**

**Content:**

- Every video **has to tag the Snytch account** on the matching platform, wherever the script says so.
- You have to **mention Snytch in your bio** on the account you post from.
- **Minimum length: 10 seconds** per video.

**Quality:**

- Your videos have to follow the brief and the script provided in each mission.
- No cheating: views and engagement must never be boosted artificially (bots are banned, and we catch them :)).

**Submitting:**

- Once your video is live, submit its link in the app (in the matching mission) so we can track its views. Do it soon after you publish.

**Follow these and you're golden.** We're in this together: you make good content, you get paid for your views. Question? Just ask — we're around 24/7!`,
  },
];

/** Les deux jeux, par slug de projet — la migration n'en connaît pas d'autre. */
export const GUIDE_MODULES_EN: Record<string, GuideModuleSeed[]> = {
  repackit: REPACKIT_EN,
  snytch: SNYTCH_EN,
};
