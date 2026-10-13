/**
 * BIBLE DE SCÉNARIO — sa forme et sa vérification.
 *
 * La bible porte tout ce qui rend un scénario unique (dates, rythme, mot à
 * vous, munitions, dernière semaine, écran choc) ; le moteur
 * (convex/scenarioEngine.ts) fournit le reste. Sa référence est
 * `docs/scenarios/bibles/bible.schema.json` : ce module en applique les règles,
 * PLUS les cohérences sans lesquelles le moteur produirait une conv fausse (une
 * fin avant le début, un écran choc sans secondes ou hors du dernier jour).
 *
 * Les erreurs sortent en CODES + chemin + paramètres, jamais en phrases :
 * l'écran les traduit (admin.scripts.ScenarioErreur.*), le serveur renvoie la
 * première dans son rejet.
 *
 * Module PUR (aucun import `_generated`). Garde : lib/scenario-bible.test.ts.
 */

export type Locuteur = "L" | "Y";
/** [horodatage, qui, texte] — « AAAA-MM-JJ HH:MM » (secondes tirées) ou « AAAA-MM-JJ HH:MM:SS » (exact). */
export type MessageBible = [string, Locuteur, string];
export type Ligne = [Locuteur, string];

export const TYPES_SCENARIO = [
  "couple",
  "talking_stage",
  "meilleur_ami",
  "ex",
  "famille",
  "groupe",
] as const;
export type TypeScenario = (typeof TYPES_SCENARIO)[number];

export type Bible = {
  id: string;
  titre: string;
  type: TypeScenario;
  lui: string;
  dates: {
    debut: string;
    fin: string;
    lune_de_miel_fin: string;
    tournant: string;
    record: string;
  };
  rythme: {
    elle_lance: { avant: number; apres: number };
    lui_reponse_min: { lune_de_miel: number; avant: number; apres: number; nuit: number; record: number };
    elle_reponse_s: number;
    dialogues_par_jour: {
      lune_de_miel: [number, number];
      avant: [number, number];
      apres: [number, number];
      record: number;
    };
  };
  mot_a_vous: { mot: string; debut: string; proba_par_jour: number; dialogues: Ligne[][] };
  vocaux: { L: number; Y: number; Y_nuit: number };
  munitions: MessageBible[][];
  derniere_semaine: MessageBible[][];
  ecran_choc: MessageBible[];
};

export type CodeErreurBible =
  | "json"
  | "requis"
  | "objet"
  | "liste"
  | "texte"
  | "nombre"
  | "entier"
  | "type"
  | "date"
  | "horodatage"
  | "horodatage_secondes"
  | "locuteur"
  | "nb_messages"
  | "vide"
  | "proba"
  | "positif"
  | "paire"
  | "prenom"
  | "ordre_dates"
  | "hors_periode"
  | "ecran_jour"
  | "ecran_ordre"
  | "code_id"
  | "trop_long";

export type ErreurBible = {
  /** Chemin du champ, ex. « rythme.elle_lance.avant », « ecran_choc[2][0] » ; vide = la bible entière. */
  chemin: string;
  code: CodeErreurBible;
  params?: Record<string, string | number>;
};

export type ResultatBible =
  | { ok: true; bible: Bible }
  | { ok: false; erreurs: ErreurBible[] };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORODATAGE = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Une date du calendrier qui existe (pas de 31 février). */
export function dateValide(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function horodatageValide(s: string): { jour: string; secondes: boolean } | null {
  const m = HORODATAGE.exec(s);
  if (!m || !dateValide(m[1]!)) return null;
  const [h, mi, se] = [Number(m[2]), Number(m[3]), m[4] === undefined ? 0 : Number(m[4])];
  if (h > 23 || mi > 59 || se > 59) return null;
  return { jour: m[1]!, secondes: m[4] !== undefined };
}

/** Le code d'un scénario (l'`id` de sa bible) : court, sans espace — « C2 », « A1-bis ». */
export function codeValide(code: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(code);
}

/**
 * Un nom qui peut figurer dans un export : non vide, sans retour à la ligne, et
 * sans « : » — l'export se lit « [date] Nom: texte », un deux-points dans le nom
 * couperait la ligne au mauvais endroit.
 */
export function nomExportValide(s: string): boolean {
  const t = s.trim();
  if (t.length === 0 || t.length > 40) return false;
  return !/[:\r\n\u2028\u2029]/.test(t);
}

class Verif {
  erreurs: ErreurBible[] = [];
  err(chemin: string, code: CodeErreurBible, params?: ErreurBible["params"]) {
    this.erreurs.push(params ? { chemin, code, params } : { chemin, code });
  }
  objet(v: unknown, chemin: string): Record<string, unknown> | null {
    if (v === undefined) {
      this.err(chemin, "requis");
      return null;
    }
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.err(chemin, "objet");
      return null;
    }
    return v as Record<string, unknown>;
  }
  liste(v: unknown, chemin: string): unknown[] | null {
    if (v === undefined) {
      this.err(chemin, "requis");
      return null;
    }
    if (!Array.isArray(v)) {
      this.err(chemin, "liste");
      return null;
    }
    return v;
  }
  texte(v: unknown, chemin: string, { vide = false } = {}): string | null {
    if (v === undefined) {
      this.err(chemin, "requis");
      return null;
    }
    if (typeof v !== "string") {
      this.err(chemin, "texte");
      return null;
    }
    if (!vide && v.trim().length === 0) {
      this.err(chemin, "vide");
      return null;
    }
    return v;
  }
  nombre(v: unknown, chemin: string): number | null {
    if (v === undefined) {
      this.err(chemin, "requis");
      return null;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.err(chemin, "nombre");
      return null;
    }
    return v;
  }
  proba(v: unknown, chemin: string): number | null {
    const n = this.nombre(v, chemin);
    if (n !== null && (n < 0 || n > 1)) {
      this.err(chemin, "proba");
      return null;
    }
    return n;
  }
  positif(v: unknown, chemin: string): number | null {
    const n = this.nombre(v, chemin);
    if (n !== null && n <= 0) {
      this.err(chemin, "positif");
      return null;
    }
    return n;
  }
  entier(v: unknown, chemin: string): number | null {
    const n = this.nombre(v, chemin);
    if (n !== null && (!Number.isInteger(n) || n < 0)) {
      this.err(chemin, "entier");
      return null;
    }
    return n;
  }
  date(v: unknown, chemin: string): string | null {
    const s = this.texte(v, chemin);
    if (s !== null && !dateValide(s)) {
      this.err(chemin, "date", { valeur: s });
      return null;
    }
    return s;
  }
  locuteur(v: unknown, chemin: string): Locuteur | null {
    if (v !== "L" && v !== "Y") {
      this.err(chemin, "locuteur");
      return null;
    }
    return v;
  }
  paire(v: unknown, chemin: string): [number, number] | null {
    const l = this.liste(v, chemin);
    if (!l) return null;
    if (l.length !== 2) {
      this.err(chemin, "paire");
      return null;
    }
    const a = this.entier(l[0], `${chemin}[0]`);
    const b = this.entier(l[1], `${chemin}[1]`);
    if (a === null || b === null) return null;
    if (a > b) {
      this.err(chemin, "paire");
      return null;
    }
    return [a, b];
  }
  message(v: unknown, chemin: string, { secondes = false } = {}): MessageBible | null {
    const l = this.liste(v, chemin);
    if (!l) return null;
    if (l.length !== 3) {
      this.err(chemin, "nb_messages");
      return null;
    }
    const h = this.texte(l[0], `${chemin}[0]`);
    const qui = this.locuteur(l[1], `${chemin}[1]`);
    const txt = this.texte(l[2], `${chemin}[2]`);
    if (h === null || qui === null || txt === null) return null;
    const lu = horodatageValide(h);
    if (!lu) {
      this.err(`${chemin}[0]`, "horodatage", { valeur: h });
      return null;
    }
    if (secondes && !lu.secondes) {
      this.err(`${chemin}[0]`, "horodatage_secondes", { valeur: h });
      return null;
    }
    return [h, qui, txt];
  }
  blocs(v: unknown, chemin: string): MessageBible[][] | null {
    const l = this.liste(v, chemin);
    if (!l) return null;
    const out: MessageBible[][] = [];
    l.forEach((b, i) => {
      const msgs = this.liste(b, `${chemin}[${i}]`);
      if (!msgs) return;
      if (msgs.length === 0) {
        this.err(`${chemin}[${i}]`, "vide");
        return;
      }
      const bloc = msgs.map((m, j) => this.message(m, `${chemin}[${i}][${j}]`));
      if (bloc.every((m): m is MessageBible => m !== null)) out.push(bloc);
    });
    return out;
  }
}

/** Ligne et colonne d'une position dans un texte (1-indexées). */
function ligneColonne(texte: string, pos: number): { ligne: number; colonne: number } {
  const avant = texte.slice(0, pos).split("\n");
  return { ligne: avant.length, colonne: avant[avant.length - 1]!.length + 1 };
}

/** Lit le TEXTE d'une bible (tel que saisi dans l'éditeur) puis la vérifie. */
export function lireBible(texte: string): ResultatBible {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const pos = /position (\d+)/.exec(msg);
    const lc = /line (\d+) column (\d+)/.exec(msg);
    const where = lc
      ? { ligne: Number(lc[1]), colonne: Number(lc[2]) }
      : pos
        ? ligneColonne(texte, Number(pos[1]))
        : null;
    return { ok: false, erreurs: [{ chemin: "", code: "json", params: where ?? {} }] };
  }
  return verifierBible(brut);
}

/** Vérifie une bible déjà lue (objet JSON). */
export function verifierBible(brut: unknown): ResultatBible {
  const v = new Verif();
  const b = v.objet(brut, "");
  if (!b) return { ok: false, erreurs: v.erreurs };

  const id = v.texte(b.id, "id");
  if (id !== null && !codeValide(id)) v.err("id", "code_id");
  const titre = v.texte(b.titre, "titre");
  if (b.type === undefined) v.err("type", "requis");
  else if (!(TYPES_SCENARIO as readonly unknown[]).includes(b.type)) {
    v.err("type", "type", { valeurs: TYPES_SCENARIO.join(", ") });
  }
  const lui = v.texte(b.lui, "lui");
  if (lui !== null && !nomExportValide(lui)) v.err("lui", "prenom");

  // ─── Dates ───
  const d = v.objet(b.dates, "dates");
  const dates = d
    ? {
        debut: v.date(d.debut, "dates.debut"),
        fin: v.date(d.fin, "dates.fin"),
        lune_de_miel_fin: v.date(d.lune_de_miel_fin, "dates.lune_de_miel_fin"),
        tournant: v.date(d.tournant, "dates.tournant"),
        record: v.date(d.record, "dates.record"),
      }
    : null;
  if (dates && Object.values(dates).every((x) => x !== null)) {
    const { debut, fin, lune_de_miel_fin, tournant, record } = dates as Record<string, string>;
    // Les dates AAAA-MM-JJ se comparent comme des chaînes.
    if (!(debut! < lune_de_miel_fin! && lune_de_miel_fin! <= tournant! && tournant! < fin!)) {
      v.err("dates", "ordre_dates");
    }
    if (record! <= debut! || record! > fin!) v.err("dates.record", "hors_periode");
  }

  // ─── Rythme ───
  const r = v.objet(b.rythme, "rythme");
  if (r) {
    const el = v.objet(r.elle_lance, "rythme.elle_lance");
    if (el) {
      v.proba(el.avant, "rythme.elle_lance.avant");
      v.proba(el.apres, "rythme.elle_lance.apres");
    }
    const lr = v.objet(r.lui_reponse_min, "rythme.lui_reponse_min");
    if (lr) {
      for (const k of ["lune_de_miel", "avant", "apres", "nuit", "record"]) {
        v.positif(lr[k], `rythme.lui_reponse_min.${k}`);
      }
    }
    v.positif(r.elle_reponse_s, "rythme.elle_reponse_s");
    const dpj = v.objet(r.dialogues_par_jour, "rythme.dialogues_par_jour");
    if (dpj) {
      for (const k of ["lune_de_miel", "avant", "apres"]) v.paire(dpj[k], `rythme.dialogues_par_jour.${k}`);
      v.entier(dpj.record, "rythme.dialogues_par_jour.record");
    }
  }

  // ─── Mot à vous ───
  const mav = v.objet(b.mot_a_vous, "mot_a_vous");
  if (mav) {
    v.texte(mav.mot, "mot_a_vous.mot");
    v.date(mav.debut, "mot_a_vous.debut");
    v.proba(mav.proba_par_jour, "mot_a_vous.proba_par_jour");
    const dl = v.liste(mav.dialogues, "mot_a_vous.dialogues");
    if (dl) {
      if (dl.length === 0) v.err("mot_a_vous.dialogues", "vide");
      dl.forEach((dialogue, i) => {
        const lignes = v.liste(dialogue, `mot_a_vous.dialogues[${i}]`);
        if (!lignes) return;
        if (lignes.length === 0) v.err(`mot_a_vous.dialogues[${i}]`, "vide");
        lignes.forEach((ligne, j) => {
          const c = `mot_a_vous.dialogues[${i}][${j}]`;
          const l = v.liste(ligne, c);
          if (!l) return;
          if (l.length !== 2) {
            v.err(c, "nb_messages");
            return;
          }
          v.locuteur(l[0], `${c}[0]`);
          v.texte(l[1], `${c}[1]`);
        });
      });
    }
  }

  // ─── Vocaux ───
  const voc = v.objet(b.vocaux, "vocaux");
  if (voc) {
    v.proba(voc.L, "vocaux.L");
    v.proba(voc.Y, "vocaux.Y");
    v.proba(voc.Y_nuit, "vocaux.Y_nuit");
  }

  // ─── Munitions, dernière semaine, écran choc ───
  v.blocs(b.munitions, "munitions");
  v.blocs(b.derniere_semaine, "derniere_semaine");
  const ec = v.liste(b.ecran_choc, "ecran_choc");
  if (ec) {
    if (ec.length < 3 || ec.length > 6) v.err("ecran_choc", "nb_messages", { min: 3, max: 6, n: ec.length });
    const msgs = ec.map((m, i) => v.message(m, `ecran_choc[${i}]`, { secondes: true }));
    const fin = dates?.fin;
    msgs.forEach((m, i) => {
      if (!m) return;
      if (fin && m[0].slice(0, 10) !== fin) v.err(`ecran_choc[${i}][0]`, "ecran_jour", { fin });
      const prev = msgs[i - 1];
      if (prev && m[0] <= prev[0]) v.err(`ecran_choc[${i}][0]`, "ecran_ordre");
    });
  }

  if (v.erreurs.length > 0 || id === null || titre === null || lui === null) {
    return { ok: false, erreurs: v.erreurs };
  }
  return { ok: true, bible: b as unknown as Bible };
}
