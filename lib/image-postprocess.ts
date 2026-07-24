/**
 * Post-traitement des images à l'INGESTION — retire structurellement les
 * métadonnées de provenance (C2PA, EXIF, XMP) et ré-encode le fichier.
 *
 * Portage du pipeline décrit dans PIPELINE-POSTPROCESS-PORTABLE.md, avec la
 * CORRECTION de l'étape 7 : AUCUN appel à `withMetadata()`. Dans Sharp cette
 * méthode fait l'inverse de ce que son nom suggère — elle appelle
 * `keepMetadata()` + `withIccProfile('srgb')`, donc elle ACTIVE la rétention.
 * Sharp ne conserve aucune métadonnée par défaut : on ne lui demande rien.
 *
 * ⚠️ SERVEUR UNIQUEMENT — sharp embarque un binaire natif (libvips). Ce module
 * ne doit JAMAIS être importé depuis un composant client (le bundler échouerait).
 * Unique appelant applicatif : app/api/assets/postprocess/route.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUE CE PIPELINE NE FAIT PAS — À LIRE AVANT DE S'APPUYER DESSUS
 *
 * Il est SOLIDE contre la provenance DÉCLARATIVE (C2PA, EXIF, XMP : suppression
 * structurelle par le détour PNG) et INEFFICACE contre l'ANALYSE DE SIGNAL. Les
 * trois limites suivantes sont MESURÉES, pas supposées (cf. doc § « Limites
 * mesurées ») :
 *
 *  1. Les HASH PERCEPTUELS survivent. Δ pHash mesuré : 2/64 sur dégradé doux,
 *     10/64 sur portrait — or un matcher considère Δ ≤ 10/64 comme LA MÊME
 *     image. Ce n'est pas un défaut de réglage : passer la rotation de 0,3° à
 *     10° (33×, visible à l'œil) ne monte le pHash qu'à 20/64. Ces hash sont
 *     CONÇUS pour survivre au resize, à la rotation légère et à la
 *     recompression. Une image traitée reste matchable contre une base de
 *     références.
 *  2. Les WATERMARKS ROBUSTES survivent. SynthID & co résistent par
 *     construction au recadrage, à la recompression et aux ajustements
 *     colorimétriques — c'est exactement ce que fait ce pipeline. Il les dégrade
 *     peut-être marginalement ; il ne garantit PAS leur suppression.
 *  3. Les CLASSIFIEURS VISUELS ne sont pas affectés. Un modèle qui reconnaît une
 *     image générée le fait sur le CONTENU (texture, artefacts de diffusion) ;
 *     aucune manipulation de métadonnées ni perturbation légère de pixels ne
 *     masque ça.
 *
 * Autrement dit : si un usage suppose qu'une image ne soit pas IDENTIFIABLE,
 * ce module ne le garantit pas et ne peut pas le garantir. Ne pas surestimer sa
 * portée en s'appuyant sur le seul fait qu'il « nettoie les métadonnées ».
 * ─────────────────────────────────────────────────────────────────────────────
 */

import sharp from "sharp";

/**
 * Formats d'ENTRÉE post-traités. Tout autre type (vidéos, formats exotiques)
 * est stocké tel quel — cf. la garde `isPostProcessableType` côté route.
 * Aligné sur ASSET_IMAGE_TYPES (lib/asset-file.ts) ; si un format image y est
 * ajouté sans l'être ici, la route répond « non traité » et l'original est
 * conservé plutôt que de faire échouer l'upload.
 */
export const POSTPROCESS_INPUT_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** La sortie est TOUJOURS du JPEG (ré-encodage mozjpeg, étape 6). */
export const POSTPROCESS_OUTPUT_TYPE = "image/jpeg";

export function isPostProcessableType(contentType: string): boolean {
  return POSTPROCESS_INPUT_TYPES.includes(contentType);
}

export type PostProcessOptions = {
  targetWidth?: number;
  targetHeight?: number;
  rotationDegrees?: number;
  saturationFactor?: number;
  brightnessFactor?: number;
  jpegQuality?: number;
  keepIccProfile?: boolean;
  /** Applique l'orientation EXIF avant traitement — cf. DEFAULTS. */
  autoOrient?: boolean;
  /** Fond substitué à la transparence avant encodage JPEG — cf. DEFAULTS. */
  flattenBackground?: string;
};

const DEFAULTS = {
  rotationDegrees: 0.3,
  saturationFactor: 1.015,
  brightnessFactor: 1.005,
  jpegQuality: 92,
  keepIccProfile: false,
  /**
   * La sortie est toujours du JPEG, format SANS canal alpha : la transparence
   * doit être aplatie sur un fond. Sans ça Sharp compose sur du NOIR (vérifié :
   * pixel 0,0,0), ce qui rend illisible un PNG à fond transparent. Blanc =
   * hypothèse la moins destructrice sur du matériel de marque.
   */
  flattenBackground: "#ffffff",
  /**
   * ÉCART ASSUMÉ vs le module du doc (qui n'auto-oriente pas). Le pipeline
   * strippe l'EXIF : sans auto-orientation, une photo portrait balisée
   * Orientation=6 (grille de pixels 1920×1080 + « tourner de 90° ») ressortirait
   * couchée, ET ses dimensions cibles seraient lues 16:9 → recadrage destructif
   * d'une source 9:16. Auto-orienter est la seule façon de tenir la garantie de
   * ratio. Cf. readImageDimensions, qui lit les dimensions D'AFFICHAGE.
   */
  autoOrient: true,
};

export type ImageDimensions = { width: number; height: number };

/**
 * Dimensions RÉELLES (d'affichage) de la source, orientation EXIF appliquée.
 *
 * `metadata()` renvoie toujours la grille de pixels BRUTE : une photo
 * Orientation ≥ 5 (rotations de 90°/270°) est décrite 1920×1080 alors qu'elle
 * s'affiche 1080×1920 — d'où l'inversion ici, sans quoi l'appelant passerait des
 * cibles 16:9 à une image 9:16 et le `fit: "cover"` la recadrerait.
 *
 * null si les dimensions sont illisibles (l'appelant conserve alors l'original).
 */
export async function readImageDimensions(
  input: Buffer,
): Promise<ImageDimensions | null> {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) return null;
  const rotated = (meta.orientation ?? 1) >= 5;
  return rotated
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

/**
 * Pipeline complet. Retourne un buffer JPEG vierge de métadonnées de provenance.
 * Jette si la source est indécodable ou ses dimensions illisibles — l'appelant
 * traite ce cas en conservant l'original (l'upload n'est jamais bloqué).
 */
export async function postProcessImage(
  input: Buffer,
  options: PostProcessOptions = {},
): Promise<Buffer> {
  const o = { ...DEFAULTS, ...options };

  /**
   * Étape 8 — dimensions cibles : celles fournies par l'appelant, sinon CELLES
   * DE LA SOURCE. Aucun ratio codé en dur : le `1080×1350` du module d'origine
   * recadrerait en 4:5 (via `fit: "cover"`) toute source 9:16, ce qui la
   * détruirait. Le fallback source garantit que ce défaut ne peut pas revenir
   * par un appelant distrait.
   */
  let w = options.targetWidth;
  let h = options.targetHeight;
  if (w === undefined || h === undefined) {
    const src = await readImageDimensions(input);
    if (!src) throw new Error("Dimensions de la source illisibles.");
    w = w ?? src.width;
    h = h ?? src.height;
  }

  /**
   * ÉCART ASSUMÉ vs le module du doc (et donc vs Carousel Studio) — RECADRAGE
   * DES BISEAUX DE ROTATION.
   *
   * La rotation remplit les coins créés sur un fond gris 128 opaque, et le
   * `fit: "cover"` du doc n'en recadre qu'une partie : il reste un LISERÉ GRIS
   * sur les bords de CHAQUE image produite (mesuré 4 px à gauche et à droite,
   * 1-2 px en haut et en bas sur du 1080×1920) — parfaitement visible à 100 %
   * sur un visuel de campagne.
   *
   * Correctif : on cadre à une taille SUR-DIMENSIONNÉE, on déroule le wiggle
   * dessus, puis on recadre au centre à la taille cible. Les biseaux tombent
   * hors du cadre final. La marge est dérivée de la géométrie de la rotation
   * (un biseau s'étend au plus de `côté × sin θ`), pas d'une constante devinée.
   */
  const radians = (Math.abs(o.rotationDegrees) * Math.PI) / 180;
  const padX = radians === 0 ? 0 : Math.ceil(h * Math.sin(radians)) + 1;
  const padY = radians === 0 ? 0 : Math.ceil(w * Math.sin(radians)) + 1;
  const frameW = w + 2 * padX;
  const frameH = h + 2 * padY;

  // Étapes 1-4 : décodage tolérant, micro-rotation, colorimétrie, triple resize
  // (aux dimensions sur-dimensionnées), puis recadrage central à la cible.
  const pipeline = sharp(input, { failOn: "none", autoOrient: o.autoOrient })
    .rotate(o.rotationDegrees, { background: { r: 128, g: 128, b: 128 } })
    .modulate({ saturation: o.saturationFactor, brightness: o.brightnessFactor })
    .resize(frameW, frameH, {
      kernel: "lanczos3",
      fit: "cover",
      position: "centre",
    })
    .resize(Math.max(8, frameW - 4), Math.max(8, frameH - 8), {
      kernel: "lanczos2",
      fit: "fill",
    })
    .resize(frameW, frameH, { kernel: "lanczos2", fit: "fill" })
    .extract({ left: padX, top: padY, width: w, height: h });

  // ⚠️ Étape 5 — NE PAS SUPPRIMER : c'est ici, et NULLE PART AILLEURS, que les
  // métadonnées sont nettoyées. Le PNG intermédiaire est produit vierge ; en
  // repartant de ce buffer, aucune métadonnée de provenance de la source ne peut
  // survivre. Le détour paraît redondant (on ressort en JPEG) — il ne l'est pas.
  const pngBuffer = await pipeline.png().toBuffer();

  // Étapes 6-7 : ré-encodage JPEG. Pas de withMetadata() (cf. en-tête).
  // `flatten` AVANT `jpeg` : le PNG intermédiaire a conservé l'alpha, on le
  // compose sur un fond opaque plutôt que de laisser Sharp le poser sur du noir.
  // No-op sur une source déjà opaque.
  let out = sharp(pngBuffer)
    .flatten({ background: o.flattenBackground })
    .jpeg({
      quality: o.jpegQuality,
      mozjpeg: true,
    });
  if (o.keepIccProfile) out = out.withIccProfile("srgb");

  return out.toBuffer();
}

/**
 * Étape 9 — garde C2PA : DÉTECTION seule (diagnostic/log), pas suppression. Le
 * nettoyage est fait par l'étape 5. Inspecte les 4096 premiers octets, où les
 * segments de provenance (JUMBF/APP11) sont placés.
 */
export function hasC2PAMarker(input: Buffer): boolean {
  const head = input.subarray(0, 4096).toString("latin1");
  return ["jumb", "jumdc2pa", "c2pa"].some((m) => head.includes(m));
}

/**
 * Nom de fichier de sortie : la sortie est toujours du JPEG, l'extension doit
 * suivre (un .png contenant du JPEG casserait les téléchargements créateur).
 */
export function toJpegFileName(name: string): string {
  const trimmed = name.trim() || "image";
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${stem}.jpg`;
}
