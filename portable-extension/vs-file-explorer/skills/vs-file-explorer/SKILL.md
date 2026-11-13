---
name: vs-file-explorer
description: Abre e orienta o uso do painel lateral VS File Explorer (extensão de UI estilo VS Code para navegar na árvore do projeto, buscar em arquivos, ver status Git, pré-visualizar/editar arquivos, copiar @mention para o chat e abrir no Notepad++ ou VS Code). Use quando o usuário pedir para explorar arquivos, ver a árvore do projeto ou abrir o painel VS File Explorer.
---

# VS File Explorer

O **VS File Explorer** (plugin `vs-file-explorer`) é uma UI Extension instalada no painel auxiliar lateral do Antigravity App (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`).

## Como abrir o painel pelo chat

Quando o usuário pedir para abrir o explorador de arquivos, navegar pelas pastas do projeto, buscar texto nos arquivos ou visualizar mudanças Git no painel visual, ofereça o pill clicável abaixo (respeitando as regras de `ui-plugin-navigation` — no máximo um pill por painel por resposta):

[VS File Explorer](sidecar://vs-file-explorer/explorer_pane/)

O usuário também pode abrir manualmente pelo menu **Toggle Side Panel → Extensions → VS File Explorer**.

## Recursos disponíveis no painel

- **Auto-detecção de Workspace + Seletor de Pasta:** detecta automaticamente a pasta do projeto da conversa ativa (`window.sidecar.getWorkspaceUris()` / `onWorkspaceChange()` + fallback via metadados da conversa) e permite alternar entre pastas recentes, favoritas ou navegar pelo disco local.
- **Abas Explorer, Search e Git:** árvore hierárquica com ícones e badges Git (`M`, `A`, `D`, `U`), busca textual (`Grep`) dentro dos arquivos com salto para a linha, e lista de alterações Git.
- **Copiar @mention para o chat:** botão rápido `@` diretamente em cada item da árvore, opção **Copiar @mention para o chat** no menu de contexto e botão **Copiar @** na barra do Preview (com fallback nativo de área de transferência no servidor).
- **CRUD Completo:** criar arquivo, criar pasta, renomear, duplicar, excluir (com confirmação) e copiar caminho relativo ou absoluto.
- **Preview Embutido + Auto-Collapse com Hover:** ao clicar em um arquivo, a árvore minimiza automaticamente para maximizar o Preview e reabre suavemente ao passar o mouse (`hover`), com opção de fixar (*Pin*).
- **Configurações e Apps Externos:** botão **Configurações** (ícone de engrenagem) para gerenciar associações por extensão (ex.: `.md` → **Notepad++**) e aplicativos externos (**VS Code**, **Mostrar na Pasta**, aplicativo padrão do sistema).
