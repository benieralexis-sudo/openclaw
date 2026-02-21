// Tests — AutoMailer Storage (node:test)
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

// Isoler le storage dans un dossier temp
const tmpDir = path.join(os.tmpdir(), 'ifind-test-automailer-' + Date.now());
process.env.AUTOMAILER_DATA_DIR = tmpDir;

const storage = require('./storage.js');

// --- Utilisateurs ---

describe('utilisateurs', () => {
  it('getUser cree un utilisateur si inexistant', () => {
    const user = storage.getUser('123');
    assert.ok(user);
    assert.equal(user.chatId, '123');
    assert.ok(user.preferences);
    assert.equal(user.preferences.language, 'fr');
  });

  it('getUser retourne le meme utilisateur au 2e appel', () => {
    const u1 = storage.getUser('456');
    u1.name = 'Jojo';
    const u2 = storage.getUser('456');
    assert.equal(u2.name, 'Jojo');
  });

  it('setUserName met a jour le nom', () => {
    storage.setUserName('789', 'Alexis');
    assert.equal(storage.getUser('789').name, 'Alexis');
  });
});

// --- Listes de contacts ---

describe('listes de contacts', () => {
  it('createContactList cree une liste', () => {
    const list = storage.createContactList('123', 'Prospects SaaS');
    assert.match(list.id, /^lst_/);
    assert.equal(list.name, 'Prospects SaaS');
    assert.deepEqual(list.contacts, []);
  });

  it('addContactToList ajoute un contact', () => {
    const list = storage.createContactList('123', 'Add Test');
    const contact = storage.addContactToList(list.id, {
      email: 'lead@example.com',
      name: 'Lead Test',
      company: 'ACME',
    });
    assert.equal(contact.email, 'lead@example.com');
    assert.equal(contact.company, 'ACME');
    assert.equal(list.contacts.length, 1);
  });

  it('addContactToList dedup par email', () => {
    const list = storage.createContactList('123', 'Dedup');
    storage.addContactToList(list.id, { email: 'dup@test.com' });
    storage.addContactToList(list.id, { email: 'dup@test.com' });
    assert.equal(list.contacts.length, 1);
  });

  it('removeContactFromList supprime', () => {
    const list = storage.createContactList('123', 'Remove');
    storage.addContactToList(list.id, { email: 'rm@test.com' });
    assert.equal(storage.removeContactFromList(list.id, 'rm@test.com'), true);
    assert.equal(list.contacts.length, 0);
  });

  it('removeContactFromList retourne false si absent', () => {
    const list = storage.createContactList('123', 'NoRemove');
    assert.equal(storage.removeContactFromList(list.id, 'nope@test.com'), false);
  });

  it('getContactLists filtre par chatId', () => {
    storage.createContactList('100', 'A');
    storage.createContactList('200', 'B');
    storage.createContactList('100', 'C');
    const lists = storage.getContactLists('100');
    assert.ok(lists.length >= 2);
  });

  it('findContactListByName case-insensitive', () => {
    storage.createContactList('300', 'Mes Prospects');
    const found = storage.findContactListByName('300', 'mes prospects');
    assert.ok(found);
    assert.equal(found.name, 'Mes Prospects');
  });
});

// --- Templates ---

describe('templates', () => {
  it('createTemplate detecte les variables {{...}}', () => {
    const tpl = storage.createTemplate('123', 'Intro', 'Bonjour {{firstName}}', 'Re: {{company}}');
    assert.ok(tpl.variables.includes('firstName'));
    assert.ok(tpl.variables.includes('company'));
    assert.match(tpl.id, /^tpl_/);
  });

  it('getTemplates filtre par chatId', () => {
    storage.createTemplate('400', 'T1', 's1', 'b1');
    storage.createTemplate('500', 'T2', 's2', 'b2');
    assert.ok(storage.getTemplates('400').length >= 1);
  });

  it('deleteTemplate retourne true et supprime', () => {
    const tpl = storage.createTemplate('123', 'Del', 's', 'b');
    assert.equal(storage.deleteTemplate(tpl.id), true);
    assert.equal(storage.getTemplate(tpl.id), null);
  });

  it('deleteTemplate retourne false si introuvable', () => {
    assert.equal(storage.deleteTemplate('tpl_fake'), false);
  });
});

// --- Campagnes ---

describe('campagnes', () => {
  it('createCampaign cree en draft', () => {
    const cmp = storage.createCampaign('123', { name: 'Test' });
    assert.match(cmp.id, /^cmp_/);
    assert.equal(cmp.status, 'draft');
  });

  it('updateCampaign modifie les champs', () => {
    const cmp = storage.createCampaign('123', { name: 'Upd' });
    storage.updateCampaign(cmp.id, { status: 'active' });
    assert.equal(storage.getCampaign(cmp.id).status, 'active');
  });

  it('getCampaigns filtre par chatId', () => {
    storage.createCampaign('600', { name: 'C1' });
    storage.createCampaign('700', { name: 'C2' });
    assert.ok(storage.getCampaigns('600').length >= 1);
  });
});

// --- Emails ---

describe('emails', () => {
  it('addEmail cree un enregistrement', () => {
    const email = storage.addEmail({
      chatId: '123', to: 'lead@ex.com', subject: 'Test', status: 'sent', resendId: 'rsd_1',
    });
    assert.match(email.id, /^eml_/);
    assert.equal(email.status, 'sent');
    assert.ok(email.sentAt);
  });

  it('updateEmailStatus change le statut', () => {
    const email = storage.addEmail({ chatId: '123', to: 'a@b.com', subject: 's', status: 'sent' });
    const updated = storage.updateEmailStatus(email.id, 'delivered');
    assert.equal(updated.status, 'delivered');
    assert.ok(updated.deliveredAt);
  });

  it('findEmailByResendId retrouve l\'email', () => {
    storage.addEmail({ chatId: '123', to: 'a@b.com', subject: 's', resendId: 'rsd_find' });
    assert.ok(storage.findEmailByResendId('rsd_find'));
  });

  it('findEmailByTrackingId retrouve l\'email', () => {
    storage.addEmail({ chatId: '123', to: 'a@b.com', subject: 's', trackingId: 'trk_1' });
    assert.ok(storage.findEmailByTrackingId('trk_1'));
  });

  it('getEmailsByCampaign filtre', () => {
    storage.addEmail({ chatId: '123', to: 'a@b.com', subject: 's', campaignId: 'cmp_x' });
    storage.addEmail({ chatId: '123', to: 'b@b.com', subject: 's', campaignId: 'cmp_y' });
    storage.addEmail({ chatId: '123', to: 'c@b.com', subject: 's', campaignId: 'cmp_x' });
    assert.equal(storage.getEmailsByCampaign('cmp_x').length, 2);
  });
});

// --- Blacklist ---

describe('blacklist', () => {
  it('addToBlacklist + isBlacklisted', () => {
    storage.addToBlacklist('spam@test.com', 'hard_bounce');
    assert.equal(storage.isBlacklisted('spam@test.com'), true);
  });

  it('isBlacklisted est case-insensitive', () => {
    storage.addToBlacklist('UPPER@TEST.COM', 'test');
    assert.equal(storage.isBlacklisted('upper@test.com'), true);
  });

  it('getBlacklist retourne les entrees', () => {
    storage.addToBlacklist('bl1@t.com', 'a');
    storage.addToBlacklist('bl2@t.com', 'b');
    assert.ok(storage.getBlacklist().length >= 2);
  });
});

// --- Reply tracking ---

describe('reply tracking', () => {
  it('markAsReplied met hasReplied=true', () => {
    const email = storage.addEmail({ chatId: '123', to: 'rp@t.com', subject: 's', status: 'sent' });
    const updated = storage.markAsReplied(email.id);
    assert.equal(updated.hasReplied, true);
    assert.equal(updated.status, 'replied');
    assert.ok(updated.repliedAt);
  });

  it('getRepliedEmails filtre les reponses', () => {
    const e1 = storage.addEmail({ chatId: '123', to: 'r1@t.com', subject: 's', campaignId: 'cmp_r', status: 'sent' });
    storage.addEmail({ chatId: '123', to: 'r2@t.com', subject: 's', campaignId: 'cmp_r', status: 'sent' });
    storage.markAsReplied(e1.id);
    assert.equal(storage.getRepliedEmails('cmp_r').length, 1);
  });
});

// --- Hot leads ---

describe('hot leads', () => {
  it('detecte un lead hot (3+ opens)', () => {
    for (let i = 0; i < 3; i++) {
      storage.addEmail({ chatId: '123', to: 'hot3@t.com', subject: `E${i}`, status: 'opened' });
    }
    const hot = storage.getHotLeads();
    const found = hot.find(l => l.email === 'hot3@t.com');
    assert.ok(found);
    assert.equal(found.opens, 3);
  });

  it('exclut les bounced', () => {
    storage.addEmail({ chatId: '123', to: 'bounce-hl@t.com', subject: 's', status: 'bounced' });
    const hot = storage.getHotLeads();
    assert.equal(hot.find(l => l.email === 'bounce-hl@t.com'), undefined);
  });

  it('replied est hot', () => {
    const email = storage.addEmail({ chatId: '123', to: 'replied-hl@t.com', subject: 's', status: 'sent' });
    storage.markAsReplied(email.id);
    const hot = storage.getHotLeads();
    assert.ok(hot.find(l => l.email === 'replied-hl@t.com'));
  });
});

// --- A/B Testing ---

describe('A/B testing', () => {
  it('calcule les stats par variante', () => {
    const cid = 'cmp_ab_' + Date.now();
    storage.addEmail({ chatId: '123', to: 'a1@t.com', subject: 's', campaignId: cid, status: 'delivered', abVariant: 'A' });
    storage.addEmail({ chatId: '123', to: 'a2@t.com', subject: 's', campaignId: cid, status: 'opened', abVariant: 'A' });
    storage.addEmail({ chatId: '123', to: 'b1@t.com', subject: 's', campaignId: cid, status: 'opened', abVariant: 'B' });
    storage.addEmail({ chatId: '123', to: 'b2@t.com', subject: 's', campaignId: cid, status: 'opened', abVariant: 'B' });

    const results = storage.getABTestResults(cid);
    assert.equal(results.A.sent, 2);
    assert.equal(results.B.sent, 2);
    assert.equal(results.A.opened, 1);
    assert.equal(results.B.opened, 2);
    assert.equal(results.winner, 'B');
  });
});

// --- Warmup ---

describe('warmup tracking', () => {
  it('getFirstSendDate null initialement', () => {
    assert.equal(storage.getFirstSendDate(), null);
  });

  it('setFirstSendDate idempotent', () => {
    storage.setFirstSendDate();
    const d1 = storage.getFirstSendDate();
    assert.ok(d1);
    storage.setFirstSendDate();
    assert.equal(storage.getFirstSendDate(), d1);
  });

  it('getTodaySendCount commence a 0', () => {
    assert.equal(storage.getTodaySendCount(), 0);
  });

  it('incrementTodaySendCount incremente', () => {
    storage.incrementTodaySendCount();
    storage.incrementTodaySendCount();
    assert.equal(storage.getTodaySendCount(), 2);
  });
});
