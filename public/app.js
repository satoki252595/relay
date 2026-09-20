'use strict';
/* Relay Agent Chat UI — スマホ前提。REST + SSE のみでホストと通信。 */

const $ = (id) => document.getElementById(id);
const HARNESS_JA = { claude: 'Claude', codex: 'Codex', muse: 'Muse', cursor: 'Cursor' };
const MODEL_HINTS = {
  claude: ['sonnet', 'opus', 'haiku'],
  codex: ['gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini'],
  muse: [],
  cursor: ['sonnet-4-thinking', 'gpt-5', 'auto'],
};

const state = {
  base: localStorage.getItem('relay_base') || location.origin,
  token: localStorage.getItem('relay_token') || '',
  harnesses: [],
  projects: [],
  project: null,
  threads: [],
  thread: null,
  messages: [],
  jobs: [],
  harness: localStorage.getItem('relay_harness') || 'claude',
  es: null,
  follow: true,
  pending: new Map(), // threadId -> jobId (承認待ち)
  demo: false,
  files: [], // @言及候補 (openThread で取得・project 単位キャッシュ)
  filesProjectId: null,
  queue: [], // 待機送信 [{ threadId, text, harness, model }]
};

/* ============ 小物 ============ */
function toast(msg, kind = '') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 3200);
}

function buzz(pattern) {
  try {
    // ネイティブ (Capacitor): Haptics プラグイン優先
    const hap = window.Capacitor?.Plugins?.Haptics;
    if (hap?.impact) {
      const heavy = Array.isArray(pattern);
      hap.impact({ style: heavy ? 'HEAVY' : 'LIGHT' }).catch(() => {});
      return;
    }
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* noop */ }
}

function relTime(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 50) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return new Date(ts).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}

function absTime(ts) {
  return new Date(ts).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function elapsed(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

async function copyText(text, done = 'コピーしました') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(done);
    } catch {
      toast('コピーできませんでした', 'bad');
    }
    ta.remove();
  }
}

/* ============ API ============ */
async function api(path, opts = {}) {
  if (state.demo) return Demo.request(path, opts);
  const res = await fetch(state.base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}`, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    disconnect();
    throw new Error('認証切れ。再接続してください');
  }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

/* ============ Markdown (依存なし) ============ */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function md(src) {
  const fences = [];
  let html = esc(src).replace(/```(\S*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    fences.push({ lang: lang || 'code', code: code.replace(/\n$/, '') });
    return `\u0000${fences.length - 1}\u0000`;
  });
  html = html
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim();
      if (/^\u0000\d+\u0000$/.test(t)) return block;
      if (/^<(h\d|pre|blockquote|hr|ul|ol)/.test(t)) return block;
      if (/^\|.*\|$/m.test(t) && /\|[\s:-]+\|/.test(t)) return mdTable(t);
      if (/^(-|\*|\d+\.) /m.test(t)) {
        const items = t
          .split('\n')
          .map((l) => {
            const task = l.match(/^(-|\*) \[([ xX])\] (.*)$/);
            if (task) return `<li class="task">${task[2] === ' ' ? '☐' : '☑'} ${task[3]}</li>`;
            return `<li>${l.replace(/^(-|\*|\d+\.) /, '')}</li>`;
          })
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const f = fences[Number(i)];
    return `<div class="codeblock"><div class="chead"><span>${esc(f.lang)}</span><button data-code="${i}"><svg><use href="#i-copy"/></svg>コピー</button></div><pre><code>${f.code}</code></pre></div>`;
  });
}

function mdTable(block) {
  const rows = block.split('\n').filter((l) => /^\|.*\|$/.test(l.trim()));
  if (rows.length < 2) return `<p>${esc(block)}</p>`;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  return `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function bindCodeCopy(root) {
  root.querySelectorAll('.codeblock button').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const code = b.closest('.codeblock').querySelector('pre').innerText;
      copyText(code);
    };
  });
}

/* ============ 通知 ============ */
function ensureNotifyPermission() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    if (localStorage.getItem('relay_notify_asked')) return;
    localStorage.setItem('relay_notify_asked', '1');
    Notification.requestPermission().catch(() => {});
  } catch { /* noop */ }
}

function notify(title, body) {
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'relay' });
    }
  } catch { /* noop */ }
}

/* ============ 接続 ============ */
async function connect() {
  state.base = ($('connect-url').value || location.origin).replace(/\/$/, '');
  state.token = $('connect-token').value.trim();
  $('connect-err').textContent = '';
  $('connect-go').disabled = true;
  try {
    const res = await fetch(state.base + '/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.token }),
    });
    if (!res.ok) throw new Error('トークンが違います。ホストの data/.token を確認してください');
    localStorage.setItem('relay_base', state.base);
    localStorage.setItem('relay_token', state.token);
    ensureNotifyPermission();
    await enterMain();
  } catch (err) {
    $('connect-err').textContent = String(err.message || err);
  } finally {
    $('connect-go').disabled = false;
  }
}

function disconnect() {
  state.token = '';
  state.thread = null;
  state.demo = false;
  state.pending.clear();
  updateChatBadge();
  localStorage.removeItem('relay_token');
  if (state.es) { state.es.close(); state.es = null; }
  $('connect-token').value = '';
  $('demo-banner').classList.add('hidden');
  $('view-main').classList.add('hidden');
  $('view-connect').classList.remove('hidden');
}

async function enterDemo() {
  state.demo = true;
  state.thread = null;
  $('view-connect').classList.add('hidden');
  $('view-main').classList.remove('hidden');
  $('demo-banner').classList.remove('hidden');
  Demo.setHooks(
    (messageId, text, streaming) => patchMessage(messageId, text, streaming),
    () => resyncThread(),
  );
  state.harnesses = await api('/api/harnesses');
  renderChips();
  await refreshProjects();
  setConn('ok');
  await openThread('th_demo1', { silent: true });
  switchTab('chat');
}

/* ============ タブ ============ */
function switchTab(which) {
  const chat = which === 'chat';
  $('tab-projects').classList.toggle('hidden', chat);
  $('tab-chat').classList.toggle('hidden', !chat);
  $('bar-projects').classList.toggle('hidden', chat);
  $('bar-chat').classList.toggle('hidden', !chat);
  $('tabbtn-projects').classList.toggle('active', !chat);
  $('tabbtn-chat').classList.toggle('active', chat);
  if (chat) updateChatBadge();
}

function updateChatBadge() {
  const n = state.pending.size;
  const badge = $('chat-badge');
  badge.classList.toggle('hidden', n === 0);
  badge.textContent = n > 9 ? '9+' : n;
}

/* ============ メイン ============ */
async function enterMain() {
  $('view-connect').classList.add('hidden');
  $('view-main').classList.remove('hidden');
  state.harnesses = await api('/api/harnesses');
  if (!state.harnesses.some((h) => h.id === state.harness && h.installed)) {
    state.harness = (state.harnesses.find((h) => h.installed) || state.harnesses[0] || {}).id || 'claude';
  }
  renderChips();
  await refreshProjects();
  openSSE();
  switchTab(state.thread ? 'chat' : 'projects');
  const lastTid = localStorage.getItem('relay_thread');
  if (lastTid) {
    try {
      await openThread(lastTid, { silent: true });
    } catch {
      localStorage.removeItem('relay_thread');
    }
  }
}

function renderChips() {
  const box = $('harness-chips');
  box.innerHTML = '';
  for (const h of state.harnesses) {
    const b = document.createElement('button');
    b.className = `chip ${h.installed ? '' : 'missing'}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', h.id === state.harness ? 'true' : 'false');
    b.disabled = !h.installed;
    b.innerHTML = `<span class="dot"></span>${h.label}`;
    b.title = h.installed ? `${h.provider} — ${h.version || ''}` : 'ホストで未検出';
    b.onclick = () => {
      state.harness = h.id;
      localStorage.setItem('relay_harness', h.id);
      renderChips();
      refreshModelHints();
    };
    box.appendChild(b);
  }
  refreshModelHints();
}

function refreshModelHints() {
  $('model-list').innerHTML = (MODEL_HINTS[state.harness] || []).map((m) => `<option value="${m}">`).join('');
}

/* ============ プロジェクト / スレッド ============ */
async function refreshProjects() {
  state.projects = await api('/api/projects');
  const list = $('project-list');
  list.innerHTML = state.projects.length ? '' : '<div class="empty"><p>まだありません。新規作成してください</p></div>';
  for (const p of state.projects) {
    const card = document.createElement('div');
    card.className = 'pcard';
    card.innerHTML = `
      <svg class="folder-ic"><use href="#i-folder"/></svg>
      <div class="info"><strong>${esc(p.name)}</strong>
      <span class="meta">${p.dirty ? '<span class="dirty-dot"></span>変更あり' : 'クリーン'}${p.branch ? ` ・ ${esc(p.branch)}` : ''}</span></div>
      <button class="icon-btn del" aria-label="登録解除"><svg><use href="#i-trash"/></svg></button>`;
    card.onclick = () => selectProject(p.id);
    const del = card.querySelector('.del');
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`「${p.name}」の登録を解除しますか？\n(フォルダ自体は残ります)`)) return;
      await api(`/api/projects/${p.id}`, { method: 'DELETE' });
      if (state.project?.id === p.id) {
        state.project = null;
        $('threads-pane').classList.add('hidden');
        $('projects-pane').classList.remove('hidden');
      }
      refreshProjects();
    };
    list.appendChild(card);
  }
}

async function selectProject(id) {
  state.project = state.projects.find((p) => p.id === id);
  $('projects-pane').classList.add('hidden');
  $('threads-pane').classList.remove('hidden');
  $('threads-prj').textContent = state.project.name;
  state.threads = await api(`/api/projects/${id}/threads`);
  const list = $('thread-list');
  list.innerHTML = state.threads.length ? '' : '<div class="empty"><p>スレッドなし。下から開始</p></div>';
  for (const t of state.threads) {
    const card = document.createElement('div');
    card.className = 'pcard tcard';
    card.innerHTML = `
      <div class="info"><strong>${esc(t.title)}</strong>
      <small>${relTime(t.updatedAt)} ・ ${HARNESS_JA[t.lastHarness] || ''}${state.pending.has(t.id) ? ' ・ 要承認' : ''}</small></div>
      <button class="icon-btn del" aria-label="削除"><svg><use href="#i-trash"/></svg></button>`;
    card.onclick = () => openThread(t.id);
    const del = card.querySelector('.del');
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`「${t.title}」を削除しますか？`)) return;
      await api(`/api/threads/${t.id}`, { method: 'DELETE' });
      if (state.thread?.id === t.id) closeThread();
      selectProject(id);
    };
    list.appendChild(card);
  }
}

async function createThread() {
  const title = $('thread-title').value.trim();
  const t = await api(`/api/projects/${state.project.id}/threads`, {
    method: 'POST',
    body: JSON.stringify({ title, harness: state.harness }),
  });
  $('thread-title').value = '';
  openThread(t.id);
}

/* ============ シート ============ */
function openSheet(html) {
  $('sheet').innerHTML = `<div class="grab"></div>${html}`;
  $('sheet').classList.remove('hidden');
  $('scrim').classList.remove('hidden');
}

function closeSheet() {
  $('sheet').classList.add('hidden');
  $('scrim').classList.add('hidden');
  $('sheet').innerHTML = '';
}

function sheetNewProject() {
  openSheet(`
    <h3>新規プロジェクト</h3>
    <label class="field">名前<input id="np-name" type="text" maxlength="60" placeholder="my-app"></label>
    <div class="seg-row" role="radiogroup">
      <button id="np-empty" class="active">空フォルダ作成</button>
      <button id="np-clone">git clone</button>
    </div>
    <label class="field hidden" id="np-url-wrap">リポジトリ URL<input id="np-url" type="text" inputmode="url" placeholder="https://github.com/org/repo.git"></label>
    <p id="np-err" class="err"></p>
    <button id="np-go" class="btn primary">作成</button>`);
  let mode = 'empty';
  const setMode = (m) => {
    mode = m;
    $('np-empty').classList.toggle('active', m === 'empty');
    $('np-clone').classList.toggle('active', m === 'clone');
    $('np-url-wrap').classList.toggle('hidden', m !== 'clone');
  };
  $('np-empty').onclick = () => setMode('empty');
  $('np-clone').onclick = () => setMode('clone');
  $('np-go').onclick = async () => {
    $('np-err').textContent = '';
    $('np-go').disabled = true;
    try {
      const p = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: $('np-name').value.trim(), mode, url: $('np-url').value.trim() || undefined }),
      });
      closeSheet();
      await refreshProjects();
      selectProject(p.id);
    } catch (err) {
      $('np-err').textContent = String(err.message || err);
    } finally {
      $('np-go').disabled = false;
    }
  };
  setTimeout(() => $('np-name').focus(), 50);
}

function sheetRename() {
  if (!state.thread) return;
  openSheet(`
    <h3>スレッド名を変更</h3>
    <label class="field">名前<input id="rn-name" type="text" maxlength="60" value="${esc(state.thread.title)}"></label>
    <button id="rn-go" class="btn primary">保存</button>`);
  $('rn-go').onclick = async () => {
    const title = $('rn-name').value.trim();
    if (!title) return;
    state.thread = await api(`/api/threads/${state.thread.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    $('chat-thread').textContent = state.thread.title;
    closeSheet();
  };
  setTimeout(() => $('rn-name').select(), 50);
}

/* ============ チャット ============ */
const msgEls = new Map();

function activeJob() {
  return state.jobs.find((j) => ['queued', 'running', 'awaiting_approval'].includes(j.status)) || null;
}

function lastResumable() {
  return [...state.jobs].reverse().find((j) => ['interrupted', 'error'].includes(j.status)) || null;
}

async function openThread(id, { silent = false } = {}) {
  const data = await api(`/api/threads/${id}`);
  state.thread = data.thread;
  state.messages = data.messages;
  state.jobs = data.jobs;
  if (!state.demo) localStorage.setItem('relay_thread', id);
  if (data.thread.lastHarness && state.harnesses.some((h) => h.id === data.thread.lastHarness && h.installed)) {
    state.harness = data.thread.lastHarness;
    renderChips();
  }
  $('chat-thread').textContent = data.thread.title;
  $('chat-project').textContent = (state.projects.find((p) => p.id === data.thread.projectId) || {}).name || '';
  $('chat-empty').classList.add('hidden');
  $('chat-wrap').classList.remove('hidden');
  state.follow = true;
  renderMessages();
  renderJobzone();
  renderApproval();
  renderModeSeg();
  renderQueue();
  renderSendBtn();
  restoreDraft();
  refreshDiffBadge();
  void refreshFiles(data.thread.projectId);
  if (!silent) switchTab('chat');
}

function closeThread() {
  state.thread = null;
  localStorage.removeItem('relay_thread');
  $('chat-empty').classList.remove('hidden');
  $('chat-wrap').classList.add('hidden');
}

function renderMessages() {
  const box = $('messages');
  box.innerHTML = '';
  msgEls.clear();
  if (!state.messages.length) {
    box.innerHTML = '<div class="empty"><p>最初の指示を送って開始</p></div>';
    return;
  }
  for (const m of state.messages) box.appendChild(buildMsgEl(m));
  bindCodeCopy(box);
  box.scrollTop = box.scrollHeight;
}

function buildMsgEl(m) {
  const div = document.createElement('div');
  div.className = `msg ${m.role}`;
  div.dataset.id = m.id;
  if (m.role === 'user') {
    div.textContent = m.text;
  } else {
    const who = HARNESS_JA[m.harness] || 'agent';
    div.innerHTML = `
      <div class="who"><span class="hm">${esc(who)}</span>${m.model ? `<span>${esc(m.model)}</span>` : ''}<time title="${absTime(m.at)}">${relTime(m.at)}</time>
      <button class="copy-btn" aria-label="コピー"><svg><use href="#i-copy"/></svg></button></div>
      <div class="body">${m.text ? md(m.text) : ''}${m.streaming ? '<span class="stream-caret"></span>' : ''}</div>`;
    div.querySelector('.copy-btn').onclick = () => copyText(m.text || '');
  }
  msgEls.set(m.id, div);
  return div;
}

// ストリーミング中は該当ノードだけ更新 (全体再描画しない)
function patchMessage(messageId, text, streaming) {
  const m = state.messages.find((x) => x.id === messageId);
  if (m) { m.text = text; m.streaming = streaming; }
  const el = msgEls.get(messageId);
  const box = $('messages');
  if (!el) { renderMessages(); return; }
  const body = el.querySelector('.body');
  body.innerHTML = (text ? md(text) : '') + (streaming ? '<span class="stream-caret"></span>' : '');
  bindCodeCopy(el);
  if (state.follow) box.scrollTop = box.scrollHeight;
  else $('jump-latest').classList.remove('hidden');
}

function renderJobzone() {
  const zone = $('jobzone');
  zone.innerHTML = '';
  const job = activeJob();
  if (!job) {
    const r = lastResumable();
    if (r) {
      const div = document.createElement('div');
      div.className = `job ${r.status === 'error' ? 'error' : ''}`;
      div.innerHTML = `<div class="grow">${r.status === 'error' ? `エラー: ${esc(r.error || '不明')}` : '中断中。前回の続きから再開できます'}。</div>`;
      const b = document.createElement('button');
      b.textContent = '再開する';
      b.onclick = () => jobAction(r.id, 'resume');
      div.appendChild(b);
      zone.appendChild(div);
    } else {
      const last = [...state.jobs].reverse().find((j) => j.status === 'done');
      if (last) {
        const div = document.createElement('div');
        div.className = 'job done-note';
        div.textContent = `完了 ${absTime(last.endedAt || last.updatedAt)} ・ ${HARNESS_JA[last.harness] || ''}`;
        zone.appendChild(div);
      }
    }
    return;
  }
  if (job.status === 'awaiting_approval') return; // 承認カード側で表示
  // 停止は composer のボタンに一本化 (このカードは状態表示のみ)
  const div = document.createElement('div');
  div.className = 'job';
  div.innerHTML = `<span class="spin"></span><div class="grow"><strong>${esc(HARNESS_JA[job.harness] || '')}</strong> ${job.status === 'queued' ? '待機中' : '実行中'}<div class="t" data-t0="${job.updatedAt}">${elapsed(job.updatedAt)}</div></div>`;
  zone.appendChild(div);
}

function renderApproval() {
  const slot = $('approval-slot');
  slot.innerHTML = '';
  const job = activeJob();
  if (!job || job.status !== 'awaiting_approval') return;
  const hits = job.approval?.hits || [];
  const card = document.createElement('div');
  card.className = 'approval';
  card.innerHTML = `
    <div class="ahead"><svg><use href="#i-alert"/></svg>承認が必要です</div>
    <div class="sub">${esc(HARNESS_JA[job.harness] || '')} ・ ${job.approval?.reason === 'mid_run_tool' ? '実行中の操作を一時停止しました' : '実行前の確認'}</div>
    ${hits.length ? `<ul>${hits.map((h) => `<li>${esc(h.label)}</li>`).join('')}</ul>` : ''}
    ${job.approval?.evidence ? `<details><summary>検出内容</summary><pre>${esc(job.approval.evidence)}</pre></details>` : ''}
    <div class="arow"><button class="allow">許可する</button><button class="deny">拒否する</button></div>`;
  const [allow, deny] = card.querySelectorAll('button');
  allow.onclick = () => jobAction(job.id, 'approve');
  deny.onclick = () => jobAction(job.id, 'deny');
  slot.appendChild(card);
  placeJump();
}

async function jobAction(id, action) {
  try {
    await api(`/api/jobs/${id}/${action}`, { method: 'POST' });
    buzz(20);
    if (state.demo && (action === 'approve' || action === 'deny') && state.thread) {
      state.pending.delete(state.thread.id);
      updateChatBadge();
    }
    await resyncThread();
  } catch (err) {
    toast(String(err.message || err), 'bad');
  }
}

async function resyncThread() {
  if (!state.thread) return;
  try {
    const data = await api(`/api/threads/${state.thread.id}`);
    state.thread = data.thread;
    state.messages = data.messages;
    state.jobs = data.jobs;
    // ストリーミング中の応答性のため、差分が1件の更新なら patch を優先
    renderMessages();
    renderJobzone();
    renderApproval();
    renderModeSeg();
    renderSendBtn();
    refreshDiffBadge();
    void flushQueue();
  } catch { /* 切断時などは SSE 復帰で追従 */ }
}

/* ---------- composer ---------- */
function sendMode() {
  const job = activeJob();
  if (job && (job.status === 'running' || job.status === 'queued')) return 'stop';
  return 'send';
}

function renderSendBtn() {
  const btn = $('btn-send');
  const mode = sendMode();
  btn.classList.toggle('stop', mode === 'stop');
  btn.innerHTML = mode === 'stop' ? '<svg><use href="#i-stop"/></svg>' : '<svg><use href="#i-send"/></svg>';
  btn.setAttribute('aria-label', mode === 'stop' ? '中断' : '送信');
  btn.disabled = mode === 'send' && !$('input').value.trim();
}

function autogrow() {
  const ta = $('input');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 132) + 'px';
  renderSendBtn();
}

function saveDraft() {
  if (state.thread) localStorage.setItem(`relay_draft_${state.thread.id}`, $('input').value);
}

function restoreDraft() {
  $('input').value = state.thread ? localStorage.getItem(`relay_draft_${state.thread.id}`) || '' : '';
  autogrow();
}

let sending = false; // POST 飛行中 (activeJob が更新されるまでの繋ぎ)

async function send(preset) {
  const text = (preset?.text ?? $('input').value).trim();
  const harness = preset?.harness ?? state.harness;
  const model = preset?.model ?? ($('model-pick').value.trim() || null);
  if (!text || !state.thread) return;
  // 実行中・承認待ち・送信飛行中でも受け付けて待機列へ (考えを止めない)
  if (activeJob() || sending) {
    const mine = state.queue.filter((q) => q.threadId === state.thread.id);
    if (mine.length >= 3) {
      toast('待機は3件までです', 'warn');
      return;
    }
    state.queue.push({ threadId: state.thread.id, text, harness, model });
    if (!preset) {
      $('input').value = '';
      autogrow();
      saveDraft();
    }
    pushHist(text);
    buzz(15);
    renderQueue();
    toast('送信待ちに入れました');
    return;
  }
  if (!preset) {
    $('input').value = '';
    autogrow();
    saveDraft();
  }
  buzz(15);
  sending = true;
  renderSendBtn();
  try {
    const data = await api(`/api/threads/${state.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, harness, model }),
    });
    if (state.thread) localStorage.removeItem(`relay_draft_${state.thread.id}`);
    pushHist(text);
    state.follow = true;
    await resyncThread();
    // デモには SSE がないため承認通知を直接出す (実機では SSE が届く)
    if (state.demo && data.job?.status === 'awaiting_approval') {
      noteApproval(state.thread.id, state.thread.projectId, data.job);
    }
  } catch (err) {
    if (!preset) {
      $('input').value = text;
      autogrow();
    } else {
      state.queue.unshift({ threadId: state.thread.id, text, harness, model });
      renderQueue();
    }
    toast(String(err.message || err), 'bad');
  } finally {
    sending = false;
    renderSendBtn();
  }
}

/* ---------- 待機送信キュー ---------- */
let flushing = false;

function renderQueue() {
  const mine = state.thread ? state.queue.filter((q) => q.threadId === state.thread.id) : [];
  const chip = $('queue-chip');
  chip.classList.toggle('hidden', mine.length === 0);
  if (mine.length) {
    const first = mine[0].text.split('\n')[0].slice(0, 40);
    $('queue-text').textContent = mine.length > 1 ? `待機 ${mine.length}件: ${first}…` : `待機中: ${first}`;
  }
  placeJump();
}

function cancelQueue() {
  if (!state.thread) return;
  state.queue = state.queue.filter((q) => q.threadId !== state.thread.id);
  renderQueue();
}

async function flushQueue() {
  if (flushing || !state.thread || activeJob()) return;
  const i = state.queue.findIndex((q) => q.threadId === state.thread.id);
  if (i < 0) return;
  flushing = true;
  try {
    const [q] = state.queue.splice(i, 1);
    renderQueue();
    await send({ text: q.text, harness: q.harness, model: q.model });
  } finally {
    flushing = false;
  }
}

/* ---------- プロンプト履歴 ---------- */
function loadHist() {
  try {
    const h = JSON.parse(localStorage.getItem('relay_hist') || '[]');
    return Array.isArray(h) ? h.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushHist(text) {
  const h = [text, ...loadHist().filter((x) => x !== text)].slice(0, 30);
  try {
    localStorage.setItem('relay_hist', JSON.stringify(h));
  } catch { /* 容量時は捨てる */ }
}

function sheetHistory() {
  const h = loadHist();
  openSheet(`
    <h3>プロンプト履歴</h3>
    ${h.length ? `<div class="hist">${h.map((t, i) => `<button data-i="${i}">${esc(t.split('\n')[0].slice(0, 60))}</button>`).join('')}</div>` : '<div class="empty"><p>まだありません</p></div>'}`);
  $('sheet').querySelectorAll('.hist button').forEach((b) => {
    b.onclick = () => {
      $('input').value = h[Number(b.dataset.i)];
      autogrow();
      saveDraft();
      closeSheet();
      setTimeout(() => $('input').focus(), 50);
    };
  });
}

/* ---------- 実行モード (実行/相談) ---------- */
function threadMode() {
  return state.thread?.mode === 'plan' ? 'plan' : 'act';
}

function renderModeSeg() {
  const m = threadMode();
  $('mode-act').classList.toggle('active', m === 'act');
  $('mode-plan').classList.toggle('active', m === 'plan');
  $('mode-hint').classList.toggle('hidden', m !== 'plan');
}

async function setMode(m) {
  if (!state.thread || threadMode() === m) return;
  if (activeJob()) {
    toast('実行中は切り替えられません', 'warn');
    return;
  }
  try {
    state.thread = await api(`/api/threads/${state.thread.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ mode: m }),
    });
    renderModeSeg();
  } catch (err) {
    toast(String(err.message || err), 'bad');
  }
}

/* ---------- @ファイル言及 ---------- */
async function refreshFiles(projectId) {
  if (state.filesProjectId === projectId) return;
  try {
    const data = await api(`/api/projects/${projectId}/files`);
    state.files = data.files || [];
    state.filesProjectId = projectId;
  } catch {
    state.files = [];
    state.filesProjectId = projectId;
  }
}

function checkMention() {
  const ta = $('input');
  const pop = $('mention-pop');
  const pos = ta.selectionStart ?? ta.value.length;
  const m = ta.value.slice(0, pos).match(/(^|\s)@([\w\-./]*)$/);
  if (!m || !state.files.length) {
    pop.classList.add('hidden');
    return;
  }
  const q = m[2].toLowerCase();
  const hits = state.files.filter((f) => f.toLowerCase().includes(q)).slice(0, 8);
  if (!hits.length) {
    pop.classList.add('hidden');
    return;
  }
  pop.innerHTML = '';
  for (const f of hits) {
    const b = document.createElement('button');
    b.textContent = f;
    // mousedown で先取り (blur より先に確定させる)
    b.onmousedown = (e) => {
      e.preventDefault();
      const before = ta.value.slice(0, pos).replace(/@[\w\-./]*$/, `@${f} `);
      ta.value = before + ta.value.slice(pos);
      const caret = before.length;
      ta.setSelectionRange(caret, caret);
      pop.classList.add('hidden');
      autogrow();
      saveDraft();
    };
    pop.appendChild(b);
  }
  pop.classList.remove('hidden');
  placeJump();
}

/* ---------- 音声入力 ---------- */
let recog = null;
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('btn-voice');
  if (!SR) {
    // iOS Safari 等: Web Speech API 非対応 → OS キーボードのマイクキーを使う
    btn.classList.add('hidden');
    $('voice-status').textContent = '音声はキーボードのマイクキーで入力できます';
    return;
  }
  btn.onclick = () => {
    if (recog) { recog.stop(); return; }
    recog = new SR();
    recog.lang = 'ja-JP';
    recog.interimResults = true;
    recog.maxAlternatives = 1;
    btn.classList.add('listening');
    $('voice-status').textContent = '聞き取り中… タップで停止';
    recog.onresult = (e) => {
      let text = '';
      for (const r of e.results) text += r[0].transcript;
      $('input').value = text;
      autogrow();
      saveDraft();
    };
    recog.onend = () => {
      recog = null;
      btn.classList.remove('listening');
      $('voice-status').textContent = '';
    };
    recog.onerror = (e) => {
      $('voice-status').textContent = e.error === 'not-allowed' ? 'マイクの許可が必要です' : `音声認識エラー: ${e.error}`;
      recog = null;
      btn.classList.remove('listening');
    };
    try {
      recog.start();
    } catch {
      recog = null;
      btn.classList.remove('listening');
    }
  };
}

/* ============ diff ============ */
let diffCache = null;

function paintDiffLine(l) {
  const cls = l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : '';
  return `<span class="${cls}">${esc(l) || ' '}</span>`;
}

function splitFiles(diffText) {
  const parts = diffText.split(/^diff --git /m).filter((s) => s.trim());
  return parts.map((p) => {
    const m = p.match(/^[ab]\/(\S+)\s+[ab]\/(\S+)/) || p.match(/^\S+\s+(\S+)/);
    let name = (m && (m[2] || m[1])) || p.split('\n')[0];
    name = name.replace(/^b\//, '');
    return { name, body: 'diff --git ' + p };
  });
}

async function openDiff() {
  if (!state.thread) return;
  const projectId = state.thread.projectId;
  $('diffview').classList.remove('hidden');
  $('diff-files').innerHTML = '<div class="empty"><p>読み込み中…</p></div>';
  try {
    diffCache = await api(`/api/projects/${projectId}/diff`);
    renderDiff();
  } catch (err) {
    $('diff-files').innerHTML = `<div class="empty"><p>${esc(String(err.message || err))}</p></div>`;
  }
  $('diff-rewind').classList.toggle('hidden', !latestCheckpointJob());
}

/* ---------- チェックポイント巻き戻し ---------- */
function latestCheckpointJob() {
  return [...state.jobs].reverse().find((j) => j.checkpoint && !j.rewound) || null;
}

async function doRewind() {
  const job = latestCheckpointJob();
  if (!job || activeJob()) return;
  const when = job.checkpoint.at ? relTime(job.checkpoint.at) : '';
  if (!confirm(`チェックポイント (${when}) に戻しますか？\n現在の変更は退避されます (あとで復旧可)`)) return;
  try {
    const r = await api(`/api/jobs/${job.id}/rewind`, { method: 'POST' });
    toast(r.stashed ? '巻き戻しました (変更は退避済み)' : '巻き戻しました');
    await resyncThread();
    await openDiff();
    refreshProjects();
  } catch (err) {
    toast(String(err.message || err), 'bad');
  }
}

function renderDiff() {
  const d = diffCache;
  const plus = (d.numstat || []).reduce((a, n) => a + n.added, 0);
  const minus = (d.numstat || []).reduce((a, n) => a + n.removed, 0);
  $('diff-stat').textContent = `+${plus} -${minus}`;
  const box = $('diff-files');
  box.innerHTML = '';
  const files = d.diff ? splitFiles(d.diff) : [];
  const statByPath = Object.fromEntries((d.numstat || []).map((n) => [n.path, n]));
  for (const f of files) {
    const st = statByPath[f.name];
    const det = document.createElement('div');
    det.className = 'dfile';
    det.innerHTML = `
      <button><span class="fname">${esc(f.name)}</span>
      <span class="pm">${st ? `<span class="p">+${st.added}</span> <span class="m">-${st.removed}</span>` : ''}</span></button>
      <pre class="hidden">${f.body.split('\n').map(paintDiffLine).join('\n')}</pre>`;
    const [btn, pre] = [det.querySelector('button'), det.querySelector('pre')];
    btn.onclick = () => pre.classList.toggle('hidden');
    box.appendChild(det);
  }
  for (const u of d.untracked || []) {
    const det = document.createElement('div');
    det.className = 'dfile';
    det.innerHTML = `<button><span class="fname">${esc(u)}</span><span class="new-tag">新規・未追跡</span></button>`;
    det.querySelector('button').onclick = () => toast('未追跡ファイルの内容表示は次版で対応');
    box.appendChild(det);
  }
  if (!files.length && !(d.untracked || []).length) {
    box.innerHTML = '<div class="empty"><p>変更なし</p></div>';
  }
  $('diff-body').innerHTML = d.diff ? d.diff.split('\n').map(paintDiffLine).join('\n') : '変更なし';
}

async function refreshDiffBadge() {
  if (!state.thread) return;
  try {
    const d = await api(`/api/projects/${state.thread.projectId}/diff`);
    const n = (d.numstat?.length || 0) + (d.untracked?.length || 0);
    const badge = $('diff-badge');
    badge.classList.toggle('hidden', n === 0);
    badge.textContent = n > 99 ? '99+' : n;
  } catch { /* noop */ }
}

/* ============ SSE ============ */
function setConn(mode) {
  for (const id of ['conn-dot', 'conn-dot-chat']) {
    const el = $(id);
    el.className = `conn ${mode === 'ok' ? '' : mode}`;
  }
}

function noteApproval(threadId, projectId, job) {
  state.pending.set(threadId, job.id);
  updateChatBadge();
  const labels = (job?.approval?.hits || []).map((h) => h.label).join(' / ') || '確認してください';
  toast(`承認が必要です: ${labels}`, 'warn');
  notify('Relay: 承認が必要です', labels);
  buzz([120, 60, 120]);
  void projectId;
}

function openSSE() {
  if (state.demo) return;
  if (state.es) state.es.close();
  setConn('reconnect');
  const es = new EventSource(`${state.base}/api/events?token=${encodeURIComponent(state.token)}`);
  state.es = es;
  es.onopen = () => setConn('ok');
  es.onerror = () => setConn('reconnect');
  const mine = (d) => state.thread && d.threadId === state.thread.id;

  es.addEventListener('message_append', (e) => {
    const d = JSON.parse(e.data);
    if (!mine(d)) return;
    setConn('ok');
    patchMessage(d.messageId, d.text, d.streaming);
    if (!d.streaming) resyncThread();
  });
  es.addEventListener('job_update', async (e) => {
    const d = JSON.parse(e.data);
    setConn('ok');
    if (d.job?.status === 'done' && mine(d)) {
      notify('Relay', '実行が完了しました');
      buzz([40, 40, 40]);
    }
    if (mine(d)) {
      const data = await api(`/api/threads/${state.thread.id}`).catch(() => null);
      if (data) {
        state.thread = data.thread;
        state.messages = data.messages;
        state.jobs = data.jobs;
        renderMessages();
        renderJobzone();
        renderApproval();
        renderModeSeg();
        renderSendBtn();
      }
      refreshDiffBadge();
      void flushQueue();
    }
  });
  es.addEventListener('thread_update', (e) => {
    const d = JSON.parse(e.data);
    if (state.project && d.projectId === state.project.id && !$('threads-pane').classList.contains('hidden')) {
      selectProject(d.projectId);
    }
  });
  es.addEventListener('approval_request', (e) => {
    const d = JSON.parse(e.data);
    noteApproval(d.threadId, d.projectId, d.job);
    if (mine(d)) resyncThread();
    if (state.project && d.projectId === state.project.id) selectProject(d.projectId);
  });
  const resolved = (e) => {
    const d = JSON.parse(e.data);
    state.pending.delete(d.job.threadId);
    updateChatBadge();
    if (mine(d)) resyncThread();
  };
  es.addEventListener('approval_resolved', resolved);
  es.addEventListener('diff_update', (e) => {
    const d = JSON.parse(e.data);
    if (state.thread && d.projectId === state.thread.projectId) refreshDiffBadge();
  });
}

/* ============ スクロール追従 ============ */
function placeJump() {
  const composer = $('composer');
  const approval = $('approval-slot');
  const offset = composer.offsetHeight + (approval.firstChild ? approval.firstChild.offsetHeight + 12 : 0) + 14;
  $('jump-latest').style.bottom = `${offset}px`;
}

/* ============ 配線 ============ */
function init() {
  $('connect-url').value = state.base === location.origin && location.protocol.startsWith('http') ? '' : state.base;
  if (!$('connect-url').value && location.protocol.startsWith('http')) $('connect-url').value = location.origin;
  $('connect-token').value = state.token;
  $('connect-go').onclick = connect;
  $('connect-demo').onclick = enterDemo;
  $('demo-exit').onclick = disconnect;
  $('connect-token').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  $('connect-peek').onclick = () => {
    const t = $('connect-token');
    t.type = t.type === 'password' ? 'text' : 'password';
  };
  $('btn-disconnect').onclick = disconnect;

  $('tabbtn-projects').onclick = () => switchTab('projects');
  $('tabbtn-chat').onclick = () => switchTab('chat');
  $('chat-empty-go').onclick = () => switchTab('projects');
  $('project-add').onclick = sheetNewProject;
  $('threads-back').onclick = () => {
    $('threads-pane').classList.add('hidden');
    $('projects-pane').classList.remove('hidden');
    refreshProjects();
  };
  $('thread-create').onclick = createThread;
  $('thread-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') createThread(); });

  $('chat-back').onclick = () => switchTab('projects');
  $('chat-title-btn').onclick = sheetRename;
  $('chat-diff').onclick = openDiff;
  $('diff-close').onclick = () => $('diffview').classList.add('hidden');
  $('diff-refresh').onclick = openDiff;
  $('seg-files').onclick = () => {
    $('seg-files').classList.add('active');
    $('seg-all').classList.remove('active');
    $('diff-files').classList.remove('hidden');
    $('diff-body').classList.add('hidden');
  };
  $('seg-all').onclick = () => {
    $('seg-all').classList.add('active');
    $('seg-files').classList.remove('active');
    $('diff-files').classList.add('hidden');
    $('diff-body').classList.remove('hidden');
  };

  $('scrim').onclick = closeSheet;
  $('btn-send').onclick = () => {
    if (sendMode() === 'stop') {
      const job = activeJob();
      if (job) jobAction(job.id, 'interrupt');
    } else {
      send();
    }
  };
  const ta = $('input');
  ta.addEventListener('input', () => { autogrow(); saveDraft(); checkMention(); });
  ta.addEventListener('click', checkMention);
  ta.addEventListener('blur', () => setTimeout(() => $('mention-pop').classList.add('hidden'), 150));
  ta.addEventListener('keydown', (e) => {
    // IME 確定の Enter (keyCode 229 / isComposing) では送信しない
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send(); // 実行中は待機列へ (停止はボタンの明示タップのみ)
    }
    if (e.key === 'Escape') $('mention-pop').classList.add('hidden');
  });
  $('mode-act').onclick = () => setMode('act');
  $('mode-plan').onclick = () => setMode('plan');
  $('btn-history').onclick = sheetHistory;
  $('queue-cancel').onclick = cancelQueue;
  $('diff-rewind').onclick = doRewind;
  $('model-toggle').onclick = () => $('model-row').classList.toggle('hidden');
  $('model-pick').addEventListener('input', () => {
    $('model-name').textContent = $('model-pick').value.trim() || '既定';
  });

  const box = $('messages');
  box.addEventListener('scroll', () => {
    state.follow = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    $('jump-latest').classList.toggle('hidden', state.follow);
  });
  $('jump-latest').onclick = () => {
    state.follow = true;
    box.scrollTop = box.scrollHeight;
    $('jump-latest').classList.add('hidden');
  };
  window.addEventListener('resize', placeJump);

  // 実行時間ティッカー
  setInterval(() => {
    document.querySelectorAll('[data-t0]').forEach((el) => {
      el.textContent = elapsed(Number(el.dataset.t0));
    });
  }, 1000);

  // キーボードでレイアウトが崩れないよう追従
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', placeJump);
  }

  setupVoice();
  placeJump();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // mac 版 (Electron): preload の接続情報で自動ログイン
  if (window.relayDesktop && !state.token && window.relayDesktop.token) {
    state.base = window.relayDesktop.base || state.base;
    state.token = window.relayDesktop.token;
    localStorage.setItem('relay_base', state.base);
    localStorage.setItem('relay_token', state.token);
  }

  if (state.token) {
    enterMain().catch(() => {
      $('view-main').classList.add('hidden');
      $('view-connect').classList.remove('hidden');
    });
  }
}

init();

// デスクトップ拡張 (public/desktop.js) 用フック。モバイル挙動への影響なし。
window.RelayHooks = { state, api, openThread, switchTab, refreshProjects, disconnect };
