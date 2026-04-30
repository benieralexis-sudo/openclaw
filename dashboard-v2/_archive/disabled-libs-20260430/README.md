# Libs archivées 30/04/2026

## Contexte
Audit pipeline 30/04 (sessions matin + soir) → identification de 4 libs et 1 endpoint
qui ne sont plus utilisés en prod mais qui étaient encore dans `src/`. Archivés
ici plutôt que supprimés pour permettre rollback rapide si besoin.

## Contenus

### `dropcontact.ts.disabled` + `enrich-via-dropcontact.ts.disabled`
- **Pourquoi désactivés** : hit rate 1.66% mesuré sur 60 leads ICP DigitestLab.
  Trop faible pour justifier les 35€/mo de l'abonnement Growth.
- **Remplacé par** : FullEnrich Yearly Start 1k ($38.50/mo) — waterfall sur
  20+ providers incluant Dropcontact lui-même + 19 autres = 100% hit rate
  mesuré sur 6 leads bloqués.
- **Compte Dropcontact** : fermé côté abonnement le 30/04/2026.
- **Restauration** : déplacer les fichiers vers `src/lib/` + restaurer les
  appels dans `run-pollers/route.ts` (commentés ligne ~155).

### `enrich-via-email-pattern.ts.disabled` + `email-pattern.ts.disabled`
- **Pourquoi désactivés** : génération d'emails par pattern (`prenom.nom@domaine`)
  sans vérification → bounce >30% → réputation Primeforge détruite.
- **Remplacé par** : FullEnrich (waterfall + triple verification) + future
  intégration MillionVerifier 20€/mo.
- **Restauration** : nécessite MillionVerifier branché en amont
  (`verify → enrich → send`). Pas avant audit deliverability ≥95%.

### `api-enrich-email-pattern/`
- Endpoint qui retournait 410 Gone depuis le 29/04. Archivé pour finir
  proprement (le shim 410 n'avait plus aucune valeur).

## Rollback (si besoin)

```bash
# Pour Dropcontact :
mv _archive/disabled-libs-20260430/dropcontact.ts.disabled src/lib/dropcontact.ts
mv _archive/disabled-libs-20260430/enrich-via-dropcontact.ts.disabled src/lib/enrich-via-dropcontact.ts
# Puis décommenter les appels dans src/app/api/internal/run-pollers/route.ts
# et restaurer l'abonnement Dropcontact.
```
