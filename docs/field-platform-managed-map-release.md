# BRING Field Platform Managed Map Release

## Migration decisions

- A missing `managementContract` is interpreted as `none`. No existing building becomes managed automatically.
- A local registration draft without `draftVersion` is upgraded to version 2 while preserving its address-derived latitude and longitude.
- The former Functions/Hosting deployment plan is retired. CRM production releases deploy only emulator-tested Realtime Database Rules to `bring-fm` before publishing the desktop installer.
- Provision both the `fieldPlatform` and `fieldRole` custom claims, and require `fieldPlatform/users/{uid}/enabled === true`. A company email alone does not grant access.
- Set `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` to the Firebase App Check reCAPTCHA Enterprise site key before the production build. Do not release a build without the key while the callables enforce App Check.
- Approve a pending management record only after verifying the signed management contract and its management start date.
- Register every Firebase Hosting domain and custom production domain in the Naver Maps Web service URL list. Failure to load map tiles on localhost does not block verification of the managed-building list and filters.
- Do not restore retired Functions or Hosting deployment paths while rolling back a CRM release.

## Pre-release verification

Run from the repository root:

```bash
pnpm --dir functions test
pnpm --dir functions build
pnpm --dir company-site test:field:run
pnpm --dir company-site typecheck:field
pnpm --dir company-site build
pnpm --dir company-site export:firebase
```

`export:firebase` must run after the successful build so Firebase Hosting receives the current `dist/client` output. Do not proceed unless every command exits successfully and the production App Check site key is configured.

## Firebase deployment boundary

`release/firebase-targets.json` is the source of truth for Firebase project ownership. Every `functions/src/index.ts` export is archival metadata: historical `bring-fm` names are recorded in `primary.archivedFunctionNames`, while seven names that reference the retired Realtime Database remain in `retiredLegacy.archivedFunctionNames`. Neither list is a deployment target. `primary.functionsDeploymentAllowed` and `retiredLegacy.deploymentAllowed` are both `false`.

There is no supported automatic or manual Functions deployment command. The manifest must not contain `functionSelectors`, and no release tooling may derive a selector from either archival list. Never use a blanket Functions selector such as `functions`, a named Functions selector, Hosting, or an unscoped `firebase deploy`.

The only Firebase mutation in the CRM release path is the Rules deployment described below. It names `bring-fm` explicitly and uses `--only database`.

### CRM automatic release

The CRM release workflow is Spark-compatible and deploys Realtime Database Rules only. It reads `crmAutomaticRelease.projectId` and `crmAutomaticRelease.databaseRules` from `release/firebase-targets.json`; the automatic target must be exactly `bring-fm` and must set `databaseRules` to `true`. The parser rejects `functionSelectors` anywhere in the manifest, so neither automatic nor manual CRM tooling can deploy Functions. Archived function names can never be selected by release automation. CRM automation must never deploy Functions or Hosting.

For a local PowerShell rehearsal, validate the target from the manifest instead of retyping it:

```powershell
$firebaseTargets = Get-Content -Raw -LiteralPath release/firebase-targets.json | ConvertFrom-Json
$crmProject = $firebaseTargets.crmAutomaticRelease.projectId
if ($crmProject -ne 'bring-fm' -or $firebaseTargets.crmAutomaticRelease.databaseRules -ne $true) { throw 'Invalid CRM automatic target' }
pnpm --dir company-site exec firebase --config ../firebase.json --project $crmProject deploy --only database
```

The workflow runs emulator-backed Rules tests first and deploys the exact Rules on every non-no-op release before publishing the Windows release as stable. This repeatable deployment converges live Rules after an earlier aborted release. Do not run the command against `bring-fm-hj`; that retired project is retained only as historical ownership metadata and is never a deployment destination.

### Retired legacy archive (never deploy)

`bring-fm-hj` is retired. `retiredLegacy.archivedFunctionNames` records the seven historical exports only so maintainers can recognize old source ownership. It intentionally has no `functionSelectors`, and there is no supported deployment command for it. Never deploy Functions, Database Rules, Hosting, or any other resource to `bring-fm-hj`; migrate or remove code that still depends on that project through a separately reviewed source change instead.

## Rollback

Roll back only through a separately reviewed Rules release and desktop release recovery. Do not restore retired Functions or Hosting deployment authority.
