import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.PROJECTS_ROOT = path.join(tmp, 'projects');

const git = await import('../server/git.js');
const jobs = await import('../server/jobs.js');
const store = await import('../server/store.js');

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(tmp, 'repo-'));
  sh('git', ['init', '-b', 'main'], dir);
  return dir;
}

describe('listFiles', () => {
  it('tracked + untracked を返し、除外標準を守る', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
    fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'y.js'), '1');
    fs.writeFileSync(path.join(dir, 'a.js'), '1');
    fs.writeFileSync(path.join(dir, 'new.md'), '2');
    sh('git', ['add', '.gitignore', 'a.js'], dir);
    const files = await git.listFiles(dir);
    assert.ok(files.includes('a.js'));
    assert.ok(files.includes('new.md'));
    assert.ok(!files.some((f) => f.includes('node_modules')));
  });

  it('非 git では walk 代替 (上限つき)', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'plain-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'config'), 'x');
    const files = await git.listFiles(dir, { limit: 10 });
    assert.deepEqual(files, ['a.txt']);
  });
});

describe('gitHead', () => {
  it('HEAD あり→40桁、空→null', async () => {
    const dir = makeRepo();
    assert.equal(await git.gitHead(dir), null);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    sh('git', ['add', '.'], dir);
    sh('git', ['commit', '-m', 'init'], dir);
    const head = await git.gitHead(dir);
    assert.match(head, /^[0-9a-f]{40}$/);
  });
});

describe('applyMode', () => {
  it('plan は指示接頭辞、act は素通し', () => {
    assert.ok(jobs.applyMode('直して', 'plan').startsWith('【相談モード】'));
    assert.ok(jobs.applyMode('直して', 'plan').endsWith('直して'));
    assert.equal(jobs.applyMode('直して', 'act'), '直して');
    assert.equal(jobs.applyMode('直して', 'bogus'), '直して');
  });
});

describe('rewindJob', () => {
  it('退避つきで checkpoint に戻す', async () => {
    const slug = 'rw-test';
    const dir = path.join(process.env.PROJECTS_ROOT, slug);
    fs.mkdirSync(dir, { recursive: true });
    sh('git', ['init', '-b', 'main'], dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'v1\n');
    sh('git', ['add', '.'], dir);
    sh('git', ['commit', '-m', 'init'], dir);
    const head = await git.gitHead(dir);

    const project = store.saveProject({ id: 'prj_rw', name: 'rw', slug });
    const thread = store.saveThread({ id: 'th_rw', projectId: project.id, title: 't', mode: 'act', updatedAt: 1 });
    const job = store.saveJob({
      id: 'job_rw1', threadId: thread.id, projectId: project.id, harness: 'claude',
      mode: 'act', prompt: 'x', status: 'done', checkpoint: { head, at: Date.now() },
      createdAt: 1, updatedAt: 1,
    });

    // エージェントが壊したてい
    fs.writeFileSync(path.join(dir, 'a.txt'), 'broken\n');
    fs.writeFileSync(path.join(dir, 'junk.tmp'), 'junk\n');

    const res = await jobs.rewindJob(job.id);
    assert.equal(res.ok, true);
    assert.equal(res.head, head);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1\n');
    assert.ok(!fs.existsSync(path.join(dir, 'junk.tmp')));
    const stashList = sh('git', ['stash', 'list'], dir);
    assert.match(stashList, /relay-rewind:job_rw1/);
    assert.ok(store.getJob(job.id).rewound);
  });

  it('ガード: checkpoint なし・二重・実行中は拒否', async () => {
    const project = store.saveProject({ id: 'prj_rw2', name: 'rw2', slug: 'rw2' });
    const thread = store.saveThread({ id: 'th_rw2', projectId: project.id, title: 't', mode: 'act', updatedAt: 1 });
    const noCp = store.saveJob({
      id: 'job_nocp', threadId: thread.id, projectId: project.id, harness: 'claude',
      mode: 'act', prompt: 'x', status: 'done', createdAt: 1, updatedAt: 1,
    });
    await assert.rejects(() => jobs.rewindJob(noCp.id), /チェックポイントがありません/);
    await assert.rejects(() => jobs.rewindJob('job_missing'), /見つかりません/);

    const done = store.saveJob({
      id: 'job_guarded', threadId: thread.id, projectId: project.id, harness: 'claude',
      mode: 'act', prompt: 'x', status: 'done', checkpoint: { head: 'abc', at: 1 },
      createdAt: 1, updatedAt: 1,
    });
    store.saveJob({
      id: 'job_active', threadId: thread.id, projectId: project.id, harness: 'claude',
      mode: 'act', prompt: 'y', status: 'running', createdAt: 1, updatedAt: 1,
    });
    await assert.rejects(() => jobs.rewindJob(done.id), /実行中のジョブ/);
    done.status = 'done';
    done.rewound = { at: 1, head: 'abc', stashed: true };
    store.saveJob(done);
    const stillActive = store.getJob('job_active');
    stillActive.status = 'done';
    store.saveJob(stillActive);
    await assert.rejects(() => jobs.rewindJob(done.id), /巻き戻し済み/);
  });
});
