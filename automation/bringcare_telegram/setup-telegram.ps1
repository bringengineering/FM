$ErrorActionPreference = "Stop"
$basePath = Split-Path -Parent $MyInvocation.MyCommand.Path

$secureToken = Read-Host "새 Telegram Bot Token" -AsSecureString
$approvalUrl = Read-Host "ChatGPT 승인 대화 HTTPS URL"
if (-not $approvalUrl.StartsWith("https://")) { throw "HTTPS URL만 사용할 수 있습니다." }

$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $botApi = "https://api.telegram.org/bot$token"
    $identity = Invoke-RestMethod -Method Get -Uri "$botApi/getMe"
    if (-not $identity.ok) { throw "Bot Token을 확인해 주세요." }
    $updates = Invoke-RestMethod -Method Get -Uri "$botApi/getUpdates"
    $chatIds = @($updates.result | ForEach-Object { $_.message.chat } | Where-Object { $_.type -eq "private" } | Select-Object -ExpandProperty id -Unique)
    if ($chatIds.Count -eq 0) { throw "봇 대화창에서 /start를 보낸 뒤 다시 실행해 주세요." }
    Write-Host "감지된 개인 Chat ID:"
    for ($i = 0; $i -lt $chatIds.Count; $i++) { Write-Host "[$($i + 1)] $($chatIds[$i])" }
    $choice = [int](Read-Host "사용할 번호")
    if ($choice -lt 1 -or $choice -gt $chatIds.Count) { throw "올바른 번호를 선택해 주세요." }
    $chatId = [string]$chatIds[$choice - 1]

    $clearBytes = [Text.Encoding]::UTF8.GetBytes($token)
    $protected = [Security.Cryptography.ProtectedData]::Protect($clearBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes((Join-Path $basePath "token.dpapi"), $protected)
    $config = @{ chat_id = $chatId; approval_url = $approvalUrl } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $basePath "local-config.json"), $config, [Text.UTF8Encoding]::new($false))
}
finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    Remove-Variable token -ErrorAction SilentlyContinue
}

Push-Location (Resolve-Path (Join-Path $basePath "../.."))
try { python -m automation.bringcare_telegram.cli test }
finally { Pop-Location }
