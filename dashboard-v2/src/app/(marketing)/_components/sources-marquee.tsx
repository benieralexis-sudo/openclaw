const SOURCES = [
  "BODACC",
  "INPI",
  "Pappers",
  "France Travail",
  "LinkedIn Jobs",
  "Welcome to the Jungle",
  "JOAFE",
  "Presse Tech FR",
  "RSS spécialisés",
  "Intent data B2B",
  "Tech stack discovery",
];

export function SourcesMarquee() {
  return (
    <div className="relative overflow-hidden bg-white py-10 border-y border-ink-100">
      <div className="text-center mb-6 px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">
          11 sources publiques françaises · scannées 24/7
        </p>
      </div>
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

        <div className="flex gap-10 animate-marquee w-max">
          {[...SOURCES, ...SOURCES, ...SOURCES].map((s, i) => (
            <span
              key={i}
              className="font-display text-base font-medium text-ink-400 whitespace-nowrap select-none"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
