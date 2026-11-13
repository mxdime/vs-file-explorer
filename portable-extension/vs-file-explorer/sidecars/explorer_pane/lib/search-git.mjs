/**
 * Workspace Git porcelain status parser (with folder propagation) and fast file-content search.
 */
import { execFile } from 'node:child_process';
import { closeSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { promisify } from 'node:util';
import { PathGuardError, uriToLocalPath } from './workspace-guard.mjs';

const execFileAsync = promisify(execFile);
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.temp', 'dist', 'build', '.next', '.cache', '__pycache__']);
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip',
  '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.woff', '.woff2', '.ttf', '.eot',
]);
const STATUS_PRIORITY = { M: 5, A: 4, D: 3, R: 2, U: 1 };

function mapPorcelainCode(xy) {
  if (xy === '??') return 'U';
  if (xy.includes('D')) return 'D';
  if (xy.includes('R')) return 'R';
  if (xy.includes('A') || xy.includes('C')) return 'A';
  if (xy.includes('M') || xy.includes('U')) return 'M';
  return 'M';
}

function unquoteGitPath(rawPath) {
  let p = rawPath.trim();
  if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p.replace(/\\/g, '/');
}

/** Parses `git status --porcelain -uall` stdout and propagates indicators to parent folders. */
export function parseGitPorcelain(stdout) {
  const files = {};
  const folders = {};
  const entries = [];
  const lines = String(stdout || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.length < 4) continue;
    const rawStatus = line.slice(0, 2);
    const relPath = unquoteGitPath(line.slice(3));
    if (!relPath) continue;
    const status = mapPorcelainCode(rawStatus);
    files[relPath] = status;
    entries.push({ relPath, status, rawStatus });

    const parts = relPath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folderRel = parts.slice(0, i).join('/');
      const prev = folders[folderRel];
      if (!prev || (STATUS_PRIORITY[status] || 0) > (STATUS_PRIORITY[prev] || 0)) {
        folders[folderRel] = status;
      }
    }
  }
  return { files, folders, entries };
}

export async function getGitStatus(rootInput, { timeoutMs = 4000 } = {}) {
  const localRoot = uriToLocalPath(rootInput);
  if (!localRoot) throw new PathGuardError('Workspace root is invalid', 'INVALID_WORKSPACE', 400);
  const rootReal = realpathSync(localRoot);
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', rootReal, 'status', '--porcelain', '-uall'],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    return { root: rootReal, isRepo: true, ...parseGitPorcelain(stdout) };
  } catch {
    return { root: rootReal, isRepo: false, files: {}, folders: {}, entries: [] };
  }
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
  const prefix = start > 0 ? '...' : '';
  const suffix = end < lineText.length ? '...' : '';
  return `${prefix}${lineText.slice(start, end).trim()}${suffix}`;
}

/** Searches workspace text files for `query`, skipping .git, node_modules, and binaries. */
export function searchInFiles(rootInput, query, options = {}) {
  const { caseSensitive = false, maxResults = 200, maxFileBytes = 512 * 1024, includeIgnored = false } = options;
  const localRoot = uriToLocalPath(rootInput);
  if (!localRoot) throw new PathGuardError('Workspace root is invalid', 'INVALID_WORKSPACE', 400);
  const rootReal = realpathSync(localRoot);

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
    try {
      dirents = readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (truncated) return;
      if (d.name === '.git') continue;
      if (!includeIgnored && IGNORED_DIRS.has(d.name)) continue;

      const full = join(dirPath, d.name);
      const rel = relDir ? posix.join(relDir, d.name) : d.name;
      if (d.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!d.isFile() || BINARY_EXTS.has(extname(d.name).toLowerCase())) continue;

      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.size === 0 || st.size > maxFileBytes || looksBinaryFile(full, st.size)) continue;

      const lines = readFileSync(full, 'utf-8').split(/\r?\n/);
      let matchedThisFile = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hay = caseSensitive ? line : line.toLowerCase();
        const col = hay.indexOf(needleCmp);
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
