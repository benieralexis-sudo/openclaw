// iFIND Bot — Constantes centralisees
// Tous les magic numbers critiques en un seul endroit.
// Modifier ici = appliquer partout, sans toucher au code metier.
'use strict';

// --- Timeouts (ms) ---
const BRAIN_CYCLE_TIMEOUT = 10 * 60 * 1000;       // 10 min — max pour un brain cycle complet
const PROSPECT_RESEARCH_TIMEOUT = 30 * 1000;       // 30s — max pour ProspectResearcher
const STRATEGIC_ANALYSIS_TIMEOUT = 15 * 1000;      // 15s — max pour analyzeProspect
const EMAIL_GENERATION_TIMEOUT = 20 * 1000;        // 20s — max pour generateSingleEmail
const IMAP_CONNECT_TIMEOUT = 15 * 1000;            // 15s — max pour connexion IMAP
const ACTIONS_IN_FLIGHT_TTL = 5 * 60 * 1000;       // 5 min — TTL lock actions en cours

// --- Limites ---
const MAX_BRAIN_ACTIONS = 25;                       // Max actions par brain cycle
const MAX_BRAIN_RETRIES = 2;                        // Retries sur actions retryables
const MAX_EMAIL_GEN_RETRIES = 2;                    // Retries generation email Claude
const MAX_FORBIDDEN_WORD_RETRIES = 4;               // Retries suppression mots interdits
const MAX_COHORT_SIZE = 50;                         // Taille max cohorte email (v8.5)
const MAX_BATCH_PER_CYCLE = 50;                     // Max envois par cycle campaign
const MAX_SMTP_RETRIES = 3;                         // Retries envoi SMTP
const MAX_DATA_POOR_FAILS = 3;                      // Fails avant skip definitif data-poor
const MAX_CONSECUTIVE_EMAIL_SKIPS = 5;              // Circuit breaker: stop apres N skips

// --- Cooldowns et TTL (ms) ---
const DATA_POOR_COOLDOWN_1 = 7 * 24 * 60 * 60 * 1000;   // 7 jours apres 1er echec
const DATA_POOR_COOLDOWN_2 = 14 * 24 * 60 * 60 * 1000;  // 14 jours apres 2eme echec
const PROSPECT_RESEARCH_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 jours cache recherche
const QUEUE_CLEANUP_TTL = 48 * 60 * 60 * 1000;           // 48h TTL queue actions
const RECENTLY_FAILED_COOLDOWN = 3 * 24 * 60 * 60 * 1000;// 3 jours cooldown echecs
const COMPANY_DEDUP_WINDOW = 72 * 60 * 60 * 1000;        // 72h dedup meme entreprise
const PREVIOUS_EMAIL_WINDOW = 14 * 24 * 60 * 60 * 1000;  // 14j fenetre emails precedents
const MX_CACHE_TTL = 60 * 60 * 1000;                     // 1h cache MX
const SMTP_CACHE_TTL = 24 * 60 * 60 * 1000;              // 24h cache SMTP

// --- Seuils scoring ---
const MIN_LEAD_SCORE_DEFAULT = 5;                   // Score minimum par defaut
const MIN_LEAD_SCORE_HIGH_POOL = 7;                 // Score releve si assez de leads
const HIGH_POOL_THRESHOLD = 10;                     // Nb leads score>=7 pour relever le seuil
const MIN_BRIEF_LENGTH = 80;                        // Chars minimum brief prospect
const MIN_BRIEF_SOURCES = 1;                        // Sources minimum dans le brief
const LAVENDER_MIN_SCORE = 65;                      // Score Lavender minimum pour envoyer
const MAX_EMAIL_WORDS = 80;                         // Mots max dans un email (v8.5)

// --- Signal boosts ---
const SIGNAL_FRESHNESS_48H = 48 * 60 * 60 * 1000;  // Boost 1.5x si signal < 48h
const SIGNAL_FRESHNESS_7D = 7 * 24 * 60 * 60 * 1000; // Boost 1.2x si signal < 7j

// --- Health score ---
const HEALTH_ALERT_THRESHOLD = 50;                  // Alerte Telegram si score < 50
const HEALTH_HISTORY_SIZE = 50;                     // Garder 50 derniers cycles

// --- Rate limiting ---
const ALERT_COOLDOWN = 30 * 60 * 1000;             // 30 min entre alertes identiques
const HUMAN_DELAY_MIN = 3000;                       // 3s delay min entre emails
const HUMAN_DELAY_MAX = 8000;                       // 8s delay max entre emails

module.exports = {
  // Timeouts
  BRAIN_CYCLE_TIMEOUT, PROSPECT_RESEARCH_TIMEOUT, STRATEGIC_ANALYSIS_TIMEOUT,
  EMAIL_GENERATION_TIMEOUT, IMAP_CONNECT_TIMEOUT, ACTIONS_IN_FLIGHT_TTL,
  // Limites
  MAX_BRAIN_ACTIONS, MAX_BRAIN_RETRIES, MAX_EMAIL_GEN_RETRIES,
  MAX_FORBIDDEN_WORD_RETRIES, MAX_COHORT_SIZE, MAX_BATCH_PER_CYCLE,
  MAX_SMTP_RETRIES, MAX_DATA_POOR_FAILS, MAX_CONSECUTIVE_EMAIL_SKIPS,
  // Cooldowns
  DATA_POOR_COOLDOWN_1, DATA_POOR_COOLDOWN_2, PROSPECT_RESEARCH_CACHE_TTL,
  QUEUE_CLEANUP_TTL, RECENTLY_FAILED_COOLDOWN, COMPANY_DEDUP_WINDOW,
  PREVIOUS_EMAIL_WINDOW, MX_CACHE_TTL, SMTP_CACHE_TTL,
  // Scoring
  MIN_LEAD_SCORE_DEFAULT, MIN_LEAD_SCORE_HIGH_POOL, HIGH_POOL_THRESHOLD,
  MIN_BRIEF_LENGTH, MIN_BRIEF_SOURCES, LAVENDER_MIN_SCORE, MAX_EMAIL_WORDS,
  // Signals
  SIGNAL_FRESHNESS_48H, SIGNAL_FRESHNESS_7D,
  // Health
  HEALTH_ALERT_THRESHOLD, HEALTH_HISTORY_SIZE,
  // Rate limiting
  ALERT_COOLDOWN, HUMAN_DELAY_MIN, HUMAN_DELAY_MAX
};
