import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { readBoundedRegularFile } from '../scripts/read-billing-backup.mjs';

const directory = mkdtempSync(join(tmpdir(), 'bring-billing-audit-'));
const cli = fileURLToPath(new URL('../scripts/audit-billing-ledger.mjs', import.meta.url));
after(() => rmSync(directory, { recursive: true, force: true }));

function runSnapshot(name, snapshot) {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(snapshot), 'utf8');
  return spawnSync(process.execPath, [cli, path], { encoding: 'utf8' });
}

test('reports an empty ledger as clean without modifying its backup', () => {
  const input = { invoices: {}, receipts: {} };
  const result = runSnapshot('empty.json', input);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true, invoiceCount: 0, receiptCount: 0, issues: [],
  });
  assert.equal(readFileSync(join(directory, 'empty.json'), 'utf8'), JSON.stringify(input));
});

test('reports issue codes without printing private record contents', () => {
  const now = '2026-09-25T00:00:00.000Z';
  const invoice = {
    id: 'invoice-1', contractId: 'contract-1', contractType: 'regular',
    billingMonth: '2026-09', dueDate: '2026-09-30', amount: 100000,
    status: 'draft', revision: 1, updatedAt: now, updatedBy: 'member-1',
  };
  const result = runSnapshot('duplicate.json', {
    invoices: { 'invoice-1': invoice, 'invoice-2': { ...invoice, id: 'invoice-2' } },
    receipts: {},
  });
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false, invoiceCount: 2, receiptCount: 0,
    issues: ['billing_duplicate_invoice'],
  });
  assert.equal(result.stdout.includes('contract-1'), false);
  assert.equal(result.stderr.includes('contract-1'), false);
});

test('fails closed when no backup file is provided', () => {
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /billing_audit_usage/u);
});

test('reports an unreadable or invalid backup without echoing its path or contents', () => {
  const invalidPath = join(directory, 'private-backup.json');
  writeFileSync(invalidPath, '{"customerPhone":"010-1111-2222",', 'utf8');
  const result = spawnSync(process.execPath, [cli, invalidPath], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /billing_audit_invalid_json/u);
  assert.equal(result.stderr.includes('private-backup'), false);
  assert.equal(result.stderr.includes('010-1111'), false);
  assert.equal(result.stdout, '');
});

test('reads only a regular backup file and enforces the input byte limit', () => {
  const small = join(directory, 'bounded.json');
  writeFileSync(small, '{"invoices":{},"receipts":{}}', 'utf8');
  assert.equal(readBoundedRegularFile(small, 100).toString('utf8'), '{"invoices":{},"receipts":{}}');
  assert.throws(() => readBoundedRegularFile(small, 5), /billing_audit_file_too_large/u);
  assert.throws(() => readBoundedRegularFile(directory, 100), /billing_audit_file_not_regular/u);
});

test('rejects an oversized backup before printing any ledger data', () => {
  const path = join(directory, 'oversized.json');
  writeFileSync(path, Buffer.alloc(8 * 1024 * 1024 + 1, 65));
  const result = spawnSync(process.execPath, [cli, path], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /billing_audit_file_too_large/u);
});
