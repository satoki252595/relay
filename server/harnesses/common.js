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

// Best-effort extraction of text/tool/session info from one stdout line.
// Unknown shapes fall back to raw text so the UI still shows progress.
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

// Walk a parsed JSON event and extract human-readable text fragments.
export function extractText(obj, depth = 0) {
  if (obj == null || depth > 6) return [];
  if (typeof obj === 'string') return [];
  if (Array.isArray(obj)) return obj.flatMap((v) => extractText(v, depth + 1));
  if (typeof obj !== 'object') return [];
  const out = [];
  const t = obj.type || obj.event || obj.kind || '';
  const looksTextual =
    /message|text|output|result|response|delta|content|reasoning|thinking/i.test(String(t)) ||
    obj.role === 'assistant';
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^(text|content|message|output|result|response|delta|summary)$/i.test(k)) {
      if (v.trim()) out.push(v);
    } else if (k === 'content' && Array.isArray(v)) {
      for (const block of v) {
        if (block && typeof block === 'object' && typeof block.text === 'string' && block.text.trim()) {
          out.push(block.text);
        }
      }
    } else if (v && typeof v === 'object') {
      if (looksTextual || depth < 2) out.push(...extractText(v, depth + 1));
    }
  }
  return out;
}

export function extractToolUse(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const hit = extractToolUse(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const t = String(obj.type || obj.event || obj.kind || '');
  if (/tool[_-]?use|function[_-]?call|exec|command/i.test(t)) {
    const name = obj.name || obj.tool || obj.command || t;
    const input = obj.input ?? obj.arguments ?? obj.args ?? obj.command ?? '';
    return { name: String(name), input };
  }
  if (obj.content && Array.isArray(obj.content)) {
    for (const block of obj.content) {
      if (block && block.type === 'tool_use') {
        return { name: String(block.name || 'tool'), input: block.input ?? '' };
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const hit = extractToolUse(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}
