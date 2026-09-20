"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Compteur qui grimpe quand le chiffre entre à l'écran.
 *
 * Le nombre FINAL est rendu côté serveur (`children` = la valeur déjà
 * formatée) : sans JavaScript, avec `prefers-reduced-motion`, ou pour un
 * lecteur d'écran, on lit la bonne valeur tout de suite. L'animation ne fait
 * que remplacer ce texte pendant ~1,4 s.
 */
export function CountUp({
  value,
  format,
  children,
  className,
}: {
  value: number;
  /** Même formatage que le rendu serveur (Intl), pour éviter tout saut. */
  format: (n: number) => string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const started = performance.now();
        const DURATION = 1400;
        const tick = (now: number) => {
          const t = Math.min(1, (now - started) / DURATION);
          // easeOutExpo : très rapide au début, s'arrête net sur la valeur.
          const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
          setText(format(Math.round(value * eased)));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, format]);

  return (
    <span ref={ref} className={className}>
      {text ?? children}
    </span>
  );
}
