import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// config.js は import 時に DATA_DIR を読むため、先に設定する
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
process.env.DATA_DIR = tmp;
process.env.PROJECTS_ROOT = path.join(tmp, 'projects');

const store = await import('../server/store.js');

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('store', () => {
  it('project/thread/message の round-trip', () => {
    store.saveProject({ id: 'prj_1', name: 'demo', slug: 'demo' });
    assert.equal(store.getProject('prj_1').name, 'demo');
    store.saveThread({ id: 'th_1', projectId: 'prj_1', title: 't', updatedAt: 1 });
    assert.equal(store.listThreads('prj_1').length, 1);
    store.appendMessage('th_1', { id: 'msg_1', role: 'user', text: 'hi' });
    assert.equal(store.listMessages('th_1')[0].text, 'hi');
    assert.ok(fs.existsSync(path.join(tmp, 'projects.json')));
  });

  it('job log は追記・末尾取得できる', () => {
    store.appendJobLog('job_1', 'line1');
    store.appendJobLog('job_1', 'line2');
    assert.deepEqual(store.readJobLogTail('job_1'), ['line1', 'line2']);
  });
});
