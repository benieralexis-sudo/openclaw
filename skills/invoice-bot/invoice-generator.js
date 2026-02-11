// Invoice Bot - Generateur HTML de factures
const storage = require('./storage.js');

class InvoiceGenerator {

  // Genere le HTML complet de la facture pour envoi par email
  generateHTML(invoice, chatId) {
    const user = storage.getUser(chatId);
    const biz = user.businessInfo || {};
    const client = invoice.clientId ? storage.getClient(invoice.clientId) : null;
    const currency = invoice.currency === 'EUR' ? '€' : invoice.currency;

    const itemsRows = (invoice.items || []).map(item => {
      const lineTotal = (item.qty * item.unitPrice).toFixed(2);
      return '<tr>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + this._escapeHtml(item.desc) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">' + item.qty + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">' + item.unitPrice.toFixed(2) + ' ' + currency + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">' + lineTotal + ' ' + currency + '</td>' +
        '</tr>';
    }).join('\n');

    const taxLabel = 'TVA (' + Math.round(invoice.taxRate * 100) + '%)';

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Facture ${invoice.number}</title></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:700px;margin:0 auto;padding:20px;">

  <!-- EN-TETE -->
  <div style="display:flex;justify-content:space-between;margin-bottom:30px;">
    <div>
      <h2 style="margin:0;color:#2c3e50;">${this._escapeHtml(biz.company || user.name || 'Mon Entreprise')}</h2>
      ${biz.address ? '<p style="margin:4px 0;color:#666;">' + this._escapeHtml(biz.address) + '</p>' : ''}
      ${biz.email ? '<p style="margin:4px 0;color:#666;">' + this._escapeHtml(biz.email) + '</p>' : ''}
      ${biz.phone ? '<p style="margin:4px 0;color:#666;">' + this._escapeHtml(biz.phone) + '</p>' : ''}
      ${biz.siret ? '<p style="margin:4px 0;color:#666;">SIRET : ' + this._escapeHtml(biz.siret) + '</p>' : ''}
    </div>
    <div style="text-align:right;">
      <h1 style="margin:0;color:#2c3e50;font-size:28px;">FACTURE</h1>
      <p style="margin:4px 0;font-size:18px;color:#e74c3c;font-weight:bold;">${invoice.number}</p>
      <p style="margin:4px 0;color:#666;">Date : ${new Date(invoice.createdAt).toLocaleDateString('fr-FR')}</p>
      <p style="margin:4px 0;color:#666;">Echeance : ${new Date(invoice.dueDate).toLocaleDateString('fr-FR')}</p>
    </div>
  </div>

  <!-- CLIENT -->
  <div style="background:#f8f9fa;padding:15px;border-radius:8px;margin-bottom:25px;">
    <p style="margin:0 0 5px;color:#888;font-size:12px;text-transform:uppercase;">Facture a</p>
    <p style="margin:0;font-weight:bold;">${this._escapeHtml(client ? (client.company || client.name) : 'Client')}</p>
    ${client && client.name && client.company ? '<p style="margin:2px 0;color:#666;">' + this._escapeHtml(client.name) + '</p>' : ''}
    ${client && client.email ? '<p style="margin:2px 0;color:#666;">' + this._escapeHtml(client.email) + '</p>' : ''}
    ${client && client.address ? '<p style="margin:2px 0;color:#666;">' + this._escapeHtml(client.address) + '</p>' : ''}
  </div>

  <!-- LIGNES -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <thead>
      <tr style="background:#2c3e50;color:white;">
        <th style="padding:10px 12px;text-align:left;">Description</th>
        <th style="padding:10px 12px;text-align:center;">Qte</th>
        <th style="padding:10px 12px;text-align:right;">Prix unitaire</th>
        <th style="padding:10px 12px;text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <!-- TOTAUX -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:25px;">
    <table style="width:250px;">
      <tr>
        <td style="padding:5px 0;color:#666;">Sous-total HT</td>
        <td style="padding:5px 0;text-align:right;">${invoice.subtotal.toFixed(2)} ${currency}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;color:#666;">${taxLabel}</td>
        <td style="padding:5px 0;text-align:right;">${invoice.taxAmount.toFixed(2)} ${currency}</td>
      </tr>
      <tr style="border-top:2px solid #2c3e50;">
        <td style="padding:10px 0;font-weight:bold;font-size:18px;">Total TTC</td>
        <td style="padding:10px 0;text-align:right;font-weight:bold;font-size:18px;color:#e74c3c;">${invoice.total.toFixed(2)} ${currency}</td>
      </tr>
    </table>
  </div>

  <!-- RIB -->
  ${biz.rib ? `
  <div style="background:#fff3cd;padding:15px;border-radius:8px;margin-bottom:20px;border:1px solid #ffc107;">
    <p style="margin:0 0 8px;font-weight:bold;">Coordonnees bancaires (virement)</p>
    <p style="margin:0;font-family:monospace;font-size:14px;">${this._escapeHtml(biz.rib)}</p>
    <p style="margin:8px 0 0;color:#666;font-size:12px;">Merci d'indiquer le numero de facture (${invoice.number}) en reference du virement.</p>
  </div>` : ''}

  <!-- NOTES -->
  ${invoice.notes ? `
  <div style="margin-bottom:20px;">
    <p style="margin:0 0 5px;font-weight:bold;">Notes</p>
    <p style="margin:0;color:#666;">${this._escapeHtml(invoice.notes)}</p>
  </div>` : ''}

  <!-- MENTIONS -->
  <div style="border-top:1px solid #eee;padding-top:15px;color:#999;font-size:11px;">
    <p style="margin:0;">En cas de retard de paiement, une penalite de 3 fois le taux d'interet legal sera appliquee, ainsi qu'une indemnite forfaitaire de 40€ pour frais de recouvrement.</p>
  </div>

</body>
</html>`;
  }

  // Genere un resume texte pour Telegram
  generateSummary(invoice, client) {
    const currency = invoice.currency === 'EUR' ? '€' : invoice.currency;
    const statusEmojis = { draft: '📝', sent: '📧', paid: '✅', overdue: '🔴' };
    const statusLabels = { draft: 'Brouillon', sent: 'Envoyee', paid: 'Payee', overdue: 'Impayee' };

    const lines = [
      '🧾 *FACTURE ' + invoice.number + '*',
      '━━━━━━━━━━━━━━━━━━',
      ''
    ];

    if (client) {
      lines.push('👤 ' + (client.company || client.name));
      if (client.email) lines.push('📧 ' + client.email);
      lines.push('');
    }

    lines.push('📋 *Lignes :*');
    (invoice.items || []).forEach((item, i) => {
      lines.push('  ' + (i + 1) + '. ' + item.desc + ' — ' + item.qty + ' x ' + item.unitPrice.toFixed(2) + currency);
    });

    lines.push('');
    lines.push('💰 Sous-total HT : ' + invoice.subtotal.toFixed(2) + currency);
    lines.push('📊 TVA (' + Math.round(invoice.taxRate * 100) + '%) : ' + invoice.taxAmount.toFixed(2) + currency);
    lines.push('*💵 Total TTC : ' + invoice.total.toFixed(2) + currency + '*');
    lines.push('');
    lines.push((statusEmojis[invoice.status] || '📝') + ' Statut : ' + (statusLabels[invoice.status] || invoice.status));
    lines.push('📅 Echeance : ' + new Date(invoice.dueDate).toLocaleDateString('fr-FR'));

    return lines.join('\n');
  }

  // Genere l'objet email
  generateEmailSubject(invoice) {
    return 'Facture ' + invoice.number + ' — ' + invoice.total.toFixed(2) + '€';
  }

  _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

module.exports = new InvoiceGenerator();
