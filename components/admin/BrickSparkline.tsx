/**
 * COURBE MINIATURE d'une brique de script — les vues de ses derniers runs, dans
 * l'ordre de publication.
 *
 * Ce qu'elle ajoute à la médiane affichée juste à côté : la médiane range à
 * égalité un hook régulier et un hook qui a explosé une fois avant de
 * s'effondrer. La pente, elle, les sépare d'un coup d'œil — c'est la question
 * qu'on se pose devant la liste (« est-ce que ça tient encore ? »), pas celle
 * du niveau absolu.
 *
 * DÉLIBÉRÉMENT MUETTE : ni axes, ni graduations, ni valeurs. Elle ne sert pas à
 * lire un chiffre (il est à côté) mais à repérer une forme. Le détail chiffré
 * vit dans l'onglet Analytics, qui a la place de le rendre honnêtement.
 *
 * Rien à rendre sous deux points : un point unique n'a pas de pente, et une
 * courbe plate inventée serait un mensonge visuel.
 */
export function BrickSparkline({
  values,
  className,
}: {
  /** Vues des derniers runs, du plus ancien au plus récent. */
  values: readonly number[];
  className?: string;
}) {
  if (values.length < 2) return null;

  const width = 52;
  const height = 16;
  const pad = 1.5;
  const max = Math.max(...values);
  const min = Math.min(...values);
  // Une série constante (span 0) diviserait par zéro : on la trace à plat, au
  // milieu — c'est exactement ce qu'elle dit.
  const span = max - min || 1;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const last = points[points.length - 1];
  // Le DERNIER run porte la lecture (« et maintenant ? ») : il est le seul point
  // marqué. Sans lui, on ne sait pas de quel côté la courbe se lit.
  const dernier = values[values.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`${values.length} derniers runs, du plus ancien au plus récent ; dernier : ${dernier.toLocaleString("fr-FR")} vues`}
    >
      <polyline
        points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
      />
      <circle
        cx={last[0].toFixed(1)}
        cy={last[1].toFixed(1)}
        r={1.9}
        fill="currentColor"
      />
    </svg>
  );
}
