# BRING Field Platform Managed Map Release

## Migration decisions

- A missing `managementContract` is interpreted as `none`. No existing building becomes managed automatically.
- A local registration draft without `draftVersion` is upgraded to version 2 while preserving its address-derived latitude and longitude.
- Deploy Functions first, Database Rules second, and Hosting last. This prevents the client from calling a missing mutation endpoint or reading an unprotected map projection.
- Provision both the `fieldPlatform` and `fieldRole` custom claims, and require `fieldPlatform/users/{uid}/enabled === true`. A company email alone does not grant access.
- Set `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` to the Firebase App Check reCAPTCHA Enterprise site key before the production build. Do not release a build without the key while the callables enforce App Check.
- Approve a pending management record only after verifying the signed management contract and its management start date.
- Register every Firebase Hosting domain and custom production domain in the Naver Maps Web service URL list. Failure to load map tiles on localhost does not block verification of the managed-building list and filters.
- Roll back Hosting and Functions independently through Firebase release history. Safe `mapProjections` may remain during rollback because they contain only the advertising-safe allowlist and do not expose raw records.

## Pre-release verification

Run from the repository root:

```bash
pnpm --dir functions test
pnpm --dir functions build
pnpm --dir company-site test:field:run
pnpm --dir company-site typecheck:field
pnpm --dir company-site build
```

Do not proceed unless every command exits successfully and the production App Check site key is configured.

## Deployment order

Run each deployment only after the preceding deployment succeeds:

```bash
firebase deploy --only functions:field-platform
firebase deploy --only database
firebase deploy --only hosting:bringcare
```

After deployment, verify that staff registrations requesting management remain `pending`, administrators can activate them, and only active, non-archived buildings appear through `fieldPlatform/mapProjections`.

## Rollback

Use Firebase release history to roll back Hosting or Functions independently. Retaining the current safe projection records during rollback is acceptable; do not restore any client access to raw building, listing, or media records for the managed map.
