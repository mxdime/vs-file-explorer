/**
 * Windows external application detection, extension association persistence, and safe spawn launcher.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { getDataDir, PathGuardError } from './workspace-guard.mjs';

function firstExisting(candidates, existsFn) {
  for (const candidate of candidates) {
    if (candidate && existsFn(candidate)) return candidate;
  }
  return '';
}

function configFilePath(dataDir) {
  return join(getDataDir(dataDir), 'external-apps.json');
}

function normalizeExt(ext) {
  if (typeof ext !== 'string') return '';
  const trimmed = ext.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

export function detectBuiltinApps({ existsFn = existsSync, env = process.env, platform = process.platform } = {}) {
  const localAppData = env.LOCALAPPDATA || '';
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const notepadPath = firstExisting([
    join(programFiles, 'Notepad++', 'notepad++.exe'),
    join(programFilesX86, 'Notepad++', 'notepad++.exe'),
    localAppData ? join(localAppData, 'Programs', 'Notepad++', 'notepad++.exe') : '',
  ], existsFn);

  const vscodePath = firstExisting([
    localAppData ? join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : '',
    join(programFiles, 'Microsoft VS Code', 'Code.exe'),
    join(programFilesX86, 'Microsoft VS Code', 'Code.exe'),
  ], existsFn);

  const pwshPath = firstExisting([
    join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  ], existsFn);

  const isWin = platform === 'win32';
  return [
    { id: 'notepadpp', name: 'Notepad++', exePath: notepadPath, available: Boolean(notepadPath), isBuiltin: true, kind: 'editor', args: [] },
    { id: 'vscode', name: 'VS Code', exePath: vscodePath, available: Boolean(vscodePath), isBuiltin: true, kind: 'editor', args: [] },
    { id: 'explorer', name: 'Windows Explorer (Mostrar na Pasta)', exePath: 'explorer.exe', available: isWin, isBuiltin: true, kind: 'reveal', args: [] },
    { id: 'powershell', name: 'PowerShell Aqui', exePath: pwshPath || 'powershell.exe', available: isWin, isBuiltin: true, kind: 'terminal', args: [] },
    { id: 'default', name: 'App Padrão do Windows', exePath: 'cmd.exe', available: isWin, isBuiltin: true, kind: 'default', args: [] },
  ];
}

function readStoredConfig(dataDir) {
  const file = configFilePath(dataDir);
  if (!existsSync(file)) return { customApps: [], associations: {}, hasFile: false };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    const customApps = Array.isArray(parsed.customApps) ? parsed.customApps : [];
    const associations = parsed.associations && typeof parsed.associations === 'object' ? parsed.associations : {};
    return { customApps, associations, hasFile: true };
  } catch {
    return { customApps: [], associations: {}, hasFile: false };
  }
}

export function getExternalAppsConfig({ dataDir, existsFn = existsSync, env = process.env, platform = process.platform } = {}) {
  const builtins = detectBuiltinApps({ existsFn, env, platform });
  const stored = readStoredConfig(dataDir);

  const customApps = stored.customApps
    .filter((a) => a && typeof a.name === 'string' && typeof a.exePath === 'string' && a.exePath.trim())
    .map((a, idx) => ({
      id: typeof a.id === 'string' && a.id.trim() ? a.id.trim() : `custom-${idx + 1}`,
      name: a.name.trim(),
      exePath: a.exePath.trim(),
      available: existsFn(a.exePath.trim()),
      isBuiltin: false,
      kind: 'custom',
      args: Array.isArray(a.args) ? a.args.map(String) : [],
    }));

  const associations = {};
  const notepad = builtins.find((a) => a.id === 'notepadpp');
  if (notepad?.available) {
    associations['.md'] = 'notepadpp';
  }
  for (const [ext, appId] of Object.entries(stored.associations)) {
    const norm = normalizeExt(ext);
    if (norm && typeof appId === 'string' && appId.trim()) {
      associations[norm] = appId.trim();
    }
  }

  return {
    apps: [...builtins, ...customApps],
    associations,
    customApps,
  };
}

export function saveExternalAppsConfig({ associations, customApps } = {}, { dataDir, existsFn = existsSync, env = process.env, platform = process.platform } = {}) {
  const current = readStoredConfig(dataDir);
  const nextAssociations = { ...current.associations };
  if (associations && typeof associations === 'object') {
    for (const [ext, appId] of Object.entries(associations)) {
      const norm = normalizeExt(ext);
      if (!norm) continue;
      if (!appId) {
        delete nextAssociations[norm];
      } else {
        nextAssociations[norm] = String(appId).trim();
      }
    }
  }

  let nextCustom = current.customApps;
  if (Array.isArray(customApps)) {
    nextCustom = customApps
      .filter((a) => a && typeof a.name === 'string' && typeof a.exePath === 'string' && a.exePath.trim())
      .map((a, idx) => ({
        id: typeof a.id === 'string' && a.id.trim() ? a.id.trim() : `custom-${idx + 1}`,
        name: a.name.trim(),
        exePath: a.exePath.trim(),
        args: Array.isArray(a.args) ? a.args.map(String) : [],
      }));
  }

  const dir = getDataDir(dataDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configFilePath(dataDir), JSON.stringify({ customApps: nextCustom, associations: nextAssociations }, null, 2), 'utf-8');
  return getExternalAppsConfig({ dataDir, existsFn, env, platform });
}

export function resolveAppForFile(filePath, preferredAppId, config) {
  const apps = config?.apps || [];
  if (preferredAppId) {
    const explicit = apps.find((a) => a.id === preferredAppId);
    if (!explicit) {
      throw new PathGuardError(`Unknown external app: ${preferredAppId}`, 'APP_NOT_FOUND', 404);
    }
    return explicit;
  }

  const ext = extname(filePath || '').toLowerCase();
  const mappedId = config?.associations?.[ext];
  if (mappedId) {
    const mapped = apps.find((a) => a.id === mappedId);
    if (mapped && mapped.available) return mapped;
  }
  return apps.find((a) => a.id === 'default') || apps[0];
}

/** Builds a safe detached spawn specification with zero shell interpolation. */
export function buildLaunchSpec(app, targetPath, { targetIsDir = false } = {}) {
  const options = { detached: true, stdio: 'ignore', windowsHide: false };
  if (!app) throw new PathGuardError('External app specification is required', 'APP_NOT_FOUND', 404);

  if (app.id === 'explorer' || app.kind === 'reveal') {
    return {
      command: app.exePath || 'explorer.exe',
      args: targetIsDir ? [targetPath] : [`/select,${targetPath}`],
      cwd: undefined,
      options,
    };
  }
  if (app.id === 'powershell' || app.kind === 'terminal') {
    const dir = targetIsDir ? targetPath : dirname(targetPath);
    return {
      command: app.exePath || 'powershell.exe',
      args: ['-NoExit'],
      cwd: dir,
      options,
    };
  }
  if (app.id === 'default' || app.kind === 'default') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/c', 'start', '', targetPath],
      cwd: undefined,
      options,
    };
  }
  if (!app.exePath) {
    throw new PathGuardError(`Executable not found for ${app.name}`, 'APP_UNAVAILABLE', 400);
  }
  return {
    command: app.exePath,
    args: [...(app.args || []), targetPath],
    cwd: undefined,
    options,
  };
}

export function launchExternalApp({ targetPath, appId, dataDir, spawnFn = spawn, existsFn = existsSync } = {}) {
  if (!targetPath || !existsFn(targetPath)) {
    throw new PathGuardError(`Target path does not exist: ${targetPath}`, 'ENOENT', 404);
  }
  const config = getExternalAppsConfig({ dataDir, existsFn });
  const app = resolveAppForFile(targetPath, appId, config);
  const targetIsDir = statSync(targetPath).isDirectory();
  const spec = buildLaunchSpec(app, targetPath, { targetIsDir });

  if (!['explorer', 'default', 'powershell'].includes(app.id) && !existsFn(spec.command)) {
    throw new PathGuardError(`Executable missing on disk: ${spec.command}`, 'APP_UNAVAILABLE', 400);
  }

  const child = spawnFn(spec.command, spec.args, { ...spec.options, ...(spec.cwd ? { cwd: spec.cwd } : {}) });
  if (child && typeof child.unref === 'function') {
    child.unref();
  }
  return { ok: true, appId: app.id, appName: app.name, targetPath, command: spec.command, args: spec.args };
}
