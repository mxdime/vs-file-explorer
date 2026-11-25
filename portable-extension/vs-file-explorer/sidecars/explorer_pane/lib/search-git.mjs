/**
 * Git engine (porcelain v1/v2 status, diff, serialized write queue, branches, stash, remotes)
 * and fast workspace file-content search.
 */
import { execFile } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, posix } from 'node:path';
import { promisify } from 'node:util';
import { PathGuardError, resolveInsideWorkspace, uriToLocalPath } from './workspace-guard.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 5000;
const DEFAULT_DIFF_MAX_BYTES = 150 * 1024;
const DEFAULT_DIFF_MAX_LINES = 1500;
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.temp', 'dist', 'build', '.next', '.cache', '__pycache__']);
const IGNORED_REPO_SCAN_DIRS = new Set([
  '.git', 'node_modules', '.temp', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv',
]);
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip',
  '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.woff', '.woff2', '.ttf', '.eot',
]);
const STATUS_PRIORITY = { M: 5, A: 4, D: 3, R: 2, U: 1 };
const BRANCH_NAME_RE = /^[a-zA-Z0-9._/-]+$/;
const REMOTE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const STASH_REF_RE = /^stash@\{\d+\}$/;

const repoQueues = new Map();

/** Serializes mutating Git operations per repository to avoid .git/index.lock races. */
export function enqueueGitOp(rootInput, fn) {
  const localRoot = uriToLocalPath(rootInput);
  if (!localRoot) return Promise.reject(new PathGuardError('Workspace root is invalid', 'INVALID_WORKSPACE', 400));
  const rootReal = realpathSync(localRoot);
  const key = process.platform === 'win32' ? rootReal.toLowerCase() : rootReal;
  const prev = repoQueues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => fn(rootReal));
  const tail = next.catch(() => {});
  repoQueues.set(key, tail);
  tail.finally(() => {
    if (repoQueues.get(key) === tail) repoQueues.delete(key);
  });
  return next;
}

function resolveGitRoot(rootInput) {
  const localRoot = uriToLocalPath(rootInput);
  if (!localRoot) throw new PathGuardError('Workspace root is invalid', 'INVALID_WORKSPACE', 400);
  return realpathSync(localRoot);
}

/** Resolves an optional sub-repository relative path strictly inside the active workspace root. */
export function resolveGitRepoRoot(rootInput, repoRelPath = '') {
  const cleanInput = typeof repoRelPath === 'string' ? repoRelPath.trim() : '';
  const { rootReal, targetPath, relPath } = resolveInsideWorkspace(rootInput, cleanInput, { allowRoot: true });
  let st;
  try { st = statSync(targetPath); } catch { st = null; }
  if (!st || !st.isDirectory()) {
    throw new PathGuardError(`Git repository directory not found: ${cleanInput}`, 'ENOTDIR', 400);
  }
  return { workspaceRoot: rootReal, repoRoot: targetPath, repoRel: relPath };
}

/** Discovers Git repositories (root and nested sub-repos/submodules) inside the workspace. */
export async function discoverGitRepos(rootInput, { maxDepth = 3, maxRepos = 20, timeoutMs = 2500 } = {}) {
  const rootReal = resolveGitRoot(rootInput);
  const candidates = [];
  const queue = [{ dirPath: rootReal, relPath: '', depth: 0 }];

  while (queue.length > 0 && candidates.length < maxRepos) {
    const { dirPath, relPath, depth } = queue.shift();
    if (existsSync(join(dirPath, '.git'))) {
      candidates.push({
        relPath,
        name: relPath ? basename(relPath) : basename(rootReal) || rootReal,
        path: dirPath,
        isRoot: relPath === '',
      });
      if (candidates.length >= maxRepos) break;
    }
    if (depth >= maxDepth) continue;
    let dirents;
    try { dirents = readdirSync(dirPath, { withFileTypes: true }); } catch { continue; }
    dirents.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const d of dirents) {
      if (!d.isDirectory() || IGNORED_REPO_SCAN_DIRS.has(d.name)) continue;
      queue.push({
        dirPath: join(dirPath, d.name),
        relPath: relPath ? posix.join(relPath, d.name) : d.name,
        depth: depth + 1,
      });
    }
  }

  const repos = await Promise.all(candidates.map(async (item) => {
    try {
      const { stdout } = await runGit(item.path, ['status', '--porcelain=v2', '--branch', '-uall'], { timeoutMs });
      const parsed = parseGitPorcelain(stdout);
      return {
        ...item,
        branch: parsed.branch,
        oid: parsed.oid,
        ahead: parsed.ahead,
        behind: parsed.behind,
        stagedCount: parsed.stagedCount,
        unstagedCount: parsed.unstagedCount,
        untrackedCount: parsed.untrackedCount,
        totalChanges: parsed.entries.length,
      };
    } catch {
      return {
        ...item,
        branch: '',
        oid: '',
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        totalChanges: 0,
      };
    }
  }));

  repos.sort((a, b) => {
    if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
    return a.relPath.localeCompare(b.relPath, undefined, { sensitivity: 'base' });
  });
  const totalChanges = repos.reduce((sum, r) => sum + r.totalChanges, 0);
  return { root: rootReal, repos, totalChanges };
}

async function runGit(rootReal, args, { timeoutMs = DEFAULT_GIT_TIMEOUT_MS, maxBuffer = 8 * 1024 * 1024 } = {}) {
  try {
    return await execFileAsync(
      'git',
      ['-c', 'core.quotepath=false', '-C', rootReal, ...args],
      { timeout: timeoutMs, maxBuffer, windowsHide: true },
    );
  } catch (err) {
    const msg = (err?.stderr || err?.stdout || err?.message || 'Git command failed').trim();
    if (/not a git repository/i.test(msg)) {
      throw new PathGuardError(msg, 'NOT_GIT_REPO', 400);
    }
    if (/local changes.*would be overwritten|please commit your changes or stash them/i.test(msg)) {
      throw new PathGuardError(msg, 'DIRTY_WORKTREE', 409);
    }
    if (/CONFLICT|Merge conflict/i.test(msg)) {
      throw new PathGuardError(msg, 'GIT_CONFLICT', 409);
    }
    if (/non-fast-forward|Not possible to fast-forward/i.test(msg)) {
      throw new PathGuardError(msg, 'GIT_NON_FF', 409);
    }
    throw new PathGuardError(msg, 'GIT_ERROR', 400);
  }
}

function mapPorcelainCode(xy) {
  if (xy === '??' || xy === '?') return 'U';
  if (xy.includes('D')) return 'D';
  if (xy.includes('R')) return 'R';
  if (xy.includes('A') || xy.includes('C')) return 'A';
  if (xy.includes('M') || xy.includes('U')) return 'M';
  return 'M';
}

function mapSingleStatusChar(ch) {
  if (ch === 'D') return 'D';
  if (ch === 'R') return 'R';
  if (ch === 'A' || ch === 'C') return 'A';
  if (ch === '?') return 'U';
  return 'M';
}

function unquoteGitPath(rawPath) {
  let p = String(rawPath || '').trim();
  if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p.replace(/\\/g, '/');
}

function propagateFolderStatus(folders, relPath, status) {
  const parts = relPath.split('/');
  for (let i = 1; i < parts.length; i++) {
    const folderRel = parts.slice(0, i).join('/');
    const prev = folders[folderRel];
    if (!prev || (STATUS_PRIORITY[status] || 0) > (STATUS_PRIORITY[prev] || 0)) {
      folders[folderRel] = status;
    }
  }
}

function recordEntry(acc, relPath, status, rawStatus, origPath = '') {
  const cleanRel = unquoteGitPath(relPath);
  if (!cleanRel) return;
  acc.files[cleanRel] = status;
  propagateFolderStatus(acc.folders, cleanRel, status);
  const x = rawStatus[0] || '.';
  const y = rawStatus[1] || '.';
  const isUntracked = rawStatus === '??' || rawStatus === '?';
  const hasStaged = !isUntracked && x !== '.' && x !== ' ';
  const hasUnstaged = isUntracked || (y !== '.' && y !== ' ');
  acc.entries.push({
    relPath: cleanRel,
    status,
    rawStatus,
    staged: hasStaged,
    unstaged: hasUnstaged,
    untracked: isUntracked,
    ...(origPath ? { origPath: unquoteGitPath(origPath) } : {}),
  });
  if (hasStaged) {
    acc.staged.push({
      relPath: cleanRel,
      status: mapSingleStatusChar(x),
      rawStatus,
      ...(origPath ? { origPath: unquoteGitPath(origPath) } : {}),
    });
  }
  if (isUntracked) {
    acc.untrackedCount++;
    acc.unstaged.push({ relPath: cleanRel, status: 'U', rawStatus: '??', untracked: true });
  } else if (hasUnstaged) {
    acc.unstaged.push({ relPath: cleanRel, status: mapSingleStatusChar(y), rawStatus, untracked: false });
  }
}

/** Parses both `git status --porcelain` (v1) and `--porcelain=v2 --branch` stdout. */
export function parseGitPorcelain(stdout) {
  const acc = {
    files: {},
    folders: {},
    entries: [],
    staged: [],
    unstaged: [],
    branch: '',
    oid: '',
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    untrackedCount: 0,
  };

  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('# ')) {
      if (line.startsWith('# branch.oid ')) acc.oid = line.slice(13).trim();
      else if (line.startsWith('# branch.head ')) {
        const head = line.slice(14).trim();
        acc.detached = head === '(detached)';
        acc.branch = head;
      } else if (line.startsWith('# branch.upstream ')) {
        acc.upstream = line.slice(18).trim() || null;
      } else if (line.startsWith('# branch.ab ')) {
        const m = /\+(\d+)\s+-(\d+)/.exec(line.slice(12));
        if (m) {
          acc.ahead = Number(m[1]);
          acc.behind = Number(m[2]);
        }
      }
      continue;
    }

    if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const m1 = /^1 (..) \S+ \d+ \d+ \d+ \S+ \S+ (.+)$/.exec(line);
      if (m1) {
        recordEntry(acc, m1[2], mapPorcelainCode(m1[1]), m1[1]);
        continue;
      }
      const m2 = /^2 (..) \S+ \d+ \d+ \d+ \S+ \S+ [RC]\d* (.+)$/.exec(line);
      if (m2) {
        const [newPath, origPath = ''] = m2[2].split('\t');
        recordEntry(acc, newPath, mapPorcelainCode(m2[1]), m2[1], origPath);
        continue;
      }
      const mu = /^u (..) \S+ \d+ \d+ \d+ \d+ \S+ \S+ \S+ (.+)$/.exec(line);
      if (mu) {
        recordEntry(acc, mu[2], mapPorcelainCode(mu[1]), mu[1]);
        continue;
      }
    }

    if (line.startsWith('? ')) {
      recordEntry(acc, line.slice(2), 'U', '??');
      continue;
    }

    if (line.length >= 4 && line[2] === ' ') {
      const rawStatus = line.slice(0, 2);
      recordEntry(acc, line.slice(3), mapPorcelainCode(rawStatus), rawStatus);
    }
  }

  return {
    files: acc.files,
    folders: acc.folders,
    entries: acc.entries,
    branch: acc.branch,
    oid: acc.oid,
    upstream: acc.upstream,
    ahead: acc.ahead,
    behind: acc.behind,
    detached: acc.detached,
    stagedCount: acc.staged.length,
    unstagedCount: acc.unstaged.length,
    untrackedCount: acc.untrackedCount,
    staged: acc.staged,
    unstaged: acc.unstaged,
  };
}

async function readLastCommit(rootReal, timeoutMs) {
  try {
    const { stdout } = await runGit(rootReal, ['log', '-1', '--format=%H%n%h%n%s%n%an%n%aI'], { timeoutMs });
    const [hash, shortHash, subject, author, date] = stdout.split(/\r?\n/);
    if (!hash) return null;
    return { hash, shortHash, subject: subject || '', author: author || '', date: date || '' };
  } catch {
    return null;
  }
}

export async function listRemotes(rootInput, { timeoutMs = DEFAULT_GIT_TIMEOUT_MS } = {}) {
  const rootReal = resolveGitRoot(rootInput);
  const { stdout } = await runGit(rootReal, ['remote', '-v'], { timeoutMs });
  const map = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(\S+)\s+(.+?)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const [, name, url, kind] = m;
    const entry = map.get(name) || { name, fetchUrl: '', pushUrl: '' };
    if (kind === 'fetch') entry.fetchUrl = url;
    else entry.pushUrl = url;
    map.set(name, entry);
  }
  return [...map.values()];
}

export async function listStashes(rootInput, { timeoutMs = DEFAULT_GIT_TIMEOUT_MS } = {}) {
  const rootReal = resolveGitRoot(rootInput);
  const { stdout } = await runGit(rootReal, ['stash', 'list', '--format=%gd%x09%gs%x09%aI'], { timeoutMs });
  const stashes = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [ref, message = '', date = ''] = line.split('\t');
    const idxMatch = /\{(\d+)\}/.exec(ref);
    stashes.push({ ref, index: idxMatch ? Number(idxMatch[1]) : stashes.length, message, date });
  }
  return { root: rootReal, stashes };
}

export async function getGitStatus(rootInput, { timeoutMs = 4000 } = {}) {
  const rootReal = resolveGitRoot(rootInput);
  try {
    const { stdout } = await runGit(rootReal, ['status', '--porcelain=v2', '--branch', '-uall'], { timeoutMs });
    const parsed = parseGitPorcelain(stdout);
    const [lastCommit, remotes, stashInfo] = await Promise.all([
      readLastCommit(rootReal, timeoutMs),
      listRemotes(rootReal, { timeoutMs }).catch(() => []),
      listStashes(rootReal, { timeoutMs }).catch(() => ({ stashes: [] })),
    ]);
    return {
      root: rootReal,
      isRepo: true,
      ...parsed,
      lastCommit,
      remotes,
      stashCount: stashInfo.stashes.length,
    };
  } catch {
    return {
      root: rootReal,
      isRepo: false,
      files: {},
      folders: {},
      entries: [],
      branch: '',
      oid: '',
      upstream: null,
      ahead: 0,
      behind: 0,
      detached: false,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      staged: [],
      unstaged: [],
      lastCommit: null,
      remotes: [],
      stashCount: 0,
    };
  }
}

function truncateDiffOutput(rawDiff, maxBytes, maxLines) {
  const totalBytes = Buffer.byteLength(rawDiff, 'utf-8');
  const lines = rawDiff ? rawDiff.split(/\r?\n/) : [];
  const totalLines = lines.length;
  if (totalBytes <= maxBytes && totalLines <= maxLines) {
    return { diff: rawDiff, truncated: false, totalBytes, totalLines };
  }
  const kept = [];
  let bytes = 0;
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const lineBytes = Buffer.byteLength(lines[i], 'utf-8') + 1;
    if (bytes + lineBytes > maxBytes && kept.length > 0) break;
    kept.push(lines[i]);
    bytes += lineBytes;
  }
  return { diff: kept.join('\n'), truncated: true, totalBytes, totalLines };
}

/** Returns unified diff for a tracked/untracked file or entire repo with safe truncation. */
export async function getGitDiff(rootInput, relPath = '', options = {}) {
  const { staged = false, maxBytes = DEFAULT_DIFF_MAX_BYTES, maxLines = DEFAULT_DIFF_MAX_LINES } = options;
  const rootReal = resolveGitRoot(rootInput);
  let cleanRel = '';
  let targetAbs = '';
  if (relPath && String(relPath).trim()) {
    const resolved = resolveInsideWorkspace(rootReal, relPath, { allowNonExistent: true, allowRoot: false });
    cleanRel = resolved.relPath;
    targetAbs = resolved.targetPath;
  }

  if (cleanRel && !staged) {
    const stCheck = await runGit(rootReal, ['status', '--porcelain=v2', '-uall', '--', cleanRel]);
    if (stCheck.stdout.startsWith('? ')) {
      let st;
      try { st = statSync(targetAbs); } catch { st = null; }
      if (!st || !st.isFile()) {
        return { root: rootReal, relPath: cleanRel, staged: false, untracked: true, isBinary: false, truncated: false, totalBytes: 0, totalLines: 0, diff: '' };
      }
      if (BINARY_EXTS.has(extname(cleanRel).toLowerCase()) || looksBinaryFile(targetAbs, st.size)) {
        return { root: rootReal, relPath: cleanRel, staged: false, untracked: true, isBinary: true, truncated: false, totalBytes: st.size, totalLines: 0, diff: '' };
      }
      const rawText = readFileSync(targetAbs, 'utf-8');
      const contentLines = rawText.split(/\r?\n/);
      const header = `--- /dev/null\n+++ b/${cleanRel}\n@@ -0,0 +1,${contentLines.length} @@\n`;
      const body = contentLines.map((l) => `+${l}`).join('\n');
      const trunc = truncateDiffOutput(header + body, maxBytes, maxLines);
      return { root: rootReal, relPath: cleanRel, staged: false, untracked: true, isBinary: false, ...trunc };
    }
  }

  const args = ['diff', '--no-color', ...(staged ? ['--cached'] : []), ...(cleanRel ? ['--', cleanRel] : [])];
  const { stdout } = await runGit(rootReal, args, { maxBuffer: 16 * 1024 * 1024 });
  const isBinary = /(?:^|\n)Binary files .+ differ(?:\n|$)/.test(stdout) && !stdout.includes('\n@@ ');
  const trunc = truncateDiffOutput(stdout, maxBytes, maxLines);
  return { root: rootReal, relPath: cleanRel, staged: Boolean(staged), untracked: false, isBinary, ...trunc };
}

function validateRelPaths(rootReal, paths) {
  if (!Array.isArray(paths)) return [];
  return paths
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => resolveInsideWorkspace(rootReal, p, { allowNonExistent: true, allowRoot: false }).relPath);
}

function validateRepoRelPaths(rootReal, paths) {
  const clean = validateRelPaths(rootReal, paths);
  for (const rel of clean) {
    if (rel === '.git' || rel.startsWith('.git/')) {
      throw new PathGuardError('Protected .git path cannot be modified', 'PROTECTED_PATH', 403);
    }
  }
  return clean;
}

/** Builds deduplicated .gitignore rule suggestions for a workspace-relative path. */
export function buildGitIgnoreSuggestions(relPath, { isDir = false } = {}) {
  if (typeof relPath !== 'string') return [];
  const norm = relPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!norm || norm === '.') return [];

  const suggestions = [];
  const seen = new Set();
  const push = (label, pattern, kind) => {
    if (!pattern || seen.has(pattern)) return;
    seen.add(pattern);
    suggestions.push({ label, pattern, kind });
  };

  push(isDir ? 'Pasta exata' : 'Arquivo exato', `/${norm}${isDir ? '/' : ''}`, 'exact');

  const parts = norm.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const ancestor = parts.slice(0, i).join('/');
    push(`Pasta: ${ancestor}/`, `/${ancestor}/`, 'folder');
  }

  if (!isDir) {
    const base = posix.basename(norm);
    const rawExt = extname(base);
    const ext = rawExt.startsWith('.') ? rawExt.slice(1) : rawExt;
    if (ext) {
      push(`Extensão (*.${ext})`, `*.${ext}`, 'ext');
      if (parts.length > 1) {
        const parentDir = parts.slice(0, -1).join('/');
        push(`Extensão em ${parentDir}/`, `/${parentDir}/*.${ext}`, 'ext');
      }
    }
  }

  return suggestions;
}

/** Appends a .gitignore rule (if absent) and optionally untracks paths via git rm --cached. */
export function addGitIgnoreRule(rootInput, { pattern, untrackPaths = [] } = {}) {
  if (typeof pattern !== 'string' || /[\r\n\0]/.test(pattern)) {
    return Promise.reject(new PathGuardError('Invalid gitignore pattern', 'INVALID_GITIGNORE_PATTERN', 400));
  }
  const cleanPattern = pattern.trim();
  if (!cleanPattern || cleanPattern === '#' || /^\/?\.git\/?$/i.test(cleanPattern)) {
    return Promise.reject(new PathGuardError('Invalid gitignore pattern', 'INVALID_GITIGNORE_PATTERN', 400));
  }

  return enqueueGitOp(rootInput, async (rootReal) => {
    const cleanUntrackPaths = Array.isArray(untrackPaths) && untrackPaths.length
      ? validateRepoRelPaths(rootReal, untrackPaths)
      : [];

    const gitignorePath = join(rootReal, '.gitignore');
    const rawContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
    const eol = rawContent.includes('\r\n') ? '\r\n' : '\n';
    const activeLines = rawContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    const alreadyExisted = activeLines.includes(cleanPattern);

    if (!alreadyExisted) {
      const prefix = !rawContent
        ? ''
        : (rawContent.endsWith('\n') ? rawContent : `${rawContent}${eol}`);
      writeFileSync(gitignorePath, `${prefix}${cleanPattern}${eol}`, 'utf-8');
    }

    if (cleanUntrackPaths.length) {
      await runGit(rootReal, ['rm', '-r', '--cached', '--ignore-unmatch', '--', ...cleanUntrackPaths]);
    }

    return {
      root: rootReal,
      gitignoreRelPath: '.gitignore',
      pattern: cleanPattern,
      added: !alreadyExisted,
      alreadyExisted,
      untracked: cleanUntrackPaths,
      status: await getGitStatus(rootReal),
    };
  });
}

async function hasHeadCommit(rootReal) {
  try {
    await runGit(rootReal, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

export function stageFiles(rootInput, paths = []) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const clean = validateRelPaths(rootReal, paths);
    const args = clean.length ? ['add', '-A', '--', ...clean] : ['add', '-A'];
    await runGit(rootReal, args);
    return { ok: true, action: 'stage', paths: clean };
  });
}

export function unstageFiles(rootInput, paths = []) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const clean = validateRelPaths(rootReal, paths);
    if (await hasHeadCommit(rootReal)) {
      const args = clean.length ? ['restore', '--staged', '--', ...clean] : ['reset', '-q', 'HEAD'];
      await runGit(rootReal, args);
    } else {
      const args = clean.length ? ['rm', '--cached', '-r', '--', ...clean] : ['rm', '--cached', '-r', '.'];
      await runGit(rootReal, args);
    }
    return { ok: true, action: 'unstage', paths: clean };
  });
}

export function discardFiles(rootInput, paths = []) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const clean = validateRelPaths(rootReal, paths);
    if (!clean.length) throw new PathGuardError('At least one file path is required to discard', 'INVALID_PATH', 400);

    const untrackedOut = await runGit(rootReal, ['ls-files', '--others', '--exclude-standard', '--', ...clean]);
    const untrackedSet = new Set(untrackedOut.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    const tracked = [];

    for (const rel of clean) {
      if (untrackedSet.has(rel)) {
        const { targetPath } = resolveInsideWorkspace(rootReal, rel, { allowRoot: false });
        rmSync(targetPath, { recursive: true, force: false });
      } else {
        tracked.push(rel);
      }
    }
    if (tracked.length) {
      await runGit(rootReal, ['restore', '--worktree', '--', ...tracked]);
    }
    return { ok: true, action: 'discard', paths: clean };
  });
}

export function commitChanges(rootInput, message, { amend = false } = {}) {
  const msg = typeof message === 'string' ? message.trim() : '';
  if (!msg) {
    return Promise.reject(new PathGuardError('Commit message cannot be empty', 'INVALID_COMMIT_MESSAGE', 400));
  }
  return enqueueGitOp(rootInput, async (rootReal) => {
    const args = ['commit', ...(amend ? ['--amend'] : []), '-m', msg];
    const { stdout } = await runGit(rootReal, args);
    const lastCommit = await readLastCommit(rootReal, DEFAULT_GIT_TIMEOUT_MS);
    return { ok: true, action: 'commit', output: stdout.trim(), lastCommit };
  });
}

async function validateBranchName(rootReal, name, label = 'branch name') {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || !BRANCH_NAME_RE.test(trimmed) || trimmed.startsWith('-') || trimmed.includes('..')) {
    throw new PathGuardError(`Invalid ${label}: ${name}`, 'INVALID_BRANCH_NAME', 400);
  }
  try {
    await runGit(rootReal, ['check-ref-format', '--branch', trimmed]);
  } catch {
    throw new PathGuardError(`Invalid ${label}: ${trimmed}`, 'INVALID_BRANCH_NAME', 400);
  }
  return trimmed;
}

function validateRemoteName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || !REMOTE_NAME_RE.test(trimmed) || trimmed.startsWith('-')) {
    throw new PathGuardError(`Invalid remote name: ${name}`, 'INVALID_REMOTE_NAME', 400);
  }
  return trimmed;
}

function validateStashRef(ref = 'stash@{0}') {
  const trimmed = typeof ref === 'string' && ref.trim() ? ref.trim() : 'stash@{0}';
  if (!STASH_REF_RE.test(trimmed)) {
    throw new PathGuardError(`Invalid stash ref: ${ref}`, 'INVALID_STASH_REF', 400);
  }
  return trimmed;
}

export async function listBranches(rootInput) {
  const rootReal = resolveGitRoot(rootInput);
  const { stdout } = await runGit(rootReal, [
    'for-each-ref',
    '--format=%(HEAD)%09%(refname:short)%09%(refname)%09%(upstream:short)%09%(objectname:short)%09%(subject)',
    'refs/heads',
    'refs/remotes',
  ]);
  const local = [];
  const remote = [];
  let current = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [headMark, name, fullRef, upstream = '', sha = '', subject = ''] = line.split('\t');
    if (fullRef?.startsWith('refs/remotes/')) {
      if (fullRef.endsWith('/HEAD')) continue;
      remote.push({ name, sha, subject });
    } else {
      const isCurrent = headMark === '*';
      if (isCurrent) current = name;
      local.push({ name, current: isCurrent, upstream: upstream || null, sha, subject });
    }
  }
  return { root: rootReal, current, local, remote };
}

export function createBranch(rootInput, name, { startPoint, checkout = true } = {}) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const branch = await validateBranchName(rootReal, name);
    const sp = typeof startPoint === 'string' && startPoint.trim()
      ? await validateBranchName(rootReal, startPoint, 'start point')
      : '';
    const args = checkout
      ? ['checkout', '-b', branch, ...(sp ? [sp] : [])]
      : ['branch', branch, ...(sp ? [sp] : [])];
    await runGit(rootReal, args);
    return { ok: true, action: 'create', branch };
  });
}

export function switchBranch(rootInput, name) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const branch = await validateBranchName(rootReal, name);
    const remotes = await listRemotes(rootReal).catch(() => []);
    const matchedRemote = remotes.find((r) => branch.startsWith(`${r.name}/`));
    if (matchedRemote) {
      const short = branch.slice(matchedRemote.name.length + 1);
      try {
        await runGit(rootReal, ['switch', '--track', branch]);
        return { ok: true, action: 'switch', branch: short };
      } catch (err) {
        if (err.code === 'DIRTY_WORKTREE') throw err;
        await runGit(rootReal, ['switch', short]);
        return { ok: true, action: 'switch', branch: short };
      }
    }
    await runGit(rootReal, ['switch', branch]);
    return { ok: true, action: 'switch', branch };
  });
}

export function renameBranch(rootInput, oldName, newName) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const src = await validateBranchName(rootReal, oldName, 'source branch');
    const dst = await validateBranchName(rootReal, newName, 'new branch name');
    await runGit(rootReal, ['branch', '-m', src, dst]);
    return { ok: true, action: 'rename', oldName: src, newName: dst };
  });
}

export function deleteBranch(rootInput, name, { force = false } = {}) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const branch = await validateBranchName(rootReal, name);
    const { current } = await listBranches(rootReal);
    if (branch === current) {
      throw new PathGuardError('Cannot delete the currently active branch', 'PROTECTED_BRANCH', 400);
    }
    await runGit(rootReal, ['branch', force ? '-D' : '-d', branch]);
    return { ok: true, action: 'delete', branch };
  });
}

export function mergeBranch(rootInput, sourceBranch) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const source = await validateBranchName(rootReal, sourceBranch, 'source branch');
    const { stdout } = await runGit(rootReal, ['merge', '--no-edit', source]);
    return { ok: true, action: 'merge', source, output: stdout.trim() };
  });
}

export function pushStash(rootInput, { message, includeUntracked = true } = {}) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const args = ['stash', 'push', ...(includeUntracked ? ['-u'] : [])];
    if (typeof message === 'string' && message.trim()) args.push('-m', message.trim());
    const { stdout } = await runGit(rootReal, args);
    return { ok: true, action: 'push', output: stdout.trim() };
  });
}

export function popStash(rootInput, ref) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const target = validateStashRef(ref);
    const { stdout } = await runGit(rootReal, ['stash', 'pop', target]);
    return { ok: true, action: 'pop', ref: target, output: stdout.trim() };
  });
}

export function applyStash(rootInput, ref) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const target = validateStashRef(ref);
    const { stdout } = await runGit(rootReal, ['stash', 'apply', target]);
    return { ok: true, action: 'apply', ref: target, output: stdout.trim() };
  });
}

export function dropStash(rootInput, ref) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const target = validateStashRef(ref);
    const { stdout } = await runGit(rootReal, ['stash', 'drop', target]);
    return { ok: true, action: 'drop', ref: target, output: stdout.trim() };
  });
}

export function fetchRemote(rootInput, { remote, prune = true } = {}) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const args = ['fetch'];
    if (remote) args.push(validateRemoteName(remote));
    else args.push('--all');
    if (prune) args.push('--prune');
    const { stdout, stderr } = await runGit(rootReal, args, { timeoutMs: 20000 });
    return { ok: true, action: 'fetch', output: (stdout || stderr).trim() };
  });
}

export function pullRemote(rootInput, { remote, branch } = {}) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const args = ['pull', '--ff-only'];
    if (remote) args.push(validateRemoteName(remote));
    if (branch) args.push(await validateBranchName(rootReal, branch));
    const { stdout, stderr } = await runGit(rootReal, args, { timeoutMs: 20000 });
    return { ok: true, action: 'pull', output: (stdout || stderr).trim() };
  });
}

export function pushRemote(rootInput, { remote, branch, setUpstream = false } = {}) {
  return enqueueGitOp(rootInput, async (rootReal) => {
    const rem = remote ? validateRemoteName(remote) : '';
    const br = branch ? await validateBranchName(rootReal, branch) : '';
    const args = ['push'];
    if (setUpstream) args.push('-u');
    if (rem) args.push(rem);
    if (br) args.push(br);
    const { stdout, stderr } = await runGit(rootReal, args, { timeoutMs: 20000 });
    return { ok: true, action: 'push', output: (stdout || stderr).trim() };
  });
}

function looksBinaryFile(filePath, size) {
  const sampleLen = Math.min(size, 4096);
  if (sampleLen <= 0) return false;
  const buf = Buffer.allocUnsafe(sampleLen);
  const fd = openSync(filePath, 'r');
  try {
    const read = readSync(fd, buf, 0, sampleLen, 0);
    for (let i = 0; i < read; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

function makeSnippet(lineText, idx, queryLen) {
  const maxLen = 180;
  if (lineText.length <= maxLen) return lineText.trim();
  const start = Math.max(0, idx - 60);
  const end = Math.min(lineText.length, idx + queryLen + 100);
  return `${start > 0 ? '...' : ''}${lineText.slice(start, end).trim()}${end < lineText.length ? '...' : ''}`;
}

/** Searches workspace text files for `query`, skipping .git, node_modules, and binaries. */
export function searchInFiles(rootInput, query, options = {}) {
  const { caseSensitive = false, maxResults = 200, maxFileBytes = 512 * 1024, includeIgnored = false } = options;
  const rootReal = resolveGitRoot(rootInput);
  const needle = typeof query === 'string' ? query : '';
  if (!needle.trim()) {
    return { root: rootReal, query: '', matches: [], filesMatched: 0, totalMatches: 0, truncated: false };
  }
  const needleCmp = caseSensitive ? needle : needle.toLowerCase();
  const matches = [];
  let filesMatched = 0;
  let truncated = false;

  const walk = (dirPath, relDir) => {
    if (truncated) return;
    let dirents;
    try { dirents = readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    for (const d of dirents) {
      if (truncated) return;
      if (d.name === '.git' || (!includeIgnored && IGNORED_DIRS.has(d.name))) continue;
      const full = join(dirPath, d.name);
      const rel = relDir ? posix.join(relDir, d.name) : d.name;
      if (d.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!d.isFile() || BINARY_EXTS.has(extname(d.name).toLowerCase())) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.size === 0 || st.size > maxFileBytes || looksBinaryFile(full, st.size)) continue;

      const lines = readFileSync(full, 'utf-8').split(/\r?\n/);
      let matchedThisFile = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const col = (caseSensitive ? line : line.toLowerCase()).indexOf(needleCmp);
        if (col === -1) continue;
        if (!matchedThisFile) {
          matchedThisFile = true;
          filesMatched++;
        }
        matches.push({ relPath: rel, line: i + 1, column: col + 1, text: makeSnippet(line, col, needle.length) });
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
      }
    }
  };

  walk(rootReal, '');
  return { root: rootReal, query: needle, matches, filesMatched, totalMatches: matches.length, truncated };
}
