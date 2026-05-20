// @ts-nocheck — Configuration ICP Digidemat (secteur public, topic signature électronique)
// Bombora FR Jour 15 (20/05/2026). Met en place les paramètres ICP pour que :
// - les pollers Bombora filtrent correctement (country_codes, antiPersonas)
// - le brief Opus soit calibré pour secteur public (DSI/DPO/Direction Achats Publics)
// - HarvestAPI/Dirigeants cherchent les bons décideurs
import { db } from "@/lib/db";

const DIGIDEMAT_ICP = {
  // === Pays + langue ===
  country_codes: ["FR"],
  language: "fr",

  // === Décideurs cibles (collectivités + organismes publics) ===
  // L'ordre + weight influence le scoring persona côté brief Opus.
  // DSI = principal, DPO/Direction Achats Publics en piliers, fallback Secrétaire général.
  personas: [
    { title: "DSI", weight: 1.0 },
    { title: "Directeur des Systèmes d'Information", weight: 1.0 },
    { title: "Directeur Adjoint des Systèmes d'Information", weight: 0.95 },
    { title: "Responsable Informatique", weight: 0.9 },
    { title: "DPO", weight: 0.9 },
    { title: "Délégué à la Protection des Données", weight: 0.9 },
    { title: "Directeur des Achats", weight: 0.95 },
    { title: "Directeur Marchés Publics", weight: 0.95 },
    { title: "Acheteur Public", weight: 0.85 },
    { title: "Directeur Général des Services", weight: 0.85 },
    { title: "Secrétaire général", weight: 0.7 },
    { title: "Directeur Administratif et Financier", weight: 0.7 },
  ],

  // === NAF codes — Administration + Santé + Éducation + Associations ===
  // 84.* = Administration publique
  // 85.* = Enseignement (CNFPT = 85.59A)
  // 86.* = Santé humaine (Centres hospitaliers)
  // 87.* = Action sociale avec hébergement
  // 88.* = Action sociale sans hébergement
  // 94.* = Organisations associatives (UCANSS = 94.99Z, SICIO syndicat)
  naf_codes: [
    "84.11Z", "84.12Z", "84.13Z", "84.21Z", "84.22Z", "84.23Z", "84.24Z", "84.25Z", "84.30A", "84.30B", "84.30C",
    "85.42Z", "85.59A", "85.59B",
    "86.10Z", "86.21Z", "86.22A", "86.22B", "86.22C", "86.90A",
    "87.10A", "87.10B", "87.10C",
    "88.10A", "88.10B", "88.99B",
    "94.11Z", "94.12Z", "94.99Z",
  ],

  // === Taille effectif ===
  // Collectivités vraiment intéressantes : >100 agents (sinon DSI mutualisée)
  // Plafond souple : pas vraiment pertinent côté public
  company_size_min: 100,
  company_size_max: null, // pas de cap (CHU 5000 = OK)

  // === Anti-personas (concurrents Digidemat à exclure) ===
  // Éditeurs de solutions signature/parapheur : Yousign, Universign, DocuSign, etc.
  // Ces boîtes ont déjà la solution, pas la cible.
  antiPersonas: [
    "yousign", "universign", "docusign", "lex persona", "signaturit",
    "oodrive", "sap signavio", "kofax", "namirial",
  ],

  // === Topics Bombora FR ===
  // Mots-clés pour filtrer BOAMP/RSS Médias/France Travail/TED Europa
  // Source de vérité : ClientSignalConfig.parameters.boampKeywords pour P3
  // Ces topics serviront aussi pour brief Opus contextuel.
  bomboraTopics: [
    "signature électronique",
    "signature numérique",
    "parapheur électronique",
    "parapheur numérique",
    "certificat de signature",
    "cachet électronique",
    "dématérialisation",
    "gestion électronique des documents",
    "GED",
    "Chorus Pro",
    "transmission dématérialisée",
    "courrier dématérialisé",
  ],

  // === Brief Opus context ===
  signalPrimary: "BOOST FORT (+2 points sur le scoring final, plancher 8 si autres axes OK) si AU MOINS UN signal observable : (1) appel d'offres BOAMP/TED Europa explicite signature/parapheur/GED <60j, (2) RSS média mentionne le client en relation avec dématérialisation, (3) recrutement DSI/DPO/Acheteur Public sur thème signature ou dématérialisation, (4) commit GitHub mentionnant DocuSign/Yousign/parapheur. Sweet spot = appel d'offres BOAMP en cours (J+0 à J+60 idéal).",

  signalSecondary: "BOOST MOYEN (+1 point) si commune/département >50K habitants OU établissement public >300 agents (cible TPE-PME Digidemat = budget signature ~3-15K€/an).",

  successMetric: "Signature d'un contrat Digidemat 12 mois suite à phase d'évaluation. Cible : 1 deal par trimestre signé sur les 5 Pépites identifiées (UCANSS, CNFPT, CD Calvados, CH Lens, SICIO).",

  dreamArchetype: "Directrice DSI ou DPO d'une collectivité territoriale (département, CCAS, CHU) ou organisme public (UCANSS, CNFPT) qui cherche à dématérialiser la signature des actes/arrêtés/dossiers RH après publication d'un appel d'offres BOAMP/TED Europa.",

  senderFirstName: "Andreea",

  // === Filtres titre (HarvestAPI + Apify) ===
  titleFilterInclude: ["DSI", "DPO", "Acheteur Public", "Directeur des Achats", "Directeur Marchés Publics", "Directeur Adjoint", "Responsable Informatique", "Directeur Administratif", "Directeur Général des Services"],
  titleFilterExclude: ["Stage", "Stagiaire", "Apprenti", "Alternance", "Freelance", "Auto-entrepreneur"],

  // === Tarification (à valider workshop Andreea) ===
  tarif_Digidemat_mensuel: 390,           // à confirmer
  tarif_Digidemat_garantie_pepites: 6,    // à confirmer

  auto_qualify_enabled: true,
};

async function main() {
  const dig = await db.client.findFirst({ where: { name: "Digidemat" } });
  if (!dig) {
    console.error("❌ Client Digidemat introuvable");
    process.exit(1);
  }
  console.log(`Client trouvé: ${dig.name} (id=${dig.id}, status=${dig.status})`);
  console.log(`ICP actuel a ${Object.keys((dig.icp as any) ?? {}).length} clés`);

  const updated = await db.client.update({
    where: { id: dig.id },
    data: { icp: DIGIDEMAT_ICP as any },
  });
  console.log(`✅ ICP Digidemat mis à jour avec ${Object.keys(DIGIDEMAT_ICP).length} clés`);
  console.log(`   personas: ${DIGIDEMAT_ICP.personas.length} cibles`);
  console.log(`   naf_codes: ${DIGIDEMAT_ICP.naf_codes.length} codes`);
  console.log(`   bomboraTopics: ${DIGIDEMAT_ICP.bomboraTopics.length} mots-clés`);
  console.log(`   antiPersonas: ${DIGIDEMAT_ICP.antiPersonas.length} exclusions concurrents`);

  await db.$disconnect();
}

main().catch(e => { console.error("SETUP FAIL:", e); process.exit(1); });
