// 外部サービス接続の状態: ホスト側 CLI の存在・認証を確認して返す。
// 追加サービスは CONNECTORS に足すだけ。
import { which, probe } from './harnesses/common.js';

export function parseGhAuthStatus(text) {
  const m = String(text || '').match(/Logged in to \S+ account (\S+)/);
  return m ? m[1] : null;
}

async function githubStatus() {
  const bin = await which('gh');
  if (!bin) {
    return {
      id: 'github', label: 'GitHub', installed: false, authenticated: false,
      user: null, setupHint: 'ホストに gh を導入し gh auth login を実行',
    };
  }
  const r = await probe('gh', ['auth', 'status'], 10000);
  const user = parseGhAuthStatus(`${r.stdout}\n${r.stderr}`);
  return {
    id: 'github', label: 'GitHub', installed: true,
    authenticated: r.code === 0 && !!user,
    user, setupHint: user ? null : 'ホストで gh auth login を実行',
  };
}

const CONNECTORS = [githubStatus];

export async function listConnections() {
  const out = [];
  for (const fn of CONNECTORS) {
    try {
      out.push(await fn());
    } catch (err) {
      out.push({ id: 'unknown', label: '不明', installed: false, error: String(err) });
    }
  }
  return out;
}
