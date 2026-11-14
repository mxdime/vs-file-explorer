/**
 * Lightweight, debounced workspace filesystem watcher with long-poll event cursor.
 * On Windows, fs.watch(..., { recursive: true }) uses a single ReadDirectoryChangesW kernel handle.
 */
import { watch } from 'node:fs';
import { dirname } from 'node:path';

const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.temp',
  'coverage',
]);

const GIT_TRIGGER_PATHS = ['.git/HEAD', '.git/index', '.git/packed-refs'];

function normalizeRelPath(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Classifies a relative path emitted by fs.watch into ignore / gitChanged / affected parent directory.
 * @param {string | null | undefined} rawRelPath
 * @returns {{ ignore: boolean, gitChanged: boolean, dir: string | null }}
 */
export function classifyWatchEvent(rawRelPath) {
  const relPath = normalizeRelPath(rawRelPath);
  if (!relPath) {
    return { ignore: false, gitChanged: true, dir: '' };
  }

  const segments = relPath.split('/');
  if (segments.some((seg) => IGNORED_SEGMENTS.has(seg))) {
    return { ignore: true, gitChanged: false, dir: null };
  }

  if (segments[0] === '.git') {
    if (relPath.endsWith('.lock') || relPath.startsWith('.git/objects') || relPath.startsWith('.git/logs')) {
      return { ignore: true, gitChanged: false, dir: null };
    }
    const isGitState =
      GIT_TRIGGER_PATHS.includes(relPath) ||
      relPath.startsWith('.git/refs/heads/') ||
      relPath.startsWith('.git/refs/remotes/');
    return { ignore: !isGitState, gitChanged: isGitState, dir: null };
  }

  const slashIdx = relPath.lastIndexOf('/');
  const parentDir = slashIdx === -1 ? '' : relPath.slice(0, slashIdx);
  return { ignore: false, gitChanged: false, dir: parentDir };
}

/**
 * Creates a debounced workspace watcher supporting long-poll event retrieval.
 * @param {{ debounceMs?: number, keepaliveMs?: number, maxHistory?: number, watchFn?: typeof watch }} [options]
 */
export function createWorkspaceWatcher({
  debounceMs = 250,
  keepaliveMs = 25000,
  maxHistory = 100,
  watchFn = watch,
} = {}) {
  let activeRoot = '';
  let watcher = null;
  let seq = 0;
  let history = [];
  let pendingDirs = new Set();
  let pendingGit = false;
  let debounceTimer = null;
  const waiters = new Set();

  function resolveAllWaiters() {
    for (const resolveWaiter of Array.from(waiters)) {
      resolveWaiter();
    }
  }

  function flushPending() {
    debounceTimer = null;
    if (!pendingDirs.size && !pendingGit) return;

    seq += 1;
    history.push({
      seq,
      dirs: Array.from(pendingDirs),
      gitChanged: pendingGit,
    });
    if (history.length > maxHistory) {
      history = history.slice(history.length - maxHistory);
    }
    pendingDirs = new Set();
    pendingGit = false;
    resolveAllWaiters();
  }

  function scheduleFlush() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPending, debounceMs);
    if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
  }

  function handleFsEvent(_eventType, filename) {
    const info = classifyWatchEvent(filename);
    if (info.ignore) return;
    if (info.gitChanged) pendingGit = true;
    if (info.dir !== null) {
      pendingDirs.add(info.dir);
      const norm = normalizeRelPath(filename);
      if (norm && !norm.startsWith('.git')) {
        // Also record parent-of-parent or exact dir in case an expanded folder itself was deleted/renamed
        const normParent = dirname(norm).replace(/\\/g, '/');
        if (normParent && normParent !== '.') pendingDirs.add(normParent);
        pendingDirs.add(norm);
      }
    }
    scheduleFlush();
  }

  function closeWatcher() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors on already-disposed handles
      }
      watcher = null;
    }
  }

  function ensureWatching(rootPath) {
    if (!rootPath) return;
    if (activeRoot === rootPath && watcher) return;

    closeWatcher();
    activeRoot = rootPath;
    pendingDirs = new Set();
    pendingGit = false;
    history = [];

    try {
      watcher = watchFn(rootPath, { recursive: true }, handleFsEvent);
      watcher.on?.('error', () => {
        closeWatcher();
      });
    } catch {
      // Fallback: platforms or permissions without recursive watch support won't crash the sidecar
      watcher = null;
    }
  }

  function collectSince(sinceSeq) {
    const missed = history.filter((item) => item.seq > sinceSeq);
    if (!missed.length) return null;
    const dirs = new Set();
    let gitChanged = false;
    for (const item of missed) {
      for (const d of item.dirs) dirs.add(d);
      if (item.gitChanged) gitChanged = true;
    }
    return {
      seq,
      dirs: Array.from(dirs),
      gitChanged,
      timeout: false,
    };
  }

  /**
   * Waits for filesystem or git-state changes in rootPath after sinceSeq.
   * @param {string} rootPath
   * @param {number} [sinceSeq]
   * @returns {Promise<{ seq: number, dirs: string[], gitChanged: boolean, timeout: boolean }>}
   */
  async function waitForEvents(rootPath, sinceSeq = 0) {
    ensureWatching(rootPath);
    const immediate = collectSince(sinceSeq);
    if (immediate) return immediate;

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;

      const finish = (timedOut) => {
        if (settled) return;
        settled = true;
        waiters.delete(onFlush);
        if (timer) clearTimeout(timer);
        const batch = collectSince(sinceSeq);
        if (batch) {
          resolve(batch);
        } else {
          resolve({ seq, dirs: [], gitChanged: false, timeout: timedOut });
        }
      };

      const onFlush = () => finish(false);
      waiters.add(onFlush);
      timer = setTimeout(() => finish(true), keepaliveMs);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }

  function close() {
    closeWatcher();
    activeRoot = '';
    resolveAllWaiters();
  }

  return {
    ensureWatching,
    waitForEvents,
    close,
    getState: () => ({ activeRoot, seq, watching: Boolean(watcher) }),
  };
}
