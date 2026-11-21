/**
 * validateOp(op)
 *
 * Returns { valid: true } or { valid: false, reason: string }.
 * Call this before touching the DB with any op from an untrusted source.
 */

const MAX_POSITION  = 2_000_000;   // matches CONTENT_MAX
const MAX_LENGTH    = 2_000_000;
const MAX_TEXT      = 100_000;     // matches TEXT_OP_MAX
const MAX_CLIENT_ID = 128;

function validateOp(op) {
  if (!op || typeof op !== 'object') {
    return fail('op must be an object');
  }

  // ── type ──────────────────────────────────────────────────────────────────
  if (op.type !== 'insert' && op.type !== 'delete') {
    return fail(`op.type must be "insert" or "delete", got: ${op.type}`);
  }

  // ── position ──────────────────────────────────────────────────────────────
  if (!Number.isInteger(op.position) || op.position < 0 || op.position > MAX_POSITION) {
    return fail(`op.position must be a non-negative integer ≤ ${MAX_POSITION}`);
  }

  // ── version ───────────────────────────────────────────────────────────────
  if (!Number.isInteger(op.version) || op.version < 0) {
    return fail('op.version must be a non-negative integer');
  }

  // ── clientId ──────────────────────────────────────────────────────────────
  if (typeof op.clientId !== 'string' || op.clientId.trim() === '') {
    return fail('op.clientId must be a non-empty string');
  }
  if (op.clientId.length > MAX_CLIENT_ID) {
    return fail(`op.clientId must be ≤ ${MAX_CLIENT_ID} chars`);
  }

  // ── insert-specific ───────────────────────────────────────────────────────
  if (op.type === 'insert') {
    if (typeof op.text !== 'string') {
      return fail('insert op must have a string text field');
    }
    if (op.text.length === 0) {
      return fail('insert op text must not be empty');
    }
    if (op.text.length > MAX_TEXT) {
      return fail(`insert op text must be ≤ ${MAX_TEXT} chars`);
    }
  }

  // ── delete-specific ───────────────────────────────────────────────────────
  if (op.type === 'delete') {
    if (!Number.isInteger(op.length) || op.length <= 0 || op.length > MAX_LENGTH) {
      return fail(`delete op.length must be a positive integer ≤ ${MAX_LENGTH}`);
    }
  }

  return { valid: true };
}

function fail(reason) {
  return { valid: false, reason };
}

module.exports = validateOp;
