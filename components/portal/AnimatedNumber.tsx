"use client";

import { useEffect, useRef, useState } from "react";

/**
 * UN CHIFFRE QUI MONTE — de sa valeur précédente à la nouvelle, en ~0,8 s.
 *
 * Sert aux montants et aux vues : voir 142 $ se remplir se ressent, là où le
 * voir apparaître se lit. Au premier affichage on part de 0 ; quand la valeur
 * change (query réactive), on part de l'ancienne — un gain qui arrive se voit
 * arriver.
 *
 * ⚠️ `prefers-reduced-motion` : aucune animation, la valeur finale s'affiche
 * d'emblée. La valeur finale est TOUJOURS exactement `value` — l'interpolation
 * ne sert qu'aux images intermédiaires.
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 800,
  className,
  testId,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
  testId?: string;
}) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (ts: number) => {
      const p = reduce ? 1 : Math.min(1, (ts - t0) / durationMs);
      // easeOutCubic : ça démarre vite et ça se pose.
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(p >= 1 ? value : start + (value - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, durationMs]);

  return (
    <span data-testid={testId} className={className}>
      {format(shown)}
    </span>
  );
}
