import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-push-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.PROJECTS_ROOT = path.join(tmp, 'projects');
process.env.RELAY_TOKEN = 'test-token-push';

// テスト用 P-256 署名鍵
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const keyPath = path.join(tmp, 'apns-test.p8');
fs.writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }));
process.env.APNS_KEY_P8 = keyPath;
process.env.APNS_KEY_ID = 'TESTKEYID';
process.env.APNS_TEAM_ID = 'TESTTEAM';

const push = await import('../server/push.js');
const { subscribe } = await import('../server/events.js');
const { buildApp } = await import('../server/api.js');

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('push トークン登録', () => {
  it('64桁 hex のみ受け付ける', () => {
    const tok = 'a'.repeat(64);
    assert.equal(push.registerPushToken(tok), 1);
    assert.throws(() => push.registerPushToken('short'), /不正/);
    assert.equal(push.listPushTokens().length, 1);
    assert.equal(push.unregisterPushToken(tok), 0);
  });
});

describe('APNs JWT', () => {
  it('ES256 ヘッダ・iss クレームを持つ', () => {
    const jwt = push.buildApnsJwt(1_700_000_000);
    const [h, p] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'TESTKEYID' });
    assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString()), { iss: 'TESTTEAM', iat: 1_700_000_000 });
  });
});

describe('notifyJob スキップ則 (無通信)', () => {
  const job = { id: 'job_x', threadId: 'th_x', error: null };

  it('トークンなしは送らない', async () => {
    const r = await push.notifyJob(job, 'done', 't');
    assert.deepEqual(r, { sent: 0, skipped: 'no-tokens' });
  });

  it('アプリ表示中 (購読者あり) は送らない', async () => {
    push.registerPushToken('b'.repeat(64));
    const unsub = subscribe({ write() {} });
    try {
      const r = await push.notifyJob(job, 'done', 't');
      assert.deepEqual(r, { sent: 0, skipped: 'app-open' });
    } finally {
      unsub();
      push.unregisterPushToken('b'.repeat(64));
    }
  });
});

describe('push API', () => {
  let base;
  let server;
  before(async () => {
    server = buildApp().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
  });
  const auth = { Authorization: 'Bearer test-token-push', 'Content-Type': 'application/json' };

  it('status は設定状態を返す', async () => {
    const res = await fetch(`${base}/api/push/status`, { headers: auth });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.configured, true);
    assert.equal(typeof body.tokens, 'number');
  });

  it('トークン登録・解除', async () => {
    const tok = 'c'.repeat(64);
    let res = await fetch(`${base}/api/push-tokens`, {
      method: 'POST', headers: auth, body: JSON.stringify({ token: tok }),
    });
    assert.equal(res.status, 200);
    res = await fetch(`${base}/api/push-tokens`, {
      method: 'DELETE', headers: auth, body: JSON.stringify({ token: tok }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).tokens, 0);
  });
});
