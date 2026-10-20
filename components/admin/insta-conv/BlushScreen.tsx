"use client";

import { forwardRef, useContext, useImperativeHandle, useRef, type CSSProperties, type ReactNode } from "react";
import {
  BLUSH,
  blushEcrit,
  composerHeight,
  formatClock,
  initialeDe,
  ondeBlush,
  planBlush,
  type BulleDuGroupe,
  type LigneBlush,
  type PlaceBulle,
} from "@/lib/blush-conv";
import { incrustationDe, REGLAGES_BLUSH_DEFAUT, SCREEN, type Conversation, type ConvMessage } from "@/lib/insta-conv";
import { BlushIcon, BubbleLogo, Perle } from "./BlushArt";
import { CSS_POLICES_BLUSH, FIGTREE, NUNITO } from "./blush-polices";
import { Incrustation } from "./Incrustation";
import { StatusIcons } from "./InstaIcons";
import { ImagesContext, type ConvImages } from "./InstaMedia";
import type { InstaScreenHandle } from "./InstaScreen";

/**
 * L'ÉCRAN — le chat de l'app BLUSH (askblush.com, /app) redessiné en HTML, à
 * 414×896 pt comme la capture Instagram : la barre d'état iOS (Safari, fond à
 * la couleur du thème de la page), puis l'app telle qu'elle se pose sur un
 * iPhone — l'en-tête (BLUSH en grand, l'autre comme un contact), le fil (les
 * bulles blanches de BLUSH, les bleues de la personne), la barre de saisie.
 *
 * Mêmes structures et mêmes styles que le front BLUSH (src/app/app/accueil/
 * bulles.tsx, Entetes.tsx, Barres.tsx, Composer.tsx, src/components/ui/
 * messages.tsx), écrits en styles en ligne : le navigateur fait la mise en
 * page comme dans l'app (largeur des bulles, retours à la ligne). Chaque valeur
 * a été relevée dans le DOM de l'app à 414 px de large.
 */

const C = BLUSH.colors;
const SYSTEM_FONT = "system-ui, -apple-system, 'SF Pro Text', sans-serif"; // i18n-exempt: pile de polices CSS

const SHADOW_SOFT = "inset 0 0 0 1px rgba(17,17,20,0.08), inset 0 1px 0 #ffffff, 0 1px 2px rgba(17,17,20,0.05), 0 8px 18px -10px rgba(17,17,20,0.22)"; // i18n-exempt: valeur CSS
const SHADOW_INK = "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.35), 0 1px 2px rgba(17,17,20,0.22), 0 10px 22px -8px rgba(17,17,20,0.45)"; // i18n-exempt: valeur CSS
const SHADOW_BULLE = "0 0 0 1px rgba(17,17,20,0.045), 0 1px 2px rgba(17,17,20,0.06)"; // i18n-exempt: valeur CSS
/** Le fond de la page : le papier, et un halo blanc en haut (visible quand la conv est courte). */
const PAPER_LIGHT = "radial-gradient(120% 55% at 50% 0%, #ffffff 0%, rgba(255,255,255,0) 62%), #F4F2ED"; // i18n-exempt: valeur CSS
const GLOSS = "linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0) 55%)"; // i18n-exempt: valeur CSS
const ROND = 9999;
/** Capture sans image (à déposer à l'écran) : un cadre gris de l'app. */
const CAPTURE_ABSENTE = "linear-gradient(160deg, #E7E4DD 0%, #D9D6CF 100%)"; // i18n-exempt: valeur CSS

/** Les textes de l'app (donnée de la capture, pas de l'interface de Jarvia). */
const TEXTES = {
  site: "askblush.com", // i18n-exempt: donnée de la capture, pas de l'interface
  partager: "Partager", // i18n-exempt: donnée de la capture, pas de l'interface
  meilleure: "Ta meilleure réponse", // i18n-exempt: donnée de la capture, pas de l'interface
  recommandee: "Recommandée", // i18n-exempt: donnée de la capture, pas de l'interface
  copier: "Copier", // i18n-exempt: donnée de la capture, pas de l'interface
  saisie: "Écris à BLUSH", // i18n-exempt: donnée de la capture, pas de l'interface
};

const APP_HEIGHT = SCREEN.height - BLUSH.statusBar;

export const BlushScreen = forwardRef<InstaScreenHandle, { conversation: Conversation; images?: ConvImages }>(function BlushScreen(
  { conversation, images },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ node: rootRef.current }), []);
  const reglages = conversation.blush ?? REGLAGES_BLUSH_DEFAUT;
  const ecrit = blushEcrit(conversation.items);
  const questions = ecrit ? [] : reglages.idees.map((q) => q.trim()).filter(Boolean);
  const composer = composerHeight(questions.length > 0);
  const lignes = planBlush(conversation.items, conversation.status.time);
  const incrustation = incrustationDe(conversation.items);

  return (
    <ImagesContext.Provider value={images ?? NO_IMAGES}>
      <div
        ref={rootRef}
        data-ecran="blush"
        style={{
          position: "relative",
          width: SCREEN.width,
          height: SCREEN.height,
          overflow: "hidden",
          background: C.paper,
          fontFamily: NUNITO,
          fontSize: 16,
          fontWeight: 700,
          lineHeight: "normal",
          color: C.ink,
          WebkitFontSmoothing: "antialiased",
          // L'écran ne doit RIEN hériter de son conteneur (vignettes : des <button>).
          textAlign: "left",
          textTransform: "none",
          textIndent: 0,
          fontStyle: "normal",
          letterSpacing: "normal",
        }}
      >
        {/* React 19 la pose une fois dans <head>, quel que soit le nombre d'écrans. */}
        {/* i18n-exempt: attributs de la feuille de style (ligne suivante) */}
        <style href="blush-polices" precedence="default">
          {CSS_POLICES_BLUSH}
        </style>
        <div style={{ position: "absolute", left: 0, top: BLUSH.statusBar, width: SCREEN.width, height: APP_HEIGHT, overflow: "hidden" }}>
          {/* Le fil, posé en bas au-dessus de la barre de saisie ; le défilement le descend. */}
          {/* i18n-exempt: valeur CSS (ligne suivante) */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: composer, transform: `translateY(${conversation.scroll}px)` }}>
            {/* La page entière (en-tête et saisie compris) porte le fond : son halo n'apparaît qu'en haut d'une conv courte. */}
            <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: -BLUSH.header, bottom: -composer, background: PAPER_LIGHT }} />
            <section
              style={{
                position: "relative",
                minHeight: APP_HEIGHT - BLUSH.header - composer,
                display: "flex",
                flexDirection: "column",
                padding: `${BLUSH.thread.padTop}px ${BLUSH.thread.padX}px ${BLUSH.thread.padBottom}px`,
                boxSizing: "border-box",
              }}
            >
              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: BLUSH.thread.rowGap }}>
                {lignes.map((l, k) =>
                  l.kind === "day" ? <Jour key={l.item.id} ligne={l} first={k === 0} /> : <Groupe key={l.bulles[0]?.item.id ?? l.typing?.item.id} ligne={l} />,
                )}
              </div>
            </section>
          </div>
          <EnTete conversation={conversation} ecrit={ecrit} />
          <Saisie idees={questions} height={composer} />
        </div>
        <BarreEtat status={conversation.status} />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: (SCREEN.width - BLUSH.homeIndicator.width) / 2,
            bottom: BLUSH.homeIndicator.bottom,
            width: BLUSH.homeIndicator.width,
            height: BLUSH.homeIndicator.height,
            borderRadius: BLUSH.homeIndicator.height / 2,
            background: "#000000",
          }}
        />
        {incrustation && <Incrustation text={incrustation} top={BLUSH.overlayTop} />}
      </div>
    </ImagesContext.Provider>
  );
});

const NO_IMAGES: ConvImages = {};

/** Barre d'état de Safari : heure, réseau, Wi-Fi, batterie, en noir sur le papier. */
function BarreEtat({ status }: { status: Conversation["status"] }) {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: SCREEN.width, height: BLUSH.statusBar, background: C.paper }}>
      <div
        style={{
          position: "absolute",
          left: 51.75 - 40,
          width: 80,
          top: 11,
          textAlign: "center",
          fontFamily: SYSTEM_FONT,
          fontSize: 17,
          lineHeight: "20px",
          fontWeight: 600,
          letterSpacing: -0.43,
          color: "#000000",
        }}
      >
        {status.time}
      </div>
      <StatusIcons battery={status.battery} lowPower={status.lowPower} signal={status.signal} light />
    </div>
  );
}

/** Le séparateur d'un nouveau jour : le jour en gras, l'heure à côté (« Aujourd’hui 21:40 »). */
function Jour({ ligne, first }: { ligne: Extract<LigneBlush, { kind: "day" }>; first: boolean }) {
  return (
    <p
      data-item={ligne.index}
      style={{
        margin: 0,
        marginTop: first ? -8 : 0,
        height: 16,
        textAlign: "center",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: "16px",
        color: C.grey,
        whiteSpace: "pre",
      }}
    >
      <span style={{ fontWeight: 900 }}>{ligne.jour}</span>
      {ligne.heure ? ` ${ligne.heure}` : ""}
    </p>
  );
}

/** Les coins resserrés du côté de l'expéditeur (BLUSH à gauche, elle à droite). */
function coins(side: "blush" | "toi", place: PlaceBulle): CSSProperties {
  const g = side === "blush" ? "Left" : "Right";
  const r = 6;
  if (place === "first") return { [`borderBottom${g}Radius`]: r }; // i18n-exempt: propriétés CSS (cette ligne et la suivante)
  if (place === "middle") return { [`borderTop${g}Radius`]: r, [`borderBottom${g}Radius`]: r };
  if (place === "last") return { [`borderTop${g}Radius`]: r }; // i18n-exempt: propriété CSS
  return {};
}

/**
 * Un groupe : les bulles d'un même expéditeur, l'avatar de BLUSH à côté de la
 * dernière, puis l'heure dessous (et « Partager » sous une réponse de BLUSH), ou
 * « BLUSH écrit » à la place.
 */
function Groupe({ ligne }: { ligne: Extract<LigneBlush, { kind: "group" }> }) {
  const blush = ligne.side === "in";
  const n = ligne.bulles.length;
  const dernier = ligne.bulles[n - 1]?.index;
  if (!n && !ligne.typing) return null;
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: BLUSH.thread.bubbleGap }}>
      {ligne.bulles.map((b, i) =>
        blush ? (
          <div key={b.item.id} data-item={b.index} style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 8 }}>
            {i === n - 1 ? (
              <span style={{ marginBottom: -2, display: "block", flexShrink: 0 }}>
                <BubbleLogo size={34} />
              </span>
            ) : (
              <span aria-hidden style={{ width: 34, flexShrink: 0 }} />
            )}
            <BulleBlush bulle={b} />
          </div>
        ) : (
          <div key={b.item.id} data-item={b.index} style={{ position: "relative", display: "flex", justifyContent: "flex-end" }}>
            <BulleElle bulle={b} />
          </div>
        ),
      )}
      {ligne.typing ? (
        <div data-item={ligne.typing.index} style={{ display: "flex", alignItems: "flex-end", paddingTop: 4 }}>
          <span style={{ display: "block" }}>
            <BubbleLogo size={62} ecrit />
          </span>
        </div>
      ) : (
        <span
          data-item={dernier}
          style={{
            marginTop: 2,
            display: "flex",
            height: 14,
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            fontWeight: 700,
            lineHeight: "14px",
            color: C.grey,
            whiteSpace: "pre",
            ...(blush ? { paddingLeft: 46 } : { justifyContent: "flex-end", paddingRight: 6 }),
          }}
        >
          <span>{ligne.heure}</span>
          {blush && (
            <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 900, color: C.grey }}>
              <BlushIcon name="share" size={11} stroke={2.8} />
              {TEXTES.partager}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

const corps: CSSProperties = { fontSize: 16, fontWeight: 700, lineHeight: 1.4 };

/** La bulle blanche de BLUSH (318 pt au plus) : du texte, un vocal, une citation, ou « Ta meilleure réponse ». */
function BulleBlush({ bulle }: { bulle: BulleDuGroupe }) {
  const { item } = bulle;
  // Le vocal et la citation resserrent la bulle (classes de l'app, mesurées).
  const padding = item.media?.type === "voice" ? "12px 14px 12px 10px" : item.cited ? "12px 16px 10px" : "12px 16px";
  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        maxWidth: 318,
        flexDirection: "column",
        borderRadius: 20,
        background: "#FFFFFF",
        padding,
        textAlign: "left",
        color: C.ink,
        boxShadow: SHADOW_BULLE,
        boxSizing: "border-box",
        ...coins("blush", bulle.place),
      }}
    >
      {item.suggestion ? (
        <MeilleureReponse lines={item.suggestion.lines.filter((l) => l.trim())} why={item.suggestion.why?.trim()} />
      ) : item.media?.type === "voice" ? (
        <VocalBlush seed={item.id} seconds={item.media.seconds} />
      ) : item.cited ? (
        <Citation side={item.cited.side} text={item.text} caption={item.cited.caption} />
      ) : (
        <span style={corps}>{item.text}</span>
      )}
    </div>
  );
}

/** Sa bulle bleue (318 pt au plus) : son texte, son vocal, ou sa capture. */
function BulleElle({ bulle }: { bulle: BulleDuGroupe }) {
  const { item } = bulle;
  const md = item.media;
  const image = md?.type === "photo" || md?.type === "video";
  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        maxWidth: 318,
        flexDirection: "column",
        borderRadius: 20,
        textAlign: "left",
        boxSizing: "border-box",
        ...(image ? { overflow: "hidden" } : { background: C.toiInk, color: "#FFFFFF", padding: md?.type === "voice" ? "10px 14px 10px 8px" : "10px 16px" }),
        ...coins("toi", bulle.place),
      }}
    >
      {image ? (
        <Capture item={item} />
      ) : md?.type === "voice" ? (
        <VocalElle seed={item.id} seconds={md.seconds} />
      ) : (
        <span style={{ display: "flex", minWidth: 0, flexDirection: "column" }}>
          <span style={{ ...corps, whiteSpace: "pre-wrap" }}>{item.text}</span>
        </span>
      )}
    </div>
  );
}

/** Une capture qu'elle envoie à BLUSH (172×230, le haut de l'image). Sans image : un cadre gris attend. */
function Capture({ item }: { item: ConvMessage }) {
  const images = useContext(ImagesContext);
  const id = item.media && "image" in item.media ? item.media.image : undefined;
  const url = id ? images[id]?.url : undefined;
  const box: CSSProperties = { display: "block", width: 172, height: 230 };
  return (
    <span style={{ display: "grid", gap: 2, gridTemplateColumns: "1fr" }}>
      <span style={{ position: "relative", display: "block" }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- rastérisée à l'export
          <img src={url} alt="" crossOrigin="anonymous" style={{ ...box, objectFit: "cover", objectPosition: "top" }} />
        ) : (
          <span style={{ ...box, background: CAPTURE_ABSENTE }} />

        )}
      </span>
    </span>
  );
}

/** Un vrai message de leur conv, cité par BLUSH : sa bulle (grise : l'autre ; bleue : elle), en Figtree, sa légende dessous. */
function Citation({ side, text, caption }: { side: "in" | "out"; text: string; caption?: string }) {
  const autre = side === "in";
  return (
    <div style={{ display: "flex", maxWidth: "82%", flexDirection: "column", gap: 4, alignItems: autre ? "flex-start" : "flex-end", alignSelf: autre ? "flex-start" : "flex-end" }}>
      <span
        style={{
          padding: "9px 13px",
          fontFamily: FIGTREE,
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1.35,
          borderRadius: autre ? "18px 18px 18px 6px" : "18px 18px 6px 18px",
          background: autre ? C.bubbleHer : C.toiInk,
          color: autre ? C.ink : "#FFFFFF",
        }}
      >
        {text}
      </span>
      {caption && <span style={{ fontSize: 12, fontWeight: 800, color: C.grey }}>{caption}</span>}
    </div>
  );
}

/** « Ta meilleure réponse » : les messages à lui envoyer (une bulle bleue chacun), pourquoi, et « Copier ». */
function MeilleureReponse({ lines, why }: { lines: string[]; why?: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: C.vraiInk }}>{TEXTES.meilleure}</span>
        <span
          style={{
            display: "inline-flex",
            flexShrink: 0,
            alignItems: "center",
            whiteSpace: "nowrap",
            fontSize: 12,
            fontWeight: 900,
            color: "#FFFFFF",
            height: 26,
            borderRadius: 13,
            padding: "0 10px",
            background: `${GLOSS}, ${C.vraiInk}`,
            boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.1)",
          }}
        >
          {TEXTES.recommandee}
        </span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
        {lines.map((l, i) => (
          <span
            key={i}
            style={{
              borderRadius: "18px 18px 6px 18px",
              background: C.toiInk,
              padding: "8px 14px",
              fontFamily: FIGTREE,
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.35,
              color: "#FFFFFF",
            }}
          >
            {l}
          </span>
        ))}
      </span>
      {why && <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.45, color: C.grey }}>{why}</span>}
      <span style={{ marginTop: 4, display: "flex" }}>
        <span
          style={{
            display: "inline-flex",
            height: 36,
            alignItems: "center",
            gap: 6,
            borderRadius: ROND,
            background: "#FFFFFF",
            padding: "0 14px",
            fontSize: 13,
            fontWeight: 900,
            color: C.ink,
            boxShadow: SHADOW_SOFT,
          }}
        >
          <BlushIcon name="copy" size={14} stroke={2.6} color={C.ink} />
          {TEXTES.copier}
        </span>
      </span>
    </span>
  );
}

/** La réponse de BLUSH en vocal : le bouton rose, l'onde (28 barres), la durée. */
function VocalBlush({ seed, seconds }: { seed: string; seconds: number }) {
  return (
    <span style={{ display: "flex", minWidth: 220, alignItems: "center", gap: 10 }}>
      <span
        style={{
          display: "flex",
          width: 42,
          height: 42,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: ROND,
          boxShadow: "0 6px 14px -6px rgba(200,29,107,0.7)",
          background: "linear-gradient(160deg, #FF94C8 0%, #E8358A 60%, #C81D6B 100%)", // i18n-exempt: valeur CSS
        }}
      >
        <BlushIcon name="play" size={15} stroke={0} color="#FFFFFF" fill="#FFFFFF" style={{ transform: "translateX(1px)" }} />
      </span>
      <span style={{ display: "flex", height: 28, flex: 1, alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        {ondeBlush(seed).map((p, i) => (
          <span key={i} style={{ width: 3, borderRadius: ROND, background: C.disabled, height: 5 + p * 22 }} />
        ))}
      </span>
      <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: C.grey }}>{formatClock(seconds)}</span>
    </span>
  );
}

/** Son vocal, dans sa bulle bleue : lecture, onde, durée. */
function VocalElle({ seed, seconds }: { seed: string; seconds: number }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ display: "flex", width: 36, height: 36, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: ROND, background: "#FFFFFF" }}>
        <BlushIcon name="play" size={15} stroke={0} color={C.toiInk} fill={C.toiInk} style={{ transform: "translateX(1px)" }} />
      </span>
      <span style={{ display: "flex", height: 28, alignItems: "center", gap: 2 }}>
        {ondeBlush(`${seed}:elle`).map((p, i) => (
          <span key={i} style={{ width: 3, borderRadius: ROND, background: "rgba(255,255,255,0.5)", height: 4 + p * 22 }} />
        ))}
      </span>
      <span style={{ fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.9)" }}>{formatClock(seconds)}</span>
    </span>
  );
}

// ── En-tête ──────────────────────────────────────────────────────────────────

/**
 * L'en-tête de l'app sur iPhone : à gauche le compte et le compteur de bulles,
 * au centre BLUSH en grand (sa bulle penchée, « askblush.com » dessous), à
 * droite l'autre comme un contact (l'anneau de votre niveau, le verdict en
 * badge). Le fond, translucide, s'efface vers le bas : le fil passe dessous.
 */
function EnTete({ conversation, ecrit }: { conversation: Conversation; ecrit: boolean }) {
  const reglages = conversation.blush ?? REGLAGES_BLUSH_DEFAUT;
  return (
    <header style={{ position: "absolute", left: 0, top: 0, width: SCREEN.width, height: BLUSH.header, zIndex: 20 }}>
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(244,242,237,0.84)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          maskImage: "linear-gradient(180deg, #000 calc(100% - 22px), transparent)",
          WebkitMaskImage: "linear-gradient(180deg, #000 calc(100% - 22px), transparent)",
        }}
      />
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "start", padding: "6px 16px 20px" }}>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "flex" }}>
            <Rond size={40} style={{ background: "#FFFFFF", boxShadow: SHADOW_SOFT }}>
              <BlushIcon name="user" size={19} stroke={2.2} color={C.ink} />
            </Rond>
          </span>
          <Compteur bulles={reglages.bulles} />
        </div>
        <span style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 4px", color: C.ink }}>
          <span style={{ position: "relative", display: "block" }}>
            <span style={{ display: "block", transform: "rotate(-3deg)" }}>
              <span style={{ display: "block", filter: "drop-shadow(0 16px 18px rgba(232,53,138,0.26))" }}>
                <BubbleLogo size={88} ecrit={ecrit} />
              </span>
            </span>
          </span>
          <span style={{ position: "relative", marginTop: -4, display: "block" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                borderRadius: ROND,
                background: "#FFFFFF",
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: "-0.02em",
                boxShadow: "0 0 0 1px rgba(17,17,20,0.08), 0 6px 14px -6px rgba(17,17,20,0.3)",
                height: 30,
                paddingLeft: 14,
                paddingRight: 8,
                fontSize: 15,
              }}
            >
              {TEXTES.site}
              <BlushIcon name="chevron" size={13} stroke={3} color={C.muted} />
            </span>
          </span>
        </span>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
          <Contact nom={conversation.contact.name} verdict={reglages.verdict} niveau={reglages.niveau} />
        </div>
      </div>
    </header>
  );
}

function Rond({ size, style, children }: { size: number; style?: CSSProperties; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", width: size, height: size, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: ROND, ...style }}>
      {children}
    </span>
  );
}

/** Le compteur de bulles : la perle et le solde (rose quand il en reste 1 ou 2, gris à 0). */
function Compteur({ bulles }: { bulles: number }) {
  const vide = bulles <= 0;
  const peu = [1, 2].includes(bulles);
  return (
    <span
      style={{
        display: "inline-flex",
        height: 40,
        flexShrink: 0,
        alignItems: "center",
        gap: 6,
        borderRadius: ROND,
        paddingLeft: 8,
        paddingRight: 12,
        fontSize: 15,
        fontWeight: 900,
        fontVariantNumeric: "tabular-nums",
        ...(vide
          ? { background: C.plaque, color: C.grey }
          : peu
            ? { background: "#FFE6F2", color: C.elleInk, boxShadow: "inset 0 0 0 1.5px rgba(232,53,138,0.35)" }
            : { background: "#FFFFFF", color: C.ink, boxShadow: SHADOW_SOFT }),
      }}
    >
      {vide ? (
        <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: ROND, background: C.segment, boxShadow: "inset 0 1px 2px rgba(17,17,20,0.14)" }} />
      ) : (
        <Perle size={18} />
      )}
      {Math.max(0, bulles)}
    </span>
  );
}

/** L'autre, comme un contact : son initiale dans l'anneau de votre niveau, le verdict en badge, son prénom dessous. */
function Contact({ nom, verdict, niveau }: { nom: string; verdict: string; niveau: number }) {
  const ring = 2 * Math.PI * 21;
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: C.ink }}>
      <span style={{ position: "relative", display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "center", width: 48, height: 48 }}>
        <svg viewBox="0 0 48 48" width={48} height={48} aria-hidden style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
          <circle cx="24" cy="24" r="21" fill="none" stroke={C.line} strokeWidth="3.5" />
          <circle cx="24" cy="24" r="21" fill="none" stroke={C.vrai} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(ring * niveau) / 4} ${ring}`} />
        </svg>
        <span
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: ROND,
            fontWeight: 900,
            color: "#FFFFFF",
            width: 36,
            height: 36,
            background: `radial-gradient(circle at 30% 22%, rgba(255,255,255,0.42), rgba(255,255,255,0) 58%), ${C.elle}`,
            boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.12), 0 3px 8px -3px rgba(17,17,20,0.3)",
            fontSize: 15,
          }}
        >
          {initialeDe(nom)}
        </span>
        <span
          style={{
            position: "absolute",
            bottom: -4,
            right: -6,
            display: "flex",
            width: 22,
            height: 22,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: ROND,
            background: "#FFFFFF",
            fontSize: 12,
            lineHeight: 1,
            boxShadow: "0 0 0 1px rgba(17,17,20,0.06), 0 3px 8px -3px rgba(17,17,20,0.35)",
          }}
        >
          {verdict}
        </span>
      </span>
      <span style={{ fontSize: 12, fontWeight: 900, lineHeight: 1, whiteSpace: "pre" }}>{nom}</span>
    </span>
  );
}

// ── Barre de saisie ──────────────────────────────────────────────────────────

/** « + » (captures, export), le champ « Écris à BLUSH » et le vocal ; au-dessus, les questions toutes prêtes. */
function Saisie({ idees, height }: { idees: string[]; height: number }) {
  const S = BLUSH.composer;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height,
        boxSizing: "border-box",
        zIndex: 10,
        borderTop: `${S.border}px solid rgba(17,17,20,0.06)`,
        background: "rgba(244,242,237,0.88)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        padding: `${S.padTop}px ${S.padX}px ${S.padBottom}px`,
      }}
    >
      {idees.length > 0 && (
        <div
          style={{
            margin: `0 -${S.padX}px ${S.chipsGap}px`,
            display: "flex",
            gap: 8,
            overflow: "hidden",
            padding: `0 ${S.padX}px 1px`,
            maskImage: "linear-gradient(90deg, #000 calc(100% - 28px), transparent)",
            WebkitMaskImage: "linear-gradient(90deg, #000 calc(100% - 28px), transparent)",
          }}
        >
          {idees.map((q, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                height: 36,
                flexShrink: 0,
                alignItems: "center",
                borderRadius: ROND,
                background: "#FFFFFF",
                padding: "0 14px",
                fontSize: 14,
                fontWeight: 800,
                color: C.toiInk,
                boxShadow: "inset 0 0 0 1.5px rgba(26,102,219,0.28)",
                whiteSpace: "pre",
              }}
            >
              {q}
            </span>
          ))}
          <Rond size={36} style={{ color: C.grey }}>
            <BlushIcon name="close" size={16} stroke={2.4} />
          </Rond>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <Rond size={44} style={{ display: "flex", background: "#FFFFFF", boxShadow: SHADOW_SOFT }}>
            <BlushIcon name="plus" size={21} stroke={2.8} color={C.ink} />
          </Rond>
        </div>
        <div
          style={{
            display: "flex",
            height: 44,
            minWidth: 0,
            flex: 1,
            alignItems: "center",
            gap: 8,
            borderRadius: ROND,
            background: "#FFFFFF",
            paddingRight: 4,
            boxShadow: "inset 0 0 0 1px rgba(17,17,20,0.09)",
          }}
        >
          <span style={{ display: "flex", height: "100%", minWidth: 0, flex: 1, alignItems: "center", paddingLeft: 18 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.grey, whiteSpace: "pre" }}>{TEXTES.saisie}</span>
          </span>
          <Rond size={36} style={{ display: "flex", background: C.ink, boxShadow: SHADOW_INK }}>
            <BlushIcon name="wave" size={18} stroke={2.6} color="#FFFFFF" />
          </Rond>
        </div>
      </div>
    </div>
  );
}
