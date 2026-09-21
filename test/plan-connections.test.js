import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-plan-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.PROJECTS_ROOT = path.join(tmp, 'projects');
process.env.RELAY_TOKEN = 'test-token-plan';

const config = await import('../server/config.js');
const conn = await import('../server/connections.js');
const { buildApp } = await import('../server/api.js');

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('料金体系', () => {
  it('ローカル実行は利用可能・無料', () => {
    const local = config.EXECUTION_TARGETS.find((t) => t.id === 'local');
    assert.equal(local.available, true);
    assert.equal(local.price, '無料');
    assert.equal(config.PLAN.execution, 'local');
  });

  it('VM 実行は提供外・有料表示', () => {
    const vm = config.EXECUTION_TARGETS.find((t) => t.id === 'vm');
    assert.equal(vm.available, false);
    assert.equal(vm.price, '有料');
  });
});

describe('gh 認証パース', () => {
  it('Logged in 行からアカウントを抜く', () => {
    assert.equal(conn.parseGhAuthStatus('✓ Logged in to github.com account satoki252595'), 'satoki252595');
  });

  it('未ログインは null', () => {
    assert.equal(conn.parseGhAuthStatus('you are not logged into any GitHub hosts'), null);
    assert.equal(conn.parseGhAuthStatus(''), null);
  });
});

describe('plan/connections API', () => {
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
  const auth = { Authorization: 'Bearer test-token-plan', 'Content-Type': 'application/json' };

  it('GET /api/plan は認証不要で料金表を返す', async () => {
    const res = await fetch(`${base}/api/plan`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution, 'local');
    assert.equal(body.targets.length, 2);
  });

  it('GET /api/connections は github 状態を返す', async () => {
    const res = await fetch(`${base}/api/connections`, { headers: auth });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    const gh = body.find((c) => c.id === 'github');
    assert.ok(gh);
    assert.equal(typeof gh.installed, 'boolean');
  });

  it('POST messages with target=vm は 400', async () => {
    const pr = await fetch(`${base}/api/projects`, {
      method: 'POST', headers: auth, body: JSON.stringify({ name: 't' }),
    });
    const project = await pr.json();
    const tr = await fetch(`${base}/api/projects/${project.id}/threads`, {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 't' }),
    });
    const thread = await tr.json();
    const res = await fetch(`${base}/api/threads/${thread.id}/messages`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ text: 'hi', harness: 'claude', target: 'vm' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /VM実行は提供準備中/);
  });
});
