import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// public/diagnose.js はブラウザ用クラシックスクリプトなので vm で読み込む
const ctx = { AbortController, setTimeout, clearTimeout, URL };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(new URL('../public/diagnose.js', import.meta.url), 'utf8'), ctx);
const { diagnose } = ctx.RelayDiagnose;

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const notJson = (status) => ({ ok: status < 300, status, json: async () => { throw new SyntaxError('html'); } });

// path ごとの応答を返す fetch スタブ
const stub = (routes) => async (url) => {
  const path = new URL(url).pathname;
  const r = routes[path];
  if (!r) throw new TypeError('Load failed');
  return typeof r === 'function' ? r() : r;
};

const failedId = (r) => r.checks.find((c) => !c.ok)?.id;

describe('接続診断', () => {
  it('URL 形式が不正', async () => {
    const r = await diagnose({ base: 'homeserver:8787', token: 't', fetchImpl: stub({}) });
    assert.equal(failedId(r), 'url');
  });

  it('https ページから http サーバーは mixed content として止める', async () => {
    const r = await diagnose({ base: 'http://1.2.3.4:8787', token: 't', pageProtocol: 'https:', fetchImpl: stub({}) });
    assert.equal(failedId(r), 'url');
  });

  it('到達できない', async () => {
    const r = await diagnose({ base: 'http://10.0.0.9:8787', token: 't', fetchImpl: stub({}) });
    assert.equal(failedId(r), 'reach');
    assert.ok(r.hints.length > 0);
  });

  it('応答がなければタイムアウトとして到達不可', async () => {
    const hang = (url, init) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const r = await diagnose({ base: 'http://10.0.0.9:8787', token: 't', fetchImpl: hang, timeoutMs: 30 });
    assert.equal(failedId(r), 'reach');
    assert.match(r.checks.at(-1).detail, /応答がありません/);
  });

  it('Relay 以外のサーバー (404 HTML)', async () => {
    const r = await diagnose({ base: 'http://10.0.0.9:8080', token: 't', fetchImpl: stub({ '/api/health': notJson(404) }) });
    assert.equal(failedId(r), 'relay');
    assert.match(r.checks.at(-1).detail, /HTTP 404/);
  });

  it('トークン不一致', async () => {
    const r = await diagnose({
      base: 'http://10.0.0.9:8787',
      token: 'wrong',
      fetchImpl: stub({ '/api/health': json(200, { ok: true }), '/api/connect': json(401, { error: 'bad token' }) }),
    });
    assert.equal(failedId(r), 'token');
    assert.deepEqual([...r.checks].map((c) => c.ok), [true, true, true, false]);
  });

  it('トークン未入力は connect を呼ばない', async () => {
    let called = false;
    const r = await diagnose({
      base: 'http://10.0.0.9:8787',
      token: '',
      fetchImpl: stub({ '/api/health': json(200, { ok: true }), '/api/connect': () => { called = true; return json(200, {}); } }),
    });
    assert.equal(failedId(r), 'token');
    assert.equal(called, false);
  });

  it('全段通過 (末尾スラッシュ付き URL も可)', async () => {
    const r = await diagnose({
      base: 'https://home.example.ts.net/',
      token: 'ok',
      fetchImpl: stub({ '/api/health': json(200, { ok: true }), '/api/connect': json(200, { ok: true }) }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.checks.length, 4);
  });
});
