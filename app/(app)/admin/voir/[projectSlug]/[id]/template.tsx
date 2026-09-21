/**
 * Transition entre les écrans observés — la même que dans l'espace de la
 * créatrice (cf app/app/template.tsx) : la preview doit se sentir comme l'espace
 * qu'elle montre.
 */
export default function ViewAsTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
      {children}
    </div>
  );
}
