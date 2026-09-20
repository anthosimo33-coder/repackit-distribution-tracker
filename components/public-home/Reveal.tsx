"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import styles from "./home.module.css";

/**
 * Apparition au défilement. Le contenu est TOUJOURS dans le DOM et lisible par
 * un lecteur d'écran ; seule l'opacité/translation est animée, et elle est
 * neutralisée par `prefers-reduced-motion` (CSS) comme sans JavaScript
 * (<noscript> dans la page). Un élément déjà visible au chargement s'affiche
 * sans attendre : pas de zone blanche au premier écran.
 *
 * `delay` décale les éléments d'une même rangée (cascade courte, 60–80 ms).
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "article" | "header";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Navigateur sans IntersectionObserver : on montre tout de suite, via
      // l'attribut plutôt que par un setState synchrone dans l'effet.
      el.setAttribute("data-shown", "");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      // Se déclenche un peu avant l'entrée réelle : l'élément est arrivé
      // quand l'œil le rejoint, au lieu de s'animer sous le nez du visiteur.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-reveal=""
      data-shown={shown ? "" : undefined}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(styles.reveal, className)}
    >
      {children}
    </Tag>
  );
}
