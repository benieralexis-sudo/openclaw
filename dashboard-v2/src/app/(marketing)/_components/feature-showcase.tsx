import { ReactNode } from "react";
import { Check } from "lucide-react";

export function FeatureShowcase({
  eyebrow,
  title,
  description,
  bullets,
  visual,
  reverse,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  bullets: string[];
  visual: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
      <div className={reverse ? "lg:order-2" : ""}>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-4">{eyebrow}</p>
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink-900 tracking-tight leading-[1.15] mb-5">
          {title}
        </h2>
        <p className="text-base md:text-lg text-ink-600 leading-relaxed mb-7">{description}</p>
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-ink-700">
              <span className="flex-shrink-0 mt-1 w-4 h-4 rounded-full bg-brand-50 flex items-center justify-center">
                <Check className="w-2.5 h-2.5 text-brand-700" strokeWidth={3} />
              </span>
              <span className="text-[15px] leading-relaxed">{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>{visual}</div>
    </div>
  );
}
