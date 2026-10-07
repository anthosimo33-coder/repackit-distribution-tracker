"use client";

import type { ConvTheme } from "@/lib/insta-conv";

/**
 * Icônes de l'écran Instagram, en SVG aux COORDONNÉES DE L'ÉCRAN (pt) : chaque
 * boîte reprend la position et la taille relevées sur capture (iPhone 414 pt).
 * Tracés redessinés à la main — l'écart se juge en superposant une capture.
 */

const WHITE = "#F8F9F9";

/** Barre d'état : 4 barres de réseau, Wi-Fi, batterie avec pourcentage. */
export function StatusIcons({ battery, lowPower, signal }: { battery: number; lowPower: boolean; signal: number }) {
  const bars = [4.5, 6.5, 9, 11.5];
  const level = Math.max(0, Math.min(100, Math.round(battery)));
  const bodyX = 370.5;
  const bodyW = 24;
  const fillColor = lowPower ? "#FFD600" : level <= 20 ? "#FF3B30" : "#FFFFFF";
  return (
    <>
      <svg
        width={414}
        height={44}
        viewBox="0 0 414 44"
        aria-hidden
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        {bars.map((h, i) => (
          <rect
            key={i}
            x={326.5 + i * 5}
            y={30.75 - h}
            width={3.5}
            height={h}
            rx={1}
            fill={i < signal ? "#FFFFFF" : "#3C4043"}
          />
        ))}
        {/* Wi-Fi : trois éventails concentriques centrés sur (357.75, 30.4). */}
        <g fill="#FFFFFF">
          <path d="M357.75 30.4 L353.9 26.5 A5.5 5.5 0 0 1 361.6 26.5 Z" />
          <path d="M351.6 24.3 A8.6 8.6 0 0 1 363.9 24.3 L362.2 26 A6.2 6.2 0 0 0 353.3 26 Z" />
          <path d="M349.3 22 A11.9 11.9 0 0 1 366.2 22 L364.5 23.7 A9.5 9.5 0 0 0 351 23.7 Z" />
        </g>
        <defs>
          <clipPath id="ic-battery-body">
            <rect x={bodyX} y={18} width={bodyW} height={13.5} rx={4.2} />
          </clipPath>
        </defs>
        {/* i18n-exempt: référence SVG */}
        <g clipPath="url(#ic-battery-body)">
          <rect x={bodyX} y={18} width={bodyW} height={13.5} fill="#858789" />
          <rect x={bodyX} y={18} width={(bodyW * level) / 100} height={13.5} fill={fillColor} />
        </g>
        <rect x={395.5} y={22.5} width={1.6} height={4.5} rx={0.8} fill={level === 100 ? fillColor : "#858789"} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: bodyX,
          top: 18,
          width: bodyW,
          height: 13.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: -0.2,
          color: "#000000",
          lineHeight: "13.5px",
        }}
      >
        {level}
      </div>
    </>
  );
}

/** En-tête : retour, appel, visio (l'avatar et les noms sont du HTML). */
export function HeaderIcons({ theme }: { theme: ConvTheme }) {
  const c = theme.text;
  return (
    <svg
      width={414}
      height={104}
      viewBox="0 0 414 104"
      aria-hidden
      style={{ position: "absolute", left: 0, top: 0 }}
      fill="none"
      stroke={c}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M39.9 67.2 L31.1 76 L39.9 84.8" strokeWidth={2.3} />
      {/* Combiné : retracé point par point sur capture (boîte 309–331 × 65–87). */}
      <path
        strokeWidth={1.9}
        d="M312.4 66.2C310.9 66.5 310.1 67.6 310.2 69.3C310.4 73.6 312.6 78.1 316.3 81.1C319.7 83.8 323.5 85.6 326.9 85.9C328.5 86 329.8 85.4 330.3 84.3C330.8 83.2 330.3 82 329.2 81.3L325.9 79C324.7 78.2 323.3 78.3 322.4 79C320.5 78.6 318.6 77 317.4 75.3C316.7 74.3 316.3 73.9 316.4 73.4C316.5 72.6 317.3 72 317.1 71L316.1 68.4C315.6 67.1 314 65.9 312.4 66.2Z"
      />
      {/* Caméra : corps 364.9–382.8 × 66.9–85.1, objectif 383.6–387.2. */}
      <rect x={364.9} y={66.9} width={17.4} height={18.2} rx={4} strokeWidth={1.75} />
      <path d="M383.4 72.6 L386 71.1 C386.6 70.8 387.2 71.2 387.2 71.9 V80.1 C387.2 80.8 386.6 81.2 386 80.9 L383.4 79.4" strokeWidth={1.75} />
    </svg>
  );
}

/** Barre de saisie : appareil photo, micro, galerie, sticker, plus. */
export function ComposerIcons({ top, cameraColor }: { top: number; cameraColor: string }) {
  return (
    <svg
      width={414}
      height={896 - top}
      viewBox={`0 ${top} 414 ${896 - top}`}
      aria-hidden
      style={{ position: "absolute", left: 0, top: 0 }}
      fill="none"
      stroke={WHITE}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
    >
      {/* Appareil photo plein, centré sur (30, 832). */}
      <path
        stroke="none"
        fill="#FFFFFF"
        d="M26.6 824.6h6.8c.6 0 1.1.3 1.4.8l.9 1.5h1.6c1.7 0 3 1.3 3 3v6.6c0 1.7-1.3 3-3 3H22.7c-1.7 0-3-1.3-3-3v-6.6c0-1.7 1.3-3 3-3h1.6l.9-1.5c.3-.5.8-.8 1.4-.8z"
      />
      <circle cx={30} cy={833} r={3.6} stroke={cameraColor} strokeWidth={1.9} fill="#FFFFFF" />
      {/* Micro : boîte 247.5–264.5 × 821–843. */}
      <rect x={252.2} y={821.8} width={7.6} height={13} rx={3.8} />
      <path d="M248.3 830.6c0 4.3 3.4 7.3 7.7 7.3s7.7-3 7.7-7.3M256 838v4.2M252.6 842.2h6.8" />
      {/* Galerie : boîte 283–305. */}
      <rect x={283.8} y={821.8} width={20.4} height={20.4} rx={4.2} />
      <circle cx={289} cy={827.3} r={1.5} fill={WHITE} stroke="none" />
      <path d="M284.2 838.6l5.6-5.4 4.2 3.9 3.2-3.1 6.7 6.1" />
      {/* Sticker : boîte 323–345, coin replié en bas à droite. */}
      <path d="M344.2 832.6v-6.6c0-2.3-1.9-4.2-4.2-4.2h-12c-2.3 0-4.2 1.9-4.2 4.2v12c0 2.3 1.9 4.2 4.2 4.2h6.6z" />
      <path d="M344.2 832.6c-4.5 0-8.6 1.7-9.6 9.6" />
      <circle cx={330} cy={829.4} r={1.4} fill={WHITE} stroke="none" />
      <circle cx={337.6} cy={829.4} r={1.4} fill={WHITE} stroke="none" />
      <path d="M329.2 834.4c1.1 1.5 2.7 2.3 4.6 2.3" />
      {/* Plus cerclé : boîte 362.5–385.5. */}
      <circle cx={374} cy={832} r={10.8} />
      <path d="M374 826.6v10.8M368.6 832h10.8" />
    </svg>
  );
}

/** Cœurs flous du thème « Cœurs » (inventé). Positions fixes : le fond ne bouge pas. */
export function HeartsLayer() {
  const hearts: Array<[number, number, number, number]> = [
    // x, y, taille, opacité
    [52, 26, 96, 0.55],
    [346, 176, 82, 0.45],
    [-24, 196, 120, 0.35],
    [-60, 330, 210, 0.3],
    [300, 470, 120, 0.4],
    [330, 610, 96, 0.35],
    [-30, 650, 130, 0.3],
    [180, 760, 70, 0.25],
  ];
  const heart =
    "M50 88 C22 70 2 52 2 31 C2 15 14 4 29 4 C38 4 46 9 50 16 C54 9 62 4 71 4 C86 4 98 15 98 31 C98 52 78 70 50 88 Z";
  return (
    <svg
      width={414}
      height={896}
      viewBox="0 0 414 896"
      aria-hidden
      style={{ position: "absolute", left: 0, top: 0 }}
    >
      <defs>
        <filter id="ic-hearts-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <linearGradient id="ic-heart-fill" x1="0" y1="0" x2="0" y2="1">
          {/* i18n-exempt: couleur SVG */}
          <stop offset="0" stopColor="#A42AA0" />
          <stop offset="1" stopColor="#6A1A6E" />
        </linearGradient>
      </defs>
      {/* i18n-exempt: référence SVG */}
      <g filter="url(#ic-hearts-blur)">
        {hearts.map(([x, y, s, o], i) => (
          <path
            key={i}
            d={heart}
            fill="url(#ic-heart-fill)"
            opacity={o}
            transform={`translate(${x} ${y}) scale(${s / 100}) rotate(${(i % 3) * 8 - 8} 50 50)`}
          />
        ))}
      </g>
    </svg>
  );
}
