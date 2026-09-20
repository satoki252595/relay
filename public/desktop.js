'use strict';
/* Relay デスクトップ拡張 — Electron (window.relayDesktop) でのみ動作。
 * 既存 app.js の DOM・API を流用し、サイドバー + 並列セッションタブ + ショートカットを足す。
 * モバイル (Capacitor/ブラウザ) では本ファイル自体が読み込まれない。 */
(function () {
  if (!window.relayDesktop || !window.RelayHooks) return;
  const { state, api, openThread, switchTab, refreshProjects } = window.RelayHooks;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const tabs = []; // { id, title, status: '' | 'run' | 'appr' }
  let activeId = null;
  let sse = null;

  function dtoast(msg) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function statusOf(jobs) {
    if ((jobs || []).some((j) => j.status === 'awaiting_approval')) return 'appr';
    if ((jobs || []).some((j) => j.status === 'running' || j.status === 'queued')) return 'run';
    return '';
  }

  /* ---------- タブ ---------- */
  function saveTabs() {
    try {
      localStorage.setItem('relay_dtabs', JSON.stringify(tabs.map((t) => t.id)));
    } catch { /* noop */ }
  }

  function renderTabs() {
    const bar = $('dtabbar');
    bar.querySelectorAll('.dtab').forEach((el) => el.remove());
    const addBtn = $('dtab-new');
    for (const t of tabs) {
      const el = document.createElement('button');
      el.className = `dtab${t.id === activeId ? ' active' : ''}`;
      el.innerHTML = `${t.status ? `<span class="dot ${t.status}"></span>` : ''}<span class="t">${esc(t.title)}</span><span class="x" role="button" aria-label="閉じる">×</span>`;
      el.onclick = () => activateTab(t.id);
      el.querySelector('.x').onclick = (e) => { e.stopPropagation(); closeTab(t.id); };
      el.title = t.title;
      bar.insertBefore(el, addBtn);
    }
    document.querySelectorAll('.dthread').forEach((el) => {
      el.classList.toggle('active', el.dataset.tid === activeId);
    });
  }

  async function activateTab(id) {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    activeId = id;
    try {
      await openThread(id, { silent: true });
      switchTab('chat');
    } catch {
      dtoast('スレッドを開けませんでした');
      closeTab(id);
      return;
    }
    renderTabs();
  }

  function closeTab(id) {
    const i = tabs.findIndex((x) => x.id === id);
    if (i < 0) return;
    tabs.splice(i, 1);
    saveTabs();
    if (activeId === id) {
      activeId = null;
      const next = tabs[Math.min(i, tabs.length - 1)];
      if (next) activateTab(next.id);
      else {
        $('chat-wrap').classList.add('hidden');
        $('chat-empty').classList.remove('hidden');
      }
    }
    renderTabs();
  }

  async function openTab(id) {
    if (tabs.some((t) => t.id === id)) return activateTab(id);
    try {
      const data = await api(`/api/threads/${id}`);
      tabs.push({ id, title: data.thread.title, status: statusOf(data.jobs) });
      if (tabs.length > 9) tabs.shift();
      saveTabs();
      await activateTab(id);
    } catch {
      dtoast('スレッドを開けませんでした');
    }
  }

  /* ---------- サイドバー ---------- */
  function sidebarThreadRow(t) {
    const b = document.createElement('button');
    b.className = 'dthread';
    b.dataset.tid = t.id;
    b.innerHTML = `<span class="t">${esc(t.title)}</span><span class="st"></span>`;
    b.onclick = () => openTab(t.id);
    return b;
  }

  async function renderSidebar() {
    const box = $('dprojects');
    box.innerHTML = '';
    let projects = [];
    try {
      await refreshProjects();
      projects = state.projects;
    } catch {
      box.innerHTML = '<div class="empty"><p>読込失敗</p></div>';
      return;
    }
    for (const p of projects) {
      const wrap = document.createElement('div');
      wrap.className = 'dprj';
      const head = document.createElement('div');
      head.className = 'dprj-head';
      head.innerHTML = `<svg><use href="#i-folder"/></svg><strong>${esc(p.name)}</strong>${p.dirty ? '<span class="dirty-dot" title="変更あり"></span>' : ''}<button class="newth" title="新規スレッド">+</button><span class="caret">▾</span>`;
      const list = document.createElement('div');
      list.className = 'dthreads';
      let loaded = false;
      head.querySelector('.newth').onclick = async (e) => {
        e.stopPropagation();
        try {
          const t = await api(`/api/projects/${p.id}/threads`, {
            method: 'POST',
            body: JSON.stringify({ title: '', harness: state.harness }),
          });
          loaded = false;
          head.click();
          openTab(t.id);
        } catch (err) {
          dtoast(String(err.message || err));
        }
      };
      head.onclick = async () => {
        const hidden = list.classList.toggle('hidden');
        head.querySelector('.caret').textContent = hidden ? '▸' : '▾';
        if (hidden || loaded) return;
        try {
          const threads = await api(`/api/projects/${p.id}/threads`);
          list.innerHTML = '';
          for (const t of threads) list.appendChild(sidebarThreadRow(t));
          document.querySelectorAll('.dthread').forEach((el) => {
            el.classList.toggle('active', el.dataset.tid === activeId);
          });
          loaded = true;
        } catch {
          list.innerHTML = '<div class="empty"><p>読込失敗</p></div>';
        }
      };
      wrap.appendChild(head);
      wrap.appendChild(list);
      box.appendChild(wrap);
    }
  }

  function markTab(id, status) {
    const t = tabs.find((x) => x.id === id);
    if (t && t.status !== status) {
      t.status = status;
      renderTabs();
    }
    document.querySelectorAll(`.dthread[data-tid="${CSS.escape(id)}"] .st`).forEach((el) => {
      el.className = `st ${status}`;
      el.textContent = status === 'appr' ? '要承認' : status === 'run' ? '実行中' : '';
    });
  }

  /* ---------- バッジ用 SSE (app.js の接続とは別に、后台タブの状態だけ追う) ---------- */
  function openBadgeSSE() {
    if (sse) sse.close();
    const url = `${state.base}/api/events?token=${encodeURIComponent(state.token)}`;
    sse = new EventSource(url);
    sse.addEventListener('job_update', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (!d.threadId || d.threadId === activeId) return;
        api(`/api/threads/${d.threadId}`).then(
          (data) => markTab(d.threadId, statusOf(data.jobs)),
          () => {},
        );
      } catch { /* noop */ }
    });
    sse.addEventListener('approval_request', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.threadId && d.threadId !== activeId) markTab(d.threadId, 'appr');
      } catch { /* noop */ }
    });
    const clear = (e) => {
      try {
        const d = JSON.parse(e.data);
        const tid = d.job?.threadId;
        if (tid && tid !== activeId) {
          api(`/api/threads/${tid}`).then(
            (data) => markTab(tid, statusOf(data.jobs)),
            () => {},
          );
        }
      } catch { /* noop */ }
    };
    sse.addEventListener('approval_resolved', clear);
    sse.addEventListener('message_append', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.threadId && d.threadId !== activeId && d.streaming) markTab(d.threadId, 'run');
      } catch { /* noop */ }
    });
  }

  /* ---------- ショートカット ---------- */
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    if (e.key >= '1' && e.key <= '9') {
      const t = tabs[Number(e.key) - 1];
      if (t) {
        e.preventDefault();
        activateTab(t.id);
      }
    } else if (e.key === 'w' || e.key === 'W') {
      if (activeId) {
        e.preventDefault();
        closeTab(activeId);
      }
    }
  });

  /* ---------- 組み立て ---------- */
  function build() {
    document.body.classList.add('desktop');
    const app = $('app');
    const side = document.createElement('div');
    side.id = 'dside';
    side.innerHTML = `<header><svg class="logo"><use href="#i-logo"/></svg>Relay<span id="conn-dot-d" class="conn" title="接続状態"></span></header><div id="dprojects"></div><footer><button id="dpair" class="btn dashed">iPhone と接続</button></footer>`;
    const main = document.createElement('div');
    main.id = 'dmain';
    main.innerHTML = `<div id="dtabbar"><button id="dtab-new" title="新規スレッド">+</button></div><div id="dcontent"></div>`;
    main.querySelector('#dcontent').appendChild($('view-main'));
    app.prepend(main);
    app.prepend(side);
    $('dpair').onclick = () => window.relayDesktop.openPairing();
    $('dtab-new').onclick = async () => {
      const pid = state.thread?.projectId || state.projects[0]?.id;
      if (!pid) {
        dtoast('プロジェクトがありません');
        return;
      }
      try {
        const t = await api(`/api/projects/${pid}/threads`, {
          method: 'POST',
          body: JSON.stringify({ title: '', harness: state.harness }),
        });
        openTab(t.id);
        renderSidebar();
      } catch (err) {
        dtoast(String(err.message || err));
      }
    };
    // 空表示をデスクトップ向けに
    const emptyP = $('chat-empty').querySelector('p');
    if (emptyP) emptyP.textContent = 'サイドバーからスレッドを開く';
    // 切断時はデスクトップ装飾を外して接続画面に戻す
    $('btn-disconnect').onclick = () => {
      if (sse) sse.close();
      document.body.classList.remove('desktop');
      $('dside').remove();
      const vm = $('view-main');
      $('app').appendChild(vm);
      $('dmain').remove();
      window.RelayHooks.disconnect();
    };
    switchTab('chat');
    openBadgeSSE();
    renderSidebar();
    // 保存タブを復元
    (async () => {
      let ids = [];
      try {
        ids = JSON.parse(localStorage.getItem('relay_dtabs') || '[]');
      } catch { /* noop */ }
      for (const id of ids.slice(0, 9)) {
        try {
          const data = await api(`/api/threads/${id}`);
          tabs.push({ id, title: data.thread.title, status: statusOf(data.jobs) });
        } catch { /* 削除済みは飛ばす */ }
      }
      const last = localStorage.getItem('relay_thread');
      if (last && tabs.some((t) => t.id === last)) await activateTab(last);
      else if (tabs.length) await activateTab(tabs[0].id);
      renderTabs();
    })();
  }

  // enterMain の完了 (view-main 表示) を待ってから組み立てる
  let waited = 0;
  const timer = setInterval(() => {
    waited += 100;
    if (!$('view-main').classList.contains('hidden')) {
      clearInterval(timer);
      build();
    } else if (waited > 30000) {
      clearInterval(timer);
    }
  }, 100);
})();
