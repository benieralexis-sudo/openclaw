"use client";

import { useEffect, useRef, useState } from "react";

export function AnimatedStat({ value, suffix = "", label, sublabel }: { value: number; suffix?: string; label: string; sublabel?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Affichage immediat de la valeur finale (jamais invisible).
  // L'animation de comptage est un bonus quand l'element entre dans le viewport.
  const [displayValue, setDisplayValue] = useState(value);
  const animatedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || animatedRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !animatedRef.current) {
            animatedRef.current = true;
            // Anime de 0 vers value seulement si JS dispo
            setDisplayValue(0);
            const duration = 1500;
            const start = Date.now();
            const animate = () => {
              const elapsed = Date.now() - start;
              const progress = Math.min(elapsed / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              setDisplayValue(Math.floor(value * eased));
              if (progress < 1) requestAnimationFrame(animate);
              else setDisplayValue(value);
            };
            requestAnimationFrame(animate);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={ref} className="text-center">
      <div className="font-display text-5xl md:text-6xl lg:text-7xl font-bold bg-gradient-to-br from-brand-600 to-brand-800 bg-clip-text text-transparent leading-none tabular-nums">
        {displayValue}{suffix}
      </div>
      <p className="mt-3 text-sm font-semibold text-ink-900">{label}</p>
      {sublabel && <p className="text-xs text-ink-500 mt-0.5">{sublabel}</p>}
    </div>
  );
}
