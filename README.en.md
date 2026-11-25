# VS File Explorer (Antigravity UI Extension)

🌐 **Language / Idioma:** **English** · [Português (BR)](README.md)

![Version](https://img.shields.io/badge/version-1.2.0-007ACC)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933)
![Antigravity](https://img.shields.io/badge/Antigravity-2.0%20AUX__PANE-22A7F0)
![License](https://img.shields.io/badge/license-MIT-blue)

A VS Code-style workspace file explorer UI extension (**UI Plugin / Sidecar Aux Pane**, id `vs-file-explorer`) for **Antigravity App 2.0** on Windows, available directly in the auxiliary side panel (**Toggle Side Panel → Extensions → VS File Explorer**).

Repository: <https://github.com/mxdime/vs-file-explorer>

---

## ✨ Features

- **Conversation Workspace Auto-Detection + Folder Picker:** automatically tracks the active conversation's workspace via `window.sidecar.getWorkspaceUris()` and `onWorkspaceChange()` (with server-side fallback via `agentapi conversation_metadata`), plus manual switching across recent projects, favorites, and any local directory.
- **3 Workbench Tabs:**
  - **Explorer:** hierarchical tree with indent guides, lazy-loading, quick filter, toggleable ignored folders (`.git`, `node_modules`, `.temp`), and Git status badges (`M`, `A`, `D`, `U`).
  - **Search:** fast in-workspace text search (`Grep`) with matching line previews.
  - **Git:** dedicated list of modified and untracked files in the active repository.
- **1-Click `@mention` Copy for Chat:** quick `@` button on each tree row, context menu action (**Copiar @mention para o chat**), and **Copiar @** button in Preview, backed by a 3-tier fallback (including native UTF-8 clipboard writing via `POST /api/clipboard`).
- **Full File & Folder CRUD:** create files, create folders, rename, duplicate, delete (with confirmation and root/ `.git` protection), and copy relative/absolute paths.
- **Embedded Preview + Hover Auto-Collapse:** opening a file automatically collapses the tree rail to maximize reading space; hovering over the slim rail smoothly expands the tree again (with a *Pin* toggle to keep it open).
- **Settings & External Apps (`Open With...`):** compact gear-icon button in the header opens **Configurações** to customize extension associations (e.g., `.md` → **Notepad++**) and launch external apps (**VS Code**, **Windows Explorer**, **PowerShell**, and Antigravity's native `fileView`).

---

## 📋 Prerequisites

- **Antigravity App 2.0+** (Windows)
- **Node.js 20+** available on `PATH` (`node -v`) — **zero external `npm` dependencies**.

---

## 🚀 Installation

### Option 1 — Quick Install on Windows (Portable Package)

1. Download the repository (or the `portable-extension/` folder from [Releases](https://github.com/mxdime/vs-file-explorer/releases)).
2. Double-click **`portable-extension/install.bat`** (or run `portable-extension/install.ps1`).
3. Restart **Antigravity App** and open **Toggle Side Panel → Extensions → VS File Explorer**.

Full instructions in [`portable-extension/HOW-TO-INSTALL.md`](portable-extension/HOW-TO-INSTALL.md).

### Option 2 — Sync from Source (Development)

```powershell
git clone https://github.com/mxdime/vs-file-explorer.git
cd vs-file-explorer

# Syncs portable-extension/vs-file-explorer/ and installs into %USERPROFILE%\.gemini\config\plugins\vs-file-explorer\
node scripts/sync-plugin.mjs

# (Optional) Build only the portable package without touching local Antigravity plugins
node scripts/sync-plugin.mjs --portable-only
```

---

## 📁 Package Structure

```text
vs-file-explorer/
├── plugin.json                         # Antigravity plugin manifest (v1.2.0)
├── README.md                           # Portuguese (BR) documentation
├── README.en.md                        # English documentation
├── CHANGELOG.md                        # Version history (PT-BR)
├── CHANGELOG.en.md                     # Version history (EN)
├── LICENSE                             # MIT License
├── docs/
│   ├── ARCHITECTURE.md                 # Architecture & HTTP API (PT-BR)
│   └── ARCHITECTURE.en.md              # Architecture & HTTP API (EN)
├── assets/
│   └── logo.svg                        # Colored vector plugin icon
├── scripts/
│   └── sync-plugin.mjs                 # Portable packager & local installer
├── skills/vs-file-explorer/SKILL.md    # Companion skill (sidecar://vs-file-explorer/explorer_pane/)
├── sidecars/explorer_pane/
│   ├── sidecar.json                    # Sidecar manifest (AUX_PANE)
│   ├── package.json                    # {"type": "module"} (zero external deps)
│   ├── main.mjs                        # HTTP server / SidecarApp
│   ├── lib/                            # workspace-guard, fs-crud, external-apps, search-git
│   └── web/                            # index.html, styles.css, app.js
├── portable-extension/                 # Self-contained installer for any Windows PC
│   ├── install.bat
│   ├── install.ps1
│   ├── COMO-INSTALAR.md                # Portable guide (PT-BR)
│   ├── HOW-TO-INSTALL.md               # Portable guide (EN)
│   └── vs-file-explorer/               # Clean runtime-only bundle
└── test/
    └── project-explorer.test.mjs       # Automated test suite (node --test)
```

---

## 🧪 Tests

```powershell
node --test test/*.test.mjs
```

---

## 📚 Additional Documentation

- [Architecture & HTTP Endpoints (EN)](docs/ARCHITECTURE.en.md) · [PT-BR](docs/ARCHITECTURE.md)
- [Portable Installation Guide (EN)](portable-extension/HOW-TO-INSTALL.md) · [PT-BR](portable-extension/COMO-INSTALAR.md)
- [Changelog (EN)](CHANGELOG.en.md) · [PT-BR](CHANGELOG.md)
- [MIT License](LICENSE)
