# Cleaning extra charge approval request

## Goal

Implement reference screen 32 as an auditable cleaning-order flow for requesting customer approval of an extra service charge. A request must never become a charge or enter settlement before customer approval is recorded.

## User flow

An authorized office admin opens the extra-charge form from the linked cleaning order. The form shows canonical order, customer, partner and current service details; accepts an extra-service category, integer KRW amount, reason, and at most five real work photos uploaded to the authenticated company Drive; then records an approval request. The request shows its current state, creation time and communication result in the order history.

Customer contact uses the existing customer-message delivery service and its allow-listed, configured template mechanism. Missing template configuration, missing customer channel consent where required by policy, or provider rejection leaves the request in a not-sent state and never claims delivery. The CRM must not mark a request sent merely because an SMS compose UI was opened.

After customer approval arrives through an out-of-band customer response, an authorized admin may record approval only with a required evidence reference and the received time. A decline likewise requires an evidence reference. Neither path performs a payment capture or changes the canonical invoice; that remains a separate approved payment workflow.

## Data and authorization

- Store requests in a dedicated canonical Firebase collection keyed by order and request ID; keep append-only status events and optimistic revision checks.
- Validate order, customer, building and accepted partner against canonical CRM records on the server.
- Require admin authorization to create/send/review requests. Only read authenticated customer contact from the linked canonical customer record.
- Require a bounded positive whole-KRW amount, bounded reason, allow-listed service category, and up to five Drive file IDs created by the authorized desktop upload action.
- Prevent recording approval against a request that was never created or was already resolved; reject stale revisions.
- Keep customer approval separate from provider SMS acceptance and from invoice/payment state.

## UI and failure handling

Match the supplied modal layout and status treatment. Show exact order context, service, amount, reason, evidence, approval state, communication state and event history. Disable actions while submitting. Display template/consent/provider failures as unsent or failed; never use a success label on failure. Mask contact information outside the authorized form.

## Verification

Use unit tests for validation and lifecycle transitions, adapter tests for transactional persistence and revision conflicts, endpoint tests for authorization/shape validation, UI tests for the reference fields and pending/sent/failed states, and the existing customer-message policy tests for configured sending. Verify a successful request does not modify invoice or payment records.

## Known scope boundary

This feature records manually confirmed customer decisions with evidence; it does not ingest SMS replies automatically, charge the customer, or settle the partner. Real delivery requires the configured approved message template and provider credentials already used by the company message service.
