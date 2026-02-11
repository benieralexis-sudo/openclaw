const ContentHandler = require('./content-handler.js');

const handler = new ContentHandler(
  process.env.OPENAI_API_KEY,
  process.env.CLAUDE_API_KEY
);

module.exports = {
  name: 'content-gen',
  description: 'Generation de contenu B2B via Claude',
  async onMessage(message, context) {
    const chatId = context.chatId || 'default';
    const sendReply = context.sendReply || null;
    return await handler.handleMessage(message, chatId, sendReply);
  }
};
