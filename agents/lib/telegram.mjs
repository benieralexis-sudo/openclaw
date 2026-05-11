import { ENV } from './env.mjs';

const TELEGRAM_API = `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}`;

export async function sendTelegramMessage(text, options = {}) {
  if (ENV.DRY_RUN) {
    console.log('[DRY_RUN] Telegram message would be sent:\n' + text);
    return { ok: true, dryRun: true };
  }
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: ENV.TELEGRAM_CHAT_ID,
      text,
      parse_mode: options.parseMode ?? 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
  return res.json();
}
