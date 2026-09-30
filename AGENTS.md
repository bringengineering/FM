# Project security baseline

These instructions apply to every file and future task in this repository.

- Read `SECURITY.md` before changing authentication, Firebase rules, Apps Script endpoints, uploads, external requests, Electron windows/IPC, or deployment configuration.
- Treat browser input, Firebase data, spreadsheets, uploaded files, webhook/chatbot payloads, remote HTML, URLs, and generated documents as untrusted.
- Keep Firebase rules deny-by-default. Do not replace role/allowlist checks with `auth != null`, client-side gates, shared URLs, or shared passwords. Test anonymous denial and each role in Emulator before deployment.
- `bring-fm-hj` and the signage/shop project `bring-fm` are separate Firebase projects. Never deploy one project's rules to the other. The signage rules file is a merge fragment, not a complete deployable ruleset.
- Never hardcode or log passwords, account numbers, OAuth/ID/refresh tokens, API secrets, private keys, database credentials, authorization headers, personal data, or secret-bearing URLs. Use Apps Script Properties, environment variables, or the platform secret store. Commit examples with placeholders only.
- Firebase web API keys are public client identifiers, but they must have API/application restrictions and must always be paired with restrictive database rules and authorized-domain settings.
- Preserve output encoding and sanitization at every HTML sink. Rich HTML must pass the repository sanitizer; ordinary values must use `textContent` or context-appropriate escaping. Never render Firebase or spreadsheet HTML directly.
- Validate uploads using an allowed extension and matching MIME type, decoded byte size, safe filename, and archive expansion limits. Do not trust client-reported size or file type.
- Avoid shell execution. If an external command is required, pass an argument array, cap time/output/resources, use a temporary directory, and never interpolate untrusted input into a shell command.
- For outbound requests, allow only required HTTPS destinations or validate public DNS/IPs on every redirect. Block credentials in URLs, private/link-local/loopback ranges, oversized responses, and unrestricted redirects.
- Electron renderers must keep `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`; deny unnecessary permissions/navigation/windows and validate IPC senders and arguments.
- Use secure defaults: authentication/configuration failures must fail closed, production debug/test bypasses must be impossible, cookies/sessions must be minimal, and public endpoints must use size/rate limits where available.
- Redact secrets and personal data from logs and errors. Return generic client errors while retaining only non-sensitive operational context.
- Keep dependency versions and lockfiles aligned. Check maintainer advisories before upgrades, prefer patched versions with the smallest compatible change, and run relevant tests/lint/build after edits.
- Do not deploy live Firebase rules, rotate credentials, delete data, or broaden public/network access without explicit authorization, a current backup, and a rollback/verification plan.

When a requested change would weaken any item above, stop and explain the conflict instead of adding a bypass.

# Preview-first and release workflow

These instructions apply to every future CRM change and deployment in this repository.

- When the user explicitly sets an end-to-end goal that includes both implementing a CRM change and deploying it, carry the work through implementation, verification, and deployment; that goal is explicit deployment authorization, so a separate follow-up deployment request is not required. This does not waive preview approval, the release sequence below, or separate authorization required for destructive data changes, live Firebase rules changes, credential rotation, or broadened access.
- Do not start implementation merely from an initial change request. First prepare and show a preview or mockup that is sufficient for the user to review the intended result. Start editing production source only after the user approves that preview.
- Do not deploy unless the user explicitly asks to deploy or explicitly sets an end-to-end goal that includes deployment. Approval of a preview or implementation alone is not deployment authorization.
- When the user explicitly authorizes a deployment, perform the release in this exact order:
  1. Check whether another computer or task has a deployment in progress.
  2. Verify that the latest remote release branch changes are incorporated locally.
  3. Check for duplicate Git tags and duplicate reserved/planned versions.
  4. Atomically reserve the next unused version before building anything else that can publish it.
  5. Run the complete test suite and validate the built installer artifact.
  6. Publish the formal release.
  7. Verify that the application's update channel points to and serves the new release.
- Stop before publishing if any earlier step is incomplete or ambiguous. Report the blocker instead of skipping or reordering steps.
- After deployment, briefly report what was deployed and how the release proceeded. Include the version, affected app/services, key verification results, and release link when available; clearly note any failure or partial completion.
