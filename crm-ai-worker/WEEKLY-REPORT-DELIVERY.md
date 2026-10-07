# Weekly report → Telegram PDF

The desktop saves the weekly report before sending anything. The final confirmation
explicitly names the company work room and PDF sharing. Only the dedicated weekly
submission IPC triggers delivery; ordinary growth/1:1 saves never do.

Directly added work is also saved **before submission**, by user/company/week,
in the desktop's OS-encrypted `weekly-report-drafts-v1` recovery store. This is
local to the same PC, not shared or sent to Telegram. Additions and deletions are
persisted immediately; failed reads block overwriting a recovery draft, and failed
writes remain visible with a retry action. Updating the save badge does not replace
the form or interrupt typing. Account changes invalidate pending UI recovery.

Edge requests use `redirect: manual` with non-success status rejection. Workers
does not implement `redirect: error`; native fetch stored on a Durable Object also
needs its global receiver bound. The workerd regression test uses native outbound
fetch (including redirects and multipart Telegram calls), not a fetch replacement.

## Access and data

- Firebase verifies the caller, then the gateway reads `/crmCompany/access/{uid}`
  on **bring-fm** with the caller's ID token. Enabled, verified admin/member users
  are accepted; forced-password-change, viewer and marketing-only users are denied.
- Only the caller's `weekly_report_*` entry with both weekly format headers is
  accepted. The generated snapshot must serialize back to the saved public answers.
  Private growth answers and manager notes are never exported.
- The main process generates the escaped, network-isolated A4 PDF. The gateway
  allows only PDF MIME, decoded bytes ≤ 2 MiB, PDF signature/EOF and no obvious
  active actions. Caller-supplied destinations/URLs/filenames are rejected.
- The server chooses the fixed room from `WEEKLY_REPORT_TELEGRAM_CHAT_ID`; it
  never accepts a destination from the renderer. These secrets and the bot token
  are held in GitHub Actions/Cloudflare secret stores, never source or output logs.

## Delivery states

A Durable Object serializes each author/report and persists a claim before the
single Telegram `sendDocument` call. The caption is the short summary and the PDF
contains all approved items, details and manually written next-week plans.

- `sent`: Telegram acknowledged the file. The same content is not sent again.
- `failed`: explicit rejection/pre-send failure; use **PDF 다시 보내기** after any
  retry cooldown. A saved local encrypted snapshot covers failures before upload.
- `unknown`: a timeout/crash could have delivered the PDF. Automatic resend is
  blocked; check the work room rather than risk duplicates. No claim of delivery
  is made in the UI. Manual retry requires explicit confirmation that the user
  has checked the room and found no PDF; ordinary retry never clears this claim.
- `none`: no delivery snapshot; review and submit again. Retry never recollects
  newly changed CRM tasks and silently substitutes them for submitted content.

Successful delivery removes server PDF chunks and local pending snapshot. Failed
server PDF/snapshot data expires after 7 days; minimal receipts remain to dedupe.
An uncertain receipt continues to block resend after expiry. Retry information
stays in the current user's OS-protected local outbox until delivered or replaced.

## Release and rollback

The existing serialized release workflow reserves a unique version, runs all
tests, builds and verifies the installer, then deploys code and the two bot secrets
together using Wrangler `--secrets-file`. It preserves all unrelated Worker
settings/secrets. Worker health must report the matching source version and ready
weekly delivery bindings before the desktop release/channel can advance.

No live Firebase rules, existing report records, or bot credentials are replaced.
Rollback: deploy the preceding Worker source and previous verified CRM release
through the authorized release process. Preserve the `WeeklyReportDeliveries`
namespace/receipts; do not delete them or reuse a version. The previous desktop
continues to save reports without invoking this new endpoint.

Verification: desktop/Worker unit suites, canonical access-role denial tests,
parallel duplicate submissions, explicit rejection and ambiguous timeout tests,
real Electron PDF render/visual QA, full CI including Firebase emulator suites,
installer checksum/blockmap/channel probes. Real report delivery is triggered
only by the user's final submission, not by synthetic production test messages.
