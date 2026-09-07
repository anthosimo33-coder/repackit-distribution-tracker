import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { CopyButton } from "@/components/ui/CopyButton";
import { brickModeDisplay, type BrickMode } from "@/lib/script-mode";
import { useTranslations } from "next-intl";
import { useLabel } from "@/lib/use-label";

/** Slot d'origine des blocs de la zone vidéo, DANS L'ORDRE de montage — la zone
 *  🎬 est construite [hook, flux] par splitScriptZones comme par l'aperçu admin.
 *  Sert à rattacher chaque consigne à son bloc sans exposer d'id de brique. */
const VIDEO_SLOTS = ["hook", "flux"] as const;

/**
 * SNYTCH — rend un script monté en DEUX zones de DESTINATION explicites, pour
 * lever la confusion « qu'est-ce qui va où » :
 *   - 🎬 Dans la vidéo   = hook + flux, PAR BRIQUE avec un MODE (à dire à l'oral /
 *     à afficher à l'écran / les deux) → plus d'ambiguïté générique
 *   - 📝 En description  = cta (à COPIER-COLLER en légende du post, hashtags inclus)
 *
 * Chaque bloc peut porter une CONSIGNE (`instructions`, par slot) : un encart
 * accentué sous le texte, jamais dans le texte — ce n'est ni à dire, ni à
 * afficher, ni à copier en description.
 *
 * Réutilisé à l'identique par la fiche créatrice (rendu réel) ET l'aperçu admin
 * (« ce que verra la créatrice ») → mêmes étiquettes des deux côtés. Le nom des
 * briques (Hook/Flux/CTA) n'apparaît PAS : seule la destination + le mode priment.
 * Mobile-first : cartes pleine largeur empilées, bouton copier pleine largeur.
 */
export function ScriptDestinationZones({
  videoBlocks,
  descriptionScript,
  instructions = [],
}: {
  videoBlocks: { text: string; mode: BrickMode }[];
  descriptionScript: string;
  /** Consignes par slot (absentes = aucun encart). */
  instructions?: readonly { slot: "hook" | "flux" | "cta"; text: string }[];
}) {
  const t = useTranslations("portal.script");
  const tLabel = useLabel();
  const instructionFor = (slot: "hook" | "flux" | "cta") =>
    instructions.find((i) => i.slot === slot)?.text ?? null;
  return (
    <div className="space-y-4">
      {/* ZONE 1 — dans la vidéo (hook + flux), un bloc PAR BRIQUE avec son mode. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span aria-hidden>🎬</span>{t("inVideo")}</CardTitle>
          <CardDescription>{t("inVideoHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {videoBlocks.map((b, i) => {
            const d = brickModeDisplay(b.mode);
            const instruction = instructionFor(VIDEO_SLOTS[i] ?? "hook");
            return (
              <div key={i} className="space-y-1.5" data-testid="video-block">
                <p
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  data-mode={b.mode}
                >
                  <span aria-hidden>{d.icon}</span>
                  {tLabel(d.labelKey)}
                </p>
                <SimpleMarkdown content={b.text} />
                <BlockInstruction text={instruction} label={t("instruction")} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ZONE 2 — en description (cta), accent visuel distinct + copie 1 clic. */}
      <Card className="bg-emerald-50/50 ring-emerald-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span aria-hidden>📝</span>{t("inDescription")}</CardTitle>
          <CardDescription>{t("inDescriptionHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SimpleMarkdown content={descriptionScript} />
          <BlockInstruction
            text={instructionFor("cta")}
            label={t("instruction")}
          />
          <CopyButton
            text={descriptionScript}
            label={t("copyDescription")}
            className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Encart de CONSIGNE sous un bloc. Volontairement distinct du texte du script
 * (fond ambre, étiquette explicite) : la créatrice doit voir d'un coup d'œil que
 * ce n'est pas à dire — ni à copier. Rien à rendre quand il n'y a pas de
 * consigne (le cas courant).
 */
function BlockInstruction({
  text,
  label,
}: {
  text: string | null;
  label: string;
}) {
  if (!text) return null;
  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
      data-testid="block-instruction"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
        <span aria-hidden>💡</span> {label}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-amber-950">
        {text}
      </p>
    </div>
  );
}

/**
 * Les consignes en LISTE, pour les fiches qui n'ont PAS les deux zones de
 * destination (hors Snytch, ou combo dont le texte figé a divergé du découpage).
 * Le slot n'est pas nommé — « hook »/« flux »/« cta » est du vocabulaire de
 * production : les consignes se lisent dans l'ordre du script, comme il se dit.
 */
export function ScriptInstructionList({
  items,
}: {
  items: readonly { slot: "hook" | "flux" | "cta"; text: string }[];
}) {
  const t = useTranslations("portal.script");
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <BlockInstruction key={i.slot} text={i.text} label={t("instruction")} />
      ))}
    </div>
  );
}
