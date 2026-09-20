// Tiny JSON file store. Synchronous writes, atomic via tmp+rename.
// Collections: projects, threads, messages (per thread), jobs, approvals.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function fileFor(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export function readCollection(name, fallback) {
  const f = fileFor(name);
  if (!fs.existsSync(f)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeCollection(name, data) {
  const f = fileFor(name);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

// --- entity helpers ---
export function listProjects() {
  return readCollection('projects', []);
}
export function getProject(id) {
  return listProjects().find((p) => p.id === id) || null;
}
export function saveProject(project) {
  const all = listProjects();
  const i = all.findIndex((p) => p.id === project.id);
  if (i >= 0) all[i] = project;
  else all.push(project);
  writeCollection('projects', all);
  return project;
}
export function removeProject(id) {
  writeCollection(
    'projects',
    listProjects().filter((p) => p.id !== id),
  );
}

export function listThreads(projectId) {
  return readCollection('threads', []).filter((t) => t.projectId === projectId);
}
export function getThread(id) {
  return readCollection('threads', []).find((t) => t.id === id) || null;
}
export function saveThread(thread) {
  const all = readCollection('threads', []);
  const i = all.findIndex((t) => t.id === thread.id);
  if (i >= 0) all[i] = thread;
  else all.push(thread);
  writeCollection('threads', all);
  return thread;
}
export function removeThread(id) {
  writeCollection(
    'threads',
    readCollection('threads', []).filter((t) => t.id !== id),
  );
  writeCollection(`messages_${id}`, []);
}

export function listMessages(threadId) {
  return readCollection(`messages_${threadId}`, []);
}
export function appendMessage(threadId, msg) {
  const all = listMessages(threadId);
  all.push(msg);
  writeCollection(`messages_${threadId}`, all);
  return msg;
}
export function updateMessage(threadId, msg) {
  const all = listMessages(threadId);
  const i = all.findIndex((m) => m.id === msg.id);
  if (i >= 0) all[i] = msg;
  else all.push(msg);
  writeCollection(`messages_${threadId}`, all);
  return msg;
}

export function getJob(id) {
  return readCollection('jobs', []).find((j) => j.id === id) || null;
}
export function listJobs(filter = {}) {
  return readCollection('jobs', []).filter((j) => {
    for (const [k, v] of Object.entries(filter)) if (j[k] !== v) return false;
    return true;
  });
}
export function saveJob(job) {
  const all = readCollection('jobs', []);
  const i = all.findIndex((j) => j.id === job.id);
  if (i >= 0) all[i] = job;
  else all.push(job);
  writeCollection('jobs', all);
  return job;
}

export function jobLogPath(jobId) {
  return path.join(DATA_DIR, `job_${jobId}.log`);
}
export function appendJobLog(jobId, line) {
  fs.appendFileSync(jobLogPath(jobId), line + '\n');
}
export function readJobLogTail(jobId, maxLines = 300) {
  const f = jobLogPath(jobId);
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-maxLines);
}
