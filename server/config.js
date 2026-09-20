import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function loadDotEnv() {
  const p = path.resolve('.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadDotEnv();

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const PROJECTS_ROOT = path.resolve(process.env.PROJECTS_ROOT || './projects');
export const PORT = Number(process.env.PORT || 8787);
export const HOST = process.env.HOST || '127.0.0.1';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

function resolveToken() {
  if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN;
  const f = path.join(DATA_DIR, '.token');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const t = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, t + '\n', { mode: 0o600 });
  return t;
}

export const TOKEN = resolveToken();
export const TOKEN_WAS_GENERATED = !process.env.RELAY_TOKEN;
