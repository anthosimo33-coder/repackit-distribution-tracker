import { UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Fallback PROPRE de vignette d'inspiration — remplace l'ancien gros bloc
 * dégradé bleu/sombre. Fond neutre clair + glyphe de la PLATEFORME, discret,
 * cohérent avec le branding clair + orange. Affiché quand aucune vignette
 * n'est récupérable (pas d'URL / status "failed" / image cassée). Pour un
 * compte, on garde l'icône utilisateur.
 *
 * lucide-react ne fournit plus les logos de marque (Instagram/YouTube retirés
 * pour raisons de trademark) → glyphes inline monochromes (currentColor, donc
 * teintés par `text-slate-400`). Mutualisé entre la grille (InspirationCard)
 * et la vue liste (InspirationsList) pour un rendu identique.
 */

function YouTubeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.5 15.5v-7l6.3 3.5-6.3 3.5z" />
    </svg>
  );
}

function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TikTokGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.5 2h-3v13.2a2.7 2.7 0 1 1-2.2-2.65V9.5a5.8 5.8 0 1 0 5.2 5.77V8.6a6.6 6.6 0 0 0 4 1.35V6.9a3.6 3.6 0 0 1-4-3.4V2z" />
    </svg>
  );
}

const PLATFORM_GLYPHS: Record<
  string,
  ({ className }: { className?: string }) => React.ReactElement
> = {
  TikTok: TikTokGlyph,
  Instagram: InstagramGlyph,
  YouTube: YouTubeGlyph,
};

export function ThumbnailFallback({
  plateforme,
  type,
  iconClassName,
  className,
}: {
  plateforme: string;
  type: "video" | "account";
  iconClassName?: string;
  className?: string;
}) {
  const Glyph = PLATFORM_GLYPHS[plateforme];

  return (
    <div
      className={cn(
        "flex size-full items-center justify-center bg-slate-100",
        className,
      )}
    >
      {type === "account" || !Glyph ? (
        <UserIcon className={cn("text-slate-400", iconClassName)} />
      ) : (
        <Glyph className={cn("text-slate-400", iconClassName)} />
      )}
    </div>
  );
}
