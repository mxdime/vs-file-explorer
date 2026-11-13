# Changelog

🌐 **Idioma / Language:** **Português (BR)** · [English](CHANGELOG.en.md)

Todas as alterações notáveis da extensão **VS File Explorer** (`vs-file-explorer`) serão documentadas neste arquivo.

O formato segue o padrão [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este pacote adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [1.0.0] - 2026-11-13

### Added
- **Plugin e Sidecar UI (`AUX_PANE`)** para Antigravity App 2.0 (`vs-file-explorer/explorer_pane`) com ícone vetorial colorido ([`assets/logo.svg`](assets/logo.svg)).
- **Auto-detecção de workspace** via `window.sidecar.getWorkspaceUris()` e `onWorkspaceChange()`, com fallback automático no servidor via `agentapi conversation_metadata` usando `ANTIGRAVITY_CONVERSATION_ID`, além de seletor manual de pastas, recentes e favoritos.
- **Workbench com 3 abas:**
  - **Explorer:** árvore hierárquica com guias de indentação, lazy-loading, filtro rápido, ocultação configurável de pastas ignoradas e badges de status Git (`M`, `A`, `D`, `U`).
  - **Search:** busca textual (`Grep`) no workspace com prévia da linha encontrada.
  - **Git:** lista dedicada de alterações no repositório ativo.
- **CRUD completo de arquivos e pastas:** criar arquivo, criar pasta, renomear, duplicar, excluir com confirmação e proteção contra escrita/exclusão na raiz ou em `.git`.
- **Preview embutido com Auto-Collapse e Hover:** minimiza a árvore automaticamente ao abrir um arquivo e reabre suavemente ao passar o mouse (com botão *Pin*).
- **Cópia de `@mention` em 1 clique:** botão rápido `@` por linha na árvore, opção no menu de contexto e botão **Copiar @** no Preview, com fallback em 3 camadas (`navigator.clipboard` → `execCommand('copy')` → `POST /api/clipboard` via PowerShell `Set-Clipboard` por `stdin`).
- **Configurações e Lançador de Apps Externos:** botão compacto com ícone de engrenagem no cabeçalho abrindo o modal **Configurações** para associar extensões (padrão `.md` → Notepad++) e acionar aplicativos externos (VS Code, Explorer, PowerShell) sem shell interpolation.
- **Empacotamento portátil & Skill companheira:** [`scripts/sync-plugin.mjs`](scripts/sync-plugin.mjs), [`portable-extension/`](portable-extension/) (`install.bat`, `install.ps1`, `COMO-INSTALAR.md`) e [`skills/vs-file-explorer/SKILL.md`](skills/vs-file-explorer/SKILL.md).
- **Suíte de testes automatizados:** 18 testes em `test/project-explorer.test.mjs` executados com `node --test`.

### Security & Stability
- Bloqueio estrito de *path traversal* e validação de caminhos dentro do workspace ativo em `lib/workspace-guard.mjs`.
- Validação de token `X-Sidecar-Token` em todas as rotas `POST` do sidecar.
- Configuração não interativa `"agent_permissions": { "allows_user_interactions": false }` no [`sidecar.json`](sidecars/explorer_pane/sidecar.json).
