// APNs 完了通知。純正 node (crypto + http2) のみで送信する。
// サーバーはユーザーの自宅内。デバイストークンは data/ 配下に保存し、外部送信は APNs 配送のみ。
import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import { readCollection, writeCollection } from './store.js';
import { subscriberCount } from './events.js';
import {
  APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, APNS_PRODUCTION,
} from './config.js';

export function isPushConfigured() {
  return !!(APNS_KEY_PATH && APNS_KEY_ID && APNS_TEAM_ID && APNS_TOPIC);
}

export function listPushTokens() {
  const rows = readCollection('push-tokens', []);
  return Array.isArray(rows) ? rows : [];
}

export function registerPushToken(token, platform = 'ios') {
  const t = String(token || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(t)) throw new Error('token の形式が不正です');
  const rows = listPushTokens().filter((r) => r.token !== t);
  rows.push({ token: t, platform, updatedAt: Date.now() });
  writeCollection('push-tokens', rows);
  return rows.length;
}

export function unregisterPushToken(token) {
  const rows = listPushTokens().filter((r) => r.token !== String(token || '').trim());
  writeCollection('push-tokens', rows);
  return rows.length;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cachedJwt = null;
let cachedAt = 0;

export function buildApnsJwt(nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID }));
  const payload = b64url(JSON.stringify({ iss: APNS_TEAM_ID, iat: nowSec }));
  const input = `${header}.${payload}`;
  const pem = fs.readFileSync(APNS_KEY_PATH, 'utf8');
  const key = crypto.createPrivateKey(pem);
  const sig = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (!cachedJwt || now - cachedAt > 50 * 60) {
    cachedJwt = buildApnsJwt(now);
    cachedAt = now;
  }
  return cachedJwt;
}

function apnsHost() {
  return APNS_PRODUCTION ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
}

function sendOne(client, token, body) {
  return new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': APNS_TOPIC,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });
    let data = '';
    req.on('response', (headers) => { req.status = headers[':status']; });
    req.on('data', (c) => { data += c.toString(); });
    req.on('end', () => resolve({ status: req.status || 0, body: data.slice(0, 300) }));
    req.on('error', (err) => resolve({ status: -1, body: String(err.message || err).slice(0, 200) }));
    req.setTimeout(15000, () => req.close());
    req.end(JSON.stringify(body));
  });
}

function messageFor(event, job, threadTitle) {
  const name = threadTitle || 'スレッド';
  if (event === 'awaiting_approval') return { title: 'Relay: 承認が必要です', body: `${name} — タップして確認` };
  if (event === 'error') return { title: 'Relay: エラー', body: `${name} — ${String(job.error || '失敗').slice(0, 100)}` };
  return { title: 'Relay: 完了', body: `${name} — 結果を確認できます` };
}

export async function notifyJob(job, event, threadTitle) {
  if (!isPushConfigured()) return { sent: 0, skipped: 'unconfigured' };
  if (subscriberCount() > 0) return { sent: 0, skipped: 'app-open' };
  const tokens = listPushTokens();
  if (!tokens.length) return { sent: 0, skipped: 'no-tokens' };
  const alert = messageFor(event, job, threadTitle);
  const body = {
    aps: { alert, sound: 'default', 'thread-id': job.threadId },
    type: event, threadId: job.threadId, projectId: job.projectId, jobId: job.id,
  };
  try {
    providerToken();
  } catch (err) {
    return { sent: 0, total: tokens.length, error: String(err.message || err).slice(0, 200) };
  }
  const client = http2.connect(apnsHost());
  client.on('error', () => {});
  let sent = 0;
  try {
    for (const t of tokens) {
      // eslint-disable-next-line no-await-in-loop
      const r = await sendOne(client, t.token, body);
      if (r.status === 200) {
        sent += 1;
      } else if (r.status === 410 || /BadDeviceToken|Unregistered/i.test(r.body)) {
        unregisterPushToken(t.token);
      }
    }
  } catch (err) {
    return { sent, total: tokens.length, error: String(err.message || err).slice(0, 200) };
  } finally {
    client.close();
  }
  return { sent, total: tokens.length };
}
