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

/**
 * SNYTCH — rend un script monté en DEUX zones de DESTINATION explicites, pour
 * lever la confusion « qu'est-ce qui va où » :
 *   - 🎬 Dans la vidéo   = hook + flux, PAR BRIQUE avec un MODE (à dire à l'oral /
 *     à afficher à l'écran / les deux) → plus d'ambiguïté générique
 *   - 📝 En description  = cta (à COPIER-COLLER en légende du post, hashtags inclus)
 *
 * Réutilisé à l'identique par la fiche créatrice (rendu réel) ET l'aperçu admin
 * (« ce que verra la créatrice ») → mêmes étiquettes des deux côtés. Le nom des
 * briques (Hook/Flux/CTA) n'apparaît PAS : seule la destination + le mode priment.
 * Mobile-first : cartes pleine largeur empilées, bouton copier pleine largeur.
 */
export function ScriptDestinationZones({
  videoBlocks,
  descriptionScript,
}: {
  videoBlocks: { text: string; mode: BrickMode }[];
  descriptionScript: string;
}) {
  const t = useTranslations("portal");
  return (
    <div className="space-y-4">
      {/* ZONE 1 — dans la vidéo (hook + flux), un bloc PAR BRIQUE avec son mode. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span aria-hidden>🎬</span> Dans la vidéo
          </CardTitle>
          <CardDescription>
            Chaque partie précise si c&apos;est à dire, à afficher, ou les deux.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {videoBlocks.map((b, i) => {
            const d = brickModeDisplay(b.mode);
            return (
              <div key={i} className="space-y-1.5" data-testid="video-block">
                <p
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  data-mode={b.mode}
                >
                  <span aria-hidden>{d.icon}</span>
                  {d.label}
                </p>
                <SimpleMarkdown content={b.text} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ZONE 2 — en description (cta), accent visuel distinct + copie 1 clic. */}
      <Card className="bg-emerald-50/50 ring-emerald-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span aria-hidden>📝</span> En description
          </CardTitle>
          <CardDescription>
            Copie-colle ça en légende de ton post (hashtags inclus).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SimpleMarkdown content={descriptionScript} />
          <CopyButton
            text={descriptionScript}
            label={t("script.copyDescription")}
            className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
          />
        </CardContent>
      </Card>
    </div>
  );
}
