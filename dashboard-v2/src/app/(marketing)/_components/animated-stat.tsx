"use client";

import { useEffect, useRef, useState } from "react";

export function AnimatedStat({ value, suffix = "", label, sublabel }: { value: number; suffix?: string; label: string; sublabel?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
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
            setDisplayValue(0);
            const duration = 1200;
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
    <div ref={ref}>
      <div className="font-display text-5xl md:text-6xl font-semibold text-ink-900 tracking-tight tabular-nums">
        {displayValue}{suffix}
      </div>
      <p className="mt-3 text-sm font-medium text-ink-700">{label}</p>
      {sublabel && <p className="text-xs text-ink-500 mt-0.5">{sublabel}</p>}
    </div>
  );
}
