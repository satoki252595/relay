'use strict';
/* Relay デモモード: サーバーなしで UI を一通り試せる缶詰バックエンド。
   審査用・試用用。実サーバーへの接続とは明確に区別して表示する。 */

const Demo = (() => {
  const now = () => Date.now();
  let seq = 0;
  const uid = (p) => `${p}_demo${(++seq).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

  const DANGER = [
    { re: /rm\s+-rf|rm\s+-[a-z]*r/i, label: '再帰的・強制削除 (rm -rf)' },
    { re: /force|強制.*push|push.*強制/i, label: 'force push' },
    { re: /デプロイ|deploy|本番/i, label: 'デプロイ・本番反映' },
    { re: /sudo|削除.*全部|全削除/i, label: '危険操作の疑い' },
  ];

  const state = {
    projects: [
      { id: 'prj_demo1', name: 'Relay Demo', branch: 'main', dirty: true },
    ],
    threads: [
      { id: 'th_demo1', projectId: 'prj_demo1', title: 'ログイン画面の改善', lastHarness: 'claude', createdAt: now() - 86400000, updatedAt: now() - 3600000 },
    ],
    messages: {
      th_demo1: [
        { id: 'msg_demo1', role: 'user', text: 'ログイン画面にバリデーションを追加して', harness: 'claude', at: now() - 3600000 },
        {
          id: 'msg_demo2', role: 'assistant', harness: 'claude', model: null, at: now() - 3500000, streaming: false,
          text: '対応しました。\n\n- メール形式チェックを追加\n- パスワードは8文字以上を必須化\n- エラー表示を日本語化\n\n```diff\n+ if (!isEmail(value)) return "メール形式が正しくありません";\n```\n\n右上の diff ボタンから変更内容を確認できます。',
        },
      ],
    },
    jobs: [],
  };

  const SAMPLE_DIFF = `diff --git a/login.js b/login.js
index 1111111..2222222 100644
--- a/login.js
+++ b/login.js
@@ -12,6 +12,10 @@ function validate(form) {
   const errors = [];
+  if (!isEmail(form.email)) {
+    errors.push("メール形式が正しくありません");
+  }
   if (!form.password || form.password.length < 8) {
-    errors.push("too short");
+    errors.push("パスワードは8文字以上で入力してください");
   }
   return errors;
 }`;

  const REPLIES = [
    (q) => `承知しました。「${q.slice(0, 40)}」に対応します。(デモ応答)\n\n- 変更点1: 入力チェックを追加\n- 変更点2: 文言を日本語化\n\n右上の diff から変更を確認できます。`,
    (q) => `「${q.slice(0, 40)}」を確認しました。(デモ応答)\n\n1. まず現状のコードを読みます\n2. 修正してテストします\n3. diff にまとめます\n\n追加の指示があればどうぞ。`,
  ];
  let replyIdx = 0;

  // UI 側が差し込む描画フック (patchMessage / resync 相当)
  const hooks = { patch: null, resync: null };
  function setHooks(patch, resync) {
    hooks.patch = patch;
    hooks.resync = resync;
  }

  function getThread(id) {
    const t = state.threads.find((x) => x.id === id);
    if (!t) throw new Error('not found');
    return t;
  }

  function activeJob(threadId) {
    return state.jobs.find((j) => j.threadId === threadId && ['queued', 'running', 'awaiting_approval'].includes(j.status));
  }

  function streamJob(job) {
    const threadId = job.threadId;
    const reply = REPLIES[replyIdx++ % REPLIES.length](job.prompt);
    const chunks = reply.match(/[\s\S]{1,24}/g) || [];
    let i = 0;
    job.status = 'running';
    job.updatedAt = now();
    const timer = setInterval(() => {
      if (job.status !== 'running') { clearInterval(timer); return; }
      i++;
      const partial = chunks.slice(0, i).join('');
      const msgs = state.messages[threadId];
      const m = msgs.find((x) => x.id === job.assistantMessageId);
      if (m) m.text = partial;
      if (hooks.patch) hooks.patch(job.assistantMessageId, partial, true);
      if (i >= chunks.length) {
        clearInterval(timer);
        job.status = 'done';
        job.updatedAt = now();
        job.endedAt = now();
        if (m) m.streaming = false;
        if (hooks.patch) hooks.patch(job.assistantMessageId, reply, false);
        if (hooks.resync) hooks.resync();
      }
    }, 160);
  }

  function msgs(threadId) {
    return state.messages[threadId] || (state.messages[threadId] = []);
  }

  // api(path, opts) と同じ入出力の缶詰実装
  async function request(path, opts = {}) {
    await new Promise((r) => setTimeout(r, 120));
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    const seg = path.replace(/^\/api\//, '').split('/');

    if (seg[0] === 'harnesses') {
      return [
        { id: 'claude', label: 'Claude Code', provider: 'Anthropic', binary: 'claude', installed: true, version: 'demo' },
        { id: 'codex', label: 'Codex', provider: 'OpenAI', binary: 'codex', installed: true, version: 'demo' },
        { id: 'muse', label: 'Muse', provider: 'Meta', binary: 'muse', installed: true, version: 'demo' },
        { id: 'cursor', label: 'Cursor Agent', provider: 'Cursor', binary: 'cursor-agent', installed: true, version: 'demo' },
      ];
    }
    if (seg[0] === 'projects' && seg.length === 1) {
      if (method === 'GET') return state.projects;
      const p = { id: uid('prj'), name: body.name, branch: 'main', dirty: false };
      state.projects.push(p);
      return p;
    }
    if (seg[0] === 'projects' && seg[2] === 'threads') {
      if (method === 'GET') return state.threads.filter((t) => t.projectId === seg[1]);
      const t = { id: uid('th'), projectId: seg[1], title: body.title || '新しいスレッド', lastHarness: body.harness || 'claude', createdAt: now(), updatedAt: now() };
      state.threads.push(t);
      return t;
    }
    if (seg[0] === 'projects' && seg[2] === 'diff') {
      return {
        projectId: seg[1], diff: SAMPLE_DIFF, truncated: false, untracked: ['notes/demo-memo.md'],
        numstat: [{ added: 4, removed: 1, path: 'login.js' }], error: null,
      };
    }
    if (seg[0] === 'projects' && method === 'DELETE') {
      state.projects = state.projects.filter((p) => p.id !== seg[1]);
      state.threads = state.threads.filter((t) => t.projectId !== seg[1]);
      return { ok: true };
    }
    if (seg[0] === 'threads' && seg.length === 2) {
      const t = getThread(seg[1]);
      if (method === 'GET') return { thread: t, messages: msgs(t.id), jobs: state.jobs.filter((j) => j.threadId === t.id) };
      if (method === 'PATCH') {
        t.title = (body.title || '').slice(0, 60) || t.title;
        t.updatedAt = now();
        return t;
      }
      if (method === 'DELETE') {
        state.threads = state.threads.filter((x) => x.id !== t.id);
        delete state.messages[t.id];
        return { ok: true };
      }
    }
    if (seg[0] === 'threads' && seg[2] === 'messages' && method === 'POST') {
      const t = getThread(seg[1]);
      if (activeJob(t.id)) throw new Error('実行中のジョブがあります');
      const text = (body.text || '').trim();
      if (!text) throw new Error('text が必要です');
      const userMsg = { id: uid('msg'), role: 'user', text, harness: body.harness, at: now() };
      msgs(t.id).push(userMsg);
      if (t.title === '新しいスレッド') {
        t.title = text.split('\n')[0].slice(0, 28);
      }
      const hits = DANGER.filter((d) => d.re.test(text)).map((d) => ({ rule: 'demo', label: d.label }));
      const assistantMsg = { id: uid('msg'), role: 'assistant', harness: body.harness, model: body.model || null, text: '', at: now(), streaming: hits.length === 0 };
      const job = {
        id: uid('job'), threadId: t.id, projectId: t.projectId, harness: body.harness, model: body.model || null,
        prompt: text, status: hits.length ? 'awaiting_approval' : 'queued',
        approval: hits.length ? { reason: 'prompt', hits, requestedAt: now() } : null,
        assistantMessageId: assistantMsg.id, createdAt: now(), updatedAt: now(),
      };
      assistantMsg.jobId = job.id;
      msgs(t.id).push(assistantMsg);
      state.jobs.push(job);
      t.updatedAt = now();
      t.lastHarness = body.harness;
      if (!hits.length) setTimeout(() => streamJob(job), 300);
      return { job, messages: msgs(t.id) };
    }
    if (seg[0] === 'jobs' && seg.length === 3) {
      const job = state.jobs.find((j) => j.id === seg[1]);
      if (!job) throw new Error('not found');
      const action = seg[2];
      const list = msgs(job.threadId);
      const m = list.find((x) => x.id === job.assistantMessageId);
      if (action === 'interrupt' && job.status === 'running') {
        job.status = 'interrupted';
        job.updatedAt = now();
        job.endedAt = now();
        if (m) { m.streaming = false; m.text += '\n\n(中断しました。「再開」で続けられます)\n'; }
      } else if (action === 'resume' && ['interrupted', 'error'].includes(job.status)) {
        job.status = 'queued';
        if (m) { m.streaming = true; m.text += '\n\n(再開…)\n'; }
        // 残りを流す簡易再開: 完了扱いで締める
        const full = (m.text || '') + '続きを完了しました。(デモ応答)\n';
        let i = 0;
        const timer = setInterval(() => {
          i += 24;
          const partial = full.slice(0, m.text.length + 0) + full.slice(m.text.length, m.text.length + i);
          m.text = partial;
          if (hooks.patch) hooks.patch(m.id, partial, true);
          if (m.text.length >= full.length) {
            clearInterval(timer);
            job.status = 'done';
            m.streaming = false;
            if (hooks.patch) hooks.patch(m.id, full, false);
            if (hooks.resync) hooks.resync();
          }
        }, 120);
      } else if (action === 'approve' && job.status === 'awaiting_approval') {
        job.approval = { ...(job.approval || {}), resolvedAt: now(), decision: 'approved' };
        job.status = 'queued';
        if (m) { m.streaming = true; m.text = '承認されました。続行します。(デモ)\n'; }
        setTimeout(() => streamJob(job), 300);
      } else if (action === 'deny' && job.status === 'awaiting_approval') {
        job.approval = { ...(job.approval || {}), resolvedAt: now(), decision: 'denied' };
        job.status = 'denied';
        job.endedAt = now();
        if (m) { m.streaming = false; m.text += '\n(拒否されました)\n'; }
      }
      return job;
    }
    throw new Error(`demo 未対応: ${path}`);
  }

  return { request, setHooks };
})();
