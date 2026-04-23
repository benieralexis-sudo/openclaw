// ═══════════════════════════════════════════════════════════════════
// Contact Enricher — identifie dirigeants + emails pour les matches
// ═══════════════════════════════════════════════════════════════════
// Flow:
//   1. Pour chaque match sans contacts, lookupDirigeants(siren) via
//      annuaire-entreprises (gratuit)
//   2. Pour chaque dirigeant physique, génère candidats email
//      (Dropcontact si clé dispo, sinon patterns FR classiques)
//   3. Stocke dans leads_contacts
//
// Idempotent : ne re-query pas les SIRENs déjà en cache <7 jours.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const sirene = require('./sources/sirene');
const dropcontact = require('./sources/dropcontact');
const mxVerify = require('./lib/mx-verify');

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours

/**
 * Devine le domaine probable à partir du nom de l'entreprise.
 * Ex: "AXOMOVE" → "axomove.com" ou "axomove.fr"
 * Best-effort, à valider manuellement par le commercial avant envoi.
 */
function guessDomain(raisonSociale) {
  if (!raisonSociale) return null;
  const slug = raisonSociale.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(sas|sasu|sarl|sa|eurl|sci|snc|selarl)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 30);
  if (!slug || slug.length < 3) return null;
  // On privilégie .com (plus fréquent en tech) mais on retourne aussi .fr en alternative
  return `${slug}.com`;
}

/**
 * Enrichit les matches actifs avec leurs dirigeants + emails candidats.
 * @param {DatabaseSync} db
 * @param {object} [opts] - { log, limit }
 * @returns {{siren_processed, dirigeants_inserted, emails_found}}
 */
async function enrichMatches(db, opts = {}) {
  const log = opts.log || console;
  const limit = opts.limit || 30;

  // Sélectionne les SIRENs avec au moins 1 match actif, sans enrichissement récent
  const candidates = db.prepare(`
    SELECT DISTINCT c.siren, c.raison_sociale, c.naf_code
    FROM companies c
    INNER JOIN patterns_matched pm ON pm.siren = c.siren
      AND (pm.expires_at IS NULL OR pm.expires_at > CURRENT_TIMESTAMP)
    LEFT JOIN (
      SELECT siren, MAX(updated_at) as last_update FROM leads_contacts GROUP BY siren
    ) lc ON lc.siren = c.siren
    WHERE c.siren NOT LIKE 'FT%'
      AND (lc.last_update IS NULL
           OR (julianday('now') - julianday(lc.last_update)) * 86400000 > ${CACHE_TTL_MS})
    ORDER BY (SELECT MAX(score) FROM patterns_matched WHERE siren = c.siren) DESC
    LIMIT ?
  `).all(limit);

  log.info?.(`[contact-enricher] ${candidates.length} SIRENs à enrichir (avec matches actifs, sans cache récent)`);

  const insertContact = db.prepare(`
    INSERT INTO leads_contacts
      (siren, prenom, nom, fonction, annee_naissance, dirigeant_type,
       domain_web, email, email_source, email_confidence, source, discovered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'annuaire-entreprises', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(siren, COALESCE(prenom, ''), COALESCE(nom, '')) DO UPDATE SET
      fonction = excluded.fonction,
      annee_naissance = excluded.annee_naissance,
      domain_web = COALESCE(excluded.domain_web, domain_web),
      email = COALESCE(excluded.email, email),
      email_source = COALESCE(excluded.email_source, email_source),
      email_confidence = COALESCE(excluded.email_confidence, email_confidence),
      updated_at = CURRENT_TIMESTAMP
  `);

  let sirensProcessed = 0;
  let dirigeantsInserted = 0;
  let emailsFound = 0;

  for (const c of candidates) {
    try {
      const result = await sirene.lookupDirigeants(c.siren, { log });
      sirensProcessed += 1;
      if (!result || !result.dirigeants?.length) continue;

      // Domaine : priorité à l'API, sinon fallback deviné (à valider manuellement)
      const domainFromApi = result.domain;
      const domainGuess = domainFromApi || guessDomain(c.raison_sociale);

      // Vérif DNS MX : filtre les domaines devinés sans MX valide (évite bounces)
      let mxOk = null;
      let mxBonus = 0;
      if (domainGuess) {
        try {
          const mx = await mxVerify.verifyDomain(domainGuess, db, { log });
          mxOk = mx.ok;
          if (mx.ok) mxBonus = 0.25;
          if (!mx.ok && !domainFromApi) {
            log.info?.(`[contact-enricher] ${c.siren} ${c.raison_sociale} — ${domainGuess} sans MX (${mx.reason}), emails skippés`);
          }
        } catch (e) {
          log.warn?.(`[contact-enricher] MX check failed for ${domainGuess}: ${e.message}`);
        }
      }

      for (const d of result.dirigeants) {
        // Skip personnes morales (pas de prenom/nom)
        if (d.dirigeant_type === 'personne morale' || !d.nom) continue;

        // Email : Dropcontact (si clé) ou pattern-guess sur domaine
        let email = null, emailSource = null, emailConf = null;
        const skipGuess = !domainFromApi && mxOk === false;
        if (d.prenom && domainGuess && !skipGuess) {
          const emails = await dropcontact.findEmails({
            prenom: d.prenom,
            nom: d.nom,
            domain: domainGuess,
            company: c.raison_sociale
          }, { log });
          if (emails.length > 0) {
            const best = emails[0];
            email = best.email;
            const mxSuffix = mxOk ? '+mx-verified' : '';
            emailSource = best.source + (domainFromApi ? '' : '-guessed-domain') + mxSuffix;
            const baseConf = domainFromApi ? best.confidence : Math.max(0.1, best.confidence * 0.5);
            emailConf = Math.min(0.95, baseConf + mxBonus);
            emailsFound += 1;
          }
        }

        insertContact.run(
          c.siren,
          d.prenom,
          d.nom,
          d.fonction,
          d.annee_naissance,
          d.dirigeant_type,
          domainGuess,
          email,
          emailSource,
          emailConf
        );
        dirigeantsInserted += 1;
      }
    } catch (err) {
      log.warn?.(`[contact-enricher] ${c.siren} (${c.raison_sociale}): ${err.message}`);
    }
  }

  log.info?.(`[contact-enricher] processed ${sirensProcessed} SIRENs, ${dirigeantsInserted} dirigeants, ${emailsFound} emails`);
  return { sirens_processed: sirensProcessed, dirigeants_inserted: dirigeantsInserted, emails_found: emailsFound };
}

module.exports = { enrichMatches };
