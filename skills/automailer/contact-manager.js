// AutoMailer - Gestionnaire de listes de contacts
const storage = require('./storage');

class ContactManager {
  constructor() {}

  createList(chatId, name) {
    return storage.createContactList(chatId, name);
  }

  getList(listId) {
    return storage.getContactList(listId);
  }

  getLists(chatId) {
    return storage.getContactLists(chatId);
  }

  findListByName(chatId, name) {
    return storage.findContactListByName(chatId, name);
  }

  addContact(listId, contact) {
    return storage.addContactToList(listId, contact);
  }

  removeContact(listId, email) {
    return storage.removeContactFromList(listId, email);
  }

  importFromCSV(csvText, listId) {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) return { imported: 0, errors: [] };

    // Detecter le separateur (, ou ;)
    const sep = lines[0].indexOf(';') >= 0 ? ';' : ',';
    const errors = [];
    let imported = 0;

    // Premiere ligne = headers ou donnees ?
    let startIdx = 0;
    const firstLine = lines[0].toLowerCase();
    if (firstLine.indexOf('email') >= 0 || firstLine.indexOf('mail') >= 0 || firstLine.indexOf('nom') >= 0 || firstLine.indexOf('name') >= 0) {
      startIdx = 1; // C'est un header
    }

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(sep).map(p => p.trim().replace(/^["']|["']$/g, ''));
      const contact = this._parseCSVLine(parts, lines[0], sep);

      if (!contact || !contact.email || !this._isValidEmail(contact.email)) {
        errors.push({ line: i + 1, text: line, reason: 'Email invalide ou manquant' });
        continue;
      }

      const result = storage.addContactToList(listId, contact);
      if (result) imported++;
    }

    return { imported, errors };
  }

  importFromText(text, listId) {
    const lines = text.trim().split('\n');
    const errors = [];
    let imported = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const contact = this._parseTextLine(line);

      if (!contact || !contact.email || !this._isValidEmail(contact.email)) {
        errors.push({ line: i + 1, text: line, reason: 'Email invalide ou manquant' });
        continue;
      }

      const result = storage.addContactToList(listId, contact);
      if (result) imported++;
    }

    return { imported, errors };
  }

  _parseCSVLine(parts, headerLine, sep) {
    // Essayer de mapper les colonnes par headers
    const headers = headerLine.toLowerCase().split(sep).map(h => h.trim().replace(/^["']|["']$/g, ''));
    const emailIdx = headers.findIndex(h => h === 'email' || h === 'mail' || h === 'e-mail');
    const nameIdx = headers.findIndex(h => h === 'nom' || h === 'name' || h === 'nom complet' || h === 'full name');
    const firstIdx = headers.findIndex(h => h === 'prenom' || h === 'firstname' || h === 'first name' || h === 'first_name');
    const lastIdx = headers.findIndex(h => h === 'nom_famille' || h === 'lastname' || h === 'last name' || h === 'last_name');
    const companyIdx = headers.findIndex(h => h === 'entreprise' || h === 'company' || h === 'societe');
    const titleIdx = headers.findIndex(h => h === 'poste' || h === 'title' || h === 'titre' || h === 'job title');

    // Si on a des headers reconnus
    if (emailIdx >= 0) {
      return {
        email: parts[emailIdx] || '',
        name: nameIdx >= 0 ? parts[nameIdx] : '',
        firstName: firstIdx >= 0 ? parts[firstIdx] : '',
        lastName: lastIdx >= 0 ? parts[lastIdx] : '',
        company: companyIdx >= 0 ? parts[companyIdx] : '',
        title: titleIdx >= 0 ? parts[titleIdx] : ''
      };
    }

    // Fallback : deviner par position (nom, email, entreprise, titre)
    if (parts.length >= 2) {
      const emailPart = parts.find(p => this._isValidEmail(p));
      if (emailPart) {
        const others = parts.filter(p => p !== emailPart);
        return {
          email: emailPart,
          name: others[0] || '',
          firstName: '',
          lastName: '',
          company: others[1] || '',
          title: others[2] || ''
        };
      }
    }

    // Dernier recours : prendre le premier qui ressemble a un email
    return { email: parts[0] || '', name: parts[1] || '' };
  }

  _parseTextLine(line) {
    // Format "Nom Prenom <email@domain.com>"
    const angleMatch = line.match(/^(.+?)\s*<([^>]+)>$/);
    if (angleMatch) {
      const name = angleMatch[1].trim();
      const email = angleMatch[2].trim();
      const parts = name.split(' ');
      return {
        email: email,
        name: name,
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || ''
      };
    }

    // Format "email@domain.com"
    if (this._isValidEmail(line)) {
      return { email: line, name: '' };
    }

    // Format "nom, email" ou "email, nom"
    const commaParts = line.split(',').map(p => p.trim());
    if (commaParts.length >= 2) {
      const emailPart = commaParts.find(p => this._isValidEmail(p));
      if (emailPart) {
        const namePart = commaParts.find(p => p !== emailPart) || '';
        return { email: emailPart, name: namePart };
      }
    }

    return null;
  }

  _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}

module.exports = ContactManager;
