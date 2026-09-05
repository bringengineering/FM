# Company Cloudflare endpoint cutover

## Change

The desktop AI, transcription, contract-check and document-delivery routes now default to `https://bring-crm-ai-gateway.bringengineering1008.workers.dev`. The existing operator environment override remains supported.

The Worker deployment configuration pins the company account `3c3bcd08bb6ed3a7a8f98c292386c327` and its migrated KV namespaces. No credentials are included. Personal BRING OS and company Kakao intake are outside the change.

## Verification

The unmodified v1.36.6 baseline passed 942 desktop and 31 Worker tests. New endpoint/account tests failed against the old configuration, then the combined suite passed 976 tests after the change. Existing secret-boundary coverage now expects the verified company endpoint.

## Release gate

Do not merge into `codex/bring-field-platform` until the company endpoint is enabled and an authenticated, non-sensitive AI smoke test passes on a candidate build. That branch automatically publishes updater artifacts. The copied target is currently disabled staging; publishing a client that targets it would disable AI for updated users.

Before cutover, reconcile the current usage KV entry again because the source remains active. Preserve document feature flags and authorization allowlists. Keep the existing personal-account CRM gateway active for old clients and rollback; do not delete it or change personal finance services.

The installed app could not be test-launched with an endpoint environment override because execution policy rejected the launch. It was restored through its normal launcher. Do not bypass that restriction or patch the installed ASAR. Use a reviewed candidate installer through the normal installation flow, with the user's required installation confirmation.

After the authenticated candidate test, publish using the repository's existing release workflow; it assigns the next version automatically. Confirm the installed version, successful AI response, target-account usage increment, and that old clients still work. Only then call the client cutover complete.
