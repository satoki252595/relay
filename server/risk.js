// Risk classifier. Decides whether a user instruction or a harness tool
// call needs explicit in-chat approval before (or while) running.
// Conservative by design: unknown-but-powerful operations escalate.

const PROMPT_RULES = [
  { id: 'rm-rf', re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, label: '再帰的・強制削除 (rm -rf)' },
  { id: 'rm-root', re: /\brm\b[^&|;]*\s\/(\s|$|;)/, label: 'ルート配下の削除' },
  { id: 'mkfs-dd', re: /\b(mkfs|dd\s+[^&|;]*of=|:?\(\)\s*\{.*\})/i, label: 'ディスク破壊系コマンド' },
  { id: 'sudo', re: /\bsudo\b/i, label: '管理者権限 (sudo)' },
  { id: 'chmod-root', re: /\bchmod\s+-R\b/i, label: '再帰的パーミッション変更' },
  { id: 'chown-root', re: /\bchown\s+-R\b/i, label: '再帰的所有者変更' },
  { id: 'git-force', re: /git\s+push\s+.*--force/i, label: 'force push' },
  { id: 'git-hard-reset', re: /git\s+reset\s+--hard/i, label: 'git reset --hard (未コミット破棄)' },
  { id: 'git-clean-fd', re: /git\s+clean\s+-[a-z]*f[a-z]*d/i, label: 'git clean -fd (未追跡削除)' },
  { id: 'drop-db', re: /\bdrop\s+(database|table|schema)\b/i, label: 'DB オブジェクト削除' },
  { id: 'delete-db', re: /\b(delete\s+from\s+\w+\s*(;|$)|truncate\s+table)\b/i, label: '全行削除系 SQL' },
  { id: 'deploy', re: /(デプロイ|本番反映|リリース対象|deploy|publish\s+--prod)/i, label: 'デプロイ・本番反映' },
  { id: 'secret-read', re: /\b(\.env|id_rsa|credentials\.json|secrets?\b.{0,20}(表示|出力|cat|送信|貼り付け)|API[ _-]?KEY.{0,20}(表示|出力|送信))/i, label: '秘密情報の読み出し・送信の疑い' },
  { id: 'curl-pipe-sh', re: /\bcurl\b[^|]*\|\s*(bash|sh)\b/i, label: '取得スクリプトの即時実行 (curl | sh)' },
  { id: 'wget-pipe-sh', re: /\bwget\b[^|]*\|\s*(bash|sh)\b/i, label: '取得スクリプトの即時実行 (wget | sh)' },
  { id: 'killall', re: /\b(killall|pkill|kill\s+-9\s+1)\b/i, label: 'プロセス大量終了' },
  { id: 'shutdown', re: /\b(shutdown|reboot|halt|poweroff)\b/i, label: 'ホスト停止・再起動' },
  { id: 'iptables', re: /\b(iptables|nft|firewall-cmd|ufw)\b/i, label: 'ファイアウォール変更' },
  { id: 'docker-prune', re: /\bdocker\s+(system\s+prune|volume\s+prune|rm\s+-f)/i, label: 'Docker リソース大量削除' },
];

const TOOL_RULES = [
  { id: 'bash-danger', re: /\b(rm\s+-[a-z]*r|mkfs|:\(\)\s*\{|shutdown|reboot|dd\s+.*of=|git\s+push\s+.*--force|git\s+reset\s+--hard|curl[^|]*\|\s*(bash|sh)|wget[^|]*\|\s*(bash|sh)|sudo\s)/i, label: '危険なシェル実行の検出' },
];

export function classifyPrompt(text = '') {
  const hits = [];
  for (const r of PROMPT_RULES) {
    if (r.re.test(text)) hits.push({ rule: r.id, label: r.label });
  }
  return { needsApproval: hits.length > 0, hits };
}

export function classifyToolCall(toolName = '', toolInput = '') {
  const hay = `${toolName} ${typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput)}`;
  const hits = [];
  for (const r of TOOL_RULES) {
    if (r.re.test(hay)) hits.push({ rule: r.id, label: r.label });
  }
  return { needsApproval: hits.length > 0, hits };
}
