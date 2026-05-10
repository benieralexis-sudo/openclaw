// Bandeau "Sources publiques" — refonte v6.1 (10/05/2026) phase 2
// Au lieu d'un marquee plat, format "logos officiels" avec petite puce
// SVG distinctive par source. Plus crédible, plus visuel.

interface Source {
  name: string;
  desc: string;
  icon: React.ReactNode;
}

// Pictogrammes officiels publics (formes simples qui rappellent les logos)
const BODACC_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 8h10M7 12h6M7 16h8" />
  </svg>
);

const INPI_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const PAPPERS_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

const FRANCE_TRAVAIL_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="6" width="20" height="14" rx="2" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const PRESSE_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
    <path d="M18 14h-8M15 18h-5M10 6h8v4h-8z" />
  </svg>
);

const LINKEDIN_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
    <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8 17H5.5v-7H8v7zM6.7 8.7c-.8 0-1.4-.6-1.4-1.3 0-.7.6-1.3 1.4-1.3.8 0 1.4.6 1.4 1.3 0 .7-.6 1.3-1.4 1.3zM18 17h-2.5v-3.7c0-2.4-3-2.2-3 0V17H10v-7h2.5v1.4c1.1-2 5.5-2.2 5.5 2V17z" />
  </svg>
);

const WTTJ_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10" />
    <path d="M2 12h20" />
  </svg>
);

const JOAFE_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 21h18M5 21V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13M9 21V11M15 21V11M9 7V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4" />
  </svg>
);

const RSS_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" fill="currentColor" />
  </svg>
);

const SOURCES: Source[] = [
  { name: "BODACC", desc: "Annonces commerciales", icon: BODACC_ICON },
  { name: "INPI", desc: "Dépôts marques", icon: INPI_ICON },
  { name: "Pappers", desc: "SIRENE complet", icon: PAPPERS_ICON },
  { name: "France Travail", desc: "Offres tech", icon: FRANCE_TRAVAIL_ICON },
  { name: "Presse Tech FR", desc: "Levées de fonds", icon: PRESSE_ICON },
  { name: "LinkedIn Jobs", desc: "Recrutement live", icon: LINKEDIN_ICON },
  { name: "Welcome to the Jungle", desc: "Recrutement startups", icon: WTTJ_ICON },
  { name: "JOAFE", desc: "Associations & fondations", icon: JOAFE_ICON },
  { name: "RSS spécialisés", desc: "News sectoriels", icon: RSS_ICON },
];

export function SourcesMarquee() {
  return (
    <div className="relative bg-white py-12 border-y border-ink-100 overflow-hidden">
      <div className="text-center mb-8 px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-500">
          11 sources publiques françaises · scannées 24/7
        </p>
      </div>

      {/* Marquee dégradé fade left/right */}
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

        <div className="flex items-center gap-4 animate-marquee w-max">
          {[...SOURCES, ...SOURCES, ...SOURCES].map((s, i) => (
            <div
              key={i}
              className="flex-shrink-0 inline-flex items-center gap-2.5 px-4 h-11 rounded-lg bg-ink-50/60 border border-ink-200 text-ink-700 hover:bg-white hover:border-brand-200 transition-colors"
            >
              <span className="text-ink-500">{s.icon}</span>
              <div className="leading-tight">
                <p className="text-sm font-medium text-ink-900 whitespace-nowrap">{s.name}</p>
                <p className="text-[10px] text-ink-500 whitespace-nowrap">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
