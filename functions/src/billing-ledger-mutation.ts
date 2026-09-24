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
  action?: "save" | "return";
  kind: "invoice" | "receipt";
  record: Record<string, unknown>;
  reason?: string;
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
  return typeof value === "string" && ID.test(value)
    && value !== "__proto__" && value !== "prototype" && value !== "constructor";
}

function validRecord(kind: "invoice" | "receipt", value: unknown, stored: boolean): value is Record<string, unknown> {
  if (!isRecord(value) || !validId(value.id)
    || !Number.isSafeInteger(value.amount) || (value.amount as number) <= 0
    || !["draft", "approved", "void"].includes(String(value.status))) return false;
  const allowed = kind === "invoice"
    ? ["id", "contractId", "contractType", "occurrenceId", "billingMonth", "dueDate", "amount", "status", "voidReason"]
    : ["id", "invoiceId", "receivedAt", "amount", "transactionRef", "evidenceRef", "status", "voidReason"];
  const metadata = ["revision", "updatedAt", "updatedBy", "approvedAt", "approvedBy", "voidedAt", "voidedBy", "lastRequestId", "returnPending", "returnHistory"];
  if (Object.keys(value).some(key => !allowed.includes(key) && !metadata.includes(key))) return false;
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
  if (stored && value.returnPending !== undefined && typeof value.returnPending !== "boolean") return false;
  if (stored && value.returnHistory !== undefined) {
    if (!isRecord(value.returnHistory)) return false;
    for (const [requestId, entry] of Object.entries(value.returnHistory)) {
      if (!validId(requestId) || !isRecord(entry)
        || Object.keys(entry).some(key => !["reason", "returnedBy", "returnedAt", "revision"].includes(key))
        || typeof entry.reason !== "string" || entry.reason.trim() !== entry.reason
        || entry.reason.length < 5 || entry.reason.length > 500
        || !validId(entry.returnedBy) || typeof entry.returnedAt !== "string" || !ISO_TIME.test(entry.returnedAt)
        || !Number.isSafeInteger(entry.revision) || (entry.revision as number) < 2) return false;
    }
  }
  return true;
}

function validateStoredLedger(current: unknown): BillingLedger {
  if (current === null || current === undefined) return { invoices: {}, receipts: {} };
  if (auditBillingLedger(current).length > 0 || !isRecord(current)) throw new Error("billing_stored_ledger_invalid");
  const invoices = current.invoices ?? {};
  const receipts = current.receipts ?? {};
  return {
    invoices: invoices as Record<string, Record<string, unknown>>,
    receipts: receipts as Record<string, Record<string, unknown>>,
  };
}

export function auditBillingLedger(current: unknown): string[] {
  if (current === null || current === undefined) return [];
  if (!isRecord(current) || Object.keys(current).some(key => key !== "invoices" && key !== "receipts")) {
    return ["billing_stored_ledger_invalid"];
  }
  const invoices = current.invoices ?? {};
  const receipts = current.receipts ?? {};
  if (!isRecord(invoices) || !isRecord(receipts)) return ["billing_stored_ledger_invalid"];
  const issues = new Set<string>();
  try {
    if (Buffer.byteLength(JSON.stringify(current), "utf8") > MAX_LEDGER_BYTES) issues.add("billing_ledger_too_large");
  } catch {
    return ["billing_stored_ledger_invalid"];
  }
  const invoiceKeys = new Set<string>();
  for (const [id, value] of Object.entries(invoices)) {
    if (!validRecord("invoice", value, true) || value.id !== id) {
      issues.add("billing_stored_ledger_invalid");
      continue;
    }
    if (value.status === "void") continue;
    const key = value.contractType === "one_off"
      ? `one_off:${value.contractId}:${value.occurrenceId}`
      : `regular:${value.contractId}:${value.billingMonth}`;
    if (invoiceKeys.has(key)) issues.add("billing_duplicate_invoice");
    invoiceKeys.add(key);
  }
  const receiptKeys = new Set<string>();
  let invoiceTotal = 0;
  let receiptTotal = 0;
  for (const value of Object.values(invoices)) {
    if (isRecord(value) && value.status === "approved" && Number.isSafeInteger(value.amount)) {
      invoiceTotal += value.amount as number;
    }
  }
  for (const [id, value] of Object.entries(receipts)) {
    if (!validRecord("receipt", value, true) || value.id !== id) {
      issues.add("billing_stored_ledger_invalid");
      continue;
    }
    const linked = invoices[value.invoiceId as string];
    if (!isRecord(linked) || (value.status === "approved" && linked.status !== "approved")) issues.add("billing_orphan_receipt");
    if (value.status !== "approved") continue;
    receiptTotal += value.amount as number;
    const key = `${value.invoiceId}:${value.transactionRef}`;
    if (receiptKeys.has(key)) issues.add("billing_duplicate_transaction");
    receiptKeys.add(key);
  }
  if (!Number.isSafeInteger(invoiceTotal) || !Number.isSafeInteger(receiptTotal)) {
    issues.add("billing_unsafe_total");
  }
  return [...issues].sort();
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
    || ![undefined, "save", "return"].includes(command.action)) throw new Error("billing_invalid_record");
  const id = command.record.id as string;
  const collection = command.kind === "invoice" ? ledger.invoices : ledger.receipts;
  const previous = collection[id];
  if (command.action === "return") {
    if (!validId(id) || Object.keys(command.record).some(key => key !== "id")
      || typeof command.reason !== "string" || command.reason.trim().length < 5
      || command.reason.trim().length > 500) throw new Error("billing_invalid_return");
    if (command.actor.role !== "admin") throw new Error("billing_access_forbidden");
    const reason = command.reason.trim();
    const priorReturn = isRecord(previous?.returnHistory)
      ? previous.returnHistory[command.requestId] : undefined;
    if (priorReturn) {
      if (!isRecord(priorReturn) || priorReturn.reason !== reason
        || priorReturn.returnedBy !== command.actor.uid
        || priorReturn.revision !== command.expectedRevision + 1
        || !Number.isSafeInteger(previous?.revision)
        || (previous.revision as number) < (priorReturn.revision as number)) throw new Error("billing_request_id_conflict");
      return { ledger, record: previous, repeated: true };
    }
    if (!previous || previous.revision !== command.expectedRevision) throw new Error("billing_revision_conflict");
    if (previous.status !== "draft") throw new Error("billing_invalid_transition");
    const revision = command.expectedRevision + 1;
    const record = {
      ...previous, revision, updatedAt: command.now, updatedBy: command.actor.uid,
      lastRequestId: command.requestId, returnPending: true,
      returnHistory: {
        ...(isRecord(previous.returnHistory) ? previous.returnHistory : {}),
        [command.requestId]: { reason, returnedBy: command.actor.uid, returnedAt: command.now, revision },
      },
    };
    collection[id] = record;
    if (Buffer.byteLength(JSON.stringify(ledger), "utf8") > MAX_LEDGER_BYTES) throw new Error("billing_ledger_too_large");
    const issues = auditBillingLedger(ledger);
    if (issues.length > 0) throw new Error(issues[0]);
    return { ledger, record, repeated: false };
  }
  if (!validRecord(command.kind, command.record, false)) throw new Error("billing_invalid_record");
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
  if (previous?.returnPending === true && command.record.status === "approved") {
    throw new Error("billing_return_pending");
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
      if (item.contractId === command.record.contractId
        && (item.contractType ?? "regular") === (command.record.contractType ?? "regular") && (
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
  const substantiveCorrection = previous?.status === "draft" && command.record.status === "draft"
    && fields.some(key => key !== "status" && key !== "voidReason"
      && (previous[key] ?? undefined) !== (command.record[key] ?? undefined));
  const record = {
    ...clientFields,
    ...(previous?.returnHistory !== undefined ? { returnHistory: previous.returnHistory } : {}),
    ...(previous?.returnPending !== undefined ? { returnPending: substantiveCorrection ? false : previous.returnPending } : {}),
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
  const candidateIssues = auditBillingLedger(ledger);
  if (candidateIssues.length > 0) throw new Error(candidateIssues[0]);
  return { ledger, record, repeated: false };
}

export async function transactBillingLedger(
  ref: {
    get: () => Promise<{ val: () => unknown }>;
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
    const initial = (await ref.get()).val();
    let firstCallback = true;
    transaction = await ref.transaction((current) => {
      try {
        // Admin RTDB transactions may first invoke the updater with an empty local cache.
        // The server compares the tentative value and retries with its actual state on conflict.
        const candidate = firstCallback && current == null && initial != null ? initial : current;
        firstCallback = false;
        decision = reduceBillingLedgerMutation(candidate as BillingLedger | null, command);
        rejection = null;
        // Even a replay must be compared with the server to rule out a change
        // between the pre-read and this transaction's first local callback.
        return decision.ledger;
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
  if (!result || !transaction.committed) {
    throw new Error("billing_transaction_unavailable");
  }
  return result;
}
