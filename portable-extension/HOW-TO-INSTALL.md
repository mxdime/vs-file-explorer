# How to Install VS File Explorer on Another PC (Windows)

🌐 **Language / Idioma:** **English** · [Português (BR)](COMO-INSTALAR.md)

This folder (`portable-extension`) is completely self-contained and requires no `npm install`, internet connection, or build step to install on another Windows machine with **Antigravity App**.

---

## Prerequisites on the Target PC

1. **Antigravity App 2.0+** installed.
2. **Node.js 20 or higher** installed and available on Windows `PATH` (`node -v`).

---

## Method 1 — 1-Click Install (Recommended)

1. Copy the entire `portable-extension` folder to the target PC (USB drive, cloud drive, ZIP archive, etc.).
2. Extract it (if zipped) and open `portable-extension`.
3. Double-click **`install.bat`**.
4. The installer automatically copies the clean plugin (`vs-file-explorer`) into:
   `%USERPROFILE%\.gemini\config\plugins\vs-file-explorer\`
   (and removes any legacy `project-explorer` folder).
5. Restart **Antigravity App** (if running).

---

## Method 2 — Via PowerShell

Open PowerShell inside `portable-extension` and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

---

## Method 3 — Manual Installation

Copy the `vs-file-explorer\` subfolder (inside `portable-extension\`) to:

```text
%USERPROFILE%\.gemini\config\plugins\vs-file-explorer\
```

Verify that `%USERPROFILE%\.gemini\config\plugins\vs-file-explorer\plugin.json` exists.

---

## How to Open and Use in Antigravity App

1. In Antigravity App, open **Toggle Side Panel → Extensions → VS File Explorer**.
2. Or ask the agent in chat: *"Open VS File Explorer"* (the agent will render the clickable pill `[VS File Explorer](sidecar://vs-file-explorer/explorer_pane/)`).
3. **Quick tips:**
   - **Auto-detection:** tracks the active conversation's workspace automatically; use the top dropdown to switch folders manually.
   - **Preview + Hover Tree:** clicking a file opens Preview and minimizes the tree rail; hover over the slim rail to expand it smoothly (or click *Pin* to keep it fixed).
   - **Copy `@mention` for chat:** click the quick `@` icon next to any row, click **Copiar @** in Preview, or use the context menu.
   - **Settings & Notepad++ / External Apps:** `.md` files automatically associate with **Notepad++** when installed at the default Windows path (`C:\Program Files\Notepad++\notepad++.exe`). Click the gear icon in the header to customize extension associations and external applications.
