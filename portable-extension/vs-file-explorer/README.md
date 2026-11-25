# VS File Explorer (Antigravity UI Extension)

🌐 **Idioma / Language:** **Português (BR)** · [English](README.en.md)

![Versão](https://img.shields.io/badge/version-1.2.0-007ACC)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933)
![Antigravity](https://img.shields.io/badge/Antigravity-2.0%20AUX__PANE-22A7F0)
![Licença](https://img.shields.io/badge/license-MIT-blue)

Extensão de interface (**UI Plugin / Sidecar Aux Pane**, id `vs-file-explorer`) para o **Antigravity App 2.0** no Windows, trazendo um explorador de projetos completo estilo VS Code diretamente no painel auxiliar lateral (**Toggle Side Panel → Extensions → VS File Explorer**).

Repositório GitHub: <https://github.com/mxdime/vs-file-explorer>

---

## ✨ Funcionalidades

- **Auto-detecção do Projeto da Conversa + Seletor de Pasta:** acompanha automaticamente o workspace da conversa ativa via `window.sidecar.getWorkspaceUris()` e `onWorkspaceChange()` (com fallback no servidor via `agentapi conversation_metadata`), além de permitir trocar para projetos recentes, favoritos ou qualquer diretório local.
- **3 Abas de Workbench:**
  - **Explorer:** árvore hierárquica com guias de indentação, lazy-loading, filtro rápido, ocultação configurável de ignorados (`.git`, `node_modules`, `.temp`) e badges Git (`M`, `A`, `D`, `U`).
  - **Search:** busca textual rápida (`Grep`) nos arquivos do projeto com preview da linha encontrada.
  - **Git:** lista de arquivos modificados/não rastreados no repositório ativo.
- **Copiar `@mention` para o Chat (1 clique):** botão rápido `@` diretamente em cada linha da árvore, opção **Copiar @mention para o chat** no menu de contexto e botão **Copiar @** no Preview, com fallback em 3 níveis (incluindo escrita nativa UTF-8 via `POST /api/clipboard`).
- **CRUD Completo:** criar arquivo, criar pasta, renomear, duplicar, excluir (com confirmação e proteção contra exclusão da raiz ou `.git`) e copiar caminho relativo ou absoluto.
- **Preview Embutido + Auto-Collapse com Hover:** ao abrir um arquivo no Preview, a árvore minimiza automaticamente para dar espaço máximo ao conteúdo; passar o mouse sobre a barra da árvore reabre o explorador suavemente (com botão *Pin* para manter fixo).
- **Configurações & Apps Externos (`Open With...`):** botão compacto de engrenagem no cabeçalho para associar extensões (ex.: `.md` → **Notepad++**) e abrir arquivos em aplicativos externos (**VS Code**, **Windows Explorer**, **PowerShell** e `fileView` nativo do Antigravity).

---

## 📋 Pré-requisitos

- **Antigravity App 2.0+**
- **Node.js 20+** disponível no `PATH` (`node -v`) — **zero dependências `npm` externas**.

---

## 🚀 Instalação e Sincronização

### No ambiente de desenvolvimento (deste repositório)

```powershell
# Sincroniza portable-extension/vs-file-explorer/ e instala em %USERPROFILE%\.gemini\config\plugins\vs-file-explorer\
node scripts/sync-plugin.mjs

# (Opcional) Gera apenas o pacote portátil sem alterar o diretório global de plugins
node scripts/sync-plugin.mjs --portable-only
```

*(Caso execute a partir da raiz do monorepo `Tools-Utilities`, utilize `node tools/vs-file-explorer/scripts/sync-plugin.mjs`.)*

### Em outro PC Windows (Pacote Portátil)

1. Copie a pasta [`portable-extension/`](portable-extension/) para o computador de destino.
2. Dê um duplo clique em **`install.bat`** (ou execute `install.ps1`).
3. Reinicie o **Antigravity App** e abra **Toggle Side Panel → Extensions → VS File Explorer**.

Instruções detalhadas em [`portable-extension/COMO-INSTALAR.md`](portable-extension/COMO-INSTALAR.md).

---

## 📁 Estrutura do Pacote

```text
vs-file-explorer/
├── plugin.json                         # Manifesto do plugin Antigravity (v1.2.0)
├── README.md                           # Documentação principal
├── CHANGELOG.md                        # Histórico de versões (Keep a Changelog)
├── LICENSE                             # Licença MIT
├── docs/
│   └── ARCHITECTURE.md                 # Arquitetura, endpoints HTTP e modelo de segurança
├── assets/
│   └── logo.svg                        # Ícone vetorial colorido do plugin
├── scripts/
│   └── sync-plugin.mjs                 # Sincroniza pacote portátil e instala localmente
├── skills/vs-file-explorer/SKILL.md    # Skill companheira (pill sidecar://vs-file-explorer/explorer_pane/)
├── sidecars/explorer_pane/
│   ├── sidecar.json                    # Manifesto do sidecar (AUX_PANE)
│   ├── package.json                    # {"type": "module"} (zero dependências externas)
│   ├── main.mjs                        # Servidor HTTP / SidecarApp
│   ├── lib/                            # workspace-guard, fs-crud, external-apps, search-git
│   └── web/                            # index.html, styles.css, app.js
├── portable-extension/                 # Pacote autocontido para instalação em outro PC Windows
│   ├── install.bat
│   ├── install.ps1
│   ├── COMO-INSTALAR.md
│   └── vs-file-explorer/               # Artefatos limpos de runtime
└── test/
    └── project-explorer.test.mjs       # Suíte de testes automatizados (node --test)
```

---

## 🧪 Testes

```powershell
node --test test/*.test.mjs
```

*(Ou na raiz do monorepo `Tools-Utilities`: `node --test tools/vs-file-explorer/test/*.test.mjs`.)*

---

## 📚 Documentação Adicional

- [Arquitetura e Endpoints HTTP (PT-BR)](docs/ARCHITECTURE.md) · [English](docs/ARCHITECTURE.en.md)
- [Guia de Instalação Portátil (PT-BR)](portable-extension/COMO-INSTALAR.md) · [English](portable-extension/HOW-TO-INSTALL.md)
- [Histórico de Alterações (PT-BR)](CHANGELOG.md) · [English](CHANGELOG.en.md)
- [Licença MIT](LICENSE)
