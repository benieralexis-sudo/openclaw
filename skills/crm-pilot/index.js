const CRMPilotHandler = require('./crm-handler.js');

const handler = new CRMPilotHandler(
  process.env.OPENAI_API_KEY,
  process.env.HUBSPOT_API_KEY
);

module.exports = {
  name: 'crm-pilot',
  description: 'Pilotage CRM HubSpot depuis Telegram',
  async onMessage(message, context) {
    const chatId = context.chatId || 'default';
    const sendReply = context.sendReply || null;
    return await handler.handleMessage(message, chatId, sendReply);
  }
};
