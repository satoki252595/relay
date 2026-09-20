// Meta Muse: `muse exec --json`
import { probe, which, genericParse, pickSessionId, extractText, extractToolUse } from './common.js';

export const muse = {
  id: 'muse',
  label: 'Muse',
  provider: 'Meta',
  binary: 'muse',

  build({ prompt, model, resumeSessionId, workdir }) {
    const argv = ['exec', '--json'];
    if (model) argv.push('--model', model);
    let finalPrompt = prompt;
    if (resumeSessionId) {
      // `muse exec` has no documented --resume; carry the session ref in-context.
      finalPrompt = `[前セッション参照: ${resumeSessionId} の続き]\n${prompt}`;
    }
    argv.push(finalPrompt);
    return { cmd: 'muse', argv, cwd: workdir };
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
    const bin = await which('muse');
    if (!bin) return { id: 'muse', installed: false };
    const v = await probe('muse', ['--version'], 10000);
    return {
      id: 'muse',
      installed: true,
      path: bin,
      version: (v.stdout || v.stderr || '').trim().split('\n')[0] || null,
      auth: 'host-managed',
    };
  },
};
