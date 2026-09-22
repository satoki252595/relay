// Meta Muse: `muse exec --json`
import { probe, which, genericParse } from './common.js';

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
    if (!parsed || parsed.type === 'log') return parsed;
    const obj = parsed.raw;
    const sessionId = obj.stream?.kind === 'session' && typeof obj.stream.id === 'string' ? obj.stream.id : null;
    const pt = String(obj.payload_type || '');
    const p = obj.payload || {};
    if (pt === 'run.output.delta') return { type: 'delta', sessionId, text: String(p.text || '') };
    if (pt.startsWith('run.terminal.')) {
      return { type: 'result', sessionId, text: String(p.text || ''), isError: p.terminal !== 'completed' };
    }
    if (pt === 'tool.result') {
      // muse は実行前のコマンドを流さないため、結果に含まれる command で事後検出する
      let command = null;
      try {
        command = JSON.parse(p.text)?.command ?? null;
      } catch {}
      if (typeof command === 'string') return { type: 'tool', sessionId, tool: { name: 'bash', input: command } };
    }
    // task.lifecycle.* (ストリーム試行ステータス等)、turn.input.user (プロンプト反響) など
    return { type: 'skip', sessionId };
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
