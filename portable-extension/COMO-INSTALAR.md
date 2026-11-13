# Como Instalar o VS File Explorer em Outro PC (Windows)

🌐 **Idioma / Language:** **Português (BR)** · [English](HOW-TO-INSTALL.md)

Esta pasta (`portable-extension`) é totalmente autocontida e não precisa de `npm install`, internet ou build para ser instalada em outro computador Windows com o **Antigravity App**.

---

## Pré-requisitos no PC de destino

1. **Antigravity App 2.0+** instalado.
2. **Node.js 20 ou superior** instalado e disponível no `PATH` do Windows (`node -v`).

---

## Método 1 — Instalação em 1 Clique (Recomendado)

1. Copie a pasta `portable-extension` inteira para o outro computador (via pendrive, Google Drive, OneDrive, ZIP, etc.).
2. Extraia (se estiver zipada) e abra a pasta `portable-extension`.
3. Dê um **duplo clique** em **`install.bat`**.
4. O instalador copiará automaticamente o plugin limpo (`vs-file-explorer`) para:
   `%USERPROFILE%\.gemini\config\plugins\vs-file-explorer\`
   (e removerá eventual instalação legada `project-explorer`).
5. Reinicie o **Antigravity App** (caso esteja aberto).

---

## Método 2 — Via PowerShell

Abra o PowerShell dentro da pasta `portable-extension` e execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

---

## Método 3 — Instalação Manual

Copie a subpasta `vs-file-explorer\` (que está dentro de `portable-extension\`) para:

```text
%USERPROFILE%\.gemini\config\plugins\vs-file-explorer\
```

Confirme que o arquivo `%USERPROFILE%\.gemini\config\plugins\vs-file-explorer\plugin.json` existe nesse caminho.

---

## Como Abrir e Usar no Antigravity App

1. No painel do Antigravity App, clique em **Toggle Side Panel → Extensions → VS File Explorer**.
2. Ou peça ao agente no chat: *"Abra o VS File Explorer"* (o agente exibirá o pill clicável `[VS File Explorer](sidecar://vs-file-explorer/explorer_pane/)`).
3. **Dicas de uso:**
   - **Auto-detecção do projeto:** o painel acompanha automaticamente a pasta do projeto da conversa ativa; use o seletor no topo para alternar pastas manualmente.
   - **Preview + Hover na Árvore:** clicar em um arquivo abre o Preview e minimiza a árvore automaticamente; passe o mouse sobre a barra lateral da árvore para reabrir suavemente (use o botão *Pin* se quiser mantê-la fixa).
   - **Copiar @mention para o chat:** clique no ícone `@` rápido ao lado de qualquer arquivo/pasta na árvore, no botão **Copiar @** no Preview ou no menu de contexto (**Copiar @mention para o chat**).
   - **Configurações e Notepad++ / Apps Externos:** arquivos `.md` são associados automaticamente ao **Notepad++** quando instalado no caminho padrão do Windows (`C:\Program Files\Notepad++\notepad++.exe`). Clique no ícone de engrenagem (**Configurações**) no topo do painel para personalizar associações por extensão e aplicativos externos.
