"use client";

import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

export function AnimatedStat({ value, suffix = "", label, sublabel }: { value: number; suffix?: string; label: string; sublabel?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const duration = 1500;
    const start = Date.now();
    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.floor(value * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    animate();
  }, [isInView, value]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6 }}
      className="text-center"
    >
      <div className="font-display text-6xl md:text-7xl font-bold bg-gradient-to-br from-brand-600 to-brand-800 bg-clip-text text-transparent leading-none">
        {displayValue}{suffix}
      </div>
      <p className="mt-3 text-sm font-semibold text-ink-900">{label}</p>
      {sublabel && <p className="text-xs text-ink-500 mt-0.5">{sublabel}</p>}
    </motion.div>
  );
}
