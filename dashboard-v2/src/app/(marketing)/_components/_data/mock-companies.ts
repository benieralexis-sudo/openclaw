// Données illustratives — refonte v5 (10/05/2026).
//
// IMPORTANT : tous les noms de boîtes sont fictifs (préfixés Demo).
// SIRETs factices commencent par 999 (jamais attribué INSEE).
// Aucun témoignage client réel — section témoignages remplacée par
// stats produit anonymisées (cf. STATS_PRODUIT).

export interface MockCompany {
  company: string;
  siret: string;
  industry: string;
  size: string;
  location: string;
  score: number;
  signal: string;
  funding: string;
  time: string;
  isHot: boolean;
}

export const MOCK_PEPITES: MockCompany[] = [
  {
    company: "Demo SaaS A",
    siret: "999 850 257",
    industry: "Plateforme SaaS B2B",
    size: "180 p.",
    location: "Paris",
    score: 9,
    signal: "3 offres QA Engineer en 7 jours",
    funding: "Série B 12 M€",
    time: "il y a 2 h",
    isHot: true,
  },
  {
    company: "Demo SaaS B",
    siret: "999 743 012",
    industry: "Plateforme SaaS",
    size: "45 p.",
    location: "Lyon",
    score: 9,
    signal: "Co-fondateur cherche QA Lead",
    funding: "Pré-seed 800 k€",
    time: "il y a 5 h",
    isHot: true,
  },
  {
    company: "Demo Tech C",
    siret: "999 921 645",
    industry: "Ingénierie test",
    size: "120 p.",
    location: "Bordeaux",
    score: 8,
    signal: "DSI publie offre Test Automation",
    funding: "ETI · 80 M€ CA",
    time: "hier",
    isHot: false,
  },
  {
    company: "Demo Solutions D",
    siret: "999 489 110",
    industry: "Conseil tech",
    size: "80 p.",
    location: "Marseille",
    score: 8,
    signal: "Remplacement CTO en cours",
    funding: "Série A 5 M€",
    time: "hier",
    isHot: false,
  },
];

export interface MockFeedItem {
  type: "pepite" | "qualif" | "news";
  company: string;
  signal: string;
  time: string;
  source: string;
}

export const MOCK_FEED: MockFeedItem[] = [
  { type: "pepite", company: "Demo SaaS A", signal: "Recrute 3 QA Engineers · Série B 12 M€", time: "il y a 2 min", source: "BODACC + LinkedIn" },
  { type: "qualif", company: "Demo Datacore", signal: "Dépôt INPI marque test logiciel", time: "il y a 8 min", source: "INPI" },
  { type: "pepite", company: "Demo SaaS B", signal: "Co-fondateur cherche QA Lead", time: "il y a 14 min", source: "LinkedIn" },
  { type: "qualif", company: "Demo Stackcorp", signal: "Dirigeant publie offre Test Automation", time: "il y a 21 min", source: "Welcome to the Jungle" },
  { type: "news", company: "Demo Solutions D", signal: "Communiqué presse — expansion Bordeaux", time: "il y a 38 min", source: "Presse Tech FR" },
  { type: "pepite", company: "Demo Mediacore", signal: "Lève 8 M€ et recrute tech", time: "il y a 1 h", source: "Presse Tech FR" },
];

// Brief illustratif (reprend la structure réelle d'un brief Opus)
export const MOCK_BRIEF = {
  company: "Demo SaaS A",
  siret: "999 850 257",
  industry: "Plateforme SaaS B2B",
  size: "180 collaborateurs",
  location: "Paris",
  contextLine1: "Demo SaaS A — Plateforme SaaS B2B, 180 collaborateurs, Paris.",
  contextLine2Bold: "Vient de boucler 12 M€ Série B",
  contextLine2Suffix: " (annoncé presse il y a 8 jours). Plan d'hyper-croissance : doublement effectif d'ici fin 2026.",
  signalLine: "3 offres QA Engineer postées en 7 jours sur LinkedIn + Welcome to the Jungle. Le CTO a publié personnellement le job « Test Automation Lead » hier.",
  signalEmphasis: "Frustration recrutement QA confirmée.",
  pitch: "Bonjour, j'ai vu que vous recrutez 3 QA Engineers. On externalise l'infra test pour des PME tech qui scalent vite — ROI 6 mois en moyenne. 15 min cette semaine pour voir si ça matche votre roadmap post-Série B ?",
  contactEmail: "contact@demo-saas-a.fr",
  contactPhone: "+33 1 00 00 00 00",
  contactLinkedin: "linkedin.com/company/demo-saas-a",
};

// Stats produit anonymisées — utilisées en remplacement des témoignages.
// Données mesurées sur le bot iFIND production (client DTL, 30 derniers jours).
export const STATS_PRODUIT = [
  { value: "11", label: "Sources françaises", sub: "scannées 24/7" },
  { value: "18", label: "Pépites livrées", sub: "/ mois en moyenne" },
  { value: "95%", label: "Précision Cerveau V2", sub: "vs 80% V1" },
  { value: "48 h", label: "Premières détections", sub: "après onboarding" },
];
