"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  ENGINE_TUNING,
  MESSAGES_BOTTOM,
  METRICS,
  SCREEN,
  SCREEN_STRINGS,
  THEMES,
  formatDuration,
  outGradientCss,
  planConversation,
  renderEngine,
  voiceBars,
  voiceWidth,
  waveform,
  type Conversation,
  type ConvMessage,
  type ConvTheme,
  type EngineTuning,
  type PlannedMessage,
  type ScreenStrings,
} from "@/lib/insta-conv";
import { ComposerIcons, HeaderIcons, HeartsLayer, StatusIcons } from "./InstaIcons";
import { LONG_PRESS, LongPressMenu, ReactionBar } from "./InstaLongPress";

/**
 * L'ÉCRAN — une capture de DM Instagram iOS redessinée en HTML, à 414×896 pt.
 * Rendu à l'échelle 1 (1 pt = 1 px CSS) ; l'aperçu le réduit par un `transform`
 * de son parent, l'export le rastérise ×2 (voir `exportScreenPng`).
 *
 * Trois calculs ne se font qu'APRÈS la mise en page, en mutant le DOM (React ne
 * gère ni ces textes coupés, ni `width`, ni `backgroundPosition` : il ne les
 * écrase donc pas) :
 *  1. citation coupée à 3 lignes, terminée par « … more » comme Instagram ;
 *  2. largeur « serrée » des bulles sur plusieurs lignes : UIKit prend la plus
 *     longue ligne, ESPACE DE FIN COMPRIS (+4 pt mesurés), là où CSS prendrait
 *     la largeur max ;
 *  3. dégradé des bulles envoyées, fixé à l'ÉCRAN : chaque bulle montre la
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

const noSubscribe = () => () => {};
/** Moteur du navigateur ; « blink » au rendu serveur, corrigé à l'hydratation. */
function useRenderEngine(): "blink" | "webkit" {
  return useSyncExternalStore(noSubscribe, () => renderEngine(navigator.userAgent), () => "blink");
}

export const InstaScreen = forwardRef<InstaScreenHandle, { conversation: Conversation }>(
  function InstaScreen({ conversation }, ref) {
    const rootRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({ node: rootRef.current }), []);
    const theme = THEMES[conversation.themeId];
    const strings = SCREEN_STRINGS[conversation.locale];
    const plan = planConversation(conversation.items);
    const emoji = ENGINE_TUNING[useRenderEngine()];

    const pressed = conversation.items.find((it): it is ConvMessage => it.kind === "message" && !!it.longPress);

    useLayoutEffect(() => {
      const root = rootRef.current;
      if (!root) return;
      const rootBox = root.getBoundingClientRect();
      const scale = rootBox.width / SCREEN.width || 1;
      root.querySelectorAll<HTMLElement>("[data-clamp]").forEach(clampLines);
      root.querySelectorAll<HTMLElement>("[data-tight]").forEach((b) => tighten(b, scale));
      root.querySelectorAll<HTMLElement>("[data-grad]").forEach((b) => {
        const box = b.getBoundingClientRect();
        const pos = `${-(box.left - rootBox.left) / scale}px ${-(box.top - rootBox.top) / scale}px`;
        b.style.backgroundPosition = b.dataset.grad === "2" ? `0 0, ${pos}` : pos;
      });
    });

    const fil = (
      <>
        {theme.hearts && <HeartsLayer />}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: SCREEN.height - MESSAGES_BOTTOM,
            display: "flex",
            flexDirection: "column",
            transform: `translateY(${conversation.scroll}px)`, // i18n-exempt: valeur CSS
          }}
        >
          {plan.map((p, i) =>
            p.kind === "date" ? (
              <div
                key={p.item.id}
                data-item={i}
                style={{
                  marginTop: p.gapBefore,
                  marginBottom: METRICS.date.marginBottom,
                  textAlign: "center",
                  fontSize: METRICS.date.fontSize,
                  lineHeight: `${METRICS.date.lineHeight}px`,
                  fontWeight: 500,
                  color: theme.subtext,
                  whiteSpace: "pre",
                  position: "relative",
                  top: emoji.textShiftY,
                }}
              >
                {p.item.text}
              </div>
            ) : (
              <MessageRow
                key={p.item.id}
                index={i}
                p={p}
                theme={theme}
                first={i === 0}
                strings={strings}
                avatar={conversation.contact.avatar}
                emoji={emoji}
              />
            ),
          )}
        </div>
        <Header conversation={conversation} theme={theme} shift={emoji.textShiftY} />
        <Composer theme={theme} placeholder={strings.placeholder} shift={emoji.textShiftY} />
      </>
    );

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
        {pressed ? (
          <>
            {/* Appui long : le fil flouté et éclairci derrière, la barre d'état nette. */}
            <div style={{ position: "absolute", inset: 0, filter: "blur(24px)" }}>{fil}</div>
            <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.11)" }} />
            <StatusBar status={conversation.status} shift={emoji.textShiftY} />
            <div
              style={{
                position: "absolute",
                top: LONG_PRESS.barTop,
                left: 0,
                right: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <ReactionBar />
              <div
                style={{
                  marginTop: LONG_PRESS.barToBubble,
                  display: "flex",
                  justifyContent: pressed.side === "in" ? "flex-start" : "flex-end",
                  paddingLeft: pressed.side === "in" ? LONG_PRESS.inLeft : 0,
                  paddingRight: pressed.side === "in" ? 0 : LONG_PRESS.outRight,
                }}
              >
                <Body item={pressed} theme={theme} strings={strings} emoji={emoji} corners={{ borderRadius: METRICS.bubble.radius }} />
              </div>
              <div style={{ marginTop: LONG_PRESS.bubbleToMenu, display: "flex", flexDirection: "column" }}>
                <LongPressMenu side={pressed.side} strings={strings} time={pressed.time ?? conversation.status.time} />
              </div>
            </div>
          </>
        ) : (
          fil
        )}
      </div>
    );
  },
);

/** Coupe un texte à `data-clamp` lignes, terminé par « … » + `data-more` (citation). */
function clampLines(el: HTMLElement) {
  const full = el.dataset.full ?? "";
  const lines = Number(el.dataset.clamp) || 3;
  el.textContent = full;
  const cs = getComputedStyle(el);
  const max = lines * parseFloat(cs.lineHeight) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 1;
  if (el.offsetHeight <= max) return;
  const suffix = `… ${el.dataset.more ?? ""}`;
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.textContent = full.slice(0, mid).trimEnd() + suffix;
    if (el.offsetHeight <= max) lo = mid;
    else hi = mid - 1;
  }
  el.textContent = full.slice(0, lo).trimEnd() + suffix;
}

/** Largeur « serrée » façon UIKit d'une bulle sur plusieurs lignes. */
function tighten(b: HTMLElement, scale: number) {
  b.style.width = "";
  const cs = getComputedStyle(b);
  const lh = parseFloat(cs.lineHeight);
  const top = b.getBoundingClientRect().top / scale + parseFloat(cs.paddingTop);
  const range = document.createRange();
  range.selectNodeContents(b);
  // Étendue de chaque ligne (gauche min → droite max) : l'espace de fin d'une
  // ligne coupée y figure comme un rectangle à part, en bout de ligne.
  const lines = new Map<number, [number, number]>();
  for (const r of range.getClientRects()) {
    if (!r.width) continue;
    const k = Math.floor(((r.top + r.height / 2) / scale - top) / lh);
    const [l, rt] = lines.get(k) ?? [Infinity, -Infinity];
    lines.set(k, [Math.min(l, r.left), Math.max(rt, r.right)]);
  }
  if (lines.size > 1) {
    const widest = Math.max(...[...lines.values()].map(([l, r]) => r - l));
    b.style.width = `${widest / scale + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 0.01}px`;
  }
}

/** Fond d'une bulle envoyée : le dégradé de l'écran (positionné après la mise en page). */
function outBackground(theme: ConvTheme, shade?: string): React.CSSProperties {
  return shade
    ? {
        backgroundImage: `linear-gradient(${shade}, ${shade}), ${outGradientCss(theme)}`,
        backgroundSize: `100% 100%, ${SCREEN.width}px ${SCREEN.height}px`,
        backgroundRepeat: "no-repeat",
      }
    : {
        backgroundImage: outGradientCss(theme),
        backgroundSize: `${SCREEN.width}px ${SCREEN.height}px`,
        backgroundRepeat: "no-repeat",
      };
}

function MessageRow({
  index,
  p,
  theme,
  first,
  strings,
  avatar,
  emoji,
}: {
  index: number;
  p: PlannedMessage;
  theme: ConvTheme;
  first: boolean;
  strings: ScreenStrings;
  avatar: string | null;
  emoji: EngineTuning;
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
  const Q = METRICS.quote;
  const headerTop = first ? 0 : METRICS.label.marginTop;
  return (
    <>
      {item.edited && (
        <div
          data-item={index}
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
            position: "relative",
            top: emoji.textShiftY,
          }}
        >
          {strings.edited}
        </div>
      )}
      {item.story && (
        <StoryHeader index={index} item={item} strings={strings} theme={theme} marginTop={item.edited ? 0 : headerTop} shift={emoji.textShiftY} />
      )}
      {item.reply && (
        <>
          <Label
            index={index}
            side={item.side}
            text={isIn ? strings.repliedToYou : strings.youReplied}
            inset={METRICS.inIndent + Q.bar + Q.barGap}
            outInset={METRICS.outMargin + Q.bar + Q.barGap}
            marginTop={item.edited || item.story ? 6 : headerTop}
            shift={emoji.textShiftY}
          />
          <div
            data-item={index}
            style={{
              display: "flex",
              flexDirection: isIn ? "row" : "row-reverse",
              alignItems: "stretch",
              gap: Q.barGap,
              marginTop: Q.labelGap,
              paddingLeft: isIn ? METRICS.inIndent : 0,
              paddingRight: isIn ? 0 : METRICS.outMargin,
            }}
          >
            <div style={{ width: Q.bar, flexShrink: 0, borderRadius: Q.bar / 2, background: theme.inBubble }} />
            <QuotedBody item={item} theme={theme} strings={strings} shift={emoji.textShiftY} />
          </div>
        </>
      )}
      <div
        data-item={index}
        style={{
          position: "relative",
          display: "flex",
          justifyContent: isIn ? "flex-start" : "flex-end",
          alignItems: "flex-end",
          marginTop: item.reply ? Q.toBubble : item.story ? (item.story.unavailable ? METRICS.storyUnavailable.toBubble : 5.8) : p.gapBefore,
          marginBottom: item.reaction ? R.height - R.overlap : 0,
          paddingLeft: isIn ? METRICS.inIndent : 0,
          paddingRight: isIn ? 0 : METRICS.outMargin,
        }}
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Body item={item} jumbo={p.jumbo} theme={theme} strings={strings} emoji={emoji} corners={corners} />
          {item.reaction && (
            <div
              style={{
                position: "absolute",
                // Mesuré : à 5 pt du bord GAUCHE de la bulle, des deux côtés.
                left: R.inset - R.ring,
                top: `calc(100% - ${R.overlap + R.ring}px)`,
                width: R.width,
                height: R.height,
                borderRadius: R.height / 2,
                border: `${R.ring}px solid ${theme.chrome === "transparent" ? "rgba(0,0,0,0.35)" : theme.background}`,
                background: theme.inBubble,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: emoji.reactionSize,
                lineHeight: 1,
                boxSizing: "content-box",
              }}
            >
              {/* i18n-exempt: valeur CSS */}
              <span style={{ transform: `translateX(${emoji.reactionShiftX}px)` }}>{item.reaction}</span>
            </div>
          )}
        </div>
        {p.showAvatar && (
          <Avatar
            src={avatar}
            size={METRICS.avatar.size}
            style={{ position: "absolute", left: METRICS.avatar.left, bottom: 0 }}
          />
        )}
      </div>
    </>
  );
}

/**
 * La bulle CITÉE : celle de son auteur assombrie — texte (14,7 pt, 3 lignes au
 * plus, « … more »), ou pastille Photo/Vidéo, ou vocal sans transcription.
 */
function QuotedBody({ item, theme, strings, shift }: { item: ConvMessage; theme: ConvTheme; strings: ScreenStrings; shift: number }) {
  const reply = item.reply;
  if (!reply) return null;
  const Q = METRICS.quote;
  const B = METRICS.bubble;
  const out = reply.side === "out";
  const bg: React.CSSProperties = out ? outBackground(theme, Q.outShade) : { background: theme.quoteIn };
  const grad = out ? { "data-grad": "2" } : {};
  const color = out ? Q.outText : Q.inText;
  if (reply.kind === "photo" || reply.kind === "video") {
    return (
      <div
        {...grad}
        style={{
          width: METRICS.viewOnce.width,
          height: 40,
          borderRadius: 20,
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingLeft: 15,
          boxSizing: "border-box",
          color: out ? Q.outText : "#888B8D",
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: -0.43,
          ...bg,
        }}
      >
        <svg width={12} height={14} viewBox="0 0 12 14" aria-hidden>
          <path d="M1 1.6C1 .8 1.9.3 2.6.8l8.2 5.4c.6.4.6 1.3 0 1.7L2.6 13.2c-.7.5-1.6 0-1.6-.8Z" fill="currentColor" />
        </svg>
        <span style={{ position: "relative", top: shift }}>{reply.kind === "photo" ? strings.photo : strings.video}</span>
      </div>
    );
  }
  if (reply.kind === "voice") {
    const V = METRICS.voice;
    const seconds = reply.seconds ?? 3;
    const n = voiceBars(seconds);
    const width = voiceWidth(seconds);
    const h = 63.5;
    const cy = h / 2;
    return (
      <div {...grad} style={{ position: "relative", width, height: h, borderRadius: B.radius, ...bg }}>
        <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden style={{ position: "absolute", left: 0, top: 0 }}>
          <path transform={`translate(${V.playLeft} ${cy - 10})`} d="M0 1.7C0 .4 1.4-.4 2.5.3l15.2 8.6c1 .6 1 2 0 2.6L2.5 20.1C1.4 20.7 0 20 0 18.7Z" fill={color} />
          {waveform(`${item.id}:q`, n).map((bh, i) => (
            <rect key={i} x={V.firstBar + i * V.barPitch} y={cy - bh / 2} width={V.barWidth} height={bh} rx={V.barWidth / 2} fill={out ? "rgba(255,255,255,0.45)" : "#5A5D61"} />
          ))}
        </svg>
        <div
          style={{
            position: "absolute",
            left: V.firstBar + n * V.barPitch - (V.barPitch - V.barWidth) + V.durationGap,
            top: cy - 8 + shift,
            fontSize: 12,
            lineHeight: "16px",
            fontVariantNumeric: "tabular-nums",
            color,
          }}
        >
          {formatDuration(seconds)}
        </div>
      </div>
    );
  }
  return (
    <div
      data-tight
      data-clamp={Q.maxLines}
      data-full={reply.text}
      data-more={strings.menu.more.toLowerCase()}
      {...grad}
      style={{
        boxSizing: "border-box",
        maxWidth: Q.maxWidth,
        padding: `${B.padY + shift}px ${B.padX}px ${B.padY - shift}px`,
        fontSize: Q.fontSize,
        lineHeight: `${B.lineHeight}px`,
        letterSpacing: Q.letterSpacing,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        borderRadius: B.radius,
        color,
        ...bg,
      }}
    >
      {reply.text}
    </div>
  );
}

/** Libellé gris au-dessus d'une citation ou d'une réponse à une story. */
function Label({
  index,
  side,
  text,
  inset,
  outInset,
  marginTop,
  shift,
  fontSize = METRICS.label.fontSize,
  before,
}: {
  index: number;
  side: "in" | "out";
  text: React.ReactNode;
  inset: number;
  outInset: number;
  marginTop: number;
  shift: number;
  fontSize?: number;
  before?: React.ReactNode;
}) {
  return (
    <div
      data-item={index}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: side === "in" ? "flex-start" : "flex-end",
        gap: 4,
        marginTop,
        paddingLeft: side === "in" ? inset : 0,
        paddingRight: side === "in" ? 0 : outInset,
        fontSize,
        lineHeight: `${METRICS.label.lineHeight}px`,
        color: METRICS.label.color,
        whiteSpace: "pre",
        position: "relative",
        top: shift,
      }}
    >
      {before}
      <span>{text}</span>
    </div>
  );
}

/**
 * Réponse à une story : libellé (« Replied to your story », « You replied to
 * their story », variante « close friends » à l'étoile verte), et « Story
 * unavailable » quand elle a expiré. La miniature viendra avec les images.
 */
function StoryHeader({
  index,
  item,
  strings,
  theme,
  marginTop,
  shift,
}: {
  index: number;
  item: ConvMessage;
  strings: ScreenStrings;
  theme: ConvTheme;
  marginTop: number;
  shift: number;
}) {
  const isIn = item.side === "in";
  const story = item.story ?? {};
  const Q = METRICS.quote;
  const textInset = METRICS.bubble.padX;
  const label =
    isIn && story.closeFriends ? (
      <>
        {strings.repliedToCloseFriends[0]}
        <b style={{ fontWeight: 600 }}>{strings.repliedToCloseFriends[1]}</b>
        {strings.repliedToCloseFriends[2]}
      </>
    ) : isIn ? (
      strings.repliedToYourStory
    ) : (
      strings.youRepliedToStory
    );
  const star = isIn && story.closeFriends && (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
      <circle cx={7} cy={7} r={7} fill="#00D050" />
      <path d="M7 3.2 8.1 5.5l2.5.3-1.8 1.7.5 2.5L7 8.8 4.7 10l.5-2.5-1.8-1.7 2.5-.3Z" fill="#FFFFFF" />
    </svg>
  );
  return (
    <>
      <Label
        index={index}
        side={item.side}
        text={label}
        before={star}
        inset={story.closeFriends && isIn ? 68 : METRICS.inIndent + Q.bar + Q.barGap}
        outInset={METRICS.outMargin + textInset}
        marginTop={marginTop}
        shift={shift}
        fontSize={12.5}
      />
      {story.unavailable && (
        <div
          data-item={index}
          style={{
            display: "flex",
            flexDirection: isIn ? "row" : "row-reverse",
            alignItems: "stretch",
            gap: Q.barGap,
            marginTop: METRICS.storyUnavailable.gap,
            paddingLeft: isIn ? METRICS.inIndent : 0,
            paddingRight: isIn ? 0 : METRICS.outMargin,
          }}
        >
          <div style={{ width: Q.bar, flexShrink: 0, borderRadius: Q.bar / 2, background: theme.inBubble }} />
          <div
            style={{
              fontSize: 12.5,
              lineHeight: `${METRICS.storyUnavailable.lineHeight}px`,
              color: METRICS.label.color,
              whiteSpace: "pre",
              position: "relative",
              top: shift,
            }}
          >
            {strings.storyUnavailable}
          </div>
        </div>
      )}
    </>
  );
}

/** Le corps d'un message : bulle de texte, emojis en grand, vocal, photo/vidéo éphémère. */
function Body({
  item,
  jumbo = false,
  theme,
  strings,
  emoji,
  corners,
}: {
  item: ConvMessage;
  jumbo?: boolean;
  theme: ConvTheme;
  strings: ScreenStrings;
  emoji: EngineTuning;
  corners: React.CSSProperties;
}) {
  const isIn = item.side === "in";
  const B = METRICS.bubble;
  const bg: React.CSSProperties = isIn ? { background: theme.inBubble } : outBackground(theme);
  const grad = isIn ? {} : { "data-grad": "1" };
  const media = item.media;
  if (media?.type === "voice") return <Voice item={item} seconds={media.seconds} theme={theme} strings={strings} shift={emoji.textShiftY} />;
  if (media?.type === "photoOnce" || media?.type === "videoOnce") {
    const V = METRICS.viewOnce;
    return (
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          {...grad}
          style={{
            width: V.width,
            height: 40,
            borderRadius: 20,
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 15,
            boxSizing: "border-box",
            color: isIn ? METRICS.label.color : "rgba(255,255,255,0.6)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: -0.43,
            ...bg,
          }}
        >
          <svg width={12} height={14} viewBox="0 0 12 14" aria-hidden>
            <path d="M1 1.6C1 .8 1.9.3 2.6.8l8.2 5.4c.6.4.6 1.3 0 1.7L2.6 13.2c-.7.5-1.6 0-1.6-.8Z" fill="currentColor" />
          </svg>
          <span style={{ position: "relative", top: emoji.textShiftY }}>{media.type === "photoOnce" ? strings.photo : strings.video}</span>
        </div>
        {isIn && (
          <div
            style={{
              marginLeft: V.cameraGap,
              width: V.cameraSize,
              height: V.cameraSize,
              borderRadius: V.cameraSize / 2,
              background: theme.inBubble,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width={18} height={16} viewBox="0 0 18 16" aria-hidden fill="none" stroke="#FFFFFF" strokeWidth={1.6} strokeLinejoin="round">
              <path d="M6.3 1.5h5.4c.5 0 .9.3 1.1.7l.6 1.2h1.6c1.2 0 2.2 1 2.2 2.2v7c0 1.2-1 2.2-2.2 2.2H3c-1.2 0-2.2-1-2.2-2.2v-7c0-1.2 1-2.2 2.2-2.2h1.6l.6-1.2c.2-.4.6-.7 1.1-.7Z" />
              <circle cx={9} cy={9} r={3} />
            </svg>
          </div>
        )}
      </div>
    );
  }
  if (jumbo) {
    return (
      <div
        style={{
          fontSize: METRICS.jumbo.fontSize,
          lineHeight: `${METRICS.jumbo.lineHeight}px`,
          letterSpacing: emoji.jumboSpacing,
          whiteSpace: "pre",
          transform: `translate(${emoji.jumboShiftX}px, 2.75px)`,
        }}
      >
        {item.text.replace(/\s+/g, "")}
      </div>
    );
  }
  return (
    <div
      data-tight
      {...grad}
      style={{
        boxSizing: "border-box",
        maxWidth: B.maxWidth,
        padding: `${B.padY + emoji.textShiftY}px ${B.padX}px ${B.padY - emoji.textShiftY}px`,
        fontSize: B.fontSize,
        lineHeight: `${B.lineHeight}px`,
        letterSpacing: B.letterSpacing,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        color: isIn ? theme.inText : theme.outText,
        ...bg,
        ...corners,
      }}
    >
      {withEmojiSpans(item.text, emoji, isIn)}
    </div>
  );
}

/** Message vocal : lecture, forme d'onde déterministe, durée, « View transcription ». */
function Voice({
  item,
  seconds,
  theme,
  strings,
  shift,
}: {
  item: ConvMessage;
  seconds: number;
  theme: ConvTheme;
  strings: ScreenStrings;
  shift: number;
}) {
  const V = METRICS.voice;
  const isIn = item.side === "in";
  const n = voiceBars(seconds);
  const bars = waveform(item.id, n);
  const width = voiceWidth(seconds);
  const durationLeft = V.firstBar + n * V.barPitch - (V.barPitch - V.barWidth) + V.durationGap;
  return (
    <div
      {...(isIn ? {} : { "data-grad": "1" })}
      style={{
        position: "relative",
        width,
        height: V.height,
        borderRadius: METRICS.bubble.radius,
        ...(isIn ? { background: theme.inBubble } : outBackground(theme)),
      }}
    >
      <svg width={width} height={V.height} viewBox={`0 0 ${width} ${V.height}`} aria-hidden style={{ position: "absolute", left: 0, top: 0 }}>
        <path
          transform={`translate(${V.playLeft} ${V.playCenterY - 10})`}
          d="M0 1.7C0 .4 1.4-.4 2.5.3l15.2 8.6c1 .6 1 2 0 2.6L2.5 20.1C1.4 20.7 0 20 0 18.7Z"
          fill="#FFFFFF"
        />
        {bars.map((h, i) => (
          <rect
            key={i}
            x={V.firstBar + i * V.barPitch}
            y={V.playCenterY - h / 2}
            width={V.barWidth}
            height={h}
            rx={V.barWidth / 2}
            fill={isIn ? "#F8F9F9" : "#FFFFFF"}
          />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          left: durationLeft,
          top: V.playCenterY - 8 + shift,
          fontSize: 12,
          lineHeight: "16px",
          fontVariantNumeric: "tabular-nums",
          color: isIn ? "#F3F4F4" : "#FCFAFF",
          whiteSpace: "pre",
        }}
      >
        {formatDuration(seconds)}
      </div>
      <div
        style={{
          position: "absolute",
          left: 16.5,
          top: V.transcriptionTop - 4.75 + shift,
          fontSize: 15,
          lineHeight: "20px",
          letterSpacing: -0.3,
          color: isIn ? METRICS.label.color : "rgba(255,255,255,0.8)",
          whiteSpace: "pre",
        }}
      >
        {strings.viewTranscription}
      </div>
    </div>
  );
}

/**
 * Emojis dans le texte d'une bulle : iOS les dessine ~17 % plus grands que
 * Chromium à corps égal (mesuré : 17 pt de large contre 14,5), centrés pareil.
 */
function withEmojiSpans(text: string, emoji: EngineTuning, mentions = false): React.ReactNode {
  // @mention (bulle reçue) : en bleu, comme Instagram (#85A1F9 relevé sur capture).
  if (mentions && /@[\w.]+/.test(text)) {
    return text.split(/(@[\w.]+)/).map((part, i) =>
      i % 2 === 1 ? (
        <span key={i} style={{ color: METRICS.mention }}>
          {part}
        </span>
      ) : (
        <span key={i}>{withEmojiSpans(part, emoji)}</span>
      ),
    );
  }
  const parts = text.split(/(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*)/u);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} style={{ fontSize: `${emoji.inlineScale}em`, lineHeight: 0, verticalAlign: "-0.06em", letterSpacing: emoji.inlineSpacing }}>
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

/** Barre d'état : heure centrée dans l'oreille gauche (ligne de base 30,75 pt), réseau, Wi-Fi, batterie. */
function StatusBar({ status, shift }: { status: Conversation["status"]; shift: number }) {
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 51.75 - 40,
          width: 80,
          top: lineTop(30.75, 17, 20) + shift,
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
    </>
  );
}

function Header({ conversation, theme, shift }: { conversation: Conversation; theme: ConvTheme; shift: number }) {
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
      <StatusBar status={status} shift={shift} />
      <HeaderIcons theme={theme} />
      <Avatar src={contact.avatar} size={32} style={{ position: "absolute", left: 64, top: 60 }} />
      <div
        style={{
          position: "absolute",
          left: 106,
          top: lineTop(74.25, 17, 20) + shift,
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
          top: lineTop(91.5, 12.5, 16) + shift,
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

function Composer({ theme, placeholder, shift }: { theme: ConvTheme; placeholder: string; shift: number }) {
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
          top: lineTop(837.5, 17, 20) - METRICS.composerTop + shift,
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
