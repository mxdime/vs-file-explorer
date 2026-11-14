# Changelog

🌐 **Language / Idioma:** **English** · [Português (BR)](CHANGELOG.md)

All notable changes to the **VS File Explorer** (`vs-file-explorer`) extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-11-14

### Added
- **Real-Time Tree & Git Updates (`lib/fs-watcher.mjs` + `GET /api/fs/events`):**
  - Native workspace watching via `fs.watch(root, { recursive: true })` with cursor-based long-polling (`seq`) compatible with `SidecarApp`.
  - Early noise filtering (`node_modules/`, `.venv/`, `venv/`, `__pycache__/`, `dist/`, `build/`, `.next/`, `.temp/`, `.git/objects/`, `.git/*.lock`) and Git state detection (`.git/HEAD`, `.git/index`, `.git/refs/heads/`, `.git/refs/remotes/`).
  - Coalesced `250ms` debounce, silent refresh (`silent: true`) scoped strictly to affected expanded folders, debounced `refreshGitStatus` (`400ms`), and automatic pause while hidden (`document.hidden`).
- **Drag & Drop `@mention`:**
  - Explorer tree rows (`.tree-row`) and Git rows (`.git-row`) are now `draggable="true"`, populating `text/plain` and `application/x-antigravity-mention` with `@relative/path`.
- **Tests:** Expanded test suite to 27 passing tests across 6 suites (`fs-watcher & drag-mention` + `/api/fs/events`).

## [1.0.1] - 2026-11-13

### Added
- **Git Tab v2 (Source Control + Branch Manager + Multi-Remote):**
  - Rich repository status via `git status --porcelain=v2 --branch -uall` (`branch`, `oid`, `upstream`, `ahead`/`behind`, `detached`, `lastCommit`, `remotes`, `stashCount`) preserving v1 compatibility.
  - Complete **Stage (`+`) / Unstage (`-`) / Discard (`↶` with confirmation) / Commit (`Ctrl+Enter` + `feat:`, `fix:`, `docs:`, `chore:` chips)** workflow backed by a per-repository serialized queue (`enqueueGitOp`) preventing `.git/index.lock` races.
  - **Branch Manager modal:** filter local/remote branches, create, switch (with one-click *"Guardar no Stash e Trocar"* recovery on dirty worktrees), rename, merge into current, and delete (blocking active branch).
  - **Diff Preview mode** (`GET /api/git/diff`) with hunk/line coloring (`@@`, `+`, `-`), safe truncation (>150 KB / 1,500 lines), and quick `Diff` ↔ `File` toggle.
  - **AI productivity shortcuts:** **Copiar @** (changed file mentions) and **Copiar Diff** wired into the 3-tier clipboard fallback.
  - **Stash & Remotes sections:** *Stash Atual*, *Pop*, *Apply*, *Drop*, and multi-remote actions (`Fetch`, `Pull --ff-only`, `Push`) with explicit remote selector.
  - Automated test suite expanded to **23 passing tests** in `test/project-explorer.test.mjs` against real temporary Git repositories, bare remotes, and multi-repo layouts in `.temp/`.
- **Git Tab v2.1 (Multi-Repo Support + On-Demand Commit Box):**
  - Automatic Git repository discovery (`discoverGitRepos` / `GET /api/git/repos`) across workspace root and nested folders (submodules, sub-repos, or parent project folders), showing a compact switcher (`#git-repo-switcher`) with branch and change badges when multiple repositories exist.
  - All `/api/git*` routes accept an optional `repo` parameter strictly validated via `resolveGitRepoRoot` (`resolveInsideWorkspace`), composing workspace-relative paths for Preview/Diff and `@mention` copy on sub-repos.
  - **On-demand Commit composer:** compact action bar by default (`Commit`, `Copiar @`, `Copiar Diff`); message textarea and prefix chips (`feat:`, `fix:`, `docs:`, `chore:`) expand only when clicking **Commit** (auto-focused) and collapse on `Cancel`, `Esc`, or successful commit.

---

## [1.0.0] - 2026-11-13

### Added
- **Antigravity App 2.0 UI Plugin & Sidecar (`AUX_PANE`)** (`vs-file-explorer/explorer_pane`) with colored vector icon ([`assets/logo.svg`](assets/logo.svg)).
- **Workspace Auto-Detection** via `window.sidecar.getWorkspaceUris()` and `onWorkspaceChange()`, with server-side fallback via `agentapi conversation_metadata` using `ANTIGRAVITY_CONVERSATION_ID`, plus manual folder picker, recents, and favorites.
- **3-Tab Workbench:**
  - **Explorer:** hierarchical tree with indent guides, lazy-loading, quick filter, configurable ignored-folder toggle, and Git status badges (`M`, `A`, `D`, `U`).
  - **Search:** workspace text search (`Grep`) with matching line previews.
  - **Git:** dedicated list of modified and untracked repository files.
- **Full File & Folder CRUD:** create file, create folder, rename, duplicate, delete with confirmation, and protection against root or `.git` mutation.
- **Embedded Preview with Hover Auto-Collapse:** automatically minimizes the tree rail when opening a file and expands smoothly on hover (with a *Pin* toggle).
- **1-Click `@mention` Copy:** quick `@` button per tree row, context menu action, and **Copiar @** button in Preview with a 3-tier fallback (`navigator.clipboard` → `execCommand('copy')` → `POST /api/clipboard` via PowerShell `Set-Clipboard` over `stdin`).
- **Settings & External App Launcher:** compact gear-icon button in the header opening **Configurações** to map extensions (default `.md` → Notepad++) and launch external apps (VS Code, Explorer, PowerShell) without shell interpolation.
- **Portable Installer & Companion Skill:** [`scripts/sync-plugin.mjs`](scripts/sync-plugin.mjs), [`portable-extension/`](portable-extension/) (`install.bat`, `install.ps1`, bilingual install guides), and [`skills/vs-file-explorer/SKILL.md`](skills/vs-file-explorer/SKILL.md).
- **Automated Test Suite:** 18 tests in `test/project-explorer.test.mjs` running on `node --test`.

### Security & Stability
- Strict path-traversal prevention inside `lib/workspace-guard.mjs`.
- `X-Sidecar-Token` enforcement across all mutating `POST` routes.
- Non-interactive `"agent_permissions": { "allows_user_interactions": false }` configured in [`sidecar.json`](sidecars/explorer_pane/sidecar.json).
