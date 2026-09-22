// Cursor Agent: `cursor-agent -p --output-format stream-json`
// NOTE: binary is `cursor-agent` (the bare `agent` name belongs to other tools).
import { probe, which, genericParse, pickSessionId, contentText } from './common.js';

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
    // --trust はディレクトリ信頼の宣言のみ (非対話実行に必須)。
    // 危険操作の承認は引き続き Relay 側ゲートが行う。--yolo/-f は付けない。
    argv.push('--trust');
    argv.push(prompt);
    return { cmd: 'cursor-agent', argv, cwd: workdir };
  },

  parseLine(line) {
    const parsed = genericParse(line);
    if (!parsed || parsed.type === 'log') return parsed;
    const obj = parsed.raw;
    const sessionId = pickSessionId(obj);
    const t = String(obj.type || '');
    if (t === 'result') {
      return {
        type: 'result',
        sessionId,
        text: typeof obj.result === 'string' ? obj.result : '',
        isError: obj.is_error === true,
      };
    }
    if (t === 'assistant') {
      // --stream-partial-output: 断片は timestamp_ms 付き、最後に全文が timestamp_ms なしで届く
      const text = contentText(obj.message);
      return { type: obj.timestamp_ms != null ? 'delta' : 'message', sessionId, text };
    }
    if (t === 'tool_call' && obj.subtype === 'started' && obj.tool_call && typeof obj.tool_call === 'object') {
      const [key, call] = Object.entries(obj.tool_call)[0] || [];
      if (key) {
        return {
          type: 'tool',
          sessionId,
          tool: { name: key.replace(/ToolCall$/, ''), input: call?.args ?? '' },
        };
      }
    }
    // system/init、user (プロンプト反響)、thinking、tool_call completed など
    return { type: 'skip', sessionId };
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
