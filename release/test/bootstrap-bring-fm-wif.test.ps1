[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ReleaseRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $ReleaseRoot "bootstrap-bring-fm-wif.ps1"
$RolePath = Join-Path $ReleaseRoot "wif-roles\bringCrmDatabaseRulesDeployer.yaml"
$ManifestPath = Join-Path $ReleaseRoot "firebase-targets.json"

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
}

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
Assert-True ($parseErrors.Count -eq 0) ("PowerShell parse errors: " + (($parseErrors | ForEach-Object Message) -join "; "))

# A nonexistent gcloud executable proves that default execution is a true local dry-run.
$output = & $ScriptPath -GcloudCommand "__gcloud_must_not_execute__" 2>&1
Assert-True ($?) "Dry-run failed."
$text = ($output | ForEach-Object { $_.ToString() }) -join "`n"

$requiredText = @(
    "[DRY-RUN] No gcloud command will be executed",
    "Allowed project: bring-fm",
    "Explicitly denied legacy project: bring-fm-hj",
    "repository_id=1276587874",
    "owner_id=243367126",
    "refs/heads/codex/bring-field-platform",
    "bring-crm-production",
    "bringengineering/FM/.github/workflows/crm-release.yml",
    "GCP_PROJECT_ID=bring-fm",
    "GCP_WORKLOAD_IDENTITY_PROVIDER_BRING_FM=",
    "GCP_RULES_DEPLOY_SERVICE_ACCOUNT_BRING_FM="
)
foreach ($value in $requiredText) {
    Assert-True ($text.Contains($value)) "Dry-run output is missing: $value"
}
$printedVariableNames = @([regex]::Matches($text, '(?m)^(GCP_[A-Z0-9_]+)=') | ForEach-Object { $_.Groups[1].Value })
Assert-True ($printedVariableNames.Count -eq 3) ("Bootstrap must print exactly the three workflow variables, got: " + ($printedVariableNames -join ", "))

$accountOverrideRejected = $false
try {
    & $ScriptPath `
        -AdministratorAccount "ameejin92@gmail.com" `
        -GcloudCommand "__gcloud_must_not_execute__" | Out-Null
}
catch {
    $accountOverrideRejected = $_.Exception.Message.Contains("locked to 'dpvld858@gmail.com'")
}
Assert-True $accountOverrideRejected "A non-dpvld administrator account was not rejected before gcloud resolution."

$scriptSource = Get-Content -LiteralPath $ScriptPath -Raw
$forbiddenCommands = @(
    "service-accounts keys create",
    "activate-service-account",
    "auth print-access-token",
    "firebase deploy"
)
foreach ($value in $forbiddenCommands) {
    Assert-True (-not $scriptSource.Contains($value)) "Bootstrap contains forbidden command text: $value"
}
Assert-True (-not $scriptSource.Contains("crm-database-rules.yml")) "Bootstrap trusts a nonexistent Rules workflow."
foreach ($value in @(
    "GCP_FUNCTIONS_DEPLOY_SERVICE_ACCOUNT_BRING_FM",
    "bring-crm-functions-deployer",
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "eventarc.googleapis.com",
    "run.googleapis.com",
    "roles/cloudfunctions.developer",
    '"builds", "get-default-service-account"',
    '"functions", "describe"'
)) {
    Assert-True (-not $scriptSource.Contains($value)) "Spark-only bootstrap still contains Functions deployment authority: $value"
}
Assert-True ($scriptSource.Contains('$manifest.crmAutomaticRelease.databaseRules -ne $true')) "Bootstrap does not require the Rules-only automatic target."
Assert-True ($scriptSource.Contains('Test-PropertyNamePresent -Value $manifest -PropertyName "functionSelectors"')) "Bootstrap does not recursively reject Functions selectors anywhere in the manifest."
Assert-True ($scriptSource.Contains('PSObject.Properties["functionsDeploymentAllowed"]')) "Bootstrap does not require the primary Functions deployment deny flag."
Assert-True ($scriptSource.Contains('PSObject.Properties["archivedFunctionNames"]')) "Bootstrap does not require primary Function archival metadata."
Assert-True ($scriptSource.Contains('PSObject.Properties["legacy"]')) "Bootstrap does not reject an active legacy deployment target."
Assert-True ($scriptSource.Contains('"iam", "list-testable-permissions"')) "Apply path does not validate custom-role permissions with IAM."
Assert-True ($scriptSource.Contains('"customRolesSupportLevel"')) "Apply path does not reject non-production custom-role support levels."

$roleSource = Get-Content -LiteralPath $RolePath -Raw
foreach ($value in @("roles/owner", "roles/editor", "storage.", "firebasehosting.", "cloudfunctions.")) {
    Assert-True (-not $roleSource.Contains($value)) "Rules role contains forbidden broad permission or role: $value"
}
foreach ($value in @("firebaserules.rulesets.create", "firebaserules.releases.update", "firebasedatabase.instances.get", "firebasedatabase.instances.update")) {
    Assert-True ($roleSource.Contains($value)) "Rules role is missing required permission: $value"
}

$manifestSource = Get-Content -LiteralPath $ManifestPath -Raw
$manifest = $manifestSource | ConvertFrom-Json
Assert-True (-not $manifestSource.Contains('"functions:')) "Manifest still contains an executable Functions selector value."
Assert-True ($null -eq $manifest.PSObject.Properties["legacy"]) "Manifest still exposes an active legacy deployment target."
Assert-True ($manifest.primary.projectId -eq "bring-fm" -and $manifest.primary.databaseRules -eq $true) "Primary Rules target is not exactly bring-fm."
Assert-True ($manifest.primary.functionsDeploymentAllowed -eq $false) "Primary target still permits Functions deployment."
Assert-True ($null -eq $manifest.primary.PSObject.Properties["functionSelectors"]) "Primary target still exposes deployable Functions selectors."
Assert-True (@($manifest.primary.archivedFunctionNames).Count -gt 0) "Primary historical Function names were not retained as archival metadata."
Assert-True ($manifest.retiredLegacy.projectId -eq "bring-fm-hj") "Retired legacy project marker is missing."
Assert-True ($manifest.retiredLegacy.status -eq "retired" -and $manifest.retiredLegacy.deploymentAllowed -eq $false) "Legacy project is not explicitly retired and non-deployable."
Assert-True ($null -eq $manifest.retiredLegacy.PSObject.Properties["functionSelectors"]) "Retired legacy metadata still exposes deployable Functions selectors."

Write-Output "PASS bootstrap-bring-fm-wif static and dry-run contract"
