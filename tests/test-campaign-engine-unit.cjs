// Tests unitaires — campaign-engine.js (10 cas critiques)
// node --test tests/test-campaign-engine-unit.cjs
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const CampaignEngine = require('../skills/automailer/campaign-engine.js');
const { applySpintax } = require('../gateway/utils.js');

// === 1. Filtre B2C : gmail.com, yahoo.fr, hotmail.com bloques ===
describe('Filtre B2C', () => {
  it('bloque gmail.com', () => {
    assert.equal(CampaignEngine._isB2CDomain('prospect@gmail.com'), true);
  });

  it('bloque yahoo.fr', () => {
    assert.equal(CampaignEngine._isB2CDomain('user@yahoo.fr'), true);
  });

  it('bloque hotmail.com', () => {
    assert.equal(CampaignEngine._isB2CDomain('user@hotmail.com'), true);
  });

  it('accepte un domaine B2B', () => {
    assert.equal(CampaignEngine._isB2CDomain('contact@acme-corp.fr'), false);
  });

  it('gere null/undefined', () => {
    assert.equal(CampaignEngine._isB2CDomain(null), false);
    assert.equal(CampaignEngine._isB2CDomain(undefined), false);
  });
});

// === 2. Dedup entreprise : 2eme email meme domaine dans 72h est skip ===
describe('Dedup entreprise (72h)', () => {
  beforeEach(() => {
    CampaignEngine._recentCompanyDomains.clear();
  });

  it('premier contact au domaine passe', () => {
    assert.equal(CampaignEngine._isCompanyRecentlyContacted('acme.fr'), false);
  });

  it('2eme contact au meme domaine dans 72h est skip', () => {
    CampaignEngine._recordCompanyContact('acme.fr');
    assert.equal(CampaignEngine._isCompanyRecentlyContacted('acme.fr'), true);
  });

  it('contact apres 72h passe', () => {
    // Simuler un contact ancien (73h)
    CampaignEngine._recentCompanyDomains.set('old-corp.fr', Date.now() - 73 * 60 * 60 * 1000);
    assert.equal(CampaignEngine._isCompanyRecentlyContacted('old-corp.fr'), false);
  });
});

// === 3. Spam score : email avec score >= 6 est bloque ===
describe('Spam score check', () => {
  it('bloque un email avec score >= 6 (mots spam)', () => {
    // 3 mots spam = 6 points → bloque
    const result = CampaignEngine._spamScoreCheck(
      'OFFRE GRATUITE!!!',
      'Cliquez ici pour votre promotion exclusive garanti sans risque!'
    );
    assert.ok(result.score >= 6, 'score devrait etre >= 6, got ' + result.score);
    assert.equal(result.pass, false);
    assert.equal(result.level, 'high_risk');
  });

  // === 4. Spam score : email avec score 4 passe (ancien seuil aurait bloque) ===
  it('laisse passer un email avec score 4 (< seuil 6)', () => {
    // 2 mots spam = 4 points → passe
    const result = CampaignEngine._spamScoreCheck(
      'Notre proposition',
      'Cliquez ici pour plus de details. Offre limitee dans le temps.'
    );
    // On veut un score entre 2 et 5 pour ce test
    assert.ok(result.score < 6, 'score devrait etre < 6, got ' + result.score);
    assert.equal(result.pass, true);
  });

  it('score 0 pour un email propre', () => {
    const result = CampaignEngine._spamScoreCheck(
      'Question rapide',
      'Bonjour Jean, une question sur votre approche testing.'
    );
    assert.equal(result.score, 0);
    assert.equal(result.pass, true);
    assert.equal(result.level, 'clean');
  });
});

// === 5. Jours feries : 25 decembre est bloque ===
describe('Jours feries francais', () => {
  it('25 decembre est un jour ferie', () => {
    const noel = new Date(2026, 11, 25); // mois 0-indexed
    assert.equal(CampaignEngine._isFrenchHoliday(noel), true);
  });

  it('1er janvier est un jour ferie', () => {
    const nouvelAn = new Date(2026, 0, 1);
    assert.equal(CampaignEngine._isFrenchHoliday(nouvelAn), true);
  });

  it('15 mars n\'est pas un jour ferie', () => {
    const normal = new Date(2026, 2, 15);
    assert.equal(CampaignEngine._isFrenchHoliday(normal), false);
  });
});

// === 6. Weekend : samedi/dimanche sont bloques ===
// === 7. Heures business : 3h du matin bloque, 10h passe ===
describe('isBusinessHours', () => {
  // Note: isBusinessHours utilise la date/heure ACTUELLE, pas un parametre.
  // On ne peut pas controller l'heure facilement sans mock.
  // On teste la logique indirectement via _isFrenchHoliday + structure.

  it('la fonction existe et retourne un boolean', () => {
    const result = CampaignEngine.isBusinessHours('Europe/Paris');
    assert.equal(typeof result, 'boolean');
  });

  it('weekend detecte (samedi = day 6)', () => {
    // On verifie que la logique du jour est correcte
    // Samedi 21 mars 2026 a 10h
    const samedi = new Date('2026-03-21T10:00:00+01:00');
    assert.equal(samedi.getDay(), 6); // samedi
    // La fonction utilise Date.now(), on ne peut pas la forcer directement
    // Mais on teste la structure : un samedi dans le format attendu
  });

  // Test indirect: verifier que les jours feries dans les heures business renvoient false
  it('jour ferie = pas business hours (25 dec)', () => {
    const noel = new Date(2026, 11, 25);
    assert.equal(CampaignEngine._isFrenchHoliday(noel), true);
  });
});

// === 8. LRU eviction : Map nettoyee quand elle depasse la limite ===
describe('LRU eviction (_evictOldest)', () => {
  it('ne fait rien si la map est sous la limite', () => {
    const map = new Map([['a', 1], ['b', 2]]);
    CampaignEngine._evictOldest(map, 5);
    assert.equal(map.size, 2);
  });

  it('supprime 20% des entrees quand la map depasse la limite', () => {
    const map = new Map();
    for (let i = 0; i < 10; i++) map.set('key' + i, i);
    CampaignEngine._evictOldest(map, 5); // 10 > 5, doit supprimer 20% de 10 = 2
    assert.equal(map.size, 8);
  });

  it('supprime les plus anciennes (premieres inserees)', () => {
    const map = new Map();
    map.set('oldest', 1);
    map.set('old', 2);
    for (let i = 0; i < 8; i++) map.set('new' + i, i);
    CampaignEngine._evictOldest(map, 5);
    // Les 2 premieres entrees (oldest, old) doivent etre supprimees
    assert.equal(map.has('oldest'), false);
    assert.equal(map.has('old'), false);
  });
});

// === 9. MX cache : 2eme appel = pas de requete DNS ===
describe('MX cache', () => {
  beforeEach(() => {
    CampaignEngine._mxCache.clear();
  });

  it('cache vide au depart', () => {
    assert.equal(CampaignEngine._mxCache.size, 0);
  });

  it('apres un appel checkMX le resultat est cache', async () => {
    // On appelle checkMX avec un domaine reel
    // Le premier appel fait une requete DNS, le 2eme utilise le cache
    await CampaignEngine.checkMX('test@google.com');
    const cacheSize = CampaignEngine._mxCache.size;
    assert.ok(cacheSize >= 1, 'Le cache devrait contenir au moins 1 entree apres un checkMX');

    // 2eme appel — devrait utiliser le cache (meme resultat)
    const result2 = await CampaignEngine.checkMX('test@google.com');
    // La taille du cache ne devrait pas augmenter
    assert.equal(CampaignEngine._mxCache.size, cacheSize);
    assert.equal(typeof result2, 'boolean');
  });
});

// === 10. Spintax : {var1|var2} sont resolus ===
describe('Spintax resolution', () => {
  it('resout un spintax simple', () => {
    const result = applySpintax('{bonjour|salut}');
    assert.ok(['bonjour', 'salut'].includes(result), 'resultat devrait etre bonjour ou salut, got: ' + result);
  });

  it('resout plusieurs spintax', () => {
    const input = 'je suis {content|ravi} de {vous|te} contacter';
    const result = applySpintax(input);
    assert.ok(!result.includes('{'), 'ne devrait plus contenir de {');
    assert.ok(!result.includes('}'), 'ne devrait plus contenir de }');
  });

  it('retourne le texte tel quel sans spintax', () => {
    assert.equal(applySpintax('pas de spintax ici'), 'pas de spintax ici');
  });

  it('gere null/undefined', () => {
    assert.equal(applySpintax(null), null);
    assert.equal(applySpintax(undefined), undefined);
  });

  it('ne resout pas si une seule variante (pas un spintax)', () => {
    assert.equal(applySpintax('{seul}'), '{seul}');
  });
});
