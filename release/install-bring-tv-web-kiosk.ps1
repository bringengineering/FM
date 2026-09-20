$ErrorActionPreference = 'Stop'

$tvUrl = 'https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv'
$errorLog = if ([Environment]::GetFolderPath('Desktop')) {
    Join-Path ([Environment]::GetFolderPath('Desktop')) 'BRING-TV-설치-오류.txt'
} else {
    Join-Path $env:TEMP 'BRING-TV-설치-오류.txt'
}

try {
    $browserCandidates = @()
    if ($env:ProgramFiles) {
        $browserCandidates += Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
        $browserCandidates += Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
    }
    if (${env:ProgramFiles(x86)}) {
        $browserCandidates += Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
        $browserCandidates += Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'
    }
    if ($env:LOCALAPPDATA) {
        $browserCandidates += Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'
        $browserCandidates += Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'
    }
    $browserPath = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if (-not $browserPath) {
        throw 'Microsoft Edge 또는 Google Chrome을 찾지 못했습니다.'
    }

    if (-not $env:LOCALAPPDATA) {
        throw '현재 Windows 사용자의 로컬 저장소를 찾지 못했습니다.'
    }
    $profileDirectory = Join-Path $env:LOCALAPPDATA 'BRING-TV\EdgeProfile'
    if (-not (Test-Path -LiteralPath $profileDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
    }

    $shell = New-Object -ComObject WScript.Shell
    $startupDirectory = [Environment]::GetFolderPath('Startup')
    if (-not $startupDirectory) {
        $startupDirectory = $shell.SpecialFolders.Item('Startup')
    }
    if (-not $startupDirectory) {
        $startupDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    }
    if (-not (Test-Path -LiteralPath $startupDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null
    }

    $shortcutPath = Join-Path $startupDirectory 'BRING TV 운영보드.lnk'
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $browserPath
    $shortcut.Arguments = "--kiosk `"$tvUrl`" --edge-kiosk-type=fullscreen --user-data-dir=`"$profileDirectory`" --no-first-run"
    $shortcut.WorkingDirectory = Split-Path -Parent $browserPath
    $shortcut.Description = 'BRING 회사 운영보드 웹 TV'
    $shortcut.Save()

    if (Test-Path -LiteralPath $errorLog -PathType Leaf) {
        Remove-Item -LiteralPath $errorLog -Force
    }
    Start-Process -FilePath $browserPath -ArgumentList $shortcut.Arguments
    Write-Host 'BRING TV 자동 실행 설정이 완료되었습니다.'
    Write-Host "지금 운영보드를 열었으며, 다음 Windows 로그인부터 자동으로 열립니다: $tvUrl"
} catch {
    $details = @(
        'BRING TV 설치 실패'
        "시간: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        "오류: $($_.Exception.Message)"
        "Windows: $([Environment]::OSVersion.VersionString)"
        "사용자: $env:USERNAME"
    ) -join [Environment]::NewLine
    Set-Content -LiteralPath $errorLog -Value $details -Encoding UTF8
    Write-Host $details -ForegroundColor Red
    Write-Host "오류 기록: $errorLog" -ForegroundColor Yellow
    exit 1
}
