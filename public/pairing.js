// ペアリング QR の読み取り結果を { url, token } に解釈する。
// 形式: Mac アプリのペアリング窓が出す JSON {"v":1,"app":"relay","url":...,"token":...}
//       または URL にトークンを付けた形 (https://host:8787/?token=...)
// ブラウザではクラシックスクリプト (window.RelayPairing)、テストでは vm で読み込む。
(function (root) {
  function checkUrl(raw) {
    let u;
    try {
      u = new URL(String(raw || '').trim());
    } catch {
      throw new Error('QR の URL が読み取れません');
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error('QR の URL が http(s) ではありません');
    return u;
  }

  function parsePairing(text) {
    const s = String(text || '').trim();
    if (!s) throw new Error('QR が空です');
    if (s.startsWith('{')) {
      let o;
      try {
        o = JSON.parse(s);
      } catch {
        throw new Error('Relay のペアリング QR ではありません');
      }
      if (o?.app !== 'relay') throw new Error('Relay のペアリング QR ではありません');
      if (o.v !== 1) throw new Error('この QR の形式には未対応です。アプリを更新してください');
      if (typeof o.token !== 'string' || !o.token.trim()) throw new Error('QR にトークンが含まれていません');
      return { url: checkUrl(o.url).origin, token: o.token.trim() };
    }
    const u = checkUrl(s);
    const token = u.searchParams.get('token');
    if (!token) throw new Error('QR にトークンが含まれていません');
    return { url: u.origin, token };
  }

  root.RelayPairing = { parsePairing };
})(globalThis);
