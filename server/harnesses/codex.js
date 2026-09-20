// OpenAI Codex: `codex exec --json` / `codex exec resume <id> <prompt>`
import { probe, which, genericParse, pickSessionId, extractText, extractToolUse } from './common.js';

export const codex = {
  id: 'codex',
  label: 'Codex',
  provider: 'OpenAI',
  binary: 'codex',

  build({ prompt, model, resumeSessionId, workdir }) {
    let argv;
    if (resumeSessionId) {
      argv = ['exec', 'resume', resumeSessionId, prompt];
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
    if (!parsed || parsed.type === 'log') return parsed ? { ...parsed, stream: 'stdout' } : null;
    const obj = parsed.raw;
    const sessionId = pickSessionId(obj);
    const tool = extractToolUse(obj);
    const texts = extractText(obj);
    const t = String(obj.type || obj.event || '');
    if (/item\.completed|turn\.completed|task\.complete|result/i.test(t)) {
      return { type: 'result', sessionId, text: texts.join('\n'), isError: false };
    }
    return { type: 'event', sessionId, tool, texts, rawType: t || 'unknown' };
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
