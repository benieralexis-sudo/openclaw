/* ===== PDF Report Generator — Mission Control ===== */

const PDFDocument = require('pdfkit');

function generateWeeklyReport(stats, clientName) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const blue = '#2563EB';
      const dark = '#09090b';
      const gray = '#71717a';
      const green = '#22c55e';
      const orange = '#f59e0b';

      // Header
      doc.rect(0, 0, 595, 80).fill(blue);
      doc.fontSize(22).fillColor('#ffffff').text('Rapport Hebdomadaire', 50, 25, { align: 'left' });
      doc.fontSize(11).fillColor('#ffffffcc').text(clientName || 'iFIND', 50, 52);
      const now = new Date();
      doc.fontSize(10).text('Semaine du ' + now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }), 350, 52, { align: 'right', width: 195 });

      doc.fillColor(dark);
      let y = 110;

      // KPIs Section
      doc.fontSize(14).fillColor(blue).text('Indicateurs cles', 50, y);
      y += 25;

      const kpis = [
        { label: 'Emails envoyes', value: String(stats.sent || 0) },
        { label: 'Taux ouverture', value: (stats.openRate || 0) + '%' },
        { label: 'Taux reponse', value: (stats.replyRate || 0) + '%' },
        { label: 'Reponses recues', value: String(stats.replies || 0) },
        { label: 'Leads chauds', value: String(stats.hotLeads || 0) },
        { label: 'Bounces', value: String(stats.bounced || 0) }
      ];

      const colWidth = 160;
      for (let i = 0; i < kpis.length; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 50 + col * colWidth;
        const ky = y + row * 55;

        doc.roundedRect(x, ky, colWidth - 12, 45, 4).lineWidth(0.5).strokeColor('#e4e4e7').stroke();
        doc.fontSize(18).fillColor(dark).text(kpis[i].value, x + 10, ky + 8, { width: colWidth - 32 });
        doc.fontSize(9).fillColor(gray).text(kpis[i].label, x + 10, ky + 30, { width: colWidth - 32 });
      }
      y += 120;

      // Performance Section
      doc.fontSize(14).fillColor(blue).text('Performance', 50, y);
      y += 25;

      const perfColor = (stats.openRate || 0) >= 30 ? green : (stats.openRate || 0) >= 15 ? orange : '#ef4444';
      doc.fontSize(11).fillColor(dark).text('Taux ouverture: ', 50, y, { continued: true });
      doc.fillColor(perfColor).text((stats.openRate || 0) + '%');
      y += 18;
      doc.fillColor(dark).text('Taux reponse: ', 50, y, { continued: true });
      doc.fillColor((stats.replyRate || 0) >= 3 ? green : orange).text((stats.replyRate || 0) + '%');
      y += 18;
      doc.fillColor(dark).text('Taux bounce: ', 50, y, { continued: true });
      doc.fillColor((stats.bounceRate || 0) <= 3 ? green : '#ef4444').text((stats.bounceRate || 0) + '%');
      y += 30;

      // Hot Leads
      if (stats.hotLeadsList && stats.hotLeadsList.length > 0) {
        doc.fontSize(14).fillColor(blue).text('Leads chauds', 50, y);
        y += 25;

        // Table header
        doc.fontSize(9).fillColor(gray);
        doc.text('Nom', 50, y, { width: 150 });
        doc.text('Entreprise', 200, y, { width: 150 });
        doc.text('Ouvertures', 350, y, { width: 80 });
        doc.text('Score', 430, y, { width: 60 });
        y += 15;
        doc.moveTo(50, y).lineTo(500, y).strokeColor('#e4e4e7').lineWidth(0.5).stroke();
        y += 5;

        doc.fontSize(10).fillColor(dark);
        for (const lead of stats.hotLeadsList.slice(0, 8)) {
          if (y > 720) break;
          doc.text(lead.name || '—', 50, y, { width: 150 });
          doc.text(lead.company || '—', 200, y, { width: 150 });
          doc.text(String(lead.opens || 0), 350, y, { width: 80 });
          doc.fillColor(lead.score >= 7 ? green : orange).text(String(lead.score || '—'), 430, y, { width: 60 });
          doc.fillColor(dark);
          y += 16;
        }
        y += 15;
      }

      // Recommendations
      if (stats.recommendations && stats.recommendations.length > 0) {
        doc.fontSize(14).fillColor(blue).text('Recommandations IA', 50, y);
        y += 25;
        doc.fontSize(10).fillColor(dark);
        for (const rec of stats.recommendations.slice(0, 5)) {
          if (y > 750) break;
          doc.text('• ' + rec, 55, y, { width: 440 });
          y += 16;
        }
        y += 10;
      }

      // Footer
      doc.fontSize(8).fillColor(gray).text(
        'Rapport genere automatiquement par iFIND Mission Control — ' + now.toISOString().slice(0, 10),
        50, 780, { align: 'center', width: 495 }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function generateConversationExport(prospect, messages) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const blue = '#2563EB';
      const gray = '#71717a';

      // Header
      doc.rect(0, 0, 595, 70).fill(blue);
      doc.fontSize(18).fillColor('#ffffff').text('Conversation — ' + (prospect.name || prospect.email), 50, 20);
      doc.fontSize(10).fillColor('#ffffffcc').text((prospect.company || '') + ' · ' + new Date().toLocaleDateString('fr-FR'), 50, 45);

      let y = 90;

      for (const msg of messages) {
        if (y > 720) { doc.addPage(); y = 50; }
        const isSent = msg.type === 'sent' || msg.type === 'auto_reply';
        const label = isSent ? (msg.type === 'auto_reply' ? 'IA' : 'Vous') : (prospect.name || 'Prospect');
        const dateStr = msg.date ? new Date(msg.date).toLocaleString('fr-FR') : '';

        doc.fontSize(9).fillColor(isSent ? blue : '#22c55e').text(label, 50, y, { continued: true });
        doc.fillColor(gray).text('  ' + dateStr);
        y += 14;

        if (msg.subject) {
          doc.fontSize(10).fillColor('#09090b').text('Objet: ' + msg.subject, 50, y, { width: 495 });
          y += 14;
        }

        const body = (msg.body || '').substring(0, 2000);
        doc.fontSize(10).fillColor('#27272a').text(body, 55, y, { width: 485 });
        y = doc.y + 15;

        doc.moveTo(50, y).lineTo(545, y).strokeColor('#e4e4e7').lineWidth(0.3).stroke();
        y += 10;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateWeeklyReport, generateConversationExport };
