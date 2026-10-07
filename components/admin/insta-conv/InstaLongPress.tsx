"use client";

import type { ScreenStrings } from "@/lib/insta-conv";

/**
 * APPUI LONG — relevé sur deux captures (message reçu, message envoyé) : la
 * conversation floutée derrière, la barre de réactions (394×65 pt à 342,5 pt),
 * la bulle à 12,5 pt dessous, puis le menu (181 pt de large, lignes de 56 pt).
 * La bulle elle-même est rendue par l'écran (`children`) : même dessin que dans
 * le fil.
 */

const REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"]; // i18n-exempt: emojis par défaut d'Instagram
/** Centres des emojis (pt, repère de l'écran), relevés sur capture. */
const REACTION_X = [51.5, 103, 154, 205.5, 257, 308.5];
const RED = "#EB7488";
const EDIT_PATH = "M14.6 3.6a2.1 2.1 0 0 1 3 0l.8.8a2.1 2.1 0 0 1 0 3L8 17.8 3.2 19l1.2-4.8L14.6 3.6ZM12.8 5.4l3.8 3.8"; // i18n-exempt: tracé SVG, pas du texte
const WHITE = "#F5F5F5";

export const LONG_PRESS = {
  barTop: 342.5,
  barHeight: 65,
  barToBubble: 12.5,
  bubbleToMenu: 12,
  menuWidth: 181,
  menuRow: 56,
  menuFirstRow: 37.5,
  /** Marges : la bulle et le menu sont à 10-11 pt du bord, sans colonne d'avatar. */
  inLeft: 11,
  outRight: 10,
} as const;

type Item = { key: keyof ScreenStrings["menu"]; red?: boolean; chevron?: boolean };

const ITEMS_IN: Item[] = [
  { key: "reply" },
  { key: "addSticker" },
  { key: "forward" },
  { key: "deleteForYou" },
  { key: "report", red: true },
  { key: "more", chevron: true },
];
const ITEMS_OUT: Item[] = [
  { key: "reply" },
  { key: "edit" },
  { key: "addSticker" },
  { key: "deleteForYou" },
  { key: "unsend", red: true },
  { key: "more", chevron: true },
];

export function ReactionBar() {
  return (
    <div
      style={{
        position: "relative",
        marginLeft: 10,
        width: 394,
        height: LONG_PRESS.barHeight,
        borderRadius: LONG_PRESS.barHeight / 2,
        background: "#191B1F",
      }}
    >
      {REACTIONS.map((e, i) => (
        <span
          key={e}
          style={{
            position: "absolute",
            left: REACTION_X[i] - 10 - 25,
            width: 50,
            top: 0,
            height: LONG_PRESS.barHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 34,
            lineHeight: 1,
          }}
        >
          {e}
        </span>
      ))}
      <svg
        width={22}
        height={22}
        viewBox="0 0 22 22"
        aria-hidden
        style={{ position: "absolute", left: 360 - 10 - 11, top: LONG_PRESS.barHeight / 2 - 11 }}
      >
        <path d="M11 2.5v17M2.5 11h17" stroke="#9DA3A8" strokeWidth={1.6} strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function LongPressMenu({ side, strings, time }: { side: "in" | "out"; strings: ScreenStrings; time: string }) {
  const items = side === "in" ? ITEMS_IN : ITEMS_OUT;
  return (
    <div
      style={{
        position: "relative",
        alignSelf: side === "in" ? "flex-start" : "flex-end",
        marginLeft: side === "in" ? 10.5 : 0,
        marginRight: side === "in" ? 0 : 11,
        width: LONG_PRESS.menuWidth,
        height: LONG_PRESS.menuFirstRow + items.length * LONG_PRESS.menuRow + 4.5,
        borderRadius: 14,
        background: "rgba(30,32,33,0.96)",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.16)",
      }}
    >
      <div style={{ position: "absolute", left: 19.5, top: 10.5, fontSize: 12, lineHeight: "16px", color: "#8E9399" }}>{time}</div>
      {items.map((it, i) => (
        <div
          key={it.key}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: LONG_PRESS.menuFirstRow + i * LONG_PRESS.menuRow,
            height: LONG_PRESS.menuRow,
            display: "flex",
            alignItems: "center",
          }}
        >
          <span style={{ position: "absolute", left: 18.5, top: (LONG_PRESS.menuRow - 24) / 2, width: 24, height: 24 }}>
            <MenuIcon name={it.key} color={it.red ? RED : WHITE} />
          </span>
          <span
            style={{
              position: "absolute",
              left: 56,
              fontSize: 17,
              lineHeight: "20px",
              letterSpacing: -0.43,
              color: it.red ? RED : WHITE,
              whiteSpace: "pre",
            }}
          >
            {strings.menu[it.key]}
          </span>
          {it.chevron && (
            <svg width={8} height={14} viewBox="0 0 8 14" aria-hidden style={{ position: "absolute", right: 20, top: (LONG_PRESS.menuRow - 14) / 2 }}>
              <path d="M1.2 1.2 7 7l-5.8 5.8" fill="none" stroke={WHITE} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

/** Icônes du menu, 24 pt — redessinées d'après capture. */
function MenuIcon({ name, color }: { name: Item["key"]; color: string }) {
  const p = { fill: "none", stroke: color, strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={24} height={24} viewBox="0 0 22 22" aria-hidden>
      {name === "reply" && <path {...p} d="M8.5 4.5 3 10l5.5 5.5M3.2 10H12c3.9 0 7 3.1 7 7v1" />}
      {name === "addSticker" && (
        <>
          <path {...p} d="M19 11.5V7a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h4.5" />
          <path {...p} d="M19 11.5c-4.4 0-7.5 3.1-7.5 7.5" />
          <path {...p} d="M7.6 12.6c.9 1.3 2.1 2 3.6 2" />
          <circle cx={7.8} cy={8.6} r={1.1} fill={color} />
          <circle cx={13.2} cy={8.6} r={1.1} fill={color} />
          <path {...p} d="M18.5 1.5v4M16.5 3.5h4" />
        </>
      )}
      {/* L'avion « direct » d'Instagram : triangle ouvert, pointe en haut à droite. */}
      {name === "forward" && <path {...p} d="M20 2.8 8.4 9.3M10.7 18.8 20 2.8H2l6.4 6.5 2.3 9.5Z" />}
      {name === "deleteForYou" && (
        <>
          <path {...p} d="M3 5.5h16M8.5 5.5V3.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" />
          <path {...p} d="M5 5.5 6 18.2c.1 1 .9 1.8 1.9 1.8h6.2c1 0 1.8-.8 1.9-1.8L17 5.5" />
        </>
      )}
      {name === "report" && (
        <>
          <path {...p} d="M6 2.8h10a3.2 3.2 0 0 1 3.2 3.2v8a3.2 3.2 0 0 1-3.2 3.2h-3.2L11 19.6 9.2 17.2H6A3.2 3.2 0 0 1 2.8 14V6A3.2 3.2 0 0 1 6 2.8Z" />
          <path {...p} d="M11 6.4v5" />
          <circle cx={11} cy={14} r={1.1} fill={color} />
        </>
      )}
      {name === "more" && (
        <>
          <circle cx={4} cy={11} r={1.4} fill={color} />
          <circle cx={11} cy={11} r={1.4} fill={color} />
          <circle cx={18} cy={11} r={1.4} fill={color} />
        </>
      )}
      {name === "edit" && <path {...p} d={EDIT_PATH} />}
      {name === "unsend" && (
        <>
          <circle {...p} cx={11} cy={11} r={8.5} />
          <path {...p} d="M8.6 8.2 6.4 10.4l2.2 2.2M6.6 10.4h5.6a2.9 2.9 0 0 1 0 5.8h-1.4" />
        </>
      )}
    </svg>
  );
}
