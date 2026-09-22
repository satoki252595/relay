// 接続診断: URL → 到達性 → Relay サーバーか → トークン の順に切り分ける。
// ブラウザではクラシックスクリプト (window.RelayDiagnose)、テストでは vm で読み込む。
(function (root) {
  const TIMEOUT_MS = 8000;

  async function request(fetchImpl, url, init, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return { res: await fetchImpl(url, { ...init, signal: ctl.signal }) };
    } catch (err) {
      return { err, timedOut: ctl.signal.aborted };
    } finally {
      clearTimeout(timer);
    }
  }

  const REACH_HINTS = [
    'ホストで Relay サーバーが起動しているか (npm start または Mac アプリ)',
    'スマホとホストが同じ Tailscale ネットワーク (または同じ LAN) につながっているか',
    'URL のポート番号 (既定 8787) と http:// / https:// の違い',
    'iOS アプリから http:// で届くのは LAN の IP などローカル宛てのみ。MagicDNS 名は https:// (tailscale serve) を使う',
  ];

  // 戻り値: { ok, checks: [{ id, label, ok, detail }], hints: [] }
  async function diagnose({ base, token, fetchImpl, pageProtocol = '', timeoutMs = TIMEOUT_MS }) {
    const doFetch = fetchImpl || root.fetch.bind(root);
    const checks = [];
    const pass = (id, label, detail = '') => checks.push({ id, label, ok: true, detail });
    const fail = (id, label, detail, hints = []) => {
      checks.push({ id, label, ok: false, detail });
      return { ok: false, checks, hints };
    };

    let url;
    try {
      url = new URL(base);
      if (!/^https?:$/.test(url.protocol)) throw new Error('scheme');
    } catch {
      return fail('url', 'URL の形式', 'http:// または https:// で始まる URL を入力してください', [
        '例: https://homeserver.tailnet.ts.net / http://192.168.1.10:8787',
      ]);
    }
    if (pageProtocol === 'https:' && url.protocol === 'http:') {
      return fail('url', 'URL の形式', 'https のページから http:// のサーバーには接続できません', [
        'https:// の URL (tailscale serve 等) を使うか、アプリ版から接続してください',
      ]);
    }
    const origin = url.href.replace(/\/$/, '');
    pass('url', 'URL の形式');

    const health = await request(doFetch, `${origin}/api/health`, { method: 'GET' }, timeoutMs);
    if (!health.res) {
      return fail(
        'reach',
        'サーバーへの到達',
        health.timedOut ? `${Math.round(timeoutMs / 1000)}秒待っても応答がありません` : '接続できません',
        REACH_HINTS,
      );
    }
    pass('reach', 'サーバーへの到達');

    const body = await health.res.json().catch(() => null);
    if (!health.res.ok || !body || body.ok !== true) {
      return fail(
        'relay',
        'Relay サーバーの応答',
        `Relay 以外の応答です (HTTP ${health.res.status}${body ? '' : '、JSON ではない'})`,
        ['URL のホスト名・ポート番号が Relay サーバーを指しているか確認してください'],
      );
    }
    pass('relay', 'Relay サーバーの応答');

    if (!token) {
      return fail('token', 'トークン', '未入力です', ['ホストの data/.token の内容を貼り付けてください']);
    }
    const conn = await request(
      doFetch,
      `${origin}/api/connect`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) },
      timeoutMs,
    );
    if (!conn.res) return fail('token', 'トークン', '確認中に接続が切れました', REACH_HINTS);
    if (conn.res.status === 401) {
      return fail('token', 'トークン', '一致しません', [
        'ホストの data/.token の内容をそのまま貼り付けてください (前後の空白・改行に注意)',
        'data/ を消して再セットアップするとトークンが変わります',
      ]);
    }
    if (!conn.res.ok) {
      return fail('token', 'トークン', `サーバーエラー (HTTP ${conn.res.status})`, [
        'ホストのサーバーログを確認してください',
      ]);
    }
    pass('token', 'トークン');
    return { ok: true, checks, hints: [] };
  }

  root.RelayDiagnose = { diagnose };
})(globalThis);
