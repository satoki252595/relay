import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HARNESSES, getHarness } from '../server/harnesses/index.js';

describe('harness adapters', () => {
  it('4ハーネスが登録されている', () => {
    assert.deepEqual(Object.keys(HARNESSES).sort(), ['claude', 'codex', 'cursor', 'muse']);
  });

  it('claude は -p stream-json で組み立てる', () => {
    const { cmd, argv } = HARNESSES.claude.build({ prompt: 'hi', workdir: '/tmp' });
    assert.equal(cmd, 'claude');
    assert.ok(argv.includes('-p') && argv.includes('stream-json'));
    assert.ok(!argv.includes('--dangerously-skip-permissions'));
  });

  it('claude resume は --resume を付ける', () => {
    const { argv } = HARNESSES.claude.build({ prompt: 'hi', resumeSessionId: 'sess1', workdir: '/tmp' });
    assert.ok(argv.includes('--resume') && argv.includes('sess1'));
  });

  it('codex は exec --json workspace-write が既定', () => {
    const { cmd, argv } = HARNESSES.codex.build({ prompt: 'hi', workdir: '/tmp' });
    assert.equal(cmd, 'codex');
    assert.ok(argv.includes('exec') && argv.includes('--json'));
    assert.ok(argv.includes('workspace-write'));
    assert.ok(!argv.includes('danger-full-access'));
  });

  it('codex resume は exec resume <id> を使う', () => {
    const { argv } = HARNESSES.codex.build({ prompt: 'next', resumeSessionId: 'uuid-1', workdir: '/tmp' });
    assert.deepEqual(argv.slice(0, 2), ['exec', 'resume']);
    assert.ok(argv.includes('--json') && argv.includes('uuid-1'));
    assert.equal(argv.at(-1), 'next');
  });

  it('muse は exec --json で組み立てる', () => {
    const { cmd, argv } = HARNESSES.muse.build({ prompt: 'hi', workdir: '/tmp' });
    assert.equal(cmd, 'muse');
    assert.ok(argv.includes('exec') && argv.includes('--json'));
  });

  it('cursor は cursor-agent -p stream-json で組み立てる', () => {
    const { cmd, argv } = HARNESSES.cursor.build({ prompt: 'hi', workdir: '/tmp' });
    assert.equal(cmd, 'cursor-agent');
    assert.ok(argv.includes('-p') && argv.includes('stream-json'));
    assert.ok(argv.includes('--trust'));
    assert.ok(!argv.includes('--force') && !argv.includes('--yolo'));
  });

  it('未知ハーネスは null', () => {
    assert.equal(getHarness('nope'), null);
  });

  it('claude stream-json の result を解釈できる', () => {
    const ev = HARNESSES.claude.parseLine(JSON.stringify({ type: 'result', result: 'done!', session_id: 'sess_abc123xyz' }));
    assert.equal(ev.type, 'result');
    assert.equal(ev.text, 'done!');
    assert.equal(ev.sessionId, 'sess_abc123xyz');
  });

  it('非JSON行は log として素通り', () => {
    const ev = HARNESSES.codex.parseLine('plain log line');
    assert.equal(ev.type, 'log');
  });
});

// 実ログ (data/job_*.log) から採取したイベント形でノイズ除去を確認する
describe('harness parseLine: ノイズ除去', () => {
  const j = (o) => JSON.stringify(o);

  it('claude: hook 応答 `{}`・system・user・rate_limit は skip、assistant は message', () => {
    const p = HARNESSES.claude.parseLine;
    const hook = p(j({ type: 'system', subtype: 'hook_response', output: '{}\n', stdout: '{}\n', session_id: 'sess-12345678' }));
    assert.equal(hook.type, 'skip');
    assert.equal(hook.sessionId, 'sess-12345678');
    assert.equal(p(j({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })).type, 'skip');
    assert.equal(p(j({ type: 'user', message: { content: [{ type: 'tool_result', content: 'secret output' }] } })).type, 'skip');
    const msg = p(j({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '1+1=2' }] } }));
    assert.deepEqual([msg.type, msg.text], ['message', '1+1=2']);
    const tool = p(j({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }));
    assert.equal(tool.type, 'tool');
    assert.equal(tool.tool.name, 'Bash');
  });

  it('cursor: プロンプト反響・thinking は skip、部分出力は delta、全文は message', () => {
    const p = HARNESSES.cursor.parseLine;
    assert.equal(p(j({ type: 'user', message: { content: [{ type: 'text', text: '【相談モード】…' }] } })).type, 'skip');
    assert.equal(p(j({ type: 'thinking', subtype: 'delta', text: '考え中' })).type, 'skip');
    const d = p(j({ type: 'assistant', message: { content: [{ type: 'text', text: 'です' }] }, timestamp_ms: 1 }));
    assert.deepEqual([d.type, d.text], ['delta', 'です']);
    const m = p(j({ type: 'assistant', message: { content: [{ type: 'text', text: '2です。' }] } }));
    assert.equal(m.type, 'message');
    const t = p(j({ type: 'tool_call', subtype: 'started', tool_call: { shellToolCall: { args: { command: 'rm -rf x' } } } }));
    assert.deepEqual(t.tool, { name: 'shell', input: { command: 'rm -rf x' } });
  });

  it('codex: agent_message のみ本文、reasoning は skip、コマンドは tool', () => {
    const p = HARNESSES.codex.parseLine;
    assert.equal(p(j({ type: 'thread.started', thread_id: 'th-0199aaaa' })).sessionId, 'th-0199aaaa');
    assert.equal(p(j({ type: 'item.completed', item: { type: 'reasoning', text: '思考' } })).type, 'skip');
    const m = p(j({ type: 'item.completed', item: { type: 'agent_message', text: '完了' } }));
    assert.deepEqual([m.type, m.text], ['message', '完了']);
    const t = p(j({ type: 'item.started', item: { type: 'command_execution', command: 'git push' } }));
    assert.deepEqual(t.tool, { name: 'shell', input: 'git push' });
    assert.equal(p(j({ type: 'turn.completed', usage: {} })).type, 'skip');
  });

  it('muse: ステータス・プロンプト反響は skip、delta/terminal を本文、tool.result からコマンド検出', () => {
    const p = HARNESSES.muse.parseLine;
    const rec = (payload_type, payload) => j({ stream: { kind: 'session', id: '01a0c95e-fcb2' }, payload_type, payload });
    assert.equal(p(rec('task.lifecycle.status', { event: { message: 'opening meta model stream attempt 1/10' } })).type, 'skip');
    assert.equal(p(rec('turn.input.user', { prompt: '【相談モード】…' })).type, 'skip');
    assert.equal(p(rec('runtime.command.accepted', { kind: 'command_accepted' })).type, 'skip');
    const d = p(rec('run.output.delta', { text: '2' }));
    assert.deepEqual([d.type, d.text, d.sessionId], ['delta', '2', '01a0c95e-fcb2']);
    const r = p(rec('run.terminal.completed', { terminal: 'completed', text: '2' }));
    assert.deepEqual([r.type, r.text, r.isError], ['result', '2', false]);
    const t = p(rec('tool.result', { text: j({ command: 'git push origin main', exit_code: 0 }) }));
    assert.deepEqual(t.tool, { name: 'bash', input: 'git push origin main' });
  });
});
