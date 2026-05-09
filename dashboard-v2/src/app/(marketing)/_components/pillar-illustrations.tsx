// Sprint Saint Graal (10/05/2026) — Illustrations SVG custom pour 3 piliers.
// Style : flat moderne, monochrome avec accent, pas de stock photo.

export function IntelligenceIllustration() {
  return (
    <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
      <defs>
        <linearGradient id="brain-grad" x1="0" y1="0" x2="200" y2="140">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1e40af" />
        </linearGradient>
        <linearGradient id="brain-soft" x1="0" y1="0" x2="100" y2="100">
          <stop offset="0" stopColor="#dbeafe" />
          <stop offset="1" stopColor="#bfdbfe" />
        </linearGradient>
      </defs>
      {/* Cercles de "pensée" en arrière-plan */}
      <circle cx="40" cy="40" r="20" fill="url(#brain-soft)" opacity="0.6" />
      <circle cx="160" cy="100" r="15" fill="url(#brain-soft)" opacity="0.5" />
      <circle cx="170" cy="35" r="10" fill="url(#brain-soft)" opacity="0.7" />
      {/* Cerveau central stylisé */}
      <g transform="translate(70, 35)">
        <rect x="0" y="0" width="60" height="60" rx="12" fill="url(#brain-grad)" />
        {/* Pattern interne (réseau neural) */}
        <circle cx="15" cy="20" r="3" fill="white" opacity="0.9" />
        <circle cx="30" cy="15" r="3" fill="white" opacity="0.9" />
        <circle cx="45" cy="22" r="3" fill="white" opacity="0.9" />
        <circle cx="20" cy="35" r="3" fill="white" opacity="0.9" />
        <circle cx="40" cy="38" r="3" fill="white" opacity="0.9" />
        <circle cx="30" cy="50" r="3" fill="white" opacity="0.9" />
        <line x1="15" y1="20" x2="30" y2="15" stroke="white" strokeWidth="1.5" opacity="0.6" />
        <line x1="30" y1="15" x2="45" y2="22" stroke="white" strokeWidth="1.5" opacity="0.6" />
        <line x1="15" y1="20" x2="20" y2="35" stroke="white" strokeWidth="1.5" opacity="0.6" />
        <line x1="45" y1="22" x2="40" y2="38" stroke="white" strokeWidth="1.5" opacity="0.6" />
        <line x1="20" y1="35" x2="30" y2="50" stroke="white" strokeWidth="1.5" opacity="0.6" />
        <line x1="40" y1="38" x2="30" y2="50" stroke="white" strokeWidth="1.5" opacity="0.6" />
        <line x1="20" y1="35" x2="40" y2="38" stroke="white" strokeWidth="1.5" opacity="0.6" />
      </g>
      {/* Petits éléments orbitant */}
      <g transform="translate(15, 80)">
        <rect x="0" y="0" width="30" height="20" rx="4" fill="white" stroke="#2563eb" strokeWidth="1.5" />
        <line x1="6" y1="7" x2="20" y2="7" stroke="#2563eb" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="6" y1="12" x2="14" y2="12" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <g transform="translate(155, 90)">
        <rect x="0" y="0" width="30" height="20" rx="4" fill="white" stroke="#f59e0b" strokeWidth="1.5" />
        <circle cx="6" cy="10" r="2.5" fill="#f59e0b" />
        <line x1="13" y1="8" x2="24" y2="8" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="13" y1="13" x2="20" y2="13" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function GarantieIllustration() {
  return (
    <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
      <defs>
        <linearGradient id="shield-grad" x1="0" y1="0" x2="0" y2="140">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
        <radialGradient id="shield-glow" cx="100" cy="70" r="50">
          <stop offset="0" stopColor="#fef3c7" stopOpacity="0.8" />
          <stop offset="1" stopColor="#fef3c7" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Glow background */}
      <circle cx="100" cy="70" r="55" fill="url(#shield-glow)" />
      {/* Shield central */}
      <g transform="translate(70, 25)">
        <path d="M 30 0 L 0 12 L 0 50 Q 0 80 30 90 Q 60 80 60 50 L 60 12 Z" fill="url(#shield-grad)" />
        {/* Checkmark */}
        <path d="M 18 45 L 27 54 L 45 36" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
      {/* "6" badge */}
      <g transform="translate(135, 30)">
        <circle cx="0" cy="0" r="18" fill="white" stroke="#fbbf24" strokeWidth="3" />
        <text x="0" y="6" fontFamily="Inter, system-ui" fontSize="22" fontWeight="800" fill="#d97706" textAnchor="middle">6</text>
      </g>
      {/* Pépites volantes */}
      <g transform="translate(30, 20)">
        <circle cx="0" cy="0" r="6" fill="#fbbf24" opacity="0.9" />
        <path d="M -3 0 L -1 2 L 3 -2" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>
      <g transform="translate(20, 95)">
        <circle cx="0" cy="0" r="5" fill="#fbbf24" opacity="0.7" />
      </g>
      <g transform="translate(170, 100)">
        <circle cx="0" cy="0" r="7" fill="#fbbf24" opacity="0.85" />
        <path d="M -3 0 L -1 2 L 3 -2" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

export function TempsReelIllustration() {
  return (
    <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
      <defs>
        <linearGradient id="lightning-grad" x1="0" y1="0" x2="0" y2="140">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1e40af" />
        </linearGradient>
        <linearGradient id="bar-grad" x1="0" y1="100" x2="0" y2="0">
          <stop offset="0" stopColor="#dbeafe" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {/* Bars chart background */}
      <g transform="translate(20, 60)">
        <rect x="0" y="40" width="14" height="40" rx="3" fill="url(#bar-grad)" opacity="0.5" />
        <rect x="22" y="25" width="14" height="55" rx="3" fill="url(#bar-grad)" opacity="0.6" />
        <rect x="44" y="35" width="14" height="45" rx="3" fill="url(#bar-grad)" opacity="0.5" />
        <rect x="66" y="10" width="14" height="70" rx="3" fill="url(#bar-grad)" opacity="0.7" />
        <rect x="88" y="20" width="14" height="60" rx="3" fill="url(#bar-grad)" opacity="0.6" />
        <rect x="110" y="0" width="14" height="80" rx="3" fill="url(#bar-grad)" />
        <rect x="132" y="15" width="14" height="65" rx="3" fill="url(#bar-grad)" opacity="0.7" />
        <rect x="154" y="30" width="14" height="50" rx="3" fill="url(#bar-grad)" opacity="0.5" />
      </g>
      {/* Lightning central */}
      <g transform="translate(85, 25)">
        <path d="M 18 0 L 4 35 L 14 35 L 8 60 L 26 22 L 16 22 Z" fill="url(#lightning-grad)" stroke="white" strokeWidth="2" strokeLinejoin="round" />
      </g>
      {/* Live pulse indicator */}
      <g transform="translate(165, 25)">
        <circle cx="0" cy="0" r="8" fill="#10b981" opacity="0.3">
          <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="0" cy="0" r="5" fill="#10b981" />
      </g>
      {/* "24/7" label */}
      <g transform="translate(28, 28)">
        <rect x="-2" y="-10" width="36" height="20" rx="4" fill="white" stroke="#2563eb" strokeWidth="1.5" />
        <text x="16" y="4" fontFamily="ui-monospace, monospace" fontSize="11" fontWeight="700" fill="#1e40af" textAnchor="middle">24/7</text>
      </g>
    </svg>
  );
}
