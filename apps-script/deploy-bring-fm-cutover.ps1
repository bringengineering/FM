param(
  [Parameter(Mandatory = $true)]
  [string]$ScriptId,

  [string]$PnpmCommand = ""
)

$ErrorActionPreference = "Stop"

$pnpm = $PnpmCommand
if (-not $pnpm) {
  $pnpmEntry = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
  if (-not $pnpmEntry) {
    $pnpmEntry = Get-Command "pnpm" -ErrorAction SilentlyContinue
  }
  if (-not $pnpmEntry) {
    throw "pnpm is required. Pass -PnpmCommand with an absolute pnpm path."
  }
  $pnpm = $pnpmEntry.Source
}
if (-not (Test-Path -LiteralPath $pnpm -PathType Leaf)) {
  throw "pnpm command was not found"
}

$source = Join-Path $PSScriptRoot "complaint-intake-to-firebase.gs"
$manifest = Join-Path $PSScriptRoot "appsscript.json"
$sourceText = [IO.File]::ReadAllText($source)
$deploymentMatch = [regex]::Match($sourceText, "https://script\.google\.com/macros/s/([^/]+)/exec")
if (-not $deploymentMatch.Success) {
  throw "Existing Apps Script deployment URL is missing"
}
$deploymentId = $deploymentMatch.Groups[1].Value

$tempRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Temp"))
$stage = [IO.Path]::GetFullPath((Join-Path $tempRoot ("bring-clasp-" + [guid]::NewGuid().ToString("N"))))
if (-not $stage.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe Apps Script staging path"
}
$upload = Join-Path $stage "upload"
New-Item -ItemType Directory -Path $upload -Force | Out-Null

try {
  Copy-Item -LiteralPath $source -Destination (Join-Path $upload "Code.gs")
  Copy-Item -LiteralPath $manifest -Destination (Join-Path $upload "appsscript.json")
  $claspConfig = @{ scriptId = $ScriptId; rootDir = "./upload" } | ConvertTo-Json
  [IO.File]::WriteAllText(
    (Join-Path $stage ".clasp.json"),
    $claspConfig,
    (New-Object Text.UTF8Encoding($false))
  )

  $uploadFiles = @(Get-ChildItem -LiteralPath $upload -File -Recurse)
  $uploadNames = @($uploadFiles.Name | Sort-Object)
  if ($uploadFiles.Count -ne 2 -or ($uploadNames -join ",") -ne "appsscript.json,Code.gs") {
    throw "Unsafe Apps Script upload set"
  }
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath (Join-Path $upload "Code.gs") -Algorithm SHA256).Hash) {
    throw "Code staging hash mismatch"
  }
  if ((Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath (Join-Path $upload "appsscript.json") -Algorithm SHA256).Hash) {
    throw "Manifest staging hash mismatch"
  }

  Push-Location $stage
  try {
    $statusOutput = & $pnpm dlx "@google/clasp@3.3.0" --json status 2>&1
    if ($LASTEXITCODE -ne 0) { throw "clasp status failed" }

    $deploymentsOutput = & $pnpm dlx "@google/clasp@3.3.0" --json deployments $ScriptId 2>&1
    if ($LASTEXITCODE -ne 0) { throw "clasp deployments failed" }
    $deployments = ($deploymentsOutput | Out-String) | ConvertFrom-Json
    $existing = @($deployments | Where-Object { $_.deploymentId -eq $deploymentId })
    if ($existing.Count -ne 1 -or -not $existing[0].versionNumber) {
      throw "Existing web deployment binding mismatch"
    }
    $oldVersion = [int]$existing[0].versionNumber

    $pushOutput = & $pnpm dlx "@google/clasp@3.3.0" push --force 2>&1
    if ($LASTEXITCODE -ne 0) { throw "clasp push failed" }

    $description = "bring-fm cutover " + [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    $versionOutput = & $pnpm dlx "@google/clasp@3.3.0" --json version $description 2>&1
    if ($LASTEXITCODE -ne 0) { throw "clasp version failed" }
    $version = ($versionOutput | Out-String) | ConvertFrom-Json
    $newVersion = [int]$version.versionNumber
    if ($newVersion -le $oldVersion) { throw "New Apps Script version was not created" }

    $redeployOutput = & $pnpm dlx "@google/clasp@3.3.0" --json redeploy $deploymentId -V $newVersion -d $description 2>&1
    if ($LASTEXITCODE -ne 0) { throw "clasp redeploy failed" }
    $redeploy = ($redeployOutput | Out-String) | ConvertFrom-Json
    if ($redeploy.deploymentId -ne $deploymentId -or [int]$redeploy.versionNumber -ne $newVersion) {
      throw "Redeploy response binding mismatch"
    }

    $verifyOutput = & $pnpm dlx "@google/clasp@3.3.0" --json deployments $ScriptId 2>&1
    if ($LASTEXITCODE -ne 0) { throw "clasp deployment verification failed" }
    $verified = @((($verifyOutput | Out-String) | ConvertFrom-Json) |
      Where-Object { $_.deploymentId -eq $deploymentId })
    if ($verified.Count -ne 1 -or [int]$verified[0].versionNumber -ne $newVersion) {
      throw "Live deployment version mismatch"
    }

    [pscustomobject]@{
      ok = $true
      uploadFiles = 2
      oldVersion = $oldVersion
      newVersion = $newVersion
      deploymentIdPreserved = $true
      webUrlPreserved = $true
    } | ConvertTo-Json -Compress
  } finally {
    Pop-Location
  }
} finally {
  if ((Test-Path -LiteralPath $stage) -and
      $stage.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $stage) -like "bring-clasp-*") {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }
}
