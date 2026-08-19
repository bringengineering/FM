$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$basePath = Split-Path -Parent $MyInvocation.MyCommand.Path

$secureToken = Read-Host "New Telegram Bot Token" -AsSecureString
$approvalUrl = Read-Host "ChatGPT approval HTTPS URL"
if (-not $approvalUrl.StartsWith("https://")) { throw "Only HTTPS URLs are allowed." }

$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $botApi = "https://api.telegram.org/bot$token"
    $identity = Invoke-RestMethod -Method Get -Uri "$botApi/getMe"
    if (-not $identity.ok) { throw "Check the Bot Token." }
    $botUsername = $identity.result.username
    Write-Host "Open @$botUsername and send /start now. Waiting up to 60 seconds..."
    $chatIds = @()
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        $updates = Invoke-RestMethod -Method Get -Uri "$botApi/getUpdates"
        $chatIds = @($updates.result | ForEach-Object { $_.message.chat } | Where-Object { $_ -and $_.type -eq "private" } | Select-Object -ExpandProperty id -Unique)
        if ($chatIds.Count -gt 0) { break }
        Start-Sleep -Seconds 2
    }
    if ($chatIds.Count -eq 0) { throw "No private message detected. Confirm the bot username and send /start again." }
    Write-Host "Detected private Chat IDs:"
    for ($i = 0; $i -lt $chatIds.Count; $i++) { Write-Host "[$($i + 1)] $($chatIds[$i])" }
    $choice = [int](Read-Host "Select a number")
    if ($choice -lt 1 -or $choice -gt $chatIds.Count) { throw "Select a valid number." }
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
