import "server-only";

/**
 * V1 18/05/2026 — Pappers DEPRECATED, remplacé par l'API gouv gratuite.
 *
 * Ce fichier garde le nom `pappers.ts` et tous les exports pour ne pas
 * casser les 20 fichiers consommateurs (rodz-webhook, theirstack-poller,
 * enrich-lead-dirigeants, audit-heal, etc.) qui font
 * `import { ... } from "@/lib/pappers"`.
 *
 * Sous le capot tout passe maintenant par `gouv-api.ts` qui appelle
 * https://recherche-entreprises.api.gouv.fr (gratuit, 400 appels/min,
 * SLA 100%, données SIRENE INSEE + RNE INPI + BODACC).
 *
 * Pappers (API payante api.pappers.fr) n'est plus appelée nulle part.
 *
 * Pourquoi ne pas avoir directement renommé `pappers.ts` → `gouv-api.ts` ?
 *   - Moins de bruit dans le diff (1 fichier modifié au lieu de 20)
 *   - Permet de garder `pappersStats.provider="gouv-api"` pour distinguer
 *     dans les logs sans casser les références
 *   - Si on rechange un jour de fournisseur (Pappers back, ou autre),
 *     un seul fichier à toucher
 */

export {
  // Types
  type PappersEntreprise,
  type PappersSearchResult,
  type SearchOptions,
  // Stats / instrumentation
  pappersStats,
  // Fonctions
  getEntreprise,
  getEntrepriseFull,
  searchByName,
  attributeSirene,
  enrichForBrief,
  findHumanDirigeantRecursive,
  // Erreur
  PappersError,
} from "@/lib/gouv-api";
