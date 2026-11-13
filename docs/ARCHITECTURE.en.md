# Architecture & Technical Reference — VS File Explorer

🌐 **Language / Idioma:** **English** · [Português (BR)](ARCHITECTURE.md)

## 1. Overview

**VS File Explorer** is a UI Plugin for **Antigravity App 2.0** structured around:

1. **Plugin Manifest (`plugin.json`)**: registers the `vs-file-explorer` plugin, version `1.0.0`, vector icon `assets/logo.svg`, and suggested prompts.
2. **Sidecar Aux Pane (`sidecars/explorer_pane/`)**:
   - `sidecar.json`: defines `SIDECAR_UI_ENTRYPOINT_AUX_PANE` and `"agent_permissions": { "allows_user_interactions": false }`.
   - `main.mjs`: HTTP server built on `sidecar_sdk` (`SidecarApp`) serving static UI assets and the local REST API.
   - `lib/workspace-guard.mjs`: `file://` URI normalization, conversation metadata discovery (`agentapi`), persistent state (`config.json`: active workspace, recents, favorites), and strict path-traversal guards.
   - `lib/fs-crud.mjs`: folders-first directory listing, file preview reader (text, Markdown, images, binary metadata), and CRUD operations.
   - `lib/external-apps.mjs`: Windows app auto-detection (Notepad++, VS Code, Explorer, PowerShell), extension-association config, and shell-free detached process launching (`spawn(..., { detached: true })`).
   - `lib/search-git.mjs`: in-workspace text search (`searchInFiles`) skipping `.git`/`node_modules`/binary files, plus `git status --porcelain` parser.
   - `web/`: classic script frontend (`index.html`, `styles.css`, `app.js` without ES module imports for webview compatibility).

---

## 2. Sidecar HTTP Endpoints (`main.mjs`)

| Method | Route | Auth (`X-Sidecar-Token`) | Purpose |
|---|---|---|---|
| `GET` | `/` | — | Main UI HTML page (`web/index.html`) |
| `GET` | `/styles.css`, `/app.js`, `/logo.svg` | — | Static frontend assets |
| `GET` | `/api/workspaces` | — | Lists active workspace, conversation workspaces (with `agentapi` fallback), recents, and favorites |
| `POST` | `/api/workspaces/select` | Required | Sets active workspace, toggles favorites, or browses local directories |
| `GET` | `/api/tree` | — | Lists entries inside a relative workspace directory |
| `GET` | `/api/preview` | — | Reads file preview payload (text, base64 image, or binary metadata) |
| `POST` | `/api/crud` | Required | Executes `createFile`, `createFolder`, `rename`, `duplicate`, `delete`, or `save` |
| `GET` | `/api/search` | — | Searches text matches across workspace files |
| `GET` | `/api/git-status` | — | Returns Git status (`git status --porcelain`) with parent folder propagation |
| `GET` | `/api/external-apps` | — | Lists detected apps, custom apps, and extension associations |
| `POST` | `/api/external-apps/config` | Required | Saves extension associations and custom app entries |
| `POST` | `/api/open-external` | Required | Opens a target file/folder in the configured external application |
| `POST` | `/api/clipboard` | Required | Writes UTF-8 text to the Windows clipboard via PowerShell `Set-Clipboard` (`stdin`) |

---

## 3. Security & Isolation

- **Path Guard (`resolveInsideWorkspace`)**: normalizes paths and checks via `path.relative` and `realpathSync` (when existing) that targets stay strictly inside the active workspace root; path-traversal attempts fail with HTTP `403` (`PATH_TRAVERSAL`).
- **Destructive Action Guards**: blocks deleting or renaming the workspace root or `.git` internals.
- **No Shell Interpolation**: external apps and `Set-Clipboard` execute through `execFile` / `spawn` without `shell: true`; clipboard text is streamed over `stdin` in UTF-8.
- **Zero External Runtime Dependencies**: relies solely on built-in Node.js 20+ APIs and the host-provided `sidecar_sdk`.

---

## 4. Packaging & Sync (`scripts/sync-plugin.mjs`)

`sync-plugin.mjs` validates required files and copies only runtime artifacts (`plugin.json`, `README.md`, `assets/`, `skills/`, `sidecars/explorer_pane/{sidecar.json,package.json,main.mjs,lib,web}`) to:

1. `portable-extension/vs-file-explorer/` (self-contained portable package for another Windows PC via `install.bat` or `install.ps1`).
2. `%USERPROFILE%\.gemini\config\plugins\vs-file-explorer\` (active local Antigravity plugin directory).
