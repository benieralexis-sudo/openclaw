# Content Gen

description: Generation de contenu B2B via Claude — posts LinkedIn, pitchs, descriptions produits, scripts de prospection, emails marketing, bios.

## Utilisation Telegram

### Types de contenu
- "post LinkedIn sur [sujet]" — post LinkedIn avec accroche, corps, hashtags, CTA
- "pitch pour [produit/service]" — pitch commercial structure
- "decris [produit]" — description produit courte + longue
- "script de prospection pour [cible]" — script d'appel complet
- "email marketing pour [sujet]" — email avec objet, preview, corps, CTA
- "bio LinkedIn pour [profil]" — bio, headline, tagline

### Ajustements
- "plus court" / "plus long" — modifier la longueur
- "plus formel" / "plus decontracte" — modifier le ton
- "reformule : [texte]" — reformuler un texte

### Autres
- "mes contenus" — historique
- "aide contenu" — aide

## Architecture
- `content-handler.js` — Handler NLP Telegram
- `claude-content-writer.js` — Client Claude API
- `storage.js` — Stockage JSON persistant
- `index.js` — Point d'entree

## Variables d'environnement
- `CLAUDE_API_KEY` — Cle API Anthropic
- `OPENAI_API_KEY` — Classification NLP
- `CONTENT_GEN_DATA_DIR` — Repertoire donnees (defaut: /data/content-gen)
