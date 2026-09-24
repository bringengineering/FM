import { describe, expect, it } from "vitest";

import { auditBillingLedger, authorizeBillingActor, reduceBillingLedgerMutation, transactBillingLedger } from "../src/billing-ledger-mutation.js";

const NOW = "2026-09-25T00:00:00.000Z";
const invoice = {
  id: "invoice-1",
  contractId: "contract-1",
  contractType: "regular" as const,
  billingMonth: "2026-09",
  dueDate: "2026-09-30",
  amount: 100000,
  status: "draft" as const,
};

describe("atomic billing ledger mutation", () => {
  it("creates one draft and replays the same request without increasing revision", () => {
    const command = {
      kind: "invoice" as const,
      record: invoice,
      expectedRevision: 0,
      requestId: "request-1",
      actor: { uid: "member-1", role: "member" as const },
      now: NOW,
    };
    const created = reduceBillingLedgerMutation(null, command);
    expect(created.record).toMatchObject({ ...invoice, revision: 1, updatedBy: "member-1", lastRequestId: "request-1" });
    const replay = reduceBillingLedgerMutation(created.ledger, command);
    expect(replay.repeated).toBe(true);
    expect(replay.record).toEqual(created.record);
    expect(replay.ledger).toEqual(created.ledger);
  });

  it("rejects an invoice with the same regular-contract month under a different id", () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    expect(() => reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: { ...invoice, id: "invoice-2" }, expectedRevision: 0,
      requestId: "request-2", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_duplicate_invoice");
  });

  it("treats an older invoice without contractType as regular for duplicate detection", () => {
    const legacy = { ...invoice, revision: 1, updatedAt: NOW, updatedBy: "member-1" };
    const { contractType: _omitted, ...withoutType } = legacy;
    expect(() => reduceBillingLedgerMutation({ invoices: { [invoice.id]: withoutType }, receipts: {} }, {
      kind: "invoice", record: { ...invoice, id: "invoice-2" }, expectedRevision: 0,
      requestId: "request-2", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_duplicate_invoice");
  });

  it("rejects a mutation that would make approved totals unsafe", () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: { ...invoice, amount: Number.MAX_SAFE_INTEGER - 1 }, expectedRevision: 0,
      requestId: "request-1", actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    const approved = reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: { ...invoice, amount: Number.MAX_SAFE_INTEGER - 1, status: "approved" }, expectedRevision: 1,
      requestId: "request-2", actor: { uid: "admin-1", role: "admin" }, now: NOW,
    });
    const second = reduceBillingLedgerMutation(approved.ledger, {
      kind: "invoice", record: { ...invoice, id: "invoice-2", billingMonth: "2026-10", amount: 2 },
      expectedRevision: 0, requestId: "request-3", actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    expect(() => reduceBillingLedgerMutation(second.ledger, {
      kind: "invoice", record: { ...invoice, id: "invoice-2", billingMonth: "2026-10", amount: 2, status: "approved" },
      expectedRevision: 1, requestId: "request-4", actor: { uid: "admin-1", role: "admin" }, now: NOW,
    })).toThrowError("billing_unsafe_total");
  });

  it("rejects a stale revision and a member approval", () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    expect(() => reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-2",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_revision_conflict");
    expect(() => reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: { ...invoice, status: "approved" }, expectedRevision: 1,
      requestId: "request-3", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_access_forbidden");
  });

  it("approves an invoice with server-owned approval metadata", () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    const approved = reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: { ...invoice, status: "approved", approvedBy: "attacker" },
      expectedRevision: 1, requestId: "request-2",
      actor: { uid: "admin-1", role: "admin" }, now: NOW,
    });
    expect(approved.record).toMatchObject({ status: "approved", approvedBy: "admin-1", approvedAt: NOW, revision: 2 });
  });

  it("rejects an approved receipt without an approved invoice", () => {
    expect(() => reduceBillingLedgerMutation(null, {
      kind: "receipt", record: {
        id: "receipt-1", invoiceId: invoice.id, receivedAt: "2026-09-25", amount: 30000,
        transactionRef: "bank-1", evidenceRef: "proof-1", status: "approved",
      }, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "admin-1", role: "admin" }, now: NOW,
    })).toThrowError("billing_invoice_not_approved");
  });

  it("rejects voiding an invoice linked to an approved receipt", () => {
    const approvedInvoice = { ...invoice, status: "approved", revision: 1, approvedAt: NOW, approvedBy: "admin-1", updatedAt: NOW, updatedBy: "admin-1" };
    const approvedReceipt = {
      id: "receipt-1", invoiceId: invoice.id, receivedAt: "2026-09-25", amount: 30000,
      transactionRef: "bank-1", evidenceRef: "proof-1", status: "approved", revision: 1,
      approvedAt: NOW, approvedBy: "admin-1", updatedAt: NOW, updatedBy: "admin-1",
    };
    expect(() => reduceBillingLedgerMutation({ invoices: { [invoice.id]: approvedInvoice }, receipts: { "receipt-1": approvedReceipt } }, {
      kind: "invoice", record: { ...invoice, status: "void", voidReason: "mistake" },
      expectedRevision: 1, requestId: "request-2",
      actor: { uid: "admin-1", role: "admin" }, now: NOW,
    })).toThrowError("billing_invoice_has_receipts");
  });

  it("rejects a duplicate approved receipt transaction reference", () => {
    const approvedInvoice = { ...invoice, status: "approved", revision: 1, approvedAt: NOW, approvedBy: "admin-1", updatedAt: NOW, updatedBy: "admin-1" };
    const existingReceipt = {
      id: "receipt-1", invoiceId: invoice.id, receivedAt: "2026-09-25", amount: 30000,
      transactionRef: "bank-1", evidenceRef: "proof-1", status: "approved", revision: 1,
      approvedAt: NOW, approvedBy: "admin-1", updatedAt: NOW, updatedBy: "admin-1",
    };
    expect(() => reduceBillingLedgerMutation({ invoices: { [invoice.id]: approvedInvoice }, receipts: { "receipt-1": existingReceipt } }, {
      kind: "receipt", record: { ...existingReceipt, id: "receipt-2", revision: undefined },
      expectedRevision: 0, requestId: "request-2",
      actor: { uid: "admin-1", role: "admin" }, now: NOW,
    })).toThrowError("billing_duplicate_transaction");
  });

  it("does not allow a draft to move directly to void", () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    expect(() => reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: { ...invoice, status: "void", voidReason: "cancel" },
      expectedRevision: 1, requestId: "request-2",
      actor: { uid: "admin-1", role: "admin" }, now: NOW,
    })).toThrowError("billing_invalid_transition");
  });

  it("does not let an approved invoice amount change during void", () => {
    const approved = { ...invoice, status: "approved", revision: 1, approvedAt: NOW, approvedBy: "admin-1", updatedAt: NOW, updatedBy: "admin-1" };
    expect(() => reduceBillingLedgerMutation({ invoices: { [invoice.id]: approved }, receipts: {} }, {
      kind: "invoice", record: { ...invoice, amount: 1, status: "void", voidReason: "cancel" },
      expectedRevision: 1, requestId: "request-2",
      actor: { uid: "admin-1", role: "admin" }, now: NOW,
    })).toThrowError("billing_approved_immutable");
  });

  it("rejects malformed money and impossible dates", () => {
    expect(() => reduceBillingLedgerMutation(null, {
      kind: "invoice", record: { ...invoice, amount: Number.MAX_SAFE_INTEGER + 1 },
      expectedRevision: 0, requestId: "request-1", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_invalid_record");
    expect(() => reduceBillingLedgerMutation(null, {
      kind: "invoice", record: { ...invoice, dueDate: "2026-02-30" },
      expectedRevision: 0, requestId: "request-1", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_invalid_record");
  });

  it("fails closed on malformed stored ledger entries", () => {
    expect(() => reduceBillingLedgerMutation({ invoices: { broken: { amount: -10 } }, receipts: {} }, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_stored_ledger_invalid");
  });

  it("rejects reuse of a request id with changed business fields", () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    expect(() => reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: { ...invoice, amount: 1 }, expectedRevision: 0,
      requestId: "request-1", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_request_id_conflict");
    expect(() => reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: invoice, expectedRevision: 0,
      requestId: "request-1", actor: { uid: "viewer-1", role: "viewer" }, now: NOW,
    })).toThrowError("billing_access_forbidden");
  });

  it("rejects duplicate one-off occurrence even when its billing month changed", () => {
    const oneOff = { ...invoice, contractType: "one_off" as const, occurrenceId: "visit-1" };
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: oneOff, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    expect(() => reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: { ...oneOff, id: "invoice-2", billingMonth: "2026-10" },
      expectedRevision: 0, requestId: "request-2", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_duplicate_invoice");
  });

  it("runs mutation against the transaction's current ledger and returns only committed state", async () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    let transactionSawCurrent = false;
    const ref = {
      async get() { return { val: () => null }; },
      async transaction(update: (value: unknown) => unknown) {
        const next = update(first.ledger);
        transactionSawCurrent = true;
        return { committed: next !== undefined };
      },
    };
    await expect(transactBillingLedger(ref, {
      kind: "invoice", record: { ...invoice, amount: 120000 }, expectedRevision: 1,
      requestId: "request-2", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).resolves.toMatchObject({ record: { amount: 120000, revision: 2 } });
    expect(transactionSawCurrent).toBe(true);
  });

  it("uses the server pre-read when the Admin SDK starts a transaction from an empty local cache", async () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    const ref = {
      async get() { return { val: () => first.ledger }; },
      async transaction(update: (value: unknown) => unknown) {
        const next = update(null);
        expect(next).toMatchObject({ invoices: { [invoice.id]: { amount: 120000, revision: 2 } } });
        return { committed: next !== undefined };
      },
    };
    await expect(transactBillingLedger(ref, {
      kind: "invoice", record: { ...invoice, amount: 120000 }, expectedRevision: 1,
      requestId: "request-2", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).resolves.toMatchObject({ record: { amount: 120000, revision: 2 } });
  });

  it("does not reuse the pre-read after a concurrent server change forces a retry", async () => {
    const first = reduceBillingLedgerMutation(null, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    });
    const newer = reduceBillingLedgerMutation(first.ledger, {
      kind: "invoice", record: { ...invoice, amount: 110000 }, expectedRevision: 1,
      requestId: "request-other", actor: { uid: "member-2", role: "member" }, now: NOW,
    });
    const ref = {
      async get() { return { val: () => first.ledger }; },
      async transaction(update: (value: unknown) => unknown) {
        expect(update(null)).not.toBeUndefined();
        expect(update(newer.ledger)).toBeUndefined();
        return { committed: false };
      },
    };
    await expect(transactBillingLedger(ref, {
      kind: "invoice", record: { ...invoice, amount: 120000 }, expectedRevision: 1,
      requestId: "request-2", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).rejects.toThrowError("billing_revision_conflict");
  });

  it("does not report success if the database transaction aborts", async () => {
    const ref = {
      async get() { return { val: () => null }; },
      async transaction(_update: (value: unknown) => unknown) { return { committed: false }; },
    };
    await expect(transactBillingLedger(ref, {
      kind: "invoice", record: invoice, expectedRevision: 0, requestId: "request-1",
      actor: { uid: "member-1", role: "member" }, now: NOW,
    })).rejects.toThrowError("billing_transaction_unavailable");
  });

  it("accepts only an enabled verified company staff account", () => {
    const token = { uid: "member-1", email: "member@bringcare.kr", emailVerified: true };
    const access = { enabled: true, email: "member@bringcare.kr", role: "member" };
    expect(authorizeBillingActor(token, access)).toEqual({ uid: "member-1", role: "member" });
    expect(() => authorizeBillingActor(token, { ...access, marketingRole: "marketing" })).toThrowError("billing_access_forbidden");
    expect(() => authorizeBillingActor(token, { ...access, mustChangePassword: true })).toThrowError("billing_access_forbidden");
    expect(() => authorizeBillingActor(token, { ...access, email: "other@bringcare.kr" })).toThrowError("billing_access_forbidden");
    expect(() => authorizeBillingActor({ ...token, emailVerified: false }, access)).toThrowError("billing_auth_required");
  });

  it("audits historical duplicate invoices without changing stored records", () => {
    const i1 = { ...invoice, id: "invoice-1", revision: 1, updatedAt: NOW, updatedBy: "member-1" };
    const i2 = { ...i1, id: "invoice-2" };
    const ledger = { invoices: { "invoice-1": i1, "invoice-2": i2 }, receipts: {} };
    const before = JSON.stringify(ledger);
    expect(auditBillingLedger(ledger)).toContain("billing_duplicate_invoice");
    expect(JSON.stringify(ledger)).toBe(before);
    expect(() => reduceBillingLedgerMutation(ledger, {
      kind: "invoice", record: { ...invoice, id: "invoice-3", contractId: "contract-2" },
      expectedRevision: 0, requestId: "request-3", actor: { uid: "member-1", role: "member" }, now: NOW,
    })).toThrowError("billing_stored_ledger_invalid");
  });

  it("audits orphan receipts and duplicate transaction references", () => {
    const approved = { ...invoice, status: "approved", revision: 1, updatedAt: NOW, updatedBy: "admin-1", approvedAt: NOW, approvedBy: "admin-1" };
    const receipt = { id: "r1", invoiceId: invoice.id, receivedAt: "2026-09-25", amount: 10, transactionRef: "bank-1", evidenceRef: "proof", status: "approved", revision: 1, updatedAt: NOW, updatedBy: "admin-1", approvedAt: NOW, approvedBy: "admin-1" };
    expect(auditBillingLedger({ invoices: { [invoice.id]: approved }, receipts: { r1: receipt, r2: { ...receipt, id: "r2" }, r3: { ...receipt, id: "r3", invoiceId: "missing" } } }))
      .toEqual(expect.arrayContaining(["billing_duplicate_transaction", "billing_orphan_receipt"]));
  });

  it("rejects object prototype keys as billing record ids", () => {
    for (const id of ["__proto__", "prototype", "constructor"]) {
      expect(() => reduceBillingLedgerMutation(null, {
        kind: "invoice", record: { ...invoice, id }, expectedRevision: 0,
        requestId: "request-1", actor: { uid: "member-1", role: "member" }, now: NOW,
      })).toThrowError("billing_invalid_record");
    }
  });
});
