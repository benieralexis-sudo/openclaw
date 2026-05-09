
import { ReactNode } from "react";

export function FeatureShowcase({
  badge,
  title,
  description,
  bullets,
  visual,
  reverse,
  accent = "brand",
}: {
  badge: string;
  title: ReactNode;
  description: string;
  bullets: string[];
  visual: ReactNode;
  reverse?: boolean;
  accent?: "brand" | "amber";
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
      <div
        className={reverse ? "lg:order-2" : ""}
      >
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-5 ${accent === "amber" ? "bg-amber-100 text-amber-700" : "bg-brand-100 text-brand-700"}`}>
          {badge}
        </div>
        <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900 leading-[1.1] mb-5">
          {title}
        </h2>
        <p className="text-lg text-ink-600 leading-relaxed mb-7">
          {description}
        </p>
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-ink-700">
              <span className={`flex-shrink-0 mt-1 w-5 h-5 rounded-full flex items-center justify-center ${accent === "amber" ? "bg-amber-100" : "bg-brand-100"}`}>
                <svg className={`w-3 h-3 ${accent === "amber" ? "text-amber-600" : "text-brand-600"}`} fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </span>
              <span className="text-base">{b}</span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className={reverse ? "lg:order-1" : ""}
      >
        {visual}
      </div>
    </div>
  );
}
