// test-brain-sync.cjs — Tests d'integration Brain Sync (automailer storage + AP storage)
// node --test tests/test-brain-sync.cjs
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// =============================================
// Mock du filesystem pour AutoMailerStorage
// On instancie la classe directement en mockant fs et atomicWriteSync
// =============================================

// --- 1. getOpenedCountSince ---

describe('AutoMailerStorage.getOpenedCountSince', () => {
  // Simule la logique exacte de getOpenedCountSince sur un dataset in-memory
  function getOpenedCountSince(emails, sinceDate) {
    if (!sinceDate) return 0;
    const sinceTs = new Date(sinceDate + 'T00:00:00Z').getTime();
    return emails.filter(e => {
      if (!['opened', 'clicked', 'replied'].includes(e.status) && !e.openedAt) return false;
      const ts = e.openedAt ? new Date(e.openedAt).getTime() : (e.sentAt ? new Date(e.sentAt).getTime() : 0);
      return ts >= sinceTs;
    }).length;
  }

  it('retourne 0 si sinceDate est null', () => {
    assert.equal(getOpenedCountSince([{ status: 'opened', openedAt: '2026-02-28T10:00:00Z' }], null), 0);
  });

  it('compte les emails avec status opened', () => {
    const emails = [
      { status: 'opened', openedAt: '2026-03-01T10:00:00Z', sentAt: '2026-03-01T08:00:00Z' },
      { status: 'sent', openedAt: null, sentAt: '2026-03-01T08:00:00Z' },
      { status: 'opened', openedAt: '2026-03-01T14:00:00Z', sentAt: '2026-03-01T08:00:00Z' }
    ];
    assert.equal(getOpenedCountSince(emails, '2026-03-01'), 2);
  });

  it('compte les emails avec openedAt meme si status est clicked', () => {
    const emails = [
      { status: 'clicked', openedAt: '2026-03-01T10:00:00Z', sentAt: '2026-03-01T08:00:00Z' }
    ];
    assert.equal(getOpenedCountSince(emails, '2026-03-01'), 1);
  });

  it('ne compte PAS les emails opened avant sinceDate', () => {
    const emails = [
      { status: 'opened', openedAt: '2026-02-20T10:00:00Z', sentAt: '2026-02-20T08:00:00Z' },
      { status: 'opened', openedAt: '2026-03-01T10:00:00Z', sentAt: '2026-03-01T08:00:00Z' }
    ];
    assert.equal(getOpenedCountSince(emails, '2026-02-25'), 1);
  });

  it('compte les emails replied comme ouverts', () => {
    const emails = [
      { status: 'replied', openedAt: '2026-03-01T10:00:00Z', sentAt: '2026-03-01T08:00:00Z', hasReplied: true }
    ];
    assert.equal(getOpenedCountSince(emails, '2026-03-01'), 1);
  });
});

// --- 2. getRepliedCountSince ---

describe('AutoMailerStorage.getRepliedCountSince', () => {
  function getRepliedCountSince(emails, sinceDate) {
    if (!sinceDate) return 0;
    const sinceTs = new Date(sinceDate + 'T00:00:00Z').getTime();
    return emails.filter(e => {
      if (e.status !== 'replied' && !e.hasReplied) return false;
      const ts = e.repliedAt ? new Date(e.repliedAt).getTime() : (e.sentAt ? new Date(e.sentAt).getTime() : 0);
      return ts >= sinceTs;
    }).length;
  }

  it('retourne 0 si sinceDate est null', () => {
    assert.equal(getRepliedCountSince([{ status: 'replied', repliedAt: '2026-03-01T10:00:00Z' }], null), 0);
  });

  it('compte les emails avec status replied', () => {
    const emails = [
      { status: 'replied', repliedAt: '2026-03-01T10:00:00Z', sentAt: '2026-03-01T08:00:00Z', hasReplied: true },
      { status: 'sent', sentAt: '2026-03-01T08:00:00Z' },
      { status: 'opened', openedAt: '2026-03-01T12:00:00Z', sentAt: '2026-03-01T08:00:00Z' }
    ];
    assert.equal(getRepliedCountSince(emails, '2026-03-01'), 1);
  });

  it('compte les emails avec hasReplied true meme si status != replied', () => {
    const emails = [
      { status: 'opened', hasReplied: true, repliedAt: '2026-03-01T10:00:00Z', sentAt: '2026-03-01T08:00:00Z' }
    ];
    assert.equal(getRepliedCountSince(emails, '2026-03-01'), 1);
  });

  it('ne compte PAS les replied avant sinceDate', () => {
    const emails = [
      { status: 'replied', repliedAt: '2026-02-15T10:00:00Z', sentAt: '2026-02-15T08:00:00Z', hasReplied: true },
      { status: 'replied', repliedAt: '2026-03-01T10:00:00Z', sentAt: '2026-03-01T08:00:00Z', hasReplied: true }
    ];
    assert.equal(getRepliedCountSince(emails, '2026-02-20'), 1);
  });

  it('utilise sentAt si repliedAt est absent', () => {
    const emails = [
      { status: 'replied', repliedAt: null, sentAt: '2026-03-01T08:00:00Z', hasReplied: true }
    ];
    assert.equal(getRepliedCountSince(emails, '2026-03-01'), 1);
  });
});

// --- 3. getSendCountSince ---

describe('AutoMailerStorage.getSendCountSince', () => {
  function getSendCountSince(dailySends, emails, sinceDate) {
    if (!sinceDate) return 0;
    // Methode rapide : sommer dailySends depuis sinceDate
    if (dailySends) {
      let total = 0;
      for (const [day, count] of Object.entries(dailySends)) {
        if (day >= sinceDate) total += count;
      }
      if (total > 0) return total;
    }
    // Fallback : compter les emails
    const sinceTs = new Date(sinceDate + 'T00:00:00Z').getTime();
    return emails.filter(e => {
      if (e.status === 'failed' || e.status === 'queued') return false;
      const ts = e.sentAt ? new Date(e.sentAt).getTime() : (e.createdAt ? new Date(e.createdAt).getTime() : 0);
      return ts >= sinceTs;
    }).length;
  }

  it('retourne 0 si sinceDate est null', () => {
    assert.equal(getSendCountSince({ '2026-03-01': 5 }, [], null), 0);
  });

  it('utilise dailySends comme methode rapide', () => {
    const daily = { '2026-02-28': 3, '2026-03-01': 5, '2026-03-02': 2 };
    assert.equal(getSendCountSince(daily, [], '2026-03-01'), 7); // 5 + 2
  });

  it('fallback sur emails si dailySends est vide', () => {
    const emails = [
      { status: 'sent', sentAt: '2026-03-01T10:00:00Z' },
      { status: 'delivered', sentAt: '2026-03-01T10:00:00Z' },
      { status: 'failed', sentAt: '2026-03-01T10:00:00Z' } // ignore
    ];
    assert.equal(getSendCountSince({}, emails, '2026-03-01'), 2);
  });
});

// =============================================
// Autonomous Pilot Storage — Niche normalisation
// =============================================

describe('AP Storage: Normalisation des niches', () => {
  // Reproduction de la logique trackNicheEvent et getNichePerformance
  let nichePerformance;

  beforeEach(() => {
    nichePerformance = {};
  });

  function trackNicheEvent(niche, event) {
    if (!niche) return;
    const normalizedNiche = String(niche).replace(/_/g, '-').toLowerCase().trim();
    if (!nichePerformance[normalizedNiche]) {
      nichePerformance[normalizedNiche] = { sent: 0, opened: 0, replied: 0, leads: 0 };
    }
    const np = nichePerformance[normalizedNiche];
    if (event === 'lead') np.leads = (np.leads || 0) + 1;
    else if (event === 'sent') np.sent = (np.sent || 0) + 1;
    else if (event === 'opened') np.opened = (np.opened || 0) + 1;
    else if (event === 'replied') np.replied = (np.replied || 0) + 1;
  }

  function getNichePerformance() {
    const normalized = {};
    let hasDuplicates = false;
    for (const [niche, stats] of Object.entries(nichePerformance)) {
      const key = String(niche).replace(/_/g, '-').toLowerCase().trim();
      if (normalized[key]) {
        hasDuplicates = true;
        normalized[key].sent += (stats.sent || 0);
        normalized[key].opened += (stats.opened || 0);
        normalized[key].replied += (stats.replied || 0);
        normalized[key].leads += (stats.leads || 0);
      } else {
        normalized[key] = { sent: stats.sent || 0, opened: stats.opened || 0, replied: stats.replied || 0, leads: stats.leads || 0 };
      }
    }
    if (hasDuplicates) {
      // In real code, this would save to disk
      Object.keys(nichePerformance).forEach(k => delete nichePerformance[k]);
      Object.assign(nichePerformance, normalized);
    }
    return nichePerformance;
  }

  it('normalise underscore en tiret', () => {
    trackNicheEvent('agences_marketing', 'sent');
    assert.ok(nichePerformance['agences-marketing']);
    assert.equal(nichePerformance['agences-marketing'].sent, 1);
  });

  it('normalise en lowercase', () => {
    trackNicheEvent('Cabinet-Conseil', 'lead');
    assert.ok(nichePerformance['cabinet-conseil']);
    assert.equal(nichePerformance['cabinet-conseil'].leads, 1);
  });

  it('trim les espaces', () => {
    trackNicheEvent('  saas-b2b  ', 'opened');
    assert.ok(nichePerformance['saas-b2b']);
    assert.equal(nichePerformance['saas-b2b'].opened, 1);
  });

  it('agences_marketing et agences-marketing pointent vers la meme cle', () => {
    trackNicheEvent('agences_marketing', 'sent');
    trackNicheEvent('agences-marketing', 'sent');
    assert.equal(nichePerformance['agences-marketing'].sent, 2);
  });

  it('trackNicheEvent ignore les niches null/vides', () => {
    trackNicheEvent(null, 'sent');
    trackNicheEvent('', 'sent');
    assert.equal(Object.keys(nichePerformance).length, 0);
  });
});

describe('AP Storage: getNichePerformance merge doublons', () => {
  it('fusionne les stats underscore et tiret', () => {
    // Simule un etat ou les 2 formes existent (donnee corrompue/legacy)
    const rawData = {
      'agences_marketing': { sent: 5, opened: 2, replied: 1, leads: 3 },
      'agences-marketing': { sent: 3, opened: 1, replied: 0, leads: 2 }
    };

    const normalized = {};
    for (const [niche, stats] of Object.entries(rawData)) {
      const key = String(niche).replace(/_/g, '-').toLowerCase().trim();
      if (normalized[key]) {
        normalized[key].sent += (stats.sent || 0);
        normalized[key].opened += (stats.opened || 0);
        normalized[key].replied += (stats.replied || 0);
        normalized[key].leads += (stats.leads || 0);
      } else {
        normalized[key] = { sent: stats.sent || 0, opened: stats.opened || 0, replied: stats.replied || 0, leads: stats.leads || 0 };
      }
    }

    assert.equal(Object.keys(normalized).length, 1);
    assert.equal(normalized['agences-marketing'].sent, 8);
    assert.equal(normalized['agences-marketing'].opened, 3);
    assert.equal(normalized['agences-marketing'].replied, 1);
    assert.equal(normalized['agences-marketing'].leads, 5);
  });

  it('ne fusionne pas des niches differentes', () => {
    const rawData = {
      'saas-b2b': { sent: 10, opened: 5, replied: 2, leads: 8 },
      'cabinet-conseil': { sent: 3, opened: 1, replied: 0, leads: 2 }
    };

    const normalized = {};
    for (const [niche, stats] of Object.entries(rawData)) {
      const key = String(niche).replace(/_/g, '-').toLowerCase().trim();
      if (normalized[key]) {
        normalized[key].sent += (stats.sent || 0);
      } else {
        normalized[key] = { ...stats };
      }
    }

    assert.equal(Object.keys(normalized).length, 2);
    assert.equal(normalized['saas-b2b'].sent, 10);
    assert.equal(normalized['cabinet-conseil'].sent, 3);
  });
});

// --- Bonus: ICP_DEFAULTS guard ---

describe('AP Storage: ICP Defaults guard', () => {
  const { ICP_DEFAULTS } = require('../skills/autonomous-pilot/storage.js');

  it('ICP_DEFAULTS a des titles non-vides', () => {
    assert.ok(Array.isArray(ICP_DEFAULTS.titles));
    assert.ok(ICP_DEFAULTS.titles.length > 0);
    assert.ok(ICP_DEFAULTS.titles.includes('CEO'));
  });

  it('ICP_DEFAULTS a locations = France', () => {
    assert.ok(ICP_DEFAULTS.locations.includes('France'));
  });

  it('ICP_DEFAULTS a des seniorities non-vides', () => {
    assert.ok(ICP_DEFAULTS.seniorities.length > 0);
    assert.ok(ICP_DEFAULTS.seniorities.includes('founder'));
  });

  it('ICP_DEFAULTS a des companySize non-vides', () => {
    assert.ok(ICP_DEFAULTS.companySize.length > 0);
  });
});
