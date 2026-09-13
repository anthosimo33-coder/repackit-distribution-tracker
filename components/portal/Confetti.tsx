/**
 * ÉCLAT DE CONFETTIS — décoratif, sans état, sans hasard.
 *
 * Les trajectoires sont calculées UNE fois, à partir de l'indice (angles répartis
 * sur le cercle, distances qui varient par modulo) : pas de `Math.random` au
 * rendu, donc le même éclat à chaque fois et aucun écart serveur/client.
 *
 * Les couleurs reprennent l'accent du projet (`--primary`) et quatre teintes
 * franches qui restent lisibles sur fond blanc. Masqué sous
 * `prefers-reduced-motion` (cf app/celebrations.css).
 */
const COLORS = ["var(--primary)", "#f59e0b", "#10b981", "#38bdf8", "#f43f5e", "#a78bfa"];
const COUNT = 40;

const PIECES = Array.from({ length: COUNT }, (_, i) => {
  const angle = (i / COUNT) * Math.PI * 2 + ((i % 4) * Math.PI) / 16;
  const distance = 120 + ((i * 53) % 130);
  return {
    x: Math.round(Math.cos(angle) * distance),
    // Vers le haut surtout : l'éclat « jaillit » avant de retomber.
    y: Math.round(Math.sin(angle) * distance * 0.7 - 110),
    r: ((i * 97) % 720) - 360,
    delay: (i % 8) * 25,
    width: 6 + (i % 3) * 2,
    color: COLORS[i % COLORS.length],
  };
});

export function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              "--x": `${p.x}px`,
              "--y": `${p.y}px`,
              "--r": `${p.r}deg`,
              animationDelay: `${p.delay}ms`,
              width: p.width,
              background: p.color,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
