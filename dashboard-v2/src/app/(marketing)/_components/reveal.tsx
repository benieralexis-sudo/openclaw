"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// Sprint Saint Graal (10/05/2026) — Composant Reveal client.
// Ajoute la classe .in-view quand l'element entre dans le viewport.
// Animation declenchee via CSS .reveal + .reveal.in-view (cf globals.css).
//
// Usage : <Reveal delay={0.1}>...</Reveal>

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -100px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${isVisible ? "in-view" : ""} ${className}`}
      style={delay > 0 ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
