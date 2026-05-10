"use client";

import * as React from "react";
import Link from "next/link";

// Magnetic button — le bouton suit légèrement le cursor au hover.
// Inspiration : Linear, Vercel, Browser Company.
// Mouvement subtil (max 6px), transition smooth, désactivé reduce-motion.

interface MagneticLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  strength?: number; // amplitude du mouvement, default 6px
}

export function MagneticLink({ href, children, className = "", strength = 6 }: MagneticLinkProps) {
  const ref = React.useRef<HTMLAnchorElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = ((e.clientX - cx) / (rect.width / 2)) * strength;
      const dy = ((e.clientY - cy) / (rect.height / 2)) * strength;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const onLeave = () => {
      el.style.transform = "translate(0, 0)";
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [strength]);

  return (
    <Link
      ref={ref}
      href={href as never}
      className={`inline-block transition-transform duration-300 ease-out ${className}`}
    >
      {children}
    </Link>
  );
}
