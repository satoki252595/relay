// Project filesystem + git operations. No shell: spawn with argv only.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PROJECTS_ROOT } from './config.js';

export function projectDir(project) {
  return path.join(PROJECTS_ROOT, project.slug);
}

function run(cmd, args, { cwd, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, timeout: timeoutMs });
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

export function slugify(name) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || `project-${Date.now()}`;
}

export async function createEmptyProjectDir(slug) {
  const dir = path.join(PROJECTS_ROOT, slug);
  if (fs.existsSync(dir)) throw new Error('同名のフォルダが既にあります');
  fs.mkdirSync(dir, { recursive: true });
  const init = await run('git', ['init', '-b', 'main'], { cwd: dir });
  if (init.code !== 0) throw new Error(`git init 失敗: ${init.stderr}`);
  return dir;
}

export async function cloneProjectDir(slug, url, branch) {
  const dir = path.join(PROJECTS_ROOT, slug);
  if (fs.existsSync(dir)) throw new Error('同名のフォルダが既にあります');
  const args = ['clone'];
  if (branch) args.push('--branch', branch);
  args.push(url, dir);
  const res = await run('git', args, { cwd: PROJECTS_ROOT, timeoutMs: 300000 });
  if (res.code !== 0) throw new Error(`git clone 失敗: ${res.stderr || res.stdout}`);
  return dir;
}

export async function gitStatus(dir) {
  let branch = await run('git', ['branch', '--show-current'], { cwd: dir });
  if (branch.code !== 0 || !branch.stdout.trim()) {
    branch = await run('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dir });
  }
  const status = await run('git', ['status', '--porcelain=v1', '--branch'], { cwd: dir });
  const log = await run('git', ['log', '--oneline', '-5'], { cwd: dir });
  return {
    branch: branch.code === 0 && branch.stdout.trim() ? branch.stdout.trim() : null,
    porcelain: status.code === 0 ? status.stdout : '',
    recent: log.code === 0 ? log.stdout.trim().split('\n').filter(Boolean) : [],
  };
}

async function hasHead(dir) {
  const res = await run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir });
  return res.code === 0;
}

export async function gitDiff(dir, { statOnly = false } = {}) {
  // コミット前の空リポジトリでは HEAD が存在しない。untracked のみ返す。
  if (!(await hasHead(dir))) {
    const untracked = await run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: dir });
    return {
      diff: '',
      truncated: false,
      untracked: untracked.code === 0 ? untracked.stdout.trim().split('\n').filter(Boolean) : [],
      error: null,
      noCommits: true,
    };
  }
  const args = statOnly
    ? ['diff', '--stat', 'HEAD']
    : ['diff', 'HEAD', '--no-color', '--find-renames'];
  const res = await run('git', args, { cwd: dir });
  const untracked = await run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: dir });
  return {
    diff: res.code === 0 ? res.stdout.slice(0, 200000) : '',
    truncated: res.stdout.length > 200000,
    untracked: untracked.code === 0 ? untracked.stdout.trim().split('\n').filter(Boolean) : [],
    error: res.code === 0 ? null : (res.stderr || 'diff 取得失敗'),
  };
}

export async function gitHead(dir) {
  const res = await run('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return res.code === 0 ? res.stdout.trim() : null;
}

/** @言及用ファイル一覧。tracked + untracked (除外標準)、件数上限つき。 */
export async function listFiles(dir, { limit = 2000 } = {}) {
  const res = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: dir });
  if (res.code === 0) {
    return res.stdout.trim().split('\n').filter(Boolean).slice(0, limit);
  }
  // 非 git (通常ありえないが): 浅い walk で代替
  const out = [];
  const skip = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build']);
  const walk = (base, prefix) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(path.join(base, e.name), rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, '');
  return out;
}

/** チェックポイント巻き戻し用: 現在の作業を退避して指定 HEAD に戻す。
 * 退避に失敗 (変更なし等) しても続行し、結果を返す。 */
export async function stashPush(dir, message) {
  const res = await run('git', ['stash', 'push', '-u', '-m', message], { cwd: dir });
  return { ok: res.code === 0, output: (res.stdout + res.stderr).trim().slice(0, 300) };
}

export async function resetHard(dir, ref) {
  const res = await run('git', ['reset', '--hard', ref], { cwd: dir });
  if (res.code !== 0) throw new Error(`reset 失敗: ${(res.stderr || res.stdout).trim().slice(0, 200)}`);
  return true;
}

export async function gitDiffNumstat(dir) {
  const res = await run('git', ['diff', '--numstat', 'HEAD'], { cwd: dir });
  if (res.code !== 0) return [];
  return res.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...rest] = line.split('\t');
      return { added: Number(added) || 0, removed: Number(removed) || 0, path: rest.join('\t') };
    });
}
