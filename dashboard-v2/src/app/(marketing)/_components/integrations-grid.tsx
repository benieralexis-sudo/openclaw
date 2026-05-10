// Section Intégrations — 12+ outils avec logos SVG inline.
// Refonte v6.1 (10/05/2026) — phase 2 densité Clay-tier.
//
// Logos inline SVG (pas de Lucide générique) — chaque card respire et
// ressemble à un vrai bandeau "intégrations".

interface Integration {
  name: string;
  category: string;
  logo: React.ReactNode;
  bg: string; // gradient bg si highlight
}

const SLACK = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <path fill="#E01E5A" d="M14 38a4 4 0 1 1-4-4h4Zm2 0a4 4 0 0 1 8 0v10a4 4 0 0 1-8 0Z" />
    <path fill="#36C5F0" d="M22 14a4 4 0 1 1 4-4v4Zm0 2a4 4 0 0 1 0 8H12a4 4 0 0 1 0-8Z" />
    <path fill="#2EB67D" d="M46 22a4 4 0 1 1 4 4h-4Zm-2 0a4 4 0 0 1-8 0V12a4 4 0 0 1 8 0Z" />
    <path fill="#ECB22E" d="M38 46a4 4 0 1 1-4 4v-4Zm0-2a4 4 0 0 1 0-8h10a4 4 0 0 1 0 8Z" />
  </svg>
);

const TELEGRAM = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <circle cx="30" cy="30" r="30" fill="#27A6E5" />
    <path fill="#fff" d="M14 28.5l31-12c1.4-.5 2.6.4 2.2 2.5l-5.3 25c-.3 1.7-1.3 2.1-2.6 1.3l-7.2-5.3-3.5 3.4c-.4.4-.7.7-1.4.7l.5-7.4 13.4-12.1c.6-.5-.1-.8-.9-.3l-16.6 10.4-7.1-2.2c-1.5-.5-1.6-1.5.5-2Z" />
  </svg>
);

const HUBSPOT = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <circle cx="30" cy="30" r="30" fill="#FF7A59" />
    <path fill="#fff" d="M40 26v-4h-2v-3a3 3 0 0 0-6 0v3h-2v4a8 8 0 1 0 10 0Zm-5 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
  </svg>
);

const PIPEDRIVE = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#017737" />
    <path fill="#fff" d="M27 18c5 0 10 2 10 9 0 6-4 9-9 9h-3v8h-5V19l7-1Zm-2 13c4 0 6-1 6-4 0-3-2-4-6-4v8Z" />
  </svg>
);

const SALESFORCE = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#00A1E0" />
    <path fill="#fff" d="M22 24c-3 0-5 2-5 5s2 5 5 5c2 0 4-1 4-3l-2-1c0 1-1 1-2 1s-2-1-2-2 1-2 2-2 2 1 2 1l2-1c0-2-2-3-4-3Zm10 0c-3 0-5 2-5 5s2 5 5 5 5-2 5-5-2-5-5-5Zm0 8c-2 0-3-1-3-3s1-3 3-3 3 1 3 3-1 3-3 3Zm10-8h-2v10h2V24Zm-1-3c-1 0-2 1-2 1l1 1 1-1c1 0 1-1 0-1Z" />
  </svg>
);

const NOTION = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#fff" stroke="#000" strokeWidth="1.5" />
    <path fill="#000" d="M19 15v32l3 1 17-2V18l-17-3-3 0Zm22 5-12-2v28l12-1V20Zm-19-3 1 1v25l-1 1-2-1V18l2-1Z" />
  </svg>
);

const GOOGLE_WORKSPACE = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#fff" stroke="#E5E7EB" strokeWidth="1" />
    <path fill="#4285F4" d="M30 26v6h11c-1 5-5 8-11 8a13 13 0 1 1 8-23l4-4a18 18 0 1 0 5 13c0-1 0-2-1-3H30v3Z" />
  </svg>
);

const CALENDLY = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#006BFF" />
    <path fill="#fff" d="M19 22v18h22V22H19Zm0-2h22v-2c0-1-1-2-2-2h-2v-2c0-1-1-1-1-1s-1 0-1 1v2h-12v-2c0-1-1-1-1-1s-1 0-1 1v2h-2c-1 0-2 1-2 2v2Zm9 12h6v-6h-6v6Z" />
  </svg>
);

const ZAPIER = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#FF4F00" />
    <path fill="#fff" d="M30 17v8m0 10v8M17 30h8m10 0h8M21 21l5 5m8 8 5 5m-18 0 5-5m8-8 5-5" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const MAKE = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#6D00CC" />
    <path fill="#fff" d="M22 18l8 14V18h2l8 14V18h-2v18l-8-14v14h-2l-8-14v14h-2V18h4Z" />
  </svg>
);

const RESEND = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#000" />
    <path fill="#fff" d="M18 17h12a8 8 0 0 1 6 14l5 12h-5l-4-11h-9v11h-5V17Zm5 5v9h7a4 4 0 1 0 0-9h-7Z" />
  </svg>
);

const KASPR = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#0066FF" />
    <path fill="#fff" d="M22 17h5v11l8-11h6l-8 11 9 14h-6l-7-12-2 3v9h-5V17Z" />
  </svg>
);

const PAPPERS = (
  <svg viewBox="0 0 60 60" className="h-7 w-7">
    <rect width="60" height="60" rx="12" fill="#1E40AF" />
    <path fill="#fff" d="M21 17h7c4 0 7 3 7 7s-3 7-7 7h-2v11h-5V17Zm5 5v9h2c2 0 4-1 4-4s-2-5-4-5h-2Z" />
  </svg>
);

const INTEGRATIONS: Integration[] = [
  { name: "HubSpot", category: "CRM", logo: HUBSPOT, bg: "" },
  { name: "Pipedrive", category: "CRM", logo: PIPEDRIVE, bg: "" },
  { name: "Salesforce", category: "CRM", logo: SALESFORCE, bg: "" },
  { name: "Slack", category: "Communication", logo: SLACK, bg: "" },
  { name: "Telegram", category: "Communication", logo: TELEGRAM, bg: "" },
  { name: "Cal.com / Calendly", category: "Rendez-vous", logo: CALENDLY, bg: "" },
  { name: "Google Workspace", category: "Email", logo: GOOGLE_WORKSPACE, bg: "" },
  { name: "Resend", category: "Email transactionnel", logo: RESEND, bg: "" },
  { name: "Notion", category: "Knowledge base", logo: NOTION, bg: "" },
  { name: "Zapier", category: "Automation", logo: ZAPIER, bg: "" },
  { name: "Make", category: "Automation", logo: MAKE, bg: "" },
  { name: "Kaspr", category: "Enrichissement", logo: KASPR, bg: "" },
  { name: "Pappers", category: "SIRENE FR", logo: PAPPERS, bg: "" },
];

export function IntegrationsGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {INTEGRATIONS.map((i) => (
        <div
          key={i.name}
          className="group flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-4 hover:border-brand-200 hover:shadow-md transition-all"
        >
          <div className="flex-shrink-0">{i.logo}</div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900 truncate">{i.name}</p>
            <p className="text-[11px] text-ink-500 truncate">{i.category}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
