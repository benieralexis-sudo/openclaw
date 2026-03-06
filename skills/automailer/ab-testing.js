// AutoMailer - Module A/B Testing avance (A-C, auto-kill, significativite chi-carre)
const crypto = require('crypto');
const log = require('../../gateway/logger.js');

const MAX_VARIANTS = 3; // A, B, C
const MIN_SENDS_AUTO_KILL = 15; // Minimum envois avant auto-kill (aligne avec chi-square n>=10)
const UNDERPERFORM_THRESHOLD = 0.30; // 30% sous le leader = candidat auto-kill

class ABTesting {
  constructor(storage) {
    this.storage = storage;
  }

  // Assigner un variant a un email (deterministe par email + campagne)
  assignVariant(email, campaignId, numVariants) {
    numVariants = Math.min(Math.max(numVariants || 2, 2), MAX_VARIANTS);
    const hash = crypto.createHash('md5')
      .update((email || '') + ':' + (campaignId || ''))
      .digest();
    const bucket = hash.readUInt32BE(0) % numVariants;
    return String.fromCharCode(65 + bucket); // A, B, C
  }

  // Calculer les stats par variant pour une campagne
  getVariantStats(campaignId, stepNumber) {
    const emails = (this.storage.getEmailsByCampaign ? this.storage.getEmailsByCampaign(campaignId) : [])
      .filter(e => e.abVariant && (!stepNumber || e.stepNumber === stepNumber));

    const stats = {};
    for (const email of emails) {
      const v = email.abVariant;
      if (!stats[v]) stats[v] = { sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, subjects: [] };
      stats[v].sent++;
      if (['delivered', 'opened'].includes(email.status) || email.deliveredAt) stats[v].delivered++;
      if (email.status === 'opened' || email.openedAt) stats[v].opened++;
      if (email.status === 'replied' || email.hasReplied) stats[v].replied++;
      if (email.status === 'bounced') stats[v].bounced++;
      if (email.subject && stats[v].subjects.length < 3 && !stats[v].subjects.includes(email.subject)) {
        stats[v].subjects.push(email.subject);
      }
    }

    // Calculer les taux
    for (const v of Object.keys(stats)) {
      const s = stats[v];
      s.openRate = s.delivered > 0 ? s.opened / s.delivered : 0;
      s.replyRate = s.sent > 0 ? s.replied / s.sent : 0;
      s.bounceRate = s.sent > 0 ? s.bounced / s.sent : 0;
    }

    return stats;
  }

  // Test chi-carre pour 2 variants (significativite p < 0.05)
  chiSquareTest(variantA, variantB, metric) {
    metric = metric || 'open_rate';
    const nA = variantA.sent;
    const nB = variantB.sent;
    if (nA < 10 || nB < 10) return { significant: false, pValue: 1, reason: 'sample_too_small' };

    const successA = metric === 'reply_rate' ? variantA.replied : variantA.opened;
    const successB = metric === 'reply_rate' ? variantB.replied : variantB.opened;
    const failA = nA - successA;
    const failB = nB - successB;

    const total = nA + nB;
    const totalSuccess = successA + successB;
    const totalFail = failA + failB;

    // Valeurs attendues
    const eA_s = (nA * totalSuccess) / total;
    const eA_f = (nA * totalFail) / total;
    const eB_s = (nB * totalSuccess) / total;
    const eB_f = (nB * totalFail) / total;

    if (eA_s < 1 || eA_f < 1 || eB_s < 1 || eB_f < 1) {
      return { significant: false, pValue: 1, reason: 'expected_too_low' };
    }

    const chi2 = Math.pow(successA - eA_s, 2) / eA_s
      + Math.pow(failA - eA_f, 2) / eA_f
      + Math.pow(successB - eB_s, 2) / eB_s
      + Math.pow(failB - eB_f, 2) / eB_f;

    // p-values pour df=1 : chi2 > 3.841 → p < 0.05
    const significant = chi2 > 3.841;
    const pValue = chi2 > 10.83 ? 0.001 : chi2 > 6.635 ? 0.01 : chi2 > 3.841 ? 0.05 : chi2 > 2.706 ? 0.1 : 0.5;

    return { significant, chi2: Math.round(chi2 * 100) / 100, pValue };
  }

  // Determiner les variants a desactiver (sous-performants avec significativite)
  getDisabledVariants(campaignId, metric) {
    metric = metric || 'open_rate';
    const stats = this.getVariantStats(campaignId);
    const variants = Object.keys(stats);
    if (variants.length < 2) return [];

    // Trouver le leader (meilleur taux)
    const leader = variants.reduce((best, v) => {
      const rate = metric === 'reply_rate' ? stats[v].replyRate : stats[v].openRate;
      const bestRate = metric === 'reply_rate' ? stats[best].replyRate : stats[best].openRate;
      return rate > bestRate ? v : best;
    });

    const disabled = [];
    for (const v of variants) {
      if (v === leader) continue;
      if (stats[v].sent < MIN_SENDS_AUTO_KILL) continue;

      const leaderRate = metric === 'reply_rate' ? stats[leader].replyRate : stats[leader].openRate;
      const vRate = metric === 'reply_rate' ? stats[v].replyRate : stats[v].openRate;

      // Desactiver si > UNDERPERFORM_THRESHOLD sous le leader
      if (leaderRate > 0 && (leaderRate - vRate) / leaderRate > UNDERPERFORM_THRESHOLD) {
        const test = this.chiSquareTest(stats[leader], stats[v], metric);
        if (test.significant) {
          disabled.push({
            variant: v,
            rate: Math.round(vRate * 1000) / 10,
            leaderRate: Math.round(leaderRate * 1000) / 10,
            leaderVariant: leader,
            pValue: test.pValue,
            chi2: test.chi2
          });
          log.info('ab-testing', 'Auto-kill candidat: variant ' + v +
            ' (' + Math.round(vRate * 100) + '%) vs leader ' + leader +
            ' (' + Math.round(leaderRate * 100) + '%) — p=' + test.pValue);
        }
      }
    }

    return disabled;
  }

  // Generer un rapport A/B pour une campagne (pour Self-Improve)
  getCampaignReport(campaignId) {
    const stats = this.getVariantStats(campaignId);
    const variants = Object.keys(stats);
    if (variants.length < 2) return null;

    const leader = variants.reduce((best, v) => {
      return stats[v].openRate > stats[best].openRate ? v : best;
    });

    return {
      campaignId,
      variants: stats,
      leader,
      leaderOpenRate: Math.round(stats[leader].openRate * 100),
      totalEmails: variants.reduce((sum, v) => sum + stats[v].sent, 0),
      hasSignificance: variants.some(v => v !== leader && stats[v].sent >= MIN_SENDS_AUTO_KILL)
    };
  }
}

module.exports = ABTesting;
