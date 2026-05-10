"use client";

import { useEffect, useRef, useState } from "react";

// Count-up animation à l'entrée dans le viewport.
// Si `value` est une string non-numérique (ex: "95%"), on parse le nombre
// et on conserve le suffixe pour l'affichage final.

export function AnimatedStat({ value, label, sublabel }: { value: string; label: string; sublabel?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const animatedRef = useRef(false);

  // Parse "95%" → number=95, suffix="%"
  // Parse "48 h" → number=48, suffix=" h"
  const match = value.match(/^(\d+)(.*)$/);
  const target = match && match[1] ? parseInt(match[1], 10) : 0;
  const suffix = match && match[2] ? match[2] : "";
  const isNumeric = !!match;

  const [display, setDisplay] = useState(isNumeric ? target : value);

  useEffect(() => {
    if (!isNumeric) return;
    const el = ref.current;
    if (!el || animatedRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !animatedRef.current) {
            animatedRef.current = true;
            setDisplay(0);
            const duration = 1200;
            const start = Date.now();
            const animate = () => {
              const elapsed = Date.now() - start;
              const progress = Math.min(elapsed / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              setDisplay(Math.floor(target * eased));
              if (progress < 1) requestAnimationFrame(animate);
              else setDisplay(target);
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
  }, [target, isNumeric]);

  return (
    <div ref={ref} className="text-center">
      <div className="font-display text-5xl md:text-6xl font-semibold tracking-tight tabular-nums bg-gradient-to-br from-ink-900 via-brand-800 to-brand-700 bg-clip-text text-transparent">
        {display}{isNumeric && suffix}
      </div>
      <p className="mt-3 text-sm font-medium text-ink-700">{label}</p>
      {sublabel && <p className="text-xs text-ink-500 mt-0.5">{sublabel}</p>}
    </div>
  );
}
