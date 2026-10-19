# Company morning Telegram digest

The gateway runs `0 21 * * *` in UTC, which is 06:00 the following day in
Asia/Seoul. This trigger is independent of the five-minute TV refresh and of all
desktop sessions. It reads only `bring-fm` company `data/serviceRecords`,
`data/contracts` and `data/buildings`.

The message includes today's calendar work (including contract-derived cleaning
visits) and contracts whose receipt date is today. Monthly/yearly receipt dates
and date-specific paid status follow the CRM calendar. Moved/cancelled work is
not re-created. Empty sections are omitted; if both are empty, Telegram is not
called. Long summaries split between complete rows, keeping all entries.

## Server credentials

- Reuse `WEEKLY_REPORT_TELEGRAM_BOT_TOKEN` and
  `WEEKLY_REPORT_TELEGRAM_CHAT_ID`, which already identify the company work room.
  The renderer cannot choose the daily destination.
- Source reads can use the existing dedicated `WALLBOARD_READER_UID`,
  `WALLBOARD_READER_REFRESH_TOKEN` and `FIREBASE_WEB_API_KEY`, if configured.
  The returned token must identify `bring-fm`. The account must already be
  allowed to read **all three** source collections; the TV-only reader grant is
  insufficient for contracts/buildings. A denied read aborts the whole digest.
- Otherwise use the existing authorized `bring-fm` service account through
  `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` or the
  dedicated `TELEGRAM_CRM_SERVICE_ACCOUNT_EMAIL` /
  `TELEGRAM_CRM_SERVICE_ACCOUNT_PRIVATE_KEY` secrets. A complete dedicated
  pair takes precedence; identities are never silently escalated after a denied
  read. Only fixed Google HTTPS
  token and Firebase GET destinations are used, with bounded bodies/timeouts
  and no redirects. No new IAM grant, Firebase rule, or credential is created.
- Never put any token/private key into source, plaintext settings, chat, CI
  output, or the installer. Use the platform secret store. The release takes
  `WALLBOARD_READER_UID` from its repository configuration and stores it with
  the Worker secrets, alongside the existing refresh token. No new user,
  password, service-account key, or CRM role is created.
- Health's `morningTelegram` requires a successful read/projection of all three
  live source collections through the private Durable Object. The result is
  cached for one minute and exposes only a boolean. It never sends Telegram,
  creates delivery receipts, or returns source rows.

The approved rules delta adds the existing enabled/email-matched, verified
server-reader condition only at `data/contracts/.read` and
`data/buildings/.read`. Parent reads, unrelated paths, CRM roles and every write
rule remain unchanged. Back up and compare the complete live `bring-fm` rules
before applying the delta; run the full database/storage emulator suite.

## Delivery safety

`TelegramMorningJobs` is a private Durable Object with no public HTTP route.
One queue/receipt per company day prevents duplicate cron invocations and PC
duplicates in the new client. Persist the sending claim **before** Telegram.
Uncertain/crashed sends stay blocked rather than being retried automatically.
Only counts, a hash, part numbers and timestamps remain in receipts; message
bodies and source rows are not retained or logged.

The desktop no longer sends automatically on startup, render or a timer. Its
old automatic-slot IPC is refused. Local encrypted settings remain available
only for explicitly requested manual contact/directive notifications.

## Activation and rollback

Deployment still requires user authorization and the repository's version
reservation, full-test, installer, release and update-channel sequence. Before
activation, confirm the company Cloudflare account, existing Telegram secrets,
and successful read-only access to all three `bring-fm` source paths. A key's
presence alone is not evidence that the reader has permission.

Update all PCs (or turn off the old client's local automatic contact alerts)
when enabling `TELEGRAM_MORNING_ENABLED`; old installed versions still know
their own local bot settings. Do not rotate/delete the bot key as a workaround.

Rollback: set `TELEGRAM_MORNING_ENABLED=false` through the authorized deployment
process and restore the preceding Worker/client release. Preserve the durable
receipts and namespace so uncertain deliveries cannot be replayed. No Firebase
billing-plan upgrade, live rule change, or production test message is required
by the Worker deployment itself. The separately authorized two-path rules delta
can be rolled back through `crm-rules-deploy.yml` with the immutable backup
baseline SHA; verify the full live rules hash after restoring it.
