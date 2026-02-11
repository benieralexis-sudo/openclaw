// Lead Enrich - Classification IA des leads (OpenAI)
const https = require('https');

class AIClassifier {
  constructor(openaiKey) {
    this.openaiKey = openaiKey;
  }

  callOpenAI(messages, maxTokens) {
    maxTokens = maxTokens || 300;
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.3,
        max_tokens: maxTokens
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.openaiKey,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (response.choices && response.choices[0]) {
              resolve(response.choices[0].message.content);
            } else {
              reject(new Error('Reponse OpenAI invalide'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout OpenAI')); });
      req.write(postData);
      req.end();
    });
  }

  async classifyLead(enrichedData) {
    const person = enrichedData.person || {};
    const org = enrichedData.organization || {};

    // Lire les overrides de scoring depuis Self-Improve (si disponible)
    let scoringOverrides = null;
    try {
      const selfImproveStorage = require('../self-improve/storage.js');
      scoringOverrides = selfImproveStorage.getScoringWeights();
    } catch (e) {
      try {
        const selfImproveStorage = require('/app/skills/self-improve/storage.js');
        scoringOverrides = selfImproveStorage.getScoringWeights();
      } catch (e2) {}
    }

    // Construire les poids de scoring (defauts + overrides)
    const sw = scoringOverrides || {};
    const seniorityWeights = Object.keys(sw.seniority || {}).length > 0
      ? 'CEO/Founder=' + (sw.seniority.ceo || 10) + ', VP/Director=' + (sw.seniority.vp || 8) + ', Manager=' + (sw.seniority.manager || 6) + ', IC=' + (sw.seniority.ic || 4) + ', Junior=' + (sw.seniority.junior || 2)
      : 'CEO/Founder=10, VP/Director=8, Manager=6, IC=4, Junior=2';

    const prompt = `Profil a classifier :
- Nom : ${person.fullName || 'Inconnu'}
- Titre : ${person.title || 'Inconnu'}
- Entreprise : ${org.name || 'Inconnu'}
- Industrie : ${org.industry || 'Non precise'}
- Employes : ${org.employeeCount || 'Inconnu'}
- Localisation : ${person.city || ''} ${person.country || ''}
- Site : ${org.website || ''}
- Fondee : ${org.foundedYear || 'Inconnu'}

Classifie ce lead B2B en JSON strict :
{
  "industry": "Secteur (Tech/SaaS, Finance, Sante, Industrie, Services, E-commerce, Education, Autre)",
  "companySize": "Categorie (Startup <10, TPE 10-50, PME 50-250, ETI 250-5000, Grand Groupe 5000+)",
  "persona": "Role (Decision Maker, Influencer, Champion Interne, Utilisateur Final, Autre)",
  "score": 7,
  "scoreExplanation": "Explication courte du score en francais (1 phrase)"
}

Scoring sur 10 :
- Seniority : ${seniorityWeights}
- Taille : PME/ETI ideale=+1, Startup/Grand Groupe=0
- Industrie : Tech/SaaS=+1
- Localisation : France=+0.5, Europe=+0.25

Reponds UNIQUEMENT le JSON, rien d'autre.`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: 'Tu classifies des leads B2B. Reponds uniquement en JSON strict.' },
        { role: 'user', content: prompt }
      ], 300);

      let cleaned = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      if (!result.score || !result.industry) throw new Error('JSON incomplet');
      return result;
    } catch (error) {
      console.log('[ai-classifier] Erreur classification, fallback:', error.message);
      return this._fallbackClassification(enrichedData);
    }
  }

  _fallbackClassification(data) {
    const person = data.person || {};
    const org = data.organization || {};
    const title = (person.title || '').toLowerCase();
    let score = 5;
    let persona = 'Autre';

    if (title.includes('ceo') || title.includes('founder') || title.includes('president') || title.includes('directeur general') || title.includes('co-founder')) {
      score = 9; persona = 'Decision Maker';
    } else if (title.includes('cto') || title.includes('cfo') || title.includes('coo') || title.includes('vp') || title.includes('vice president')) {
      score = 8; persona = 'Decision Maker';
    } else if (title.includes('head') || title.includes('director') || title.includes('directeur') || title.includes('directrice')) {
      score = 7; persona = 'Influencer';
    } else if (title.includes('manager') || title.includes('responsable') || title.includes('lead')) {
      score = 6; persona = 'Champion Interne';
    } else if (title.includes('senior') || title.includes('engineer') || title.includes('consultant')) {
      score = 4; persona = 'Utilisateur Final';
    }

    const empCount = org.employeeCount || 0;
    let companySize = 'Inconnue';
    if (empCount > 0 && empCount < 10) companySize = 'Startup (<10)';
    else if (empCount < 50) companySize = 'TPE (10-50)';
    else if (empCount < 250) companySize = 'PME (50-250)';
    else if (empCount < 5000) companySize = 'ETI (250-5000)';
    else if (empCount >= 5000) companySize = 'Grand Groupe (5000+)';

    // Bonus taille
    if (empCount >= 50 && empCount < 5000) score = Math.min(10, score + 1);

    return {
      industry: org.industry || 'Non determine',
      companySize: companySize,
      persona: persona,
      score: score,
      scoreExplanation: 'Score base sur le titre: ' + (person.title || 'inconnu')
    };
  }
}

module.exports = AIClassifier;
