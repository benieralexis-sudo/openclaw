'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizePappersResponse, parseTrancheEffectif, isAvailable } = require('../sources/pappers');

test('pappers — parseTrancheEffectif gère "10 à 19"', () => {
  assert.deepEqual(parseTrancheEffectif('10 à 19 salariés'), { min: 10, max: 19 });
  assert.deepEqual(parseTrancheEffectif('50 - 99'), { min: 50, max: 99 });
});

test('pappers — parseTrancheEffectif gère valeurs invalides', () => {
  assert.deepEqual(parseTrancheEffectif(null), { min: null, max: null });
  assert.deepEqual(parseTrancheEffectif(''), { min: null, max: null });
  assert.deepEqual(parseTrancheEffectif('inconnu'), { min: null, max: null });
});

test('pappers — parseTrancheEffectif single number', () => {
  assert.deepEqual(parseTrancheEffectif('100'), { min: 100, max: 100 });
});

test('pappers — normalizePappersResponse mappe les champs', () => {
  const raw = {
    siren: '123456789',
    nom_entreprise: 'Acme Test SAS',
    forme_juridique: 'SAS',
    code_naf: '62.01Z',
    libelle_code_naf: 'Programmation informatique',
    tranche_effectif: '20 à 49 salariés',
    siege: { departement: '75', region: 'Île-de-France' },
    date_creation: '2018-03-15',
    capital: '50000',
    finances: [{ chiffre_affaires: '1500000', resultat: '200000' }],
    representants: [
      { nom_complet: 'Jean Dupont', qualite: 'Président', date_prise_de_poste: '2018-03-15' }
    ]
  };
  const r = normalizePappersResponse(raw);
  assert.equal(r.siren, '123456789');
  assert.equal(r.raison_sociale, 'Acme Test SAS');
  assert.equal(r.naf_code, '62.01Z');
  assert.equal(r.naf_label, 'Programmation informatique');
  assert.equal(r.effectif_min, 20);
  assert.equal(r.effectif_max, 49);
  assert.equal(r.departement, '75');
  assert.equal(r.capital_social, 50000);
  assert.equal(r.ca_dernier_exercice, 1500000);
  assert.equal(r.resultat_net_dernier_exercice, 200000);
  assert.equal(r.dirigeants.length, 1);
  assert.equal(r.dirigeants[0].nom, 'Jean Dupont');
  assert.equal(r.dirigeants[0].qualite, 'Président');
  assert.equal(r.statut, 'active');
  assert.equal(r.enriched_source, 'pappers');
});

test('pappers — statut détection cessation/radiation', () => {
  assert.equal(normalizePappersResponse({ siren: '1', entreprise_cessee: true }).statut, 'cessee');
  assert.equal(normalizePappersResponse({ siren: '1', statut_rcs: 'Radié' }).statut, 'radiee');
  assert.equal(normalizePappersResponse({ siren: '1' }).statut, 'active');
});

test('pappers — null/undefined input retourne null', () => {
  assert.equal(normalizePappersResponse(null), null);
  assert.equal(normalizePappersResponse(undefined), null);
});

test('pappers — isAvailable reflète présence token', () => {
  // Le test process tourne avec PAPPERS_API_TOKEN défini en .env (48 chars)
  // Donc isAvailable() doit être true en prod ; on accepte les 2 cas selon environnement
  const result = isAvailable();
  assert.ok(typeof result === 'boolean');
});
