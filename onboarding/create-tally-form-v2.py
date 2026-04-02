#!/usr/bin/env python3
"""Create the iFIND onboarding questionnaire v2 (top 1%) in Tally via API
Based on research from Belkins, SalesBread, Cleverly, CIENCE, Pearl Lemon"""

import requests
import uuid
import json

API_KEY = "tly-H0KAiCMDDueJGEaCNeFrsB3oVkCljr80"
FORM_ID = "QKYA6Y"
BASE_URL = "https://api.tally.so"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

def uid():
    return str(uuid.uuid4())

blocks = []

def add_input(block_type, label_text, required=True, placeholder=""):
    group = uid()
    blocks.append({"uuid": uid(), "type": "TITLE", "groupUuid": group, "groupType": "QUESTION", "payload": {"html": label_text}})
    blocks.append({"uuid": uid(), "type": block_type, "groupUuid": group, "groupType": block_type, "payload": {"isRequired": required, "placeholder": placeholder}})

def add_checkboxes(label_text, options, required=True):
    group = uid()
    blocks.append({"uuid": uid(), "type": "TITLE", "groupUuid": group, "groupType": "QUESTION", "payload": {"html": label_text}})
    for i, opt in enumerate(options):
        blocks.append({"uuid": uid(), "type": "CHECKBOX", "groupUuid": group, "groupType": "CHECKBOXES", "payload": {"text": opt, "index": i, "isFirst": i == 0, "isLast": i == len(options) - 1}})
    blocks.append({"uuid": uid(), "type": "CHECKBOXES", "groupUuid": group, "groupType": "CHECKBOXES", "payload": {"isRequired": required}})

def add_radio(label_text, options, required=True):
    group = uid()
    blocks.append({"uuid": uid(), "type": "TITLE", "groupUuid": group, "groupType": "QUESTION", "payload": {"html": label_text}})
    for i, opt in enumerate(options):
        blocks.append({"uuid": uid(), "type": "MULTIPLE_CHOICE_OPTION", "groupUuid": group, "groupType": "MULTIPLE_CHOICE", "payload": {"text": opt, "index": i, "isFirst": i == 0, "isLast": i == len(options) - 1}})
    blocks.append({"uuid": uid(), "type": "MULTIPLE_CHOICE", "groupUuid": group, "groupType": "MULTIPLE_CHOICE", "payload": {"isRequired": required}})

def add_page_break(label="Suivant"):
    pb = uid()
    blocks.append({"uuid": pb, "type": "PAGE_BREAK", "groupUuid": pb, "groupType": "PAGE_BREAK", "payload": {"button": {"label": label}}})

def add_heading(html):
    h = uid()
    blocks.append({"uuid": h, "type": "HEADING_2", "groupUuid": h, "groupType": "HEADING_2", "payload": {"html": html}})

def add_text(html):
    t = uid()
    blocks.append({"uuid": t, "type": "TEXT", "groupUuid": t, "groupType": "TEXT", "payload": {"html": html}})

# ================================================================
# FORMULAIRE TOP 1% — 28 questions, 7 sections
# ================================================================

# === COVER PAGE ===
blocks.append({"uuid": uid(), "type": "FORM_TITLE", "groupUuid": uid(), "groupType": "TEXT", "payload": {"html": "Onboarding iFIND — Votre campagne sur mesure"}})
add_text("<p>Vous avez déjà reçu vos <strong>5 premiers emails personnalisés</strong> — maintenant, on va construire votre machine de prospection.</p><p>Ce questionnaire prend <strong>15-20 minutes</strong>. Chaque réponse permet à notre IA de rédiger des emails qui sonnent comme <strong>vous</strong>, pas comme un robot.</p><p><strong>Tout est confidentiel.</strong> Vos données ne sont jamais partagées.</p>")

# === SECTION 1 — VOTRE ENTREPRISE (5 questions) ===
add_page_break()
add_heading("<h2>1. Votre entreprise</h2>")
add_text("<p>Les bases pour configurer votre compte.</p>")

# Q1
add_input("INPUT_TEXT", "Nom de votre entreprise", True, "Ex : TechSolutions SAS")
# Q2
add_input("INPUT_LINK", "Site web", False, "https://www.votresite.fr")
# Q3
add_input("INPUT_TEXT", "Votre nom complet + titre", True, "Ex : Jean Dupont, CEO")
# Q4
add_input("INPUT_EMAIL", "Email professionnel", True, "votre@email.com")
# Q5
add_input("INPUT_TEXT", "Numéro de téléphone", False, "Ex : 06 12 34 56 78")

# === SECTION 2 — VOTRE OFFRE (7 questions) ===
add_page_break()
add_heading("<h2>2. Votre offre</h2>")
add_text("<p>Ces réponses déterminent <strong>le contenu de chaque email</strong> que notre IA va rédiger. Soyez précis.</p>")

# Q6 — CRITIQUE : le hook de chaque email
add_input("INPUT_TEXT", "Quel est le problème #1 que vous résolvez ?", True, "En une phrase. Ex : Les ESN perdent 40% de leur temps à chercher des développeurs freelance")
# Q7 — CRITIQUE
add_input("TEXTAREA", "Décrivez votre offre pour la prospection", True, "Pas tout votre catalogue — juste ce que vous voulez proposer aux prospects contactés. Ex : Audit gratuit de 30 min, démo, essai gratuit...")
# Q8
add_input("TEXTAREA", "Vos 3 arguments différenciants (pourquoi vous plutôt qu'un concurrent ?)", True, "1. ...\n2. ...\n3. ...")
# Q9
add_input("TEXTAREA", "Qui sont vos 2-3 concurrents principaux ?", False, "Noms + en quoi vous êtes différent/meilleur")
# Q10
add_input("INPUT_TEXT", "Fourchette de prix de votre offre", False, "Ex : 5 000-15 000€ par projet, 500€/mois, sur devis...")
# Q11
add_radio("Avez-vous un contenu gratuit à offrir aux prospects ?", ["Oui — un guide, ebook, template, outil", "Oui — un audit, diagnostic ou démo gratuite", "Non, pas encore"], False)
# Q12
add_input("INPUT_LINK", "Si oui, lien vers ce contenu", False, "URL du lead magnet, page de démo, etc.")

# === SECTION 3 — VOTRE CLIENT IDÉAL (8 questions) ===
add_page_break()
add_heading("<h2>3. Votre client idéal</h2>")
add_text("<p>Plus votre cible est précise, plus les emails sont personnalisés et performants.</p>")

# Q13 — CRITIQUE
add_input("TEXTAREA", "Quels postes/fonctions ciblez-vous ?", True, "Ex : CTO, DSI, VP Engineering, Directeur IT, Head of Sales...")
# Q14 — CRITIQUE
add_checkboxes("Quelle taille d'entreprise ?",
    ["1-10 employés", "11-50 employés", "51-200 employés", "201-1000 employés", "1000+ employés"])
# Q15
add_checkboxes("Quelle(s) industrie(s) ciblez-vous ?",
    ["ESN / SSII", "SaaS B2B", "Cabinet de conseil IT", "Éditeur logiciel", "Intégrateur", "Hébergeur / Cloud", "Cybersécurité", "Data / IA", "Autre (précisez ci-dessous)"],
    required=True)
# Q16
add_input("INPUT_TEXT", "Si \"Autre\" industrie, précisez", False, "Ex : Biotech, Fintech, E-commerce...")
# Q17
add_input("INPUT_TEXT", "Quelle zone géographique ?", True, "Ex : France entière, Île-de-France, Europe francophone...")
# Q18 — CRITIQUE : ×2.3 reply rate avec timeline hooks
add_input("TEXTAREA", "Quel événement déclenche le besoin chez vos prospects ?", True, "Ex : Ils recrutent massivement, ils lèvent des fonds, ils changent de CTO, ils migrent vers le cloud, leur outil actuel ne scale plus...")
# Q19 — La question SalesBread
add_input("TEXTAREA", "Si vous pouviez cloner UN client idéal, lequel serait-ce et pourquoi ?", True, "Nom de l'entreprise + ce qui en fait le client parfait. Ex : Société X (150 pers.) — ils avaient exactement ce problème, on a livré en 2 mois, ils nous recommandent à tout le monde")
# Q20
add_input("TEXTAREA", "Entreprises ou domaines à NE PAS contacter", False, "Vos clients actuels, concurrents, partenaires... Collez une liste ou décrivez-les")

# === SECTION 4 — PREUVES & RÉSULTATS (4 questions) ===
add_page_break()
add_heading("<h2>4. Preuves et résultats</h2>")
add_text("<p>Vos résultats clients sont l'ingrédient #1 d'un bon cold email. Un chiffre concret vaut 1000 mots.</p>")

# Q21 — CRITIQUE
add_input("TEXTAREA", "Votre meilleur cas client (avant/après chiffré)", True, "Format : [Entreprise] avait [problème]. On a [solution]. Résultat : [chiffre concret] en [durée].\nEx : Société X perdait 3h/jour sur le recrutement. On a automatisé leur sourcing. Résultat : 60% de temps gagné en 2 mois.")
# Q22
add_input("TEXTAREA", "Copiez-collez 2-3 témoignages ou messages de clients satisfaits (mot pour mot)", False, "Le langage exact de vos clients = le meilleur copywriting. Ex : \"Grâce à eux on a signé 3 contrats en 1 mois\" — Jean D., CTO de X")
# Q23
add_input("TEXTAREA", "Noms/logos de clients que vous pouvez mentionner publiquement", False, "Ex : Société A, Société B, Société C")
# Q24
add_input("INPUT_TEXT", "Combien de clients avez-vous servis au total ?", False, "Ex : 15 clients, 50+, etc.")

# === SECTION 5 — TON & MESSAGING (5 questions) ===
add_page_break()
add_heading("<h2>5. Ton et messaging</h2>")
add_text("<p>Comment vos emails doivent-ils <strong>sonner</strong> ? Cette section est cruciale pour que l'IA capture votre voix.</p>")

# Q25 — CRITIQUE : la question Cleverly
add_input("TEXTAREA", "Imaginez que vous croisez votre prospect idéal dans un bar. Comment vous présentez-vous en 15 secondes ?", True, "Pas de jargon marketing — parlez naturellement. C'est cette voix qu'on va reproduire dans vos emails.")
# Q26
add_radio("Quel ton souhaitez-vous ?",
    ["Tutoiement décontracté (startup, tech)", "Vouvoiement chaleureux (pro mais humain)", "Vouvoiement formel (corporate, grands comptes)", "Provocateur / challenger (ça dépend du prospect)"])
# Q27
add_input("TEXTAREA", "Mots ou expressions à ÉVITER absolument", False, "Ex : \"synergies\", \"solutions innovantes\", ne jamais mentionner le prix, ne pas comparer à [concurrent]...")
# Q28 — Le "aha moment"
add_input("TEXTAREA", "Quelle phrase dit un prospect juste AVANT de signer avec vous ?", False, "Le déclic. Ex : \"En fait c'est exactement ce qu'il nous faut, on perdait trop de temps à faire ça en interne\"")
# Q29
add_radio("Quel est votre CTA préféré (l'action que le prospect doit faire) ?",
    ["Réserver un appel découverte (15-30 min)", "Demander une démo produit", "Recevoir un audit / diagnostic gratuit", "Télécharger une ressource (guide, template)", "Autre"])

# === SECTION 6 — PROCESS COMMERCIAL (4 questions) ===
add_page_break()
add_heading("<h2>6. Votre process commercial</h2>")

# Q30
add_input("INPUT_LINK", "Lien de prise de rendez-vous", False, "Votre lien Calendly, Cal.com, ou équivalent")
# Q31
add_input("INPUT_TEXT", "Qui prend les appels + disponibilités ?", True, "Ex : Jean Dupont, dispo lun-ven 9h-18h")
# Q32
add_radio("Cycle de vente moyen (du premier contact à la signature)",
    ["Moins d'1 mois", "1-3 mois", "3-6 mois", "6+ mois"], required=False)
# Q33
add_input("TEXTAREA", "Top 3 objections que vous entendez + comment vous y répondez", False, "1. Objection : \"C'est trop cher\" → Votre réponse : \"...\"\n2. Objection : \"On a déjà un prestataire\" → Votre réponse : \"...\"\n3. ...")

# === SECTION 7 — HISTORIQUE & LINKEDIN (4 questions) ===
add_page_break()
add_heading("<h2>7. Historique et canaux</h2>")

# Q34
add_radio("Avez-vous déjà fait de la prospection outbound (cold email, LinkedIn, appels) ?",
    ["Oui, avec de bons résultats", "Oui, mais ça n'a pas bien marché", "Non, c'est la première fois"], required=True)
# Q35
add_input("TEXTAREA", "Si oui : qu'est-ce qui a marché / pas marché ?", False, "Tout est utile — canaux testés, volumes, taux de réponse, ce que vous avez appris...")
# Q36 (Plan Multicanal)
add_radio("Avez-vous un profil LinkedIn actif ?",
    ["Oui", "Non"], required=False)
add_text("<p><em>Si oui et que vous êtes en plan Multicanal, nous vous enverrons une invitation sécurisée pour connecter votre compte LinkedIn. Vous entrez vos identifiants vous-même — nous ne les voyons jamais.</em></p>")
# Q37
add_input("INPUT_TEXT", "Combien de rendez-vous qualifiés par mois souhaitez-vous ?", True, "Ex : 5-10, 15-20, le plus possible...")

# === THANK YOU ===
add_heading("<h2>Merci !</h2>")
add_text("<p>Vos réponses sont enregistrées. Notre IA va analyser votre positionnement et préparer votre première campagne sur mesure.</p><p><strong>Prochaine étape :</strong> on se retrouve au <strong>kickoff call de 30 minutes</strong> pour valider ensemble votre stratégie, vos cibles et le ton de vos emails.</p><p>D'ici là, si vous avez des questions : <strong>benieralexis@gmail.com</strong></p><p>À très vite !</p>")

# === SEND ===
payload = {
    "name": "Onboarding iFIND — Votre campagne sur mesure",
    "status": "PUBLISHED",
    "blocks": blocks
}

print(f"Sending {len(blocks)} blocks...")
response = requests.patch(f"{BASE_URL}/forms/{FORM_ID}", headers=HEADERS, json=payload)
print(f"Status: {response.status_code}")
if response.status_code == 200:
    print(f"✅ Formulaire v2 créé et publié !")
    print(f"URL : https://tally.so/r/{FORM_ID}")
else:
    print(f"❌ Error: {response.text[:500]}")
