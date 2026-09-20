import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN } from './config.js';
import {
  uid,
  listProjects,
  getProject,
  saveProject,
  removeProject,
  listThreads,
  getThread,
  saveThread,
  removeThread,
  listMessages,
  getJob,
  listJobs,
} from './store.js';
import {
  slugify,
  createEmptyProjectDir,
  cloneProjectDir,
  projectDir,
  gitStatus,
  gitDiff,
  gitDiffNumstat,
} from './git.js';
import { listHarnessMeta, allStatuses } from './harnesses/index.js';
import {
  createJob,
  interruptJob,
  resumeJob,
  approveJob,
  denyJob,
  jobWithLog,
  publishDiff,
} from './jobs.js';
import { subscribe, emit, subscriberCount } from './events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const query = req.query.token || null;
  const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)relay_token=([^;]+)/)?.[1] || null;
  if (bearer === TOKEN || query === TOKEN || decodeURIComponent(cookie || '') === TOKEN) {
    return next();
  }
  res.status(401).json({ error: 'unauthorized' });
}

export function buildApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.disable('x-powered-by');
  // iOS アプリ (capacitor://localhost) からの到達用。認証は Bearer/クエリの
  // トークンで行い Cookie へ依存しないため、ワイルドカードで足りる。
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // --- public ---
  app.get('/api/health', (req, res) => res.json({ ok: true, subs: subscriberCount() }));
  app.post('/api/connect', (req, res) => {
    if (req.body?.token === TOKEN) {
      res.setHeader(
        'Set-Cookie',
        `relay_token=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax`,
      );
      return res.json({ ok: true });
    }
    res.status(401).json({ error: 'bad token' });
  });

  // --- everything below needs auth ---
  app.use('/api', auth);

  app.get('/api/harnesses', async (req, res) => {
    const meta = listHarnessMeta();
    const statuses = await allStatuses();
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));
    res.json(meta.map((m) => ({ ...m, ...(byId[m.id] || { installed: false }) })));
  });

  // projects
  app.get('/api/projects', async (req, res) => {
    const projects = listProjects();
    const withStatus = await Promise.all(
      projects.map(async (p) => {
        try {
          const st = await gitStatus(projectDir(p));
          return { ...p, dirty: st.porcelain.trim().length > 0, branch: st.branch };
        } catch {
          return { ...p, dirty: false, branch: null };
        }
      }),
    );
    res.json(withStatus);
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const { name, mode, url, branch } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ error: 'name が必要です' });
      const slug = slugify(name);
      if (mode === 'clone') {
        if (!url) return res.status(400).json({ error: 'clone には url が必要です' });
        await cloneProjectDir(slug, url, branch);
      } else {
        await createEmptyProjectDir(slug);
      }
      const project = saveProject({
        id: uid('prj'),
        name: name.trim(),
        slug,
        source: mode === 'clone' ? { url, branch: branch || null } : { url: null },
        createdAt: Date.now(),
      });
      res.json(project);
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  app.delete('/api/projects/:id', (req, res) => {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    for (const t of listThreads(p.id)) removeThread(t.id);
    removeProject(p.id);
    res.json({ ok: true, note: '登録解除のみ。フォルダ自体は残ります' });
  });

  app.get('/api/projects/:id/status', async (req, res) => {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json(await gitStatus(projectDir(p)));
  });

  app.get('/api/projects/:id/diff', async (req, res) => {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const [diff, numstat] = await Promise.all([
      gitDiff(projectDir(p)),
      gitDiffNumstat(projectDir(p)),
    ]);
    res.json({ projectId: p.id, ...diff, numstat });
  });

  // threads
  app.get('/api/projects/:id/threads', (req, res) => {
    if (!getProject(req.params.id)) return res.status(404).json({ error: 'not found' });
    res.json(
      listThreads(req.params.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    );
  });

  app.post('/api/projects/:id/threads', (req, res) => {
    if (!getProject(req.params.id)) return res.status(404).json({ error: 'not found' });
    const title = (req.body?.title || '').trim() || '新しいスレッド';
    const thread = saveThread({
      id: uid('th'),
      projectId: req.params.id,
      title,
      lastHarness: req.body?.harness || 'claude',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    emit('thread_update', { threadId: thread.id, projectId: req.params.id });
    res.json(thread);
  });

  app.get('/api/threads/:id', (req, res) => {
    const t = getThread(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json({
      thread: t,
      messages: listMessages(t.id),
      jobs: listJobs({ threadId: t.id }),
    });
  });

  app.delete('/api/threads/:id', (req, res) => {
    const t = getThread(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    removeThread(t.id);
    emit('thread_update', { threadId: t.id, projectId: t.projectId, deleted: true });
    res.json({ ok: true });
  });

  app.patch('/api/threads/:id', (req, res) => {
    const t = getThread(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    const title = (req.body?.title || '').trim().slice(0, 60);
    if (!title) return res.status(400).json({ error: 'title が必要です' });
    t.title = title;
    t.updatedAt = Date.now();
    saveThread(t);
    emit('thread_update', { threadId: t.id, projectId: t.projectId });
    res.json(t);
  });

  // messages → jobs
  app.post('/api/threads/:id/messages', (req, res) => {
    try {
      const t = getThread(req.params.id);
      if (!t) return res.status(404).json({ error: 'not found' });
      const { text, harness, model } = req.body || {};
      if (!text || !text.trim()) return res.status(400).json({ error: 'text が必要です' });
      if (!harness) return res.status(400).json({ error: 'harness が必要です' });
      const active = listJobs({ threadId: t.id }).find((j) =>
        ['queued', 'running', 'awaiting_approval'].includes(j.status),
      );
      if (active) {
        return res.status(409).json({
          error: '実行中のジョブがあります。中断・承認・拒否してから送信してください',
          jobId: active.id,
        });
      }
      const job = createJob({
        threadId: t.id,
        projectId: t.projectId,
        prompt: text.trim(),
        harness,
        model: model || null,
      });
      // 初回メッセージで無題スレッドに自動タイトル
      if (t.title === '新しいスレッド' || !t.title.trim()) {
        const firstLine = text.trim().split('\n')[0];
        if (firstLine) {
          t.title = firstLine.slice(0, 28) + (firstLine.length > 28 ? '…' : '');
          t.updatedAt = Date.now();
          saveThread(t);
        }
      }
      res.json({ job, messages: listMessages(t.id) });
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  // jobs
  app.get('/api/jobs/:id', (req, res) => {
    const job = jobWithLog(req.params.id);
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json(job);
  });

  app.post('/api/jobs/:id/interrupt', async (req, res) => {
    try {
      res.json(await interruptJob(req.params.id));
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  app.post('/api/jobs/:id/resume', async (req, res) => {
    try {
      res.json(await resumeJob(req.params.id));
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  app.post('/api/jobs/:id/approve', async (req, res) => {
    try {
      res.json(await approveJob(req.params.id));
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  app.post('/api/jobs/:id/deny', async (req, res) => {
    try {
      res.json(await denyJob(req.params.id));
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  app.post('/api/projects/:id/diff/refresh', async (req, res) => {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json(await publishDiff(p.id));
  });

  // SSE (EventSource cannot set headers → token via query or cookie)
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const pending = listJobs().filter((j) => j.status === 'awaiting_approval');
    for (const job of pending) {
      res.write(
        `event: approval_request\ndata: ${JSON.stringify({ type: 'approval_request', job, threadId: job.threadId, projectId: job.projectId })}\n\n`,
      );
    }
    const unsub = subscribe(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {}
    }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });

  // static UI (auth: cookie set by /api/connect; direct file access w/o cookie → still serve shell,
  // API calls inside will 401 and the app shows the connect screen)
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

  return app;
}
