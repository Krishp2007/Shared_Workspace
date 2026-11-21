/**
 * validateOp(op)
 * Returns { valid: true } or { valid: false, reason: string }.
 */

const MAX_POSITION  = 2_000_000;
const MAX_LENGTH    = 2_000_000;
const MAX_TEXT      = 100_000;
const MAX_CLIENT_ID = 128;

function validateOp(op) {
  if (!op || typeof op !== 'object') return fail('op must be an object');

  // ── type ──────────────────────────────────────────────────────────────────
  if (!['insert', 'delete', 'replace'].includes(op.type)) {
    return fail(`op.type must be "insert", "delete", or "replace", got: ${op.type}`);
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

  // ── insert ────────────────────────────────────────────────────────────────
  if (op.type === 'insert') {
    if (typeof op.text !== 'string' || op.text.length === 0) {
      return fail('insert op must have a non-empty string text field');
    }
    if (op.text.length > MAX_TEXT) {
      return fail(`insert op text must be ≤ ${MAX_TEXT} chars`);
    }
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (op.type === 'delete') {
    if (!Number.isInteger(op.length) || op.length <= 0 || op.length > MAX_LENGTH) {
      return fail(`delete op.length must be a positive integer ≤ ${MAX_LENGTH}`);
    }
  }

  // ── replace ───────────────────────────────────────────────────────────────
  if (op.type === 'replace') {
    if (!Number.isInteger(op.length) || op.length <= 0 || op.length > MAX_LENGTH) {
      return fail(`replace op.length must be a positive integer ≤ ${MAX_LENGTH}`);
    }
    if (typeof op.text !== 'string' || op.text.length === 0) {
      return fail('replace op must have a non-empty string text field');
    }
    if (op.text.length > MAX_TEXT) {
      return fail(`replace op text must be ≤ ${MAX_TEXT} chars`);
    }
  }

  return { valid: true };
}

function fail(reason) { return { valid: false, reason }; }

module.exports = validateOp;
