#!/usr/bin/env python3
"""Create the iFIND onboarding questionnaire in Tally via API"""

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

# Each block has groupType = its OWN type, blocks in same group share groupUuid

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

def add_page_break():
    pb = uid()
    blocks.append({"uuid": pb, "type": "PAGE_BREAK", "groupUuid": pb, "groupType": "PAGE_BREAK", "payload": {"button": {"label": "Suivant"}}})

def add_heading(html):
    h = uid()
    blocks.append({"uuid": h, "type": "HEADING_2", "groupUuid": h, "groupType": "HEADING_2", "payload": {"html": html}})

def add_text(html):
    t = uid()
    blocks.append({"uuid": t, "type": "TEXT", "groupUuid": t, "groupType": "TEXT", "payload": {"html": html}})

# ========== BUILD FORM ==========

# TITLE PAGE
blocks.append({"uuid": uid(), "type": "FORM_TITLE", "groupUuid": uid(), "groupType": "TEXT", "payload": {"html": "Onboarding iFIND — Votre campagne sur mesure"}})
add_text("<p>Ce questionnaire prend <strong>15-20 minutes</strong>. Vos réponses nous permettent de cibler les bons décideurs et rédiger des emails qui sonnent comme vous. <strong>Tout est confidentiel.</strong></p>")

# SECTION A
add_page_break()
add_heading("<h2>A. Votre entreprise</h2>")
add_input("INPUT_TEXT", "Nom de votre entreprise", True, "Ex : TechSolutions SAS")
add_input("TEXTAREA", "Décrivez votre activité en 2-3 phrases", True, "Comme si vous l'expliquiez à quelqu'un qui ne connaît pas votre secteur")
add_input("TEXTAREA", "Quels sont vos 3-5 arguments différenciants ?", True, "Pourquoi vos clients vous choisissent plutôt qu'un concurrent ?")
add_input("INPUT_TEXT", "Quel est votre service/produit phare ?", True, "Celui qui génère le plus de revenus ou que vous voulez pousser en priorité")

# SECTION B
add_page_break()
add_heading("<h2>B. Votre client idéal</h2>")
add_checkboxes("Quelle(s) industrie(s) ciblez-vous ?",
    ["ESN / SSII", "SaaS B2B", "Cabinet de conseil IT", "Éditeur logiciel", "Intégrateur", "Hébergeur / Cloud", "Cybersécurité", "Data / IA", "Autre"])
add_checkboxes("Quelle taille d'entreprise ?",
    ["1-10 employés", "11-50 employés", "51-200 employés", "201-1000 employés", "1000+ employés"])
add_input("TEXTAREA", "Quels postes ciblez-vous ?", True, "Ex : CTO, DSI, VP Engineering, Head of Sales...")
add_input("INPUT_TEXT", "Quelle zone géographique ?", True, "Ex : France entière, Île-de-France, Europe francophone...")
add_checkboxes("Y a-t-il des signaux d'achat que vous recherchez ?",
    ["Entreprise en croissance (recrutement actif)", "Levée de fonds récente", "Changement de direction", "Nouveau produit/service lancé", "Migration technologique", "Autre"],
    required=False)

# SECTION C
add_page_break()
add_heading("<h2>C. Preuves et résultats</h2>")
add_input("TEXTAREA", "Citez 1-2 clients satisfaits", True, "Ex : Société X (200 pers.) — migration cloud en 3 mois, 40% de réduction des coûts infra")
add_input("TEXTAREA", "Avez-vous des chiffres concrets à partager ?", False, "Taux de satisfaction, NPS, économies réalisées, temps gagné...")

# SECTION D
add_page_break()
add_heading("<h2>D. Votre process commercial</h2>")
add_radio("Quand un prospect est intéressé, quelle est l'étape suivante ?",
    ["Appel découverte", "Démo produit", "Audit gratuit", "Rendez-vous physique", "Autre"])
add_input("INPUT_LINK", "Lien de prise de rendez-vous", False, "Votre lien Calendly, Cal.com ou équivalent")
add_input("INPUT_TEXT", "Qui prend les appels + disponibilités ?", True, "Ex : Jean Dupont, dispo lun-ven 9h-18h")

# SECTION E
add_page_break()
add_heading("<h2>E. Ton et exclusions</h2>")
add_radio("Quel ton souhaitez-vous ?",
    ["Tutoiement décontracté", "Vouvoiement professionnel", "Vouvoiement mais chaleureux"])
add_input("TEXTAREA", "Y a-t-il des choses à ne JAMAIS dire ou faire ?", False, "Ex : ne jamais mentionner le prix, ne pas comparer à [concurrent]...")
add_input("TEXTAREA", "Liste d'exclusion (entreprises à ne pas contacter)", False, "Clients actuels, concurrents, partenaires... Collez une liste ici")

# SECTION F
add_page_break()
add_heading("<h2>F. LinkedIn — Plan Multicanal uniquement</h2>")
add_text("<p><em>Cette section concerne uniquement les clients du plan Multicanal ou Dédié. Si vous êtes en plan Pipeline, envoyez directement vos réponses.</em></p>")
add_radio("Avez-vous un profil LinkedIn actif ?", ["Oui", "Non"], required=False)

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
    print(f"✅ Formulaire créé et publié !")
    print(f"URL : https://tally.so/r/{FORM_ID}")
else:
    print(f"❌ Error: {response.text[:500]}")
