// Sprint 1 (10/05/2026) — Helper ICP matching commun pour les nouveaux pollers
// (rss-levees, bodacc, joafe, inpi, news-buzz, google-trends).
//
// Logique pure : reçoit Pappers data + companyName + ICP client → décide si
// le candidat passe le filter ICP.
//
// Aucune I/O. Testable trivialement.

export interface ClientIcp {
  naf_codes?: string[];
  country_codes?: string[];
  company_size_min?: number;
  company_size_max?: number;
  regions?: string[];
  cities?: string[];
  antiPersonas?: string[];
  /**
   * @deprecated Sprint catalogue (16/05/2026) — utiliser ClientSignalConfig
   * via isSignalEnabled(clientId, signalCode) au lieu de ce champ.
   *
   * Conservé en defense-in-depth pendant la transition (legacy) — sera
   * supprimé quand tous les pollers seront wired sur le helper. Cf.
   * src/lib/signal-config.ts pour le nouveau pattern.
   */
  disabledSources?: string[];
}

export interface PappersDataLite {
  code_naf?: string | null;
  tranche_effectif?: string | null;
  siege?: { region?: string; code_postal?: string; ville?: string } | null;
}

export interface IcpMatchResult {
  ok: boolean;
  reason: string;
}

// Format Pappers tranche_effectif → effectif minimum (INSEE convention)
const TRANCHE_TO_MIN_EFF: Record<string, number> = {
  "00": 0, "01": 1, "02": 3, "03": 6, "11": 10, "12": 20, "21": 50,
  "22": 100, "31": 200, "32": 250, "41": 500, "42": 1000, "51": 2000,
  "52": 5000, "53": 10000,
};

/**
 * Vérifie qu'un candidat (entreprise) match l'ICP du client.
 *
 * Règles appliquées dans l'ordre (échec early-return) :
 *  1. antiPersonas : nom contient un anti-persona → KO
 *  2. naf_codes : si défini, le NAF Pappers doit matcher (préfixe ou exact)
 *  3. company_size_max : si défini et tranche_effectif Pappers > 5×max → KO
 *  4. regions : si défini et siege.region Pappers ne match pas → KO (best-effort)
 *
 * Si Pappers data absente, on accepte (l'absence sera signalée au judge).
 */
export function matchesClientIcp(
  pappersData: PappersDataLite | null,
  companyName: string,
  icp: ClientIcp,
): IcpMatchResult {
  // Règle 1 : anti-personas (sur companyName)
  if (icp.antiPersonas && icp.antiPersonas.length > 0) {
    const nameLower = companyName.toLowerCase();
    for (const anti of icp.antiPersonas) {
      if (anti && nameLower.includes(anti.toLowerCase())) {
        return { ok: false, reason: `antiPersona-match:${anti}` };
      }
    }
  }

  if (!pappersData) {
    return { ok: true, reason: "no-pappers-data" };
  }

  // Règle 2 : NAF whitelist
  if (icp.naf_codes && icp.naf_codes.length > 0 && pappersData.code_naf) {
    const nafNormalized = pappersData.code_naf.replace(/\./g, "");
    let matches = false;
    for (const allowed of icp.naf_codes) {
      const allowedNorm = allowed.replace(/\./g, "");
      if (nafNormalized === allowedNorm || nafNormalized.startsWith(allowedNorm)) {
        matches = true;
        break;
      }
    }
    if (!matches) {
      return { ok: false, reason: `naf-not-allowed:${pappersData.code_naf}` };
    }
  }

  // Règle 3 : effectif (tolérance ×5 du max — au-dessus = vraiment hors ICP)
  if (icp.company_size_max && pappersData.tranche_effectif) {
    const minEff = TRANCHE_TO_MIN_EFF[pappersData.tranche_effectif];
    if (minEff !== undefined && minEff > icp.company_size_max * 5) {
      return {
        ok: false,
        reason: `effectif-too-large:tranche=${pappersData.tranche_effectif}(min~${minEff}p) > 5x${icp.company_size_max}`,
      };
    }
  }

  // Règle 4 : région (best-effort, ignoré si Pappers ne donne pas)
  if (icp.regions && icp.regions.length > 0 && pappersData.siege?.region) {
    const regionLower = pappersData.siege.region.toLowerCase();
    const matches = icp.regions.some((r) =>
      regionLower.includes(r.toLowerCase()),
    );
    if (!matches) {
      return { ok: false, reason: `region-not-allowed:${pappersData.siege.region}` };
    }
  }

  return { ok: true, reason: "match" };
}
