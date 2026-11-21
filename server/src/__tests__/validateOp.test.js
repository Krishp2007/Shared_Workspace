const validateOp = require('../utils/validateOp');

// ─── valid ops ────────────────────────────────────────────────────────────────
describe('validateOp — valid cases', () => {
  test('valid insert op', () => {
    expect(validateOp({
      type: 'insert', position: 0, text: 'hello', clientId: 'user1', version: 0,
    })).toEqual({ valid: true });
  });

  test('valid delete op', () => {
    expect(validateOp({
      type: 'delete', position: 5, length: 3, clientId: 'agent', version: 2,
    })).toEqual({ valid: true });
  });

  test('insert at large valid position', () => {
    expect(validateOp({
      type: 'insert', position: 1_999_999, text: 'x', clientId: 'u', version: 0,
    })).toEqual({ valid: true });
  });
});

// ─── missing / wrong type ────────────────────────────────────────────────────
describe('validateOp — type checks', () => {
  test('null op fails', () => {
    expect(validateOp(null).valid).toBe(false);
  });

  test('string op fails', () => {
    expect(validateOp('insert').valid).toBe(false);
  });

  test('unknown type fails', () => {
    expect(validateOp({ type: 'replace', position: 0, clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('missing type fails', () => {
    expect(validateOp({ position: 0, clientId: 'u', version: 0 }).valid).toBe(false);
  });
});

// ─── position ────────────────────────────────────────────────────────────────
describe('validateOp — position', () => {
  test('negative position fails', () => {
    expect(validateOp({ type: 'insert', position: -1, text: 'x', clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('float position fails', () => {
    expect(validateOp({ type: 'insert', position: 1.5, text: 'x', clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('position over max fails', () => {
    expect(validateOp({ type: 'insert', position: 3_000_000, text: 'x', clientId: 'u', version: 0 }).valid).toBe(false);
  });
});

// ─── clientId ────────────────────────────────────────────────────────────────
describe('validateOp — clientId', () => {
  test('missing clientId fails', () => {
    expect(validateOp({ type: 'insert', position: 0, text: 'x', version: 0 }).valid).toBe(false);
  });

  test('empty string clientId fails', () => {
    expect(validateOp({ type: 'insert', position: 0, text: 'x', clientId: '   ', version: 0 }).valid).toBe(false);
  });

  test('clientId over 128 chars fails', () => {
    expect(validateOp({
      type: 'insert', position: 0, text: 'x',
      clientId: 'a'.repeat(129), version: 0,
    }).valid).toBe(false);
  });
});

// ─── insert-specific ─────────────────────────────────────────────────────────
describe('validateOp — insert', () => {
  test('missing text fails', () => {
    expect(validateOp({ type: 'insert', position: 0, clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('empty text fails', () => {
    expect(validateOp({ type: 'insert', position: 0, text: '', clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('text over 100k chars fails', () => {
    expect(validateOp({
      type: 'insert', position: 0, text: 'x'.repeat(100_001), clientId: 'u', version: 0,
    }).valid).toBe(false);
  });

  test('non-string text fails', () => {
    expect(validateOp({ type: 'insert', position: 0, text: 123, clientId: 'u', version: 0 }).valid).toBe(false);
  });
});

// ─── delete-specific ─────────────────────────────────────────────────────────
describe('validateOp — delete', () => {
  test('missing length fails', () => {
    expect(validateOp({ type: 'delete', position: 0, clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('zero length fails', () => {
    expect(validateOp({ type: 'delete', position: 0, length: 0, clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('negative length fails', () => {
    expect(validateOp({ type: 'delete', position: 0, length: -1, clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('float length fails', () => {
    expect(validateOp({ type: 'delete', position: 0, length: 2.5, clientId: 'u', version: 0 }).valid).toBe(false);
  });
});

// ─── NoSQL injection attempts ─────────────────────────────────────────────────
describe('validateOp — injection attempts', () => {
  test('$gt in position fails type check', () => {
    expect(validateOp({ type: 'insert', position: { $gt: 0 }, text: 'x', clientId: 'u', version: 0 }).valid).toBe(false);
  });

  test('object as clientId fails', () => {
    expect(validateOp({ type: 'insert', position: 0, text: 'x', clientId: { $ne: '' }, version: 0 }).valid).toBe(false);
  });

  test('array as text fails', () => {
    expect(validateOp({ type: 'insert', position: 0, text: ['x'], clientId: 'u', version: 0 }).valid).toBe(false);
  });
});
