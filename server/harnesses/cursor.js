// Cursor Agent: `cursor-agent -p --output-format stream-json`
// NOTE: binary is `cursor-agent` (the bare `agent` name belongs to other tools).
import { probe, which, genericParse, pickSessionId, extractText, extractToolUse } from './common.js';

export const cursor = {
  id: 'cursor',
  label: 'Cursor Agent',
  provider: 'Cursor',
  binary: 'cursor-agent',

  build({ prompt, model, resumeSessionId, workdir }) {
    const argv = [
      '-p',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
    ];
    if (model) argv.push('--model', model);
    if (resumeSessionId) argv.push('--resume', resumeSessionId);
    // Safe default: no --force/--yolo. Approval gate lives in Relay.
    argv.push(prompt);
    return { cmd: 'cursor-agent', argv, cwd: workdir };
  },

  parseLine(line) {
    const parsed = genericParse(line);
    if (!parsed || parsed.type === 'log') return parsed ? { ...parsed, stream: 'stdout' } : null;
    const obj = parsed.raw;
    const sessionId = pickSessionId(obj);
    const tool = extractToolUse(obj);
    const texts = extractText(obj);
    const t = String(obj.type || obj.event || '');
    if (/result|complete|final/i.test(t)) {
      return { type: 'result', sessionId, text: texts.join('\n'), isError: false };
    }
    return { type: 'event', sessionId, tool, texts, rawType: t || 'unknown' };
  },

  async status() {
    const bin = await which('cursor-agent');
    if (!bin) return { id: 'cursor', installed: false };
    const v = await probe('cursor-agent', ['--version'], 10000);
    return {
      id: 'cursor',
      installed: true,
      path: bin,
      version: (v.stdout || v.stderr || '').trim().split('\n')[0] || null,
      auth: 'host-managed',
    };
  },
};
