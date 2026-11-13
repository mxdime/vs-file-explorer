/**
 * Project Explorer Sidecar backend (SidecarApp + standalone HTTP router for testing).
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getExternalAppsConfig, launchExternalApp, saveExternalAppsConfig } from './lib/external-apps.mjs';
import {
  createFile,
  createFolder,
  deleteEntry,
  duplicateEntry,
  listDirectory,
  readPreview,
  renameEntry,
  writeFileContent,
} from './lib/fs-crud.mjs';
import { getGitStatus, searchInFiles } from './lib/search-git.mjs';
import {
  browseLocalFolders,
  getWorkspacesState,
  PathGuardError,
  resolveInsideWorkspace,
  selectWorkspace,
  uriToLocalPath,
} from './lib/workspace-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, 'web');
const ASSETS_LOGO_PATH = join(__dirname, '..', '..', 'assets', 'logo.svg');
const METADATA_CACHE_TTL_MS = 15000;

class FallbackResponse {
  constructor(body, { contentType = 'text/plain', status = 200, headers } = {}) {
    this.body = body;
    this.contentType = contentType;
    this.status = status;
    this.headers = headers;
  }
}

async function loadSidecarSdk() {
  try {
    return await import('sidecar_sdk');
  } catch {
    const localSdk = join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'index.mjs');
    if (existsSync(localSdk)) {
      return await import(pathToFileURL(localSdk).href);
    }
    return { SidecarApp: null, Response: FallbackResponse };
  }
}

const sdk = await loadSidecarSdk();
const ResponseClass = sdk.Response || FallbackResponse;

function jsonResponse(payload, status = 200) {
  return new ResponseClass(JSON.stringify(payload), {
    status,
    contentType: 'application/json; charset=utf-8',
  });
}

function errorResponse(err) {
  const status = err instanceof PathGuardError ? err.status : 500;
  const payload = { error: err?.message || 'Internal error' };
  if (err?.code) payload.code = err.code;
  return jsonResponse(payload, status);
}

function parseBool(val) {
  return val === true || val === '1' || val === 'true';
}

function parseHostUris(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveActiveRoot(requestedRoot, dataDir) {
  if (typeof requestedRoot === 'string' && requestedRoot.trim()) {
    const local = uriToLocalPath(requestedRoot);
    if (!local) throw new PathGuardError('Invalid workspace root', 'INVALID_WORKSPACE', 400);
    return local;
  }
  const state = getWorkspacesState({ dataDir });
  if (!state.activeRoot) {
    throw new PathGuardError('No active workspace selected', 'NO_WORKSPACE', 400);
  }
  return state.activeRoot;
}

function serveStatic(fileName, contentType) {
  const full = join(WEB_DIR, fileName);
  if (!existsSync(full)) {
    return new ResponseClass('Not found', { status: 404, contentType: 'text/plain' });
  }
  return new ResponseClass(readFileSync(full, 'utf-8'), { status: 200, contentType });
}

function serveLogoSvg() {
  const candidates = [ASSETS_LOGO_PATH, join(WEB_DIR, 'logo.svg')];
  for (const full of candidates) {
    if (existsSync(full)) {
      return new ResponseClass(readFileSync(full, 'utf-8'), {
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
      });
    }
  }
  return new ResponseClass('Not found', { status: 404, contentType: 'text/plain' });
}

export function extractMetadataWorkspaceUris(parsed) {
  const out = [];
  const seen = new Set();
  const pushUri = (val) => {
    if (typeof val !== 'string') return;
    const trimmed = val.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  const containers = [
    parsed,
    parsed?.response,
    parsed?.response?.conversationMetadata,
    parsed?.response?.conversation_metadata,
    parsed?.conversationMetadata,
    parsed?.conversation_metadata,
  ];
  for (const c of containers) {
    if (!c || typeof c !== 'object') continue;
    for (const obj of [c, c.metadata]) {
      if (!obj || typeof obj !== 'object') continue;
      for (const list of [obj.workspaceUris, obj.workspace_uris]) {
        if (Array.isArray(list)) list.forEach(pushUri);
      }
      if (Array.isArray(obj.workspaces)) {
        for (const ws of obj.workspaces) {
          if (!ws || typeof ws !== 'object') continue;
          pushUri(ws.workspaceFolderAbsoluteUri || ws.workspace_folder_absolute_uri || ws.uri || ws.path);
        }
      }
    }
  }
  return out;
}

function createMetadataResolver(execFileFn) {
  const cache = new Map();
  return (convId) => {
    const id = typeof convId === 'string' ? convId.trim() : '';
    if (!id) return Promise.resolve([]);
    const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE;
    if (!exe && !execFileFn) return Promise.resolve([]);

    const now = Date.now();
    const cached = cache.get(id);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.uris);
    }

    const runner = execFileFn || execFile;
    const file = exe || 'agentapi';
    const args = [...(exe ? ['agentapi'] : []), 'get-conversation-metadata', id];
    return new Promise((resolveDone) => {
      runner(file, args, { encoding: 'utf-8', timeout: 2500, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolveDone([]);
        try {
          const uris = extractMetadataWorkspaceUris(JSON.parse(stdout));
          cache.set(id, { uris, expiresAt: Date.now() + METADATA_CACHE_TTL_MS });
          resolveDone(uris);
        } catch {
          resolveDone([]);
        }
      });
    });
  };
}

export function writeSystemClipboard(text, { spawnFn = spawn, platform = process.platform } = {}) {
  if (typeof text !== 'string' || !text) {
    throw new PathGuardError('Clipboard text is required', 'INVALID_CLIPBOARD_TEXT', 400);
  }
  const spec = platform === 'win32'
    ? {
        cmd: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
      }
    : platform === 'darwin'
      ? { cmd: 'pbcopy', args: [] }
      : { cmd: 'xclip', args: ['-selection', 'clipboard'] };

  return new Promise((resolveDone, rejectDone) => {
    const child = spawnFn(spec.cmd, spec.args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    }
    const timer = setTimeout(() => {
      try { child.kill?.(); } catch {}
      rejectDone(new PathGuardError('Clipboard command timed out', 'CLIPBOARD_TIMEOUT', 500));
    }, 3000);
    child.on?.('error', (err) => {
      clearTimeout(timer);
      rejectDone(new PathGuardError(`Clipboard error: ${err.message}`, 'CLIPBOARD_ERROR', 500));
    });
    child.on?.('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolveDone({ ok: true, length: text.length });
      } else {
        rejectDone(new PathGuardError(stderr.trim() || `Clipboard exited with code ${code}`, 'CLIPBOARD_ERROR', 500));
      }
    });
    if (child.stdin && typeof child.stdin.end === 'function') {
      child.stdin.end(text, 'utf8');
    }
  });
}

export function createExplorerHandlers({ dataDir, spawnFn, execFileFn, clipboardFn } = {}) {
  const resolveConvUris = createMetadataResolver(execFileFn);
  const wrap = (fn) => async (data = {}) => {
    try {
      return await fn(data);
    } catch (err) {
      return errorResponse(err);
    }
  };

  return {
    getWorkspaces: wrap(async (data) => {
      let hostUris = parseHostUris(data.uris);
      if (hostUris.length === 0) {
        const convId = String(data.conversationId || process.env.ANTIGRAVITY_CONVERSATION_ID || '').trim();
        if (convId) {
          hostUris = await resolveConvUris(convId);
        }
      }
      const state = getWorkspacesState({ hostUris, dataDir });
      const hasBrowse = Object.prototype.hasOwnProperty.call(data, 'browse') && data.browse !== undefined;
      return { ...state, browse: hasBrowse ? browseLocalFolders(String(data.browse || '')) : null };
    }),
    selectWorkspace: wrap((data) => {
      const hostUris = parseHostUris(data.uris);
      const state = selectWorkspace({
        pathOrUri: data.path ?? data.uri ?? '',
        toggleFavorite: Boolean(data.toggleFavorite || data.action === 'toggleFavorite'),
        removeRecent: Boolean(data.removeRecent || data.action === 'removeRecent'),
        hostUris,
      }, dataDir);
      return { ok: true, ...state };
    }),
    getTree: wrap((data) => {
      const root = resolveActiveRoot(data.root, dataDir);
      const listing = listDirectory(root, data.path || '', {
        showHidden: parseBool(data.showHidden),
        showIgnored: parseBool(data.showIgnored),
      });
      return { root, ...listing };
    }),
    getPreview: wrap((data) => {
      const root = resolveActiveRoot(data.root, dataDir);
      if (!data.path) throw new PathGuardError('Query parameter "path" is required', 'INVALID_PATH', 400);
      const maxBytes = data.maxBytes ? Number(data.maxBytes) : undefined;
      return readPreview(root, data.path, maxBytes);
    }),
    postCrud: wrap((data) => {
      const root = resolveActiveRoot(data.root, dataDir);
      const action = String(data.action || '').trim();
      const targetPath = data.path;
      switch (action) {
        case 'createFile': return createFile(root, targetPath, data.content ?? '');
        case 'createFolder': return createFolder(root, targetPath);
        case 'rename': return renameEntry(root, targetPath, data.newName ?? data.newPath);
        case 'duplicate': return duplicateEntry(root, targetPath);
        case 'delete': return deleteEntry(root, targetPath);
        case 'saveContent': return writeFileContent(root, targetPath, data.content ?? '');
        default: throw new PathGuardError(`Unsupported CRUD action: ${action}`, 'INVALID_ACTION', 400);
      }
    }),
    getSearch: wrap((data) => {
      const root = resolveActiveRoot(data.root, dataDir);
      return searchInFiles(root, data.q ?? data.query ?? '', {
        caseSensitive: parseBool(data.caseSensitive),
        maxResults: data.maxResults ? Math.min(500, Math.max(1, Number(data.maxResults))) : 200,
        includeIgnored: parseBool(data.includeIgnored),
      });
    }),
    getGitStatus: wrap(async (data) => {
      const root = resolveActiveRoot(data.root, dataDir);
      return getGitStatus(root);
    }),
    getExternalApps: wrap(() => getExternalAppsConfig({ dataDir })),
    postExternalAppsConfig: wrap((data) => {
      const config = saveExternalAppsConfig({
        associations: data.associations,
        customApps: data.customApps,
      }, { dataDir });
      return { ok: true, ...config };
    }),
    postOpenExternal: wrap((data) => {
      const root = resolveActiveRoot(data.root, dataDir);
      const { targetPath } = resolveInsideWorkspace(root, data.path || '', { allowRoot: true });
      return launchExternalApp({
        targetPath,
        appId: data.appId || undefined,
        dataDir,
        spawnFn,
      });
    }),
    postClipboard: wrap((data) => {
      if (typeof data.text !== 'string' || !data.text) {
        throw new PathGuardError('Clipboard text is required', 'INVALID_CLIPBOARD_TEXT', 400);
      }
      if (clipboardFn) return clipboardFn(data.text);
      return writeSystemClipboard(data.text, { spawnFn });
    }),
  };
}

function registerRoutes(registerPage, registerApi, options) {
  const h = createExplorerHandlers(options);
  registerPage('/', () => serveStatic('index.html', 'text/html; charset=utf-8'));
  registerApi('/styles.css', () => serveStatic('styles.css', 'text/css; charset=utf-8'), 'GET');
  registerApi('/app.js', () => serveStatic('app.js', 'application/javascript; charset=utf-8'), 'GET');
  registerApi('/logo.svg', () => serveLogoSvg(), 'GET');
  registerApi('/api/workspaces', h.getWorkspaces, 'GET');
  registerApi('/api/workspaces/select', h.selectWorkspace, 'POST');
  registerApi('/api/tree', h.getTree, 'GET');
  registerApi('/api/preview', h.getPreview, 'GET');
  registerApi('/api/crud', h.postCrud, 'POST');
  registerApi('/api/search', h.getSearch, 'GET');
  registerApi('/api/git-status', h.getGitStatus, 'GET');
  registerApi('/api/external-apps', h.getExternalApps, 'GET');
  registerApi('/api/external-apps/config', h.postExternalAppsConfig, 'POST');
  registerApi('/api/open-external', h.postOpenExternal, 'POST');
  registerApi('/api/clipboard', h.postClipboard, 'POST');
}

/** Creates a standalone HTTP request listener for unit testing outside the Antigravity host. */
export function createRouter({ dataDir, spawnFn, execFileFn, clipboardFn, token } = {}) {
  const routes = new Map();
  const addRoute = (path, handler, method = 'GET') => {
    if (!routes.has(path)) routes.set(path, new Map());
    routes.get(path).set(method.toUpperCase(), handler);
  };
  registerRoutes(
    (path, handler) => addRoute(path, handler, 'GET'),
    addRoute,
    { dataDir, spawnFn, execFileFn, clipboardFn },
  );

  return (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' && token) {
      const provided = req.headers['x-sidecar-token'] || url.searchParams.get('token');
      if (provided !== token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }
    const methodMap = routes.get(url.pathname);
    if (!methodMap) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const handler = methodMap.get(req.method);
    if (!handler) {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = {};
        for (const [k, v] of url.searchParams.entries()) {
          if (k.toLowerCase() !== 'token') data[k] = v;
        }
        if (body) Object.assign(data, JSON.parse(body));
        const result = await handler(data);
        if (result && typeof result === 'object' && result.contentType && result.body !== undefined) {
          res.writeHead(result.status || 200, { 'Content-Type': result.contentType, ...result.headers });
          res.end(result.body);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  };
}

/** Binds all Project Explorer routes onto a SidecarApp instance. */
export function createExplorerApp({ sidecarApp, dataDir, spawnFn, execFileFn, clipboardFn } = {}) {
  const app = sidecarApp || (sdk.SidecarApp ? new sdk.SidecarApp() : null);
  if (!app) throw new Error('SidecarApp is unavailable outside the Antigravity sidecar runtime');
  registerRoutes(
    (path, handler) => app.page(path, handler),
    (path, handler, method) => app.api(path, handler, method),
    { dataDir, spawnFn, execFileFn, clipboardFn },
  );
  return app;
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = createExplorerApp();
  await app.run();
}
