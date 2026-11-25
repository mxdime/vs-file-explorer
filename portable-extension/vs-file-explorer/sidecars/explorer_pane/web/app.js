/*
 * VS File Explorer Workbench UI (Classic IIFE Script)
 * Connects to sidecar HTTP API & Antigravity preload.js bridge.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

const state = {
  hostUris: [],
  workspaces: { activeRoot: '', activeUri: '', hostFolders: [], recent: [], favorites: [] },
  activeRoot: '',
  activeTab: 'explorer',
  showHidden: false,
  showIgnored: false,
  treeFilter: '',
  treeNodes: new Map(), // relPath -> { entries, loaded, loading }
  expanded: new Set(['']),
  selectedPath: '',
  selectedType: 'directory',
  git: {
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
  },
  gitFilter: '',
  gitRepos: [],
  activeGitRepo: '',
  gitTotalChangesAllRepos: 0,
  gitComposerOpen: false,
  gitStashes: [],
  gitBranches: { current: '', local: [], remote: [] },
  gitSelectedRemote: '',
  gitBusy: false,
  pendingBranchSwitch: '',
  gitIgnoreTarget: null,
  externalApps: { apps: [], associations: {}, customApps: [] },
  preview: null,
  previewOpen: false,
  previewMode: 'file', // 'file' | 'diff'
  previewDiff: null,
  previewDiffStaged: false,
  previewGitRepo: '',
  previewGitRelPath: '',
  treePinned: false,
  treeHovered: false,
  mdRendered: true,
  editMode: false,
  editDirty: false,
  highlightLine: 0,
  searchResults: null,
  browseState: { currentPath: '', parentPath: '', folders: [] },
  contextMenuOpen: false,
  autoSelectedHostUri: false,
  fsWatchSeq: 0,
  fsWatchRoot: '',
  fsWatchAbort: null,
  fsWatchPendingDirs: new Set(),
  fsWatchPendingGit: false,
};

let hoverLeaveTimer = null;
let toastTimer = null;
let filterDebounceTimer = null;
let gitWatchDebounceTimer = null;
let dialogResolver = null;

// ---------- Theme Sync ----------
function syncScheme() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f6f7f9)';
  document.documentElement.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const nums = (color.match(/[\d.]+/g) || []).map(Number);
  if (nums.length < 3) return;
  const scale = color.startsWith('color(') ? 1 : 255;
  const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const nextTheme = lum < 0.5 ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== nextTheme) {
    document.documentElement.dataset.theme = nextTheme;
  }
}

syncScheme();
new MutationObserver(syncScheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['style'],
});

// ---------- API Helpers ----------
function getFetcher() {
  return window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
}

function getConversationId() {
  return (
    window.sidecar?.conversationId ||
    new URLSearchParams(window.location.search).get('conversationId') ||
    ''
  );
}

function resolveApiUrl(endpoint) {
  const clean = String(endpoint || '').replace(/^\/+/, '');
  return new URL(clean, window.location.href);
}

async function apiGet(endpoint, query = {}, options = {}) {
  const url = resolveApiUrl(endpoint);
  for (const [key, val] of Object.entries(query)) {
    if (val !== undefined && val !== null && val !== '') {
      url.searchParams.set(key, String(val));
    }
  }
  const fetchOpts = { method: 'GET' };
  if (options.signal) fetchOpts.signal = options.signal;
  const res = await getFetcher()(url.pathname + url.search, fetchOpts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro HTTP ${res.status}`);
    err.code = data.code || '';
    err.status = res.status;
    throw err;
  }
  return data;
}

async function apiPost(endpoint, body = {}) {
  const url = resolveApiUrl(endpoint);
  const res = await getFetcher()(url.pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro HTTP ${res.status}`);
    err.code = data.code || '';
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- UI Utilities ----------
function setStatus(text, stats = '') {
  $('status-text').textContent = text;
  if (stats !== undefined) $('status-stats').textContent = stats;
}

function showToast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

async function copyText(text, label = 'Copiado') {
  let copied = false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (!copied) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      copied = Boolean(document.execCommand('copy'));
      ta.remove();
    } catch {
      copied = false;
    }
  }

  if (!copied) {
    try {
      await apiPost('/api/clipboard', { text });
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (copied) {
    showToast(`${label}: ${text}`);
  } else {
    showToast('Não foi possível copiar para a área de transferência', true);
  }
}

function isAnyModalOpen() {
  return (
    !$('ws-modal-backdrop').classList.contains('hidden') ||
    !$('ext-modal-backdrop').classList.contains('hidden') ||
    !$('branch-modal-backdrop').classList.contains('hidden') ||
    !$('gitignore-modal-backdrop').classList.contains('hidden') ||
    !$('dialog-backdrop').classList.contains('hidden')
  );
}

function getParentRel(relPath) {
  if (!relPath) return '';
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

function joinRel(parentRel, name) {
  const cleanName = String(name || '').trim().replace(/^[/\\]+/, '');
  return parentRel ? `${parentRel}/${cleanName}` : cleanName;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------- SVG Icons ----------
function svgIcon(paths, color = 'currentColor', extraClass = '') {
  return `<svg class="icon ${extraClass}" viewBox="0 0 16 16" style="color:${color}" aria-hidden="true">${paths}</svg>`;
}

function getEntryIconHtml(entry, isExpanded = false) {
  if (entry.type === 'directory') {
    const d = isExpanded
      ? '<path d="M1.5 4a1 1 0 0 1 1-1h3.3l1.2 1.2h6.5a1 1 0 0 1 1 1v1H3.2L1.5 12z"/><path d="M2.2 6.2h12.3l-1.3 6.3H1.5z"/>'
      : '<path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.3 1.5h6.1a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>';
    return svgIcon(d, 'var(--pe-folder)');
  }
  const ext = (entry.ext || '').toLowerCase();
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') {
    return svgIcon('<path d="M2.5 3h11v10h-11z"/><path d="M4.5 10V6l2 2.2L8.5 6v4M10.5 6v4m0 0-1.2-1.2M10.5 10l1.2-1.2"/>', '#3b82f6');
  }
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) {
    return svgIcon('<path d="M3.5 2h6l3 3v9h-9z"/><path d="M9.5 2v3h3M6 8.5 4.8 10 6 11.5M10 8.5l1.2 1.5-1.2 1.5"/>', '#d97706');
  }
  if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml') {
    return svgIcon('<path d="M6 3.5c-1 0-1.5.5-1.5 1.5v2c0 .7-.5 1-1 1 .5 0 1 .3 1 1v2c0 1 .5 1.5 1.5 1.5M10 3.5c1 0 1.5.5 1.5 1.5v2c0 .7.5 1 1 1-.5 0-1 .3-1 1v2c0 1-.5 1.5-1.5 1.5"/>', '#16a34a');
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) {
    return svgIcon('<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.2" r="1"/><path d="m3 12 3.5-3.5 2.3 2.2 2-1.8 2.2 3.1"/>', '#0d9488');
  }
  if (['.html', '.htm', '.css', '.scss'].includes(ext)) {
    return svgIcon('<path d="M3.5 2h6l3 3v9h-9z"/><path d="M9.5 2v3h3M5.5 9.5h5M5.5 11.5h3.5"/>', '#ea580c');
  }
  if (['.py', '.ps1', '.bat', '.cmd', '.sh'].includes(ext)) {
    return svgIcon('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="m4.5 6.5 2 1.5-2 1.5M8 10h3.5"/>', '#0284c7');
  }
  return svgIcon('<path d="M3.5 2h6l3 3v9h-9z"/><path d="M9.5 2v3h3"/>', 'var(--pe-fg-muted)');
}

// ---------- Stage Auto-Minimize & Hover Auto-Open ----------
function loadPinnedPreference() {
  try {
    return localStorage.getItem('pe:treePinned') === '1';
  } catch {
    return false;
  }
}

function savePinnedPreference(pinned) {
  try {
    localStorage.setItem('pe:treePinned', pinned ? '1' : '0');
  } catch {
    // ignore storage restrictions
  }
}

function syncStageLayout() {
  const stage = $('wb-stage');
  stage.dataset.previewOpen = String(state.previewOpen);
  stage.dataset.treePinned = String(state.treePinned);
  stage.dataset.treeHovered = String(state.treeHovered);
  $('preview-pane').classList.toggle('hidden', !state.previewOpen);
  $('btn-pin-tree').setAttribute('aria-pressed', String(state.treePinned));
  $('rail-pin-btn').setAttribute('aria-pressed', String(state.treePinned));
  $('rail-expand-btn').setAttribute('aria-expanded', String(state.treeHovered || !state.previewOpen));
}

function openHoverDrawer() {
  clearTimeout(hoverLeaveTimer);
  if (state.previewOpen && !state.treePinned && !state.treeHovered) {
    state.treeHovered = true;
    syncStageLayout();
  }
}

function scheduleCloseHoverDrawer() {
  clearTimeout(hoverLeaveTimer);
  if (!state.previewOpen || state.treePinned || !state.treeHovered) return;
  hoverLeaveTimer = setTimeout(() => {
    if (state.contextMenuOpen || isAnyModalOpen()) return;
    if ($('sidebar-pane').matches(':hover') || $('tree-rail').matches(':hover')) return;
    state.treeHovered = false;
    syncStageLayout();
  }, 240);
}

function togglePinTree() {
  state.treePinned = !state.treePinned;
  savePinnedPreference(state.treePinned);
  if (state.treePinned) {
    clearTimeout(hoverLeaveTimer);
    state.treeHovered = false;
  }
  syncStageLayout();
}

// ---------- Workspace Management ----------
function renderWorkspaceHeader() {
  const root = state.activeRoot;
  if (!root) {
    $('ws-name').textContent = 'Nenhuma pasta selecionada';
    $('ws-path').textContent = 'Clique para escolher um projeto local';
    $('ws-source-badge').classList.add('hidden');
    return;
  }
  const parts = root.replace(/[/\\]+$/, '').split(/[/\\]/);
  $('ws-name').textContent = parts[parts.length - 1] || root;
  $('ws-path').textContent = root;
  const isHost = state.workspaces.hostFolders?.some((f) => f.path.toLowerCase() === root.toLowerCase());
  const badge = $('ws-source-badge');
  badge.textContent = isHost ? 'Conversa' : 'Local';
  badge.classList.remove('hidden');
}

async function refreshWorkspaceState({ autoPickHost = false } = {}) {
  const urisParam = state.hostUris.length ? JSON.stringify(state.hostUris) : '';
  const data = await apiGet('/api/workspaces', {
    uris: urisParam,
    conversationId: getConversationId(),
  });
  state.workspaces = data;
  let nextRoot = data.activeRoot || '';

  if (autoPickHost && data.hostFolders?.length > 0) {
    const hostPath = data.hostFolders[0].path;
    if (hostPath && hostPath.toLowerCase() !== nextRoot.toLowerCase()) {
      const selected = await apiPost('/api/workspaces/select', {
        path: hostPath,
        uris: state.hostUris,
      });
      state.workspaces = selected;
      nextRoot = selected.activeRoot;
    }
  }

  const changed = nextRoot.toLowerCase() !== state.activeRoot.toLowerCase();
  state.activeRoot = nextRoot;
  renderWorkspaceHeader();
  if (changed && state.activeRoot) {
    await onWorkspaceActivated();
  } else if (!state.activeRoot) {
    $('tree-container').innerHTML = '<div class="empty-state">Selecione uma pasta de projeto no topo.</div>';
    state.git = createEmptyGitState();
    state.gitRepos = [];
    state.activeGitRepo = '';
    state.gitTotalChangesAllRepos = 0;
    setCommitComposerOpen(false);
    renderGitTab();
  }
}

async function selectWorkspacePath(pathOrUri, extra = {}) {
  const res = await apiPost('/api/workspaces/select', {
    path: pathOrUri,
    uris: state.hostUris,
    ...extra,
  });
  state.workspaces = res;
  if (!extra.toggleFavorite && !extra.removeRecent) {
    const changed = (res.activeRoot || '').toLowerCase() !== state.activeRoot.toLowerCase();
    state.activeRoot = res.activeRoot || '';
    renderWorkspaceHeader();
    if (changed) await onWorkspaceActivated();
  }
  if (!$('ws-modal-backdrop').classList.contains('hidden')) {
    renderWorkspaceModalSections();
  }
}

async function onWorkspaceActivated() {
  state.treeNodes.clear();
  state.expanded = new Set(['']);
  state.selectedPath = '';
  state.selectedType = 'directory';
  state.searchResults = null;
  state.gitRepos = [];
  state.activeGitRepo = '';
  state.gitTotalChangesAllRepos = 0;
  setCommitComposerOpen(false);
  $('search-results').innerHTML = '<div class="empty-state">Digite um termo para pesquisar no projeto.</div>';
  $('search-meta').textContent = '';
  closePreview(true);
  await Promise.all([loadFolder('', true), refreshGitStatus()]);
  startFsWatcher(state.activeRoot);
}

// ---------- Real-Time Workspace Watcher & Drag Mentions ----------
function attachMentionDrag(el, relPath) {
  if (!el || !relPath) return;
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    if (!e.dataTransfer) return;
    const mention = `@${relPath}`;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', mention);
    e.dataTransfer.setData('application/x-antigravity-mention', mention);
    el.classList.add('is-dragging');
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('is-dragging');
  });
}

function stopFsWatcher() {
  if (state.fsWatchAbort) {
    state.fsWatchAbort.abort();
    state.fsWatchAbort = null;
  }
  if (gitWatchDebounceTimer) {
    clearTimeout(gitWatchDebounceTimer);
    gitWatchDebounceTimer = null;
  }
  state.fsWatchPendingDirs.clear();
  state.fsWatchPendingGit = false;
  state.fsWatchRoot = '';
}

function scheduleGitWatchRefresh() {
  if (gitWatchDebounceTimer) clearTimeout(gitWatchDebounceTimer);
  gitWatchDebounceTimer = setTimeout(() => {
    gitWatchDebounceTimer = null;
    if (!state.activeRoot || document.hidden || state.gitBusy) return;
    refreshGitStatus({ discoverRepos: true }).catch(() => {});
  }, 400);
}

async function applyFsWatchBatch(dirs, gitChanged) {
  if (!state.activeRoot) return;
  if (document.hidden) {
    for (const d of dirs) state.fsWatchPendingDirs.add(d);
    if (gitChanged) state.fsWatchPendingGit = true;
    return;
  }

  const dirsToReload = dirs.filter(
    (d) => d === '' || (state.expanded.has(d) && state.treeNodes.has(d)),
  );
  if (dirsToReload.length) {
    await Promise.all(dirsToReload.map((d) => loadFolder(d, true, { silent: true })));
  }
  if (gitChanged || dirs.length) {
    scheduleGitWatchRefresh();
  }
}

async function waitForDocumentVisible() {
  if (!document.hidden) return;
  await new Promise((resolve) => {
    const onVis = () => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', onVis);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', onVis);
  });
}

async function startFsWatcher(rootPath) {
  stopFsWatcher();
  if (!rootPath) return;

  const controller = new AbortController();
  state.fsWatchAbort = controller;
  state.fsWatchRoot = rootPath;
  state.fsWatchSeq = 0;

  while (state.activeRoot === rootPath && state.fsWatchAbort === controller && !controller.signal.aborted) {
    if (document.hidden) {
      await waitForDocumentVisible();
      if (state.activeRoot !== rootPath || controller.signal.aborted) break;
      if (state.fsWatchPendingDirs.size || state.fsWatchPendingGit) {
        const pendingDirs = Array.from(state.fsWatchPendingDirs);
        const pendingGit = state.fsWatchPendingGit;
        state.fsWatchPendingDirs.clear();
        state.fsWatchPendingGit = false;
        await applyFsWatchBatch(pendingDirs, pendingGit);
      }
    }

    try {
      const res = await apiGet(
        '/api/fs/events',
        { root: rootPath, since: state.fsWatchSeq },
        { signal: controller.signal },
      );
      if (state.activeRoot !== rootPath || controller.signal.aborted) break;
      if (typeof res.seq === 'number') state.fsWatchSeq = res.seq;
      if ((res.dirs && res.dirs.length) || res.gitChanged) {
        await applyFsWatchBatch(res.dirs || [], Boolean(res.gitChanged));
      }
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ---------- Tree Loading & Rendering ----------
async function loadFolder(relPath = '', force = false, { silent = false } = {}) {
  if (!state.activeRoot) return;
  const existing = state.treeNodes.get(relPath);
  if (existing?.loading) return;
  if (existing?.loaded && !force) return;

  if (!silent || !existing?.loaded) {
    state.treeNodes.set(relPath, {
      entries: existing?.entries || [],
      loaded: false,
      loading: true,
    });
    renderTree();
  }

  try {
    const data = await apiGet('/api/tree', {
      root: state.activeRoot,
      path: relPath,
      showHidden: state.showHidden ? '1' : '0',
      showIgnored: state.showIgnored ? '1' : '0',
    });
    state.treeNodes.set(relPath, {
      entries: data.entries || [],
      loaded: true,
      loading: false,
    });
  } catch (err) {
    if (silent && relPath !== '') {
      state.treeNodes.delete(relPath);
      state.expanded.delete(relPath);
    } else {
      state.treeNodes.set(relPath, { entries: [], loaded: true, loading: false });
      if (!silent) showToast(err.message, true);
    }
  }
  renderTree();
}

async function refreshExplorer() {
  const toReload = Array.from(state.expanded);
  if (!toReload.includes('')) toReload.unshift('');
  await Promise.all(toReload.map((dir) => loadFolder(dir, true)));
  await refreshGitStatus();
  setStatus('Árvore atualizada');
}

function getVisibleFlatRows() {
  const filter = state.treeFilter.trim().toLowerCase();
  const rows = [];

  const matchesFilterSubtree = (entry) => {
    if (!filter) return true;
    if (entry.name.toLowerCase().includes(filter)) return true;
    if (entry.type === 'directory') {
      const childNode = state.treeNodes.get(entry.relPath);
      if (childNode?.entries?.some((child) => matchesFilterSubtree(child))) return true;
    }
    return false;
  };

  const walk = (relPath, depth) => {
    const node = state.treeNodes.get(relPath);
    if (!node) return;
    if (node.loading && !node.entries.length) {
      rows.push({ kind: 'loading', relPath, depth });
      return;
    }
    for (const entry of node.entries) {
      if (!matchesFilterSubtree(entry)) continue;
      const isDir = entry.type === 'directory';
      const isExpanded = isDir && (state.expanded.has(entry.relPath) || Boolean(filter && state.treeNodes.has(entry.relPath)));
      rows.push({ kind: 'entry', entry, depth, isExpanded });
      if (isDir && isExpanded) {
        walk(entry.relPath, depth + 1);
      }
    }
  };

  walk('', 0);
  return rows;
}

function renderTree() {
  const container = $('tree-container');
  if (!state.activeRoot) {
    container.innerHTML = '<div class="empty-state">Nenhum workspace ativo.</div>';
    return;
  }

  const rootNode = state.treeNodes.get('');
  if (rootNode?.loading && !rootNode.entries.length) {
    container.innerHTML = '<div class="empty-state">Carregando arquivos...</div>';
    return;
  }

  const rows = getVisibleFlatRows();
  if (!rows.length) {
    const msg = state.treeFilter.trim()
      ? 'Nenhum arquivo corresponde ao filtro.'
      : 'Pasta vazia.';
    container.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const row of rows) {
    if (row.kind === 'loading') {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'tree-loading-row';
      loadingEl.style.paddingLeft = `${14 + row.depth * 14}px`;
      loadingEl.textContent = 'Carregando...';
      frag.appendChild(loadingEl);
      continue;
    }

    const { entry, depth, isExpanded } = row;
    const isDir = entry.type === 'directory';
    let gitLookupPath = entry.relPath;
    if (state.activeGitRepo) {
      const prefix = `${state.activeGitRepo}/`;
      gitLookupPath = entry.relPath.startsWith(prefix) ? entry.relPath.slice(prefix.length) : '';
    }
    const gitStatus = gitLookupPath
      ? isDir
        ? state.git.folders?.[gitLookupPath]
        : state.git.files?.[gitLookupPath]
      : '';

    const el = document.createElement('div');
    el.className = 'tree-row';
    el.setAttribute('role', 'treeitem');
    el.dataset.relPath = entry.relPath;
    el.dataset.type = entry.type;
    if (isDir) el.setAttribute('aria-expanded', String(isExpanded));
    if (state.selectedPath === entry.relPath) el.classList.add('selected');
    if (entry.name.startsWith('.')) el.classList.add('is-hidden-entry');
    if (gitStatus) el.classList.add(`git-${gitStatus.toLowerCase()}`);
    attachMentionDrag(el, entry.relPath);

    // Indent guides
    const guides = document.createElement('span');
    guides.className = 'tree-guides';
    for (let i = 0; i < depth; i++) {
      const g = document.createElement('span');
      g.className = 'tree-guide';
      guides.appendChild(g);
    }
    if (depth === 0) {
      guides.style.width = '6px';
    }
    el.appendChild(guides);

    // Twist chevron
    const twist = document.createElement('span');
    twist.className = `tree-twist${isDir ? (isExpanded ? ' expanded' : '') : ' spacer'}`;
    twist.innerHTML = '<svg class="icon" style="width:12px;height:12px" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg>';
    el.appendChild(twist);

    // Icon
    const iconSpan = document.createElement('span');
    iconSpan.className = 'tree-item-icon';
    iconSpan.innerHTML = getEntryIconHtml(entry, isExpanded);
    el.appendChild(iconSpan);

    // Name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-name';
    nameSpan.textContent = entry.name;
    nameSpan.title = entry.relPath;
    el.appendChild(nameSpan);

    // Git status badge
    if (gitStatus) {
      if (isDir) {
        const dot = document.createElement('span');
        dot.className = 'git-dot';
        dot.title = `Alterações Git (${gitStatus})`;
        el.appendChild(dot);
      } else {
        const badge = document.createElement('span');
        badge.className = `git-badge ${gitStatus}`;
        badge.textContent = gitStatus;
        el.appendChild(badge);
      }
    }

    // Quick '@' mention button
    const mentionBtn = document.createElement('button');
    mentionBtn.type = 'button';
    mentionBtn.className = 'row-mention-btn';
    mentionBtn.title = 'Copiar @mention para o chat';
    mentionBtn.setAttribute('aria-label', `Copiar @mention de ${entry.name}`);
    mentionBtn.textContent = '@';
    mentionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(`@${entry.relPath}`, '@mention');
    });
    el.appendChild(mentionBtn);

    // '...' row action button
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'row-more-btn';
    moreBtn.title = 'Mais ações';
    moreBtn.setAttribute('aria-label', `Ações para ${entry.name}`);
    moreBtn.textContent = '⋯';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedPath = entry.relPath;
      state.selectedType = entry.type;
      renderTree();
      const rect = moreBtn.getBoundingClientRect();
      openEntryContextMenu(entry, rect.right, rect.bottom + 2);
    });
    el.appendChild(moreBtn);

    el.addEventListener('click', () => handleTreeEntryClick(entry));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      state.selectedPath = entry.relPath;
      state.selectedType = entry.type;
      renderTree();
      openEntryContextMenu(entry, e.clientX, e.clientY);
    });

    frag.appendChild(el);
  }

  container.innerHTML = '';
  container.appendChild(frag);
}

async function handleTreeEntryClick(entry) {
  state.selectedPath = entry.relPath;
  state.selectedType = entry.type;
  if (entry.type === 'directory') {
    if (state.expanded.has(entry.relPath)) {
      state.expanded.delete(entry.relPath);
      renderTree();
    } else {
      state.expanded.add(entry.relPath);
      renderTree();
      await loadFolder(entry.relPath, false);
    }
    return;
  }
  renderTree();
  await openPreview(entry.relPath);
}

// ---------- Git Status, Actions, Stash, Remotes & Branches ----------
function createEmptyGitState() {
  return {
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

function toWorkspaceRelPath(relPath, repoRel = state.activeGitRepo) {
  const cleanRepo = String(repoRel || '').replace(/^[/\\]+|[/\\]+$/g, '');
  const cleanFile = String(relPath || '').replace(/^[/\\]+/, '');
  if (!cleanRepo) return cleanFile;
  if (!cleanFile) return cleanRepo;
  return `${cleanRepo}/${cleanFile}`;
}

function resolveGitLocationForWorkspacePath(wsRelPath) {
  const clean = String(wsRelPath || '').replace(/^[/\\]+/, '');
  if (state.activeGitRepo) {
    const prefix = `${state.activeGitRepo}/`;
    if (clean.startsWith(prefix)) {
      return { repo: state.activeGitRepo, gitRelPath: clean.slice(prefix.length) };
    }
  }
  const repos = [...(state.gitRepos || [])].sort((a, b) => (b.relPath?.length || 0) - (a.relPath?.length || 0));
  for (const r of repos) {
    if (!r.relPath) return { repo: '', gitRelPath: clean };
    const prefix = `${r.relPath}/`;
    if (clean.startsWith(prefix)) {
      return { repo: r.relPath, gitRelPath: clean.slice(prefix.length) };
    }
  }
  return { repo: '', gitRelPath: clean };
}

function setCommitComposerOpen(open) {
  state.gitComposerOpen = Boolean(open);
  const composer = $('git-commit-composer');
  const toggleBtn = $('btn-git-commit-toggle');
  if (composer) composer.classList.toggle('hidden', !state.gitComposerOpen);
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', String(state.gitComposerOpen));
    toggleBtn.classList.toggle('is-active', state.gitComposerOpen);
  }
  if (state.gitComposerOpen) {
    requestAnimationFrame(() => $('git-commit-msg')?.focus());
  }
}

async function selectGitRepo(repoRelPath) {
  if (repoRelPath === state.activeGitRepo && state.git.isRepo) return;
  state.activeGitRepo = repoRelPath || '';
  state.gitFilter = '';
  $('git-filter').value = '';
  $('git-filter-clear').classList.add('hidden');
  setCommitComposerOpen(false);
  await refreshGitStatus({ loadStashes: true, discoverRepos: false });
}

function renderGitRepoSwitcher() {
  const container = $('git-repo-switcher');
  if (!container) return;
  const repos = state.gitRepos || [];
  if (repos.length <= 1) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  container.classList.remove('hidden');
  const frag = document.createDocumentFragment();
  for (const r of repos) {
    const isActive = r.relPath === state.activeGitRepo;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'tab';
    btn.className = `git-repo-pill${isActive ? ' active' : ''}`;
    btn.setAttribute('aria-selected', String(isActive));
    btn.title = `${r.relPath || '(raiz do workspace)'} · ${r.branch || 'HEAD'}`;

    const top = document.createElement('div');
    top.className = 'git-repo-pill-top';
    const nameEl = document.createElement('span');
    nameEl.className = 'git-repo-pill-name';
    nameEl.textContent = r.name || '(raiz)';
    const cnt = document.createElement('span');
    const total = Number(r.totalChanges) || 0;
    cnt.className = `git-repo-pill-count${total === 0 ? ' zero' : ''}`;
    cnt.textContent = String(total);
    top.append(nameEl, cnt);

    const branchEl = document.createElement('div');
    branchEl.className = 'git-repo-pill-branch';
    branchEl.textContent = r.branch || 'HEAD';

    btn.append(top, branchEl);
    btn.addEventListener('click', () => selectGitRepo(r.relPath));
    frag.appendChild(btn);
  }
  container.innerHTML = '';
  container.appendChild(frag);
}

async function refreshGitStatus({ loadStashes = false, discoverRepos = true } = {}) {
  if (!state.activeRoot) return;
  try {
    if (discoverRepos) {
      try {
        const reposRes = await apiGet('/api/git/repos', { root: state.activeRoot });
        state.gitRepos = Array.isArray(reposRes.repos) ? reposRes.repos : [];
        state.gitTotalChangesAllRepos = Number(reposRes.totalChanges) || 0;
        if (state.gitRepos.length > 0) {
          if (!state.gitRepos.some((r) => r.relPath === state.activeGitRepo)) {
            state.activeGitRepo = state.gitRepos[0].relPath || '';
          }
        } else {
          state.activeGitRepo = '';
        }
      } catch {
        // Fallback smoothly if /api/git/repos is unavailable
      }
    }

    const data = await apiGet('/api/git-status', {
      root: state.activeRoot,
      repo: state.activeGitRepo,
    });
    state.git = { ...createEmptyGitState(), ...data };

    if (!discoverRepos && state.gitRepos.length > 0) {
      const idx = state.gitRepos.findIndex((r) => r.relPath === state.activeGitRepo);
      if (idx !== -1) {
        state.gitRepos[idx] = {
          ...state.gitRepos[idx],
          branch: state.git.branch || state.git.oid?.slice(0, 7) || 'HEAD',
          ahead: state.git.ahead || 0,
          behind: state.git.behind || 0,
          stagedCount: state.git.stagedCount || 0,
          unstagedCount: state.git.unstagedCount || 0,
          untrackedCount: state.git.untrackedCount || 0,
          totalChanges: state.git.entries?.length || 0,
        };
        state.gitTotalChangesAllRepos = state.gitRepos.reduce((acc, r) => acc + (Number(r.totalChanges) || 0), 0);
      }
    }

    const remotes = state.git.remotes || [];
    if (remotes.length && !remotes.some((r) => r.name === state.gitSelectedRemote)) {
      const origin = remotes.find((r) => r.name === 'origin');
      state.gitSelectedRemote = (origin || remotes[0]).name;
    } else if (!remotes.length) {
      state.gitSelectedRemote = '';
    }
    if (state.git.isRepo && (loadStashes || $('git-stash-details').open || state.activeTab === 'git')) {
      await refreshGitStashes({ skipRender: true });
    } else if (!state.git.isRepo) {
      state.gitStashes = [];
    }
    renderGitTab();
    renderTree();
  } catch (err) {
    state.git = createEmptyGitState();
    state.gitStashes = [];
    renderGitTab(err.message);
  }
}

async function refreshGitStashes({ skipRender = false } = {}) {
  if (!state.activeRoot || !state.git.isRepo) {
    state.gitStashes = [];
    return;
  }
  try {
    const res = await apiGet('/api/git/stashes', { root: state.activeRoot, repo: state.activeGitRepo });
    state.gitStashes = res.stashes || [];
    state.git.stashCount = state.gitStashes.length;
    if (!skipRender) renderGitStashAndRemotes();
  } catch {
    state.gitStashes = [];
  }
}

function setGitBusy(busy, statusMsg = '') {
  state.gitBusy = busy;
  for (const id of ['btn-git-commit-toggle', 'btn-git-commit', 'btn-git-fetch', 'btn-git-pull', 'btn-git-push']) {
    const btn = $(id);
    if (btn) {
      const isNet = id === 'btn-git-fetch' || id === 'btn-git-pull' || id === 'btn-git-push';
      btn.disabled = busy || !state.git.isRepo || (isNet && !(state.git.remotes?.length));
    }
  }
  if (statusMsg) setStatus(statusMsg);
}

function renderGitTab(errorMessage = '') {
  renderGitRepoSwitcher();

  const badge = $('git-tab-badge');
  const repoCount = state.git.entries?.length || 0;
  const badgeCount = state.gitRepos.length > 1 ? state.gitTotalChangesAllRepos : repoCount;
  badge.textContent = String(badgeCount);
  badge.classList.toggle('hidden', badgeCount === 0);

  const g = state.git;
  $('git-branch-name').textContent = g.isRepo ? (g.branch || g.oid?.slice(0, 7) || 'HEAD') : 'Sem Git';
  $('git-branch-btn').disabled = !g.isRepo;
  $('git-detached-badge').classList.toggle('hidden', !(g.isRepo && g.detached));

  const abEl = $('git-ahead-behind');
  if (g.isRepo && (g.ahead > 0 || g.behind > 0)) {
    const parts = [];
    if (g.ahead > 0) parts.push(`↑${g.ahead}`);
    if (g.behind > 0) parts.push(`↓${g.behind}`);
    abEl.textContent = parts.join(' ');
    abEl.classList.remove('hidden');
  } else {
    abEl.classList.add('hidden');
  }

  // Remote selector & network buttons
  const remoteSelect = $('git-remote-select');
  const remotes = g.remotes || [];
  remoteSelect.innerHTML = '';
  if (!remotes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(sem remote)';
    remoteSelect.appendChild(opt);
    remoteSelect.disabled = true;
  } else {
    remoteSelect.disabled = false;
    for (const r of remotes) {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = r.name;
      if (r.name === state.gitSelectedRemote) opt.selected = true;
      remoteSelect.appendChild(opt);
    }
  }
  const netDisabled = state.gitBusy || !g.isRepo || !remotes.length;
  $('btn-git-fetch').disabled = netDisabled;
  $('btn-git-pull').disabled = netDisabled;
  $('btn-git-push').disabled = netDisabled;
  $('btn-git-commit-toggle').disabled = state.gitBusy || !g.isRepo;
  $('btn-git-commit').disabled = state.gitBusy || !g.isRepo;

  const repoBody = $('git-repo-body');
  const emptyEl = $('git-empty-state');
  if (!g.isRepo) {
    setCommitComposerOpen(false);
    $('git-summary').textContent = 'Sem repositório';
    $('git-last-commit').classList.add('hidden');
    $('git-staged-section').classList.add('hidden');
    $('git-changes-section').classList.add('hidden');
    $('git-stash-details').classList.add('hidden');
    $('git-remotes-details').classList.add('hidden');
    emptyEl.textContent = errorMessage || 'Esta pasta não é um repositório Git.';
    emptyEl.classList.remove('hidden');
    repoBody.querySelector('.git-commit-box').classList.add('hidden');
    repoBody.querySelector('.git-filter-bar').classList.add('hidden');
    return;
  }

  repoBody.querySelector('.git-commit-box').classList.remove('hidden');
  repoBody.querySelector('.git-filter-bar').classList.remove('hidden');
  $('git-stash-details').classList.remove('hidden');
  $('git-remotes-details').classList.remove('hidden');

  $('git-summary').textContent = repoCount ? `${repoCount} alter.` : 'Limpo';
  const lastEl = $('git-last-commit');
  if (g.lastCommit) {
    lastEl.textContent = `Último: ${g.lastCommit.shortHash} · ${g.lastCommit.subject}`;
    lastEl.title = `${g.lastCommit.shortHash} (${g.lastCommit.author}) ${g.lastCommit.subject}`;
    lastEl.classList.remove('hidden');
  } else {
    lastEl.classList.add('hidden');
  }

  const filter = state.gitFilter.trim().toLowerCase();
  const staged = (g.staged || []).filter((it) => !filter || it.relPath.toLowerCase().includes(filter));
  const unstaged = (g.unstaged || []).filter((it) => !filter || it.relPath.toLowerCase().includes(filter));

  $('git-staged-count').textContent = String(staged.length);
  $('git-changes-count').textContent = String(unstaged.length);
  $('git-staged-section').classList.toggle('hidden', staged.length === 0);
  $('git-changes-section').classList.toggle('hidden', unstaged.length === 0);

  if (!staged.length && !unstaged.length) {
    emptyEl.textContent = filter ? 'Nenhum arquivo alterado corresponde ao filtro.' : 'Nenhuma alteração pendente.';
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
  }

  renderGitFileList($('git-staged-list'), staged, true);
  renderGitFileList($('git-changes-list'), unstaged, false);
  renderGitStashAndRemotes();
}

function renderGitFileList(container, items, isStaged) {
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const wsRelPath = toWorkspaceRelPath(item.relPath);
    const row = document.createElement('div');
    row.className = 'git-row';
    if (state.preview?.relPath === wsRelPath && state.previewOpen) row.classList.add('selected');
    attachMentionDrag(row, wsRelPath);

    const slash = item.relPath.lastIndexOf('/');
    const fileName = slash === -1 ? item.relPath : item.relPath.slice(slash + 1);
    const dirName = slash === -1 ? '' : item.relPath.slice(0, slash);
    const extIdx = fileName.lastIndexOf('.');
    const ext = extIdx > 0 ? fileName.slice(extIdx) : '';

    const icon = document.createElement('span');
    icon.className = 'tree-item-icon';
    icon.innerHTML = getEntryIconHtml({ type: 'file', ext });

    const pathWrap = document.createElement('span');
    pathWrap.className = 'git-row-path';
    pathWrap.textContent = fileName;
    pathWrap.title = wsRelPath;
    if (dirName) {
      const dirSpan = document.createElement('span');
      dirSpan.className = 'git-row-dir';
      dirSpan.textContent = dirName;
      pathWrap.appendChild(dirSpan);
    }

    const actions = document.createElement('span');
    actions.className = 'git-row-actions';

    if (isStaged) {
      const unstageBtn = makeGitActBtn('−', 'Remover do Stage (Unstage)', () => gitUnstage([item.relPath]));
      actions.appendChild(unstageBtn);
    } else {
      const stageBtn = makeGitActBtn('+', 'Adicionar ao Stage', () => gitStage([item.relPath]));
      const discardBtn = makeGitActBtn('↶', 'Descartar alterações', () => gitDiscardConfirm([item.relPath], item.untracked), true);
      actions.append(stageBtn, discardBtn);
    }
    const ignoreBtn = makeGitActBtn('⊘', 'Adicionar ao .gitignore...', () =>
      openGitIgnoreModal({
        repo: state.activeGitRepo,
        repoRelPath: item.relPath,
        wsRelPath,
        isDir: false,
        status: item.status,
        untracked: Boolean(item.untracked),
      }),
    );
    const mentionBtn = makeGitActBtn('@', 'Copiar @mention para o chat', () => copyText(`@${wsRelPath}`, '@mention'));
    actions.append(ignoreBtn, mentionBtn);

    const statusBadge = document.createElement('span');
    statusBadge.className = `git-badge ${item.status}`;
    statusBadge.textContent = item.status;

    row.append(icon, pathWrap, actions, statusBadge);
    row.addEventListener('click', () =>
      openGitDiffPreview(item.relPath, { staged: isStaged, status: item.status, repo: state.activeGitRepo }),
    );
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openGitEntryContextMenu(item, isStaged, e.clientX, e.clientY);
    });
    frag.appendChild(row);
  }
  container.innerHTML = '';
  container.appendChild(frag);
}

function makeGitActBtn(label, title, onClick, isDanger = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `git-act-btn${isDanger ? ' danger' : ''}`;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function renderGitStashAndRemotes() {
  const stashes = state.gitStashes || [];
  $('git-stash-count').textContent = String(state.git.stashCount ?? stashes.length);
  const stashList = $('git-stash-list');
  stashList.innerHTML = '';
  if (!stashes.length) {
    stashList.innerHTML = '<div class="empty-state" style="padding:8px">Nenhum stash salvo.</div>';
  } else {
    for (const s of stashes) {
      const row = document.createElement('div');
      row.className = 'stash-row';
      const info = document.createElement('div');
      info.className = 'stash-label';
      info.innerHTML = `<span class="stash-msg">${escapeHtml(s.message || s.ref)}</span><span class="stash-ref">${escapeHtml(s.ref)}</span>`;

      const popBtn = document.createElement('button');
      popBtn.type = 'button';
      popBtn.className = 'btn btn-ghost btn-xs';
      popBtn.textContent = 'Pop';
      popBtn.addEventListener('click', () => runStashOp('pop', { ref: s.ref }));

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn btn-ghost btn-xs';
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', () => runStashOp('apply', { ref: s.ref }));

      const dropBtn = document.createElement('button');
      dropBtn.type = 'button';
      dropBtn.className = 'btn btn-ghost btn-xs';
      dropBtn.textContent = 'Drop';
      dropBtn.addEventListener('click', async () => {
        const ok = await openDialog({
          title: 'Remover Stash',
          message: `Excluir "${s.ref}" (${s.message || 'sem mensagem'})?`,
          confirmText: 'Excluir',
          danger: true,
        });
        if (ok) await runStashOp('drop', { ref: s.ref });
      });

      row.append(info, popBtn, applyBtn, dropBtn);
      stashList.appendChild(row);
    }
  }

  const remotes = state.git.remotes || [];
  $('git-remotes-count').textContent = String(remotes.length);
  const remList = $('git-remotes-list');
  remList.innerHTML = '';
  if (!remotes.length) {
    remList.innerHTML = '<div class="empty-state" style="padding:8px">Nenhum remote configurado.</div>';
  } else {
    for (const r of remotes) {
      const row = document.createElement('div');
      row.className = 'remote-row';
      const info = document.createElement('div');
      info.className = 'remote-info';
      info.innerHTML = `<span class="remote-name">${escapeHtml(r.name)}</span><span class="remote-url">${escapeHtml(r.pushUrl || r.fetchUrl)}</span>`;
      row.appendChild(info);
      remList.appendChild(row);
    }
  }
}

async function gitStage(paths, all = false) {
  if (!state.activeRoot || state.gitBusy) return;
  setGitBusy(true, 'Adicionando ao Stage...');
  try {
    await apiPost('/api/git/stage', { root: state.activeRoot, repo: state.activeGitRepo, paths, all });
    await refreshGitStatus();
    setStatus('Stage atualizado');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setGitBusy(false);
  }
}

async function gitUnstage(paths, all = false) {
  if (!state.activeRoot || state.gitBusy) return;
  setGitBusy(true, 'Removendo do Stage...');
  try {
    await apiPost('/api/git/unstage', { root: state.activeRoot, repo: state.activeGitRepo, paths, all });
    await refreshGitStatus();
    setStatus('Unstage concluído');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setGitBusy(false);
  }
}

async function gitDiscardConfirm(paths, isUntracked = false) {
  const targetLabel = paths.length === 1 ? paths[0] : `${paths.length} arquivos`;
  const confirmed = await openDialog({
    title: 'Descartar Alterações',
    message: isUntracked
      ? `Excluir permanentemente o arquivo não rastreado "${targetLabel}"?`
      : `Reverter alterações locais em "${targetLabel}"? Isso não pode ser desfeito.`,
    confirmText: 'Descartar',
    danger: true,
  });
  if (!confirmed) return;
  setGitBusy(true, 'Descartando alterações...');
  try {
    await apiPost('/api/git/discard', { root: state.activeRoot, repo: state.activeGitRepo, paths });
    if (state.preview && paths.some((p) => toWorkspaceRelPath(p) === state.preview.relPath)) {
      forceClosePreview();
    }
    await Promise.all([refreshGitStatus(), refreshExplorer()]);
    showToast(`Alterações descartadas: ${targetLabel}`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setGitBusy(false);
  }
}

async function gitCommitSubmit() {
  if (!state.activeRoot || !state.git.isRepo || state.gitBusy) return;
  const msgEl = $('git-commit-msg');
  const message = msgEl.value.trim();
  if (!message) {
    showToast('Digite uma mensagem de commit.', true);
    msgEl.focus();
    return;
  }
  if (!state.git.stagedCount) {
    showToast('Nenhum arquivo em Stage. Clique em + ou "Stage All" antes de commitar.', true);
    return;
  }
  setGitBusy(true, 'Executando commit...');
  try {
    const res = await apiPost('/api/git/commit', {
      root: state.activeRoot,
      repo: state.activeGitRepo,
      message,
    });
    msgEl.value = '';
    setCommitComposerOpen(false);
    await refreshGitStatus();
    const short = res.lastCommit?.shortHash ? ` (${res.lastCommit.shortHash})` : '';
    showToast(`Commit realizado${short}`);
    setStatus('Commit concluído');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setGitBusy(false);
  }
}

async function runStashOp(action, extra = {}) {
  if (!state.activeRoot || state.gitBusy) return;
  setGitBusy(true, `Executando stash ${action}...`);
  try {
    await apiPost('/api/git/stash', { root: state.activeRoot, repo: state.activeGitRepo, action, ...extra });
    await Promise.all([refreshGitStatus({ loadStashes: true }), refreshExplorer()]);
    showToast(`Stash ${action} concluído`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setGitBusy(false);
  }
}

async function promptStashPush() {
  const message = await openDialog({
    title: 'Guardar no Stash',
    inputLabel: 'Mensagem opcional para identificar o stash',
    placeholder: 'Ex.: wip-ajustes-ui',
    confirmText: 'Guardar Stash',
  });
  if (message === null) return;
  await runStashOp('push', { message, includeUntracked: true });
}

async function runRemoteOp(action) {
  if (!state.activeRoot || !state.git.isRepo || state.gitBusy) return;
  const remote = $('git-remote-select').value || state.gitSelectedRemote || 'origin';
  setGitBusy(true, `Git ${action} (${remote})...`);
  try {
    const payload = { root: state.activeRoot, repo: state.activeGitRepo, action, remote };
    if (action === 'fetch') payload.prune = true;
    if (action === 'push') {
      payload.branch = state.git.branch;
      if (!state.git.upstream) payload.setUpstream = true;
    }
    await apiPost('/api/git/remote', payload);
    await refreshGitStatus();
    showToast(`Git ${action} (${remote}) concluído`);
    setStatus(`Git ${action} concluído`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setGitBusy(false);
  }
}

async function copyAllGitMentions() {
  const seen = new Set();
  const list = [];
  for (const item of [...(state.git.staged || []), ...(state.git.unstaged || [])]) {
    const wsRelPath = toWorkspaceRelPath(item.relPath);
    if (!seen.has(wsRelPath)) {
      seen.add(wsRelPath);
      list.push(`@${wsRelPath}`);
    }
  }
  if (!list.length) {
    showToast('Nenhum arquivo alterado para mencionar.', true);
    return;
  }
  await copyText(list.join(' '), `${list.length} @mentions copiados`);
}

async function copyFullGitDiff() {
  if (!state.activeRoot || !state.git.isRepo) return;
  try {
    const [unstagedRes, stagedRes] = await Promise.all([
      apiGet('/api/git/diff', { root: state.activeRoot, repo: state.activeGitRepo, staged: '0' }),
      apiGet('/api/git/diff', { root: state.activeRoot, repo: state.activeGitRepo, staged: '1' }),
    ]);
    const parts = [stagedRes.diff, unstagedRes.diff].filter((d) => d && d.trim());
    if (!parts.length) {
      showToast('Sem diff textual para copiar (verifique arquivos untracked).', true);
      return;
    }
    await copyText(parts.join('\n'), 'Diff copiado');
  } catch (err) {
    showToast(err.message, true);
  }
}

function openGitEntryContextMenu(item, isStaged, x, y) {
  const menu = $('context-menu');
  menu.innerHTML = '';
  state.contextMenuOpen = true;
  const wsRelPath = toWorkspaceRelPath(item.relPath);
  const slash = wsRelPath.lastIndexOf('/');
  const fileName = slash === -1 ? wsRelPath : wsRelPath.slice(slash + 1);
  const fullPath = `${state.activeRoot}\\${wsRelPath.replace(/\//g, '\\')}`;

  addMenuButton(menu, 'Abrir Diff', () =>
    openGitDiffPreview(item.relPath, { staged: isStaged, status: item.status, repo: state.activeGitRepo }),
  );
  if (item.status !== 'D') {
    addMenuButton(menu, 'Abrir Arquivo Completo', () => openPreview(wsRelPath));
    addMenuButton(menu, 'Mostrar na Pasta', () => openInExternalApp(wsRelPath, 'explorer'));
  }
  addMenuSeparator(menu);
  if (isStaged) {
    addMenuButton(menu, 'Remover do Stage (Unstage)', () => gitUnstage([item.relPath]));
  } else {
    addMenuButton(menu, 'Adicionar ao Stage', () => gitStage([item.relPath]));
    addMenuButton(menu, 'Descartar Alterações...', () => gitDiscardConfirm([item.relPath], item.untracked), { danger: true });
  }
  addMenuSeparator(menu);
  const exactPattern = `/${String(item.relPath || '').replace(/^\/+/, '')}`;
  const parentDir = getParentRel(item.relPath);
  addMenuButton(menu, `Ignorar arquivo (${exactPattern})`, () =>
    quickAddGitIgnore({
      repo: state.activeGitRepo,
      pattern: exactPattern,
      untrackPaths: item.untracked ? [] : [item.relPath],
    }),
  );
  if (parentDir) {
    const parentPattern = `/${parentDir}/`;
    addMenuButton(menu, `Ignorar pasta (${parentPattern})`, () =>
      quickAddGitIgnore({
        repo: state.activeGitRepo,
        pattern: parentPattern,
        untrackPaths: [],
      }),
    );
  }
  addMenuButton(menu, 'Personalizar no .gitignore...', () =>
    openGitIgnoreModal({
      repo: state.activeGitRepo,
      repoRelPath: item.relPath,
      wsRelPath,
      isDir: false,
      status: item.status,
      untracked: Boolean(item.untracked),
    }),
  );
  addMenuSeparator(menu);
  addMenuButton(menu, 'Copiar Caminho Relativo', () => copyText(wsRelPath, 'Relativo'));
  addMenuButton(menu, 'Copiar Caminho Absoluto', () => copyText(fullPath, 'Absoluto'));
  addMenuButton(menu, `Copiar @mention (${fileName})`, () => copyText(`@${wsRelPath}`, '@mention'));
  positionMenu(menu, x, y);
}

// ---------- Gitignore Assistant ----------
function buildClientGitIgnoreSuggestions(relPath, isDir = false) {
  const clean = String(relPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!clean) return [];

  const suggestions = [];
  const seen = new Set();
  const pushUnique = (label, pattern, kind) => {
    if (!pattern || seen.has(pattern)) return;
    seen.add(pattern);
    suggestions.push({ label, pattern, kind });
  };

  const parts = clean.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || clean;
  pushUnique(isDir ? 'Pasta exata' : 'Arquivo exato', `/${clean}${isDir ? '/' : ''}`, 'exact');

  const parentParts = parts.slice(0, -1);
  for (let i = parentParts.length; i >= 1; i -= 1) {
    const ancestor = parentParts.slice(0, i).join('/');
    pushUnique('Pasta ancestral', `/${ancestor}/`, 'folder');
  }

  if (!isDir) {
    const dotIdx = fileName.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < fileName.length - 1) {
      const ext = fileName.slice(dotIdx);
      if (parentParts.length > 0) {
        pushUnique('Extensão na pasta', `/${parentParts.join('/')}/*${ext}`, 'ext');
      }
      pushUnique('Extensão global', `*${ext}`, 'ext');
    }
  }

  return suggestions;
}

function globPatternToRegex(pattern) {
  const raw = String(pattern || '').trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('#') || raw.startsWith('!')) return null;

  const dirOnly = raw.endsWith('/');
  let body = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!body) return null;

  const anchored = raw.startsWith('/') || body.includes('/');

  // Convert gitignore globs (** / * / ?) into regex tokens safely
  let regexStr = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '*') {
      if (body[i + 1] === '*') {
        if (body[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 2;
        } else {
          regexStr += '.*';
          i += 1;
        }
      } else {
        regexStr += '[^/]*';
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regexStr += `\\${ch}`;
    } else {
      regexStr += ch;
    }
  }

  const prefix = anchored ? '^' : '(?:^|/)';
  const suffix = dirOnly ? '/.*$' : '(?:/.*)?$';
  try {
    return new RegExp(`${prefix}${regexStr}${suffix}`);
  } catch {
    return null;
  }
}

function countMatchingGitEntries(pattern, entries = state.git?.entries || []) {
  const re = globPatternToRegex(pattern);
  if (!re || !Array.isArray(entries) || entries.length === 0) return 0;

  const seen = new Set();
  let count = 0;
  for (const entry of entries) {
    const rel = String(entry?.relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    if (re.test(rel)) count += 1;
  }
  return count;
}

function resolveGitIgnoreTargetForEntry(entry) {
  if (!entry) return null;
  const clean = String(entry.relPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean || entry.name === '.git' || clean.split('/').includes('.git')) return null;

  let repo = '';
  let repoRelPath = '';
  const repos = Array.isArray(state.gitRepos) ? state.gitRepos : [];

  if (repos.length > 0) {
    const sorted = [...repos].sort((a, b) => (b.relPath?.length || 0) - (a.relPath?.length || 0));
    const matched = sorted.find((r) => (!r.relPath ? true : clean.startsWith(`${r.relPath}/`)));
    if (!matched) return null;
    repo = matched.relPath || '';
    repoRelPath = repo ? clean.slice(repo.length + 1) : clean;
  } else if (state.git?.isRepo) {
    repo = state.activeGitRepo || '';
    if (repo) {
      if (!clean.startsWith(`${repo}/`)) return null;
      repoRelPath = clean.slice(repo.length + 1);
    } else {
      repoRelPath = clean;
    }
  } else {
    return null;
  }

  if (!repoRelPath) return null;
  const gInfo = repo === state.activeGitRepo ? state.git?.files?.[repoRelPath] : null;
  return {
    repo,
    repoRelPath,
    wsRelPath: clean,
    isDir: entry.type === 'directory',
    status: gInfo?.status || '',
    untracked: gInfo ? Boolean(gInfo.untracked) : false,
  };
}

function syncGitIgnoreChipSelection() {
  const current = $('gitignore-pattern-input').value.trim();
  for (const chip of $('gitignore-chips').querySelectorAll('.gitignore-chip')) {
    const active = chip.dataset.pattern === current;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  }
}

function updateGitIgnoreMatchPreview() {
  const previewEl = $('gitignore-match-preview');
  const pattern = $('gitignore-pattern-input').value.trim();
  const target = state.gitIgnoreTarget;
  if (!previewEl) return;

  if (!pattern) {
    previewEl.textContent = 'Digite ou selecione um padrão acima.';
    previewEl.classList.remove('has-matches');
    return;
  }

  if (target && target.repo !== state.activeGitRepo) {
    previewEl.textContent = `Será gravado em ${toWorkspaceRelPath('.gitignore', target.repo)}`;
    previewEl.classList.remove('has-matches');
    return;
  }

  const count = countMatchingGitEntries(pattern);
  if (count > 0) {
    previewEl.textContent = `Afeta ${count} ${count === 1 ? 'arquivo pendente' : 'arquivos pendentes'} na lista atual do Git.`;
    previewEl.classList.add('has-matches');
  } else {
    previewEl.textContent = 'Nenhum arquivo pendente da lista atual corresponde a este padrão.';
    previewEl.classList.remove('has-matches');
  }
}

function openGitIgnoreModal({ repo = state.activeGitRepo, repoRelPath = '', wsRelPath = '', isDir = false, status = '', untracked = true } = {}) {
  if (!state.activeRoot) return;
  const cleanRel = String(repoRelPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleanRel) return;

  const targetRepo = repo || '';
  state.gitIgnoreTarget = {
    repo: targetRepo,
    repoRelPath: cleanRel,
    wsRelPath: wsRelPath || toWorkspaceRelPath(cleanRel, targetRepo),
    isDir: Boolean(isDir),
    status,
    untracked: Boolean(untracked),
  };

  const metaEl = $('gitignore-target-meta');
  metaEl.innerHTML = '';
  const pathSpan = document.createElement('span');
  pathSpan.className = 'gitignore-meta-path';
  pathSpan.textContent = isDir ? `${cleanRel}/` : cleanRel;
  metaEl.appendChild(pathSpan);
  if ((state.gitRepos || []).length > 1 || targetRepo) {
    const repoPill = document.createElement('span');
    repoPill.className = 'gitignore-repo-pill';
    repoPill.textContent = targetRepo || '(raiz)';
    repoPill.title = 'Repositório Git de destino';
    metaEl.appendChild(repoPill);
  }

  const suggestions = buildClientGitIgnoreSuggestions(cleanRel, Boolean(isDir));
  const chipsEl = $('gitignore-chips');
  chipsEl.innerHTML = '';
  for (const item of suggestions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'gitignore-chip';
    chip.dataset.pattern = item.pattern;
    chip.setAttribute('aria-pressed', 'false');

    const patSpan = document.createElement('span');
    patSpan.textContent = item.pattern;
    const kindSpan = document.createElement('span');
    kindSpan.className = 'gitignore-chip-kind';
    kindSpan.textContent = item.label;

    chip.append(patSpan, kindSpan);
    chip.addEventListener('click', () => {
      $('gitignore-pattern-input').value = item.pattern;
      $('gitignore-error').classList.add('hidden');
      syncGitIgnoreChipSelection();
      updateGitIgnoreMatchPreview();
      $('gitignore-pattern-input').focus();
    });
    chipsEl.appendChild(chip);
  }

  const inputEl = $('gitignore-pattern-input');
  inputEl.value = suggestions[0]?.pattern || `/${cleanRel}${isDir ? '/' : ''}`;

  const untrackChk = $('gitignore-untrack-chk');
  const shouldPrecheckUntrack = Boolean(status && status !== 'U' && !untracked);
  untrackChk.checked = shouldPrecheckUntrack;

  $('gitignore-error').textContent = '';
  $('gitignore-error').classList.add('hidden');
  $('gitignore-submit-btn').disabled = false;

  syncGitIgnoreChipSelection();
  updateGitIgnoreMatchPreview();

  $('gitignore-modal-backdrop').classList.remove('hidden');
  requestAnimationFrame(() => {
    inputEl.focus();
    inputEl.select();
  });
}

function closeGitIgnoreModal() {
  $('gitignore-modal-backdrop').classList.add('hidden');
  state.gitIgnoreTarget = null;
}

async function submitGitIgnoreRule({ repo = state.activeGitRepo, pattern, untrackPaths = [] } = {}) {
  if (!state.activeRoot) return null;
  const res = await apiPost('/api/git/ignore', {
    root: state.activeRoot,
    repo: repo || '',
    pattern,
    untrackPaths,
  });
  await refreshExplorer();
  const untrackSuffix = Array.isArray(res.untracked) && res.untracked.length > 0
    ? ` · ${res.untracked.length} removido(s) do índice`
    : '';
  if (res.alreadyExisted) {
    showToast(`Regra "${res.pattern}" já existe no .gitignore${untrackSuffix}`);
  } else {
    showToast(`Regra "${res.pattern}" adicionada ao .gitignore${untrackSuffix}`);
  }
  return res;
}

async function quickAddGitIgnore({ repo = state.activeGitRepo, pattern, untrackPaths = [] } = {}) {
  try {
    await submitGitIgnoreRule({ repo, pattern, untrackPaths });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleGitIgnoreSubmit(e) {
  e.preventDefault();
  const target = state.gitIgnoreTarget;
  if (!target) return;

  const pattern = $('gitignore-pattern-input').value.trim();
  const errEl = $('gitignore-error');
  if (!pattern) {
    errEl.textContent = 'Informe uma regra para adicionar ao .gitignore.';
    errEl.classList.remove('hidden');
    return;
  }
  if (/[\r\n\0]/.test(pattern)) {
    errEl.textContent = 'A regra não pode conter quebras de linha.';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  const submitBtn = $('gitignore-submit-btn');
  submitBtn.disabled = true;

  const untrackPaths = $('gitignore-untrack-chk').checked && target.repoRelPath
    ? [target.repoRelPath]
    : [];

  try {
    await submitGitIgnoreRule({
      repo: target.repo,
      pattern,
      untrackPaths,
    });
    closeGitIgnoreModal();
  } catch (err) {
    errEl.textContent = err.message || 'Falha ao atualizar .gitignore.';
    errEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
}

// ---------- Branch Manager Modal ----------
async function openBranchModal() {
  if (!state.activeRoot || !state.git.isRepo) return;
  state.pendingBranchSwitch = '';
  $('branch-dirty-banner').classList.add('hidden');
  $('branch-filter').value = '';
  $('branch-modal-backdrop').classList.remove('hidden');
  $('git-branch-btn').setAttribute('aria-expanded', 'true');
  await refreshBranchesList();
}

function closeBranchModal() {
  $('branch-modal-backdrop').classList.add('hidden');
  $('git-branch-btn').setAttribute('aria-expanded', 'false');
  state.pendingBranchSwitch = '';
}

async function refreshBranchesList() {
  try {
    const data = await apiGet('/api/git/branches', { root: state.activeRoot, repo: state.activeGitRepo });
    state.gitBranches = data;
    renderBranchModalList();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderBranchModalList() {
  const container = $('branch-list');
  const filter = $('branch-filter').value.trim().toLowerCase();
  const local = (state.gitBranches.local || []).filter((b) => !filter || b.name.toLowerCase().includes(filter));
  const remote = (state.gitBranches.remote || []).filter((b) => !filter || b.name.toLowerCase().includes(filter));
  container.innerHTML = '';

  const addSection = (title, list, isRemote) => {
    if (!list.length) return;
    const hdr = document.createElement('div');
    hdr.className = 'branch-section-title';
    hdr.textContent = title;
    container.appendChild(hdr);

    for (const b of list) {
      const row = document.createElement('div');
      row.className = `branch-row${b.current ? ' is-current' : ''}`;

      const nameEl = document.createElement('span');
      nameEl.className = 'branch-row-name';
      nameEl.textContent = b.name;
      nameEl.title = b.subject ? `${b.sha} · ${b.subject}` : b.name;
      row.appendChild(nameEl);

      const acts = document.createElement('div');
      acts.className = 'branch-row-actions';

      if (b.current) {
        const badge = document.createElement('span');
        badge.className = 'pill pill-ok';
        badge.textContent = 'Atual';
        acts.appendChild(badge);
      } else if (!isRemote) {
        acts.appendChild(makeSmallBtn('Trocar', () => switchBranchAction(b.name)));
        acts.appendChild(makeSmallBtn('Merge', () => mergeBranchAction(b.name)));
        acts.appendChild(makeSmallBtn('Renomear', () => renameBranchAction(b.name)));
        acts.appendChild(makeSmallBtn('Excluir', () => deleteBranchAction(b.name), true));
      } else {
        acts.appendChild(makeSmallBtn('Checkout', () => switchBranchAction(b.name)));
      }

      row.appendChild(acts);
      container.appendChild(row);
    }
  };

  addSection('Locais', local, false);
  addSection('Remotas', remote, true);
  if (!local.length && !remote.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma branch encontrada.</div>';
  }
}

function makeSmallBtn(text, onClick, isDanger = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn btn-xs ${isDanger ? 'btn-ghost' : 'btn-ghost'}`;
  if (isDanger) btn.style.color = 'var(--pe-error)';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

async function createBranchAction(e) {
  e.preventDefault();
  const name = $('branch-new-name').value.trim();
  const checkout = $('branch-checkout-new').checked;
  if (!name) return;
  try {
    await apiPost('/api/git/branch', { root: state.activeRoot, repo: state.activeGitRepo, action: 'create', name, checkout });
    $('branch-new-name').value = '';
    $('branch-dirty-banner').classList.add('hidden');
    await Promise.all([refreshBranchesList(), refreshGitStatus()]);
    showToast(`Branch criada: ${name}`);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function switchBranchAction(name) {
  $('branch-dirty-banner').classList.add('hidden');
  try {
    const res = await apiPost('/api/git/branch', { root: state.activeRoot, repo: state.activeGitRepo, action: 'switch', name });
    await Promise.all([refreshBranchesList(), refreshGitStatus(), refreshExplorer()]);
    showToast(`Branch ativa: ${res.branch || name}`);
  } catch (err) {
    if (err.code === 'DIRTY_WORKTREE') {
      state.pendingBranchSwitch = name;
      $('branch-dirty-msg').textContent = `Há alterações locais impedindo a troca para "${name}".`;
      $('branch-dirty-banner').classList.remove('hidden');
      return;
    }
    showToast(err.message, true);
  }
}

async function stashAndSwitchBranch() {
  const target = state.pendingBranchSwitch;
  if (!target) return;
  try {
    await apiPost('/api/git/stash', {
      root: state.activeRoot,
      repo: state.activeGitRepo,
      action: 'push',
      includeUntracked: true,
      message: `Auto-stash antes de trocar para ${target}`,
    });
    $('branch-dirty-banner').classList.add('hidden');
    state.pendingBranchSwitch = '';
    await switchBranchAction(target);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function renameBranchAction(oldName) {
  const newName = await openDialog({
    title: 'Renomear Branch',
    inputLabel: `Novo nome para "${oldName}"`,
    initialValue: oldName,
    confirmText: 'Renomear',
  });
  if (!newName || newName.trim() === oldName) return;
  try {
    await apiPost('/api/git/branch', {
      root: state.activeRoot,
      repo: state.activeGitRepo,
      action: 'rename',
      oldName,
      newName: newName.trim(),
    });
    await Promise.all([refreshBranchesList(), refreshGitStatus()]);
    showToast(`Branch renomeada para ${newName.trim()}`);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function mergeBranchAction(source) {
  const ok = await openDialog({
    title: 'Mesclar Branch',
    message: `Fazer merge de "${source}" na branch atual ("${state.git.branch}")?`,
    confirmText: 'Mesclar',
  });
  if (!ok) return;
  try {
    await apiPost('/api/git/branch', { root: state.activeRoot, repo: state.activeGitRepo, action: 'merge', source });
    await Promise.all([refreshBranchesList(), refreshGitStatus(), refreshExplorer()]);
    showToast(`Merge de ${source} concluído`);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteBranchAction(name) {
  const ok = await openDialog({
    title: 'Excluir Branch',
    message: `Excluir a branch local "${name}"?`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  try {
    await apiPost('/api/git/branch', { root: state.activeRoot, repo: state.activeGitRepo, action: 'delete', name });
    await Promise.all([refreshBranchesList(), refreshGitStatus()]);
    showToast(`Branch excluída: ${name}`);
  } catch (err) {
    if (err.code === 'UNMERGED_BRANCH' || /not fully merged/i.test(err.message)) {
      const forceOk = await openDialog({
        title: 'Branch não mesclada',
        message: `"${name}" possui commits não mesclados. Forçar exclusão (-D)?`,
        confirmText: 'Forçar Exclusão',
        danger: true,
      });
      if (forceOk) {
        try {
          await apiPost('/api/git/branch', { root: state.activeRoot, repo: state.activeGitRepo, action: 'delete', name, force: true });
          await Promise.all([refreshBranchesList(), refreshGitStatus()]);
          showToast(`Branch excluída: ${name}`);
        } catch (err2) {
          showToast(err2.message, true);
        }
      }
      return;
    }
    showToast(err.message, true);
  }
}

// ---------- Search (Grep) ----------
async function runSearch(e) {
  e?.preventDefault();
  if (!state.activeRoot) return;
  const query = $('search-query').value.trim();
  if (!query) {
    $('search-results').innerHTML = '<div class="empty-state">Digite um termo para pesquisar.</div>';
    $('search-meta').textContent = '';
    return;
  }
  $('search-results').innerHTML = '<div class="empty-state">Pesquisando...</div>';
  try {
    const data = await apiGet('/api/search', {
      root: state.activeRoot,
      q: query,
      caseSensitive: $('search-case').checked ? '1' : '0',
      includeIgnored: $('search-ignored').checked ? '1' : '0',
      maxResults: 200,
    });
    state.searchResults = data;
    renderSearchResults(data);
  } catch (err) {
    $('search-results').innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderSearchResults(data) {
  const meta = $('search-meta');
  meta.textContent = `${data.totalMatches}${data.truncated ? '+' : ''} em ${data.filesMatched} arq.`;
  const container = $('search-results');
  if (!data.matches?.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma ocorrência encontrada.</div>';
    return;
  }

  const grouped = new Map();
  for (const m of data.matches) {
    if (!grouped.has(m.relPath)) grouped.set(m.relPath, []);
    grouped.get(m.relPath).push(m);
  }

  const needle = data.query || '';
  const caseSens = $('search-case').checked;
  const frag = document.createDocumentFragment();

  for (const [relPath, items] of grouped.entries()) {
    const groupEl = document.createElement('div');
    groupEl.className = 'search-file-group';

    const header = document.createElement('div');
    header.className = 'search-file-header';
    header.innerHTML = `${getEntryIconHtml({ type: 'file', ext: relPath.includes('.') ? `.${relPath.split('.').pop()}` : '' })}<span>${escapeHtml(relPath)}</span><span class="search-file-count">${items.length}</span>`;
    groupEl.appendChild(header);

    for (const m of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-match-row';

      const ln = document.createElement('span');
      ln.className = 'search-line-num';
      ln.textContent = String(m.line);

      const snip = document.createElement('span');
      snip.className = 'search-snippet';
      snip.appendChild(buildHighlightedSnippet(m.text, needle, caseSens));

      btn.append(ln, snip);
      btn.addEventListener('click', () => openPreview(relPath, { highlightLine: m.line }));
      groupEl.appendChild(btn);
    }
    frag.appendChild(groupEl);
  }

  container.innerHTML = '';
  container.appendChild(frag);
}

function buildHighlightedSnippet(text, needle, caseSensitive) {
  const frag = document.createDocumentFragment();
  if (!needle) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  const hay = caseSensitive ? text : text.toLowerCase();
  const cmp = caseSensitive ? needle : needle.toLowerCase();
  const idx = hay.indexOf(cmp);
  if (idx === -1) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  frag.appendChild(document.createTextNode(text.slice(0, idx)));
  const mark = document.createElement('mark');
  mark.textContent = text.slice(idx, idx + needle.length);
  frag.appendChild(mark);
  frag.appendChild(document.createTextNode(text.slice(idx + needle.length)));
  return frag;
}

// ---------- External Apps ----------
async function loadExternalApps() {
  try {
    const data = await apiGet('/api/external-apps');
    state.externalApps = {
      apps: data.apps || [],
      associations: data.associations || {},
      customApps: data.customApps || [],
    };
    updatePreviewPrimaryExternalButton();
  } catch (err) {
    showToast(`Erro ao carregar apps externos: ${err.message}`, true);
  }
}

function resolvePrimaryAppForExt(ext) {
  const cleanExt = (ext || '').toLowerCase();
  const apps = state.externalApps.apps || [];
  const mappedId = state.externalApps.associations?.[cleanExt];
  if (mappedId) {
    const found = apps.find((a) => a.id === mappedId);
    if (found && found.available) return found;
  }
  return apps.find((a) => a.id === 'default' && a.available) || apps.find((a) => a.available) || null;
}

function updatePreviewPrimaryExternalButton() {
  const labelEl = $('btn-open-primary-label');
  if (!state.preview) return;
  const app = resolvePrimaryAppForExt(state.preview.ext);
  labelEl.textContent = app ? `Abrir no ${app.name}` : 'Abrir Externo';
  $('btn-open-primary-ext').title = app
    ? `Abrir ${state.preview.name} no ${app.name}`
    : 'Abrir no aplicativo associado';
}

async function openInExternalApp(relPath, appId) {
  try {
    const res = await apiPost('/api/open-external', {
      root: state.activeRoot,
      path: relPath,
      appId,
    });
    showToast(`Aberto em ${res.appName}`);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Embedded Preview & Quick Edit ----------
async function openPreview(relPath, { highlightLine = 0 } = {}) {
  if (!state.activeRoot || !relPath) return;
  try {
    const data = await apiGet('/api/preview', { root: state.activeRoot, path: relPath });
    const gitLoc = resolveGitLocationForWorkspacePath(data.relPath || relPath);
    state.preview = data;
    state.previewOpen = true;
    state.previewMode = 'file';
    state.previewDiff = null;
    state.previewDiffStaged = false;
    state.previewGitRepo = gitLoc.repo;
    state.previewGitRelPath = gitLoc.gitRelPath;
    state.treeHovered = false; // Auto-minimize tree immediately when selecting a file
    state.editMode = false;
    state.editDirty = false;
    state.mdRendered = Boolean(data.isMarkdown) && !highlightLine;
    state.highlightLine = highlightLine || 0;
    syncStageLayout();
    renderPreview();
    setStatus(`Visualizando ${data.relPath}`, formatBytes(data.size));
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openGitDiffPreview(relPath, { staged = false, status = 'M', repo = state.activeGitRepo } = {}) {
  if (!state.activeRoot || !relPath) return;
  try {
    const wsRelPath = toWorkspaceRelPath(relPath, repo);
    const diffRes = await apiGet('/api/git/diff', {
      root: state.activeRoot,
      repo: repo || '',
      path: relPath,
      staged: staged ? '1' : '0',
    });
    let fileData = null;
    if (status !== 'D') {
      try {
        fileData = await apiGet('/api/preview', { root: state.activeRoot, path: wsRelPath });
      } catch (_) {
        fileData = null;
      }
    }
    if (!fileData) {
      const name = wsRelPath.split('/').pop() || wsRelPath;
      const dotIdx = name.lastIndexOf('.');
      const ext = dotIdx > 0 ? name.slice(dotIdx).toLowerCase() : '';
      fileData = {
        relPath: wsRelPath,
        name,
        ext,
        size: diffRes.totalBytes || 0,
        kind: diffRes.isBinary ? 'binary' : 'text',
        isBinary: Boolean(diffRes.isBinary),
        isMarkdown: ext === '.md' || ext === '.markdown',
        truncated: false,
        content: '',
      };
    }
    state.preview = fileData;
    state.previewOpen = true;
    state.previewMode = 'diff';
    state.previewDiff = diffRes;
    state.previewDiffStaged = Boolean(staged);
    state.previewGitRepo = repo || '';
    state.previewGitRelPath = relPath;
    state.treeHovered = false;
    state.editMode = false;
    state.editDirty = false;
    state.mdRendered = false;
    state.highlightLine = 0;
    syncStageLayout();
    renderPreview();
    setStatus(`Diff ${staged ? '(Staged)' : '(Changes)'}: ${wsRelPath}`, `${diffRes.totalLines || 0} linhas`);
  } catch (err) {
    showToast(err.message, true);
  }
}

function closePreview(silent = false) {
  if (state.editDirty && !silent) {
    // Discard only after quick check via toast/confirm? Keep smooth if clean; prompt if dirty.
    openDialog({
      title: 'Descartar alterações?',
      message: `O arquivo "${state.preview?.name}" possui alterações não salvas.`,
      confirmText: 'Descartar',
      danger: true,
    }).then((ok) => {
      if (ok) forceClosePreview();
    });
    return;
  }
  forceClosePreview();
}

function forceClosePreview() {
  state.preview = null;
  state.previewOpen = false;
  state.previewMode = 'file';
  state.previewDiff = null;
  state.previewDiffStaged = false;
  state.previewGitRepo = '';
  state.previewGitRelPath = '';
  state.treeHovered = false;
  state.editMode = false;
  state.editDirty = false;
  const notice = $('preview-diff-notice');
  if (notice) {
    notice.classList.add('hidden');
    notice.textContent = '';
  }
  syncStageLayout();
  setStatus('Pronto', '');
}

function renderPreview() {
  const p = state.preview;
  if (!p) return;

  $('preview-file-icon').innerHTML = getEntryIconHtml({ type: 'file', ext: p.ext });
  $('preview-filename').textContent = p.name;
  $('preview-relpath').textContent = p.relPath;
  $('preview-dirty-dot').classList.toggle('hidden', !state.editDirty);
  updatePreviewPrimaryExternalButton();

  const isDiffMode = state.previewMode === 'diff';
  const gitLoc = state.previewGitRelPath
    ? { repo: state.previewGitRepo, gitRelPath: state.previewGitRelPath }
    : resolveGitLocationForWorkspacePath(p.relPath);
  const hasGitChange =
    isDiffMode || (gitLoc.repo === state.activeGitRepo && Boolean(state.git?.files?.[gitLoc.gitRelPath]));
  const diffBtn = $('btn-toggle-diff-mode');
  if (diffBtn) {
    diffBtn.classList.toggle('hidden', !hasGitChange || state.editMode);
    diffBtn.classList.toggle('is-active', isDiffMode);
    const diffLabel = $('btn-toggle-diff-label');
    if (diffLabel) diffLabel.textContent = isDiffMode ? 'Arquivo' : 'Diff';
  }

  const canEdit = p.kind === 'text' && !p.truncated && !isDiffMode;
  $('btn-toggle-md-mode').classList.toggle('hidden', !p.isMarkdown || state.editMode || isDiffMode);
  $('btn-toggle-md-label').textContent = state.mdRendered ? 'Código' : 'Preview MD';
  $('btn-edit-toggle').classList.toggle('hidden', !canEdit);
  $('btn-edit-toggle').classList.toggle('is-active', state.editMode);
  $('btn-save-file').classList.toggle('hidden', !state.editMode);

  const metaBar = $('preview-meta-bar');
  if (isDiffMode && state.previewDiff) {
    const diffMeta = [
      state.previewDiffStaged ? 'Diff (Staged)' : 'Diff (Changes)',
      formatBytes(state.previewDiff.totalBytes || 0),
    ];
    if (state.previewDiff.totalLines) diffMeta.push(`${state.previewDiff.totalLines} linhas`);
    if (state.previewDiff.truncated) diffMeta.push('truncado');
    metaBar.textContent = diffMeta.join(' · ');
  } else {
    const metaParts = [formatBytes(p.size)];
    if (p.lineCount) metaParts.push(`${p.lineCount} linhas`);
    if (p.truncated) metaParts.push('truncado (512 KB)');
    metaBar.textContent = metaParts.join(' · ');
  }
  metaBar.classList.remove('hidden');

  const diffNotice = $('preview-diff-notice');
  if (diffNotice) {
    if (isDiffMode && state.previewDiff?.truncated) {
      diffNotice.textContent = `Diff truncado (${formatBytes(state.previewDiff.totalBytes || 0)}, ${state.previewDiff.totalLines || 0} linhas). Use "Copiar Diff" ou abra no app externo para ver completo.`;
      diffNotice.classList.remove('hidden');
    } else {
      diffNotice.classList.add('hidden');
      diffNotice.textContent = '';
    }
  }

  const body = $('preview-body');
  const editorWrap = $('preview-editor-wrap');

  if (state.editMode) {
    body.classList.add('hidden');
    editorWrap.classList.remove('hidden');
    const editor = $('preview-editor');
    if (editor.value !== (p.content || '') && !state.editDirty) {
      editor.value = p.content || '';
    }
    editor.focus();
    return;
  }

  editorWrap.classList.add('hidden');
  body.classList.remove('hidden');

  if (isDiffMode) {
    renderDiffTable(body, state.previewDiff);
    return;
  }

  if (p.kind === 'image') {
    if (p.dataUrl) {
      body.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'image-preview-wrap';
      const frame = document.createElement('div');
      frame.className = 'image-preview-frame';
      const img = document.createElement('img');
      img.src = p.dataUrl;
      img.alt = p.name;
      frame.appendChild(img);
      wrap.appendChild(frame);
      body.appendChild(wrap);
    } else {
      renderBinaryCard(body, p, 'Imagem muito grande para preview embutido.');
    }
    return;
  }

  if (p.kind === 'binary' || p.isBinary) {
    renderBinaryCard(body, p, 'Arquivo binário não suportado no preview de texto.');
    return;
  }

  if (p.isMarkdown && state.mdRendered && !state.highlightLine) {
    body.innerHTML = `<article class="markdown-view">${renderMarkdownSafe(p.content || '')}</article>`;
    return;
  }

  renderCodeTable(body, p.content || '', state.highlightLine);
}

function renderDiffTable(container, diffData) {
  container.innerHTML = '';
  if (!diffData || diffData.isBinary) {
    const empty = document.createElement('div');
    empty.className = 'git-empty-state';
    empty.textContent = diffData?.isBinary
      ? 'Arquivo binário — diff textual indisponível.'
      : 'Sem diferenças para exibir.';
    container.appendChild(empty);
    return;
  }
  const raw = String(diffData.diff || '');
  if (!raw.trim()) {
    const empty = document.createElement('div');
    empty.className = 'git-empty-state';
    empty.textContent = diffData.untracked
      ? 'Arquivo novo (untracked). Clique em "Arquivo" para visualizar o conteúdo completo.'
      : 'Nenhuma alteração textual neste escopo.';
    container.appendChild(empty);
    return;
  }

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const table = document.createElement('table');
  table.className = 'diff-table';
  const tbody = document.createElement('tbody');

  lines.forEach((line, idx) => {
    const tr = document.createElement('tr');
    let cls = 'diff-line-ctx';
    if (line.startsWith('@@')) cls = 'diff-line-hunk';
    else if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file ') ||
      line.startsWith('deleted file ') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ')
    ) {
      cls = 'diff-line-meta';
    } else if (line.startsWith('+')) {
      cls = 'diff-line-add';
    } else if (line.startsWith('-')) {
      cls = 'diff-line-del';
    }
    tr.className = cls;

    const ln = document.createElement('td');
    ln.className = 'diff-ln';
    ln.textContent = String(idx + 1);

    const code = document.createElement('td');
    code.className = 'diff-code';
    code.textContent = line === '' ? ' ' : line;

    tr.appendChild(ln);
    tr.appendChild(code);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function renderBinaryCard(container, p, reason) {
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'binary-card';
  const h3 = document.createElement('h3');
  h3.textContent = p.name;
  const desc = document.createElement('p');
  desc.textContent = `${reason} (${formatBytes(p.size)})`;
  const actions = document.createElement('div');
  actions.className = 'binary-card-actions';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn btn-primary btn-sm';
  openBtn.textContent = 'Abrir no App Externo';
  openBtn.addEventListener('click', () => openInExternalApp(p.relPath));

  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.className = 'btn btn-ghost btn-sm';
  revealBtn.textContent = 'Mostrar na Pasta';
  revealBtn.addEventListener('click', () => openInExternalApp(p.relPath, 'explorer'));

  actions.append(openBtn, revealBtn);
  card.append(h3, desc, actions);
  container.appendChild(card);
}

function renderCodeTable(container, content, highlightLine = 0) {
  const lines = String(content).split(/\r?\n/);
  const table = document.createElement('table');
  table.className = 'code-table';
  const tbody = document.createElement('tbody');
  let targetRow = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const tr = document.createElement('tr');
    tr.className = 'code-line-row';
    if (highlightLine === lineNum) {
      tr.classList.add('highlight');
      targetRow = tr;
    }

    const gutter = document.createElement('td');
    gutter.className = 'code-gutter';
    gutter.textContent = String(lineNum);

    const cell = document.createElement('td');
    cell.className = 'code-cell';
    cell.textContent = lines[i] || ' ';

    tr.append(gutter, cell);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
  if (targetRow) {
    requestAnimationFrame(() => targetRow.scrollIntoView({ block: 'center' }));
  }
}

async function saveEditedFile() {
  if (!state.preview || !state.editMode) return;
  const content = $('preview-editor').value;
  try {
    const res = await apiPost('/api/crud', {
      root: state.activeRoot,
      action: 'saveContent',
      path: state.preview.relPath,
      content,
    });
    state.preview.content = content;
    state.preview.size = res.size ?? content.length;
    state.preview.lineCount = content ? content.split(/\r?\n/).length : 0;
    state.editDirty = false;
    state.editMode = false;
    renderPreview();
    await refreshGitStatus();
    showToast(`Salvo: ${state.preview.name}`);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Safe Markdown Renderer ----------
function renderInlineMd(rawEscaped) {
  const codeSpans = [];
  let text = rawEscaped.replace(/`([^`]+)`/g, (_, code) => {
    const token = `\x00CODE${codeSpans.length}\x00`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });

  text = text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const safe = /^(https?:|mailto:|#|\/|\.)/i.test(url) ? url : '#';
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');

  return text.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeSpans[Number(idx)] || '');
}

function renderMarkdownSafe(source) {
  const codeBlocks = [];
  const replaced = String(source || '').replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code data-lang="${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`);
    return `\n\x00BLOCK${idx}\x00\n`;
  });

  const lines = replaced.split(/\r?\n/);
  const out = [];
  let inUl = false;
  let inOl = false;
  let inTable = false;

  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
    if (inTable) { out.push('</tbody></table>'); inTable = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const blockMatch = line.match(/^\x00BLOCK(\d+)\x00$/);
    if (blockMatch) {
      closeLists();
      out.push(codeBlocks[Number(blockMatch[1])] || '');
      continue;
    }

    if (!line.trim()) {
      closeLists();
      continue;
    }

    if (/^---+$|^\*\*\*+$/.test(line.trim())) {
      closeLists();
      out.push('<hr>');
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${renderInlineMd(escapeHtml(heading[2]))}</h${lvl}>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeLists();
      out.push(`<blockquote>${renderInlineMd(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }

    const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (inTable) { out.push('</tbody></table>'); inTable = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      const itemText = ulMatch[1]
        .replace(/^\[x\]\s+/i, '☑ ')
        .replace(/^\[\s\]\s+/, '☐ ');
      out.push(`<li>${renderInlineMd(escapeHtml(itemText))}</li>`);
      continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inTable) { out.push('</tbody></table>'); inTable = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${renderInlineMd(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (!inTable) {
        const nextLine = (lines[i + 1] || '').trim();
        if (/^\|[\s:|-]+\|$/.test(nextLine)) {
          closeLists();
          out.push('<table><thead><tr>');
          for (const c of cells) out.push(`<th>${renderInlineMd(escapeHtml(c))}</th>`);
          out.push('</tr></thead><tbody>');
          inTable = true;
          i++;
          continue;
        }
      } else {
        out.push('<tr>');
        for (const c of cells) out.push(`<td>${renderInlineMd(escapeHtml(c))}</td>`);
        out.push('</tr>');
        continue;
      }
    }

    closeLists();
    out.push(`<p>${renderInlineMd(escapeHtml(line))}</p>`);
  }

  closeLists();
  return out.join('\n');
}

// ---------- Context Menu & Open With ----------
function closeContextMenu() {
  const menu = $('context-menu');
  menu.classList.add('hidden');
  menu.innerHTML = '';
  state.contextMenuOpen = false;
  $('btn-open-with-menu').setAttribute('aria-expanded', 'false');
}

function positionMenu(menu, x, y) {
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const maxX = Math.max(8, window.innerWidth - rect.width - 8);
  const maxY = Math.max(8, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.min(Math.max(8, x), maxX)}px`;
  menu.style.top = `${Math.min(Math.max(8, y), maxY)}px`;
}

function addMenuButton(menu, label, onClick, { danger = false, badge = '' } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.role = 'menuitem';
  btn.className = `ctx-item${danger ? ' danger' : ''}`;
  const textSpan = document.createElement('span');
  textSpan.textContent = label;
  btn.appendChild(textSpan);
  if (badge) {
    const b = document.createElement('span');
    b.className = 'ctx-badge';
    b.textContent = badge;
    btn.appendChild(b);
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeContextMenu();
    onClick();
  });
  menu.appendChild(btn);
}

function addMenuSeparator(menu) {
  const sep = document.createElement('div');
  sep.className = 'ctx-sep';
  menu.appendChild(sep);
}

function addMenuHeader(menu, text) {
  const hdr = document.createElement('div');
  hdr.className = 'ctx-item sub-header';
  hdr.textContent = text;
  menu.appendChild(hdr);
}

function openOpenWithMenu(relPath, x, y) {
  const menu = $('context-menu');
  menu.innerHTML = '';
  state.contextMenuOpen = true;
  addMenuHeader(menu, 'Abrir com...');

  const availableApps = (state.externalApps.apps || []).filter((a) => a.available);
  for (const app of availableApps) {
    addMenuButton(menu, app.name, () => openInExternalApp(relPath, app.id), {
      badge: app.isBuiltin ? '' : 'Custom',
    });
  }
  addMenuSeparator(menu);
  addMenuButton(menu, 'Configurações...', () => openExternalAppsModal());
  positionMenu(menu, x, y);
}

function openEntryContextMenu(entry, x, y) {
  const menu = $('context-menu');
  menu.innerHTML = '';
  state.contextMenuOpen = true;

  const isDir = entry.type === 'directory';
  const targetDirForNew = isDir ? entry.relPath : getParentRel(entry.relPath);
  const fullPath = entry.fullPath || `${state.activeRoot}\\${entry.relPath.replace(/\//g, '\\')}`;
  const uri = entry.uri || `file:///${fullPath.replace(/\\/g, '/')}`;

  if (!isDir) {
    const primary = resolvePrimaryAppForExt(entry.ext);
    addMenuButton(menu, 'Abrir Preview', () => openPreview(entry.relPath));
    addMenuButton(
      menu,
      primary ? `Abrir no ${primary.name}` : 'Abrir no App Externo',
      () => openInExternalApp(entry.relPath, primary?.id),
    );
    addMenuButton(menu, 'Abrir com...', () => openOpenWithMenu(entry.relPath, x, y), { badge: '▸' });
    addMenuButton(menu, 'Mostrar na Pasta', () => openInExternalApp(entry.relPath, 'explorer'));
    addMenuButton(menu, 'Abrir no App FileView', () => openInAntigravityFileView(uri));
  } else {
    addMenuButton(
      menu,
      state.expanded.has(entry.relPath) ? 'Colapsar Pasta' : 'Expandir Pasta',
      () => handleTreeEntryClick(entry),
    );
    addMenuButton(menu, 'Mostrar na Pasta', () => openInExternalApp(entry.relPath, 'explorer'));
    addMenuButton(menu, 'PowerShell Aqui', () => openInExternalApp(entry.relPath, 'powershell'));
  }

  addMenuSeparator(menu);
  addMenuButton(menu, 'Novo Arquivo...', () => promptCreateFile(targetDirForNew));
  addMenuButton(menu, 'Nova Pasta...', () => promptCreateFolder(targetDirForNew));
  addMenuButton(menu, 'Renomear...', () => promptRenameEntry(entry));
  addMenuButton(menu, 'Duplicar', () => duplicateEntryAction(entry));
  addMenuButton(menu, 'Excluir...', () => promptDeleteEntry(entry), { danger: true });

  const gitIgnoreTarget = resolveGitIgnoreTargetForEntry(entry);
  if (gitIgnoreTarget) {
    addMenuSeparator(menu);
    addMenuButton(menu, 'Ignorar no .gitignore...', () => openGitIgnoreModal(gitIgnoreTarget));
  }

  addMenuSeparator(menu);
  addMenuButton(menu, 'Copiar Caminho Relativo', () => copyText(entry.relPath, 'Relativo'));
  addMenuButton(menu, 'Copiar Caminho Absoluto', () => copyText(fullPath, 'Absoluto'));
  addMenuButton(menu, 'Copiar @mention para o chat', () => copyText(`@${entry.relPath}`, '@mention'));

  positionMenu(menu, x, y);
}

function openInAntigravityFileView(uri) {
  if (window.sidecar?.ui?.toggleAuxPane) {
    window.sidecar.ui.toggleAuxPane({ tabType: 'fileView', uri });
    showToast('Enviado para FileView do Antigravity');
  } else {
    showToast('FileView disponível apenas dentro do Antigravity App', true);
  }
}

// ---------- CRUD Actions & Generic Dialog ----------
function openDialog({ title, message = '', inputLabel = '', initialValue = '', placeholder = '', confirmText = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    dialogResolver = resolve;
    $('dialog-title').textContent = title;
    const msgEl = $('dialog-message');
    msgEl.textContent = message;
    msgEl.classList.toggle('hidden', !message);

    const inputWrap = $('dialog-input-wrap');
    const inputEl = $('dialog-input');
    if (inputLabel) {
      inputWrap.classList.remove('hidden');
      $('dialog-input-label').textContent = inputLabel;
      inputEl.value = initialValue;
      inputEl.placeholder = placeholder;
    } else {
      inputWrap.classList.add('hidden');
      inputEl.value = '';
    }

    $('dialog-error').classList.add('hidden');
    const confirmBtn = $('dialog-confirm');
    confirmBtn.textContent = confirmText;
    confirmBtn.className = `btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`;

    $('dialog-backdrop').classList.remove('hidden');
    if (inputLabel) {
      requestAnimationFrame(() => {
        inputEl.focus();
        inputEl.select();
      });
    } else {
      requestAnimationFrame(() => confirmBtn.focus());
    }
  });
}

function closeDialog(result = null) {
  $('dialog-backdrop').classList.add('hidden');
  const resolve = dialogResolver;
  dialogResolver = null;
  if (resolve) resolve(result);
}

function getDefaultBaseDir() {
  if (!state.selectedPath) return '';
  return state.selectedType === 'directory' ? state.selectedPath : getParentRel(state.selectedPath);
}

async function promptCreateFile(baseDir = getDefaultBaseDir()) {
  if (!state.activeRoot) return;
  const name = await openDialog({
    title: 'Novo Arquivo',
    inputLabel: baseDir ? `Nome do arquivo em "${baseDir}/"` : 'Nome do arquivo na raiz',
    placeholder: 'Ex.: notas.md',
    confirmText: 'Criar',
  });
  if (!name) return;
  const relPath = joinRel(baseDir, name);
  try {
    const res = await apiPost('/api/crud', { root: state.activeRoot, action: 'createFile', path: relPath, content: '' });
    if (baseDir) state.expanded.add(baseDir);
    await Promise.all([loadFolder(baseDir, true), refreshGitStatus()]);
    state.selectedPath = res.relPath;
    state.selectedType = 'file';
    renderTree();
    showToast(`Arquivo criado: ${res.relPath}`);
    await openPreview(res.relPath);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function promptCreateFolder(baseDir = getDefaultBaseDir()) {
  if (!state.activeRoot) return;
  const name = await openDialog({
    title: 'Nova Pasta',
    inputLabel: baseDir ? `Nome da pasta em "${baseDir}/"` : 'Nome da pasta na raiz',
    placeholder: 'Ex.: docs',
    confirmText: 'Criar',
  });
  if (!name) return;
  const relPath = joinRel(baseDir, name);
  try {
    const res = await apiPost('/api/crud', { root: state.activeRoot, action: 'createFolder', path: relPath });
    if (baseDir) state.expanded.add(baseDir);
    state.expanded.add(res.relPath);
    await Promise.all([loadFolder(baseDir, true), refreshGitStatus()]);
    state.selectedPath = res.relPath;
    state.selectedType = 'directory';
    renderTree();
    showToast(`Pasta criada: ${res.relPath}`);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function promptRenameEntry(entry) {
  const nextName = await openDialog({
    title: 'Renomear',
    inputLabel: 'Novo nome ou caminho relativo',
    initialValue: entry.name,
    confirmText: 'Renomear',
  });
  if (!nextName || nextName.trim() === entry.name) return;
  try {
    const res = await apiPost('/api/crud', {
      root: state.activeRoot,
      action: 'rename',
      path: entry.relPath,
      newName: nextName.trim(),
    });
    const parent = getParentRel(entry.relPath);
    if (state.preview?.relPath === entry.relPath) {
      await openPreview(res.relPath);
    }
    await Promise.all([loadFolder(parent, true), refreshGitStatus()]);
    showToast(`Renomeado para ${res.relPath}`);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function duplicateEntryAction(entry) {
  try {
    const res = await apiPost('/api/crud', {
      root: state.activeRoot,
      action: 'duplicate',
      path: entry.relPath,
    });
    const parent = getParentRel(entry.relPath);
    await Promise.all([loadFolder(parent, true), refreshGitStatus()]);
    showToast(`Duplicado: ${res.relPath}`);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function promptDeleteEntry(entry) {
  const confirmed = await openDialog({
    title: 'Confirmar Exclusão',
    message: `Deseja excluir permanentemente "${entry.relPath}"?`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await apiPost('/api/crud', {
      root: state.activeRoot,
      action: 'delete',
      path: entry.relPath,
    });
    if (state.preview?.relPath === entry.relPath) {
      forceClosePreview();
    }
    state.expanded.delete(entry.relPath);
    const parent = getParentRel(entry.relPath);
    await Promise.all([loadFolder(parent, true), refreshGitStatus()]);
    showToast(`Excluído: ${entry.relPath}`);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Workspace Switcher Modal ----------
async function openWorkspaceModal() {
  $('ws-modal-backdrop').classList.remove('hidden');
  renderWorkspaceModalSections();
  await browseLocalPath(state.activeRoot || '__roots__');
}

function closeWorkspaceModal() {
  $('ws-modal-backdrop').classList.add('hidden');
}

function renderWorkspaceModalSections() {
  const container = $('ws-sections');
  container.innerHTML = '';
  const favSet = new Set((state.workspaces.favorites || []).map((f) => f.path.toLowerCase()));

  const buildSection = (title, items, allowRemove = false) => {
    if (!items || !items.length) return;
    const sec = document.createElement('div');
    const h = document.createElement('h3');
    h.className = 'ws-section-title';
    h.textContent = title;
    const list = document.createElement('div');
    list.className = 'ws-list';

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'ws-item';
      if (item.path.toLowerCase() === state.activeRoot.toLowerCase()) row.classList.add('active');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ws-item-btn';
      btn.innerHTML = `<span class="ws-item-name">${escapeHtml(item.name)}</span><span class="ws-item-path">${escapeHtml(item.path)}</span>`;
      btn.addEventListener('click', async () => {
        await selectWorkspacePath(item.path);
        closeWorkspaceModal();
      });

      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      const isFav = favSet.has(item.path.toLowerCase());
      favBtn.className = `fav-btn${isFav ? ' is-fav' : ''}`;
      favBtn.title = isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
      favBtn.textContent = isFav ? '★' : '☆';
      favBtn.addEventListener('click', () => selectWorkspacePath(item.path, { toggleFavorite: true }));

      row.append(btn, favBtn);
      if (allowRemove) {
        const remBtn = document.createElement('button');
        remBtn.type = 'button';
        remBtn.className = 'icon-btn';
        remBtn.title = 'Remover dos recentes';
        remBtn.textContent = '×';
        remBtn.addEventListener('click', () => selectWorkspacePath(item.path, { removeRecent: true }));
        row.appendChild(remBtn);
      }
      list.appendChild(row);
    }

    sec.append(h, list);
    container.appendChild(sec);
  };

  buildSection('Pastas da Conversa Ativa', state.workspaces.hostFolders);
  buildSection('Favoritos', state.workspaces.favorites);
  buildSection('Recentes', state.workspaces.recent, true);
}

async function browseLocalPath(pathTarget) {
  try {
    const urisParam = state.hostUris.length ? JSON.stringify(state.hostUris) : '';
    const data = await apiGet('/api/workspaces', {
      uris: urisParam,
      conversationId: getConversationId(),
      browse: pathTarget || '__roots__',
    });
    const b = data.browse || { currentPath: '', parentPath: '', folders: [] };
    state.browseState = b;
    $('ws-browse-path').textContent = b.currentPath || 'Computador / Unidades';
    $('ws-browse-select-current').disabled = !b.currentPath;

    const list = $('ws-browse-list');
    list.innerHTML = '';
    if (!b.folders.length) {
      list.innerHTML = '<div class="empty-state">Sem subpastas.</div>';
      return;
    }
    for (const folder of b.folders) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'browse-dir-btn';
      btn.innerHTML = `${getEntryIconHtml({ type: 'directory' })}<span>${escapeHtml(folder.name)}</span>`;
      btn.addEventListener('click', () => browseLocalPath(folder.path));
      list.appendChild(btn);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- External Apps Config Modal ----------
async function openExternalAppsModal() {
  await loadExternalApps();
  renderExternalAppsModal();
  $('ext-modal-backdrop').classList.remove('hidden');
}

function closeExternalAppsModal() {
  $('ext-modal-backdrop').classList.add('hidden');
}

function renderExternalAppsModal() {
  const { apps, associations, customApps } = state.externalApps;

  const select = $('assoc-app-select');
  select.innerHTML = '';
  for (const app of apps) {
    const opt = document.createElement('option');
    opt.value = app.id;
    opt.textContent = app.available ? app.name : `${app.name} (indisponível)`;
    select.appendChild(opt);
  }

  const assocList = $('ext-assoc-list');
  assocList.innerHTML = '';
  const entries = Object.entries(associations);
  if (!entries.length) {
    assocList.innerHTML = '<div class="empty-state">Nenhuma associação configurada.</div>';
  } else {
    for (const [ext, appId] of entries) {
      const row = document.createElement('div');
      row.className = 'assoc-row';
      const appObj = apps.find((a) => a.id === appId);
      const appLabel = appObj ? appObj.name : appId;
      row.innerHTML = `<span class="assoc-ext">${escapeHtml(ext)}</span><span>→ ${escapeHtml(appLabel)}</span><span class="spacer"></span>`;
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-ghost btn-xs';
      delBtn.textContent = 'Remover';
      delBtn.addEventListener('click', () => updateExternalAssociations({ [ext]: '' }));
      row.appendChild(delBtn);
      assocList.appendChild(row);
    }
  }

  const appsList = $('ext-apps-list');
  appsList.innerHTML = '';
  for (const app of apps) {
    const row = document.createElement('div');
    row.className = 'app-row';
    const info = document.createElement('div');
    info.className = 'app-info';
    info.innerHTML = `
      <div class="app-name-row">
        <span>${escapeHtml(app.name)}</span>
        <span class="pill ${app.available ? 'pill-ok' : 'pill-muted'}">${app.available ? 'Disponível' : 'Não encontrado'}</span>
      </div>
      <span class="app-path">${escapeHtml(app.exePath || 'Sistema')}</span>
    `;
    row.appendChild(info);

    if (!app.isBuiltin) {
      const remBtn = document.createElement('button');
      remBtn.type = 'button';
      remBtn.className = 'btn btn-ghost btn-xs';
      remBtn.textContent = 'Remover';
      remBtn.addEventListener('click', async () => {
        const remaining = customApps.filter((c) => c.id !== app.id);
        await saveExternalConfig({ customApps: remaining });
      });
      row.appendChild(remBtn);
    }
    appsList.appendChild(row);
  }
}

async function saveExternalConfig(payload) {
  try {
    const data = await apiPost('/api/external-apps/config', payload);
    state.externalApps = {
      apps: data.apps || [],
      associations: data.associations || {},
      customApps: data.customApps || [],
    };
    updatePreviewPrimaryExternalButton();
    renderExternalAppsModal();
    showToast('Configuração de aplicativos salva');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function updateExternalAssociations(patch) {
  await saveExternalConfig({ associations: patch });
}

// ---------- Tabs ----------
function switchTab(tabName) {
  state.activeTab = tabName;
  for (const btn of document.querySelectorAll('.wb-tab')) {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.id === `panel-${tabName}`);
  }
  if (tabName === 'git') refreshGitStatus({ loadStashes: true });
  if (tabName === 'search') requestAnimationFrame(() => $('search-query').focus());
}

// ---------- Event Wiring ----------
function bindEvents() {
  // Workbench tabs
  for (const btn of document.querySelectorAll('.wb-tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }

  // Hover Auto-Open & Auto-Minimize Rail
  const rail = $('tree-rail');
  const sidebar = $('sidebar-pane');
  rail.addEventListener('mouseenter', openHoverDrawer);
  sidebar.addEventListener('mouseenter', openHoverDrawer);
  rail.addEventListener('mouseleave', scheduleCloseHoverDrawer);
  sidebar.addEventListener('mouseleave', scheduleCloseHoverDrawer);
  $('rail-expand-btn').addEventListener('click', () => {
    if (state.previewOpen && !state.treePinned) {
      state.treeHovered = !state.treeHovered;
      syncStageLayout();
    }
  });
  $('rail-pin-btn').addEventListener('click', togglePinTree);
  $('btn-pin-tree').addEventListener('click', togglePinTree);

  // Explorer toolbar
  $('tree-filter').addEventListener('input', (e) => {
    const val = e.target.value;
    $('tree-filter-clear').classList.toggle('hidden', !val);
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(() => {
      state.treeFilter = val;
      renderTree();
    }, 90);
  });
  $('tree-filter-clear').addEventListener('click', () => {
    $('tree-filter').value = '';
    $('tree-filter-clear').classList.add('hidden');
    state.treeFilter = '';
    renderTree();
  });

  $('btn-new-file').addEventListener('click', () => promptCreateFile());
  $('btn-new-folder').addEventListener('click', () => promptCreateFolder());
  $('btn-refresh-tree').addEventListener('click', refreshExplorer);
  $('btn-collapse-all').addEventListener('click', () => {
    state.expanded = new Set(['']);
    renderTree();
  });
  $('btn-toggle-hidden').addEventListener('click', async () => {
    const next = !(state.showHidden && state.showIgnored);
    state.showHidden = next;
    state.showIgnored = next;
    $('btn-toggle-hidden').setAttribute('aria-pressed', String(next));
    await refreshExplorer();
  });

  // Search & Git v2
  $('search-form').addEventListener('submit', runSearch);
  $('btn-refresh-git').addEventListener('click', () => refreshGitStatus({ loadStashes: true }));
  $('git-branch-btn').addEventListener('click', openBranchModal);
  $('git-remote-select').addEventListener('change', (e) => {
    state.gitSelectedRemote = e.target.value;
  });
  $('btn-git-fetch').addEventListener('click', () => runRemoteOp('fetch'));
  $('btn-git-pull').addEventListener('click', () => runRemoteOp('pull'));
  $('btn-git-push').addEventListener('click', () => runRemoteOp('push'));

  for (const chip of document.querySelectorAll('.commit-chip')) {
    chip.addEventListener('click', () => {
      const prefix = chip.dataset.prefix || '';
      const input = $('git-commit-msg');
      const cur = input.value;
      const stripped = cur.replace(/^(feat|fix|docs|chore):\s*/i, '');
      input.value = prefix + stripped;
      input.focus();
    });
  }
  $('git-commit-msg').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      gitCommitSubmit();
    }
  });
  $('btn-git-commit-toggle').addEventListener('click', () => setCommitComposerOpen(!state.gitComposerOpen));
  $('btn-git-commit-cancel').addEventListener('click', () => setCommitComposerOpen(false));
  $('btn-git-commit').addEventListener('click', gitCommitSubmit);
  $('btn-git-copy-mentions').addEventListener('click', copyAllGitMentions);
  $('btn-git-copy-diff').addEventListener('click', copyFullGitDiff);

  $('git-filter').addEventListener('input', (e) => {
    state.gitFilter = e.target.value || '';
    $('git-filter-clear').classList.toggle('hidden', !state.gitFilter);
    renderGitTab();
  });
  $('git-filter-clear').addEventListener('click', () => {
    $('git-filter').value = '';
    state.gitFilter = '';
    $('git-filter-clear').classList.add('hidden');
    renderGitTab();
  });
  $('btn-git-stage-all').addEventListener('click', () => gitStage([], true));
  $('btn-git-unstage-all').addEventListener('click', () => gitUnstage([], true));
  $('btn-git-stash-push').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptStashPush();
  });
  $('git-stash-details').addEventListener('toggle', (e) => {
    if (e.currentTarget.open) refreshGitStashes();
  });

  // Preview actions
  $('btn-toggle-diff-mode').addEventListener('click', async () => {
    if (!state.preview) return;
    if (state.previewMode === 'diff') {
      state.previewMode = 'file';
      renderPreview();
      return;
    }
    const gitLoc = state.previewGitRelPath
      ? { repo: state.previewGitRepo, gitRelPath: state.previewGitRelPath }
      : resolveGitLocationForWorkspacePath(state.preview.relPath);
    const gInfo = gitLoc.repo === state.activeGitRepo ? state.git?.files?.[gitLoc.gitRelPath] : null;
    const staged = Boolean(gInfo?.staged && !gInfo?.unstaged);
    await openGitDiffPreview(gitLoc.gitRelPath, {
      staged,
      status: gInfo?.status || 'M',
      repo: gitLoc.repo,
    });
  });
  $('btn-open-primary-ext').addEventListener('click', () => {
    if (!state.preview) return;
    const primary = resolvePrimaryAppForExt(state.preview.ext);
    openInExternalApp(state.preview.relPath, primary?.id);
  });
  $('btn-open-with-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.preview) return;
    if (state.contextMenuOpen) {
      closeContextMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    $('btn-open-with-menu').setAttribute('aria-expanded', 'true');
    openOpenWithMenu(state.preview.relPath, rect.left - 140, rect.bottom + 4);
  });
  $('btn-show-in-folder').addEventListener('click', () => {
    if (state.preview) openInExternalApp(state.preview.relPath, 'explorer');
  });
  $('btn-open-fileview').addEventListener('click', () => {
    if (state.preview) openInAntigravityFileView(state.preview.uri);
  });
  $('btn-toggle-md-mode').addEventListener('click', () => {
    state.mdRendered = !state.mdRendered;
    state.highlightLine = 0;
    renderPreview();
  });
  $('btn-edit-toggle').addEventListener('click', () => {
    if (!state.preview || state.preview.kind !== 'text') return;
    state.editMode = !state.editMode;
    if (state.editMode) {
      $('preview-editor').value = state.preview.content || '';
      state.editDirty = false;
    }
    renderPreview();
  });
  $('preview-editor').addEventListener('input', (e) => {
    if (!state.preview) return;
    state.editDirty = e.target.value !== (state.preview.content || '');
    $('preview-dirty-dot').classList.toggle('hidden', !state.editDirty);
  });
  $('btn-save-file').addEventListener('click', saveEditedFile);
  $('btn-copy-mention').addEventListener('click', () => {
    if (state.preview) copyText(`@${state.preview.relPath}`, '@mention');
  });
  $('btn-close-preview').addEventListener('click', () => closePreview(false));

  // Workspace Switcher Modal
  $('ws-switcher-btn').addEventListener('click', openWorkspaceModal);
  $('ws-modal-close').addEventListener('click', closeWorkspaceModal);
  $('ws-modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('ws-modal-backdrop')) closeWorkspaceModal();
  });
  $('ws-manual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = $('ws-manual-input').value.trim();
    if (!val) return;
    try {
      await selectWorkspacePath(val);
      $('ws-manual-input').value = '';
      closeWorkspaceModal();
    } catch (err) {
      showToast(err.message, true);
    }
  });
  $('ws-browse-up').addEventListener('click', () => {
    browseLocalPath(state.browseState.parentPath || '__roots__');
  });
  $('ws-browse-select-current').addEventListener('click', async () => {
    if (!state.browseState.currentPath) return;
    try {
      await selectWorkspacePath(state.browseState.currentPath);
      closeWorkspaceModal();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // External Apps Modal
  $('btn-ext-settings').addEventListener('click', openExternalAppsModal);
  $('ext-modal-close').addEventListener('click', closeExternalAppsModal);
  $('ext-modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('ext-modal-backdrop')) closeExternalAppsModal();
  });
  $('ext-assoc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ext = $('assoc-ext-input').value.trim();
    const appId = $('assoc-app-select').value;
    if (!ext || !appId) return;
    await updateExternalAssociations({ [ext]: appId });
    $('assoc-ext-input').value = '';
  });
  $('ext-custom-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('custom-app-name').value.trim();
    const exePath = $('custom-app-path').value.trim();
    const argsRaw = $('custom-app-args').value.trim();
    if (!name || !exePath) return;
    const args = argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [];
    const id = `custom-${Date.now().toString(36)}`;
    const nextCustom = [...(state.externalApps.customApps || []), { id, name, exePath, args }];
    await saveExternalConfig({ customApps: nextCustom });
    $('custom-app-name').value = '';
    $('custom-app-path').value = '';
    $('custom-app-args').value = '';
  });

  // Branch Manager Modal
  $('branch-modal-close').addEventListener('click', closeBranchModal);
  $('branch-modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('branch-modal-backdrop')) closeBranchModal();
  });
  $('branch-create-form').addEventListener('submit', createBranchAction);
  $('branch-filter').addEventListener('input', () => renderBranchModalList());
  $('btn-branch-stash-switch').addEventListener('click', stashAndSwitchBranch);

  // Gitignore Assistant Modal
  $('gitignore-modal-close').addEventListener('click', closeGitIgnoreModal);
  $('gitignore-cancel-btn').addEventListener('click', closeGitIgnoreModal);
  $('gitignore-modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('gitignore-modal-backdrop')) closeGitIgnoreModal();
  });
  $('gitignore-pattern-input').addEventListener('input', () => {
    $('gitignore-error').classList.add('hidden');
    syncGitIgnoreChipSelection();
    updateGitIgnoreMatchPreview();
  });
  $('gitignore-open-file-btn').addEventListener('click', async () => {
    const repo = state.gitIgnoreTarget?.repo || '';
    const gitignoreWsRel = toWorkspaceRelPath('.gitignore', repo);
    closeGitIgnoreModal();
    await openPreview(gitignoreWsRel);
  });
  $('gitignore-form').addEventListener('submit', handleGitIgnoreSubmit);

  // Generic Dialog Modal
  $('dialog-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inputVisible = !$('dialog-input-wrap').classList.contains('hidden');
    if (!inputVisible) {
      closeDialog(true);
      return;
    }
    const val = $('dialog-input').value.trim();
    if (!val) {
      $('dialog-error').textContent = 'Preencha este campo.';
      $('dialog-error').classList.remove('hidden');
      return;
    }
    closeDialog(val);
  });
  $('dialog-cancel').addEventListener('click', () => closeDialog(null));
  $('dialog-close').addEventListener('click', () => closeDialog(null));
  $('dialog-backdrop').addEventListener('click', (e) => {
    if (e.target === $('dialog-backdrop')) closeDialog(null);
  });

  // Global Dismiss & Keyboard Shortcuts
  document.addEventListener('click', () => {
    if (state.contextMenuOpen) closeContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.editMode && state.previewOpen) {
      e.preventDefault();
      saveEditedFile();
      return;
    }
    if (e.key === 'Escape') {
      if (state.contextMenuOpen) {
        closeContextMenu();
      } else if (!$('dialog-backdrop').classList.contains('hidden')) {
        closeDialog(null);
      } else if (!$('gitignore-modal-backdrop').classList.contains('hidden')) {
        closeGitIgnoreModal();
      } else if (!$('branch-modal-backdrop').classList.contains('hidden')) {
        closeBranchModal();
      } else if (!$('ws-modal-backdrop').classList.contains('hidden')) {
        closeWorkspaceModal();
      } else if (!$('ext-modal-backdrop').classList.contains('hidden')) {
        closeExternalAppsModal();
      } else if (state.activeTab === 'git' && state.gitComposerOpen) {
        setCommitComposerOpen(false);
      } else if (state.previewOpen && !state.editMode) {
        closePreview(false);
      }
    }
  });
}

// ---------- Bootstrap ----------
let eventsBound = false;
let workspaceListenerRegistered = false;

function renderTreeError(message) {
  const container = $('tree-container');
  if (container) {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'error-state';
    const msg = document.createElement('span');
    msg.textContent = message || 'Falha ao carregar o explorador.';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.id = 'btn-retry-init';
    retryBtn.className = 'btn btn-primary btn-sm';
    retryBtn.textContent = 'Tentar novamente';
    retryBtn.addEventListener('click', () => {
      container.innerHTML = '<div class="empty-state">Carregando arquivos...</div>';
      bootstrap();
    });
    box.append(msg, retryBtn);
    container.appendChild(box);
  }
  const wsName = $('ws-name');
  if (wsName && !state.activeRoot) {
    wsName.textContent = 'Erro ao carregar workspace';
  }
  setStatus(message || 'Erro ao iniciar workspace', '');
}

async function getInitialHostUris() {
  if (!window.sidecar?.getWorkspaceUris) return [];
  const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 700));
  try {
    const uris = await Promise.race([window.sidecar.getWorkspaceUris(), timeout]);
    return Array.isArray(uris) ? uris : [];
  } catch {
    return [];
  }
}

async function bootstrap() {
  try {
    state.treePinned = loadPinnedPreference();
    syncStageLayout();
    if (!eventsBound) {
      bindEvents();
      eventsBound = true;
    }

    await loadExternalApps();
    state.hostUris = await getInitialHostUris();

    if (!workspaceListenerRegistered && window.sidecar?.onWorkspaceChange) {
      workspaceListenerRegistered = true;
      window.sidecar.onWorkspaceChange(async (nextUris) => {
        const list = Array.isArray(nextUris) ? nextUris : [];
        const prevFirst = state.hostUris[0] || '';
        const nextFirst = list[0] || '';
        state.hostUris = list;
        if (nextFirst && (nextFirst !== prevFirst || !state.activeRoot)) {
          try {
            await refreshWorkspaceState({ autoPickHost: true });
          } catch (err) {
            renderTreeError(err.message);
          }
        }
      });
    }

    await refreshWorkspaceState({ autoPickHost: !state.autoSelectedHostUri || !state.activeRoot });
    state.autoSelectedHostUri = true;
  } catch (err) {
    showToast(err?.message || 'Erro ao iniciar workspace', true);
    renderTreeError(err?.message || 'Erro ao iniciar workspace');
  }
}

window.addEventListener('error', (event) => {
  const msg = event?.message || 'Erro inesperado na interface';
  if (!state.activeRoot) renderTreeError(msg);
  else showToast(msg, true);
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = event?.reason?.message || String(event?.reason || 'Erro assíncrono na interface');
  if (!state.activeRoot) renderTreeError(msg);
  else showToast(msg, true);
});

bootstrap();
})();
