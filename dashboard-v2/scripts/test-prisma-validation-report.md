# Rapport d'investigation : Sémantique Prisma OR dans `some` block

**Date**: 2026-05-06  
**Fichier audité**: `/opt/moltbot/dashboard-v2/src/lib/dynamic-few-shots.ts`  
**Lignes problématiques identifiées**: 87-96 (booster candidates) et 117-120 (booster activities select)

## 1. Contexte

L'audit code a flaggé une ambiguïté sémantique potentielle dans la query Prisma pour `generateDynamicFewShots()` au niveau du filtre `activities.some`:

```typescript
// Ligne 87-96 : Query où-clause du findMany
activities: {
  some: {
    occurredAt: { gte: since },
    source: "MANUAL",
    OR: [
      { type: "MEETING_BOOKED" },
      { type: "DASHBOARD_INTERACTION" },
    ],
  },
},
```

**Question clé**: Prisma AND-il implicitement les conditions top-level (`occurredAt`, `source`) avec le `OR`, ou existe-t-il une amiguïté sémantique ?

## 2. Vérification de la sémantique Prisma officielle

D'après la documentation Prisma, dans un bloc `where` (ou `some`), les conditions au top-level sont **toujours combinées par AND implicite**. Le `OR: [...]` est un operateur logique explicite qui opère sur ses propres conditions internes.

**Comportement attendu** :
```
(occurredAt >= since) AND (source = "MANUAL") AND (type IN ["MEETING_BOOKED", "DASHBOARD_INTERACTION"])
```

Ceci équivaut sémantiquement à la variante proposée par l'audit :
```typescript
AND: [
  { occurredAt: { gte: since } },
  { source: "MANUAL" },
  { OR: [{ type: "MEETING_BOOKED" }, { type: "DASHBOARD_INTERACTION" }] },
]
```

## 3. Test empirique

**Approche**: Créer des leads avec 4 scénarios distincts et comparer les résultats de deux variantes.

### Données de test :
1. **Lead 1**: MEETING_BOOKED + MANUAL → ✅ doit matcher
2. **Lead 2**: DASHBOARD_INTERACTION + MANUAL → ✅ doit matcher
3. **Lead 3**: MEETING_BOOKED + AUTO → ❌ ne doit pas matcher (wrong source)
4. **Lead 4**: NOTE + MANUAL → ❌ ne doit pas matcher (wrong type)

### Résultats empiriques :

**Variant 1 (OR inline — code ACTUEL)**:
```
✅ Variant 1 résultat : 2 leads
   • Test Lead 1 - MEETING_BOOKED + MANUAL
   • Test Lead 2 - DASHBOARD_INTERACTION + MANUAL
```

**Variant 2 (AND explicite — FIX PROPOSÉ)**:
```
✅ Variant 2 résultat : 2 leads
   • Test Lead 1 - MEETING_BOOKED + MANUAL
   • Test Lead 2 - DASHBOARD_INTERACTION + MANUAL
```

**Analyse**: 
- Count identique (2 = 2) ✅
- Mêmes leads retournés ✅
- Exclusions correctes (Lead 3 et Lead 4 filtrés) ✅

## 4. Conclusion

### ✅ PAS DE BUG CONFIRMÉ

La sémantique Prisma est correcte et conforme à la spec. Les conditions top-level du `some` block sont **implicitement AND-ées**, ce qui produit le résultat attendu.

**Code ACTUEL (ligne 87-96) est CORRECT et n'a pas besoin de modification.**

Prisma gère correctement :
1. L'AND implicite entre `occurredAt`, `source`, et le bloc `OR`
2. Le scopage correct du `OR` sur les deux types d'activité
3. L'exclusion des enregistrements ne satisfaisant pas tous les critères

### Documentation pour équipe

Même si le code actuel est correct, la variante avec `AND` explicite est plus lisible et réductible. Pour les futurs mainteneurs, le `AND` explicite améliore la clarté de l'intention du code, notamment dans les contextes ORM complexes.

**Recommandation optionnelle**: Pour maximaliser la maintenabilité et éviter les incompréhensions futures, considérer le refactor vers `AND` explicite. Cependant, ce n'est pas un bug et ne pose pas de risque fonctionnel.

## 5. Cas similaire : "rejected candidates"

Le bloc "rejected" (lignes 166-174) **n'a pas** ce pattern ambigu. Les conditions sont toutes top-level sans `OR`, donc le design est clairement OK:

```typescript
activities: {
  some: {
    type: "DASHBOARD_INTERACTION",
    source: "MANUAL",
    occurredAt: { /* range */ },
  },
},
```

✅ **Pas de problème détecté.**

## 6. Résumé décisionnel

| Aspect | Statut |
|--------|--------|
| Sémantique correcte ? | ✅ OUI |
| Bug fonctionnel ? | ❌ NON |
| Test empirique OK ? | ✅ OUI (2 leads en V1=V2) |
| Besoin fix urgent ? | ❌ NON |
| Recommandation amélioration ? | ⚠️ OPTIONNEL (lisibilité) |
| Cas similaire "rejected" ? | ✅ CLEAN |

**Décision finale**: AUCUNE MODIFICATION REQUISE. Code fonctionne correctement.

