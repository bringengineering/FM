# Company CRM Cutover Design

## Goal

Build a new BRING CRM release that reads and writes a verified copy under the company-owned `bring-fm` project while leaving the existing `bring-fm-hj` project and installed CRM release unchanged.

## Architecture

- Promote the verified staging snapshot into the isolated `/crmCompany` namespace in `bring-fm`.
- Store CRM access records at `/crmCompany/access/{uid}` for the three existing company Google accounts.
- Change only the new CRM branch to use the `bring-fm` API key, database, and `/crm-auth` page.
- Prefix every new CRM database request with `/crmCompany`; keep the migration reader permanently pinned to GET-only `bring-fm-hj` paths.
- Add a `bring-fm.web.app/crm-auth` Google login bridge using the existing company Firebase configuration.
- Keep embedded FIELD in a persistent Electron partition. On Spark, FIELD requires one initial company Google authorization in that partition; subsequent launches reuse it. No login is removed and no Cloud Function is required.

## Data Safety

Promotion reads only the verified staging record and creates `/crmCompany` once. It refuses to overwrite an existing live namespace. Existing top-level FIELD roots, `bring-fm-hj`, and the currently installed CRM are not modified. Client rules deny all access unless the signed-in UID has an enabled `/crmCompany/access` record; only admin/member roles may write.

## Verification

Tests cover path prefixing, project configuration, auth-page configuration, access rules, promotion mapping, overwrite refusal, and the permanent source GET-only boundary. After upload, an administrative read-back must match the promoted payload checksum. The new installer is built separately and is not auto-released or installed until its smoke verification passes.
