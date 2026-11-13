import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildLaunchSpec,
  detectBuiltinApps,
  getExternalAppsConfig,
  launchExternalApp,
  resolveAppForFile,
  saveExternalAppsConfig,
} from '../sidecars/explorer_pane/lib/external-apps.mjs';
import {
  createFile,
  createFolder,
  deleteEntry,
  duplicateEntry,
  listDirectory,
  readPreview,
  renameEntry,
  writeFileContent,
} from '../sidecars/explorer_pane/lib/fs-crud.mjs';
import {
  getGitStatus,
  parseGitPorcelain,
  searchInFiles,
} from '../sidecars/explorer_pane/lib/search-git.mjs';
import {
  browseLocalFolders,
  getDataDir,
  getWorkspacesState,
  PathGuardError,
  resolveInsideWorkspace,
  selectWorkspace,
  uriToLocalPath,
} from '../sidecars/explorer_pane/lib/workspace-guard.mjs';
import {
  createRouter,
  extractMetadataWorkspaceUris,
  writeSystemClipboard,
} from '../sidecars/explorer_pane/main.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TEMP_BASE = join(REPO_ROOT, '.temp');

let testRoot;
let workspaceDir;
let dataDir;

before(() => {
  mkdirSync(TEMP_BASE, { recursive: true });
  testRoot = mkdtempSync(join(TEMP_BASE, 'pe-test-'));
  workspaceDir = join(testRoot, 'workspace');
  dataDir = join(testRoot, 'sidecar-data');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
});

after(() => {
  if (testRoot && existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

describe('workspace-guard', () => {
  it('converts file:// URIs and Windows paths consistently', () => {
    const uri = pathToFileURL(workspaceDir).href;
    const converted = uriToLocalPath(uri);
    assert.equal(converted.toLowerCase(), workspaceDir.toLowerCase());
    if (process.platform === 'win32') {
      assert.equal(uriToLocalPath('file:///c%3A/Users/test/proj'), 'C:\\Users\\test\\proj');
      assert.equal(uriToLocalPath('c:\\temp\\demo'), 'C:\\temp\\demo');
    }
    assert.equal(uriToLocalPath(''), '');
    assert.equal(uriToLocalPath(null), '');
  });

  it('blocks path traversal and absolute paths outside workspace root', () => {
    assert.throws(
      () => resolveInsideWorkspace(workspaceDir, '..\\..\\Windows', { allowNonExistent: true }),
      (err) => err instanceof PathGuardError && err.code === 'PATH_TRAVERSAL' && err.status === 403,
    );
    assert.throws(
      () => resolveInsideWorkspace(workspaceDir, '../outside.txt', { allowNonExistent: true }),
      (err) => err instanceof PathGuardError && err.code === 'PATH_TRAVERSAL',
    );
    const absOutside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/passwd';
    assert.throws(
      () => resolveInsideWorkspace(workspaceDir, absOutside, { allowNonExistent: true }),
      (err) => err instanceof PathGuardError && err.code === 'PATH_TRAVERSAL',
    );
    assert.throws(
      () => resolveInsideWorkspace(workspaceDir, 'bad\0file.txt', { allowNonExistent: true }),
      (err) => err instanceof PathGuardError && err.code === 'INVALID_PATH',
    );
  });

  it('resolves valid relative paths inside workspace and rejects root when allowRoot=false', () => {
    const subFile = join(workspaceDir, 'docs', 'note.md');
    mkdirSync(dirname(subFile), { recursive: true });
    writeFileSync(subFile, '# Hello', 'utf-8');

    const resolved = resolveInsideWorkspace(workspaceDir, 'docs/note.md');
    assert.equal(resolved.relPath, 'docs/note.md');
    assert.equal(resolved.targetPath.toLowerCase(), subFile.toLowerCase());

    assert.throws(
      () => resolveInsideWorkspace(workspaceDir, '', { allowRoot: false }),
      (err) => err instanceof PathGuardError && err.code === 'PROTECTED_PATH',
    );
  });

  it('persists workspace selection, recents, favorites, and browses local folders', () => {
    const secondWs = join(testRoot, 'workspace-two');
    mkdirSync(join(secondWs, 'subA'), { recursive: true });
    mkdirSync(join(secondWs, 'subB'), { recursive: true });

    const s1 = selectWorkspace({ pathOrUri: pathToFileURL(workspaceDir).href }, dataDir);
    assert.equal(s1.activeRoot.toLowerCase(), workspaceDir.toLowerCase());
    assert.equal(s1.recent.length, 1);

    const s2 = selectWorkspace({ pathOrUri: secondWs }, dataDir);
    assert.equal(s2.activeRoot.toLowerCase(), secondWs.toLowerCase());
    assert.equal(s2.recent.length, 2);

    const sFav = selectWorkspace({ pathOrUri: workspaceDir, toggleFavorite: true }, dataDir);
    assert.equal(sFav.favorites.length, 1);
    assert.equal(sFav.favorites[0].path.toLowerCase(), workspaceDir.toLowerCase());

    const reloaded = getWorkspacesState({ hostUris: [pathToFileURL(workspaceDir).href], dataDir });
    assert.equal(reloaded.activeRoot.toLowerCase(), secondWs.toLowerCase());
    assert.equal(reloaded.hostFolders.length, 1);

    const roots = browseLocalFolders('__roots__');
    assert.ok(Array.isArray(roots.folders) && roots.folders.length >= 1);

    const browse = browseLocalFolders(secondWs);
    assert.deepEqual(
      browse.folders.map((f) => f.name),
      ['subA', 'subB'],
    );
  });
});

describe('fs-crud', () => {
  let crudRoot;

  before(() => {
    crudRoot = join(testRoot, 'crud-ws');
    mkdirSync(join(crudRoot, '.git'), { recursive: true });
    mkdirSync(join(crudRoot, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(crudRoot, '.hiddenDir'), { recursive: true });
    mkdirSync(join(crudRoot, 'alpha'), { recursive: true });
    mkdirSync(join(crudRoot, 'zeta'), { recursive: true });
    writeFileSync(join(crudRoot, '.env'), 'SECRET=1', 'utf-8');
    writeFileSync(join(crudRoot, 'b.txt'), 'bbb', 'utf-8');
    writeFileSync(join(crudRoot, 'a.md'), '# Title\nLine 2', 'utf-8');
    // 1x1 transparent PNG
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    writeFileSync(join(crudRoot, 'pixel.png'), Buffer.from(pngBase64, 'base64'));
    writeFileSync(join(crudRoot, 'raw.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]));
  });

  it('lists directories sorted folders-first alphabetically and respects hidden/ignored filters', () => {
    const def = listDirectory(crudRoot, '');
    assert.deepEqual(
      def.entries.map((e) => `${e.type}:${e.name}`),
      ['directory:alpha', 'directory:zeta', 'file:a.md', 'file:b.txt', 'file:pixel.png', 'file:raw.bin'],
    );

    const withHidden = listDirectory(crudRoot, '', { showHidden: true, showIgnored: false });
    assert.ok(withHidden.entries.some((e) => e.name === '.hiddenDir'));
    assert.ok(withHidden.entries.some((e) => e.name === '.env'));
    assert.ok(!withHidden.entries.some((e) => e.name === '.git'));
    assert.ok(!withHidden.entries.some((e) => e.name === 'node_modules'));

    const withAll = listDirectory(crudRoot, '', { showHidden: true, showIgnored: true });
    assert.ok(withAll.entries.some((e) => e.name === '.git'));
    assert.ok(withAll.entries.some((e) => e.name === 'node_modules'));
  });

  it('reads previews for text, markdown, image, and binary files', () => {
    const md = readPreview(crudRoot, 'a.md');
    assert.equal(md.kind, 'text');
    assert.equal(md.isMarkdown, true);
    assert.equal(md.isBinary, false);
    assert.equal(md.lineCount, 2);
    assert.equal(md.content, '# Title\nLine 2');

    const txt = readPreview(crudRoot, 'b.txt');
    assert.equal(txt.kind, 'text');
    assert.equal(txt.isMarkdown, false);

    const img = readPreview(crudRoot, 'pixel.png');
    assert.equal(img.kind, 'image');
    assert.ok(img.dataUrl.startsWith('data:image/png;base64,'));

    const bin = readPreview(crudRoot, 'raw.bin');
    assert.equal(bin.kind, 'binary');
    assert.equal(bin.isBinary, true);
    assert.equal(bin.content, null);
  });

  it('performs full CRUD (createFolder, createFile, writeFileContent, duplicate, rename, delete) and guards root/.git', () => {
    const mk = createFolder(crudRoot, 'notes/sub');
    assert.equal(mk.ok, true);
    assert.ok(existsSync(join(crudRoot, 'notes', 'sub')));

    const cf = createFile(crudRoot, 'notes/sub/todo.md', '- item 1');
    assert.equal(cf.ok, true);
    assert.equal(readFileSync(join(crudRoot, 'notes', 'sub', 'todo.md'), 'utf-8'), '- item 1');

    const wr = writeFileContent(crudRoot, 'notes/sub/todo.md', '- item 1\n- item 2');
    assert.equal(wr.ok, true);
    assert.equal(readPreview(crudRoot, 'notes/sub/todo.md').lineCount, 2);

    const dup1 = duplicateEntry(crudRoot, 'notes/sub/todo.md');
    assert.equal(dup1.relPath, 'notes/sub/todo copy.md');
    const dup2 = duplicateEntry(crudRoot, 'notes/sub/todo.md');
    assert.equal(dup2.relPath, 'notes/sub/todo copy 2.md');

    const ren = renameEntry(crudRoot, 'notes/sub/todo copy.md', 'renamed.md');
    assert.equal(ren.relPath, 'notes/sub/renamed.md');
    assert.ok(existsSync(join(crudRoot, 'notes', 'sub', 'renamed.md')));

    const del = deleteEntry(crudRoot, 'notes/sub/renamed.md');
    assert.equal(del.ok, true);
    assert.ok(!existsSync(join(crudRoot, 'notes', 'sub', 'renamed.md')));

    assert.throws(
      () => deleteEntry(crudRoot, ''),
      (err) => err instanceof PathGuardError && err.code === 'PROTECTED_PATH',
    );
    assert.throws(
      () => deleteEntry(crudRoot, '.git'),
      (err) => err instanceof PathGuardError && err.code === 'PROTECTED_PATH',
    );
  });
});

describe('external-apps', () => {
  it('detects builtin Windows app structure and resolves .md -> notepadpp by default when available', () => {
    const fakeNpp = 'C:\\Program Files\\Notepad++\\notepad++.exe';
    const fakeExists = (p) => p === fakeNpp;

    const apps = detectBuiltinApps({ existsFn: fakeExists, platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' } });
    const npp = apps.find((a) => a.id === 'notepadpp');
    assert.equal(npp.available, true);
    assert.equal(npp.exePath, fakeNpp);
    assert.ok(apps.some((a) => a.id === 'explorer' && a.kind === 'reveal'));
    assert.ok(apps.some((a) => a.id === 'powershell' && a.kind === 'terminal'));
    assert.ok(apps.some((a) => a.id === 'default' && a.kind === 'default'));

    const cfg = getExternalAppsConfig({ dataDir, existsFn: fakeExists, platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' } });
    assert.equal(cfg.associations['.md'], 'notepadpp');
    const resolved = resolveAppForFile('README.md', undefined, cfg);
    assert.equal(resolved.id, 'notepadpp');
  });

  it('persists custom apps and extension associations and builds safe detached spawn specs without shell execution', () => {
    const appDataDir = join(testRoot, 'ext-apps-data');
    const fakeExe = join(testRoot, 'mock-editor.exe');
    const targetFile = join(workspaceDir, 'sample.txt');
    writeFileSync(fakeExe, 'MZ', 'utf-8');
    writeFileSync(targetFile, 'hello', 'utf-8');

    const saved = saveExternalAppsConfig({
      associations: { '.txt': 'myeditor', md: 'notepadpp' },
      customApps: [{ id: 'myeditor', name: 'My Editor', exePath: fakeExe, args: ['--wait'] }],
    }, { dataDir: appDataDir });

    assert.equal(saved.associations['.txt'], 'myeditor');
    assert.equal(saved.customApps.length, 1);
    assert.equal(saved.customApps[0].id, 'myeditor');

    const reloaded = getExternalAppsConfig({ dataDir: appDataDir });
    assert.equal(reloaded.associations['.txt'], 'myeditor');

    const explorerSpec = buildLaunchSpec({ id: 'explorer', kind: 'reveal', exePath: 'explorer.exe' }, targetFile);
    assert.equal(explorerSpec.command, 'explorer.exe');
    assert.deepEqual(explorerSpec.args, [`/select,${targetFile}`]);
    assert.equal(explorerSpec.options.detached, true);
    assert.equal('shell' in explorerSpec.options, false);

    const calls = [];
    const mockSpawn = (command, args, opts) => {
      calls.push({ command, args, opts });
      return { unref() {} };
    };
    const res = launchExternalApp({
      targetPath: targetFile,
      dataDir: appDataDir,
      spawnFn: mockSpawn,
    });
    assert.equal(res.ok, true);
    assert.equal(res.appId, 'myeditor');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, fakeExe);
    assert.deepEqual(calls[0].args, ['--wait', targetFile]);
    assert.equal(calls[0].opts.detached, true);
    assert.equal(calls[0].opts.stdio, 'ignore');
  });
});

describe('search-git', () => {
  let searchRoot;

  before(() => {
    searchRoot = join(testRoot, 'search-ws');
    mkdirSync(join(searchRoot, 'src'), { recursive: true });
    mkdirSync(join(searchRoot, 'node_modules', 'dep'), { recursive: true });
    mkdirSync(join(searchRoot, '.git'), { recursive: true });
    writeFileSync(join(searchRoot, 'src', 'index.js'), 'const needleToken = 42;\nconsole.log(needleToken);\n', 'utf-8');
    writeFileSync(join(searchRoot, 'node_modules', 'dep', 'lib.js'), 'const needleToken = 99;\n', 'utf-8');
    writeFileSync(join(searchRoot, '.git', 'HEAD'), 'needleToken\n', 'utf-8');
    writeFileSync(join(searchRoot, 'src', 'bin.dat'), Buffer.from([0x6e, 0x65, 0x65, 0x00, 0x64]));
  });

  it('finds text matches and skips .git, node_modules, and binary files', () => {
    const res = searchInFiles(searchRoot, 'needleToken');
    assert.equal(res.filesMatched, 1);
    assert.equal(res.totalMatches, 2);
    assert.deepEqual(
      res.matches.map((m) => `${m.relPath}:${m.line}`),
      ['src/index.js:1', 'src/index.js:2'],
    );
  });

  it('parses git status porcelain output and propagates status priority to parent folders', () => {
    const sample = [
      ' M src/lib/app.js',
      '?? src/lib/new.md',
      'A  README.md',
      'D  old.txt',
      'R  "old name.txt" -> "docs/new name.txt"',
    ].join('\n');
    const parsed = parseGitPorcelain(sample);
    assert.equal(parsed.files['src/lib/app.js'], 'M');
    assert.equal(parsed.files['src/lib/new.md'], 'U');
    assert.equal(parsed.files['README.md'], 'A');
    assert.equal(parsed.files['old.txt'], 'D');
    assert.equal(parsed.files['docs/new name.txt'], 'R');
    assert.equal(parsed.folders['src/lib'], 'M');
    assert.equal(parsed.folders.src, 'M');
    assert.equal(parsed.folders.docs, 'R');
  });

  it('runs getGitStatus on a real git repo inside .temp and detects untracked files', async () => {
    const gitRepoDir = join(testRoot, 'real-git-ws');
    mkdirSync(join(gitRepoDir, 'sub'), { recursive: true });
    execFileSync('git', ['init'], { cwd: gitRepoDir, stdio: 'ignore', windowsHide: true });
    writeFileSync(join(gitRepoDir, 'sub', 'untracked.txt'), 'hello git\n', 'utf-8');

    const status = await getGitStatus(gitRepoDir);
    assert.equal(status.isRepo, true);
    assert.equal(status.files['sub/untracked.txt'], 'U');
    assert.equal(status.folders.sub, 'U');
    assert.ok(status.entries.some((e) => e.relPath === 'sub/untracked.txt' && e.status === 'U'));
  });
});

describe('main.mjs HTTP API', () => {
  let server;
  let baseUrl;
  let apiRoot;
  let apiDataDir;
  const token = randomUUID();
  const spawnCalls = [];
  const clipboardCalls = [];

  before(async () => {
    apiRoot = join(testRoot, 'api-ws');
    apiDataDir = join(testRoot, 'api-data');
    mkdirSync(join(apiRoot, 'folder'), { recursive: true });
    writeFileSync(join(apiRoot, 'hello.md'), '# API Test\nFindMeHere\n', 'utf-8');

    const router = createRouter({
      dataDir: apiDataDir,
      token,
      spawnFn: (cmd, args, opts) => {
        spawnCalls.push({ cmd, args, opts });
        return { unref() {} };
      },
      clipboardFn: (text) => {
        clipboardCalls.push(text);
        return { ok: true, length: text.length };
      },
      execFileFn: (_file, args, _opts, cb) => {
        const convId = args[args.length - 1];
        if (convId === 'conv-fallback-123') {
          cb(null, JSON.stringify({
            response: {
              workspaces: [{ workspaceFolderAbsoluteUri: pathToFileURL(apiRoot).href }],
            },
          }));
          return;
        }
        cb(new Error('not found'));
      },
    });
    server = http.createServer(router);
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });

  async function reqJson(method, path, body, extraHeaders = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON response
    }
    return { status: res.status, text, json };
  }

  it('enforces X-Sidecar-Token on POST routes', async () => {
    const unauth = await reqJson('POST', '/api/workspaces/select', { path: apiRoot });
    assert.equal(unauth.status, 401);
    assert.equal(unauth.json.error, 'unauthorized');

    const auth = await reqJson('POST', '/api/workspaces/select', { path: apiRoot }, { 'X-Sidecar-Token': token });
    assert.equal(auth.status, 200);
    assert.equal(auth.json.ok, true);
    assert.equal(auth.json.activeRoot.toLowerCase(), apiRoot.toLowerCase());
  });

  it('serves GET routes (/api/workspaces, /api/tree, /api/preview, /api/search, /api/git-status, /api/external-apps)', async () => {
    const ws = await reqJson('GET', `/api/workspaces?uris=${encodeURIComponent(JSON.stringify([pathToFileURL(apiRoot).href]))}`);
    assert.equal(ws.status, 200);
    assert.equal(ws.json.hostFolders.length, 1);

    const tree = await reqJson('GET', '/api/tree?path=');
    assert.equal(tree.status, 200);
    assert.deepEqual(tree.json.entries.map((e) => e.name), ['folder', 'hello.md']);

    const preview = await reqJson('GET', '/api/preview?path=hello.md');
    assert.equal(preview.status, 200);
    assert.equal(preview.json.isMarkdown, true);
    assert.match(preview.json.content, /FindMeHere/);

    const search = await reqJson('GET', '/api/search?q=FindMeHere');
    assert.equal(search.status, 200);
    assert.equal(search.json.totalMatches, 1);

    const git = await reqJson('GET', '/api/git-status');
    assert.equal(git.status, 200);
    assert.equal(typeof git.json.isRepo, 'boolean');
    assert.ok(Array.isArray(git.json.entries));

    const ext = await reqJson('GET', '/api/external-apps');
    assert.equal(ext.status, 200);
    assert.ok(Array.isArray(ext.json.apps) && ext.json.apps.length >= 4);

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /<title>VS File Explorer<\/title>/);
    assert.match(html, /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\.\/logo\.svg"/);
    assert.match(html, /<script\s+src="\.\/preload\.js"><\/script>/);
    assert.match(html, /<script\s+src="\.\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /type\s*=\s*["']module["']/i);
    assert.match(html, /<button[^>]*id="btn-ext-settings"[\s\S]*?<svg[\s\S]*?<\/svg>\s*<\/button>/);
    assert.match(html, /id="btn-ext-settings"[^>]*aria-label="Configura[çc][õo]es"/);
    assert.doesNotMatch(html, /id="btn-ext-settings"[\s\S]*?<span>Configura[çc][õo]es<\/span>/);
    assert.match(html, /id="btn-copy-mention"/);

    const pluginJson = JSON.parse(readFileSync(resolve(__dirname, '..', 'plugin.json'), 'utf-8'));
    assert.equal(pluginJson.name, 'vs-file-explorer');
    assert.equal(pluginJson.displayName, 'VS File Explorer');
    assert.equal(pluginJson.logo, 'assets/logo.svg');
    assert.match(getDataDir().replace(/\\/g, '/'), /\/vs-file-explorer$/);

    const logoRes = await fetch(`${baseUrl}/logo.svg`);
    assert.equal(logoRes.status, 200);
    assert.match(logoRes.headers.get('content-type') || '', /image\/svg\+xml/i);
    assert.match(await logoRes.text(), /<svg[\s>]/);

    const cssRes = await fetch(`${baseUrl}/styles.css`);
    assert.equal(cssRes.status, 200);

    const jsRes = await fetch(`${baseUrl}/app.js`);
    assert.equal(jsRes.status, 200);
    assert.doesNotMatch(await jsRes.text(), /^\s*(import|export)\s+/m);
  });

  it('resolves workspace URIs via conversation metadata fallback when uris param is empty', async () => {
    const extracted = extractMetadataWorkspaceUris({
      conversationMetadata: {
        workspaceUris: [pathToFileURL(workspaceDir).href],
        workspaces: [{ workspaceFolderAbsoluteUri: pathToFileURL(apiRoot).href }],
      },
    });
    assert.equal(extracted.length, 2);

    const fallbackWs = await reqJson('GET', '/api/workspaces?conversationId=conv-fallback-123');
    assert.equal(fallbackWs.status, 200);
    assert.equal(fallbackWs.json.hostFolders.length, 1);
    assert.equal(fallbackWs.json.hostFolders[0].path.toLowerCase(), apiRoot.toLowerCase());
  });

  it('handles POST /api/crud, /api/external-apps/config, and /api/open-external with token', async () => {
    const headers = { 'X-Sidecar-Token': token };

    const created = await reqJson('POST', '/api/crud', {
      action: 'createFile',
      path: 'folder/new.txt',
      content: 'v1',
    }, headers);
    assert.equal(created.status, 200);
    assert.equal(created.json.ok, true);

    const saved = await reqJson('POST', '/api/crud', {
      action: 'saveContent',
      path: 'folder/new.txt',
      content: 'v2',
    }, headers);
    assert.equal(saved.status, 200);
    assert.equal(readFileSync(join(apiRoot, 'folder', 'new.txt'), 'utf-8'), 'v2');

    const traversal = await reqJson('POST', '/api/crud', {
      action: 'delete',
      path: '../../Windows',
    }, headers);
    assert.equal(traversal.status, 403);
    assert.equal(traversal.json.code, 'PATH_TRAVERSAL');

    const cfgRes = await reqJson('POST', '/api/external-apps/config', {
      associations: { '.txt': 'explorer' },
    }, headers);
    assert.equal(cfgRes.status, 200);
    assert.equal(cfgRes.json.associations['.txt'], 'explorer');

    const launchRes = await reqJson('POST', '/api/open-external', {
      path: 'folder/new.txt',
      appId: 'explorer',
    }, headers);
    assert.equal(launchRes.status, 200);
    assert.equal(launchRes.json.ok, true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].cmd, 'explorer.exe');

    const clipUnauth = await reqJson('POST', '/api/clipboard', { text: '@folder/new.txt' });
    assert.equal(clipUnauth.status, 401);

    const clipBad = await reqJson('POST', '/api/clipboard', { text: '' }, headers);
    assert.equal(clipBad.status, 400);

    const clipOk = await reqJson('POST', '/api/clipboard', { text: '@folder/new.txt' }, headers);
    assert.equal(clipOk.status, 200);
    assert.equal(clipOk.json.ok, true);
    assert.equal(clipOk.json.length, '@folder/new.txt'.length);
    assert.deepEqual(clipboardCalls, ['@folder/new.txt']);
  });

  it('writes UTF-8 text to system clipboard via stdin without shell interpolation', async () => {
    const written = [];
    const mockSpawn = (cmd, args, opts) => {
      assert.equal(cmd, 'powershell.exe');
      assert.equal('shell' in opts, false);
      const handlers = {};
      return {
        stderr: { on() {} },
        on(ev, fn) { handlers[ev] = fn; },
        stdin: {
          end(txt, enc) {
            written.push({ cmd, args, txt, enc });
            handlers.close?.(0);
          },
        },
      };
    };
    const res = await writeSystemClipboard('@docs/readme.md', { spawnFn: mockSpawn, platform: 'win32' });
    assert.equal(res.ok, true);
    assert.equal(written.length, 1);
    assert.equal(written[0].txt, '@docs/readme.md');
    assert.equal(written[0].enc, 'utf8');
  });

  it('configures sidecar.json with non-interactive agent_permissions matching builtin sidecars', () => {
    const manifestPath = resolve(import.meta.dirname, '..', 'sidecars', 'explorer_pane', 'sidecar.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifest.display_name, 'VS File Explorer');
    assert.equal(manifest.agent_permissions?.allows_user_interactions, false);
  });
});
