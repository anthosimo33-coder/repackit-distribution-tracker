"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Compteur qui grimpe quand le chiffre entre à l'écran.
 *
 * Le nombre FINAL est rendu côté serveur (`children` = la valeur déjà
 * formatée) : sans JavaScript, avec `prefers-reduced-motion`, ou pour un
 * lecteur d'écran, on lit la bonne valeur tout de suite. L'animation ne fait
 * que remplacer ce texte pendant ~1,4 s.
 *
 * ⚠️ Le formatage est décrit par des DONNÉES (`locale` + `compact`), jamais par
 * une fonction : une fonction passée d'un composant serveur à un composant
 * client n'est pas sérialisable et fait planter le rendu — c'est ce qui a mis
 * la page d'accueil en erreur 500 en production le 20/09/2026, invisible en
 * local où le bloc de chiffres n'est pas rendu (projet absent).
 */
export function CountUp({
  value,
  locale,
  compact = false,
  children,
  className,
}: {
  value: number;
  locale: string;
  /** Même réglage que le rendu serveur, pour éviter tout saut de format. */
  compact?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [text, setText] = useState<string | null>(null);
  const format = useMemo(
    () =>
      new Intl.NumberFormat(
        locale,
        compact ? { notation: "compact", maximumFractionDigits: 1 } : {},
      ),
    [locale, compact],
  );

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
          setText(format.format(Math.round(value * eased)));
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
