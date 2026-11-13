import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, '..');
const PORTABLE_TARGET = path.join(SOURCE_ROOT, 'portable-extension', 'vs-file-explorer');

const REQUIRED_RUNTIME_FILES = [
  'plugin.json',
  'README.md',
  'assets/logo.svg',
  'skills/vs-file-explorer/SKILL.md',
  'sidecars/explorer_pane/sidecar.json',
  'sidecars/explorer_pane/package.json',
  'sidecars/explorer_pane/main.mjs',
  'sidecars/explorer_pane/web/index.html',
];

const RUNTIME_FILES = [
  'plugin.json',
  'README.md',
  'sidecars/explorer_pane/sidecar.json',
  'sidecars/explorer_pane/package.json',
  'sidecars/explorer_pane/main.mjs',
];

const RUNTIME_DIRS = [
  'assets',
  'skills',
  'sidecars/explorer_pane/lib',
  'sidecars/explorer_pane/web',
];

const EXCLUDED_NAMES = new Set([
  'node_modules',
  '.git',
  '.temp',
  'test',
  'scripts',
  'portable-extension',
  '.DS_Store',
  'Thumbs.db',
]);

function getPluginsRootDir() {
  const userHome = process.env.USERPROFILE || os.homedir();
  return path.join(userHome, '.gemini', 'config', 'plugins');
}

function getDefaultPluginInstallDir() {
  return path.join(getPluginsRootDir(), 'vs-file-explorer');
}

function getLegacyPluginInstallDir() {
  return path.join(getPluginsRootDir(), 'project-explorer');
}

function validateRuntimeSource(sourceRoot) {
  const missing = REQUIRED_RUNTIME_FILES.filter(
    (relPath) => !fs.existsSync(path.join(sourceRoot, relPath))
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required runtime file(s) in ${sourceRoot}:\n- ${missing.join('\n- ')}`
    );
  }
}

function isLockError(err) {
  return err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'ENOTEMPTY');
}

function collectExpectedPaths(sourceRoot) {
  const expected = new Set();

  for (const relFile of RUNTIME_FILES) {
    expected.add(path.normalize(relFile));
  }

  function walkDir(srcDir, relBase) {
    if (!fs.existsSync(srcDir)) return;
    expected.add(path.normalize(relBase));
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      const relChild = path.join(relBase, entry.name);
      if (entry.isDirectory()) {
        walkDir(path.join(srcDir, entry.name), relChild);
      } else if (entry.isFile()) {
        expected.add(path.normalize(relChild));
      }
    }
  }

  for (const relDir of RUNTIME_DIRS) {
    walkDir(path.join(sourceRoot, relDir), relDir);
  }

  for (const rel of Array.from(expected)) {
    let parent = path.dirname(rel);
    while (parent && parent !== '.' && !expected.has(parent)) {
      expected.add(parent);
      parent = path.dirname(parent);
    }
  }

  return expected;
}

function pruneStaleEntries(targetRoot, expectedRelPaths, relBase = '') {
  const currentDir = relBase ? path.join(targetRoot, relBase) : targetRoot;
  if (!fs.existsSync(currentDir)) return;

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const relPath = relBase ? path.join(relBase, entry.name) : entry.name;
    const fullPath = path.join(currentDir, entry.name);
    const normalized = path.normalize(relPath);

    if (entry.isDirectory()) {
      pruneStaleEntries(targetRoot, expectedRelPaths, relPath);
      if (!expectedRelPaths.has(normalized)) {
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } catch (err) {
          if (!isLockError(err)) throw err;
        }
      }
    } else if (!expectedRelPaths.has(normalized)) {
      try {
        fs.rmSync(fullPath, { force: true });
      } catch (err) {
        if (!isLockError(err)) throw err;
      }
    }
  }
}

function removeDirBestEffort(dirPath) {
  if (!fs.existsSync(dirPath)) return false;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    return true;
  } catch (err) {
    if (!isLockError(err)) throw err;
    pruneStaleEntries(dirPath, new Set());
    return false;
  }
}

function copyFilteredDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name)) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      count += copyFilteredDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      count += 1;
    }
  }
  return count;
}

function syncBundleTo(sourceRoot, targetDir) {
  try {
    fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
  } catch (err) {
    if (!isLockError(err)) throw err;
    pruneStaleEntries(targetDir, collectExpectedPaths(sourceRoot));
  }
  fs.mkdirSync(targetDir, { recursive: true });

  let fileCount = 0;

  for (const relFile of RUNTIME_FILES) {
    const srcPath = path.join(sourceRoot, relFile);
    const destPath = path.join(targetDir, relFile);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    fileCount += 1;
  }

  for (const relDir of RUNTIME_DIRS) {
    const srcDir = path.join(sourceRoot, relDir);
    if (fs.existsSync(srcDir)) {
      fileCount += copyFilteredDir(srcDir, path.join(targetDir, relDir));
    }
  }

  return fileCount;
}

function parseArgs(argv) {
  const options = {
    portableOnly: false,
    targetDir: getDefaultPluginInstallDir(),
    customTarget: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--portable-only') {
      options.portableOnly = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--target' && argv[i + 1]) {
      options.targetDir = path.resolve(argv[i + 1]);
      options.customTarget = true;
      i += 1;
    }
  }

  return options;
}

export function runSync(options = {}) {
  const sourceRoot = options.sourceRoot || SOURCE_ROOT;
  const portableTarget = options.portableTarget || PORTABLE_TARGET;
  const installTarget = options.targetDir || getDefaultPluginInstallDir();
  const portableOnly = Boolean(options.portableOnly);
  const customTarget = Boolean(options.customTarget);

  validateRuntimeSource(sourceRoot);

  // Clean legacy portable-extension/project-explorer if present
  const legacyPortable = path.join(path.dirname(portableTarget), 'project-explorer');
  if (path.resolve(legacyPortable) !== path.resolve(portableTarget)) {
    removeDirBestEffort(legacyPortable);
  }

  const portableFiles = syncBundleTo(sourceRoot, portableTarget);
  const targets = [
    { kind: 'portable', path: portableTarget, filesCopied: portableFiles },
  ];

  let legacyRemoved = false;
  if (!portableOnly) {
    if (!customTarget) {
      legacyRemoved = removeDirBestEffort(getLegacyPluginInstallDir());
    }
    const installedFiles = syncBundleTo(sourceRoot, installTarget);
    targets.push({ kind: 'installed', path: installTarget, filesCopied: installedFiles });
  }

  return { ok: true, sourceRoot, legacyRemoved, targets };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runSync(options);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const target of result.targets) {
        console.log(
          `[sync-plugin] (${target.kind}) ${target.filesCopied} arquivo(s) sincronizado(s) -> ${target.path}`
        );
      }
    }
  } catch (err) {
    console.error(`[sync-plugin] Erro: ${err.message}`);
    process.exit(1);
  }
}
