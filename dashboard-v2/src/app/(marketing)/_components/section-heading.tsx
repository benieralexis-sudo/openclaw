import { ReactNode } from "react";

interface Props {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}

export function SectionHeading({ eyebrow, title, description, align = "center", className = "" }: Props) {
  const alignClass = align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <div className={`max-w-2xl ${alignClass} ${className}`}>
      {eyebrow && (
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-4">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-semibold text-ink-900 tracking-tight">
        {title}
      </h2>
      {description && (
        <p className="mt-5 text-base md:text-lg text-ink-600 leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}
