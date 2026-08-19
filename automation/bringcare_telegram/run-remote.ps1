$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$env:PYTHONUTF8 = '1'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Push-Location
try {
    Set-Location -LiteralPath $projectRoot
    python -X utf8 -m automation.bringcare_telegram.poller
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
