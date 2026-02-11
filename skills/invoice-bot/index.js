const InvoiceBotHandler = require('./invoice-handler.js');

const handler = new InvoiceBotHandler(
  process.env.OPENAI_API_KEY,
  process.env.RESEND_API_KEY,
  process.env.SENDER_EMAIL
);

module.exports = {
  name: 'invoice-bot',
  description: 'Creation et suivi de factures',
  async onMessage(message, context) {
    const chatId = context.chatId || 'default';
    const sendReply = context.sendReply || null;
    return await handler.handleMessage(message, chatId, sendReply);
  }
};
