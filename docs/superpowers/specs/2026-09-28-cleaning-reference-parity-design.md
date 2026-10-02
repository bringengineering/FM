# Cleaning reference screen parity — finance and delay workflows

## Goal

Bring reference screens 13 (payments and settlement), 25 (partial refund), 33 (delay/no-show response), and 34 (settlement finalization) into the existing BRING CRM Cleaning Center while retaining canonical CRM records and authorization. The original screenshots are the visual reference; synthetic values must never be presented as live company data.

## Screen design

- **Payments and settlement (#13):** replace the compact billing list with the reference's date toolbar, four summary cards, customer payment detail column, and partner settlement column. Only linked CRM invoices and approved receipts contribute to totals. Partner payout, PG fees, and contribution margin show a clear unavailable state until canonical source records exist. Tabs route among customer payments, partner settlement, refunds, and unpaid items using existing CRM records.
- **Partial refund (#25):** use the reference hierarchy: warning, order/customer/payment summary, refundable balance, partial/full radio choice, amount, original payment method when known, reason and CS reference, after-refund balance, internal note, audit history, and cancel/save footer. Preview values recalculate from the entered amount. Requests reserve paid funds; approval and external execution evidence retain the existing separate server transitions. No payment provider is called.
- **Delay/no-show (#33):** reproduce the red incident summary, three situation cards, three immediate-action controls, response memo, SLA/status area, and vertical incident/action history. Display only recorded ETA, location, and times. Where the CRM has no arrival timestamp, coordinates, or approved SLA threshold, show “확인 정보 없음” or “기준 미설정” rather than deriving fictional values. Action buttons record that an operator performed an action; they do not send SMS or place calls. Emergency reassignment still uses the existing guarded workflow.
- **Settlement finalization (#34):** provide the reference-shaped review and pre-payment checklist only when supplier settlement facts exist. Until bank verification, tax invoice, CS hold, and payable-ledger records are connected, show a blocked/unavailable state and disable payment confirmation. Do not create synthetic payment data or a payout mutation.

## Data and authorization

Keep cleaning order IDs as the join key. Payment totals come from approved invoices/receipts; refund availability is paid amount less non-declined reservations. Admin role remains mandatory for refund and delay mutations. Partner settlement remains read-only/unavailable until its canonical data source and server authorization are implemented.

## Validation

Add rendering and interaction tests before implementation, verify refund preview arithmetic, guard status transitions and permissions, run the focused CRM and Functions tests, run the full suites and type check, and capture the packaged local-only CRM screen for visual comparison. The local review package must remain isolated from production data.
