"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { ENGINE_TUNING, METRICS, mediaBox, renderEngine, type ConvMedia, type ConvTheme } from "@/lib/insta-conv";

/**
 * MÉDIAS AVEC IMAGE — photo/vidéo envoyée, reel, publication, story partagée,
 * miniature de story. Cotes relevées sur les captures 8 à 14 (voir
 * `METRICS.media`, `METRICS.card`) ; la publication n'a été vue qu'en partie.
 *
 * Les images arrivent par contexte (id → URL du storage + dimensions) : la
 * conversation ne porte que des ids. Une image absente (pas encore déposée, ou
 * pas encore chargée) laisse un cadre gris de la même taille — la mise en page
 * ne bouge pas quand elle arrive.
 */

export type ConvImage = { url: string; w: number; h: number };
export type ConvImages = Record<string, ConvImage>;

export const ImagesContext = createContext<ConvImages>({});

const noSubscribe = () => () => {};
/** Moteur du navigateur ; « blink » au rendu serveur, corrigé à l'hydratation. */
export function useRenderEngine(): "blink" | "webkit" {
  return useSyncExternalStore(noSubscribe, () => renderEngine(navigator.userAgent), () => "blink");
}

function useImage(id: string | undefined): ConvImage | undefined {
  const images = useContext(ImagesContext);
  return id ? images[id] : undefined;
}

/** L'image (recadrée pour remplir) ou le cadre gris. */
function Fill({ id }: { id: string | undefined }) {
  const img = useImage(id);
  return img ? (
    // eslint-disable-next-line @next/next/no-img-element -- rendu rastérisé à l'export, pas d'optimisation Next ici
    <img
      src={img.url}
      alt=""
      crossOrigin="anonymous"
      draggable={false}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
    />
  ) : (
    <div style={{ position: "absolute", inset: 0, background: METRICS.imagePlaceholder }} />
  );
}

const PLAY = "M2.4 1.1C1.3.5 0 1.3 0 2.5v17c0 1.2 1.3 2 2.4 1.4l15.8-8.5c1.1-.6 1.1-2.2 0-2.8Z"; // i18n-exempt: tracé SVG
const SHADOW = "drop-shadow(0 0 3px rgba(0,0,0,0.25))"; // i18n-exempt: valeur CSS
const SHARE = "M3.6 1.5h14.8c1.5 0 2.4 1.6 1.6 2.9l-7.4 12.2c-.8 1.3-2.8 1.1-3.2-.4L7.6 9.4 2.2 4.6C1.1 3.6 1.9 1.5 3.6 1.5ZM7.6 9.4l7.1-4.1"; // i18n-exempt: tracé SVG

/** Photo ou vidéo envoyée : cadre selon le format de l'image, ▶ en haut à droite d'une vidéo. */
export function MediaBubble({ media, corners }: { media: Extract<ConvMedia, { type: "photo" | "video" }>; corners: React.CSSProperties }) {
  const img = useImage(media.image);
  const box = mediaBox(img?.w, img?.h);
  const P = METRICS.media.play;
  return (
    <div style={{ position: "relative", width: box.width, height: box.height, overflow: "hidden", ...corners }}>
      <Fill id={media.image} />
      {media.type === "video" && (
        <svg
          width={P.width}
          height={P.height}
          viewBox="0 0 19 22"
          aria-hidden
          style={{ position: "absolute", right: P.right, top: P.top, filter: SHADOW }}
        >
          <path d={PLAY} fill="rgba(255,255,255,0.9)" />
        </svg>
      )}
    </div>
  );
}

/** En-tête d'une carte partagée : photo du compte, nom (coupé par « … »), badge. */
function CardHeader({ avatar, account, verified, width }: { avatar?: string; account: string; verified?: boolean; width: number }) {
  const H = METRICS.card.header;
  const img = useImage(avatar);
  const shift = ENGINE_TUNING[useRenderEngine()].textShiftY;
  const textLeft = H.inset + H.avatar + H.gap;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width, height: H.inset * 2 + H.avatar }}>
      <div
        style={{
          position: "absolute",
          left: H.inset,
          top: H.inset,
          width: H.avatar,
          height: H.avatar,
          borderRadius: "50%",
          overflow: "hidden",
          boxShadow: "0 0 0 0.75px rgba(255,255,255,0.55)",
          background: img ? undefined : "linear-gradient(135deg, #5B5F66, #34383D)", // i18n-exempt: couleur CSS
        }}
      >
        {img && (
          // eslint-disable-next-line @next/next/no-img-element -- rendu rastérisé à l'export
          <img src={img.url} alt="" crossOrigin="anonymous" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: textLeft,
          // Ligne de base à 27 pt : 13,5 pt sous le haut d'une ligne de 17 pt en 14 pt.
          top: H.baseline - 13.5 + shift,
          // Nom + badge : le nom se coupe pour que le badge tienne avant la marge droite.
          maxWidth: width - textLeft - H.padRight,
          display: "flex",
          alignItems: "center",
          gap: H.badgeGap,
          fontSize: H.fontSize,
          lineHeight: "17px",
          fontWeight: 600,
          letterSpacing: -0.2,
          color: "#FFFFFF",
          textShadow: "0 0 3px rgba(0,0,0,0.3)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account}</span>
        {verified && <Verified size={H.badge} />}
      </div>
    </div>
  );
}

/** Badge certifié : rosette blanche, coche sombre (vu sur capture 14). */
function Verified({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden style={{ flexShrink: 0, filter: SHADOW }}>
      <path
        d="M6 .3 7.4 1.5l1.8-.2.6 1.7 1.6.9-.4 1.8.9 1.6-1.4 1.2-.1 1.8-1.8.4L7.6 12 6 11.1 4.4 12l-1-1.5-1.8-.4-.1-1.8L.1 7.1 1 5.5.6 3.7l1.6-.9.6-1.7 1.8.2Z"
        fill="#FFFFFF"
      />
      <path d="m3.8 6.1 1.5 1.5 2.9-3" fill="none" stroke="#1E2124" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Reel ou publication partagés. */
export function SharedCard({
  media,
  theme,
  isIn,
}: {
  media: Extract<ConvMedia, { type: "reel" | "post" }>;
  theme: ConvTheme;
  isIn: boolean;
}) {
  const C = METRICS.card;
  const reel = media.type === "reel";
  const width = reel ? C.reel.width : C.post.width;
  const band = C.header.inset * 2 + C.header.avatar;
  const imageHeight = reel ? C.reel.height : C.post.imageHeight;
  const K = C.caption;
  return (
    <div style={{ width, borderRadius: C.radius, overflow: "hidden", background: theme.inBubble }}>
      {/* La publication a son en-tête sur un bandeau ; le reel le pose sur l'image. */}
      {!reel && <div style={{ position: "relative", height: band }}><CardHeader {...media} width={width} /></div>}
      <div style={{ position: "relative", height: imageHeight }}>
        <Fill id={media.image} />
        {reel && (
          <>
            <CardHeader {...media} width={width} />
            <svg
              width={C.play.width}
              height={C.play.height}
              viewBox="0 0 19 22"
              aria-hidden
              style={{ position: "absolute", left: (width - C.play.width) / 2, top: (imageHeight - C.play.height) / 2, filter: SHADOW }}
            >
              <path d={PLAY} fill="#FFFFFF" />
            </svg>
            <ReelIcon />
          </>
        )}
      </div>
      {media.caption && (
        // Le rognage sur un bloc INTÉRIEUR : sur le bloc à marges, la 3e ligne
        // déborderait dans la marge du bas (overflow coupe au bord du padding).
        <div style={{ padding: `${K.padTop}px ${K.padX}px ${K.padBottom}px` }}>
          <div
            style={{
              fontSize: K.fontSize,
              lineHeight: `${K.lineHeight}px`,
              letterSpacing: -0.15,
              color: isIn ? theme.inText : "#FFFFFF",
              display: "-webkit-box",
              WebkitLineClamp: K.maxLines,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "break-word",
            }}
          >
            <b style={{ fontWeight: 600 }}>{media.account}</b> {media.caption}
          </div>
        </div>
      )}
    </div>
  );
}

/** Pastille « reel » en bas à gauche : carré blanc arrondi, ▶ sombre. */
function ReelIcon() {
  const R = METRICS.card.reelIcon;
  return (
    <svg width={R.size} height={R.size} viewBox="0 0 22 22" aria-hidden style={{ position: "absolute", left: R.inset, bottom: R.inset }}>
      <rect width={22} height={22} rx={6} fill="#FFFFFF" />
      <path d="M8.3 6.6c0-.8.9-1.3 1.6-.9l6 3.6c.7.4.7 1.4 0 1.8l-6 3.6c-.7.4-1.6-.1-1.6-.9Z" fill="#121417" />
    </svg>
  );
}

/** Story partagée : barre de 4 pt, puis la story en 9:16 avec le compte en tête. */
export function StoryShareCard({ media, theme, isIn }: { media: Extract<ConvMedia, { type: "storyShare" }>; theme: ConvTheme; isIn: boolean }) {
  const C = METRICS.card;
  const Q = METRICS.quote;
  return (
    <div style={{ display: "flex", flexDirection: isIn ? "row" : "row-reverse", alignItems: "stretch", gap: Q.barGap }}>
      <div style={{ width: Q.bar, flexShrink: 0, borderRadius: Q.bar / 2, background: theme.inBubble }} />
      <div style={{ position: "relative", width: C.storyShare.width, height: C.storyShare.height, borderRadius: C.radius, overflow: "hidden" }}>
        <Fill id={media.image} />
        <CardHeader {...media} width={C.storyShare.width} />
      </div>
    </div>
  );
}

/** Miniature de la story à laquelle un message répond, derrière la même barre. */
export function StoryThumb({ image, theme, isIn }: { image: string; theme: ConvTheme; isIn: boolean }) {
  const T = METRICS.storyThumb;
  const Q = METRICS.quote;
  return (
    <div style={{ display: "flex", flexDirection: isIn ? "row" : "row-reverse", alignItems: "stretch", gap: Q.barGap }}>
      <div style={{ width: Q.bar, flexShrink: 0, borderRadius: Q.bar / 2, background: theme.inBubble }} />
      <div style={{ position: "relative", width: T.width, height: T.height, borderRadius: METRICS.card.radius, overflow: "hidden" }}>
        <Fill id={image} />
      </div>
    </div>
  );
}

/**
 * Boutons à côté d'un média : « partager » (l'avion), et « enregistrer » sous un
 * reel ou une publication. Centrés sur le média (une carte : 4 pt plus haut).
 */
export function SideButtons({ media, isIn }: { media: ConvMedia; isIn: boolean }) {
  const S = METRICS.side;
  const save = media.type === "reel" || media.type === "post";
  const card = media.type === "reel" || media.type === "post" || media.type === "storyShare";
  const height = save ? S.size * 2 + S.stackGap : S.size;
  const button: React.CSSProperties = {
    width: S.size,
    height: S.size,
    borderRadius: S.size / 2,
    background: S.background,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  return (
    <div
      style={{
        position: "absolute",
        ...(isIn ? { left: `calc(100% + ${S.gap}px)` } : { right: `calc(100% + ${S.gap}px)` }),
        top: `calc(50% - ${height / 2 - (card ? S.cardOffset : 0)}px)`,
        display: "flex",
        flexDirection: "column",
        gap: S.stackGap,
      }}
    >
      {/* Relevés sur capture : avion 14,6 × 12 pt aux coins arrondis, signet 12 × 13 pt, trait 1,5 pt. */}
      <div style={button}>
        <svg width={17} height={15} viewBox="0 0 22 19" aria-hidden style={{ marginTop: 1 }}>
          <path
            d={SHARE}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={2.05}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {save && (
        <div style={button}>
          <svg width={14} height={15} viewBox="0 0 14 15" aria-hidden>
            <path d="M1.75 1h10.5v12.9L7 9.6l-5.25 4.3Z" fill="none" stroke="#FFFFFF" strokeWidth={1.55} strokeLinejoin="miter" />
          </svg>
        </div>
      )}
    </div>
  );
}
