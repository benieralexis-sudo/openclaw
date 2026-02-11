const LeadEnrichHandler = require('./enrich-handler.js');

const handler = new LeadEnrichHandler(
  process.env.OPENAI_API_KEY,
  process.env.APOLLO_API_KEY,
  process.env.HUBSPOT_API_KEY
);

module.exports = {
  name: 'lead-enrich',
  description: 'Enrichissement et scoring de leads B2B',
  async onMessage(message, context) {
    const chatId = context.chatId || 'default';
    const sendReply = context.sendReply || null;
    return await handler.handleMessage(message, chatId, sendReply);
  }
};
