// Listes curatees pour ICP / Tone — partagees serveur + client
// Ces valeurs sont les SEULES acceptees par le systeme (whitelist stricte)

const INDUSTRIES = [
  // Tech & Digital
  'SaaS', 'FinTech', 'HealthTech', 'EdTech', 'PropTech', 'LegalTech', 'InsurTech',
  'CleanTech', 'AgriTech', 'FoodTech', 'HRTech', 'MarTech', 'AdTech', 'RegTech',
  'Cybersecurite', 'Intelligence artificielle', 'Cloud & Infrastructure', 'IoT',
  'E-commerce', 'Marketplace',
  // Services
  'Conseil en management', 'Conseil en strategie', 'Conseil IT', 'Agence digitale',
  'Agence marketing', 'Agence communication', 'Recrutement & RH', 'Formation professionnelle',
  'Services financiers', 'Comptabilite & Audit', 'Juridique & Avocats',
  // Industrie
  'Industrie manufacturiere', 'BTP & Construction', 'Energie & Utilities',
  'Transport & Logistique', 'Immobilier', 'Automobile',
  // Commerce & Consommation
  'Retail & Distribution', 'Luxe & Mode', 'Agroalimentaire', 'Hotellerie & Restauration',
  // Sante & Sciences
  'Sante & Pharmacie', 'Biotechnologie', 'Dispositifs medicaux',
  // Medias & Divertissement
  'Medias & Edition', 'Divertissement & Gaming',
  // Autres
  'Telecom', 'Aeronautique & Defense'
];

const TITLES = [
  // C-Suite
  'CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CRO', 'CISO', 'CDO', 'CPO',
  // Fondateurs
  'Founder', 'Co-Founder', 'Associe', 'Gerant',
  // VP
  'VP Sales', 'VP Marketing', 'VP Engineering', 'VP Product', 'VP Operations',
  'VP Finance', 'VP HR',
  // Directeurs
  'Directeur General', 'Directeur Commercial', 'Directeur Marketing',
  'Directeur Technique', 'Directeur Financier', 'Directeur des Operations',
  'Directeur RH', 'Directeur Innovation', 'Directeur Digital',
  // Heads
  'Head of Sales', 'Head of Marketing', 'Head of Growth', 'Head of Product',
  'Head of Engineering', 'Head of HR', 'Head of Operations',
  // Managers
  'Sales Manager', 'Marketing Manager', 'Product Manager', 'Project Manager',
  'Account Manager', 'Business Development Manager', 'IT Manager'
];

const SENIORITIES = [
  { value: 'owner', label: 'Proprietaire' },
  { value: 'founder', label: 'Fondateur' },
  { value: 'c_suite', label: 'C-Suite (CEO, CTO...)' },
  { value: 'partner', label: 'Associe / Partner' },
  { value: 'vp', label: 'Vice-President' },
  { value: 'head', label: 'Head of...' },
  { value: 'director', label: 'Directeur' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Junior / Entry' },
  { value: 'intern', label: 'Stagiaire / Intern' }
];

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001+'];

const GEOGRAPHY = [
  'France', 'Belgique', 'Suisse', 'Luxembourg', 'Canada',
  'Allemagne', 'Royaume-Uni', 'Espagne', 'Italie', 'Pays-Bas', 'Portugal',
  'Irlande', 'Suede', 'Pologne', 'Etats-Unis',
  'Europe de l\'Ouest', 'Europe', 'Amerique du Nord', 'Mondial',
  'Paris, FR', 'Lyon, FR', 'Marseille, FR', 'Bordeaux, FR', 'Lille, FR',
  'Bruxelles, BE', 'Geneve, CH', 'Zurich, CH', 'Montreal, CA'
];

const FORBIDDEN_WORDS_STANDARD = [
  'SDR', 'pipeline', 'synergies', 'disruptif', 'game-changer',
  'innovant', 'cutting-edge', 'leverage', 'scalable', 'automatisation',
  'solution', 'offre', 'opportunite', 'exclusif', 'unique',
  'leader', 'ROI garanti', 'gratuit', 'derniere chance', 'urgent',
  'promotion', 'sans engagement', 'pilote', 'demo', 'webinar',
  'livre blanc', 'revolutionnaire', 'paradigme', 'best-in-class', 'ecosysteme'
];

const FORMALITIES = [
  { value: 'tres-formel', label: 'Tres formel (vouvoiement strict)' },
  { value: 'formel', label: 'Formel (vouvoiement souple)' },
  { value: 'decontracte', label: 'Decontracte (tutoiement)' },
  { value: 'familier', label: 'Familier (tutoiement direct)' }
];

module.exports = {
  INDUSTRIES, TITLES, SENIORITIES, COMPANY_SIZES,
  GEOGRAPHY, FORBIDDEN_WORDS_STANDARD, FORMALITIES
};
