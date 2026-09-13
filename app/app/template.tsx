/**
 * TRANSITION ENTRE LES ÉCRANS DU PORTAIL CRÉATRICE.
 *
 * Un template est REMONTÉ à chaque changement d'écran sous `/app` (contrairement
 * au layout, qui persiste — la barre d'onglets ne clignote donc pas). Chaque
 * écran entre en fondu avec une légère montée : on sent qu'on a changé d'onglet
 * sans attendre.
 *
 * `motion-safe` : rien ne bouge pour qui a demandé moins d'animations.
 */
export default function PortalTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
      {children}
    </div>
  );
}
