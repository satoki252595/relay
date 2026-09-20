import { claude } from './claude.js';
import { codex } from './codex.js';
import { muse } from './muse.js';
import { cursor } from './cursor.js';

export const HARNESSES = { claude, codex, muse, cursor };

export function getHarness(id) {
  return HARNESSES[id] || null;
}

export function listHarnessMeta() {
  return Object.values(HARNESSES).map((h) => ({
    id: h.id,
    label: h.label,
    provider: h.provider,
    binary: h.binary,
  }));
}

export async function allStatuses() {
  const out = [];
  for (const h of Object.values(HARNESSES)) {
    try {
      out.push(await h.status());
    } catch (err) {
      out.push({ id: h.id, installed: false, error: String(err) });
    }
  }
  return out;
}
