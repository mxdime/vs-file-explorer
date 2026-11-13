param(
    [string]$TargetDir = (Join-Path $env:USERPROFILE ".gemini\config\plugins\vs-file-explorer")
)

$ErrorActionPreference = "Stop"

$SourceDir = Join-Path $PSScriptRoot "vs-file-explorer"
$ManifestPath = Join-Path $SourceDir "plugin.json"
$SidecarManifestPath = Join-Path $SourceDir "sidecars\explorer_pane\sidecar.json"
$LegacyDir = Join-Path $env:USERPROFILE ".gemini\config\plugins\project-explorer"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  VS File Explorer (Antigravity) - Instalador Portatil" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Pacote nao encontrado: '$ManifestPath' nao existe. Verifique se a pasta 'vs-file-explorer' esta ao lado de install.ps1."
}

if (-not (Test-Path -LiteralPath $SidecarManifestPath)) {
    throw "Manifesto do sidecar nao encontrado em '$SidecarManifestPath'."
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Warning "Node.js nao foi encontrado no PATH. O sidecar do VS File Explorer requer Node.js 20+ para executar no Antigravity."
} else {
    $nodeVersion = & node -v
    Write-Host "Node.js detectado: $nodeVersion" -ForegroundColor Gray
}

$PluginsRoot = Split-Path -Parent $TargetDir
if (-not (Test-Path -LiteralPath $PluginsRoot)) {
    New-Item -ItemType Directory -Path $PluginsRoot -Force | Out-Null
}

if ((Test-Path -LiteralPath $LegacyDir) -and ($LegacyDir -ne $TargetDir)) {
    Write-Host "Removendo instalacao legada em: $LegacyDir" -ForegroundColor Yellow
    try {
        Remove-Item -LiteralPath $LegacyDir -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Warning "Nao foi possivel remover totalmente a pasta legada '$LegacyDir' (em uso pelo Antigravity)."
    }
}

if (Test-Path -LiteralPath $TargetDir) {
    Write-Host "Atualizando instalacao anterior em: $TargetDir" -ForegroundColor Yellow
    try {
        Remove-Item -LiteralPath $TargetDir -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Warning "Alguns diretorios estavam em uso pelo Antigravity; sobrescrevendo arquivos no local."
    }
}

Write-Host "Copiando arquivos do plugin para: $TargetDir" -ForegroundColor White
if (-not (Test-Path -LiteralPath $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}
Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $TargetDir -Recurse -Force
}

Write-Host ""
Write-Host "Instalacao concluida com sucesso!" -ForegroundColor Green
Write-Host "Destino: $TargetDir" -ForegroundColor Gray
Write-Host ""
Write-Host "Proximos passos no Antigravity App:" -ForegroundColor Cyan
Write-Host "  1. Reinicie ou recarregue o Antigravity App (se ja estiver aberto)."
Write-Host "  2. Abra 'Toggle Side Panel -> Extensions -> VS File Explorer'."
Write-Host "  3. Ou peca no chat para abrir o VS File Explorer."
Write-Host ""
