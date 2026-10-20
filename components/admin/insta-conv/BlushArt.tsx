"use client";

import { useId, type CSSProperties } from "react";

/**
 * Le logo et les glyphes du chat BLUSH, PORTÉS du front BLUSH (src/components/
 * brand/objects3d.tsx, src/components/ui/icons.tsx) : mêmes tracés, mêmes
 * dégradés. Le logo est dessiné en SVG pur (l'app le pose en calques HTML pour
 * l'animer sur le compositeur ; le dessin est le même), et « BLUSH écrit » est
 * une image FIXE de son animation : la première perle en haut, la deuxième qui
 * monte, la troisième au repos (keyframes pearlWave de l'app, à 0,4 s).
 */

type Stop = readonly [string, string];

const SPHERE_STOPS = {
  nacre: [
    ["0", "#FFFFFF"],
    ["0.38", "#F3F1F7"],
    ["0.78", "#CEC8DB"],
    ["1", "#A79FBC"],
  ],
  opale: [
    ["0", "#FFFFFF"],
    ["0.16", "#DDFFF5"],
    ["0.4", "#A3D3FF"],
    ["0.64", "#E4B2FF"],
    ["0.86", "#FFC49B"],
    ["1", "#E39A86"],
  ],
} satisfies Record<string, readonly Stop[]>;

function Stops({ stops }: { stops: readonly Stop[] }) {
  return (
    <>
      {stops.map(([o, c]) => (
        <stop key={o} offset={o} stopColor={c} />
      ))}
    </>
  );
}

function useSvgId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Une perle (opale : celle des bulles du compteur), sans ombre. */
export function Perle({ size }: { size: number }) {
  const u = useSvgId("pe");
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible", flexShrink: 0, display: "block" }}>
      <defs>
        <radialGradient id={`${u}g`} cx="0.36" cy="0.3" r="0.78">
          <Stops stops={SPHERE_STOPS.opale} />
        </radialGradient>
        <radialGradient id={`${u}r`} cx="0.62" cy="0.92" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />{/* i18n-exempt: valeurs SVG (cette ligne et la suivante) */}
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}s`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />{/* i18n-exempt: valeurs SVG (cette ligne et la suivante) */}
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${u}g)`} />
      <circle cx="50" cy="50" r="46" fill={`url(#${u}r)`} />
      <ellipse cx="35" cy="29" rx="17" ry="10" transform="rotate(-32 35 29)" fill={`url(#${u}s)`} />
      <circle cx="29" cy="25" r="3.4" fill="#FFFFFF" />
    </svg>
  );
}

const BUBBLE_BODY = "M60 55 H140 A45 45 0 0 1 140 145 H76 C68 153 57 159 44 161 C51 153 53 146 51 140 A45 45 0 0 1 60 55 Z";

/**
 * Une image de « BLUSH écrit » (pearlWave à 0,4 s) : par perle, son décalage
 * (fraction de la perle), son échelle et son opacité ; par ombre, l'échelle et
 * l'opacité. Au repos (animation hors d'écriture) : rien.
 */
const ECRIT = [
  { ty: -0.18, s: 1.16, o: 1, ombre: { s: 0.55, o: 0.35 } },
  { ty: -0.045, s: 1.04, o: 0.66, ombre: { s: 0.89, o: 0.84 } },
  { ty: 0, s: 1, o: 0.55, ombre: { s: 1, o: 1 } },
] as const;

/**
 * Le logo officiel : la bulle rose en volume, deux perles nacre et une opale.
 * `ecrit` : BLUSH écrit (ses perles s'allument l'une après l'autre). En grand
 * (≥ 44 px, `detail`), le halo, le reflet du bas et les deux points de lumière.
 */
export function BubbleLogo({ size, ecrit = false, style }: { size: number; ecrit?: boolean; style?: CSSProperties }) {
  const u = useSvgId("bp");
  const detail = size >= 44;
  const ombre = detail ? { rx: 9, ry: 2.6, fill: "rgba(110,0,50,0.35)", filter: `url(#${u}d)` } : { rx: 11, ry: 4.6, fill: `url(#${u}s)` };
  const dot = (cx: number, kind: "nacre" | "opale", i: number) => {
    const f = ecrit ? ECRIT[i] : null;
    // L'animation de l'app tourne autour du centre de la perle (transform-box: fill-box).
    const perle = f ? `translate(13 ${13 + f.ty * 26}) scale(${f.s}) translate(-13 -13)` : undefined;
    const sombre = f ? `translate(13 27) scale(${f.ombre.s}) translate(-13 -27)` : undefined;
    return (
      <g key={cx} transform={`translate(${cx - 13} 88)`}>
        <ellipse cx="13" cy="27" {...ombre} transform={sombre} opacity={f?.ombre.o} />
        <g transform={perle} opacity={f?.o}>
          <svg x="0" y="0" width="26" height="26" viewBox="0 0 100 100">
            <defs>
              <radialGradient id={`${u}${kind}${cx}`} cx="0.36" cy="0.3" r="0.78">
                <Stops stops={SPHERE_STOPS[kind]} />
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="46" fill={`url(#${u}${kind}${cx})`} />
            <ellipse cx="35" cy="29" rx="15" ry="9" transform="rotate(-32 35 29)" fill="#FFFFFF" opacity="0.85" />
          </svg>
        </g>
      </g>
    );
  };
  return (
    <svg aria-hidden width={size} height={size} viewBox="30 40 150 136" style={{ overflow: "visible", flexShrink: 0, display: "block", ...style }}>
      <defs>
        <radialGradient id={`${u}b`} cx="0.3" cy="0.22" r="0.95">
          <stop offset="0" stopColor="#FFD7EA" />{/* i18n-exempt: valeurs SVG (cette ligne et la suivante) */}
          <stop offset="0.32" stopColor="#FF7DBA" />
          <stop offset="0.72" stopColor="#E8358A" />
          <stop offset="1" stopColor="#A50F55" />
        </radialGradient>
        <linearGradient id={`${u}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />{/* i18n-exempt: valeurs SVG (cette ligne et la suivante) */}
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}o`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#7A0035" stopOpacity="0" />
          <stop offset="1" stopColor="#7A0035" stopOpacity="0.32" />
        </linearGradient>
        {detail && (
          <>
            <filter id={`${u}c`} x="-50%" y="-300%" width="200%" height="700%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
            <filter id={`${u}d`} x="-50%" y="-300%" width="200%" height="700%">
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
          </>
        )}
        {!detail && (
          <radialGradient id={`${u}s`}>
            <stop offset="0" stopColor="#6E0032" stopOpacity="0.33" />
            <stop offset="0.4" stopColor="#6E0032" stopOpacity="0.27" />
            <stop offset="0.7" stopColor="#6E0032" stopOpacity="0.14" />
            <stop offset="1" stopColor="#6E0032" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>
      {/* i18n-exempt: référence SVG (ligne suivante) */}
      {detail && <ellipse cx="102" cy="168" rx="52" ry="6" fill="rgba(190,20,100,0.28)" filter={`url(#${u}c)`} />}
      <path d={BUBBLE_BODY} fill={`url(#${u}b)`} />
      <path d={BUBBLE_BODY} fill={`url(#${u}o)`} />
      {/* i18n-exempt: référence SVG (ligne suivante) */}
      {detail && <path d="M66 141 Q100 151 140 142" fill="none" stroke="#FFC7E4" strokeWidth="3" strokeLinecap="round" opacity="0.65" filter={`url(#${u}d)`} />}
      <path d="M64 62 H136 A34 34 0 0 1 163 76 C135 69 96 69 58 84 A38 38 0 0 1 64 62 Z" fill={`url(#${u}h)`} opacity="0.75" />
      {detail && (
        <>
          <circle cx="150" cy="70" r="3.6" fill="#FFFFFF" opacity="0.9" />
          <circle cx="158" cy="80" r="1.8" fill="#FFFFFF" opacity="0.7" />
        </>
      )}
      <g>{[dot(70, "nacre", 0), dot(100, "nacre", 1), dot(130, "opale", 2)]}</g>
    </svg>
  );
}

/* Icônes au trait de l'app (viewBox 24), celles que montre le chat. */
const PATHS = {
  chevron: ["M9 6l6 6-6 6"],
  share: ["M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"],
  copy: ["M8 8h11v11H8zM5 16V5h11"], // i18n-exempt: tracés SVG (cette ligne et la suivante)
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"],
  close: ["M6 6l12 12M18 6L6 18"],
  plus: ["M12 5v14M5 12h14"],
  play: ["M8.5 5.8v12.4c0 .6.7 1 1.2.7l9.6-6.2c.5-.3.5-1.1 0-1.4L9.7 5.1c-.5-.3-1.2 0-1.2.7z"],
  wave: ["M4 10.5v3", "M8 7.5v9", "M12 4.5v15", "M16 8v8", "M20 10.5v3"],
} as const;

export type BlushIconName = keyof typeof PATHS;

export function BlushIcon({
  name,
  size,
  stroke = 2.2,
  color = "currentColor",
  fill = "none",
  style,
}: {
  name: BlushIconName;
  size: number;
  stroke?: number;
  color?: string;
  fill?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block", ...style }}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
