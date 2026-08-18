[CmdletBinding()]
param(
    [switch]$Apply,
    [ValidateNotNullOrEmpty()]
    [string]$AdministratorAccount = "dpvld858@gmail.com",
    [ValidateNotNullOrEmpty()]
    [string]$GcloudCommand = "gcloud"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# This bootstrap is deliberately not reusable for another project. The hard-coded
# trust boundary is easier to audit and prevents an accidental deploy to the
# retired Firebase project.
$ProjectId = "bring-fm"
$DeniedProjectId = "bring-fm-hj"
$GitHubRepository = "bringengineering/FM"
$GitHubRepositoryId = "1276587874"
$GitHubOwnerId = "243367126"
$SourceBranch = "codex/bring-field-platform"
$SourceRef = "refs/heads/$SourceBranch"
$ProductionEnvironment = "bring-crm-production"
$RulesWorkflowPath = ".github/workflows/crm-release.yml"
$RulesWorkflowRef = "$GitHubRepository/$RulesWorkflowPath@$SourceRef"
$PoolId = "bring-crm-github"
$ProviderId = "bringengineering-fm"
$RulesServiceAccountId = "bring-crm-rules-deployer"
$RulesRoleId = "bringCrmDatabaseRulesDeployer"
$RulesServiceAccount = "$RulesServiceAccountId@$ProjectId.iam.gserviceaccount.com"
$RulesRoleName = "projects/$ProjectId/roles/$RulesRoleId"
$ManifestPath = Join-Path $PSScriptRoot "firebase-targets.json"
$RulesRoleFile = Join-Path $PSScriptRoot "wif-roles\bringCrmDatabaseRulesDeployer.yaml"

$RequiredApis = @(
    "cloudresourcemanager.googleapis.com",
    "firebase.googleapis.com",
    "firebasedatabase.googleapis.com",
    "firebaserules.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com"
)

$RulesProjectRoles = @($RulesRoleName)
$ForbiddenProjectRoles = @(
    "roles/owner",
    "roles/editor",
    "roles/firebase.admin",
    "roles/firebase.developAdmin"
)

$AttributeMapping = @(
    "google.subject=assertion.sub",
    "attribute.repository=assertion.repository",
    "attribute.repository_id=assertion.repository_id",
    "attribute.repository_owner_id=assertion.repository_owner_id",
    "attribute.ref=assertion.ref",
    "attribute.environment=assertion.environment",
    "attribute.workflow_ref=assertion.workflow_ref"
) -join ","

$AttributeCondition = @(
    "assertion.repository=='$GitHubRepository'",
    "assertion.repository_id=='$GitHubRepositoryId'",
    "assertion.repository_owner_id=='$GitHubOwnerId'",
    "assertion.ref=='$SourceRef'",
    "assertion.environment=='$ProductionEnvironment'",
    "assertion.workflow_ref=='$RulesWorkflowRef'"
) -join "&&"

function Test-PropertyNamePresent {
    param(
        $Value,
        [Parameter(Mandatory = $true)][string]$PropertyName
    )

    if ($null -eq $Value) {
        return $false
    }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        foreach ($property in $Value.PSObject.Properties) {
            if ($property.Name -eq $PropertyName -or (Test-PropertyNamePresent -Value $property.Value -PropertyName $PropertyName)) {
                return $true
            }
        }
        return $false
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        foreach ($item in $Value) {
            if (Test-PropertyNamePresent -Value $item -PropertyName $PropertyName) {
                return $true
            }
        }
    }
    return $false
}

function Assert-LocalContract {
    if ($AdministratorAccount -ne "dpvld858@gmail.com") {
        throw "Administrator account is locked to 'dpvld858@gmail.com'. Refusing: $AdministratorAccount"
    }
    if ($ProjectId -eq $DeniedProjectId) {
        throw "Denied legacy project selected: $DeniedProjectId"
    }
    if ($ProjectId -ne "bring-fm") {
        throw "This bootstrap is locked to bring-fm. Requested project: $ProjectId"
    }
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "Missing release target manifest: $ManifestPath"
    }
    if (-not (Test-Path -LiteralPath $RulesRoleFile -PathType Leaf)) {
        throw "Missing custom rules role definition: $RulesRoleFile"
    }

    $manifestSource = Get-Content -LiteralPath $ManifestPath -Raw
    $manifest = $manifestSource | ConvertFrom-Json
    if ($manifest.crmAutomaticRelease.projectId -ne $ProjectId) {
        throw "crmAutomaticRelease.projectId must be exactly '$ProjectId'."
    }
    if ($null -ne $manifest.PSObject.Properties["legacy"]) {
        throw "An active legacy deployment target is forbidden. Keep bring-fm-hj as retired archival metadata only."
    }
    if ($null -eq $manifest.PSObject.Properties["retiredLegacy"]) {
        throw "Missing retired archival metadata for the denied legacy project."
    }
    if ($manifest.retiredLegacy.projectId -ne $DeniedProjectId) {
        throw "The retired legacy project marker changed. Review the release boundary before continuing."
    }
    if ($manifest.crmAutomaticRelease.databaseRules -ne $true) {
        throw "crmAutomaticRelease.databaseRules must be true."
    }
    if (Test-PropertyNamePresent -Value $manifest -PropertyName "functionSelectors") {
        throw "Firebase target metadata must not contain deployable Functions selectors anywhere."
    }
    if ($manifest.primary.projectId -ne $ProjectId -or $manifest.primary.databaseRules -ne $true) {
        throw "The primary target must remain '$ProjectId' and own Database Rules."
    }
    if ($null -eq $manifest.primary.PSObject.Properties["functionsDeploymentAllowed"] -or $manifest.primary.functionsDeploymentAllowed -ne $false) {
        throw "The primary target must explicitly forbid Functions deployment."
    }
    if ($null -eq $manifest.primary.PSObject.Properties["archivedFunctionNames"]) {
        throw "The primary target must retain historical Function names as non-deployable archival metadata."
    }
    $primaryArchivedFunctionNames = @($manifest.primary.archivedFunctionNames)
    if ($primaryArchivedFunctionNames.Count -eq 0) {
        throw "The primary Function archive must retain its historical names."
    }
    $invalidPrimaryArchivedNames = @($primaryArchivedFunctionNames | Where-Object { $_ -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,62}$' })
    if ($invalidPrimaryArchivedNames.Count -gt 0 -or @($primaryArchivedFunctionNames | Sort-Object -Unique).Count -ne $primaryArchivedFunctionNames.Count) {
        throw "The primary Function archive contains invalid or duplicate names."
    }
    if ($manifest.retiredLegacy.status -ne "retired" -or $manifest.retiredLegacy.deploymentAllowed -ne $false -or $manifest.retiredLegacy.databaseRules -ne $false) {
        throw "The denied legacy project must remain retired, non-deployable, and must never own Database Rules."
    }
    if ($null -ne $manifest.retiredLegacy.PSObject.Properties["functionSelectors"]) {
        throw "The retired legacy metadata must not contain deployable Functions selectors."
    }
    $archivedFunctionNames = @($manifest.retiredLegacy.archivedFunctionNames)
    if ($archivedFunctionNames.Count -eq 0) {
        throw "The retired legacy archive must retain its historical function names."
    }
    $invalidArchivedNames = @($archivedFunctionNames | Where-Object { $_ -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,62}$' })
    if ($invalidArchivedNames.Count -gt 0 -or @($archivedFunctionNames | Sort-Object -Unique).Count -ne $archivedFunctionNames.Count) {
        throw "The retired legacy archive contains invalid or duplicate function names."
    }
    $overlappingArchivedNames = @($primaryArchivedFunctionNames | Where-Object { $archivedFunctionNames -contains $_ })
    if ($overlappingArchivedNames.Count -gt 0) {
        throw "Primary and retired legacy Function archives overlap: $($overlappingArchivedNames -join ', ')"
    }

    $roleSource = Get-Content -LiteralPath $RulesRoleFile -Raw
    foreach ($forbiddenRole in $ForbiddenProjectRoles) {
        if ($roleSource.Contains($forbiddenRole)) {
            throw "Forbidden broad role found in custom role definition: $forbiddenRole"
        }
    }
    if ($roleSource -match '(?im)^\s*-\s+(storage|firebasehosting|cloudfunctions)\.') {
        throw "Database Rules role must not include Storage, Hosting, or Functions permissions."
    }

    return $manifest
}

function Get-RulesRolePermissions {
    $permissions = @()
    foreach ($line in Get-Content -LiteralPath $RulesRoleFile) {
        if ($line -match '^\s*-\s+([a-z][a-z0-9_.]+)\s*$') {
            $permissions += $Matches[1]
        }
    }
    if ($permissions.Count -eq 0) {
        throw "No permissions were parsed from '$RulesRoleFile'."
    }
    return @($permissions | Sort-Object -Unique)
}

function Format-CommandLine {
    param([string[]]$Arguments)

    $formatted = foreach ($argument in $Arguments) {
        if ($argument -match '[\s"'']') {
            '"' + $argument.Replace('"', '\"') + '"'
        }
        else {
            $argument
        }
    }
    return "$GcloudCommand $($formatted -join ' ')"
}

function Write-PlannedCommand {
    param([string[]]$Arguments)
    Write-Output ("[DRY-RUN] " + (Format-CommandLine -Arguments $Arguments))
}

function Invoke-GcloudText {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [switch]$AllowNotFound
    )

    $output = & $script:GcloudExecutable @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    if ($exitCode -ne 0) {
        if ($AllowNotFound -and $text -match '(?i)(NOT_FOUND|was not found|does not exist|could not be found)') {
            return $null
        }
        throw "gcloud failed ($exitCode): $(Format-CommandLine -Arguments $Arguments)`n$text"
    }
    return $text.Trim()
}

function Invoke-GcloudJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [switch]$AllowNotFound
    )

    $text = Invoke-GcloudText -Arguments $Arguments -AllowNotFound:$AllowNotFound
    if ($null -eq $text -or $text.Length -eq 0) {
        return $null
    }
    return $text | ConvertFrom-Json
}

function Assert-ActiveAdministrator {
    $activeAccounts = Invoke-GcloudText -Arguments @(
        "auth", "list",
        "--filter=status:ACTIVE",
        "--format=value(account)"
    )
    $accounts = @($activeAccounts -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
    if ($accounts.Count -ne 1 -or $accounts[0].Trim() -ne $AdministratorAccount) {
        throw "Active gcloud account must be exactly '$AdministratorAccount'. Active: $($accounts -join ', ')"
    }

    $project = Invoke-GcloudJson -Arguments @(
        "projects", "describe", $ProjectId,
        "--project=$ProjectId",
        "--format=json"
    )
    if ($project.projectId -ne $ProjectId) {
        throw "Resolved GCP project is not '$ProjectId'."
    }
    if ($project.projectId -eq $DeniedProjectId) {
        throw "Refusing legacy project '$DeniedProjectId'."
    }
    if (-not $project.projectNumber) {
        throw "GCP project number could not be resolved for '$ProjectId'."
    }
    return $project.projectNumber.ToString()
}

function Assert-CustomRolePermissionsSupported {
    $resource = "//cloudresourcemanager.googleapis.com/projects/$ProjectId"
    foreach ($permissionName in Get-RulesRolePermissions) {
        $results = @(Invoke-GcloudJson -Arguments @(
            "iam", "list-testable-permissions", $resource,
            "--filter=name=$permissionName",
            "--format=json",
            "--project=$ProjectId"
        ))
        $exact = @($results | Where-Object { $_.name -eq $permissionName })
        if ($exact.Count -ne 1) {
            throw "Permission '$permissionName' is not testable on project '$ProjectId'."
        }
        $supportProperty = $exact[0].PSObject.Properties["customRolesSupportLevel"]
        if ($null -ne $supportProperty -and $supportProperty.Value -ne "SUPPORTED") {
            throw "Permission '$permissionName' is not fully supported in a production custom role: $($supportProperty.Value)"
        }
    }
}

function Ensure-CustomRole {
    $existing = Invoke-GcloudJson -Arguments @(
        "iam", "roles", "describe", $RulesRoleId,
        "--project=$ProjectId",
        "--format=json"
    ) -AllowNotFound

    if ($null -eq $existing) {
        Invoke-GcloudText -Arguments @(
            "iam", "roles", "create", $RulesRoleId,
            "--project=$ProjectId",
            "--file=$RulesRoleFile",
            "--quiet"
        ) | Out-Null
        return
    }
    $deletedProperty = $existing.PSObject.Properties["deleted"]
    if ($null -ne $deletedProperty -and $deletedProperty.Value -eq $true) {
        throw "Custom role '$RulesRoleName' is deleted. Restore and review it before retrying."
    }

    # Converge only this repository-owned custom role to the reviewed file.
    Invoke-GcloudText -Arguments @(
        "iam", "roles", "update", $RulesRoleId,
        "--project=$ProjectId",
        "--file=$RulesRoleFile",
        "--quiet"
    ) | Out-Null
}

function Ensure-WorkloadIdentityPool {
    $existing = Invoke-GcloudJson -Arguments @(
        "iam", "workload-identity-pools", "describe", $PoolId,
        "--project=$ProjectId",
        "--location=global",
        "--format=json"
    ) -AllowNotFound

    if ($null -eq $existing) {
        Invoke-GcloudText -Arguments @(
            "iam", "workload-identity-pools", "create", $PoolId,
            "--project=$ProjectId",
            "--location=global",
            "--display-name=BRING CRM GitHub",
            "--description=Short-lived GitHub Actions identities for BRING CRM production",
            "--quiet"
        ) | Out-Null
        return
    }
    if ($existing.state -ne "ACTIVE") {
        throw "Workload Identity Pool '$PoolId' is not ACTIVE. Refusing to enable or replace it automatically."
    }
}

function Get-MappingValue {
    param(
        [Parameter(Mandatory = $true)]$Mapping,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $property = $Mapping.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Ensure-WorkloadIdentityProvider {
    $existing = Invoke-GcloudJson -Arguments @(
        "iam", "workload-identity-pools", "providers", "describe", $ProviderId,
        "--project=$ProjectId",
        "--location=global",
        "--workload-identity-pool=$PoolId",
        "--format=json"
    ) -AllowNotFound

    if ($null -eq $existing) {
        Invoke-GcloudText -Arguments @(
            "iam", "workload-identity-pools", "providers", "create-oidc", $ProviderId,
            "--project=$ProjectId",
            "--location=global",
            "--workload-identity-pool=$PoolId",
            "--display-name=BRING CRM GitHub release",
            "--description=Restricted to BRING CRM production workflows",
            "--issuer-uri=https://token.actions.githubusercontent.com/",
            "--attribute-mapping=$AttributeMapping",
            "--attribute-condition=$AttributeCondition",
            "--quiet"
        ) | Out-Null
        return
    }

    if ($existing.state -ne "ACTIVE") {
        throw "OIDC provider '$ProviderId' is not ACTIVE. Refusing to enable or replace it automatically."
    }
    $oidcProperty = $existing.PSObject.Properties["oidc"]
    if ($null -eq $oidcProperty -or $oidcProperty.Value.issuerUri -ne "https://token.actions.githubusercontent.com/") {
        throw "Existing provider has an unexpected issuer URI. Refusing to overwrite it."
    }
    $conditionProperty = $existing.PSObject.Properties["attributeCondition"]
    if ($null -eq $conditionProperty -or $conditionProperty.Value -ne $AttributeCondition) {
        throw "Existing provider has a different attribute condition. Review it manually; no trust widening was applied."
    }

    $mappingProperty = $existing.PSObject.Properties["attributeMapping"]
    if ($null -eq $mappingProperty) {
        throw "Existing provider has no attribute mapping. Refusing to overwrite it."
    }

    $desiredMappings = @{
        "google.subject" = "assertion.sub"
        "attribute.repository" = "assertion.repository"
        "attribute.repository_id" = "assertion.repository_id"
        "attribute.repository_owner_id" = "assertion.repository_owner_id"
        "attribute.ref" = "assertion.ref"
        "attribute.environment" = "assertion.environment"
        "attribute.workflow_ref" = "assertion.workflow_ref"
    }
    foreach ($entry in $desiredMappings.GetEnumerator()) {
        if ((Get-MappingValue -Mapping $mappingProperty.Value -Name $entry.Key) -ne $entry.Value) {
            throw "Existing provider mapping '$($entry.Key)' differs. Refusing to overwrite it."
        }
    }
    if ($mappingProperty.Value.PSObject.Properties.Count -ne $desiredMappings.Count) {
        throw "Existing provider has additional attribute mappings. Review it manually before retrying."
    }
}

function Assert-NoUnexpectedPoolProviders {
    $providers = @(Invoke-GcloudJson -Arguments @(
        "iam", "workload-identity-pools", "providers", "list",
        "--project=$ProjectId",
        "--location=global",
        "--workload-identity-pool=$PoolId",
        "--format=json"
    ))
    $unexpected = @()
    $expectedCount = 0
    foreach ($provider in $providers) {
        $name = $provider.name.ToString()
        $id = $name.Substring($name.LastIndexOf('/') + 1)
        if ($id -eq $ProviderId) {
            $expectedCount += 1
        }
        else {
            $unexpected += $id
        }
    }
    if ($expectedCount -ne 1) {
        throw "Dedicated pool '$PoolId' does not contain exactly one expected provider '$ProviderId'."
    }
    if ($unexpected.Count -gt 0) {
        throw "Dedicated pool '$PoolId' has unexpected providers: $($unexpected -join ', '). A pool-level principalSet must not be shared."
    }
}

function Ensure-ServiceAccount {
    param(
        [Parameter(Mandatory = $true)][string]$AccountId,
        [Parameter(Mandatory = $true)][string]$Email,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][string]$Description
    )

    $existing = Invoke-GcloudJson -Arguments @(
        "iam", "service-accounts", "describe", $Email,
        "--project=$ProjectId",
        "--format=json"
    ) -AllowNotFound
    if ($null -eq $existing) {
        Invoke-GcloudText -Arguments @(
            "iam", "service-accounts", "create", $AccountId,
            "--project=$ProjectId",
            "--display-name=$DisplayName",
            "--description=$Description",
            "--quiet"
        ) | Out-Null
    }
    else {
        $disabledProperty = $existing.PSObject.Properties["disabled"]
        if ($null -ne $disabledProperty -and $disabledProperty.Value -eq $true) {
            throw "Service account '$Email' is disabled. Refusing to re-enable it automatically."
        }
    }

    $userManagedKeys = Invoke-GcloudText -Arguments @(
        "iam", "service-accounts", "keys", "list",
        "--iam-account=$Email",
        "--managed-by=user",
        "--project=$ProjectId",
        "--format=value(name)"
    )
    if ($userManagedKeys.Trim().Length -gt 0) {
        throw "Service account '$Email' has a user-managed key. Revoke the key before using keyless WIF."
    }
}

function Get-ProjectPolicy {
    return Invoke-GcloudJson -Arguments @(
        "projects", "get-iam-policy", $ProjectId,
        "--project=$ProjectId",
        "--format=json"
    )
}

function Get-ProjectRolesForMember {
    param(
        [Parameter(Mandatory = $true)]$Policy,
        [Parameter(Mandatory = $true)][string]$Member
    )

    $bindingsProperty = $Policy.PSObject.Properties["bindings"]
    if ($null -eq $bindingsProperty) {
        return @()
    }

    $roles = @()
    foreach ($binding in @($bindingsProperty.Value)) {
        if (@($binding.members) -contains $Member) {
            $roles += $binding.role
        }
    }
    return @($roles | Sort-Object -Unique)
}

function Assert-NoUnexpectedProjectRoles {
    param(
        [Parameter(Mandatory = $true)]$Policy,
        [Parameter(Mandatory = $true)][string]$Member,
        [Parameter(Mandatory = $true)][string[]]$AllowedRoles
    )

    $bindingsProperty = $Policy.PSObject.Properties["bindings"]
    if ($null -ne $bindingsProperty) {
        foreach ($binding in @($bindingsProperty.Value)) {
            if (@($binding.members) -notcontains $Member) {
                continue
            }
            $conditionProperty = $binding.PSObject.Properties["condition"]
            if ($null -ne $conditionProperty) {
                throw "Principal '$Member' has a conditional project binding for '$($binding.role)'. Review it before retrying."
            }
        }
    }

    $unexpected = @(Get-ProjectRolesForMember -Policy $Policy -Member $Member | Where-Object { $AllowedRoles -notcontains $_ })
    if ($unexpected.Count -gt 0) {
        throw "Principal '$Member' already has unexpected project roles: $($unexpected -join ', '). Review and remove them before retrying."
    }
}

function Ensure-ProjectRoleBinding {
    param(
        [Parameter(Mandatory = $true)][string]$Member,
        [Parameter(Mandatory = $true)][string]$Role
    )

    $policy = Get-ProjectPolicy
    if ((Get-ProjectRolesForMember -Policy $policy -Member $Member) -contains $Role) {
        return
    }
    Invoke-GcloudText -Arguments @(
        "projects", "add-iam-policy-binding", $ProjectId,
        "--project=$ProjectId",
        "--member=$Member",
        "--role=$Role",
        "--condition=None",
        "--quiet"
    ) | Out-Null
}

function Get-ServiceAccountPolicy {
    param([Parameter(Mandatory = $true)][string]$Email)
    return Invoke-GcloudJson -Arguments @(
        "iam", "service-accounts", "get-iam-policy", $Email,
        "--project=$ProjectId",
        "--format=json"
    )
}

function Get-MembersForRole {
    param(
        [Parameter(Mandatory = $true)]$Policy,
        [Parameter(Mandatory = $true)][string]$Role
    )
    $bindingsProperty = $Policy.PSObject.Properties["bindings"]
    if ($null -eq $bindingsProperty) {
        return @()
    }

    $members = @()
    foreach ($binding in @($bindingsProperty.Value)) {
        if ($binding.role -eq $Role) {
            $conditionProperty = $binding.PSObject.Properties["condition"]
            if ($null -ne $conditionProperty) {
                throw "Conditional service-account binding found for '$Role'. Review it before retrying."
            }
            $members += @($binding.members)
        }
    }
    return @($members | Sort-Object -Unique)
}

function Ensure-ServiceAccountRoleBinding {
    param(
        [Parameter(Mandatory = $true)][string]$TargetServiceAccount,
        [Parameter(Mandatory = $true)][string]$Member,
        [Parameter(Mandatory = $true)][string]$Role,
        [switch]$RejectOtherMembers
    )

    $policy = Get-ServiceAccountPolicy -Email $TargetServiceAccount
    $members = @(Get-MembersForRole -Policy $policy -Role $Role)
    if ($RejectOtherMembers) {
        $unexpected = @($members | Where-Object { $_ -ne $Member })
        if ($unexpected.Count -gt 0) {
            throw "Service account '$TargetServiceAccount' has unexpected '$Role' members: $($unexpected -join ', ')"
        }
    }
    if ($members -contains $Member) {
        return
    }
    Invoke-GcloudText -Arguments @(
        "iam", "service-accounts", "add-iam-policy-binding", $TargetServiceAccount,
        "--project=$ProjectId",
        "--member=$Member",
        "--role=$Role",
        "--condition=None",
        "--quiet"
    ) | Out-Null
}

function Write-GitHubVariables {
    param([string]$ProjectNumber)

    if ([string]::IsNullOrWhiteSpace($ProjectNumber)) {
        $ProjectNumber = "PROJECT_NUMBER_RESOLVED_BY_APPLY"
    }
    $providerName = "projects/$ProjectNumber/locations/global/workloadIdentityPools/$PoolId/providers/$ProviderId"

    Write-Output ""
    Write-Output "GitHub repository variables (Settings > Secrets and variables > Actions > Variables):"
    Write-Output "GCP_PROJECT_ID=$ProjectId"
    Write-Output "GCP_WORKLOAD_IDENTITY_PROVIDER_BRING_FM=$providerName"
    Write-Output "GCP_RULES_DEPLOY_SERVICE_ACCOUNT_BRING_FM=$RulesServiceAccount"
    Write-Output "GitHub Environment=$ProductionEnvironment"
}

$null = Assert-LocalContract

if (-not $Apply) {
    Write-Output "[DRY-RUN] No gcloud command will be executed. Re-run with -Apply after reviewing this plan."
    Write-Output "[DRY-RUN] Active account must be exactly: $AdministratorAccount"
    Write-Output "[DRY-RUN] Allowed project: $ProjectId"
    Write-Output "[DRY-RUN] Explicitly denied legacy project: $DeniedProjectId"
    Write-Output "[DRY-RUN] GitHub trust: repository_id=$GitHubRepositoryId, owner_id=$GitHubOwnerId, ref=$SourceRef, environment=$ProductionEnvironment"
    Write-Output "[DRY-RUN] Allowed workflow: $RulesWorkflowRef (Realtime Database Rules job only)"
    Write-PlannedCommand -Arguments (@("services", "enable") + $RequiredApis + @("--project=$ProjectId", "--quiet"))
    Write-Output "[DRY-RUN] Create/verify pool '$PoolId' and provider '$ProviderId'; mismatched existing trust fails closed."
    Write-Output "[DRY-RUN] Create/verify Rules service account '$RulesServiceAccount'."
    Write-Output "[DRY-RUN] Grant Database Rules custom role only: $RulesRoleName."
    Write-Output "[DRY-RUN] No service-account key, long-lived token, Hosting role, Database data-write role, or legacy-project role is created."
    Write-GitHubVariables
    return
}

$resolvedCommand = Get-Command -Name $GcloudCommand -ErrorAction SilentlyContinue
if ($null -eq $resolvedCommand) {
    throw "gcloud command not found: $GcloudCommand"
}
$script:GcloudExecutable = $resolvedCommand.Source

$ProjectNumber = Assert-ActiveAdministrator

Invoke-GcloudText -Arguments (@("services", "enable") + $RequiredApis + @("--project=$ProjectId", "--quiet")) | Out-Null
Assert-CustomRolePermissionsSupported
Ensure-CustomRole
Ensure-WorkloadIdentityPool
Ensure-WorkloadIdentityProvider
Assert-NoUnexpectedPoolProviders

Ensure-ServiceAccount `
    -AccountId $RulesServiceAccountId `
    -Email $RulesServiceAccount `
    -DisplayName "BRING CRM Database Rules deployer" `
    -Description "Keyless GitHub OIDC deployer for emulator-tested bring-fm Database Rules releases"

$rulesMember = "serviceAccount:$RulesServiceAccount"
$projectPolicy = Get-ProjectPolicy
Assert-NoUnexpectedProjectRoles -Policy $projectPolicy -Member $rulesMember -AllowedRoles $RulesProjectRoles

foreach ($role in $RulesProjectRoles) {
    Ensure-ProjectRoleBinding -Member $rulesMember -Role $role
}

$poolResource = "projects/$ProjectNumber/locations/global/workloadIdentityPools/$PoolId"
$rulesPrincipal = "principalSet://iam.googleapis.com/$poolResource/attribute.workflow_ref/$RulesWorkflowRef"
Ensure-ServiceAccountRoleBinding `
    -TargetServiceAccount $RulesServiceAccount `
    -Member $rulesPrincipal `
    -Role "roles/iam.workloadIdentityUser" `
    -RejectOtherMembers

# Re-audit project-level grants after all mutations. Unexpected grants are never removed automatically.
$finalPolicy = Get-ProjectPolicy
Assert-NoUnexpectedProjectRoles -Policy $finalPolicy -Member $rulesMember -AllowedRoles $RulesProjectRoles

Write-Output "WIF bootstrap completed for '$ProjectId' using short-lived GitHub OIDC credentials."
Write-GitHubVariables -ProjectNumber $ProjectNumber
