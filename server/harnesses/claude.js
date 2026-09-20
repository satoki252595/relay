// Anthropic Claude Code: `claude -p --output-format stream-json`
import { probe, which, genericParse, pickSessionId, extractText, extractToolUse } from './common.js';

export const claude = {
  id: 'claude',
  label: 'Claude Code',
  provider: 'Anthropic',
  binary: 'claude',

  build({ prompt, model, resumeSessionId, workdir }) {
    const argv = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (model) argv.push('--model', model);
    // Safe default: never bypass permissions from here. Approval gate lives in Relay.
    if (resumeSessionId) argv.push('--resume', resumeSessionId);
    return { cmd: 'claude', argv, cwd: workdir };
  },

  parseLine(line) {
    const parsed = genericParse(line);
    if (!parsed || parsed.type === 'log') return parsed ? { ...parsed, stream: 'stdout' } : null;
    const obj = parsed.raw;
    const sessionId = pickSessionId(obj);
    const tool = extractToolUse(obj);
    const texts = extractText(obj);
    const t = String(obj.type || '');
    if (t === 'result') {
      return {
        type: 'result',
        sessionId,
        text: typeof obj.result === 'string' ? obj.result : texts.join('\n'),
        isError: obj.is_error === true,
      };
    }
    return { type: 'event', sessionId, tool, texts, rawType: t || 'unknown' };
  },

  async status() {
    const bin = await which('claude');
    if (!bin) return { id: 'claude', installed: false };
    const v = await probe('claude', ['--version'], 10000);
    return {
      id: 'claude',
      installed: true,
      path: bin,
      version: (v.stdout || v.stderr || '').trim().split('\n')[0] || null,
      // Auth lives in the host CLI area (subscription login). Relay never touches keys.
      auth: 'host-managed',
    };
  },
};
