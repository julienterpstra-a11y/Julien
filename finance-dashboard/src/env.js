import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimale .env-lader zodat de app geen dependencies nodig heeft.
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const port = Number(process.env.PORT || 3000);

export const config = {
  port,
  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  password: process.env.DASHBOARD_PASSWORD || '',
  enableBanking: {
    appId: process.env.ENABLE_BANKING_APP_ID || '',
    keyPath: path.resolve(ROOT, process.env.ENABLE_BANKING_KEY_PATH || 'data/enablebanking.pem'),
  },
  goCardless: {
    secretId: process.env.GOCARDLESS_SECRET_ID || '',
    secretKey: process.env.GOCARDLESS_SECRET_KEY || '',
  },
};
