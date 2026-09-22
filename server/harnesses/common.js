import { spawn } from 'node:child_process';

export function which(binary) {
  return new Promise((resolve) => {
    const child = spawn('command', ['-v', binary]);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    child.on('error', () => resolve(null));
  });
}

export function probe(cmd, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// Parse one stdout line. Non-JSON lines become { type: 'log' } (job log only, not chat text).
//
// Adapters normalize harness events into:
//   { type: 'skip' }                     — lifecycle/system noise (sessionId may still be set)
//   { type: 'delta', text }              — streaming fragment of the current answer
//   { type: 'message', text }            — a complete assistant message
//   { type: 'result', text, isError }    — final answer of the run
//   { type: 'tool', tool: {name, input} } — tool/command invocation (feeds the risk gate)
//   { type: 'log', text }                — diagnostics, kept out of the chat
export function genericParse(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return { type: 'log', text: line };
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { type: 'log', text: line };
  }
  return { type: 'json', raw: obj };
}

// Text blocks of an Anthropic-style message ({ content: [{type:'text', text}] }).
export function contentText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

export function contentToolUse(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return null;
  const block = content.find((b) => b && b.type === 'tool_use');
  return block ? { name: String(block.name || 'tool'), input: block.input ?? '' } : null;
}

export function pickSessionId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const candidates = [
    obj.session_id,
    obj.sessionId,
    obj.thread_id,
    obj.threadId,
    obj.conversation_id,
    obj.conversationId,
    obj.chatId,
    obj.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length >= 8 && c.length <= 128) return c;
  }
  if (obj.payload && typeof obj.payload === 'object') return pickSessionId(obj.payload);
  if (obj.event && typeof obj.event === 'object') return pickSessionId(obj.event);
  return null;
}
