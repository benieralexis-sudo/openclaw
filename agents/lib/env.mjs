import dotenv from 'dotenv';
import path from 'node:path';

const ROOT_ENV = '/opt/moltbot/.env';
const DASHBOARD_ENV = '/opt/moltbot/dashboard-v2/.env';

dotenv.config({ path: ROOT_ENV });
dotenv.config({ path: DASHBOARD_ENV, override: false });

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const ENV = {
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
  TELEGRAM_BOT_TOKEN: required('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHAT_ID: required('ADMIN_CHAT_ID'),
  DATABASE_URL: required('DATABASE_URL'),
  DRY_RUN: process.env.DOCTOR_DRY_RUN === '1',
};
