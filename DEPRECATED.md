# DEPRECATED — Code en attente de suppression

Ce document liste le code présent dans le repo mais **considéré comme déprécié**. À supprimer en Phase 2 du cleanup Trigger Engine (post-MVP).

## Clay integration (abandonnée avril 2026)

**Contexte** : Clay a été utilisé jusqu'à mars 2026 pour l'enrichment tables et import de data. Abandonné pour :
- Math crédits non tenable pour volume cold email FR (6k crédits / 500€ insuffisant)
- Data pollution observée dans les logs (contamination entre tenants)
- Remplacé par Pappers + Dropcontact + TheirStack dans le stack Trigger Engine FR

### Fichiers dormants (imports gardés pour compatibilité)

| Fichier | Statut | Action future |
|---|---|---|
| `gateway/clay-control.js` | Importé par `cron-manager.js` mais polling désactivé | Supprimer Phase 2 |
| `skills/clay-connector.js` | Disponible pour sync manuel ponctuel | Supprimer Phase 2 |
| Webhook `POST /webhook/clay` dans `telegram-router.js` | Accepte les events, HMAC vérifié, stocké pour audit | Laisser (défensif) ou purger |

### Fichiers archivés (2026-04-22)

Déplacés vers `/backups/old-clay-scripts-2026-04/` :

- `scripts/clay-add-formulas.cjs`
- `scripts/clay-backfill-linkedin-posts.cjs`
- `scripts/clay-duplicate-table.cjs`
- `scripts/clay-fix-all.cjs`
- `scripts/clay-fix-webhook-linkedin.cjs`
- `scripts/clay-linkedin-cron.sh`
- `scripts/clay-optimize-credits.cjs`
- `scripts/clay-retry-linkedin-posts.cjs`
- `scripts/clay-smart-import.cjs`
- `logs/clay-import-2026-04-04.json`

### Variables d'environnement Clay (à retirer Phase 2)

Dans `.env` actuel + `docker-compose.yml` :
- `CLAY_API_KEY` (inactif)
- `CLAY_TABLE_ID` (inactif)
- `CLAY_SESSION_COOKIE` (inactif)
- `CLAY_WEBHOOK_SECRET` (encore utilisé pour HMAC check des webhooks entrants)

**Action Phase 2** : supprimer après 30 jours sans webhook Clay reçu (audit logs).

---

## Anciens clients (jamais déployés en production)

Archivés vers `/backups/old-clients-2026-04/` :

- `clients/digidemat/` (7.7 MB — Google Workspace revendeur Moldavie, jamais déployé)
- `clients/digitestlab/` (84 KB — QA Nearshore ex-vertical, archivé post-pivot Trigger Engine FR)

`clients/docker-compose.clients.yml` reset à `services: {}` en attendant onboarding de vrais clients sur la plateforme Trigger Engine.

---

## Plan de suppression définitive (Phase 2 cleanup, post-MVP Trigger Engine)

Après 30 jours de fonctionnement Trigger Engine en production sans aucun signal Clay entrant :

1. Supprimer `gateway/clay-control.js` + import dans `cron-manager.js`
2. Supprimer `skills/clay-connector.js`
3. Retirer webhook `POST /webhook/clay` de `telegram-router.js`
4. Retirer `CLAY_*` de `.env` + `docker-compose.yml` + `.env.example`
5. Purger `/backups/old-clay-scripts-2026-04/` si rétention >90 jours atteinte

---

## Notes

- Le tag git `pre-clay-integration` existe pour revenir à l'état pre-Clay si besoin
- `feedback_clay_api.md` et `clay-setup-current.md` en mémoire (archivés) documentent le contexte historique
- Le but de ce document est éviter la confusion : voir Clay dans le code ne signifie PAS que c'est utilisé

Dernière mise à jour : 2026-04-22 — par cleanup pré-Trigger Engine FR.
