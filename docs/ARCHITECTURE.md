# Arquitetura e Referência Técnica — VS File Explorer

🌐 **Idioma / Language:** **Português (BR)** · [English](ARCHITECTURE.en.md)

## 1. Visão Geral

O **VS File Explorer** é um UI Plugin do **Antigravity App 2.0** composto por:

1. **Manifesto do Plugin (`plugin.json`)**: registra o plugin `vs-file-explorer`, versão `1.0.1`, ícone `assets/logo.svg` e prompts sugeridos.
2. **Sidecar Aux Pane (`sidecars/explorer_pane/`)**:
   - `sidecar.json`: configura entrypoint `SIDECAR_UI_ENTRYPOINT_AUX_PANE` e `"agent_permissions": { "allows_user_interactions": false }`.
   - `main.mjs`: servidor HTTP sobre `sidecar_sdk` (`SidecarApp`) que serve o frontend estático e expõe a API REST local.
   - `lib/workspace-guard.mjs`: normalização de URIs `file://`, detecção de metadados de conversa (`agentapi`), persistência de estado (`config.json`: workspace ativo, recentes, favoritos) e proteção contra *path traversal*.
   - `lib/fs-crud.mjs`: listagem ordenada de diretórios, leitura de preview (texto, Markdown, imagens, binários) e operações CRUD.
   - `lib/external-apps.mjs`: detecção de aplicativos padrão no Windows (Notepad++, VS Code, Explorer, PowerShell), persistência de associações por extensão e execução segura com `spawn(..., { detached: true })` sem `shell`.
   - `lib/search-git.mjs`: busca textual (`searchInFiles`) ignorando `.git`/`node_modules`/binários, descoberta multi-repositório (`discoverGitRepos` e `resolveGitRepoRoot`), status Git v2 (`git status --porcelain=v2 --branch -uall` com fallback v1, `ahead`/`behind`, `lastCommit`, `remotes`, `stashCount`), diff unificado (`getGitDiff` com truncamento >150KB/1500 linhas), fila serializada por repositório (`enqueueGitOp`) e operações de stage/unstage/discard/commit, branches, stash e remotes (`fetch`/`pull`/`push`) isoladas por parâmetro opcional `repo`.
   - `web/`: interface frontend clássica (`index.html`, `styles.css`, `app.js` sem ES modules para compatibilidade com carregamento no webview/sandbox), incluindo Aba Git v2.1 (seletor multi-repo e Commit Box sob demanda), modal Gerenciador de Branches e Preview em modo Diff.

---

## 2. Endpoints HTTP do Sidecar (`main.mjs`)

| Método | Rota | Autenticação (`X-Sidecar-Token`) | Finalidade |
|---|---|---|---|
| `GET` | `/` | — | Página HTML principal (`web/index.html`) |
| `GET` | `/styles.css`, `/app.js`, `/logo.svg` | — | Assets estáticos do frontend |
| `GET` | `/api/workspaces` | — | Lista workspace ativo, workspaces da conversa (com fallback via `agentapi`), recentes e favoritos |
| `POST` | `/api/workspaces/select` | Obrigatório | Define o workspace ativo, alterna favoritos ou navega em diretórios locais |
| `GET` | `/api/tree` | — | Lista entradas de um diretório relativo dentro do workspace |
| `GET` | `/api/preview` | — | Retorna conteúdo para preview (texto, imagem base64 ou metadado binário) |
| `POST` | `/api/crud` | Obrigatório | Executa `createFile`, `createFolder`, `rename`, `duplicate`, `delete` ou `save` |
| `GET` | `/api/search` | — | Busca ocorrências de texto nos arquivos do workspace |
| `GET` | `/api/git/repos` | — | Descobre repositórios Git na raiz e subpastas do workspace (`discoverGitRepos`) com branch e contagem de alterações |
| `GET` | `/api/git-status` | — | Retorna status Git (`porcelain=v2 --branch`: branch, `ahead`/`behind`, staged/unstaged, `lastCommit`, `remotes`, `stashCount`) com suporte a `?repo=` e propagação para pastas pai |
| `GET` | `/api/git/diff` | — | Retorna diff unificado (`staged`, `unstaged`, arquivo `untracked` ou repo inteiro) com limite de 150 KB / 1.500 linhas |
| `GET` | `/api/git/branches` | — | Lista branches locais, remotas e a branch ativa |
| `GET` | `/api/git/stashes` | — | Lista entradas de stash do repositório |
| `POST` | `/api/git/stage` | Obrigatório | Adiciona arquivos especificados ou todos (`all: true`) ao stage |
| `POST` | `/api/git/unstage` | Obrigatório | Remove arquivos do stage (`git restore --staged`, com fallback para repo sem commits) |
| `POST` | `/api/git/discard` | Obrigatório | Descarta alterações (`git restore --worktree` para rastreados, remoção segura para `untracked`) |
| `POST` | `/api/git/commit` | Obrigatório | Executa `git commit` validando mensagem não vazia |
| `POST` | `/api/git/branch` | Obrigatório | Executa ações de branch: `list`, `create`, `switch`, `rename`, `delete` e `merge` |
| `POST` | `/api/git/stash` | Obrigatório | Executa ações de stash: `list`, `push`, `pop`, `apply` e `drop` |
| `POST` | `/api/git/remote` | Obrigatório | Executa operações em remotes: `list`, `fetch`, `pull` (`--ff-only`) e `push` |
| `GET` | `/api/external-apps` | — | Lista apps detectados, custom apps e associações por extensão |
| `POST` | `/api/external-apps/config` | Obrigatório | Salva associações por extensão e apps customizados |
| `POST` | `/api/open-external` | Obrigatório | Abre arquivo/pasta em aplicativo externo configurado |
| `POST` | `/api/clipboard` | Obrigatório | Grava texto UTF-8 na área de transferência do Windows via PowerShell `Set-Clipboard` (`stdin`) |

---

## 3. Segurança e Isolamento

- **Path Guard (`resolveInsideWorkspace`)**: converte caminhos e verifica com `path.relative` e `realpathSync` (quando existente) que o destino permanece estritamente dentro da raiz do workspace ativo; rejeita *path traversal* com HTTP `403` (`PATH_TRAVERSAL`).
- **Proteção contra exclusão destrutiva**: operações de exclusão/renomeação na raiz do workspace ou dentro de `.git` são bloqueadas.
- **Execução sem shell**: aplicativos externos, comandos `git` e `Set-Clipboard` usam `execFile` / `spawn` sem `shell: true`; a área de transferência recebe texto via `stdin` em UTF-8 para evitar injeção de comandos.
- **Guardrails de Git & Fila anti-lock**: nomes de branch/remote são validados por regex estrita (`^[a-zA-Z0-9._/-]+$`) e `git check-ref-format --branch`; exclusão da branch ativa é bloqueada; o parâmetro `repo` em rotas multi-repo passa por `resolveGitRepoRoot` (`resolveInsideWorkspace`) impedindo escape do workspace ativo; mutações Git executam em fila assíncrona serializada por repositório (`enqueueGitOp`) evitando conflitos de `.git/index.lock`.
- **Zero dependências externas em runtime**: utiliza apenas módulos nativos do Node.js 20+ e o módulo `sidecar_sdk` fornecido pelo host Antigravity.

---

## 4. Empacotamento e Sincronização (`scripts/sync-plugin.mjs`)

O script `sync-plugin.mjs` valida os arquivos obrigatórios e copia apenas os artefatos de runtime (`plugin.json`, `README.md`, `assets/`, `skills/`, `sidecars/explorer_pane/{sidecar.json,package.json,main.mjs,lib,web}`) para:

1. `portable-extension/vs-file-explorer/` (pacote portátil pronto para outro PC Windows via `install.bat` ou `install.ps1`).
2. `%USERPROFILE%\.gemini\config\plugins\vs-file-explorer\` (instalação local ativa no Antigravity).
