# Pitch Digidemat — Bombora FR (préparé 18/05/2026, Jour 6)

## Le contexte de Digidemat

- Activité : revendeur **DocuSign + Yousign** auprès des PME et administrations FR
- Cible idéale : cabinets d'avocats, comptables, notaires, PME tertiaires, collectivités
- Pain point sales : trouver les boîtes qui **démarrent un projet signature électronique maintenant** (timing critique)
- Concurrent direct sur la donnée : Pharow (sales intelligence FR, mais sans détection de moment d'achat)

## Ce qu'on a validé techniquement ce soir

### 30 mots-clés ultra-précis créés
Produits leaders : DocuSign, Yousign, Universign, Signaturit, Adobe Sign, Dropbox Sign, Oodrive, Docaposte, Docage, Netheos, PandaDoc, ContractBook, ChamberSign, HelloSign
Concepts juridiques : signature électronique, parapheur électronique, cachet électronique, certificat électronique, horodatage qualifié, eIDAS, service de confiance
Cas d'usage : dématérialisation contrats, contractualisation électronique, plateforme de signature, signature à distance

### Test BOAMP en live
- **Sur 12 derniers mois** : **7 AO trouvés**, **100% pertinents** (UCANSS, AMPA Aquitaine, SIDEC Jura ×2, Lycée Meurthe-Sanon ×2, CC Pays de Valois)
- Sur 90 derniers jours : 1 AO (UCANSS — Sécurité Sociale FR, date limite 15 juin 2026)
- **Volume BOAMP seul** : 0,6 AO/mois → **trop peu pour vendre seul, à compléter par autres sources**

### Mais BOAMP n'est qu'1 source sur 8

Le moteur Bombora FR croisera **8 sources** :
1. **BOAMP** appels d'offres publics (gratuit) → 7 AO/an
2. **LinkedIn Jobs** offres mentionnant DocuSign/Yousign/intégration signature (~30-50/an)
3. **GitHub** commits FR "yousign-integration", "docusign-api" (~20-40/an)
4. **RSS médias FR** articles Maddyness/Frenchweb sur adoption signature (~15-30/an)
5. **BODACC** modifications statuts mentionnant dématérialisation (~10-20/an)
6. **gouv-api SIRENE** changements d'effectif (recrutement DAF/Legal Ops = signal indirect) (~50+/an)
7. **France Marchés privé** appels d'offres B2B (~10-20/an, source à brancher)
8. **Webikeo / EventBrite** webinaires "signature électronique" + listes inscrits (~30-50/an)

**Total cumulé estimé : 170-260 signaux/an = 15-22/mois**

Croisé avec le filtre Surge Score (pic 3× au-dessus de la baseline), on garde les **vrais** = ~5-10 Pépites par mois.

## Le pitch commercial

### Le problème de Digidemat
> "Aujourd'hui vous prospectez à l'aveugle. Vous savez pas qui démarre un projet signature avant qu'ils signent ailleurs. Pharow vous donne 300 boîtes/mois, mais sans intent — donc 1-3 RDV pris."

### Notre proposition
> "On surveille en temps réel les 4 millions de PME et administrations FR sur 30 mots-clés signature électronique. Quand une boîte montre un pic d'activité (AO + recrutement DAF + commit intégration), on vous alerte AVANT vos concurrents. + Brief IA prêt à envoyer en 30 secondes."

### Volume attendu
- 15-22 alertes/mois
- 5-10 Pépites/mois (Surge Score ≥70 + décideur identifié + email vérifié)
- Latence : 2-7 jours (vs 15 jours Pharow)

### Tarification
À définir avec Digidemat lors de la démo. Pas d'engagement public tant
qu'on n'a pas validé le ROI sur 30-60 jours de bêta.

### Garantie qualité (principe à valider)
Pépite = ICP correct + décideur joignable + intent vérifié par IA.
Si <60% des leads livrés respectent ces critères → ajustement à
discuter avec le client (mots-clés, ICP, ou tarif).

## Le pitch en 60 secondes (à dire à l'oral)

> Salut Digidemat. On a construit un radar marché qui détecte les boîtes FR qui démarrent un projet signature électronique AVANT que vos concurrents le voient. Concrètement : on surveille en temps réel 30 mots-clés sur 8 sources publiques (appels d'offres, LinkedIn, GitHub, presse, etc.). Quand une boîte montre un pic anormal d'activité sur le sujet, on vous l'envoie avec le décideur, son email, et un brief prêt à envoyer. T'es disponible cette semaine pour 30 min de démo live ? On parlera du modèle après que tu aies vu ce qu'on trouve.

## Démo concrète à montrer

1. **Ouvrir l'API BOAMP en live** sur l'historique 12 mois
2. **Montrer les 7 AO pertinents** : UCANSS, AMPA, SIDEC Jura, Lycée Meurthe-Sanon, CC Pays de Valois
3. **Pointer le premier qu'il PEUT contacter MAINTENANT** : UCANSS, date limite 15 juin 2026 (29 jours)
4. **Si oui — booker calibration 30 min** : on ajuste les mots-clés à son ICP exact
5. **Si non — savoir pourquoi** (volume ? confiance ? timing ?)

## Objections attendues + réponses

| Objection | Réponse |
|-----------|---------|
| "C'est quoi la différence vs Pharow ?" | Pharow donne du volume de boîtes correspondant à un profil, sans intent. Nous on filtre sur le **moment d'achat** : quand la boîte montre un pic anormal sur le sujet. Volume plus faible, qualité radicalement supérieure. |
| "Volume trop faible" | C'est volontaire. Volume ≠ valeur. On filtre dur pour vous éviter de perdre du temps sur des leads froids. |
| "Comment vous différenciez de Bombora ?" | Bombora US-only, ne fait pas la France. On est natif FR. + on livre un brief IA prêt à envoyer, eux livrent juste un score. |
| "Ça marche vraiment ?" | Bêta de validation à définir ensemble. On démarre sur 30-60 jours pour mesurer le ROI réel sur votre ICP. Engagement minimal. |
| "Combien de clients vous avez ?" | Vous seriez early adopter, premier acteur signature sur le topic. Avantage : on calibre sur votre ICP, vous récupérez ensuite une plateforme parfaitement réglée pour vous. |

## Actions immédiates demain

1. **Appel Digidemat** (15 min) : pitch oral + booker démo 30 min
2. **Préparer démo live** sur leur navigateur : ouvrir BOAMP API live, montrer UCANSS, expliquer le scoring multi-source
3. **Envoyer mail récap après démo** : roadmap calibration mots-clés + cadre de bêta à définir

## Métriques de succès Phase A (mois 1-2)

- 5 appels signature/factrue-elec prospects → 2 démos bookées
- 1-2 bêtas signées (modalités à définir avec eux)
- Validation des 30 mots-clés sur leur ICP réel
- Volume effectif observé sur 60 jours
