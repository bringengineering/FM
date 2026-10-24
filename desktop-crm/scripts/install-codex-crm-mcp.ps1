[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$Remove,
    [string]$CodexCommand = "codex",
    [string]$UserDataPath = (Join-Path $env:APPDATA "bring-crm-desktop")
)

$ErrorActionPreference = "Stop"
$serverPath = Join-Path $PSScriptRoot "..\src\crm-mcp-server.js"
$serverPath = [System.IO.Path]::GetFullPath($serverPath)
$userDataPath = [System.IO.Path]::GetFullPath($UserDataPath)

if (-not (Get-Command $CodexCommand -ErrorAction SilentlyContinue)) {
    throw "Codex CLI를 찾을 수 없습니다. Codex가 설치된 터미널에서 다시 실행해 주세요."
}

if ($Remove) {
    if ($PSCmdlet.ShouldProcess("Codex MCP bring_crm", "remove")) {
        & $CodexCommand mcp remove bring_crm
        if ($LASTEXITCODE -ne 0) { throw "Codex MCP 항목 제거에 실패했습니다 (exit $LASTEXITCODE)." }
    }
    return
}

if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "MCP 서버 파일을 찾을 수 없습니다: $serverPath"
}

$existingExit = 0
try {
    $null = & $CodexCommand mcp get bring_crm 2>$null
    $existingExit = $LASTEXITCODE
} catch {
    $existingExit = 1
}
if ($existingExit -eq 0) {
    Write-Output "bring_crm MCP 항목이 이미 있습니다. 덮어쓰지 않았습니다. 먼저 -Remove로 제거한 뒤 다시 설치해 주세요."
    return
}

if ($PSCmdlet.ShouldProcess("Codex MCP bring_crm", "register local BRING CRM bridge")) {
    & $CodexCommand mcp add bring_crm --env "BRING_CRM_USER_DATA=$userDataPath" -- node $serverPath
    if ($LASTEXITCODE -ne 0) { throw "Codex MCP 항목 등록에 실패했습니다 (exit $LASTEXITCODE)." }
    Write-Output "등록 완료. BRING CRM을 실행한 상태에서 Codex를 완전히 재시작해 도구를 불러오세요."
}
