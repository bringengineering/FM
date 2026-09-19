$ErrorActionPreference = 'Stop'

$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory 'BRING TV 운영보드.lnk'

if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Host 'BRING TV 자동 실행 바로가기를 제거했습니다.'
} else {
    Write-Host '제거할 BRING TV 자동 실행 바로가기가 없습니다.'
}

