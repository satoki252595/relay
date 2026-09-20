/* Relay mac 版の純粋ロジック (Electron 非依存・node:test で検証)。
 * main.js から import される。ここには electron も副作用も置かない。 */

/** os.networkInterfaces() の戻りから、ペアリング広告用の LAN IPv4 を1つ選ぶ。
 * 優先: 外部・IPv4・リンクローカル(169.254.x)除外の先頭。なければ null。 */
export function pickLanIPv4(interfaces) {
  const candidates = [];
  for (const addrs of Object.values(interfaces || {})) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      candidates.push(a.address);
    }
  }
  return candidates[0] || null;
}

/** QR に載せるペアリングペイロード。iPhone 側は url+token を読む。 */
export function pairingPayload({ lanUrl, token }) {
  if (!lanUrl || !token) throw new Error('lanUrl と token が必要です');
  return { v: 1, app: 'relay', url: lanUrl, token };
}

export function pairingText(payload) {
  return JSON.stringify(payload);
}

/** ログインシェルの PATH を Electron の希薄な PATH にマージする。
 * 公式 CLI (claude/codex/muse/cursor-agent) は /opt/homebrew/bin や
 * ~/.local/bin 等にいるため、spawn 前に必須。 */
export function mergePaths(electronPath, shellPath) {
  const seen = new Set();
  const out = [];
  for (const part of `${shellPath || ''}:${electronPath || ''}`.split(':')) {
    const p = part.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.join(':');
}

/** data/.token と同じファイルを読む (server/config.js の生成後に呼ぶ)。 */
export function readTokenFile(fs, dataDir) {
  const f = `${dataDir}/.token`;
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8').trim() || null;
}
