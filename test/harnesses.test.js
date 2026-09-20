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
    assert.deepEqual(argv.slice(0, 3), ['exec', 'resume', 'uuid-1']);
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
