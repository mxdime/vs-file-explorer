/**
 * Workspace resolution, local folder browsing, persistence, and path-traversal containment.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_RECENT = 12;

export class PathGuardError extends Error {
  constructor(message, code = 'PATH_GUARD_ERROR', status = 403) {
    super(message);
    this.name = 'PathGuardError';
    this.code = code;
    this.status = status;
  }
}

export function getDataDir(overrideDir) {
  return (
    overrideDir ||
    process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR ||
    join(homedir(), '.gemini', 'antigravity', 'sidecar_data', 'vs-file-explorer')
  );
}

/** Converts a file:// URI or local path string into a normalized local path. */
export function uriToLocalPath(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^file:\/\//i.test(trimmed)) {
    try {
      let local = fileURLToPath(trimmed);
      if (/^\/[a-zA-Z]:/.test(local)) local = local.slice(1);
      if (/^[a-z]:/.test(local)) local = local[0].toUpperCase() + local.slice(1);
      return resolve(local);
    } catch {
      return '';
    }
  }
  const resolved = resolve(trimmed);
  return /^[a-z]:/.test(resolved) ? resolved[0].toUpperCase() + resolved.slice(1) : resolved;
}

export function localPathToUri(localPath) {
  try {
    return pathToFileURL(localPath).href;
  } catch {
    return '';
  }
}

function isDir(targetPath) {
  try {
    return Boolean(targetPath) && statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a, b) {
  if (!a || !b) return false;
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isWithinRoot(rootReal, targetReal) {
  const rel = relative(rootReal, targetReal);
  if (!rel) return true;
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

function normalizeRelPath(rootReal, targetPath) {
  const rel = relative(rootReal, targetPath);
  if (!rel || rel === '.') return '';
  return rel.split(sep).join('/');
}

/**
 * Resolves a relative path strictly inside the active workspace root.
 * Rejects traversal (e.g. ..\..\Windows) and symlink escapes.
 */
export function resolveInsideWorkspace(rootInput, relInput = '', options = {}) {
  const { allowNonExistent = false, allowRoot = true } = options;
  const localRoot = uriToLocalPath(rootInput);
  if (!localRoot || !isDir(localRoot)) {
    throw new PathGuardError('Workspace root is invalid or does not exist', 'INVALID_WORKSPACE', 400);
  }
  const rootReal = realpathSync(localRoot);
  const rawRel = typeof relInput === 'string' ? relInput.trim() : '';
  if (rawRel.includes('\0')) {
    throw new PathGuardError('Invalid null byte in path', 'INVALID_PATH', 400);
  }
  if (!rawRel || rawRel === '.' || rawRel === '/' || rawRel === '\\') {
    if (!allowRoot) throw new PathGuardError('Operation cannot target workspace root', 'PROTECTED_PATH', 403);
    return { rootReal, targetPath: rootReal, relPath: '' };
  }
  if (isAbsolute(rawRel) || /^[a-zA-Z]:/.test(rawRel) || rawRel.startsWith('\\\\')) {
    throw new PathGuardError('Absolute paths are not permitted inside workspace operations', 'PATH_TRAVERSAL', 403);
  }

  const candidate = resolve(rootReal, rawRel);
  if (!isWithinRoot(rootReal, candidate)) {
    throw new PathGuardError(`Path traversal blocked: ${rawRel}`, 'PATH_TRAVERSAL', 403);
  }

  if (existsSync(candidate)) {
    const targetReal = realpathSync(candidate);
    if (!isWithinRoot(rootReal, targetReal)) {
      throw new PathGuardError(`Symlink escape blocked: ${rawRel}`, 'PATH_TRAVERSAL', 403);
    }
    return { rootReal, targetPath: targetReal, relPath: normalizeRelPath(rootReal, targetReal) };
  }

  if (!allowNonExistent) {
    throw new PathGuardError(`Path not found: ${rawRel}`, 'ENOENT', 404);
  }

  // Verify nearest existing ancestor is also contained inside rootReal.
  let probe = dirname(candidate);
  while (probe && !existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const ancestorReal = realpathSync(probe);
  if (!isWithinRoot(rootReal, ancestorReal)) {
    throw new PathGuardError(`Ancestor escape blocked: ${rawRel}`, 'PATH_TRAVERSAL', 403);
  }
  return { rootReal, targetPath: candidate, relPath: normalizeRelPath(rootReal, candidate) };
}

function stateFilePath(dataDir) {
  return join(getDataDir(dataDir), 'workspaces.json');
}

export function loadWorkspaceState(dataDir) {
  const file = stateFilePath(dataDir);
  const empty = { activeRoot: '', recent: [], favorites: [] };
  if (!existsSync(file)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    return {
      activeRoot: typeof parsed.activeRoot === 'string' ? parsed.activeRoot : '',
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((p) => typeof p === 'string') : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter((p) => typeof p === 'string') : [],
    };
  } catch {
    return empty;
  }
}

export function saveWorkspaceState(state, dataDir) {
  const dir = getDataDir(dataDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFilePath(dataDir), JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

function formatEntry(folderPath) {
  const clean = uriToLocalPath(folderPath);
  return { name: basename(clean) || clean, path: clean, uri: localPathToUri(clean) };
}

function dedupePaths(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const norm = uriToLocalPath(item);
    if (!norm || !isDir(norm)) continue;
    const key = process.platform === 'win32' ? norm.toLowerCase() : norm;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

export function getWorkspacesState({ hostUris = [], dataDir } = {}) {
  const state = loadWorkspaceState(dataDir);
  const hostPaths = dedupePaths(hostUris);
  const recent = dedupePaths(state.recent);
  const favorites = dedupePaths(state.favorites);
  let activeRoot = uriToLocalPath(state.activeRoot);
  if (!isDir(activeRoot)) {
    activeRoot = hostPaths[0] || recent[0] || favorites[0] || '';
  }
  return {
    activeRoot,
    activeUri: activeRoot ? localPathToUri(activeRoot) : '',
    hostFolders: hostPaths.map(formatEntry),
    recent: recent.map(formatEntry),
    favorites: favorites.map(formatEntry),
  };
}

export function selectWorkspace({ pathOrUri, toggleFavorite = false, removeRecent = false, hostUris = [] } = {}, dataDir) {
  const state = loadWorkspaceState(dataDir);
  const target = uriToLocalPath(pathOrUri);
  if (!target) {
    throw new PathGuardError('Workspace path or URI is required', 'INVALID_WORKSPACE', 400);
  }
  if (removeRecent) {
    state.recent = state.recent.filter((p) => !samePath(p, target));
    saveWorkspaceState(state, dataDir);
    return getWorkspacesState({ hostUris, dataDir });
  }
  if (!isDir(target)) {
    throw new PathGuardError(`Workspace folder does not exist: ${target}`, 'ENOENT', 404);
  }
  const realTarget = realpathSync(target);
  if (toggleFavorite) {
    const exists = state.favorites.some((p) => samePath(p, realTarget));
    state.favorites = exists
      ? state.favorites.filter((p) => !samePath(p, realTarget))
      : [realTarget, ...state.favorites];
  } else {
    state.activeRoot = realTarget;
    state.recent = [realTarget, ...state.recent.filter((p) => !samePath(p, realTarget))].slice(0, MAX_RECENT);
  }
  saveWorkspaceState(state, dataDir);
  return getWorkspacesState({ hostUris, dataDir });
}

/** Safely lists subdirectories at an arbitrary local path (or drive roots when empty) for folder switching. */
export function browseLocalFolders(targetInput = '') {
  const raw = typeof targetInput === 'string' ? targetInput.trim() : '';
  if (!raw || raw === '__roots__') {
    const folders = [];
    if (process.platform === 'win32') {
      for (let code = 67; code <= 90; code++) {
        const drive = `${String.fromCharCode(code)}:\\`;
        if (existsSync(drive)) folders.push({ name: drive, path: drive });
      }
      const home = homedir();
      if (isDir(home)) folders.unshift({ name: `Home (${basename(home)})`, path: home });
    } else {
      folders.push({ name: '/', path: '/' });
    }
    return { currentPath: '', parentPath: '', folders };
  }

  const local = uriToLocalPath(raw);
  if (!local || !isDir(local)) {
    throw new PathGuardError(`Directory not found: ${raw}`, 'ENOENT', 404);
  }
  const currentPath = realpathSync(local);
  const parent = dirname(currentPath);
  const parentPath = samePath(parent, currentPath) ? '' : parent;
  const folders = [];
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('$') || entry.name === 'System Volume Information') continue;
    folders.push({ name: entry.name, path: join(currentPath, entry.name) });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { currentPath, parentPath, folders };
}
