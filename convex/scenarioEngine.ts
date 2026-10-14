/**
 * MOTEUR DE SCÉNARIOS — bible + prénom de la créatrice → export WhatsApp iOS.
 *
 * Portage LIGNE À LIGNE de `docs/scenarios/reference/moteur.py`, le moteur testé
 * sur askblush.com. Avec le hasard compatible Python (convex/pyRandom.ts), il
 * rend le MÊME fichier que le Python, octet pour octet : c'est la preuve que le
 * portage n'a rien changé (lib/scenario-engine.test.ts compare à
 * `docs/scenarios/samples/`).
 *
 * Principe (cf docs/scenarios/PROMPT.md) :
 *  - la bible porte ce qui est unique au scénario ; le moteur fournit le
 *    remplissage banal d'un couple (mini-dialogues cohérents, pondérés selon la
 *    période), le timing et le format ;
 *  - L = la créatrice (prénom injecté), Y = lui (prénom de la bible) ;
 *  - déterminisme : graine « {id}-{prénom}-{graine} » ;
 *  - les munitions, la dernière semaine et l'écran choc sont posés à leurs
 *    dates ; tout dialogue de remplissage qui les chevauche (±20 min) saute en
 *    entier ; rien le dernier jour ; pas de répétition dans les 15 derniers jours.
 *
 * AJOUT par rapport au Python — `finLe` (option A, décision du 13/10/2026) :
 * BLUSH compare les messages au jour de l'IMPORT. Toute la conv glisse d'un
 * même nombre de jours pour finir le jour voulu (le téléchargement). Le contenu
 * ne change pas ; les dates fêtées (Noël, Saint-Valentin) glissent avec.
 *
 * Les heures sont « naïves », comme dans un export : des microsecondes depuis le
 * 01/01/1970, sans fuseau — aucun changement d'heure ne peut décaler un message.
 *
 * Module PUR (aucun import `_generated`).
 */
import { PyRandom, timedeltaUs } from "./pyRandom";
import type { Bible, Locuteur, TypeScenario } from "./scenarioBible";
import donnees from "./scenarioRemplissage.json";

const LRM = "‎";
/** Format export iOS FR. « ‎audio omis » est bien lu comme vocal par BLUSH (blush-prompts/lib/conv.ts). */
const MARQUEURS: Record<string, string> = {
  "[image]": `${LRM}image absente`,
  // i18n-exempt: format d'un export WhatsApp iOS FR (donnée importée dans BLUSH), pas un libellé de Jarvia
  "[supprimé]": `${LRM}Ce message a été supprimé.`,
  "[vocal]": `${LRM}audio omis`,
};
// i18n-exempt: format d'un export WhatsApp iOS FR (donnée importée dans BLUSH), pas un libellé de Jarvia
const LIGNE_CHIFFREMENT = `${LRM}Les messages et les appels sont chiffrés de bout en bout. Personne en dehors de cette discussion, pas même WhatsApp, ne peut les lire ou les écouter.`;

type Creneau = "morning" | "day" | "evening" | "night" | "any";
type LigneDialogue = [Locuteur | "P", string];
type Dialogue = {
  creneau: Creneau;
  poidsAvant: number;
  poidsApres: number;
  lignes: LigneDialogue[];
  /** Réservé à certains types de relation (cf RESERVE) ; absent = tout le monde. */
  reserve?: keyof typeof RESERVE;
};

/**
 * Le remplissage est celui d'un COUPLE (moteur Python). Les dialogues amoureux
 * sont marqués : « je t'aime » ne se dit qu'en couple installé (ou avec un
 * ex) ; « tu me manques », « tu viens dormir ? » restent aux relations
 * amoureuses. Un meilleur ami, une famille, un groupe ne les tirent pas. Pour
 * un couple, rien ne change : le tirage reste celui du Python, octet pour octet.
 */
const RESERVE = {
  amour: ["couple", "ex"],
  romance: ["couple", "ex", "talking_stage"],
} satisfies Record<string, readonly TypeScenario[]>;

const REMPLISSAGE = donnees.remplissage as Record<string, string[]>;
const DIALOGUES = donnees.dialogues as Dialogue[];
const CRENEAUX_POIDS = donnees.creneauxPoids as Array<[Creneau, number]>;
const CRENEAUX = donnees.creneaux as Record<Creneau, [number, number]>;
const MOTS_VIDES = new Set(donnees.motsVides);

/** Échanges froids : jamais pendant la lune de miel. */
const FROIDS = new Set(DIALOGUES.flatMap((x, i) => (x.poidsApres >= 3 && x.poidsAvant <= 1 ? [i] : [])));
/** « tu m'en veux ? » est réservé à la dernière semaine de la bible. */
const TU_MEN_VEUX = new Set(DIALOGUES.flatMap((x, i) => (x.lignes[0]![1] === "tu m'en veux ?" ? [i] : [])));

// ─── Temps naïf, en microsecondes ────────────────────────────────────────────

const US_S = 1_000_000;
const US_MIN = 60 * US_S;
const US_H = 60 * US_MIN;
const US_JOUR = 24 * US_H;

/** « AAAA-MM-JJ » → numéro de jour depuis le 01/01/1970. */
function jourDe(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}
const debutDuJour = (jour: number) => jour * US_JOUR;
const jourDeUs = (us: number) => Math.floor(us / US_JOUR);
const heureDeUs = (us: number) => Math.floor((us - jourDeUs(us) * US_JOUR) / US_H);
/** Lundi = 0, comme `date.weekday()` (le 01/01/1970 était un jeudi). */
const jourSemaine = (jour: number) => (((jour + 3) % 7) + 7) % 7;

function horodatageUs(s: string): number {
  const [jour, heure] = s.split(" ");
  const [h, mi, se] = heure!.split(":").map(Number);
  return debutDuJour(jourDe(jour!)) + h! * US_H + mi! * US_MIN + (se ?? 0) * US_S;
}

const p2 = (n: number) => String(n).padStart(2, "0");
/** « [JJ/MM/AAAA HH:MM:SS] » — les microsecondes sont tronquées, comme `strftime`. */
function crochets(us: number): string {
  const t = new Date(Math.floor(us / 1000));
  return (
    `[${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ` +
    `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}]`
  );
}
/** « AAAA-MM-JJ » d'un numéro de jour. */
function isoJour(jour: number): string {
  const t = new Date(jour * 86_400_000);
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

// ─── Génération ──────────────────────────────────────────────────────────────

type MessageGen = { t: number; qui: Locuteur; texte: string; did: number };
export type MessageConv = { t: number; qui: Locuteur; texte: string };

export type OptionsGeneration = {
  /** Prénom de la créatrice, tel qu'il apparaîtra dans l'export. */
  prenom: string;
  /** Graine (le Python : `--seed`, défaut 7). */
  graine?: number;
  /** Jour de fin voulu, « AAAA-MM-JJ » (option A) ; absent = dates de la bible. */
  finLe?: string;
};

export type Generation = {
  /** L'export, tel que la créatrice l'importe. */
  texte: string;
  nomFichier: string;
  /** Nom du zip iOS ; il contient `_chat.txt`. */
  nomZip: string;
  /** Les messages, dates déjà glissées (sans la ligne de chiffrement). */
  messages: MessageConv[];
  /** Jours ajoutés aux dates de la bible (0 = dates de la bible). */
  decalageJours: number;
  noms: { L: string; Y: string };
};

export function genererConversation(bible: Bible, options: OptionsGeneration): Generation {
  const graine = options.graine ?? 7;
  const R = new PyRandom(`${bible.id}-${options.prenom}-${graine}`);
  const NOM = { L: options.prenom, Y: bible.lui };
  const D0 = jourDe(bible.dates.debut);
  const D1 = jourDe(bible.dates.fin);
  const LUNE = jourDe(bible.dates.lune_de_miel_fin);
  const TOURNANT = jourDe(bible.dates.tournant);
  const RECORD = jourDe(bible.dates.record);
  const RY = bible.rythme;

  // Un pote tiré au hasard ne porte jamais le prénom de l'un des deux (« Mehdi:
  // Mehdi fait un anniv samedi », « je suis chez Inès » écrit par Inès). Sans
  // collision, la liste est celle du Python : C2 reste identique à l'octet.
  const echapper = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nomsDesDeux = [NOM.L, NOM.Y]
    .map((n) => n.trim())
    .filter((n) => n !== "")
    .map((n) => new RegExp(`(^|[^\\p{L}])${echapper(n)}($|[^\\p{L}])`, "iu"));
  const portentUnNom = (option: string) => nomsDesDeux.some((re) => re.test(option));
  const OPTIONS: Record<string, string[]> = Object.fromEntries(
    Object.entries(REMPLISSAGE).map(([k, liste]) => {
      const sans = liste.filter((o) => !portentUnNom(o));
      return [k, sans.length > 0 ? sans : liste];
    }),
  );
  const remplir = (t: string) =>
    t.replace(/\{(\w+)\}/g, (_, k: string) => R.choice(OPTIONS[k]!));

  const lognorm = (med: number, s: number) => med * Math.exp(R.gauss(0, s));

  function lui_mediane_s(d: number, t: number): number {
    const m = RY.lui_reponse_min;
    const h = heureDeUs(t);
    if (h >= 23 || h < 3) return m.nuit * 60;
    if (d === RECORD) return m.record * 60;
    if (d < LUNE) return m.lune_de_miel * 60;
    return (d < TOURNANT ? m.avant : m.apres) * 60;
  }

  function delai_s(prev: Locuteur, qui: Locuteur, t: number, d: number): number {
    if (qui === prev) return R.uniform(3, 45);
    if (qui === "L") return Math.min(lognorm(RY.elle_reponse_s * (d === RECORD ? 0.4 : 1), 1.0), 4 * 3600);
    return Math.min(lognorm(lui_mediane_s(d, t), 0.7), 2.8 * 3600);
  }

  // Les dialogues que CE type de relation peut tenir (cf RESERVE).
  const permis = (x: Dialogue) =>
    x.reserve === undefined || (RESERVE[x.reserve] as readonly string[]).includes(bible.type);
  function choisir(creneau: Creneau, init: Locuteur, d: number, bannis: Set<number>): number {
    const apres = d >= TOURNANT;
    let idx = DIALOGUES.flatMap((x, i) =>
      (x.creneau === creneau || x.creneau === "any") && x.lignes[0]![0] === init && !bannis.has(i) && permis(x)
        ? [i]
        : [],
    );
    let w = idx.map((i) =>
      apres ? DIALOGUES[i]!.poidsApres : d < LUNE && FROIDS.has(i) ? 0 : DIALOGUES[i]!.poidsAvant,
    );
    if (w.reduce((a, b) => a + b, 0) === 0) {
      idx = DIALOGUES.flatMap((x, i) => (x.lignes[0]![0] === init && !bannis.has(i) && permis(x) ? [i] : []));
      if (idx.length === 0) idx = DIALOGUES.flatMap((x, i) => (permis(x) ? [i] : []));
      w = idx.map(() => 1);
    }
    return R.weightedChoice(idx, w);
  }

  let did = 0;
  function dialoguer(debut: number, lignes: LigneDialogue[], d: number): MessageGen[] {
    let t = debut;
    let prev: Locuteur | null = null;
    const out: MessageGen[] = [];
    did += 1;
    for (const [qui, texte] of lignes) {
      if (qui === "P") {
        t += timedeltaUs({ minutes: R.uniform(35, 50) });
        continue;
      }
      if (prev) t += timedeltaUs({ seconds: delai_s(prev, qui, t, d) });
      out.push({ t, qui, texte: remplir(texte), did });
      prev = qui;
    }
    return out;
  }

  const finUtilises = new Set<number>();
  function journee(d: number): MessageGen[] {
    const dpj = RY.dialogues_par_jour;
    let n: number;
    if (d === RECORD) n = dpj.record;
    else {
      const [lo, hi] = d < LUNE ? dpj.lune_de_miel : d < TOURNANT ? dpj.avant : dpj.apres;
      n = R.randint(lo, hi) + (jourSemaine(d) >= 5 ? R.choice([0, 1]) : 0);
    }
    const fin = D1 - d <= 15;
    const plans: Array<{ debut: number; lignes: LigneDialogue[] }> = [];
    for (let k = 0; k < n; k++) {
      const creneau = R.weightedChoice(
        CRENEAUX_POIDS.map(([c]) => c),
        CRENEAUX_POIDS.map(([, p]) => p),
      );
      const pElle = RY.elle_lance[d >= TOURNANT ? "apres" : "avant"];
      const init: Locuteur = R.random() < pElle ? "L" : "Y";
      const bannis = fin ? new Set([...finUtilises, ...TU_MEN_VEUX]) : new Set<number>();
      const i = choisir(creneau, init, d, bannis);
      if (fin) finUtilises.add(i);
      const dlg = DIALOGUES[i]!;
      const [lo, hi] = d === RECORD ? [480, 600] : CRENEAUX[dlg.creneau !== "any" ? dlg.creneau : creneau];
      const minutes = R.uniform(lo, hi);
      const secondes = R.uniform(0, 59);
      plans.push({ debut: debutDuJour(d) + timedeltaUs({ minutes, seconds: secondes }), lignes: dlg.lignes });
    }
    const mav = bible.mot_a_vous;
    if (d >= jourDe(mav.debut) && R.random() < mav.proba_par_jour) {
      const lignes = R.choice(mav.dialogues).map((l) => [l[0], l[1]] as LigneDialogue);
      const [lo, hi] = CRENEAUX.evening;
      plans.push({ debut: debutDuJour(d) + timedeltaUs({ minutes: R.uniform(lo, hi) }), lignes });
    }
    plans.sort((a, b) => a.debut - b.debut);
    const msgs: MessageGen[] = [];
    let curseur: number | null = null;
    const limite = debutDuJour(d + 1) + 3 * US_H;
    for (const plan of plans) {
      let debut = plan.debut;
      if (curseur !== null && debut < curseur) {
        debut = curseur + timedeltaUs({ minutes: d === RECORD ? R.uniform(1, 4) : R.uniform(5, 60) });
      }
      const out = dialoguer(debut, plan.lignes, d);
      if (out.length === 0 || out[out.length - 1]!.t > limite) continue;
      msgs.push(...out);
      curseur = out[out.length - 1]!.t;
    }
    return msgs;
  }

  function blocs(cle: "munitions" | "derniere_semaine") {
    return bible[cle].map((b) => {
      const bl: MessageConv[] = [];
      for (const [s, qui, texte] of b) {
        const exact = s.split(":").length - 1 === 2;
        let t = horodatageUs(s) + (exact ? 0 : R.randint(0, 59) * US_S);
        const last = bl[bl.length - 1];
        if (last && t <= last.t) t = last.t + R.randint(4, 20) * US_S;
        bl.push({ t, qui, texte });
      }
      return bl;
    });
  }

  // --- Génération
  let remplissage: MessageGen[] = [];
  for (let d = D0 + 1; d <= D1; d++) remplissage.push(...journee(d));

  // Vocaux omis, glissés juste après certains messages.
  const voc = bible.vocaux;
  const extra: MessageGen[] = [];
  for (const m of remplissage) {
    const h = heureDeUs(m.t);
    const nuit = h >= 23 || h < 3;
    const p = m.qui === "Y" && nuit ? voc.Y_nuit : voc[m.qui];
    if (R.random() < p) {
      extra.push({ t: m.t + timedeltaUs({ seconds: R.uniform(5, 40) }), qui: m.qui, texte: "[vocal]", did: m.did });
    }
  }
  remplissage = [...remplissage, ...extra];

  const ecran: MessageConv[] = bible.ecran_choc.map(([s, qui, texte]) => ({ t: horodatageUs(s), qui, texte }));
  const plantes = [...blocs("munitions"), ...blocs("derniere_semaine"), ecran];
  const fenetres = plantes.map((b) => [b[0]!.t - 20 * US_MIN, b[b.length - 1]!.t + 20 * US_MIN] as const);
  const exclus = new Set(
    remplissage
      .filter((m) => jourDeUs(m.t) >= D1 || fenetres.some(([lo, hi]) => lo <= m.t && m.t <= hi))
      .map((m) => m.did),
  );
  const gardes: MessageConv[] = remplissage
    .filter((m) => !exclus.has(m.did))
    .map(({ t, qui, texte }) => ({ t, qui, texte }));
  // Tri STABLE par heure (comme `sorted` en Python) : remplissage, puis plantés.
  const messages = [...gardes, ...plantes.flat()]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.t - b.m.t || a.i - b.i)
    .map(({ m }) => ({ ...m, texte: MARQUEURS[m.texte] ?? m.texte }));

  // --- Glissement des dates (option A)
  const decalageJours = options.finLe ? jourDe(options.finLe) - D1 : 0;
  const decal = decalageJours * US_JOUR;
  const glisses = messages.map((m) => ({ ...m, t: m.t + decal }));

  // --- Écriture
  const premier = debutDuJour(D0) + 14 * US_H + 2 * US_MIN + 11 * US_S + decal;
  const lignes = [
    `${crochets(premier)} ${NOM.Y}: ${LIGNE_CHIFFREMENT}`,
    ...glisses.map((m) => `${crochets(m.t)} ${NOM[m.qui]}: ${m.texte}`),
  ];
  return {
    texte: `${lignes.join("\n")}\n`,
    // i18n-exempt: format d'un export WhatsApp iOS FR (donnée importée dans BLUSH), pas un libellé de Jarvia
    nomFichier: `WhatsApp Chat - ${NOM.L}, ${NOM.Y}.txt`,
    // i18n-exempt: format d'un export WhatsApp iOS FR (donnée importée dans BLUSH), pas un libellé de Jarvia
    nomZip: `WhatsApp Chat - ${NOM.Y}.zip`,
    messages: glisses,
    decalageJours,
    noms: NOM,
  };
}

// ─── Contrôle : les stats du Python ─────────────────────────────────────────

export type StatsConversation = {
  messages: number;
  parLocuteur: { L: number; Y: number };
  /** Réponse médiane, en minutes. */
  reponseMediane: { L: number | null; Y: number | null };
  /** Part des échanges lancés par elle (en %). */
  elleLancePct: number;
  record: { jour: string; messages: number };
  jeTaime: { L: number; Y: number };
  /** Messages qui contiennent chaque mot suivi (minuscules). */
  motsSuivis: Array<{ mot: string; n: number }>;
  supprimes: number;
  vocaux: number;
  /** Les 6 mots partagés les plus fréquents. */
  motsPartages: Array<{ mot: string; n: number }>;
};

function mediane(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
}

/** Les chiffres de `stats()` du Python, sur les messages d'une génération. */
export function statsConversation(gen: Generation, motsSuivis: string[] = []): StatsConversation {
  const msgs = gen.messages;
  const ecarts: Record<Locuteur, number[]> = { L: [], Y: [] };
  const lance: Record<Locuteur, number> = { L: 0, Y: 0 };
  let prev: MessageConv | null = null;
  for (const m of msgs) {
    if (prev === null || m.t - prev.t > 3 * US_H) lance[m.qui] += 1;
    else if (m.qui !== prev.qui) ecarts[m.qui].push((m.t - prev.t) / US_S / 60);
    prev = m;
  }
  const parJour = new Map<number, number>();
  for (const m of msgs) parJour.set(jourDeUs(m.t), (parJour.get(jourDeUs(m.t)) ?? 0) + 1);
  let record: [number, number] = [0, 0];
  for (const [j, n] of parJour) if (n > record[1]) record = [j, n];

  const mots: Record<Locuteur, Map<string, number>> = { L: new Map(), Y: new Map() };
  for (const m of msgs) {
    if (m.texte.startsWith(LRM)) continue;
    for (const w of m.texte.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ]+/g) ?? []) {
      if (!MOTS_VIDES.has(w) && w.length > 2) mots[m.qui].set(w, (mots[m.qui].get(w) ?? 0) + 1);
    }
  }
  const partages = [...mots.L.keys()]
    .filter((w) => mots.Y.has(w))
    .map((w) => ({ mot: w, n: mots.L.get(w)! + mots.Y.get(w)! }))
    // Comme `sorted(((n, w)…), reverse=True)` : par nombre, puis par mot, décroissants.
    .sort((a, b) => b.n - a.n || (a.mot < b.mot ? 1 : a.mot > b.mot ? -1 : 0))
    .slice(0, 6);
  const contient = (k: string) => msgs.filter((m) => m.texte.toLowerCase().includes(k)).length;
  const jt = (q: Locuteur) =>
    msgs.filter((m) => m.qui === q && m.texte.toLowerCase().includes("je t'aime")).length;
  const total = lance.L + lance.Y;
  return {
    messages: msgs.length,
    parLocuteur: {
      L: msgs.filter((m) => m.qui === "L").length,
      Y: msgs.filter((m) => m.qui === "Y").length,
    },
    reponseMediane: { L: mediane(ecarts.L), Y: mediane(ecarts.Y) },
    elleLancePct: total ? (100 * lance.L) / total : 0,
    record: { jour: isoJour(record[0]), messages: record[1] },
    jeTaime: { L: jt("L"), Y: jt("Y") },
    motsSuivis: motsSuivis.map((mot) => ({ mot, n: contient(mot.toLowerCase()) })),
    // i18n-exempt: format d'un export WhatsApp iOS FR (donnée importée dans BLUSH), pas un libellé de Jarvia
    supprimes: contient("supprimé."),
    vocaux: contient("audio omis"),
    motsPartages: partages,
  };
}

/**
 * Arrondi d'affichage de Python (`f"{x:.1f}"`) : au plus proche, et une
 * égalité PARFAITE (2,25 exactement) va au chiffre pair — `toFixed` l'arrondit
 * vers le haut.
 */
export function pyFixe(x: number, decimales: number): string {
  const long = x.toFixed(Math.min(100, decimales + 40));
  const point = long.indexOf(".");
  const reste = point < 0 ? "" : long.slice(point + 1 + decimales);
  if (/^50*$/.test(reste)) {
    const tronque = point < 0 ? long : long.slice(0, decimales > 0 ? point + 1 + decimales : point);
    const dernier = Number(tronque[tronque.length - 1]);
    if (dernier % 2 === 0) return tronque;
  }
  return x.toFixed(decimales);
}

/** Le bloc texte du Python, ligne pour ligne (cf docs/scenarios/samples/stats_attendues.txt). */
export function statsTexte(bible: Bible, gen: Generation, stats: StatsConversation): string {
  const { L, Y } = gen.noms;
  const med = (x: number | null) => (x === null ? "—" : pyFixe(x, 1));
  const suivis = [
    ...stats.motsSuivis.map(({ mot, n }) => `${mot} ${n}`),
    // i18n-exempt: texte de contrôle identique à stats() du moteur Python (docs/scenarios), pas un libellé
    `supprimés ${stats.supprimes}`,
    `vocaux ${stats.vocaux}`,
  ].join(" · ");
  const lignes = gen.texte.trimEnd().split("\n");
  return [
    `${bible.id} - ${L} & ${Y}`,
    `  messages : ${stats.messages} (${L} ${stats.parLocuteur.L}, ${Y} ${stats.parLocuteur.Y})`,
    // i18n-exempt: texte de contrôle identique à stats() du moteur Python (docs/scenarios), pas un libellé
    `  réponse médiane : ${L} ${med(stats.reponseMediane.L)} min · ${Y} ${med(stats.reponseMediane.Y)} min`,
    `  qui lance : ${L} ${pyFixe(stats.elleLancePct, 0)} %`,
    `  jour record : ${stats.record.messages} messages le ${stats.record.jour}`,
    `  « je t'aime » : ${L} ${stats.jeTaime.L} · ${Y} ${stats.jeTaime.Y}`,
    `  ${suivis}`,
    `  mots partagés les plus fréquents : ${stats.motsPartages.map(({ mot, n }) => `${mot} ×${n}`).join(", ")}`,
    `  fin :\n    ${lignes.slice(-7).join("\n    ")}`,
  ].join("\n");
}
