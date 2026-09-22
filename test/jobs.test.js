import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// config.js は import 時に DATA_DIR/PROJECTS_ROOT/HARNESS_IDLE_TIMEOUT_MS を読むため、先に設定する
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
process.env.DATA_DIR = tmp;
process.env.PROJECTS_ROOT = path.join(tmp, 'projects');
process.env.HARNESS_IDLE_TIMEOUT_MS = '150';

const store = await import('../server/store.js');
const { HARNESSES } = await import('../server/harnesses/index.js');
const jobs = await import('../server/jobs.js');

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('jobs: ハーネス無応答時の保護', () => {
  it('出力が止まった子プロセスは idle timeout で kill され、job は error になる', async () => {
    const slug = 'demo-timeout';
    const dir = path.join(process.env.PROJECTS_ROOT, slug);
    fs.mkdirSync(dir, { recursive: true });
    store.saveProject({ id: 'prj_t', name: 'demo', slug });
    store.saveThread({ id: 'th_t', projectId: 'prj_t', title: 't', updatedAt: Date.now() });

    // 実 CLI の代わりに、何も出力せずただ生き続けるだけの子プロセスを使う
    const originalBuild = HARNESSES.claude.build;
    HARNESSES.claude.build = () => ({
      cmd: process.execPath,
      argv: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: dir,
    });

    try {
      const job = store.saveJob({
        id: 'job_t',
        threadId: 'th_t',
        projectId: 'prj_t',
        harness: 'claude',
        model: null,
        mode: 'act',
        prompt: 'hang forever',
        status: 'queued',
        approval: null,
        harnessSessionId: null,
        assistantMessageId: null,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        endedAt: null,
      });

      await jobs.startJob(job.id);
      assert.equal(jobs.isRunning(job.id), true);

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const final = store.getJob(job.id);
      assert.equal(final.status, 'error');
      assert.match(final.error, /無応答/);
      assert.equal(jobs.isRunning(job.id), false);

      // kill 後の close で注記が上書きされず、ストリーミングも終了していること
      const msg = store.listMessages('th_t').find((m) => m.id === final.assistantMessageId);
      assert.equal(msg.streaming, false);
      assert.match(msg.text, /無応答のため強制終了/);
    } finally {
      HARNESSES.claude.build = originalBuild;
    }
  });

  it('出力が続いている限り idle timeout は発火しない', async () => {
    const slug = 'demo-alive';
    const dir = path.join(process.env.PROJECTS_ROOT, slug);
    fs.mkdirSync(dir, { recursive: true });
    store.saveProject({ id: 'prj_a', name: 'demo2', slug });
    store.saveThread({ id: 'th_a', projectId: 'prj_a', title: 't', updatedAt: Date.now() });

    const originalBuild = HARNESSES.claude.build;
    HARNESSES.claude.build = () => ({
      cmd: process.execPath,
      argv: ['-e', 'const t = setInterval(() => console.log("tick"), 50); setTimeout(() => { clearInterval(t); process.exit(0); }, 500)'],
      cwd: dir,
    });

    try {
      const job = store.saveJob({
        id: 'job_a',
        threadId: 'th_a',
        projectId: 'prj_a',
        harness: 'claude',
        model: null,
        mode: 'act',
        prompt: 'keep talking',
        status: 'queued',
        approval: null,
        harnessSessionId: null,
        assistantMessageId: null,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        endedAt: null,
      });

      await jobs.startJob(job.id);
      await new Promise((resolve) => setTimeout(resolve, 900));

      const final = store.getJob(job.id);
      assert.equal(final.status, 'done');
    } finally {
      HARNESSES.claude.build = originalBuild;
    }
  });
});
