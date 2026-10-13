/**
 * ÉCRAN CHOC — la fin d'un export, dessinée façon WhatsApp iOS (1170×2532,
 * iPhone @3x), pour être filmée vers 3 s dans la vidéo.
 *
 * Portage de `docs/scenarios/reference/ecran.py` (Pillow) vers le Canvas du
 * navigateur : mêmes cotes, mêmes couleurs, même police (Inter, servie par
 * l'app depuis /fonts/inter-ecran — licence OFL jointe). Dessiné CÔTÉ
 * NAVIGATEUR, comme les captures du générateur Instagram : Jarvia n'exécute
 * aucun binaire de rendu côté serveur, et l'export étant déterministe, l'image
 * se redessine à l'identique à la demande.
 *
 * Seul écart volontaire avec le Python : l'heure de la barre d'état. Le Python
 * écrit « 22:34 » en dur (juste après l'écran choc de C2) ; ici, c'est l'heure
 * du dernier message + 1 min — la même chose pour C2, juste pour les autres.
 */

const LRM = "\u200e";
const S = 3;
export const LARGEUR = 390 * S;
export const HAUTEUR = 844 * S;
const p = (v: number) => Math.trunc(v * S);
/** Taille Pillow : `int(pt * S)`. */
const px = (pt: number) => Math.trunc(pt * S);

const FAMILLE = "InterEcran";
const POLICES = [
  { poids: "400", fichier: "Inter-Regular.ttf" },
  { poids: "500", fichier: "Inter-Medium.ttf" },
  { poids: "600", fichier: "Inter-SemiBold.ttf" },
];
/** Ascendante d'Inter (hhea : 1984 / 2048) — Pillow ancre le texte sur elle. */
const ASCENDANTE = 1984 / 2048;

const BG = "rgb(234,227,218)";
const NAVBG = "rgb(246,246,246)";
const OUT = "rgb(217,253,211)";
const IN = "rgb(255,255,255)";
const GREY = "rgb(134,150,160)";
const TIMEC = "rgb(102,119,129)";
const BLUE = "rgb(0,122,255)";
const TICK = "rgb(83,189,235)";
const BLACK = "rgb(17,27,33)";
const NOIR = "rgb(0,0,0)";

// i18n-exempt: libellés de l'interface WhatsApp FRANÇAISE dessinés DANS la capture (contenu, pas un libellé de Jarvia)
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// i18n-exempt: libellés de l'interface WhatsApp FRANÇAISE dessinés DANS la capture (contenu, pas un libellé de Jarvia)
const JOURS = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."];
// i18n-exempt: libellé de l'interface WhatsApp FRANÇAISE dessiné DANS la capture
const AUJOURDHUI = "Aujourd'hui";
// i18n-exempt: libellé de l'interface WhatsApp FRANÇAISE dessiné DANS la capture
const HIER = "Hier";
// i18n-exempt: statut WhatsApp FRANÇAIS dessiné DANS la capture
const EN_LIGNE = "en ligne";

let policesPretes: Promise<void> | null = null;
/** Charge Inter une fois par page (FontFace), avant tout dessin. */
export function chargerPolices(base = "/fonts/inter-ecran"): Promise<void> {
  policesPretes ??= Promise.all(
    POLICES.map(async ({ poids, fichier }) => {
      const face = new FontFace(FAMILLE, `url(${base}/${fichier})`, { weight: poids });
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  return policesPretes;
}

type Ligne = { jour: number; hhmm: string; qui: string; texte: string };
type Element =
  | { type: "pill"; label: string }
  | { type: "me" | "them"; texte: string; hhmm: string };

const LIGNE = /^\[(\d\d)\/(\d\d)\/(\d{4}) (\d\d:\d\d):\d\d\] ([^:]+): (.*)$/;

function lireExport(texte: string): Ligne[] {
  const out: Ligne[] = [];
  for (const brute of texte.split("\n")) {
    const m = LIGNE.exec(brute);
    if (!m || m[6]!.startsWith(LRM)) continue;
    out.push({
      jour: Math.round(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) / 86_400_000),
      hhmm: m[4]!,
      qui: m[5]!,
      texte: m[6]!,
    });
  }
  return out;
}

/** Les éléments de l'écran : les 16 derniers messages, et une pastille à chaque changement de jour. */
export function elementsEcran(texte: string, prenom: string): Element[] {
  const lignes = lireExport(texte);
  if (lignes.length === 0) return [];
  const dernier = lignes[lignes.length - 1]!.jour;
  const label = (j: number) => {
    if (j === dernier) return AUJOURDHUI;
    if (j === dernier - 1) return HIER;
    const t = new Date(j * 86_400_000);
    return `${JOURS[(t.getUTCDay() + 6) % 7]} ${t.getUTCDate()} ${MOIS[t.getUTCMonth()]}`;
  };
  const out: Element[] = [];
  let jourPrec: number | null = null;
  for (const l of lignes.slice(-16)) {
    if (l.jour !== jourPrec) {
      out.push({ type: "pill", label: label(l.jour) });
      jourPrec = l.jour;
    }
    out.push({ type: l.qui === prenom ? "me" : "them", texte: l.texte, hhmm: l.hhmm });
  }
  return out;
}

/** L'heure de la barre d'état : une minute après le dernier message. */
function heureBarre(texte: string): string {
  const lignes = lireExport(texte);
  const hhmm = lignes[lignes.length - 1]?.hhmm ?? "22:33";
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h! * 60 + m! + 1) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Dessine l'écran choc de la fin d'un export. `prenom` = la créatrice (bulles
 * vertes, à droite), `lui` = le nom en haut de l'écran.
 */
export async function dessinerEcranChoc(opts: {
  texte: string;
  prenom: string;
  lui: string;
}): Promise<HTMLCanvasElement> {
  await chargerPolices();
  const canvas = document.createElement("canvas");
  canvas.width = LARGEUR;
  canvas.height = HAUTEUR;
  const d = canvas.getContext("2d")!;
  const W = LARGEUR;
  const H = HAUTEUR;

  const police = (poids: string, pt: number) => `${poids} ${px(pt)}px ${FAMILLE}`;
  const F = {
    msg: police("400", 17),
    time: police("400", 11),
    name: police("600", 16.5),
    sub: police("400", 12.5),
    status: police("600", 17),
    pill: police("500", 12.5),
    nav: police("400", 17),
  };
  const largeur = (font: string, t: string) => {
    d.font = font;
    return d.measureText(t).width;
  };
  /** Pillow ancre le texte sur l'ascendante (« la ») ; le Canvas sur la ligne de base. */
  const texte = (t: string, x: number, y: number, font: string, couleur: string) => {
    d.font = font;
    d.fillStyle = couleur;
    d.textBaseline = "alphabetic";
    const taille = Number(/(\d+)px/.exec(font)![1]);
    d.fillText(t, x, y + Math.round(taille * ASCENDANTE));
  };
  const rrect = (x0: number, y0: number, x1: number, y1: number, r: number, fill?: string, stroke?: { c: string; w: number }) => {
    d.beginPath();
    d.roundRect(x0, y0, x1 - x0, y1 - y0, r);
    if (fill) {
      d.fillStyle = fill;
      d.fill();
    }
    if (stroke) {
      d.strokeStyle = stroke.c;
      d.lineWidth = stroke.w;
      d.stroke();
    }
  };
  const ligne = (pts: Array<[number, number]>, couleur: string, epaisseur: number) => {
    d.beginPath();
    d.moveTo(pts[0]![0], pts[0]![1]);
    for (const [x, y] of pts.slice(1)) d.lineTo(x, y);
    d.strokeStyle = couleur;
    d.lineWidth = epaisseur;
    d.lineJoin = "round";
    d.lineCap = "butt";
    d.stroke();
  };
  const poly = (pts: Array<[number, number]>, fill?: string, stroke?: { c: string; w: number }) => {
    d.beginPath();
    d.moveTo(pts[0]![0], pts[0]![1]);
    for (const [x, y] of pts.slice(1)) d.lineTo(x, y);
    d.closePath();
    if (fill) {
      d.fillStyle = fill;
      d.fill();
    }
    if (stroke) {
      d.strokeStyle = stroke.c;
      d.lineWidth = stroke.w;
      d.stroke();
    }
  };

  d.fillStyle = BG;
  d.fillRect(0, 0, W, H);

  const MSGS = elementsEcran(opts.texte, opts.prenom);

  const wrap = (t: string, maxw: number) => {
    const lignes: string[] = [];
    let cur = "";
    for (const w of t.split(" ")) {
      const essai = `${cur} ${w}`.trim();
      if (largeur(F.msg, essai) <= maxw) cur = essai;
      else {
        lignes.push(cur);
        cur = w;
      }
    }
    lignes.push(cur);
    return lignes;
  };

  const coches = (x: number, y: number) => {
    for (const dx of [0, p(4.5)]) {
      ligne(
        [
          [x + dx, y - p(4)],
          [x + dx + p(3), y - p(1)],
          [x + dx + p(9), y - p(8)],
        ],
        TICK,
        p(1.4),
      );
    }
  };

  // --- Bulles, du bas vers le haut
  const INPUT_H = 52;
  const HOME_H = 34;
  const bas = H - p(INPUT_H + HOME_H) - p(10);
  const maxw = p(258);
  type Place =
    | { type: "pill"; label: string; top: number }
    | { type: "me" | "them"; lignes: string[]; hhmm: string; top: number; bw: number; bh: number; dernier: boolean };
  const places: Place[] = [];
  let y = bas;
  for (let i = MSGS.length - 1; i >= 0; i--) {
    const m = MSGS[i]!;
    if (m.type === "pill") {
      y -= p(30);
      places.push({ type: "pill", label: m.label, top: y });
      y -= p(8);
      continue;
    }
    const lignes = wrap(m.texte, maxw);
    const metaW = largeur(F.time, m.hhmm) + (m.type === "me" ? p(19) : 0);
    const derniereW = largeur(F.msg, lignes[lignes.length - 1]!);
    const plusLarge = Math.max(...lignes.map((l) => largeur(F.msg, l)));
    const lh = p(22);
    let bw: number;
    let extra: number;
    if (derniereW + metaW + p(8) <= maxw) {
      bw = Math.max(plusLarge, derniereW + metaW + p(8));
      extra = 0;
    } else {
      bw = Math.max(plusLarge, metaW);
      extra = p(15);
    }
    const bh = lh * lignes.length + extra + p(14);
    bw += p(20);
    const suivantPareil = i + 1 < MSGS.length && MSGS[i + 1]!.type === m.type;
    y -= bh;
    places.push({ type: m.type, lignes, hhmm: m.hhmm, top: y, bw, bh, dernier: !suivantPareil });
    const precPareil = i - 1 >= 0 && MSGS[i - 1]!.type === m.type;
    y -= precPareil ? p(2) : p(8);
  }

  const pastille = (label: string, top: number) => {
    const pw = largeur(F.pill, label) + p(20);
    rrect((W - pw) / 2, top, (W + pw) / 2, top + p(22), p(8), "rgb(255,255,255)");
    texte(label, (W - largeur(F.pill, label)) / 2, top + p(4), F.pill, TIMEC);
  };

  for (const pl of places) {
    if (pl.type === "pill") {
      pastille(pl.label, pl.top);
      continue;
    }
    const { lignes, hhmm, top, bw, bh, dernier } = pl;
    const x = pl.type === "me" ? W - p(10) - bw : p(10);
    const col = pl.type === "me" ? OUT : IN;
    rrect(x, top, x + bw, top + bh, p(14), col);
    if (dernier) {
      if (pl.type === "me") {
        poly([[x + bw - p(14), top + bh], [x + bw + p(6), top + bh], [x + bw - p(2), top + bh - p(12)]], col);
      } else {
        poly([[x + p(14), top + bh], [x - p(6), top + bh], [x + p(2), top + bh - p(12)]], col);
      }
    }
    let ty = top + p(6);
    for (const l of lignes) {
      texte(l, x + p(10), ty, F.msg, BLACK);
      ty += p(22);
    }
    let txEnd = x + bw - p(9);
    const tyy = top + bh - p(17);
    if (pl.type === "me") {
      coches(txEnd - p(14), tyy + p(12));
      txEnd -= p(19);
    }
    texte(hhmm, txEnd - largeur(F.time, hhmm), tyy, F.time, TIMEC);
  }

  // --- Barre d'état + navigation (par-dessus)
  const NAV_TOP = 54;
  const NAV_H = 52;
  d.fillStyle = NAVBG;
  d.fillRect(0, 0, W, p(NAV_TOP + NAV_H) + 1);
  ligne([[0, p(NAV_TOP + NAV_H)], [W, p(NAV_TOP + NAV_H)]], "rgb(210,210,210)", 1);
  texte(heureBarre(opts.texte), p(44), p(17), F.status, NOIR);
  rrect(p(130), p(11), p(256), p(43), p(16), NOIR); // Dynamic Island
  const bx = p(292);
  for (let k = 0; k < 4; k++) {
    const h = p(4 + 2.6 * k);
    rrect(bx + k * p(5), p(31) - h, bx + k * p(5) + p(3), p(31), p(1), NOIR); // réseau
  }
  const cx = p(326);
  const cy = p(31);
  for (const r of [p(12), p(8), p(4)]) {
    // wifi : quarts de disque (225° → 315°), évidés sauf le plus petit
    d.beginPath();
    d.moveTo(cx, cy);
    d.arc(cx, cy, r, (225 * Math.PI) / 180, (315 * Math.PI) / 180);
    d.closePath();
    d.fillStyle = NOIR;
    d.fill();
    if (r > p(4)) {
      const ri = r - p(2.2);
      d.beginPath();
      d.moveTo(cx, cy);
      d.arc(cx, cy, ri, (225 * Math.PI) / 180, (315 * Math.PI) / 180);
      d.closePath();
      d.fillStyle = NAVBG;
      d.fill();
    }
  }
  rrect(p(342), p(20), p(367), p(32), p(3.5), undefined, { c: NOIR, w: p(1) }); // batterie
  rrect(p(344), p(22), p(358), p(30), p(2), NOIR);
  rrect(p(368.5), p(24), p(370), p(28), p(1), NOIR);

  const ny = p(NAV_TOP) + p(NAV_H) / 2;
  ligne([[p(22), ny - p(10)], [p(13), ny], [p(22), ny + p(10)]], BLUE, p(3));
  texte("12", p(27), ny - p(10), F.nav, BLUE);
  const ax = p(70);
  d.beginPath();
  d.ellipse(ax + p(18), ny, p(18), p(18), 0, 0, 2 * Math.PI);
  d.fillStyle = "rgb(214,220,224)";
  d.fill();
  d.beginPath();
  d.ellipse(ax + p(18), ny - p(4), p(6), p(6), 0, 0, 2 * Math.PI);
  d.fillStyle = "rgb(255,255,255)";
  d.fill();
  d.beginPath(); // épaules : demi-ellipse du haut
  d.ellipse(ax + p(18), ny + p(14), p(12), p(10), 0, Math.PI, 2 * Math.PI);
  d.closePath();
  d.fill();
  texte(opts.lui, ax + p(46), ny - p(17), F.name, NOIR);
  texte(EN_LIGNE, ax + p(46), ny + p(2), F.sub, GREY);
  const vx = p(338); // caméra
  rrect(vx, ny - p(8), vx + p(19), ny + p(8), p(4), undefined, { c: BLUE, w: p(2) });
  poly([[vx + p(20), ny - p(2)], [vx + p(28), ny - p(7)], [vx + p(28), ny + p(7)], [vx + p(20), ny + p(2)]], undefined, { c: BLUE, w: p(2) });

  // --- Barre de saisie + indicateur d'accueil
  const iy = H - p(INPUT_H + HOME_H);
  d.fillStyle = NAVBG;
  d.fillRect(0, iy, W, H - iy);
  ligne([[0, iy], [W, iy]], "rgb(210,210,210)", 1);
  const my = iy + p(INPUT_H / 2);
  ligne([[p(16), my], [p(32), my]], BLUE, p(2.4));
  ligne([[p(24), my - p(8)], [p(24), my + p(8)]], BLUE, p(2.4));
  rrect(p(46), my - p(17), p(292), my + p(17), p(17), "rgb(255,255,255)", { c: "rgb(220,220,220)", w: p(1) });
  rrect(p(305), my - p(8), p(327), my + p(9), p(4), undefined, { c: BLUE, w: p(2) }); // appareil photo
  d.beginPath();
  d.ellipse(p(316), my + p(1), p(5), p(5), 0, 0, 2 * Math.PI);
  d.strokeStyle = BLUE;
  d.lineWidth = p(2);
  d.stroke();
  rrect(p(350), my - p(11), p(359), my + p(3), p(4.5), undefined, { c: BLUE, w: p(2) }); // micro
  d.beginPath();
  d.ellipse((p(346) + p(363)) / 2, (my - p(4) + my + p(8)) / 2, (p(363) - p(346)) / 2, (p(12)) / 2, 0, 0, Math.PI);
  d.strokeStyle = BLUE;
  d.lineWidth = p(2);
  d.stroke();
  ligne([[p(354.5), my + p(8)], [p(354.5), my + p(12)]], BLUE, p(2));
  rrect((W - p(134)) / 2, H - p(13), (W + p(134)) / 2, H - p(8), p(3), NOIR);

  return canvas;
}

/** Le PNG de l'écran choc. */
export async function ecranChocPng(opts: { texte: string; prenom: string; lui: string }): Promise<Blob> {
  const canvas = await dessinerEcranChoc(opts);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
  );
}
