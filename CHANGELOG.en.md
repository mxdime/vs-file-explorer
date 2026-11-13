# Changelog

🌐 **Language / Idioma:** **English** · [Português (BR)](CHANGELOG.md)

All notable changes to the **VS File Explorer** (`vs-file-explorer`) extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
