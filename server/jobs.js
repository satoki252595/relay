// Job engine: spawns official harness CLIs on the host, streams their
// output into thread messages, enforces the in-chat approval gate, and
// keeps running when the browser disconnects.
import { spawn } from 'node:child_process';
import {
  uid,
  getJob,
  saveJob,
  listJobs,
  appendJobLog,
  readJobLogTail,
  getThread,
  saveThread,
  listMessages,
  appendMessage,
  updateMessage,
  getProject,
} from './store.js';
import { getHarness } from './harnesses/index.js';
import { classifyPrompt, classifyToolCall } from './risk.js';
import { gitDiff, gitDiffNumstat, projectDir } from './git.js';
import { emit } from './events.js';

const running = new Map(); // jobId -> child process

function threadContext(threadId, maxChars = 4000) {
  const msgs = listMessages(threadId).filter((m) => m.role !== 'system');
  let budget = maxChars;
  const picked = [];
  for (let i = msgs.length - 1; i >= 0 && budget > 0; i--) {
    const text = String(msgs[i].text || '').slice(0, 2000);
    picked.unshift(`${msgs[i].role === 'user' ? '指示' : msgs[i].harness || '-agent'}: ${text}`);
    budget -= text.length;
  }
  if (!picked.length) return '';
  return `これまでの流れ(要約用コンテキスト):\n${picked.join('\n---\n')}\n\n`;
}

function lastHarnessSession(threadId, harnessId) {
  const jobs = listJobs({ threadId }).filter((j) => j.harness === harnessId && j.harnessSessionId);
  return jobs.length ? jobs[jobs.length - 1].harnessSessionId : null;
}

export function createJob({ threadId, projectId, prompt, harness, model }) {
  const thread = getThread(threadId);
  if (!thread) throw new Error('スレッドが見つかりません');
  const adapter = getHarness(harness);
  if (!adapter) throw new Error(`未知のハーネス: ${harness}`);

  const userMsg = appendMessage(threadId, {
    id: uid('msg'),
    role: 'user',
    text: prompt,
    harness,
    model: model || null,
    at: Date.now(),
  });

  const risk = classifyPrompt(prompt);
  const job = saveJob({
    id: uid('job'),
    threadId,
    projectId,
    harness,
    model: model || null,
    prompt,
    userMessageId: userMsg.id,
    status: risk.needsApproval ? 'awaiting_approval' : 'queued',
    approval: risk.needsApproval
      ? { reason: 'prompt', hits: risk.hits, requestedAt: Date.now(), resolvedAt: null, decision: null }
      : null,
    harnessSessionId: null,
    assistantMessageId: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    endedAt: null,
  });

  thread.updatedAt = Date.now();
  thread.lastHarness = harness;
  saveThread(thread);

  emit('thread_update', { threadId, projectId });
  if (job.status === 'awaiting_approval') {
    emit('approval_request', { job, threadId, projectId });
    emit('job_update', { job });
  } else {
    startJob(job.id).catch((err) => failJob(job.id, String(err)));
  }
  return job;
}

async function failJob(jobId, error) {
  const job = getJob(jobId);
  if (!job) return;
  job.status = 'error';
  job.error = error;
  job.updatedAt = Date.now();
  job.endedAt = Date.now();
  saveJob(job);
  emit('job_update', { job });
}

export async function startJob(jobId, { resumed = false } = {}) {
  const job = getJob(jobId);
  if (!job) throw new Error('ジョブが見つかりません');
  if (running.has(jobId)) return job;
  const project = getProject(job.projectId);
  if (!project) throw new Error('プロジェクトが見つかりません');
  const adapter = getHarness(job.harness);
  if (!adapter) throw new Error(`未知のハーネス: ${job.harness}`);

  const dir = projectDir(project);
  const resumeSessionId = job.harnessSessionId || lastHarnessSession(job.threadId, job.harness);

  let prompt = job.prompt;
  if (resumed) {
    prompt = `前回の作業の続きです。中断前の状態を確認して続けてください。\n\n${threadContext(job.threadId)}\n今回の指示: ${job.prompt}`;
  } else if (!resumeSessionId) {
    const ctx = threadContext(job.threadId);
    if (ctx) prompt = `${ctx}今回の指示: ${job.prompt}`;
  }

  const { cmd, argv, cwd } = adapter.build({
    prompt,
    model: job.model,
    resumeSessionId,
    workdir: dir,
  });

  let assistantMsg = job.assistantMessageId
    ? listMessages(job.threadId).find((m) => m.id === job.assistantMessageId)
    : null;
  if (!assistantMsg) {
    assistantMsg = appendMessage(job.threadId, {
      id: uid('msg'),
      role: 'assistant',
      harness: job.harness,
      model: job.model,
      text: '',
      jobId: job.id,
      at: Date.now(),
      streaming: true,
    });
    job.assistantMessageId = assistantMsg.id;
  } else {
    assistantMsg.streaming = true;
    assistantMsg.text = resumed ? `${assistantMsg.text}\n\n(再開…)\n` : assistantMsg.text;
    updateMessage(job.threadId, assistantMsg);
  }

  job.status = 'running';
  job.error = null;
  job.updatedAt = Date.now();
  saveJob(job);
  emit('job_update', { job });

  const child = spawn(cmd, argv, { cwd: cwd || dir });
  running.set(jobId, child);
  appendJobLog(jobId, `$ ${cmd} ${argv.map((a) => (a.length > 120 ? a.slice(0, 120) + '…' : a)).join(' ')}`);

  let buffer = '';
  let assistantText = assistantMsg.text || '';
  let lastFlush = 0;

  const flush = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlush < 800) return;
    lastFlush = now;
    assistantMsg.text = assistantText;
    updateMessage(job.threadId, assistantMsg);
    emit('message_append', {
      threadId: job.threadId,
      messageId: assistantMsg.id,
      text: assistantText,
      streaming: true,
    });
  };

  const onLine = (line, stream) => {
    appendJobLog(jobId, `[${stream}] ${line}`);
    let event = null;
    try {
      event = stream === 'stdout' ? adapter.parseLine(line) : { type: 'log', text: line, stream };
    } catch {
      event = { type: 'log', text: line, stream };
    }
    if (!event) return;
    const current = getJob(jobId);
    if (event.sessionId && current && !current.harnessSessionId) {
      current.harnessSessionId = event.sessionId;
      saveJob(current);
      job.harnessSessionId = event.sessionId;
    }
    // Mid-run dangerous tool detection → freeze and escalate to chat approval.
    if (event.tool) {
      const verdict = classifyToolCall(event.tool.name, event.tool.input);
      if (verdict.needsApproval) {
        const snapshot = `tool=${event.tool.name} input=${JSON.stringify(event.tool.input).slice(0, 500)}`;
        appendJobLog(jobId, `[guard] dangerous tool detected: ${snapshot}`);
        escalateMidRun(jobId, verdict.hits, snapshot).catch(() => {});
        return;
      }
      assistantText += `\n> 実行: \`${event.tool.name}\`\n`;
      flush();
      return;
    }
    const texts =
      event.type === 'result'
        ? [event.text || '']
        : event.texts || (event.text ? [event.text] : []);
    const chunk = texts.filter(Boolean).join('\n');
    if (chunk) {
      assistantText += (assistantText && !assistantText.endsWith('\n') ? '\n' : '') + chunk + '\n';
      flush();
    }
    if (event.type === 'result' && event.isError) {
      appendJobLog(jobId, '[harness] result reported error');
    }
  };

  const feed = (stream) => (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) onLine(line, stream);
    }
  };
  child.stdout.on('data', feed('stdout'));
  child.stderr.on('data', feed('stderr'));

  child.on('close', async (code) => {
    running.delete(jobId);
    if (buffer.trim()) onLine(buffer.trim(), 'stdout');
    const current = getJob(jobId);
    if (!current) return;
    // escalateMidRun / interruptJob may have already re-stated the job.
    if (current.status !== 'running') {
      flush(true);
      return;
    }
    current.status = code === 0 ? 'done' : 'error';
    if (code !== 0 && !current.error) current.error = `終了コード ${code}`;
    current.updatedAt = Date.now();
    current.endedAt = Date.now();
    saveJob(current);

    assistantMsg.text = assistantText || '(出力なし)';
    assistantMsg.streaming = false;
    updateMessage(job.threadId, assistantMsg);
    emit('message_append', {
      threadId: job.threadId,
      messageId: assistantMsg.id,
      text: assistantMsg.text,
      streaming: false,
    });
    emit('job_update', { job: current });
    await publishDiff(job.projectId);
  });

  child.on('error', async (err) => {
    running.delete(jobId);
    await failJob(jobId, `起動失敗: ${err.message} (ホストで ${cmd} に login 済みか確認)`);
    assistantMsg.text = assistantText || `起動できませんでした: ${err.message}`;
    assistantMsg.streaming = false;
    updateMessage(job.threadId, assistantMsg);
    emit('message_append', {
      threadId: job.threadId,
      messageId: assistantMsg.id,
      text: assistantMsg.text,
      streaming: false,
    });
  });

  return job;
}

async function escalateMidRun(jobId, hits, evidence) {
  const job = getJob(jobId);
  if (!job || job.status !== 'running') return;
  interruptChild(jobId);
  job.status = 'awaiting_approval';
  job.approval = {
    reason: 'mid_run_tool',
    hits,
    evidence,
    requestedAt: Date.now(),
    resolvedAt: null,
    decision: null,
  };
  job.updatedAt = Date.now();
  saveJob(job);
  const msg = listMessages(job.threadId).find((m) => m.id === job.assistantMessageId);
  if (msg) {
    msg.text = `${msg.text}\n\n一時停止: 危険な操作を検出したため承認待ちです。\n`;
    msg.streaming = false;
    updateMessage(job.threadId, msg);
  }
  emit('job_update', { job });
  emit('approval_request', { job, threadId: job.threadId, projectId: job.projectId });
}

function interruptChild(jobId) {
  const child = running.get(jobId);
  if (!child) return false;
  try {
    child.kill('SIGINT');
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, 5000).unref?.();
  } catch {
    return false;
  }
  running.delete(jobId);
  return true;
}

export async function interruptJob(jobId) {
  const job = getJob(jobId);
  if (!job) throw new Error('ジョブが見つかりません');
  if (job.status !== 'running') return job;
  interruptChild(jobId);
  appendJobLog(jobId, '[relay] interrupted by user');
  job.status = 'interrupted';
  job.updatedAt = Date.now();
  job.endedAt = Date.now();
  saveJob(job);
  const msg = listMessages(job.threadId).find((m) => m.id === job.assistantMessageId);
  if (msg) {
    msg.streaming = false;
    msg.text = `${msg.text}\n\n(中断しました。「再開」で続けられます)\n`;
    updateMessage(job.threadId, msg);
    emit('message_append', {
      threadId: job.threadId,
      messageId: msg.id,
      text: msg.text,
      streaming: false,
    });
  }
  emit('job_update', { job });
  await publishDiff(job.projectId);
  return job;
}

export async function resumeJob(jobId) {
  const job = getJob(jobId);
  if (!job) throw new Error('ジョブが見つかりません');
  if (!['interrupted', 'error', 'done'].includes(job.status)) return job;
  job.status = 'queued';
  job.error = null;
  job.updatedAt = Date.now();
  saveJob(job);
  emit('job_update', { job });
  return startJob(jobId, { resumed: true });
}

export async function approveJob(jobId) {
  const job = getJob(jobId);
  if (!job) throw new Error('ジョブが見つかりません');
  if (job.status !== 'awaiting_approval') return job;
  job.approval = { ...(job.approval || {}), resolvedAt: Date.now(), decision: 'approved' };
  job.status = 'queued';
  job.updatedAt = Date.now();
  saveJob(job);
  appendJobLog(jobId, '[relay] approved by user');
  emit('approval_resolved', { job, decision: 'approved' });
  emit('job_update', { job });
  return startJob(jobId, { resumed: job.approval?.reason === 'mid_run_tool' });
}

export async function denyJob(jobId) {
  const job = getJob(jobId);
  if (!job) throw new Error('ジョブが見つかりません');
  if (job.status !== 'awaiting_approval') return job;
  job.approval = { ...(job.approval || {}), resolvedAt: Date.now(), decision: 'denied' };
  job.status = 'denied';
  job.updatedAt = Date.now();
  job.endedAt = Date.now();
  saveJob(job);
  appendJobLog(jobId, '[relay] denied by user');
  const msg = listMessages(job.threadId).find((m) => m.id === job.assistantMessageId);
  if (msg) {
    msg.streaming = false;
    msg.text = `${msg.text}\n\n(拒否されました)\n`;
    updateMessage(job.threadId, msg);
  } else {
    appendMessage(job.threadId, {
      id: uid('msg'),
      role: 'assistant',
      harness: job.harness,
      text: '承認が拒否されたため実行しませんでした。',
      jobId: job.id,
      at: Date.now(),
    });
  }
  emit('approval_resolved', { job, decision: 'denied' });
  emit('job_update', { job });
  emit('thread_update', { threadId: job.threadId, projectId: job.projectId });
  return job;
}

export async function publishDiff(projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  try {
    const dir = projectDir(project);
    const [diff, numstat] = await Promise.all([
      gitDiff(dir),
      gitDiffNumstat(dir),
    ]);
    const payload = { projectId, diff: diff.diff, untracked: diff.untracked, numstat };
    emit('diff_update', payload);
    return payload;
  } catch (err) {
    return { projectId, error: String(err) };
  }
}

export function isRunning(jobId) {
  return running.has(jobId);
}

export function jobWithLog(jobId) {
  const job = getJob(jobId);
  if (!job) return null;
  return { ...job, logTail: readJobLogTail(jobId) };
}

// On boot: jobs left `running`/`queued` by a dead daemon are marked
// interrupted so the UI can resume them. The child is gone; state is honest.
export function reconcileOnBoot() {
  const orphans = listJobs().filter((j) => ['running', 'queued'].includes(j.status));
  for (const job of orphans) {
    job.status = 'interrupted';
    job.error = 'ホスト再起動のため中断 (再開できます)';
    job.updatedAt = Date.now();
    job.endedAt = Date.now();
    saveJob(job);
  }
  return orphans.length;
}
