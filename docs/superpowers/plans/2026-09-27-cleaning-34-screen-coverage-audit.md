# BRING Cleaning Center 34-screen coverage audit

Date: 2026-09-27
Reference: `BRING_Cleaning_Center_v1.0_Final_34_Screens` (34 numbered PNGs + index.html)
Purpose: distinguish the approved CRM-integrated MVP from the full aspirational mockup set; this is not a claim of 34-screen parity.

## Status definitions

- **MVP now** — the current CRM branch contains a cleaning-specific flow or integration for the capability; still requires production deployment and real-data verification.
- **Reuse / partial** — an existing CRM module can be opened or linked, but the dedicated cleaning-center experience shown in the mockup is not implemented or not verified end-to-end.
- **Later / absent** — not implemented as a cleaning-specific capability in this delivery. Do not advertise it as available.

## Screen-by-screen audit

| # | Reference screen | Current evidence / disposition |
|---:|---|---|
| 01 | Integrated operations dashboard | **Reuse / partial** — existing CRM TV operations board and the separate cleaning queue summary exist; one unified cleaning command dashboard matching the mockup is not verified. |
| 02 | CTI consultation center | **Later / absent** — CTI is explicitly called out in the CRM Cleaning Center footer as requiring a separate integration. |
| 03 | New inquiry / lead queue | **Reuse / partial** — existing CRM pipeline is linked from the cleaning folder; cleaning-specific intake source/lead SLA behavior is not verified. |
| 04 | Customer 360 | **Reuse / partial** — canonical CRM customer/building IDs and order history are reused; full single-screen cleaning Customer 360 parity is not verified. |
| 05 | Quote calculator | **Reuse / partial** — existing quote authoring and cleaning quote revision/approval flow are linked; mockup calculator, all price formulas and production acceptance are not verified. |
| 06 | Order detail | **MVP now** — read-only detail consolidates intake, customer/building, quote summary, schedule/assignee, linked work orders, result checklist progress and each item’s before/after evidence counts, report notes, and status history; detailed tabs, customer communications, payment history and full edit parity remain later. |
| 07 | Dispatch control tower | **Reuse / partial** — CRM work orders are linked and an assignment summary is shown; automated capacity, offer/accept, dispatch queues and reassignment are absent. |
| 08 | Partner search / recommendation | **Reuse / partial** — existing partner/vendor and partner quote screens are linked; cleaning-specific ranking/recommendation is not verified. |
| 09 | Schedule / map control | **Reuse / partial** — existing internal calendar/building map are linked; a unified cleaning dispatch map and live route plan are absent. Google Calendar integration remains excluded. |
| 10 | Work order | **MVP now** — cleaning order can create/link the existing CRM work order; field use and production persistence remain unverified. |
| 11 | Photo quality review | **MVP now / partial** — linked CRM report checklist and before/after evidence are required by server completion validation; automated photo-quality scoring/triage is absent. |
| 12 | CS / AS center | **Reuse / partial** — existing CRM customer case flow is linked; cleaning-specific warranty, rework SLA and CS dashboard are not verified. |
| 13 | Payments / settlement | **Later / absent for cleaning orders** — existing revenue ledger is a separate CRM capability; cleaning payment, refund, partner settlement and order reconciliation are not connected. |
| 14 | Partner management | **Reuse / partial** — existing CRM partner/vendor records are linked; cleaning onboarding, availability and compliance lifecycle parity are absent. |
| 15 | Analytics | **Reuse / partial** — existing CRM operations intelligence and TV aggregate can be reused; cleaning-specific unit economics and funnel reporting are not verified. |
| 16 | BRING Partner App | **Later / absent** — no dedicated partner mobile app is included. |
| 17 | End-to-end business flow | **MVP now** — server-side cleaning order state machine, authorization and evidence-gated completion are implemented/tested locally; live company deployment is blocked. |
| 18 | System architecture | **MVP now (technical)** — Firebase Functions command boundary, Realtime Database order source, CRM links and TV aggregate are documented/implemented locally; production topology is not yet live. |
| 19 | Database data model | **MVP now (technical)** — canonical customer/building references, order revision/history and linked evidence contracts exist in code/tests; production data migration/validation remains. |
| 20 | Partner work offer | **Later / absent** — no offer/accept workflow. |
| 21 | Vendor decline handling | **Later / absent** — no partner-decline reason and retry workflow. |
| 22 | No-response handling | **Later / absent** — no timed response SLA/escalation engine. |
| 23 | Reassignment | **Later / absent** — no dispatch reassignment workflow. |
| 24 | Order cancellation | **MVP now / partial** — cancel state and audited server transition exist; customer cancellation UX, fee policy and downstream settlement handling are not parity-complete. |
| 25 | Partial refund | **Later / absent** — no cleaning refund ledger or partial-refund authorization. |
| 26 | Rework request | **MVP now / partial** — revision-request state and editable report lifecycle exist; customer-facing rework SLA and dispatch loop are not implemented. |
| 27 | New partner registration | **Reuse / partial** — existing CRM partner/vendor registration can be opened; cleaning eligibility checks and onboarding approvals are not verified. |
| 28 | Pricing policy settings | **Later / absent** — no dedicated cleaning service-area/size/add-on price-policy administration. |
| 29 | Employee permissions | **Reuse / partial** — existing CRM roles and server authorization are used; cleaning-specific role matrix and least-privilege production test remain. |
| 30 | Customer SMS sending | **Later / absent for cleaning automation** — existing CRM notice capability may be reused; no cleaning-triggered outbound message is implemented. |
| 31 | Consultation booking | **Reuse / partial** — existing CRM consultation records are linked; dedicated cleaning booking calendar/form parity is not verified. |
| 32 | Extra-charge approval | **Later / absent** — no additional-charge request/review flow. |
| 33 | Delay / no-show response | **Later / absent** — no delay/no-show reason, customer notice or auto-escalation flow. |
| 34 | Settlement finalization / payout | **Later / absent** — no partner payout finalization integrated with cleaning orders. |

## Release conclusion

The approved delivery is an **integrated CRM MVP**, not the complete 34-screen standalone cleaning SaaS. The current code covers the shared CRM order-to-work/report flow, server-enforced evidence review and privacy-safe TV aggregate at implementation/test level. The existing CRM modules listed above are reused instead of duplicated. CTI, Partner App, automated dispatch, cleaning payment/refund/payout, pricing policy, SMS automation and operational exception automation remain separately scoped work.

No production deployment, company customer/order data entry or physical TV validation is proven by this audit. `release/firebase-targets.json` currently sets `functionsDeploymentAllowed: false` and archives `cleaningOrdersApi` plus `projectCleaningOrdersToWallboard`; a separate approved release action is required before tomorrow's live use can be claimed.
