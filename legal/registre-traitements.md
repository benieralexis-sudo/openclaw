# Registre des activités de traitement — iFIND

**Article 30 du RGPD (Règlement UE 2016/679)**

**Responsable de traitement :** Alexis Bénier, Auto-entrepreneur, Clermont-Ferrand, France
**Date de création :** 18 mars 2026
**Dernière mise à jour :** 18 mars 2026

---

## Traitement n°1 : Prospection commerciale B2B

| Champ | Détail |
|---|---|
| **Nom du traitement** | Prospection commerciale B2B automatisée |
| **Responsable** | Alexis Bénier (benieralexis@gmail.com) |
| **Finalité** | Identification et contact de prospects professionnels pour le compte de clients d'iFIND |
| **Base légale** | Intérêt légitime (Art. 6.1.f RGPD) — prospection B2B, considérant 47 RGPD |
| **Catégories de personnes** | Professionnels (dirigeants, cadres, responsables) d'entreprises B2B |
| **Catégories de données** | Email professionnel, nom, prénom, entreprise, titre/fonction, secteur d'activité |
| **Source des données** | Bases de données B2B publiques (Clay, LinkedIn public) |
| **Destinataires** | iFIND (Alexis Bénier), client ayant mandaté la campagne (prospects répondants uniquement) |
| **Sous-traitants** | Hostinger (hébergement), Resend (envoi email) |
| **Transferts hors UE** | Resend (USA) — clauses contractuelles types |
| **Durée de conservation** | 90 jours base active, 3 ans archives, liste d'opposition illimitée |
| **Mesures de sécurité** | TLS 1.2+, accès restreint, sauvegardes chiffrées, authentification forte |

### Détail des données collectées

| Donnée | Obligatoire | Sensible | Justification |
|---|---|---|---|
| Email professionnel | Oui | Non | Canal de contact principal |
| Nom | Oui | Non | Personnalisation du message |
| Prénom | Oui | Non | Personnalisation du message |
| Entreprise | Oui | Non | Ciblage et personnalisation |
| Titre / fonction | Non | Non | Pertinence du ciblage |
| Secteur d'activité | Non | Non | Segmentation |

---

## Traitement n°2 : Suivi d'engagement email

| Champ | Détail |
|---|---|
| **Nom du traitement** | Suivi des interactions email (ouvertures, clics, réponses) |
| **Responsable** | Alexis Bénier |
| **Finalité** | Mesure de performance des campagnes, optimisation des messages |
| **Base légale** | Intérêt légitime (Art. 6.1.f RGPD) |
| **Catégories de personnes** | Destinataires des emails de prospection |
| **Catégories de données** | Ouverture (horodatage), clic sur lien (horodatage), contenu de la réponse |
| **Méthode de collecte** | Pixel de suivi (image 1x1), redirection de lien, lecture IMAP |
| **Destinataires** | iFIND uniquement |
| **Durée de conservation** | 90 jours |
| **Mesures de sécurité** | Données agrégées pour reporting, accès restreint |

---

## Traitement n°3 : Gestion des demandes via le site web

| Champ | Détail |
|---|---|
| **Nom du traitement** | Formulaire de contact site ifind.fr |
| **Responsable** | Alexis Bénier |
| **Finalité** | Traitement des demandes commerciales entrantes |
| **Base légale** | Consentement (Art. 6.1.a RGPD) — soumission volontaire du formulaire |
| **Catégories de personnes** | Visiteurs du site ifind.fr |
| **Catégories de données** | Prénom, adresse email, description de la cible de prospection |
| **Source des données** | Saisie directe par la personne concernée |
| **Destinataires** | iFIND uniquement |
| **Durée de conservation** | 3 ans |
| **Mesures de sécurité** | CSRF protection, rate limiting, validation des entrées, honeypot anti-bot |

---

## Traitement n°4 : Gestion de la liste d'opposition

| Champ | Détail |
|---|---|
| **Nom du traitement** | Liste de désabonnement / opposition à la prospection |
| **Responsable** | Alexis Bénier |
| **Finalité** | Garantir le respect du droit d'opposition (Art. 21 RGPD) |
| **Base légale** | Obligation légale (Art. 6.1.c RGPD) |
| **Catégories de personnes** | Personnes ayant exercé leur droit d'opposition |
| **Catégories de données** | Adresse email uniquement |
| **Durée de conservation** | Illimitée (nécessaire pour garantir le non-recontact) |
| **Mesures de sécurité** | Accès restreint, fichier séparé |

---

## Traitement n°5 : Sécurité et logs techniques

| Champ | Détail |
|---|---|
| **Nom du traitement** | Journalisation technique et sécurité |
| **Responsable** | Alexis Bénier |
| **Finalité** | Sécurité du système, détection d'intrusion, débogage |
| **Base légale** | Intérêt légitime (Art. 6.1.f RGPD) |
| **Catégories de données** | Adresse IP (anonymisée), horodatage, user-agent, URL visitée |
| **Durée de conservation** | 12 mois maximum |
| **Mesures de sécurité** | Accès restreint au serveur, rotation des logs |

---

## Sous-traitants (Art. 28 RGPD)

| Sous-traitant | Rôle | Localisation | Garanties |
|---|---|---|---|
| Hostinger International Ltd | Hébergement serveur | Lituanie (UE) | Conforme RGPD, DPA disponible |
| Resend Inc. | Envoi d'emails transactionnels | USA | Clauses contractuelles types (CCT) |
| Google Workspace | Boîtes email d'envoi | UE (stockage) | DPA Google, certifié EU-US DPF |

---

## Mesures de sécurité techniques et organisationnelles

### Techniques
- Chiffrement TLS 1.2+ sur toutes les communications
- Authentification SPF, DKIM et DMARC sur tous les domaines d'envoi
- Protection CSRF sur les formulaires
- Rate limiting sur les API
- Sauvegardes automatiques chiffrées
- Serveur protégé par pare-feu, accès SSH par clé uniquement
- Mises à jour de sécurité régulières

### Organisationnelles
- Accès aux données limité au responsable de traitement
- Pas de partage de mots de passe
- Politique de mots de passe forts
- Revue régulière des accès
- Procédure de notification de violation de données (72h CNIL)

---

## Droits des personnes concernées

| Droit | Article RGPD | Modalité d'exercice | Délai de réponse |
|---|---|---|---|
| Accès | Art. 15 | Email à benieralexis@gmail.com | 30 jours max |
| Rectification | Art. 16 | Email | 30 jours max |
| Effacement | Art. 17 | Email ou lien de désabonnement | 48 heures |
| Opposition | Art. 21 | Email ou lien de désabonnement | 48 heures |
| Limitation | Art. 18 | Email | 30 jours max |
| Portabilité | Art. 20 | Email (export CSV/JSON) | 30 jours max |

---

## Historique des mises à jour

| Date | Modification |
|---|---|
| 18 mars 2026 | Création initiale du registre |
