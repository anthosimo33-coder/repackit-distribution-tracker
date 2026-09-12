"use client";

import { formatMoney } from "@/lib/format-rate";
import {
  quadrantScale,
  bubbleRadius,
  auDessusDuSeuil,
  marchesPlacables,
  valeurA,
} from "@/lib/market-plot";
import type { MarketDerived } from "@/lib/market-aggregate";

/**
 * CE QU'UN CLIENT COÛTE, CE QU'IL RAPPORTE — le graphe qui porte l'arbitrage.
 *
 * En abscisse le coût d'acquisition, en ordonnée la valeur à 90 jours, et une
 * DIAGONALE : au-dessus, un client rapporte plus qu'il n'a coûté. Tout se lit en
 * une seconde, là où les onze colonnes du tableau demandent d'être parcourues.
 *
 * ── LA DIAGONALE N'EST DROITE QUE SI LES DEUX AXES SONT ÉGAUX ───────────────
 * L'échelle est UNIQUE et commune (cf `lib/market-plot`). C'est la condition de
 * validité du graphe, pas une préférence esthétique : deux échelles ajustées
 * chacune à ses données feraient pencher le seuil, et un marché déficitaire
 * passerait du bon côté.
 *
 * ── DU SVG, PAS UNE BIBLIOTHÈQUE ────────────────────────────────────────────
 * Même choix que la carte « Vues × Intent » : la projection devient une fonction
 * PURE, testée en vitest, au lieu d'un réglage d'options. Ici s'ajoute une
 * raison propre — la zone rentable est un TRIANGLE sous la diagonale, qu'aucune
 * bibliothèque de nuages de points ne sait peindre.
 */
export function MarketQuadrant({
  marches,
  devise,
  selection,
  onSelect,
}: {
  marches: MarketDerived[];
  devise: string | null;
  selection: string | null;
  onSelect: (key: string) => void;
}) {
  const places = marchesPlacables(marches);
  const echelle = quadrantScale(places);
  const maxClients = places.reduce((m, x) => Math.max(m, x.clients), 0);
  /** Combien de marchés le graphe ne peut PAS placer — il doit le dire. */
  const absents = marches.length - places.length;

  // Repère en pourcentages : le SVG s'étire, les positions restent justes.
  const W = 100;
  const H = 100;
  const px = (f: number) => f * W;
  // `y` monte dans l'échelle, descend dans le SVG.
  const py = (f: number) => H - f * H;
  const argent = (n: number) => formatMoney(n, devise ?? undefined);

  if (places.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-xs text-slate-400">
        Aucun marché n&apos;a encore assez de recul pour être placé : il faut un
        coût par client et une valeur à 90 jours.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto aspect-square w-full max-w-[26rem] overflow-visible"
        role="img"
        aria-label="Coût d'acquisition d'un client contre sa valeur à 90 jours, par marché"
      >
        {/* Zone rentable : le triangle AU-DESSUS de la diagonale. */}
        <path
          d={`M ${px(echelle.x(0))} ${py(echelle.y(0))} L ${px(echelle.x(echelle.max))} ${py(echelle.y(echelle.max))} L ${px(echelle.x(0))} ${py(echelle.y(echelle.max))} Z`}
          fill="#ecfdf5"
        />
        {/* Grille et graduations */}
        {echelle.ticks.map((t) => (
          <g key={t}>
            <line
              x1={px(echelle.x(0))}
              y1={py(echelle.y(t))}
              x2={px(echelle.x(echelle.max))}
              y2={py(echelle.y(t))}
              stroke="#e2e8f0"
              strokeWidth={0.35}
            />
            <line
              x1={px(echelle.x(t))}
              y1={py(echelle.y(0))}
              x2={px(echelle.x(t))}
              y2={py(echelle.y(echelle.max))}
              stroke="#e2e8f0"
              strokeWidth={0.35}
            />
            <text
              x={px(echelle.x(0)) - 1}
              y={py(echelle.y(t)) + 1}
              textAnchor="end"
              fontSize={3.2}
              fill="#94a3b8"
            >
              {argent(t)}
            </text>
            {t > 0 ? (
              <text
                x={px(echelle.x(t))}
                y={py(echelle.y(0)) + 4}
                textAnchor="middle"
                fontSize={3.2}
                fill="#94a3b8"
              >
                {argent(t)}
              </text>
            ) : null}
          </g>
        ))}
        {/* Le seuil */}
        <line
          x1={px(echelle.x(0))}
          y1={py(echelle.y(0))}
          x2={px(echelle.x(echelle.max))}
          y2={py(echelle.y(echelle.max))}
          stroke="#059669"
          strokeWidth={0.5}
          strokeDasharray="2 1.5"
        />
        {/* Posé AU MILIEU de la diagonale et non à son bout : à l'extrémité il
            débordait du cadre par le haut. */}
        <text
          x={px(echelle.x(echelle.max * 0.62))}
          y={py(echelle.y(echelle.max * 0.62)) + 4.2}
          textAnchor="middle"
          fontSize={3.2}
          fill="#059669"
          stroke="#ffffff"
          strokeWidth={1.1}
          paintOrder="stroke"
        >
          seuil : rapporte = coûte
        </text>
        {/* Les marchés — les plus gros d'abord, pour que les petits restent
            cliquables par-dessus. */}
        {[...places]
          .sort((a, b) => b.clients - a.clients)
          .map((m) => {
            const v90 = valeurA(m, 90) ?? 0;
            const cx = px(echelle.x(m.cac ?? 0));
            const cy = py(echelle.y(v90));
            const r = bubbleRadius(m.clients, maxClients) * W;
            const dessus = auDessusDuSeuil(m);
            const gratuit = (m.cac ?? 0) === 0;
            const teinte = gratuit ? "#6d28d9" : dessus ? "#0d7a6f" : "#c01048";
            const choisi = selection === m.key;
            return (
              <g
                key={m.key}
                className="cursor-pointer"
                onClick={() => onSelect(m.key)}
                role="button"
                tabIndex={0}
                aria-label={`${m.label} : ${argent(m.cac ?? 0)} par client, ${argent(v90)} à 90 jours`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(m.key);
                  }
                }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={teinte}
                  fillOpacity={choisi ? 0.4 : 0.18}
                  stroke={teinte}
                  strokeWidth={choisi ? 1 : 0.5}
                />
                {/* Halo blanc : deux marchés voisins se chevauchent forcément
                    (la Suisse et le Canada ne coûtent rien tous les deux), et
                    sans lui une étiquette posée sur une bulle devient illisible. */}
                <text
                  x={cx}
                  y={cy - r - 1.6}
                  textAnchor="middle"
                  fontSize={3.6}
                  fontWeight={600}
                  fill="#0f172a"
                  stroke="#ffffff"
                  strokeWidth={1.1}
                  paintOrder="stroke"
                >
                  {m.label}
                </text>
              </g>
            );
          })}
      </svg>
      <p className="text-xs text-slate-400">
        La diagonale est le seuil : <strong>au-dessus, un client rapporte plus
        qu&apos;il n&apos;a coûté</strong>. La taille d&apos;une bulle est son
        nombre de clients. Les marchés collés à l&apos;axe gauche ne coûtent rien,
        aucune créatrice ne les vise.
        {absents > 0 ? (
          <>
            {" "}
            {absents} marché{absents > 1 ? "s ne sont" : " n'est"} pas placé
            {absents > 1 ? "s" : ""} : sans client, il n&apos;y a ni coût par
            client ni valeur à porter en hauteur. On les retrouve dans le
            remboursement.
          </>
        ) : null}
      </p>
    </div>
  );
}
