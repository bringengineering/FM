export type BillingActor = { uid: string; role: "admin" | "member" | "viewer" };

export function authorizeBillingActor(
  token: { uid: unknown; email: unknown; emailVerified: unknown },
  access: unknown,
): BillingActor {
  if (!validId(token.uid) || typeof token.email !== "string" || !token.email.trim()
    || token.emailVerified !== true) throw new Error("billing_auth_required");
  if (!isRecord(access) || access.enabled !== true || access.mustChangePassword === true
    || access.email !== token.email || (access.role !== "admin" && access.role !== "member")
    || (access.role === "member" && access.marketingRole === "marketing")) {
    throw new Error("billing_access_forbidden");
  }
  return { uid: token.uid, role: access.role };
}

export type BillingMutationCommand = {
  kind: "invoice" | "receipt";
  record: Record<string, unknown>;
  expectedRevision: number;
  requestId: string;
  actor: BillingActor;
  now: string;
};

export type BillingLedger = {
  invoices: Record<string, Record<string, unknown>>;
  receipts: Record<string, Record<string, unknown>>;
};

export type BillingMutationResult = {
  ledger: BillingLedger;
  record: Record<string, unknown>;
  repeated: boolean;
};

const ID = /^[A-Za-z0-9_-]{1,150}$/u;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_LEDGER_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function validRecord(kind: "invoice" | "receipt", value: unknown, stored: boolean): value is Record<string, unknown> {
  if (!isRecord(value) || !validId(value.id)
    || !Number.isSafeInteger(value.amount) || (value.amount as number) <= 0
    || !["draft", "approved", "void"].includes(String(value.status))) return false;
  if (kind === "invoice") {
    if (!validId(value.contractId) || !validMonth(value.billingMonth) || !validDate(value.dueDate)) return false;
    if (value.contractType !== undefined && value.contractType !== "regular" && value.contractType !== "one_off") return false;
    if (value.contractType === "one_off" && !validId(value.occurrenceId)) return false;
    if (value.occurrenceId !== undefined && (value.contractType !== "one_off" || !validId(value.occurrenceId))) return false;
  } else {
    if (!validId(value.invoiceId) || !validDate(value.receivedAt)
      || typeof value.transactionRef !== "string" || value.transactionRef.length > 160
      || typeof value.evidenceRef !== "string" || value.evidenceRef.length > 500) return false;
    if (value.status === "approved" && (!value.transactionRef.trim() || !value.evidenceRef.trim())) return false;
  }
  if (value.status === "void" && (typeof value.voidReason !== "string" || !value.voidReason.trim() || value.voidReason.length > 500)) return false;
  if (stored && (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !validId(value.updatedBy) || typeof value.updatedAt !== "string" || !ISO_TIME.test(value.updatedAt))) return false;
  if (stored && (value.status === "approved" || value.status === "void")
    && (!validId(value.approvedBy) || typeof value.approvedAt !== "string" || !ISO_TIME.test(value.approvedAt))) return false;
  if (stored && value.status === "void"
    && (!validId(value.voidedBy) || typeof value.voidedAt !== "string" || !ISO_TIME.test(value.voidedAt))) return false;
  if (stored && value.lastRequestId !== undefined && !validId(value.lastRequestId)) return false;
  return true;
}

function validateStoredLedger(current: unknown): BillingLedger {
  if (current === null || current === undefined) return { invoices: {}, receipts: {} };
  if (!isRecord(current) || Object.keys(current).some(key => key !== "invoices" && key !== "receipts")) {
    throw new Error("billing_stored_ledger_invalid");
  }
  const invoices = current.invoices ?? {};
  const receipts = current.receipts ?? {};
  if (!isRecord(invoices) || !isRecord(receipts)) throw new Error("billing_stored_ledger_invalid");
  for (const [id, value] of Object.entries(invoices)) {
    if (!validRecord("invoice", value, true) || value.id !== id) throw new Error("billing_stored_ledger_invalid");
  }
  for (const [id, value] of Object.entries(receipts)) {
    if (!validRecord("receipt", value, true) || value.id !== id) throw new Error("billing_stored_ledger_invalid");
  }
  return {
    invoices: invoices as Record<string, Record<string, unknown>>,
    receipts: receipts as Record<string, Record<string, unknown>>,
  };
}

export function reduceBillingLedgerMutation(
  current: BillingLedger | null,
  command: BillingMutationCommand,
): BillingMutationResult {
  const stored = validateStoredLedger(current);
  const ledger: BillingLedger = {
    invoices: { ...stored.invoices },
    receipts: { ...stored.receipts },
  };
  if (!validId(command.requestId) || !validId(command.actor.uid)
    || !ISO_TIME.test(command.now) || !Number.isSafeInteger(command.expectedRevision)
    || command.expectedRevision < 0 || !["invoice", "receipt"].includes(command.kind)
    || !validRecord(command.kind, command.record, false)) throw new Error("billing_invalid_record");
  const id = command.record.id as string;
  const collection = command.kind === "invoice" ? ledger.invoices : ledger.receipts;
  const previous = collection[id];
  if (previous?.lastRequestId === command.requestId) {
    if (command.actor.role === "viewer" || (command.record.status !== "draft" && command.actor.role !== "admin")
      || previous.updatedBy !== command.actor.uid) throw new Error("billing_access_forbidden");
    const businessFields = command.kind === "invoice"
      ? ["id", "contractId", "contractType", "occurrenceId", "billingMonth", "dueDate", "amount", "status", "voidReason"]
      : ["id", "invoiceId", "receivedAt", "amount", "transactionRef", "evidenceRef", "status", "voidReason"];
    if (previous.revision !== command.expectedRevision + 1
      || businessFields.some(key => (previous[key] ?? undefined) !== (command.record[key] ?? undefined))) {
      throw new Error("billing_request_id_conflict");
    }
    return { ledger, record: previous, repeated: true };
  }
  if ((previous?.revision ?? 0) !== command.expectedRevision) {
    throw new Error("billing_revision_conflict");
  }
  if ((previous === undefined && command.record.status !== "draft" && !(command.kind === "receipt" && command.record.status === "approved"))
    || (previous !== undefined && (previous.status === "void"
      || (previous.status === "approved" && command.record.status !== "void")
      || (previous.status === "draft" && command.record.status === "void")))) {
    throw new Error("billing_invalid_transition");
  }
  if (command.actor.role === "viewer" || (command.record.status !== "draft" && command.actor.role !== "admin")) {
    throw new Error("billing_access_forbidden");
  }
  if (previous) {
    const fixed = command.kind === "invoice"
      ? ["id", "contractId", "contractType", "occurrenceId"]
      : ["id", "invoiceId"];
    if (fixed.some(key => (previous[key] ?? undefined) !== (command.record[key] ?? undefined))) {
      throw new Error("billing_approved_immutable");
    }
    if (previous.status === "approved") {
      const immutable = command.kind === "invoice"
        ? ["amount", "billingMonth", "dueDate"]
        : ["amount", "receivedAt", "transactionRef", "evidenceRef"];
      if (immutable.some(key => previous[key] !== command.record[key])) throw new Error("billing_approved_immutable");
    }
  }
  if (command.kind === "receipt" && command.record.status === "approved") {
    const linked = ledger.invoices[String(command.record.invoiceId ?? "")];
    if (linked?.status !== "approved") throw new Error("billing_invoice_not_approved");
    if (Object.values(ledger.receipts).some(item => item.id !== id && item.status === "approved"
      && item.invoiceId === command.record.invoiceId && item.transactionRef === command.record.transactionRef)) {
      throw new Error("billing_duplicate_transaction");
    }
  }
  if (command.kind === "invoice" && command.record.status === "void") {
    if (Object.values(ledger.receipts).some(item => item.invoiceId === id && item.status === "approved")) {
      throw new Error("billing_invoice_has_receipts");
    }
  }
  if (command.kind === "invoice" && command.record.status !== "void") {
    for (const item of Object.values(ledger.invoices)) {
      if (item.id === id || item.status === "void") continue;
      if (item.contractId === command.record.contractId && item.contractType === command.record.contractType && (
        command.record.contractType === "one_off"
          ? item.occurrenceId === command.record.occurrenceId
          : item.billingMonth === command.record.billingMonth
      )) throw new Error("billing_duplicate_invoice");
    }
  }
  const fields = command.kind === "invoice"
    ? ["id", "contractId", "contractType", "occurrenceId", "billingMonth", "dueDate", "amount", "status", "voidReason"]
    : ["id", "invoiceId", "receivedAt", "amount", "transactionRef", "evidenceRef", "status", "voidReason"];
  const clientFields = Object.fromEntries(fields.filter(key => command.record[key] !== undefined).map(key => [key, command.record[key]]));
  const record = {
    ...clientFields,
    revision: command.expectedRevision + 1,
    updatedAt: command.now,
    updatedBy: command.actor.uid,
    lastRequestId: command.requestId,
    ...(command.record.status === "approved" ? { approvedAt: command.now, approvedBy: command.actor.uid } : {}),
    ...(command.record.status === "void" ? {
      approvedAt: previous?.approvedAt,
      approvedBy: previous?.approvedBy,
      voidedAt: command.now,
      voidedBy: command.actor.uid,
    } : {}),
  };
  collection[id] = record;
  if (Buffer.byteLength(JSON.stringify(ledger), "utf8") > MAX_LEDGER_BYTES) {
    throw new Error("billing_ledger_too_large");
  }
  return { ledger, record, repeated: false };
}

export async function transactBillingLedger(
  ref: {
    transaction: (
      update: (value: unknown) => unknown,
      onComplete?: undefined,
      applyLocally?: boolean,
    ) => Promise<{ committed: boolean }>;
  },
  command: BillingMutationCommand,
): Promise<BillingMutationResult> {
  let decision: BillingMutationResult | null = null;
  let rejection: unknown = null;
  let transaction: { committed: boolean };
  try {
    transaction = await ref.transaction((current) => {
      try {
        decision = reduceBillingLedgerMutation(current as BillingLedger | null, command);
        rejection = null;
        return decision.repeated ? undefined : decision.ledger;
      } catch (error) {
        decision = null;
        rejection = error;
        return undefined;
      }
    }, undefined, false);
  } catch {
    throw new Error("billing_transaction_unavailable");
  }
  if (rejection) throw rejection;
  const result = decision as BillingMutationResult | null;
  if (!result || (!result.repeated && !transaction.committed)) {
    throw new Error("billing_transaction_unavailable");
  }
  return result;
}
