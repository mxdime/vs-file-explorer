/**
 * Directory listing, file preview (text/markdown/image/binary), and guarded CRUD operations.
 */
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, posix } from 'node:path';
import { localPathToUri, PathGuardError, resolveInsideWorkspace } from './workspace-guard.mjs';

const DEFAULT_PREVIEW_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  '.temp',
  'dist',
  'build',
  '.next',
  '.cache',
  '__pycache__',
]);
const IMAGE_MIMES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.bmp', 'image/bmp'],
]);
const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdx']);

function isProtectedPath(relPath) {
  return !relPath || relPath === '.git' || relPath.startsWith('.git/');
}

function isBinaryBuffer(buf) {
  const sampleLen = Math.min(buf.length, 8192);
  if (sampleLen === 0) return false;
  let ctrlCount = 0;
  for (let i = 0; i < sampleLen; i++) {
    const byte = buf[i];
    if (byte === 0) return true;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c && byte !== 0x08) {
      ctrlCount++;
    }
  }
  return ctrlCount / sampleLen > 0.3;
}

function toRelPosix(parentRel, name) {
  return parentRel ? posix.join(parentRel, name) : name;
}

/** Lists one directory level inside the workspace, sorted folders-first then alphabetically. */
export function listDirectory(root, relPath = '', { showHidden = false, showIgnored = false } = {}) {
  const { targetPath, relPath: cleanRel } = resolveInsideWorkspace(root, relPath, { allowRoot: true });
  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    throw new PathGuardError(`Not a directory: ${relPath}`, 'ENOTDIR', 400);
  }

  const entries = [];
  for (const dirent of readdirSync(targetPath, { withFileTypes: true })) {
    const name = dirent.name;
    if (IGNORED_NAMES.has(name)) {
      if (!showIgnored) continue;
    } else if (name.startsWith('.') && !showHidden) {
      continue;
    }

    const fullPath = join(targetPath, name);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    const isDirectory = st.isDirectory();
    const entryRel = toRelPosix(cleanRel, name);
    entries.push({
      name,
      relPath: entryRel,
      fullPath,
      uri: localPathToUri(fullPath),
      type: isDirectory ? 'directory' : 'file',
      ext: isDirectory ? '' : extname(name).toLowerCase(),
      size: isDirectory ? 0 : st.size,
      mtime: st.mtime.toISOString(),
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return { path: cleanRel, entries };
}

/** Reads file preview metadata and content (text, markdown flag, image dataUrl, or binary flag). */
export function readPreview(root, relPath, maxBytes = DEFAULT_PREVIEW_BYTES) {
  const { rootReal, targetPath, relPath: cleanRel } = resolveInsideWorkspace(root, relPath, { allowRoot: false });
  const st = statSync(targetPath);
  if (st.isDirectory()) {
    throw new PathGuardError(`Cannot preview a directory: ${cleanRel}`, 'EISDIR', 400);
  }

  const name = basename(targetPath);
  const ext = extname(name).toLowerCase();
  const base = {
    root: rootReal,
    relPath: cleanRel,
    name,
    fullPath: targetPath,
    uri: localPathToUri(targetPath),
    ext,
    size: st.size,
    mtime: st.mtime.toISOString(),
  };

  const imageMime = IMAGE_MIMES.get(ext);
  if (imageMime) {
    const limit = maxBytes === DEFAULT_PREVIEW_BYTES ? MAX_IMAGE_BYTES : maxBytes;
    if (st.size > limit) {
      return { ...base, kind: 'image', isBinary: false, isMarkdown: false, truncated: true, lineCount: 0, content: null, dataUrl: null };
    }
    const buf = readFileSync(targetPath);
    return {
      ...base,
      kind: 'image',
      isBinary: false,
      isMarkdown: false,
      truncated: false,
      lineCount: 0,
      content: null,
      dataUrl: `data:${imageMime};base64,${buf.toString('base64')}`,
    };
  }

  const bytesToRead = Math.min(st.size, Math.max(1, Number(maxBytes) || DEFAULT_PREVIEW_BYTES));
  const buf = Buffer.allocUnsafe(bytesToRead);
  const fd = openSync(targetPath, 'r');
  let bytesRead = 0;
  try {
    bytesRead = bytesToRead > 0 ? readSync(fd, buf, 0, bytesToRead, 0) : 0;
  } finally {
    closeSync(fd);
  }
  const slice = buf.subarray(0, bytesRead);

  if (isBinaryBuffer(slice)) {
    return { ...base, kind: 'binary', isBinary: true, isMarkdown: false, truncated: st.size > bytesRead, lineCount: 0, content: null, dataUrl: null };
  }

  const content = slice.toString('utf-8');
  const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  return {
    ...base,
    kind: 'text',
    isBinary: false,
    isMarkdown: MARKDOWN_EXTS.has(ext),
    truncated: st.size > bytesRead,
    lineCount,
    content,
    dataUrl: null,
  };
}

export function createFile(root, relPath, content = '') {
  const { targetPath, relPath: cleanRel } = resolveInsideWorkspace(root, relPath, { allowNonExistent: true, allowRoot: false });
  if (isProtectedPath(cleanRel)) throw new PathGuardError('Cannot create inside protected path', 'PROTECTED_PATH', 403);
  if (existsSync(targetPath)) throw new PathGuardError(`Entry already exists: ${cleanRel}`, 'EEXIST', 409);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, String(content ?? ''), { encoding: 'utf-8', flag: 'wx' });
  return { ok: true, action: 'createFile', relPath: cleanRel, fullPath: targetPath, uri: localPathToUri(targetPath) };
}

export function createFolder(root, relPath) {
  const { targetPath, relPath: cleanRel } = resolveInsideWorkspace(root, relPath, { allowNonExistent: true, allowRoot: false });
  if (isProtectedPath(cleanRel)) throw new PathGuardError('Cannot create protected folder', 'PROTECTED_PATH', 403);
  if (existsSync(targetPath)) throw new PathGuardError(`Folder already exists: ${cleanRel}`, 'EEXIST', 409);
  mkdirSync(targetPath, { recursive: true });
  return { ok: true, action: 'createFolder', relPath: cleanRel, fullPath: targetPath, uri: localPathToUri(targetPath) };
}

export function renameEntry(root, oldRelPath, newNameOrRelPath) {
  const src = resolveInsideWorkspace(root, oldRelPath, { allowRoot: false });
  if (isProtectedPath(src.relPath)) throw new PathGuardError('Cannot rename protected path', 'PROTECTED_PATH', 403);
  const rawNew = typeof newNameOrRelPath === 'string' ? newNameOrRelPath.trim() : '';
  if (!rawNew) throw new PathGuardError('New name is required', 'INVALID_PATH', 400);

  const hasSlash = rawNew.includes('/') || rawNew.includes('\\');
  const destInput = hasSlash ? rawNew : toRelPosix(posix.dirname(src.relPath) === '.' ? '' : posix.dirname(src.relPath), rawNew);
  const dest = resolveInsideWorkspace(root, destInput, { allowNonExistent: true, allowRoot: false });
  if (isProtectedPath(dest.relPath)) throw new PathGuardError('Cannot rename into protected path', 'PROTECTED_PATH', 403);

  const isCaseOnlyRename = process.platform === 'win32'
    && src.targetPath.toLowerCase() === dest.targetPath.toLowerCase()
    && src.targetPath !== dest.targetPath;
  if (existsSync(dest.targetPath) && !isCaseOnlyRename) {
    throw new PathGuardError(`Target already exists: ${dest.relPath}`, 'EEXIST', 409);
  }
  mkdirSync(dirname(dest.targetPath), { recursive: true });
  renameSync(src.targetPath, dest.targetPath);
  return { ok: true, action: 'rename', oldRelPath: src.relPath, relPath: dest.relPath, fullPath: dest.targetPath, uri: localPathToUri(dest.targetPath) };
}

export function duplicateEntry(root, relPath) {
  const src = resolveInsideWorkspace(root, relPath, { allowRoot: false });
  if (isProtectedPath(src.relPath)) throw new PathGuardError('Cannot duplicate protected path', 'PROTECTED_PATH', 403);

  const isDir = statSync(src.targetPath).isDirectory();
  const ext = isDir ? '' : extname(src.targetPath);
  const base = basename(src.targetPath, ext);
  const parentDir = dirname(src.targetPath);
  const parentRel = posix.dirname(src.relPath) === '.' ? '' : posix.dirname(src.relPath);

  let counter = 1;
  let candidateName = `${base} copy${ext}`;
  while (existsSync(join(parentDir, candidateName))) {
    counter++;
    candidateName = `${base} copy ${counter}${ext}`;
  }
  const dest = resolveInsideWorkspace(root, toRelPosix(parentRel, candidateName), { allowNonExistent: true, allowRoot: false });
  cpSync(src.targetPath, dest.targetPath, { recursive: true, errorOnExist: true });
  return { ok: true, action: 'duplicate', sourceRelPath: src.relPath, relPath: dest.relPath, fullPath: dest.targetPath, uri: localPathToUri(dest.targetPath) };
}

export function deleteEntry(root, relPath) {
  const target = resolveInsideWorkspace(root, relPath, { allowRoot: false });
  if (isProtectedPath(target.relPath)) {
    throw new PathGuardError('Deleting workspace root or .git is blocked', 'PROTECTED_PATH', 403);
  }
  rmSync(target.targetPath, { recursive: true, force: false });
  return { ok: true, action: 'delete', relPath: target.relPath };
}

export function writeFileContent(root, relPath, content) {
  const target = resolveInsideWorkspace(root, relPath, { allowRoot: false });
  if (isProtectedPath(target.relPath)) {
    throw new PathGuardError('Modifying protected path is blocked', 'PROTECTED_PATH', 403);
  }
  const st = statSync(target.targetPath);
  if (st.isDirectory()) throw new PathGuardError('Cannot write content to a directory', 'EISDIR', 400);
  writeFileSync(target.targetPath, String(content ?? ''), 'utf-8');
  const next = statSync(target.targetPath);
  return { ok: true, action: 'saveContent', relPath: target.relPath, fullPath: target.targetPath, size: next.size, mtime: next.mtime.toISOString() };
}
