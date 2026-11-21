const { transform, apply, rebase } = require('../ot/transform');

// ─── helpers ──────────────────────────────────────────────────────────────────
const ins = (position, text, clientId = 'A', version = 0) =>
  ({ type: 'insert', position, text, clientId, version });

const del = (position, length, clientId = 'A', version = 0) =>
  ({ type: 'delete', position, length, clientId, version });

const rep = (position, length, text, clientId = 'A', version = 0) =>
  ({ type: 'replace', position, length, text, clientId, version });

// ─── apply ────────────────────────────────────────────────────────────────────
describe('apply', () => {
  test('insert at start', () => {
    expect(apply('world', ins(0, 'hello '))).toBe('hello world');
  });

  test('insert at end', () => {
    expect(apply('hello', ins(5, '!'))).toBe('hello!');
  });

  test('insert in middle', () => {
    expect(apply('helloworld', ins(5, ' '))).toBe('hello world');
  });

  test('insert position past end clamps to end', () => {
    expect(apply('hi', ins(99, '!'))).toBe('hi!');
  });

  test('delete from start', () => {
    expect(apply('hello world', del(0, 6))).toBe('world');
  });

  test('delete from middle', () => {
    expect(apply('hello world', del(5, 6))).toBe('hello');
  });

  test('delete length clamped when past end', () => {
    expect(apply('hello', del(3, 999))).toBe('hel');
  });

  test('delete length 0 is no-op', () => {
    // length 0 is invalid per validateOp but apply should not crash
    expect(apply('hello', { type: 'delete', position: 2, length: 0 })).toBe('hello');
  });
});

// ─── transform — insert vs insert ─────────────────────────────────────────────
describe('transform — insert vs insert', () => {
  test('concurrent insert before ours shifts position right', () => {
    // doc = "ac", A inserts "b" at 1, B inserts "X" at 0 concurrently
    // After B's insert: "Xac" — A's insert must land at position 2 to still be between a and c
    const a = ins(1, 'b', 'A');
    const b = ins(0, 'X', 'B');
    const transformed = transform(a, b);
    expect(transformed.position).toBe(2);
    // verify on actual string
    const afterB = apply('ac', b);         // "Xac"
    const result  = apply(afterB, transformed); // "Xabc"
    expect(result).toBe('Xabc');
  });

  test('concurrent insert after ours — no shift', () => {
    const a = ins(0, 'X', 'A');
    const b = ins(3, 'Y', 'B');
    const transformed = transform(a, b);
    expect(transformed.position).toBe(0);
  });

  test('same position tie-break by clientId (A < B — B shifts)', () => {
    // Both insert at position 2. A < B lexicographically → A goes first → B shifts
    const a = ins(2, 'X', 'A');
    const b = ins(2, 'Y', 'B');
    // Transform B against A: A.clientId 'A' < B.clientId 'B', so B shifts
    const transformed = transform(b, a);
    expect(transformed.position).toBe(2 + 'X'.length);
  });
});

// ─── transform — insert vs delete ────────────────────────────────────────────
describe('transform — insert vs delete', () => {
  test('delete entirely before insert shifts insert left', () => {
    // doc "abXcd", delete "ab" (pos 0, len 2), insert "Z" at pos 3
    const ins_op = ins(3, 'Z', 'A');
    const del_op = del(0, 2, 'B');
    const t = transform(ins_op, del_op);
    expect(t.position).toBe(1); // shifted left by 2
    const afterDel = apply('abXcd', del_op);  // "Xcd"
    expect(apply(afterDel, t)).toBe('XZcd');
  });

  test('delete entirely after insert — no shift', () => {
    const ins_op = ins(1, 'Z', 'A');
    const del_op = del(5, 3, 'B');
    expect(transform(ins_op, del_op).position).toBe(1);
  });

  test('insert inside deleted range moves to delete start', () => {
    // doc "abcde", delete pos 1 len 3 ("bcd"), insert at pos 2 (inside)
    const ins_op = ins(2, 'Z', 'A');
    const del_op = del(1, 3, 'B');
    const t = transform(ins_op, del_op);
    expect(t.position).toBe(1); // clamped to delete start
  });
});

// ─── transform — delete vs insert ────────────────────────────────────────────
describe('transform — delete vs insert', () => {
  test('insert before delete range shifts delete right', () => {
    const del_op = del(3, 2, 'A');
    const ins_op = ins(1, 'XX', 'B');
    const t = transform(del_op, ins_op);
    expect(t.position).toBe(5); // shifted right by 2
  });

  test('insert inside delete range extends delete length', () => {
    // delete pos 2 len 4, insert at pos 4 (inside)
    const del_op = del(2, 4, 'A');
    const ins_op = ins(4, 'XY', 'B');
    const t = transform(del_op, ins_op);
    expect(t.length).toBe(6); // extended by 2
  });

  test('insert after delete range — no change', () => {
    const del_op = del(0, 3, 'A');
    const ins_op = ins(5, 'Z', 'B');
    const t = transform(del_op, ins_op);
    expect(t.position).toBe(0);
    expect(t.length).toBe(3);
  });
});

// ─── transform — delete vs delete ────────────────────────────────────────────
describe('transform — delete vs delete', () => {
  test('concurrent delete entirely before ours shifts position left', () => {
    // "abcdef", concurrent deletes "ab" (0,2), ours deletes "cd" (2,2)
    const ours = del(2, 2, 'A');
    const concurrent = del(0, 2, 'B');
    const t = transform(ours, concurrent);
    expect(t.position).toBe(0);
    expect(t.length).toBe(2);
    const afterConcurrent = apply('abcdef', concurrent); // "cdef"
    expect(apply(afterConcurrent, t)).toBe('ef');
  });

  test('concurrent delete entirely after ours — no change', () => {
    const ours = del(0, 2, 'A');
    const concurrent = del(5, 3, 'B');
    const t = transform(ours, concurrent);
    expect(t.position).toBe(0);
    expect(t.length).toBe(2);
  });

  test('concurrent delete fully overlaps ours — becomes length 0 no-op', () => {
    // "abcde", concurrent deletes pos 1 len 3 ("bcd"), ours also deletes "bcd"
    const ours = del(1, 3, 'A');
    const concurrent = del(1, 3, 'B');
    const t = transform(ours, concurrent);
    expect(t.length).toBe(0);
  });

  test('concurrent delete partially overlaps ours — length trimmed', () => {
    // "abcdef", concurrent deletes pos 2 len 2 ("cd"), ours deletes pos 1 len 4 ("bcde")
    // After concurrent: "abef" — ours should delete "be" (pos 1, len 2)
    const ours = del(1, 4, 'A');
    const concurrent = del(2, 2, 'B');
    const t = transform(ours, concurrent);
    const afterConcurrent = apply('abcdef', concurrent); // "abef"
    const result = apply(afterConcurrent, t);
    expect(result).toBe('af');
  });
});

// ─── rebase ───────────────────────────────────────────────────────────────────
describe('rebase', () => {
  test('no concurrent ops — op unchanged', () => {
    const op = ins(5, 'X', 'agent', 3);
    const history = [
      { ...ins(0, 'A', 'B', 1), version: 1 },
      { ...ins(1, 'B', 'C', 2), version: 2 },
      { ...ins(2, 'C', 'D', 3), version: 3 },
    ];
    // All history ops are at version ≤ 3 = baseVersion, so none are concurrent
    const rebased = rebase(op, history, 3);
    expect(rebased.position).toBe(5);
  });

  test('one concurrent insert before op shifts position', () => {
    // Agent computed insert at position 5 when doc was at version 2
    // Meanwhile human inserted 3 chars at position 0 (version 3)
    const agentOp = ins(5, 'AGENT', 'agent', 2);
    const history = [
      { ...ins(0, 'ABC', 'human', 2), version: 3 },
    ];
    const rebased = rebase(agentOp, history, 2);
    expect(rebased.position).toBe(8); // shifted right by 3
  });

  test('agent rewrite rebased over human edit preserves human text', () => {
    // Start: "Hello world"
    // Agent plans to delete pos 6 len 5 ("world") and insert "earth" at same pos (v0)
    // Human types "!" at end (pos 11, v0) before agent arrives
    let doc = 'Hello world';

    const humanOp = { ...ins(11, '!', 'human', 0), version: 1 };
    doc = apply(doc, humanOp); // "Hello world!"

    const agentDelete = { ...del(6, 5, 'agent', 0), version: 0 };
    const history = [humanOp];

    const rebasedDelete = rebase(agentDelete, history, 0);
    doc = apply(doc, rebasedDelete); // delete "world" — human "!" at end untouched
    expect(doc).toBe('Hello !');

    const agentInsert = { ...ins(6, 'earth', 'agent', 0), version: 0 };
    // Rebase insert over both humanOp and the now-applied rebasedDelete
    const historyWithDelete = [...history, { ...rebasedDelete, version: 2 }];
    const rebasedInsert = rebase(agentInsert, historyWithDelete, 0);
    doc = apply(doc, rebasedInsert);
    expect(doc).toBe('Hello earth!'); // human "!" is preserved
  });
});

// ─── replace op ───────────────────────────────────────────────────────────────
describe('apply — replace', () => {
  test('replace full word', () => {
    // "HEY" → "hey"  (the original bug case)
    expect(apply('HEY', rep(0, 3, 'hey'))).toBe('hey');
  });

  test('replace in middle', () => {
    expect(apply('Hello World', rep(6, 5, 'Earth'))).toBe('Hello Earth');
  });

  test('replace at end', () => {
    expect(apply('foobar', rep(3, 3, 'baz'))).toBe('foobaz');
  });

  test('replace clamped when past end', () => {
    expect(apply('hi', rep(1, 999, 'ello'))).toBe('hello');
  });
});

describe('transform — replace vs insert', () => {
  test('concurrent insert before replace shifts replace right', () => {
    // doc "HEY", A replaces pos 0 len 3 "hey", B inserts "XX" at pos 0
    const a = rep(0, 3, 'hey', 'A');
    const b = ins(0, 'XX', 'B');
    const t = transform(a, b);
    // After B: "XXHEY" — A's replace should now target pos 2 len 3
    expect(t.position).toBe(2);
    expect(t.length).toBe(3);
    const afterB = apply('HEY', b);       // "XXHEY"
    expect(apply(afterB, t)).toBe('XXhey');
  });

  test('concurrent insert after replace — no shift', () => {
    const a = rep(0, 3, 'hey', 'A');
    const b = ins(5, 'XX', 'B');
    const t = transform(a, b);
    expect(t.position).toBe(0);
  });
});

describe('transform — replace vs delete', () => {
  test('concurrent delete before replace shifts replace left', () => {
    // doc "XXhello", delete "XX" (pos 0 len 2), replace "hello" (pos 2 len 5)
    const a = rep(2, 5, 'world', 'A');
    const b = del(0, 2, 'B');
    const t = transform(a, b);
    expect(t.position).toBe(0);
    const afterB = apply('XXhello', b);     // "hello"
    expect(apply(afterB, t)).toBe('world');
  });
});

describe('the original bug — HEY → hey as atomic replace', () => {
  test('single replace op produces correct result on remote client', () => {
    // Client A has "HEY", sends replace(0, 3, "hey") at version 0
    // Client B also has "HEY"
    // Server applies replace → "hey" v1
    // B receives replace op and applies it to "HEY" → "hey"
    const docA = 'HEY';
    const docB = 'HEY';
    const replaceOp = rep(0, 3, 'hey', 'A', 0);

    // Server side
    const serverResult = apply(docA, replaceOp);
    expect(serverResult).toBe('hey');

    // Client B receives the same op
    const clientBResult = apply(docB, replaceOp);
    expect(clientBResult).toBe('hey');

    // Both match — no "HyeEy" corruption
    expect(serverResult).toBe(clientBResult);
  });

  test('replace + concurrent insert on same doc converges', () => {
    // doc "HEY"
    // A: replace(0,3,"hey") at v0 — lands first on server
    // B: insert(3,"!") at v0 — concurrent, lands second
    // Server applies A first → "hey" v1, then rebases B → insert at pos 3 → "hey!"
    // Client A gets B's insert back → "hey" + insert(3,"!") → "hey!"
    // Client B gets A's replace rebased over B's insert → same result

    const docContent = 'HEY';
    const replaceOp = rep(0, 3, 'hey', 'A', 0);
    const insertOp  = ins(3, '!', 'B', 0);

    // Server: apply replaceOp first
    const afterReplace = apply(docContent, replaceOp);           // "hey"
    const history = [{ ...replaceOp, version: 1 }];
    const rebasedInsert = rebase(insertOp, history, 0);
    const finalServer = apply(afterReplace, rebasedInsert);       // "hey!"

    // Client A (sent replace, receives B's rebased insert)
    const clientA = apply(apply(docContent, replaceOp), rebasedInsert);

    // Client B (sent insert, receives A's replace rebased over B's insert)
    const historyB = [{ ...insertOp, version: 1 }];
    const rebasedReplace = rebase(replaceOp, historyB, 0);
    const clientB = apply(apply(docContent, insertOp), rebasedReplace);

    // All three must converge to the same string
    expect(clientA).toBe(finalServer);
    expect(clientB).toBe(finalServer);
  });
});
