// OpenAI Codex: `codex exec --json` / `codex exec resume <id> <prompt>`
import { probe, which, genericParse } from './common.js';

export const codex = {
  id: 'codex',
  label: 'Codex',
  provider: 'OpenAI',
  binary: 'codex',

  build({ prompt, model, resumeSessionId, workdir }) {
    let argv;
    if (resumeSessionId) {
      argv = ['exec', 'resume', '--json', '--skip-git-repo-check', resumeSessionId, prompt];
    } else {
      argv = ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', prompt];
    }
    if (model) {
      // `codex exec -m` / resume also accepts -m; insert before prompt (last arg).
      argv.splice(argv.length - 1, 0, '-m', model);
    }
    return { cmd: 'codex', argv, cwd: workdir };
  },

  parseLine(line) {
    const parsed = genericParse(line);
    if (!parsed || parsed.type === 'log') return parsed;
    const obj = parsed.raw;
    const t = String(obj.type || '');
    const sessionId = t === 'thread.started' ? obj.thread_id || null : null;
    const item = obj.item && typeof obj.item === 'object' ? obj.item : null;
    if (t === 'item.started' && item?.type === 'command_execution') {
      return { type: 'tool', sessionId, tool: { name: 'shell', input: item.command ?? '' } };
    }
    if (t === 'item.completed' && item?.type === 'agent_message') {
      return { type: 'message', sessionId, text: String(item.text || '') };
    }
    if (t === 'turn.failed' || t === 'error') {
      const msg = obj.error?.message || obj.message || 'エラー';
      return { type: 'result', sessionId, text: `エラー: ${msg}`, isError: true };
    }
    // thread/turn の開始・完了、reasoning、コマンド出力など
    return { type: 'skip', sessionId };
  },

  async status() {
    const bin = await which('codex');
    if (!bin) return { id: 'codex', installed: false };
    const v = await probe('codex', ['--version'], 10000);
    return {
      id: 'codex',
      installed: true,
      path: bin,
      version: (v.stdout || v.stderr || '').trim().split('\n')[0] || null,
      auth: 'host-managed',
    };
  },
};
