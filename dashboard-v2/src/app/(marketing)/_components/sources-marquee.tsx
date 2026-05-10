// Sources marquee — version réduite (10/05/2026 v5.4).
// Seuls 3 noms iconiques + "8 autres sources" pour protéger le moat technique.
// La liste détaillée n'est plus publiée — c'est notre savoir-faire.

const VISIBLE_SOURCES = [
  "BODACC",
  "INPI",
  "Pappers",
  "France Travail",
  "Presse Tech FR",
  "Sources publiques",
];

export function SourcesMarquee() {
  return (
    <div className="relative overflow-hidden bg-white py-12 border-y border-ink-100">
      <div className="text-center mb-8 px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-500">
          11 sources publiques françaises · scannées 24/7
        </p>
      </div>
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

        <div className="flex items-center gap-8 animate-marquee w-max">
          {[...VISIBLE_SOURCES, ...VISIBLE_SOURCES, ...VISIBLE_SOURCES, ...VISIBLE_SOURCES].map((s, i) => (
            <div key={i} className="flex items-center gap-8">
              <span className="font-display text-lg font-medium text-ink-500 whitespace-nowrap select-none hover:text-ink-900 transition-colors">
                {s}
              </span>
              <span className="text-ink-200 select-none" aria-hidden>·</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
