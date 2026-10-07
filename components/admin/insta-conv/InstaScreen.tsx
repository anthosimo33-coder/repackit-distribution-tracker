"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import {
  METRICS,
  SCREEN,
  SCREEN_STRINGS,
  THEMES,
  outGradientCss,
  planConversation,
  type Conversation,
  type ConvTheme,
  type PlannedMessage,
} from "@/lib/insta-conv";
import { ComposerIcons, HeaderIcons, HeartsLayer, StatusIcons } from "./InstaIcons";

/**
 * L'ÉCRAN — une capture de DM Instagram iOS redessinée en HTML, à 414×896 pt.
 * Rendu à l'échelle 1 (1 pt = 1 px CSS) ; l'aperçu le réduit par un `transform`
 * de son parent, l'export le rastérise ×2 (voir `exportScreenPng`).
 *
 * Deux calculs ne se font qu'APRÈS la mise en page, en mutant le DOM (React ne
 * gère ni `width` ni `backgroundPosition` des bulles, il ne les écrase donc pas) :
 *  1. largeur « serrée » des bulles sur plusieurs lignes : UIKit prend la plus
 *     longue ligne, ESPACE DE FIN COMPRIS (+4 pt mesurés), là où CSS prendrait
 *     la largeur max ;
 *  2. dégradé des bulles envoyées, fixé à l'ÉCRAN : chaque bulle montre la
 *     tranche du dégradé qui correspond à sa hauteur.
 */

const SYSTEM_FONT = "system-ui, -apple-system, 'SF Pro Text', sans-serif"; // i18n-exempt: pile de polices CSS
const AVATAR_PLACEHOLDER_BG = "linear-gradient(135deg, #5B5F66, #34383D)"; // i18n-exempt: couleur CSS

/** Haut de la boîte de ligne pour poser la ligne de base de SF Pro à `baseline`. */
function lineTop(baseline: number, fontSize: number, lineHeight: number): number {
  const ascent = 0.952 * fontSize;
  const content = (0.952 + 0.241) * fontSize;
  return baseline - ((lineHeight - content) / 2 + ascent);
}

export type InstaScreenHandle = { node: HTMLDivElement | null };

export const InstaScreen = forwardRef<InstaScreenHandle, { conversation: Conversation }>(
  function InstaScreen({ conversation }, ref) {
    const rootRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({ node: rootRef.current }), []);
    const theme = THEMES[conversation.themeId];
    const strings = SCREEN_STRINGS[conversation.locale];
    const plan = planConversation(conversation.items);

    useLayoutEffect(() => {
      const root = rootRef.current;
      if (!root) return;
      const bubbles = root.querySelectorAll<HTMLElement>("[data-bubble]");
      const scale0 = root.getBoundingClientRect().width / SCREEN.width || 1;
      bubbles.forEach((b) => {
        b.style.width = "";
        const top = b.getBoundingClientRect().top / scale0 + METRICS.bubble.padY;
        const range = document.createRange();
        range.selectNodeContents(b);
        // Étendue de chaque ligne (gauche min → droite max) : l'espace de fin d'une
        // ligne coupée y figure comme un rectangle à part, en bout de ligne.
        const lines = new Map<number, [number, number]>();
        for (const r of range.getClientRects()) {
          if (!r.width) continue;
          const k = Math.floor(((r.top + r.height / 2) / scale0 - top) / METRICS.bubble.lineHeight);
          const [l, rt] = lines.get(k) ?? [Infinity, -Infinity];
          lines.set(k, [Math.min(l, r.left), Math.max(rt, r.right)]);
        }
        if (lines.size > 1) {
          const widest = Math.max(...[...lines.values()].map(([l, r]) => r - l));
          b.style.width = `${widest / scale0 + 2 * METRICS.bubble.padX + 0.01}px`;
        }
      });
      const rootBox = root.getBoundingClientRect();
      const scale = rootBox.width / SCREEN.width || 1;
      root.querySelectorAll<HTMLElement>("[data-bubble='out']").forEach((b) => {
        const box = b.getBoundingClientRect();
        b.style.backgroundPosition = `${-(box.left - rootBox.left) / scale}px ${-(box.top - rootBox.top) / scale}px`;
      });
    });

    return (
      <div
        ref={rootRef}
        style={{
          position: "relative",
          width: SCREEN.width,
          height: SCREEN.height,
          overflow: "hidden",
          background: theme.background,
          fontFamily: SYSTEM_FONT,
          WebkitFontSmoothing: "antialiased",
          color: theme.text,
        }}
      >
        {theme.hearts && <HeartsLayer />}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: SCREEN.height - (METRICS.composerTop + 2) + METRICS.bottomGap,
            display: "flex",
            flexDirection: "column",
            transform: `translateY(${conversation.scroll}px)`, // i18n-exempt: valeur CSS
          }}
        >
          {plan.map((p, i) =>
            p.kind === "date" ? (
              <div
                key={p.item.id}
                style={{
                  marginTop: p.gapBefore,
                  marginBottom: METRICS.date.marginBottom,
                  textAlign: "center",
                  fontSize: METRICS.date.fontSize,
                  lineHeight: `${METRICS.date.lineHeight}px`,
                  fontWeight: 500,
                  color: theme.subtext,
                  whiteSpace: "pre",
                }}
              >
                {p.item.text}
              </div>
            ) : (
              <MessageRow
                key={p.item.id}
                p={p}
                theme={theme}
                first={i === 0}
                editedLabel={strings.edited}
                avatar={conversation.contact.avatar}
              />
            ),
          )}
        </div>
        <Header conversation={conversation} theme={theme} />
        <Composer theme={theme} placeholder={strings.placeholder} />
      </div>
    );
  },
);

function MessageRow({
  p,
  theme,
  first,
  editedLabel,
  avatar,
}: {
  p: PlannedMessage;
  theme: ConvTheme;
  first: boolean;
  editedLabel: string;
  avatar: string | null;
}) {
  const { item } = p;
  const isIn = item.side === "in";
  const B = METRICS.bubble;
  const side = isIn ? "Left" : "Right";
  const corners: React.CSSProperties = {
    borderRadius: B.radius,
    ...(p.joinedTop ? { [`borderTop${side}Radius`]: B.groupedRadius } : {}), // i18n-exempt: propriété CSS
    ...(p.joinedBottom ? { [`borderBottom${side}Radius`]: B.groupedRadius } : {}), // i18n-exempt: propriété CSS
  };
  const R = METRICS.reaction;
  return (
    <>
      {item.edited && (
        <div
          style={{
            marginTop: first ? 0 : METRICS.edited.marginTop,
            marginBottom: METRICS.edited.marginBottom,
            fontSize: METRICS.edited.fontSize,
            lineHeight: `${METRICS.edited.lineHeight}px`,
            fontWeight: 600,
            letterSpacing: -0.14,
            color: theme.edited,
            textAlign: isIn ? "left" : "right",
            paddingLeft: isIn ? METRICS.inIndent + METRICS.edited.inset : 0,
            paddingRight: isIn ? 0 : METRICS.outMargin + METRICS.edited.inset,
          }}
        >
          {editedLabel}
        </div>
      )}
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: isIn ? "flex-start" : "flex-end",
          alignItems: "flex-end",
          marginTop: p.gapBefore,
          marginBottom: item.reaction ? R.height - R.overlap : 0,
          paddingLeft: isIn ? METRICS.inIndent : 0,
          paddingRight: isIn ? 0 : METRICS.outMargin,
        }}
      >
        {p.jumbo ? (
          <div
            style={{
              fontSize: METRICS.jumbo.fontSize,
              lineHeight: `${METRICS.jumbo.lineHeight}px`,
              letterSpacing: METRICS.jumbo.letterSpacing,
              whiteSpace: "pre",
              transform: "translate(0.75px, 2.75px)",
            }}
          >
            {item.text.replace(/\s+/g, "")}
          </div>
        ) : (
          <div
            data-bubble={item.side}
            style={{
              boxSizing: "border-box",
              maxWidth: B.maxWidth,
              padding: `${B.padY}px ${B.padX}px`,
              fontSize: B.fontSize,
              lineHeight: `${B.lineHeight}px`,
              letterSpacing: B.letterSpacing,
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
              color: isIn ? theme.inText : theme.outText,
              ...(isIn
                ? { background: theme.inBubble }
                : {
                    backgroundImage: outGradientCss(theme),
                    backgroundSize: `${SCREEN.width}px ${SCREEN.height}px`,
                    backgroundRepeat: "no-repeat",
                  }),
              ...corners,
            }}
          >
            {withEmojiSpans(item.text)}
          </div>
        )}
        {p.showAvatar && (
          <Avatar
            src={avatar}
            size={METRICS.avatar.size}
            style={{ position: "absolute", left: METRICS.avatar.left, bottom: 0 }}
          />
        )}
        {item.reaction && (
          <div
            style={{
              position: "absolute",
              bottom: -(R.height - R.overlap) - R.ring,
              ...(isIn
                ? { left: METRICS.inIndent + R.inset - R.ring }
                : { right: METRICS.outMargin + R.inset - R.ring }),
              width: R.width,
              height: R.height,
              borderRadius: R.height / 2,
              border: `${R.ring}px solid ${theme.chrome === "transparent" ? "rgba(0,0,0,0.35)" : theme.background}`,
              background: theme.inBubble,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: R.emojiSize,
              lineHeight: 1,
              boxSizing: "content-box",
            }}
          >
            <span style={{ transform: "translateX(2.5px)" }}>{item.reaction}</span>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Emojis dans le texte d'une bulle : iOS les dessine ~17 % plus grands que
 * Chromium à corps égal (mesuré : 17 pt de large contre 14,5), centrés pareil.
 */
function withEmojiSpans(text: string): React.ReactNode {
  const parts = text.split(/(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*)/u);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} style={{ fontSize: `${METRICS.bubble.emojiScale}em`, lineHeight: 0, verticalAlign: "-0.06em", letterSpacing: 0.9 }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function Avatar({ src, size, style }: { src: string | null; size: number; style?: React.CSSProperties }) {
  const base: React.CSSProperties = { width: size, height: size, borderRadius: "50%", ...style };
  if (!src) {
    return (
      <div style={{ ...base, background: AVATAR_PLACEHOLDER_BG, overflow: "hidden" }}>
        <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden>
          <circle cx="14" cy="11" r="5" fill="#C9CDD2" />
          <path d="M4.5 25c1.6-4.6 5.2-7 9.5-7s7.9 2.4 9.5 7" fill="#C9CDD2" />
        </svg>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- data URL locale, rastérisée à l'export
  return <img src={src} alt="" style={{ ...base, objectFit: "cover" }} />;
}

function Header({ conversation, theme }: { conversation: Conversation; theme: ConvTheme }) {
  const { contact, status } = conversation;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: SCREEN.width,
        height: METRICS.headerBottom,
        background: theme.chrome,
      }}
    >
      {theme.hairline && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 103.5, height: 0.5, background: theme.hairline }} />
      )}
      {/* Heure : centrée dans l'oreille gauche, ligne de base à 30,75 pt. */}
      <div
        style={{
          position: "absolute",
          left: 51.75 - 40,
          width: 80,
          top: lineTop(30.75, 17, 20),
          textAlign: "center",
          fontSize: 17,
          lineHeight: "20px",
          fontWeight: 600,
          letterSpacing: -0.43,
          color: "#FFFFFF",
        }}
      >
        {status.time}
      </div>
      <StatusIcons battery={status.battery} lowPower={status.lowPower} signal={status.signal} />
      <HeaderIcons theme={theme} />
      <Avatar src={contact.avatar} size={32} style={{ position: "absolute", left: 64, top: 60 }} />
      <div
        style={{
          position: "absolute",
          left: 106,
          top: lineTop(74.25, 17, 20),
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 17,
          lineHeight: "20px",
          fontWeight: 600,
          letterSpacing: -0.35,
          color: theme.text,
          whiteSpace: "pre",
        }}
      >
        <span>{contact.name}</span>
        <svg width="6" height="11" viewBox="0 0 6 11" aria-hidden style={{ marginTop: 1 }}>
          <path d="M0.9 0.9 L5 5.5 L0.9 10.1" fill="none" stroke={theme.subtext} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div
        style={{
          position: "absolute",
          left: 106,
          top: lineTop(91.5, 12.5, 16),
          fontSize: 12.5,
          lineHeight: "16px",
          letterSpacing: 0,
          color: theme.subtext,
          whiteSpace: "pre",
        }}
      >
        {contact.username}
      </div>
    </div>
  );
}

function Composer({ theme, placeholder }: { theme: ConvTheme; placeholder: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: METRICS.composerTop,
        width: SCREEN.width,
        bottom: 0,
        background: theme.chrome,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 8,
          top: 810 - METRICS.composerTop,
          width: 398,
          height: 44,
          borderRadius: 22,
          background: theme.composer,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 13,
          top: 815 - METRICS.composerTop,
          width: 34,
          height: 34,
          borderRadius: 17,
          background: theme.cameraButton,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 57,
          top: lineTop(837.5, 17, 20) - METRICS.composerTop,
          fontSize: 17,
          lineHeight: "20px",
          letterSpacing: -0.43,
          color: theme.placeholder,
          whiteSpace: "pre",
        }}
      >
        {placeholder}
      </div>
      <ComposerIcons top={METRICS.composerTop} cameraColor={theme.cameraButton} />
    </div>
  );
}
