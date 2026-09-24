import { readFileSync, statSync } from 'node:fs';
import { auditBillingLedger } from '../lib/billing-ledger-mutation.js';

const [backupPath, extra] = process.argv.slice(2);
if (!backupPath || extra) {
  process.stderr.write('billing_audit_usage: node functions/scripts/audit-billing-ledger.mjs <backup.json>\n');
  process.exitCode = 1;
} else {
  try {
    if (statSync(backupPath).size > 8 * 1024 * 1024) throw new Error('billing_audit_file_too_large');
    const snapshot = JSON.parse(readFileSync(backupPath, 'utf8'));
    const issues = auditBillingLedger(snapshot);
    const count = collection => collection && typeof collection === 'object' && !Array.isArray(collection)
      ? Object.keys(collection).length : 0;
    process.stdout.write(`${JSON.stringify({
      ok: issues.length === 0,
      invoiceCount: count(snapshot?.invoices),
      receiptCount: count(snapshot?.receipts),
      issues,
    })}\n`);
    if (issues.length > 0) process.exitCode = 2;
  } catch (error) {
    const code = error?.message === 'billing_audit_file_too_large'
      ? 'billing_audit_file_too_large'
      : error instanceof SyntaxError ? 'billing_audit_invalid_json' : 'billing_audit_file_unavailable';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
