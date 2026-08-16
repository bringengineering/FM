param(
    [switch]$NoSeed,
    [string]$HostName = "127.0.0.1",
    [int]$Port = 8766
)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $appRoot

$arguments = @("-B", "-m", "app.server", "--host", $HostName, "--port", $Port)
if (-not $NoSeed) { $arguments += "--seed" }

Write-Host "BRING Marketing OS 시작: http://${HostName}:$Port"
& python @arguments
