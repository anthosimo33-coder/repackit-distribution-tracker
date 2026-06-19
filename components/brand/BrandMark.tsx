import { cn } from "@/lib/utils";

/**
 * Marque visuelle de la plateforme Jarvis Creator Studio — le diamant filaire
 * lumineux sur fond noir (public/brand/jarvis-logo.png). Remplace l'ancien
 * carré orange « R ». Rendu dans un carré arrondi à fond noir (le logo est sur
 * noir → le fond se fond avec l'image). Utilisé sur /login, /[slug]/login,
 * /join et l'en-tête du portail créateur.
 */
export function BrandMark({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-black",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/jarvis-logo.png"
        alt="Jarvis Creator Studio"
        className="size-full object-cover"
      />
    </span>
  );
}
