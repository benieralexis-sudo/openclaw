# Templates Emails Onboarding — iFIND

> 4 emails automatisés post-paiement. Ton : tutoiement, chaleureux, direct, pas corporate.
> Philosophie : Popsicle Moment, Results in Advance, Speed to Value (Hormozi).

---

## Email 1 — Bienvenue

**Objet :** Bienvenue chez iFIND — on demarre maintenant

**Variables :** `[PRENOM_CLIENT]`, `[NOM_ENTREPRISE]`, `[LIEN_DASHBOARD]`

**Corps :**

> [PRENOM_CLIENT],
>
> Merci. Vraiment.
>
> Tu fais maintenant partie des entreprises qui ne laissent plus leur pipeline au hasard. On va construire ensemble une machine de prospection qui tourne pendant que tu te concentres sur ce que tu fais le mieux.
>
> Voici ce qui se passe dans les prochaines 48h :
>
> 1. **Aujourd'hui** — On configure tes domaines d'envoi et on lance le warmup
> 2. **Dans 2-4h** — Tu recois tes 5 premiers emails de prospection (oui, deja)
> 3. **Demain** — Un court questionnaire pour affiner ta cible
> 4. **Sous 5 jours** — Kickoff call de 30 min, puis lancement
>
> Ton dashboard est deja accessible :
> [LIEN_DASHBOARD]
>
> Si tu as la moindre question, reponds directement a cet email — c'est moi qui lis.
>
> Alexis
> Fondateur, iFIND
> benieralexis@gmail.com

**Notes d'envoi :**
- **Timing :** Immediatement apres paiement Stripe
- **Trigger :** Webhook Stripe `checkout.session.completed`
- **Canal :** Email transactionnel

---

## Email 2 — Popsicle Moment

**Objet :** Tes 5 premiers emails de prospection sont prets

**Variables :** `[PRENOM_CLIENT]`, `[NOM_ENTREPRISE]`, `[EMAILS]`

**Corps :**

> [PRENOM_CLIENT],
>
> On n'a pas attendu.
>
> Pendant que tu lisais l'email de bienvenue, notre IA a analyse [NOM_ENTREPRISE] et redige 5 emails de prospection personnalises. Les voici :
>
> ---
>
> [EMAILS]
>
> ---
>
> Ce sont des premiers jets bases sur ce qu'on sait de ton entreprise. On les affinera ensemble au kickoff — mais tu vois deja le niveau de personnalisation.
>
> Pas mal pour quelques heures, non ?
>
> Si quelque chose te saute aux yeux, reponds a cet email. Sinon, on ajuste tout au kickoff.
>
> Alexis
>
> PS — Le meilleur retour qu'on recoit : "J'aurais jamais ecrit ca moi-meme, mais c'est exactement le bon ton." C'est ce qu'on vise pour toi.

**Notes d'envoi :**
- **Timing :** 2 a 4h apres le paiement
- **Trigger :** Delai programme apres Email 1
- **Canal :** Email transactionnel
- **Prerequis :** Les 5 emails doivent etre generes avant l'envoi (placeholder `[EMAILS]` remplace par le contenu reel)

---

## Email 3 — Questionnaire onboarding

**Objet :** Une derniere etape avant le lancement

**Variables :** `[PRENOM_CLIENT]`, `[LIEN_QUESTIONNAIRE]`, `[LIEN_CALENDLY]`, `[DATE_LIMITE]`

**Corps :**

> [PRENOM_CLIENT],
>
> Tout avance bien de notre cote — domaines en warmup, IA calibree sur ton secteur.
>
> Pour qu'on cible exactement les bonnes personnes, j'ai besoin de 15 minutes de ton temps :
>
> **1. Remplis le questionnaire :**
> [LIEN_QUESTIONNAIRE]
> (ICP, ton de communication, objections frequentes — ca nous permet de tout personnaliser)
>
> **2. Booke ton kickoff call :**
> [LIEN_CALENDLY]
> (30 min — on valide ensemble ta cible, ton ton, et ta strategie de lancement)
>
> Plus tu remplis vite, plus on lance vite. Idealement avant le **[DATE_LIMITE]**.
>
> Alexis

**Notes d'envoi :**
- **Timing :** J+1, 24h apres le paiement (matin, 9h)
- **Trigger :** Delai programme apres Email 1
- **Canal :** Email transactionnel
- **`[DATE_LIMITE]`** : Date du paiement + 3 jours

---

## Email 4 — Reminder questionnaire

**Objet :** On attend plus que toi pour lancer

**Variables :** `[PRENOM_CLIENT]`, `[LIEN_QUESTIONNAIRE]`, `[LIEN_CALENDLY]`

**Corps :**

> [PRENOM_CLIENT],
>
> Petit point rapide : tout est pret de notre cote.
>
> Domaines configures. Warmup lance. IA calibree.
>
> Il manque juste tes reponses au questionnaire pour qu'on personnalise tout a fond :
> [LIEN_QUESTIONNAIRE]
>
> Ca prend 15 minutes et ca fait la difference entre une campagne OK et une campagne qui dechire.
>
> Si tu es bloque sur une question, reponds simplement a cet email — on en discute.
>
> Alexis
>
> PS — N'oublie pas de booker ton kickoff : [LIEN_CALENDLY]. 30 min et on lance.

**Notes d'envoi :**
- **Timing :** J+3 apres le paiement (matin, 9h)
- **Trigger :** Conditionnel — envoye uniquement si le questionnaire n'a pas ete rempli
- **Canal :** Email transactionnel

---

## Variables communes

| Variable | Description | Exemple |
|---|---|---|
| `[PRENOM_CLIENT]` | Prenom du client | Frederic |
| `[NOM_ENTREPRISE]` | Nom de l'entreprise du client | DigitestLab |
| `[LIEN_DASHBOARD]` | URL du dashboard client | https://srv1319748.hstgr.cloud/client/xxx |
| `[LIEN_QUESTIONNAIRE]` | Lien Tally du formulaire onboarding | https://tally.so/r/xxx |
| `[LIEN_CALENDLY]` | Lien Calendly pour le kickoff call | https://calendly.com/alexis-ifind/kickoff |
| `[DATE_LIMITE]` | Date paiement + 3 jours | 4 avril 2026 |
| `[DATE_LANCEMENT_ESTIMEE]` | Date estimee du lancement campagne | 10 avril 2026 |
| `[EMAILS]` | 5 emails de prospection personnalises (generes par l'IA) | Bloc formate avec les 5 emails |

---

## Sequence resumee

| # | Email | Timing | Trigger | Condition |
|---|---|---|---|---|
| 1 | Bienvenue | T+0 | Paiement Stripe | Toujours |
| 2 | Popsicle Moment | T+2-4h | Delai apres E1 | Toujours |
| 3 | Questionnaire | T+24h | Delai apres E1 | Toujours |
| 4 | Reminder | T+72h | Delai apres E1 | Si questionnaire non rempli |
