# Changelog

🌐 **Idioma / Language:** **Português (BR)** · [English](CHANGELOG.en.md)

Todas as alterações notáveis da extensão **VS File Explorer** (`vs-file-explorer`) serão documentadas neste arquivo.

O formato segue o padrão [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este pacote adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [1.1.0] - 2026-11-14

### Added
- **Árvore e Git em Tempo Real (`lib/fs-watcher.mjs` + `GET /api/fs/events`):**
  - Monitoramento nativo via `fs.watch(root, { recursive: true })` com fila de eventos por cursor `seq` e long-polling compatível com o `SidecarApp`.
  - Filtro imediato de diretórios ruidosos (`node_modules/`, `.venv/`, `venv/`, `__pycache__/`, `dist/`, `build/`, `.next/`, `.temp/`, `.git/objects/`, `.git/*.lock`) e detecção de estado Git (`.git/HEAD`, `.git/index`, `.git/refs/heads/`, `.git/refs/remotes/`).
  - Debounce (`250ms`), atualização silenciosa (`silent: true`) apenas das pastas expandidas afetadas, debounce no `refreshGitStatus` (`400ms`) e suspensão automática quando o painel está oculto (`document.hidden`).
- **Drag & Drop com `@mention`:**
  - Linhas da árvore (`.tree-row`) e da aba Git (`.git-row`) configuradas com `draggable="true"`, enviando `@caminho/relativo` em `text/plain` e `application/x-antigravity-mention` ao arrastar.
- **Testes:** Suíte expandida para 27 testes em 6 suítes (`fs-watcher & drag-mention` + `/api/fs/events`).

## [1.0.1] - 2026-11-13

### Added
- **Aba Git v2 (Source Control + Gestão de Branches + Multi-Remote):**
  - Status detalhado com `git status --porcelain=v2 --branch -uall` (`branch`, `oid`, `upstream`, `ahead`/`behind`, `detached`, `lastCommit`, `remotes`, `stashCount`) mantendo compatibilidade v1.
  - Fluxo completo de **Stage (`+`) / Unstage (`-`) / Discard (`↶` com confirmação) / Commit (`Ctrl+Enter` + chips `feat:`, `fix:`, `docs:`, `chore:`)** com fila serializada por repositório (`enqueueGitOp`) anti-`index.lock`.
  - **Gerenciador de Branches** (modal com filtro de locais/remotas, criar, trocar com atalho *"Guardar no Stash e Trocar"* em caso de worktree sujo, renomear, mesclar e excluir bloqueando branch ativa).
  - **Preview em modo Diff** (`GET /api/git/diff`) com destaque de hunks (`@@`, `+`, `-`), truncamento seguro (>150 KB / 1.500 linhas) e toggle rápido `Diff` ↔ `Arquivo`.
  - **Atalhos de produtividade IA:** botões **Copiar @** (mentions dos alterados) e **Copiar Diff** integrados ao fallback de área de transferência.
  - **Seções Stash & Remotes:** *Stash Atual*, *Pop*, *Apply*, *Drop*, e operações multi-remote (`Fetch`, `Pull --ff-only`, `Push`) com seletor explícito de remote (`origin` Forgejo / GitHub).
  - Cobertura de testes ampliada para **23 testes** passando em `test/project-explorer.test.mjs` (incluindo repositórios Git reais, remote bare e ambiente multi-repo em `.temp/`).
- **Aba Git v2.1 (Suporte Multi-Repo + Commit Box sob demanda):**
  - Descoberta automática de múltiplos repositórios Git (`discoverGitRepos` / `GET /api/git/repos`) na raiz e subpastas do workspace (submodules, sub-repos ou pastas pai como `_DEVS/`), exibindo seletor compacto (`#git-repo-switcher`) com branch e contagem de alterações por repo quando há mais de 1 repositório.
  - Todas as operações `/api/git*` aceitam o parâmetro `repo` validado via `resolveGitRepoRoot` (`resolveInsideWorkspace`) com bloqueio de *path traversal*, compondo caminhos relativos ao workspace para Preview/Diff e `@mention`.
  - **Commit Box sob demanda:** barra compacta por padrão (`Commit`, `Copiar @`, `Copiar Diff`); a caixa de mensagem e os chips (`feat:`, `fix:`, `docs:`, `chore:`) abrem somente ao clicar em **Commit** (com foco automático) e fecham em `Cancelar`, `Esc` ou após confirmar o commit.

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
