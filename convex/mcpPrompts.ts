/**
 * PROMPTS MCP — des flux de travail tout prêts, que claude.ai propose directement
 * (« + › Jarvia › Planifier la semaine »). Module PUR, testé par Vitest
 * (lib/mcp-prompts.test.ts).
 *
 * Un prompt ne fait rien par lui-même : il rend le message qui dit à Claude
 * QUELS outils appeler, dans quel ordre, ce qu'il doit rendre, et où il doit
 * s'arrêter pour demander l'accord. Le savoir-faire vit ici, une fois, au lieu de
 * dépendre de la façon dont chacun formule sa demande.
 *
 * Chaque prompt s'ADAPTE aux domaines que la connexion peut modifier : sans
 * « Missions », `planifier_semaine` s'arrête au plan au lieu de proposer
 * d'assigner — jamais un appel d'outil que Claude ne verra pas dans sa liste.
 */

import { ToolError } from "./mcpProtocol";

export interface McpPromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpPrompt {
  name: string;
  title: string;
  description: string;
  arguments: readonly McpPromptArgument[];
}

export interface PromptResult {
  description: string;
  messages: { role: "user"; content: { type: "text"; text: string } }[];
}

export interface PromptsServeur {
  liste: readonly McpPrompt[];
  /** `null` = prompt inconnu ; un argument illisible lève une ToolError. */
  obtenir(name: string, args: Record<string, string>): PromptResult | null;
}

const ARG_PROJET: McpPromptArgument = {
  name: "projet",
  description: "Slug ou nom du projet (facultatif si un seul projet).",
};

export const PROMPTS: readonly McpPrompt[] = [
  {
    name: "preparer_propositions",
    title: "Préparer les propositions du jour",
    description: "Pour une routine, sans personne pour valider : fait le point et dépose des PROPOSITIONS (rien n'est écrit) que l'équipe applique ou écarte d'un clic dans Jarvia.",
    arguments: [ARG_PROJET, { name: "nombre", description: "Propositions au plus (défaut : 8)." }],
  },
  {
    name: "point_du_jour",
    title: "Point du jour",
    description: "Ce qui doit se passer aujourd'hui : posts à sortir, manqués, vidéos à relire, paiements dus — en actions classées.",
    arguments: [ARG_PROJET],
  },
  {
    name: "revue_validation",
    title: "Relire la file Validation",
    description: "Regarde les vidéos soumises (images clés), les compare au script et à la consigne, et propose valider ou refuser avec un motif.",
    arguments: [
      ARG_PROJET,
      { name: "createatrice", description: "Seulement ses vidéos (défaut : toute la file)." },
      { name: "nombre", description: "Vidéos à regarder au plus (défaut : 5)." },
    ],
  },
  {
    name: "planifier_semaine",
    title: "Planifier la semaine",
    description: "Repère les jours sans mission de chaque créatrice active et propose le planning de la semaine, scripts simulés à l'appui.",
    arguments: [
      ARG_PROJET,
      { name: "semaine", description: "Un jour de la semaine visée, AAAA-MM-JJ (défaut : la semaine prochaine)." },
      { name: "campagne", description: "Campagne à utiliser (défaut : celle(s) que les verdicts poussent)." },
      { name: "createatrices", description: "Seulement ces créatrices, séparées par des virgules (défaut : toutes les actives)." },
    ],
  },
  {
    name: "bilan_du_mois",
    title: "Bilan du mois",
    description: "Argent, contenu, équipe, clients : les chiffres du mois, ce qui a marché ou raté, et 3 décisions chiffrées pour le suivant.",
    arguments: [ARG_PROJET, { name: "mois", description: "Mois, AAAA-MM (défaut : le mois dernier)." }],
  },
  {
    name: "labo_hooks",
    title: "Labo de hooks",
    description: "Lit les verdicts d'une campagne et les tendances, écrit de nouveaux hooks, propose graduations et coupes.",
    arguments: [
      ARG_PROJET,
      { name: "campagne", description: "Nom de la campagne.", required: true },
      { name: "pays", description: "Pays des tendances à lire, code ISO (défaut : FR)." },
      { name: "nombre", description: "Nombre de hooks à écrire (défaut : 10)." },
    ],
  },
  {
    name: "nouvelle_campagne",
    title: "Monter une nouvelle campagne",
    description: "Des meilleurs posts et de la veille à une campagne complète (hooks, flux, cta), créée désactivée pour relecture.",
    arguments: [
      ARG_PROJET,
      { name: "sujet", description: "Le thème ou l'angle de la campagne (facultatif)." },
      { name: "pays", description: "Pays des tendances à lire, code ISO (défaut : FR)." },
      { name: "hooks", description: "Nombre de hooks à écrire (défaut : 8)." },
    ],
  },
  {
    name: "rejouer_gagnants",
    title: "Rejouer les gagnants",
    description: "Les meilleurs posts récents, pourquoi ils ont marché, et chez quelles autres créatrices les rejouer.",
    arguments: [
      ARG_PROJET,
      { name: "jours", description: "Fenêtre de publication en jours (défaut : 30)." },
      { name: "nombre", description: "Nombre de posts à rejouer (défaut : 5)." },
    ],
  },
];

// ─── Dates (jours de Paris, en texte AAAA-MM-JJ) ────────────────────────────

const JOUR_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Le jour décalé de `n` jours (arithmétique de calendrier, sans fuseau). */
export function decaler(jour: string, n: number): string {
  const [y, m, d] = jour.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Le lundi de la semaine d'un jour. */
export function lundiDe(jour: string): string {
  const [y, m, d] = jour.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
  return decaler(jour, dow === 0 ? -6 : 1 - dow);
}

/** Le mois précédent, AAAA-MM. */
export function moisPrecedent(jour: string): string {
  const [y, m] = jour.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Premier et dernier jour d'un mois AAAA-MM. */
export function bornesDuMois(mois: string): { du: string; au: string } {
  const [y, m] = mois.split("-").map(Number);
  const au = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { du: `${mois}-01`, au };
}

function jourValide(x: string): boolean {
  if (!JOUR_RE.test(x)) return false;
  const [y, m, d] = x.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function entier(x: string | undefined, nom: string, defaut: number, min: number, max: number): number {
  if (x === undefined || x.trim() === "") return defaut;
  const n = Number(x.trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new ToolError(`« ${nom} » : un nombre entier entre ${min} et ${max}.`);
  return n;
}

// ─── Les messages ───────────────────────────────────────────────────────────

/** « pour le projet X » — ou la consigne de demander quand il y en a plusieurs. */
const projetDe = (args: Record<string, string>) =>
  args.projet?.trim()
    ? `Projet : « ${args.projet.trim()} » (passe-le en argument \`projet\` à chaque outil).`
    : "Projet : si plusieurs sont accessibles (outil `projets`), demande-moi lequel avant de commencer.";

const REGLES =
  "Règles : n'invente aucun chiffre — chaque nombre vient d'un outil, et une donnée absente ou partielle se dit comme telle. Les jours sont des jours de Paris. Ne modifie rien sans mon accord explicite, donné APRÈS que tu m'as montré exactement ce qui va changer.";

function message(description: string, lignes: (string | false)[]): PromptResult {
  return {
    description,
    messages: [{ role: "user", content: { type: "text", text: lignes.filter((l): l is string => l !== false).join("\n") } }],
  };
}

/**
 * Les prompts du serveur pour UNE connexion. `ecrit` = les domaines qu'elle peut
 * modifier ; `aujourdhui` = le jour de Paris (défauts des dates).
 */
export function promptsJarvia(ecrit: readonly string[], aujourdhui: string): PromptsServeur {
  const missions = ecrit.includes("missions");
  const scripts = ecrit.includes("scripts");
  const publications = ecrit.includes("publications");
  const veille = ecrit.includes("veille");

  function obtenir(name: string, args: Record<string, string>): PromptResult | null {
    const p = PROMPTS.find((x) => x.name === name);
    if (!p) return null;

    if (name === "preparer_propositions") {
      const nombre = entier(args.nombre, "nombre", 8, 1, 20);
      const lot = `Routine du ${aujourdhui.split("-").reverse().join("/")}`;
      return message(p.description, [
        `Tu tournes SEUL, sans personne pour valider : tu ne modifies RIEN toi-même, même si un outil d'écriture est dans ta liste. Chaque action utile devient une proposition : \`proposer\` avec l'outil d'écriture qui serait appelé, SES arguments exacts, un résumé d'une ligne (quoi, pour qui) et le pourquoi chiffré. Au plus ${nombre}, les plus utiles d'abord, toutes avec lot: « ${lot} ».`,
        projetDe(args),
        "1. `propositions` : ce qui attend déjà et ce qui a été écarté — ne repropose ni l'un ni l'autre (un écart est une décision).",
        "2. État : `dashboard`, `planning` (jours: 7), `validation`, `ponctualite` (7 derniers jours), et les verdicts `scripts` des campagnes actives.",
        "3. Candidats, dans cet ordre : un post manqué → replanifier_mission OU relancer (jamais les deux) ; une vidéo à valider pour demain → `regarder_video`, puis valider_video, ou refuser_video avec un motif concret, SEULEMENT si les images le justifient clairement ; une créatrice active sans mission dans les 7 jours → assigner_scripts ; un hook « à couper » → activer_briques (actif: false).",
        "4. Désigne tout comme les outils de lecture te l'ont montré (créatrice + jour prévu, lien, libellé). Une proposition mal désignée sera refusée à l'application : mieux vaut en faire moins, mais justes.",
        "5. Termine par un compte rendu court : ce que tu as proposé, ce que tu as laissé de côté et pourquoi.",
        "Règles : n'invente aucun chiffre — chaque nombre vient d'un outil. Les jours sont des jours de Paris.",
      ]);
    }

    if (name === "point_du_jour") {
      return message(p.description, [
        `Fais le point du ${aujourdhui}.`,
        projetDe(args),
        "1. `dashboard` : décisions et alertes de l'accueil.",
        "2. `planning` (jours: 2) : ce qui doit sortir aujourd'hui et n'est pas publié, les posts manqués, demain.",
        "3. `validation` : la file à relire, en commençant par ce qui doit être validé pour demain.",
        "4. `paiements` : ce qui est dû et à qui.",
        "Rends au plus 7 actions, classées par urgence, chacune en une ligne : quoi, qui, pourquoi maintenant (le chiffre ou le statut qui le dit).",
        publications &&
          "Pour une créatrice qui t'envoie le lien d'un post publié, propose l'appel `confirmer_publication` exact (créatrice, jour prévu, lien).",
        missions &&
          "Pour un post manqué, propose soit `replanifier_mission` (nouveau jour), soit `annuler_mission` — jamais les deux sans me demander.",
        REGLES,
      ]);
    }

    if (name === "revue_validation") {
      const nombre = entier(args.nombre, "nombre", 5, 1, 15);
      const qui = args.createatrice?.trim();
      return message(p.description, [
        `Relis la file Validation${qui ? ` de ${qui}` : ""} : ${nombre} vidéo(s) au plus, en commençant par celles qui doivent être validées pour demain.`,
        projetDe(args),
        `1. \`validation\`${qui ? ` (createatrice: « ${qui} »)` : ""} : la file à relire, dans son ordre.`,
        "2. Pour chaque vidéo : `regarder_video` (créatrice + jour prévu) — si la transcription vient d'être lancée, rappelle-le une minute plus tard. Compare ce qui SE VOIT (texte incrusté présent, lisible, conforme ; cadrage vertical ; la fin) et ce qui SE DIT : `ditAuDebut` contre `hookAttendu`, `ditALaFin` contre `ctaAttendu` — l'idée, pas le mot à mot (la transcription est approximative).",
        "3. Rends un tableau : vidéo → verdict proposé (valider / refuser / à regarder par un humain) → la raison, avec l'instant de l'image qui la montre. Dans le doute, « à regarder par un humain », pas « valider ».",
        publications
          ? "4. Pour chaque refus, rédige le motif adressé à la créatrice (tutoiement, concret : ce qui ne va pas et quoi refaire). Attends mon accord vidéo par vidéo, puis `valider_video` / `refuser_video` — rappelle avant que chacun envoie un email à la créatrice."
          : "4. Cette connexion ne peut ni valider ni refuser : termine par le tableau et les motifs proposés, la décision se prend dans l'écran Validation (ou allume « Publications » dans Jarvia › Connecter Claude).",
        REGLES,
      ]);
    }

    if (name === "planifier_semaine") {
      const semaine = args.semaine?.trim() || decaler(lundiDe(aujourdhui), 7);
      if (!jourValide(semaine)) throw new ToolError("« semaine » : un jour AAAA-MM-JJ.");
      const lundi = lundiDe(semaine);
      const dimanche = decaler(lundi, 6);
      const quatreSemaines = { du: decaler(aujourdhui, -28), au: decaler(aujourdhui, -1) };
      const qui = args.createatrices?.trim();
      return message(p.description, [
        `Prépare le planning de publication de la semaine du ${lundi} au ${dimanche}.`,
        projetDe(args),
        qui ? `Seulement ces créatrices : ${qui}.` : "Toutes les créatrices actives (outil `createatrices`).",
        "1. État : `planning` (jours: 14) pour ce qui est déjà prévu cette semaine-là et les posts manqués ; " +
          `\`ponctualite\` du ${quatreSemaines.du} au ${quatreSemaines.au} pour le rythme et la fiabilité de chacune.`,
        args.campagne?.trim()
          ? `2. Campagne : « ${args.campagne.trim()} » — lis ses verdicts avec \`scripts\`.`
          : "2. Campagnes : `scripts` sans argument pour la liste, puis les campagnes actives — garde celles dont les hooks à pousser l'emportent.",
        "3. Trous : pour chaque créatrice, les jours de la semaine sans mission. Son rythme = posts prévus sur les 4 dernières semaines ÷ 4 : dis-le, ne l'invente pas. Une créatrice sous 50 % à l'heure est programmée avec un avertissement, pas en silence.",
        "4. Propose un tableau créatrice × jour (campagne, compte, plage horaire si elle en a l'habitude). Rien n'est écrit à ce stade.",
        missions
          ? "5. Pour chaque créatrice retenue, appelle `assigner_scripts` avec `simuler: true` et montre les scripts tirés. Signale une campagne à court de scripts."
          : "5. Cette connexion ne peut pas assigner : termine par le plan, prêt à saisir dans Assignments, ou dépose chaque ligne avec `proposer` pour que l'équipe l'applique d'un clic (ou allume « Missions » pour elle dans Jarvia › Connecter Claude).",
        missions &&
          "6. Attends mon accord, en bloc ou créatrice par créatrice. Rappelle AVANT que chaque créatrice assignée reçoit un email. Puis assigne (`assigner_scripts` sans `simuler`, avec `exclure` pour les scripts que j'écarte) et rends ce que la réponse dit avoir créé.",
        REGLES,
      ]);
    }

    if (name === "bilan_du_mois") {
      const mois = args.mois?.trim() || moisPrecedent(aujourdhui);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) throw new ToolError("« mois » : AAAA-MM (ex. 2026-09).");
      const { du, au } = bornesDuMois(mois);
      return message(p.description, [
        `Fais le bilan de ${mois} (du ${du} au ${au}).`,
        projetDe(args),
        `1. Argent : \`rentabilite\` (mois: ${mois}), \`compta\` (mois: ${mois}), \`revenus\` et \`economie_unitaire\` (du/au, comparer: true).`,
        `2. Contenu : \`vues\` (du/au, comparer: true), \`meilleurs_posts\` (du/au, limite: 10) puis les 5 pires (ordre: pires), et les verdicts \`scripts\` des campagnes actives.`,
        `3. Équipe : \`ponctualite\` (du/au) et \`paiements\`.`,
        `4. Clients : \`retention\` (cohorte du/au) et \`marches\` (du/au).`,
        "Rends : 5 chiffres clés avec leur évolution ; ce qui a marché et ce qui a raté (posts, hooks, créatrices, marchés), chaque fois avec le chiffre ; puis 3 décisions pour le mois suivant, chacune justifiée par un chiffre du bilan.",
        "Les « clients » ne comptent pas la même population d'un outil à l'autre (voir les instructions du serveur) : ne les additionne ni ne les compare sans le dire. Si le mois n'est pas terminé, dis-le en tête.",
        REGLES,
      ]);
    }

    if (name === "labo_hooks") {
      const campagne = args.campagne?.trim();
      if (!campagne) throw new ToolError("« campagne » : le nom de la campagne.");
      const pays = (args.pays?.trim() || "FR").toUpperCase();
      if (!/^[A-Z]{2}$/.test(pays)) throw new ToolError("« pays » : un code ISO à 2 lettres (ex. FR, US).");
      const nombre = entier(args.nombre, "nombre", 10, 1, 20);
      return message(p.description, [
        `Labo de hooks pour la campagne « ${campagne} ».`,
        projetDe(args),
        `1. \`scripts\` (campagne: « ${campagne} ») : les hooks à pousser, à couper, en test, et les signaux forts.`,
        `2. \`meilleurs_posts\` (campagne: « ${campagne} », 30 derniers jours) et \`veille\` (vue: tendances, pays: ${pays}) : ce qui accroche en ce moment.`,
        `3. Écris ${nombre} nouveaux hooks : une phrase chacun, dite face caméra, dans le ton des meilleurs, sans chiffre ni promesse inventés. Pour chacun, la raison en une ligne : le hook gagnant ou la tendance qu'il décline.`,
        "4. Propose aussi : les hooks à couper (verdict « à couper ») et, si cette campagne est un labo, ceux à graduer (« à pousser », jugés sur assez de posts).",
        scripts
          ? "5. Attends mon accord, puis : `ajouter_hooks` (ils sont créés DÉSACTIVÉS — dis-le), `activer_briques` pour couper, `graduer_hook` pour graduer. Rends ce que chaque réponse dit avoir fait."
          : "5. Cette connexion ne peut pas modifier les scripts : rends les hooks prêts à coller dans l'écran de la campagne, ou dépose-les avec `proposer` (ou allume « Scripts » dans Jarvia › Connecter Claude).",
        REGLES,
      ]);
    }

    if (name === "nouvelle_campagne") {
      const pays = (args.pays?.trim() || "FR").toUpperCase();
      if (!/^[A-Z]{2}$/.test(pays)) throw new ToolError("« pays » : un code ISO à 2 lettres (ex. FR, US).");
      const hooks = entier(args.hooks, "hooks", 8, 3, 20);
      const sujet = args.sujet?.trim();
      return message(p.description, [
        `Monte une nouvelle campagne de scripts${sujet ? ` sur « ${sujet} »` : ""}.`,
        projetDe(args),
        "1. Ce qui marche chez nous : `meilleurs_posts` (30 derniers jours, limite: 15) et les verdicts `scripts` des campagnes actives — quels hooks, flux et cta portent les vues.",
        `2. Ce qui marche dehors : \`veille\` (vue: tendances, pays: ${pays}) et (vue: videos) pour les comptes suivis les plus pertinents.`,
        `3. Écris ${hooks} hooks, 3 flux et 3 cta, dans le ton des meilleurs posts, sans chiffre ni promesse inventés ; pour chacun, une ligne : ce qu'il reprend (post gagnant ou tendance). Propose un nom de campagne qui ne reprend pas celui d'une campagne existante.`,
        scripts
          ? "4. Attends mon accord sur les textes et le nom, puis `creer_campagne` : tout y est créé DÉSACTIVÉ — dis-le, et rappelle qu'il faut activer au moins un hook, un flux et un cta (`activer_briques`) pour qu'un script se tire."
          : "4. Cette connexion ne peut pas créer de campagne : rends le nom et les textes prêts à coller dans l'écran Scripts (ou allume « Scripts » dans Jarvia › Connecter Claude).",
        veille &&
          "5. Propose 2 ou 3 vidéos de la veille à garder comme exemples (`ajouter_inspiration`, après accord) : elles se joindront aux missions comme « vidéos exemples ».",
        REGLES,
      ]);
    }

    if (name === "rejouer_gagnants") {
      const jours = entier(args.jours, "jours", 30, 7, 90);
      const nombre = entier(args.nombre, "nombre", 5, 1, 10);
      return message(p.description, [
        `Rejoue les ${nombre} meilleurs posts des ${jours} derniers jours.`,
        projetDe(args),
        `1. \`meilleurs_posts\` (du: ${decaler(aujourdhui, -jours)}, limite: ${nombre}, chauffe exclue) : pour chacun, pourquoi il a marché — hook, créatrice, compte, pays, vues par rapport aux autres posts de sa campagne.`,
        "2. `createatrices` et `planning` (jours: 14) : pour chaque post, 1 ou 2 autres créatrices actives, d'un pays cohérent avec le post, et un jour libre chez elles.",
        "3. Propose le tableau post → créatrice(s) → jour, en disant pour chacun si le texte d'origine doit être rejoué à l'identique (une brique a changé depuis) ou depuis les briques actuelles.",
        missions
          ? "4. Simule chaque rejeu (`rejouer_script` avec `simuler: true`), attends mon accord, rappelle que chaque créatrice reçoit un email, puis rejoue et rends ce qui a été créé."
          : "4. Cette connexion ne peut pas assigner : termine par le tableau, prêt à saisir avec « Rejouer ce script » (ou allume « Missions » dans Jarvia › Connecter Claude).",
        REGLES,
      ]);
    }
    return null;
  }

  return { liste: PROMPTS, obtenir };
}
