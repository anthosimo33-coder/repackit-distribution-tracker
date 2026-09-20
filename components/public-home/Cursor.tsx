"use client";

import { useEffect, useRef } from "react";
import styles from "./home.module.css";

/**
 * Curseur personnalisé de la landing : un point net + un halo améthyste qui
 * suit avec un temps de retard, et qui grossit au survol de ce qui se clique.
 *
 * Garde-fous : rien sur écran tactile ou au stylet (`pointer: coarse`), rien
 * avec `prefers-reduced-motion`, et le curseur système n'est masqué QUE si ce
 * composant est monté (la règle `cursor: none` vit sur [data-cursor-on], posé
 * ici) — sans JavaScript, la souris reste visible.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement | null>(null);
  const halo = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    root.setAttribute("data-cursor-on", "");

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let hx = x;
    let hy = y;
    let visible = false;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!visible) {
        visible = true;
        if (dot.current) dot.current.style.opacity = "1";
        if (halo.current) halo.current.style.opacity = "1";
      }
      const interactive = (e.target as Element | null)?.closest(
        "a, button, summary, [data-hover]",
      );
      halo.current?.toggleAttribute("data-grow", Boolean(interactive));
    };
    const onLeave = () => {
      visible = false;
      if (dot.current) dot.current.style.opacity = "0";
      if (halo.current) halo.current.style.opacity = "0";
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      // Le halo rattrape le point : c'est ce retard qui donne la sensation.
      hx += (x - hx) * 0.18;
      hy += (y - hy) * 0.18;
      if (dot.current) dot.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      if (halo.current) halo.current.style.transform = `translate3d(${hx}px, ${hy}px, 0) translate(-50%, -50%)`;
    };
    raf = requestAnimationFrame(frame);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      root.removeAttribute("data-cursor-on");
    };
  }, []);

  return (
    <>
      <div ref={halo} aria-hidden className={styles.cursorHalo} />
      <div ref={dot} aria-hidden className={styles.cursorDot} />
    </>
  );
}
