$ErrorActionPreference = 'Stop'

$tvUrl = 'https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv'
$edgeCandidates = @(
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
)
$edgePath = $edgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1

if (-not $edgePath) {
    throw 'Microsoft Edge를 찾지 못했습니다. Edge 설치를 확인한 뒤 다시 실행해 주세요.'
}

$startupDirectory = [Environment]::GetFolderPath('Startup')
if (-not $startupDirectory -or -not (Test-Path -LiteralPath $startupDirectory -PathType Container)) {
    throw '현재 Windows 사용자의 시작프로그램 폴더를 찾지 못했습니다.'
}

$shortcutPath = Join-Path $startupDirectory 'BRING TV 운영보드.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $edgePath
$shortcut.Arguments = "--kiosk `"$tvUrl`" --edge-kiosk-type=fullscreen --no-first-run"
$shortcut.WorkingDirectory = Split-Path -Parent $edgePath
$shortcut.Description = 'BRING 회사 운영보드 웹 TV'
$shortcut.Save()

Write-Host 'BRING TV 자동 실행 설정이 완료되었습니다.'
Write-Host "다음 Windows 로그인부터 자동으로 열립니다: $tvUrl"
