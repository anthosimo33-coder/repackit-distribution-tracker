import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { CopyButton } from "@/components/ui/CopyButton";

/**
 * SNYTCH — rend un script monté en DEUX zones de DESTINATION explicites, pour
 * lever la confusion « qu'est-ce qui va où » :
 *   - 🎬 Dans la vidéo   = hook + flux (ce que la créatrice DIT / AFFICHE à l'écran)
 *   - 📝 En description  = cta (à COPIER-COLLER en légende du post, hashtags inclus)
 *
 * Mapping FIXE Snytch (pas de config par brique). Réutilisé à l'identique par la
 * fiche créatrice (rendu réel) ET l'aperçu admin (« ce que verra la créatrice »),
 * pour que les deux vues portent exactement les mêmes étiquettes. Le nom des
 * briques (Hook/Flux/CTA) n'apparaît PLUS : seule la destination prime.
 * Mobile-first : cartes pleine largeur empilées, bouton copier pleine largeur.
 */
export function ScriptDestinationZones({
  videoScript,
  descriptionScript,
}: {
  videoScript: string;
  descriptionScript: string;
}) {
  return (
    <div className="space-y-4">
      {/* ZONE 1 — dans la vidéo (hook + flux). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span aria-hidden>🎬</span> Dans la vidéo
          </CardTitle>
          <CardDescription>
            Ce que tu dis et affiches à l&apos;écran.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleMarkdown content={videoScript} />
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
            label="Copier la description"
            className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
          />
        </CardContent>
      </Card>
    </div>
  );
}
