// Content Gen - Generation de contenu B2B via Claude API
const https = require('https');

class ClaudeContentWriter {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  callClaude(messages, systemPrompt, maxTokens) {
    maxTokens = maxTokens || 2000;
    return new Promise((resolve, reject) => {
      const body = {
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        messages: messages
      };
      if (systemPrompt) body.system = systemPrompt;

      const postData = JSON.stringify(body);
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.content && response.content[0]) {
              resolve(response.content[0].text);
            } else if (response.error) {
              reject(new Error('Claude API: ' + response.error.message));
            } else {
              reject(new Error('Reponse Claude invalide'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout Claude API')); });
      req.write(postData);
      req.end();
    });
  }

  // --- Post LinkedIn ---

  async generateLinkedInPost(topic, tone, context) {
    tone = tone || 'expert';
    const systemPrompt = `Tu es un expert en personal branding LinkedIn. Tu rediges des posts LinkedIn viraux en francais.

Regles :
- Accroche percutante (1 ligne qui donne envie de cliquer "voir plus")
- Corps structure avec des sauts de ligne (pas de gros blocs)
- Utilise des emojis avec parcimonie (1-2 max)
- Termine par un CTA engageant (question, appel a l'action)
- 3-5 hashtags pertinents a la fin
- Ton : ${tone}
- Longueur : 150-250 mots

Retourne UNIQUEMENT le post pret a copier-coller, rien d'autre.`;

    const userMessage = 'Ecris un post LinkedIn sur : ' + topic + (context ? '\nContexte supplementaire : ' + context : '');

    return await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1500
    );
  }

  // --- Pitch commercial ---

  async generatePitch(product, target, context) {
    const systemPrompt = `Tu es un expert en vente B2B. Tu rediges des pitchs commerciaux percutants en francais.

Structure du pitch :
1. ACCROCHE — Question ou stat qui capte l'attention
2. PROBLEME — Le pain point du prospect
3. SOLUTION — Ce que le produit/service resout
4. BENEFICES — 3 benefices concrets et chiffres
5. PREUVE — Social proof ou cas client (invente un exemple realiste)
6. CTA — Appel a l'action clair

Ton : professionnel mais pas robotique. Direct et concis.
Longueur : 200-300 mots.

Retourne UNIQUEMENT le pitch structure, rien d'autre.`;

    const userMessage = 'Ecris un pitch commercial pour : ' + product
      + (target ? '\nCible : ' + target : '')
      + (context ? '\nContexte : ' + context : '');

    return await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      2000
    );
  }

  // --- Description produit ---

  async generateProductDescription(product, context) {
    const systemPrompt = `Tu es un expert en copywriting produit B2B. Tu rediges des descriptions de produits/services en francais.

Retourne 3 sections :

**DESCRIPTION COURTE** (1-2 phrases, pour un site web ou une bio)

**DESCRIPTION LONGUE** (1 paragraphe de 80-120 mots)

**BENEFICES CLES**
- Benefice 1
- Benefice 2
- Benefice 3

Ton : clair, professionnel, oriente benefices (pas features).
Retourne UNIQUEMENT le contenu structure.`;

    const userMessage = 'Decris ce produit/service : ' + product + (context ? '\nContexte : ' + context : '');

    return await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1500
    );
  }

  // --- Script de prospection ---

  async generateProspectionScript(target, product, context) {
    const systemPrompt = `Tu es un expert en prospection telephonique B2B. Tu rediges des scripts d'appel en francais.

Structure du script :

**INTRO** (10 secondes — se presenter, raison de l'appel)

**QUESTIONS DE DECOUVERTE** (3 questions pour comprendre le besoin)

**PITCH** (30 secondes — presenter la solution)

**GESTION DES OBJECTIONS**
- "Je n'ai pas le temps" → ...
- "On a deja une solution" → ...
- "C'est trop cher" → ...

**CLOSE** (Proposer un RDV ou une demo)

Ton : naturel et conversationnel, pas robotique.
Retourne UNIQUEMENT le script structure.`;

    const userMessage = 'Script de prospection pour vendre : ' + (product || target)
      + (target && product ? '\nCible : ' + target : '')
      + (context ? '\nContexte : ' + context : '');

    return await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      2000
    );
  }

  // --- Email marketing ---

  async generateMarketingEmail(subject, context) {
    const systemPrompt = `Tu es un expert en email marketing B2B. Tu rediges des emails marketing performants en francais.

Retourne dans ce format exact :

**OBJET** : [objet accrocheur, max 60 caracteres]

**PREVIEW** : [texte de previsualisation, max 90 caracteres]

**CORPS** :
[email complet avec :
- Accroche personnalisee
- Corps concis (3-4 paragraphes courts)
- CTA clair avec bouton texte entre crochets [Texte du bouton]
- Signature simple]

Ton : professionnel, direct, oriente action.
Longueur corps : 100-180 mots.
Retourne UNIQUEMENT le contenu structure.`;

    const userMessage = 'Email marketing pour : ' + subject + (context ? '\nContexte : ' + context : '');

    return await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1500
    );
  }

  // --- Bio / Tagline ---

  async generateBio(profile, context) {
    const systemPrompt = `Tu es un expert en personal branding. Tu rediges des bios professionnelles en francais.

Retourne 3 versions :

**HEADLINE** (1 ligne percutante pour le titre LinkedIn, max 120 caracteres)

**BIO COURTE** (2-3 phrases pour un profil social)

**TAGLINE** (1 phrase de positionnement, max 15 mots)

Ton : professionnel mais humain, pas de jargon excessif.
Retourne UNIQUEMENT le contenu structure.`;

    const userMessage = 'Bio pour : ' + profile + (context ? '\nContexte : ' + context : '');

    return await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      800
    );
  }

  // --- Reformulation / Ajustement ---

  async refineContent(originalContent, instruction) {
    const systemPrompt = `Tu es un expert en redaction B2B. On te donne un contenu existant et une instruction de modification. Applique la modification et retourne le contenu modifie.

Regles :
- Garde la structure et le format d'origine
- Applique UNIQUEMENT la modification demandee
- Retourne le contenu complet modifie, pret a copier-coller
- Ne commente pas, ne justifie pas — retourne juste le contenu`;

    const userMessage = 'Contenu original :\n\n' + originalContent + '\n\nModification demandee : ' + instruction;

    return await this.callClaude(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      2000
    );
  }
}

module.exports = ClaudeContentWriter;
