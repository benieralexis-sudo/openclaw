// Illustrations SVG signature — refonte v5.6 (10/05/2026)
// Géométrie abstraite, palette brand, animation subtle.
// Inspiré Vercel/Linear : pas d'illustration figurative, juste des
// systèmes graphiques qui évoquent les concepts.

export function SignalDetectionIllu() {
  return (
    <svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto" aria-hidden="true">
      <defs>
        <linearGradient id="sd-grad" x1="0" y1="0" x2="280" y2="200">
          <stop offset="0" stopColor="#3b82f6" stopOpacity="0.9" />
          <stop offset="1" stopColor="#1d4ed8" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="sd-fade" x1="0" y1="0" x2="280" y2="0">
          <stop offset="0" stopColor="#bfdbfe" stopOpacity="0" />
          <stop offset="0.4" stopColor="#bfdbfe" stopOpacity="0.5" />
          <stop offset="1" stopColor="#bfdbfe" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Lignes horizontales représentant les sources qui scannent */}
      {[40, 70, 100, 130, 160].map((y) => (
        <line key={y} x1="0" y1={y} x2="280" y2={y} stroke="url(#sd-fade)" strokeWidth="1" />
      ))}

      {/* Signaux ponctuels qui apparaissent sur les lignes */}
      <circle cx="50" cy="40" r="3" fill="#cbd5e1" />
      <circle cx="120" cy="70" r="3" fill="#cbd5e1" />
      <circle cx="200" cy="40" r="3" fill="#cbd5e1" />
      <circle cx="80" cy="100" r="3" fill="#cbd5e1" />
      <circle cx="220" cy="100" r="3" fill="#cbd5e1" />
      <circle cx="60" cy="130" r="3" fill="#cbd5e1" />
      <circle cx="180" cy="130" r="3" fill="#cbd5e1" />
      <circle cx="100" cy="160" r="3" fill="#cbd5e1" />
      <circle cx="240" cy="160" r="3" fill="#cbd5e1" />

      {/* Pépite détectée — pulse */}
      <circle cx="140" cy="100" r="14" fill="url(#sd-grad)" opacity="0.15">
        <animate attributeName="r" values="14;22;14" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0;0.4" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="140" cy="100" r="6" fill="url(#sd-grad)" />
      <circle cx="140" cy="100" r="2" fill="white" />

      {/* Liens depuis la Pépite vers les autres signaux (multi-source) */}
      <line x1="140" y1="100" x2="80" y2="100" stroke="#2563eb" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
      <line x1="140" y1="100" x2="220" y2="100" stroke="#2563eb" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
      <line x1="140" y1="100" x2="120" y2="70" stroke="#2563eb" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
      <line x1="140" y1="100" x2="180" y2="130" stroke="#2563eb" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
    </svg>
  );
}

export function AIQualifyIllu() {
  return (
    <svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto" aria-hidden="true">
      <defs>
        <linearGradient id="ai-grad" x1="0" y1="0" x2="280" y2="200">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>

      {/* Trois colonnes = entrée / cerveau / sortie */}
      {/* Inputs (gauche) */}
      <g>
        <rect x="20" y="40" width="50" height="14" rx="3" fill="#e2e8f0" />
        <rect x="20" y="64" width="50" height="14" rx="3" fill="#e2e8f0" />
        <rect x="20" y="88" width="50" height="14" rx="3" fill="#e2e8f0" />
        <rect x="20" y="112" width="50" height="14" rx="3" fill="#e2e8f0" />
        <rect x="20" y="136" width="50" height="14" rx="3" fill="#e2e8f0" />
        <text x="45" y="32" fontSize="9" fill="#64748b" textAnchor="middle" fontFamily="ui-monospace, monospace">CONTEXTE</text>
      </g>

      {/* Lignes de connexion (input → centre) */}
      {[47, 71, 95, 119, 143].map((y) => (
        <path
          key={y}
          d={`M 70 ${y} C 100 ${y}, 110 100, 130 100`}
          stroke="#cbd5e1"
          strokeWidth="1"
          fill="none"
          opacity="0.7"
        />
      ))}

      {/* Centre = cerveau IA */}
      <g>
        <rect x="120" y="70" width="60" height="60" rx="14" fill="url(#ai-grad)" />
        {/* Pattern interne (réseau neural simplifié) */}
        <circle cx="135" cy="85" r="2.5" fill="white" opacity="0.9" />
        <circle cx="150" cy="80" r="2.5" fill="white" opacity="0.9" />
        <circle cx="165" cy="85" r="2.5" fill="white" opacity="0.9" />
        <circle cx="140" cy="100" r="2.5" fill="white" opacity="0.9" />
        <circle cx="160" cy="100" r="2.5" fill="white" opacity="0.9" />
        <circle cx="150" cy="115" r="2.5" fill="white" opacity="0.9" />
        <line x1="135" y1="85" x2="150" y2="80" stroke="white" strokeWidth="1" opacity="0.5" />
        <line x1="150" y1="80" x2="165" y2="85" stroke="white" strokeWidth="1" opacity="0.5" />
        <line x1="135" y1="85" x2="140" y2="100" stroke="white" strokeWidth="1" opacity="0.5" />
        <line x1="165" y1="85" x2="160" y2="100" stroke="white" strokeWidth="1" opacity="0.5" />
        <line x1="140" y1="100" x2="160" y2="100" stroke="white" strokeWidth="1" opacity="0.5" />
        <line x1="140" y1="100" x2="150" y2="115" stroke="white" strokeWidth="1" opacity="0.5" />
        <line x1="160" y1="100" x2="150" y2="115" stroke="white" strokeWidth="1" opacity="0.5" />

        {/* Pulse contour */}
        <rect x="120" y="70" width="60" height="60" rx="14" fill="none" stroke="#2563eb" strokeWidth="2" opacity="0.3">
          <animate attributeName="opacity" values="0.6;0;0.6" dur="2.8s" repeatCount="indefinite" />
        </rect>
      </g>

      {/* Lignes centre → sortie */}
      {[80, 100, 120].map((y) => (
        <path
          key={y}
          d={`M 180 100 C 200 100, 210 ${y}, 230 ${y}`}
          stroke="#cbd5e1"
          strokeWidth="1"
          fill="none"
          opacity="0.7"
        />
      ))}

      {/* Outputs (droite) */}
      <g>
        <rect x="230" y="72" width="40" height="16" rx="3" fill="#dbeafe" stroke="#bfdbfe" strokeWidth="1" />
        <text x="250" y="83" fontSize="9" fill="#1d4ed8" textAnchor="middle" fontFamily="ui-monospace, monospace" fontWeight="600">9/10</text>

        <rect x="230" y="92" width="40" height="16" rx="3" fill="#dbeafe" stroke="#bfdbfe" strokeWidth="1" />
        <text x="250" y="103" fontSize="9" fill="#1d4ed8" textAnchor="middle" fontFamily="ui-monospace, monospace" fontWeight="600">OUI</text>

        <rect x="230" y="112" width="40" height="16" rx="3" fill="#dbeafe" stroke="#bfdbfe" strokeWidth="1" />
        <text x="250" y="123" fontSize="8" fill="#1d4ed8" textAnchor="middle" fontFamily="ui-monospace, monospace" fontWeight="600">BRIEF</text>

        <text x="250" y="64" fontSize="9" fill="#64748b" textAnchor="middle" fontFamily="ui-monospace, monospace">VERDICT</text>
      </g>
    </svg>
  );
}

export function GuaranteeIllu() {
  return (
    <svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto" aria-hidden="true">
      <defs>
        <linearGradient id="g-shield" x1="0" y1="0" x2="0" y2="200">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1e40af" />
        </linearGradient>
        <linearGradient id="g-bar" x1="0" y1="0" x2="0" y2="200">
          <stop offset="0" stopColor="#dbeafe" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>

      {/* Barres mensuelles (Pépites livrées) */}
      {[
        { x: 30, h: 60 },
        { x: 60, h: 75 },
        { x: 90, h: 95 },
        { x: 120, h: 50 },
        { x: 150, h: 88 },
        { x: 180, h: 110 },
      ].map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={170 - b.h}
          width="22"
          height={b.h}
          rx="3"
          fill="url(#g-bar)"
          opacity={i === 5 ? "1" : "0.6"}
        />
      ))}

      {/* Ligne de garantie horizontale (seuil 6 minimum) */}
      <line x1="20" y1="120" x2="270" y2="120" stroke="#1d4ed8" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.7" />
      <text x="250" y="116" fontSize="10" fill="#1d4ed8" fontFamily="ui-monospace, monospace" fontWeight="600">6 min.</text>

      {/* Bouclier central (garantie) */}
      <g transform="translate(220, 30)">
        <path
          d="M 25 0 L 0 10 L 0 35 Q 0 55 25 65 Q 50 55 50 35 L 50 10 Z"
          fill="url(#g-shield)"
        />
        <path
          d="M 14 32 L 22 40 L 36 24"
          stroke="white"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>

      {/* Petits chips numéraires sous les barres (mois) */}
      {["M-5", "M-4", "M-3", "M-2", "M-1", "Mois"].map((m, i) => (
        <text
          key={m}
          x={41 + i * 30}
          y={186}
          fontSize="9"
          fill={i === 5 ? "#1d4ed8" : "#94a3b8"}
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontWeight={i === 5 ? "700" : "400"}
        >
          {m}
        </text>
      ))}
    </svg>
  );
}
