# Templates Emails Onboarding — iFIND

> 3 emails post-paiement + 1 email post-kickoff. Ton : tutoiement, chaleureux, direct, pas corporate.
> Philosophie : Speed to Value, puis Popsicle Moment après le kickoff (Hormozi).

---

## Séquence complète

```
Paiement Stripe reçu
  ↓ immédiat
Email 1 — Bienvenue + questionnaire + lien Cal.com
  ↓ +72h (si questionnaire pas rempli)
Email 2 — Reminder questionnaire
  ↓ questionnaire reçu → client booke le kickoff
Kickoff call (30 min)
  ↓ +2-4h après le kickoff
Email 3 — Popsicle Moment (5 emails personnalisés)
  ↓ +7 jours après lancement
Email 4 — Update #1 (domaines chauffent, premiers prospects)
```

---

## Email 1 — Bienvenue + Questionnaire

**Objet :** Bienvenue chez iFIND — on démarre maintenant

**Variables :** `[PRENOM_CLIENT]`, `[NOM_ENTREPRISE]`, `[LIEN_DASHBOARD]`, `[LIEN_QUESTIONNAIRE]`, `[LIEN_CALCOM]`, `[DATE_LIMITE]`

**Corps :**

> [PRENOM_CLIENT],
>
> Merci. Vraiment.
>
> Tu fais maintenant partie des entreprises qui ne laissent plus leur pipeline au hasard. On va construire ensemble une machine de prospection qui tourne pendant que tu te concentres sur ce que tu fais le mieux.
>
> **Voici les 2 choses à faire maintenant :**
>
> **1. Remplis le questionnaire d'onboarding (15 min) :**
> [LIEN_QUESTIONNAIRE]
> Tes réponses permettent à notre IA de rédiger des emails qui sonnent comme toi, pas comme un robot.
>
> **2. Booke ton kickoff call (30 min) :**
> [LIEN_CALCOM]
> On valide ensemble ta cible, ton ton et ta stratégie de lancement.
>
> **Idéalement avant le [DATE_LIMITE]** — plus tu remplis vite, plus on lance vite.
>
> En parallèle, on configure déjà tes domaines d'envoi et on lance le warmup.
>
> Ton dashboard est accessible ici :
> [LIEN_DASHBOARD]
>
> Si tu as la moindre question, réponds directement à cet email — c'est moi qui lis.
>
> Alexis
> Fondateur, iFIND
> benieralexis@gmail.com

**Notes d'envoi :**
- **Timing :** Immédiatement après paiement Stripe
- **Trigger :** Webhook Stripe `checkout.session.completed`
- **Canal :** Email transactionnel
- **`[DATE_LIMITE]`** : Date du paiement + 3 jours

---

## Email 2 — Reminder questionnaire

**Objet :** On attend plus que toi pour lancer

**Variables :** `[PRENOM_CLIENT]`, `[LIEN_QUESTIONNAIRE]`, `[LIEN_CALCOM]`

**Corps :**

> [PRENOM_CLIENT],
>
> Petit point rapide : tout est prêt de notre côté.
>
> Domaines configurés. Warmup lancé. IA calibrée.
>
> Il manque juste tes réponses au questionnaire pour qu'on personnalise tout à fond :
> [LIEN_QUESTIONNAIRE]
>
> Ça prend 15 minutes et ça fait la différence entre une campagne OK et une campagne qui déchire.
>
> Si tu es bloqué sur une question, réponds simplement à cet email — on en discute.
>
> Alexis
>
> PS — N'oublie pas de booker ton kickoff : [LIEN_CALCOM]. 30 min et on lance.

**Notes d'envoi :**
- **Timing :** J+3 après le paiement (matin, 9h)
- **Trigger :** Conditionnel — envoyé uniquement si le questionnaire n'a pas été rempli
- **Canal :** Email transactionnel

---

## Email 3 — Popsicle Moment (après le kickoff)

**Objet :** Tes 5 premiers emails de prospection sont prêts

**Variables :** `[PRENOM_CLIENT]`, `[NOM_ENTREPRISE]`, `[EMAILS]`

**Corps :**

> [PRENOM_CLIENT],
>
> On vient de raccrocher et notre IA s'est déjà mise au travail.
>
> Voici 5 emails de prospection personnalisés pour [NOM_ENTREPRISE], basés sur tout ce qu'on a validé ensemble :
>
> ---
>
> [EMAILS]
>
> ---
>
> C'est le niveau de personnalisation que chaque prospect va recevoir. Pas de template générique — chaque email est rédigé sur mesure.
>
> Si quelque chose te saute aux yeux, réponds à cet email. Sinon, on lance dès que les domaines sont chauds.
>
> Alexis
>
> PS — Le retour qu'on reçoit le plus souvent : "J'aurais jamais écrit ça moi-même, mais c'est exactement le bon ton." C'est ce qu'on vise pour toi.

**Notes d'envoi :**
- **Timing :** 2 à 4h après le kickoff call
- **Trigger :** Manuel — après avoir généré les 5 emails avec les infos du questionnaire + kickoff
- **Canal :** Email transactionnel
- **Prérequis :** Questionnaire rempli + kickoff fait + 5 emails générés par le bot

---

## Email 4 — Update #1

**Objet :** Vos premiers prospects sont identifiés

**Variables :** `[PRENOM_CLIENT]`, `[NB_PROSPECTS]`, `[LIEN_DASHBOARD]`

**Corps :**

> [PRENOM_CLIENT],
>
> Point d'avancement rapide :
>
> - Tes domaines sont en warmup (score en hausse chaque jour)
> - **[NB_PROSPECTS] prospects** ont été identifiés et enrichis pour ta première campagne
> - L'IA a analysé chaque profil et prépare des emails personnalisés
>
> Tu peux suivre tout ça en temps réel sur ton dashboard :
> [LIEN_DASHBOARD]
>
> Lancement prévu dans ~2 semaines (quand les domaines atteignent 90%+ de délivrabilité).
>
> Je te tiens au courant. D'ici là, si tu as des questions → réponds à cet email.
>
> Alexis

**Notes d'envoi :**
- **Timing :** ~J+7 après le kickoff
- **Trigger :** Manuel ou semi-auto (quand les premiers prospects sont enrichis dans Clay)
- **Canal :** Email transactionnel

---

## Variables communes

| Variable | Description | Exemple |
|---|---|---|
| `[PRENOM_CLIENT]` | Prénom du client | Frédéric |
| `[NOM_ENTREPRISE]` | Nom de l'entreprise du client | DigitestLab |
| `[LIEN_DASHBOARD]` | URL du dashboard client | https://srv1319748.hstgr.cloud/client/xxx |
| `[LIEN_QUESTIONNAIRE]` | Lien Tally du formulaire onboarding | https://tally.so/r/QKYA6Y |
| `[LIEN_CALCOM]` | Lien Cal.com pour le kickoff call | https://cal.eu/alexis-benier-sarxqi |
| `[DATE_LIMITE]` | Date paiement + 3 jours | 4 avril 2026 |
| `[NB_PROSPECTS]` | Nombre de prospects enrichis | 50 |
| `[EMAILS]` | 5 emails de prospection personnalisés (générés par l'IA) | Bloc formaté avec les 5 emails |

---

## Séquence résumée

| # | Email | Timing | Trigger | Condition |
|---|---|---|---|---|
| 1 | Bienvenue + Questionnaire | T+0 (paiement) | Webhook Stripe | Toujours |
| 2 | Reminder | T+72h | Délai après E1 | Si questionnaire non rempli |
| 3 | Popsicle Moment | +2-4h après kickoff | Manuel | Après kickoff + questionnaire |
| 4 | Update #1 | ~J+7 après kickoff | Manuel/semi-auto | Quand prospects enrichis |
