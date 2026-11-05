import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

export function readBoundedRegularFile(path, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024 * 1024) {
    throw new Error('billing_audit_invalid_limit');
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error('billing_audit_file_not_regular');
    if (stat.size > maxBytes) throw new Error('billing_audit_file_too_large');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (true) {
      const read = readSync(descriptor, buffer, 0, Math.min(buffer.length, maxBytes - total + 1), null);
      if (read === 0) break;
      total += read;
      if (total > maxBytes) throw new Error('billing_audit_file_too_large');
      chunks.push(Buffer.from(buffer.subarray(0, read)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}
