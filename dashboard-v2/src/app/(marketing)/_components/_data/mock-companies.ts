// Sprint Saint Graal (10/05/2026) — Données 100% fictives pour mockups marketing.
//
// IMPORTANT : aucun nom de boîte réelle, aucun SIRET réel, aucune donnée client.
// Toutes les boîtes ci-dessous sont inventées. Si une coïncidence existe avec
// une vraie société, elle est purement fortuite.
//
// SIRETs : 14 chiffres factices (commencent par 999 = jamais attribué INSEE).

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
    company: "Novanex",
    siret: "999 850 257",
    industry: "Plateforme SaaS",
    size: "180p",
    location: "Paris",
    score: 9,
    signal: "Recrute 3 QA Engineers",
    funding: "Série B 12M€",
    time: "il y a 2h",
    isHot: true,
  },
  {
    company: "Synatech",
    siret: "999 743 012",
    industry: "Plateforme SaaS",
    size: "45p",
    location: "Lyon",
    score: 10,
    signal: "Co-founder cherche QA Lead",
    funding: "Pré-seed 800k€",
    time: "il y a 5h",
    isHot: true,
  },
  {
    company: "Datalogic Pro",
    siret: "999 921 645",
    industry: "Ingénierie test",
    size: "120p",
    location: "Bordeaux",
    score: 8,
    signal: "DSI publie offre Test Automation",
    funding: "ETI 80M€ CA",
    time: "hier",
    isHot: false,
  },
  {
    company: "Veritas Solutions",
    siret: "999 489 110",
    industry: "Conseil tech",
    size: "80p",
    location: "Marseille",
    score: 8,
    signal: "CTO sortant + remplaçant publié",
    funding: "Série A 5M€",
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
  { type: "pepite", company: "Novanex", signal: "Recrute 3 QA Engineers + Série B 12M€", time: "il y a 2 min", source: "BODACC + LinkedIn" },
  { type: "qualif", company: "Datacore", signal: "Nouveau dépôt INPI marque test logiciel", time: "il y a 8 min", source: "INPI" },
  { type: "pepite", company: "Synatech", signal: "Co-founder cherche QA Lead urgence", time: "il y a 14 min", source: "LinkedIn" },
  { type: "qualif", company: "Stackcorp", signal: "Dirigeant publie offre Test Automation", time: "il y a 21 min", source: "WTTJ" },
  { type: "news", company: "Veritas Solutions", signal: "Communiqué presse expansion Bordeaux", time: "il y a 38 min", source: "RSS Tech FR" },
  { type: "pepite", company: "Mediacore", signal: "Groupe lève 8M€ + recrute tech", time: "il y a 1h", source: "RSS Tech FR" },
];

export interface MockTestimonial {
  quote: string;
  author: string;
  role: string;
  initials: string;
  metric: string;
  metricLabel: string;
  accent: "amber" | "brand" | "emerald";
}

export const MOCK_TESTIMONIALS: MockTestimonial[] = [
  {
    quote: "La garantie 6 Pépites a été le déclic. Tous les autres outils me promettaient du volume sans engagement. iFIND est le premier qui met sa peau dans le jeu : ils s'engagent sur la qualité.",
    author: "Marc Dupont",
    role: "Founder, TechSolve",
    initials: "MD",
    metric: "+340%",
    metricLabel: "taux de réponse",
    accent: "amber",
  },
  {
    quote: "On est passé de 12h/semaine de prospection manuelle à 30 minutes pour piloter. Mon équipe commerciale a doublé son pipeline en 3 mois sans changer d'effectif.",
    author: "Marie Lambert",
    role: "Head of Sales, ScaleTech",
    initials: "ML",
    metric: "2× pipeline",
    metricLabel: "en 3 mois",
    accent: "brand",
  },
  {
    quote: "L'attribution SIRENE Pappers + qualif Opus = c'est comme avoir un junior commercial qui filtre 500 prospects par jour pour ne livrer que les meilleurs. Magique.",
    author: "Thomas Mercier",
    role: "CEO, Synatech",
    initials: "TM",
    metric: "18 Pépites/mois",
    metricLabel: "en moyenne livrées",
    accent: "emerald",
  },
];

// Brief Opus mockup (utilisé dans BriefMockup component)
export const MOCK_BRIEF = {
  company: "Novanex",
  siret: "999 850 257",
  industry: "Plateforme SaaS",
  size: "180 collaborateurs",
  location: "Paris",
  contextLine1: "Novanex (999 850 257) — Plateforme SaaS B2B, 180 collaborateurs, Paris.",
  contextLine2Bold: "Vient de boucler 12M€ Série B",
  contextLine2Suffix: " (annoncé sur RSS Tech FR le 8 mai). Plan d'hyper-croissance : doublement effectif d'ici fin 2026.",
  signalLine: "3 offres QA Engineer postées en 7 jours sur LinkedIn + WTTJ. Le CTO a publié personnellement le job « Test Automation Lead » le 12/05.",
  signalEmphasis: "→ Frustration recrutement QA confirmée.",
  pitch: "Bonjour, j'ai vu que vous recrutez 3 QA Engineers chez Novanex. On externalise l'infra test pour des PME tech qui scalent vite — le ROI moyen est de 6 mois avec une équipe externe dédiée. 15 minutes cette semaine pour voir si ça matche votre roadmap post-Série B ?",
  contactEmail: "contact@novanex-demo.fr",
  contactPhone: "+33 1 00 00 00 00",
  contactLinkedin: "linkedin.com/company/novanex-demo",
};
