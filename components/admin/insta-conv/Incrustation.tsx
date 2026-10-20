"use client";

/**
 * Le texte incrusté d'une capture, à la TikTok (« t'étais un 10/10 quand… ») :
 * le style « fond » de l'éditeur de TikTok, un surlignage blanc par ligne, texte
 * noir, centré. Posé par-dessus l'écran (Instagram ou BLUSH), il sort dans le PNG :
 * la capture est prête à poster.
 */

const SYSTEM_FONT = "system-ui, -apple-system, 'SF Pro Display', sans-serif"; // i18n-exempt: pile de polices CSS

export const INCRUSTATION = { fontSize: 20, lineHeight: 30, padX: 9, padY: 4, radius: 7, maxWidth: 336 } as const;

export function Incrustation({ text, top }: { text: string; top: number }) {
  const I = INCRUSTATION;
  return (
    <div
      data-incrustation=""
      style={{ position: "absolute", left: 0, right: 0, top, zIndex: 30, display: "flex", justifyContent: "center", pointerEvents: "none" }}
    >
      <div
        style={{
          maxWidth: I.maxWidth,
          textAlign: "center",
          fontFamily: SYSTEM_FONT,
          fontSize: I.fontSize,
          lineHeight: `${I.lineHeight}px`,
          fontWeight: 700,
          letterSpacing: -0.2,
          color: "#000000",
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        }}
      >
        <span
          style={{
            background: "#FFFFFF",
            padding: `${I.padY}px ${I.padX}px`,
            borderRadius: I.radius,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}
