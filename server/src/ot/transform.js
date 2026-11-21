/**
 * Operational Transformation engine
 *
 * Op shapes:
 *   { type: 'insert',  position, text }
 *   { type: 'delete',  position, length }
 *   { type: 'replace', position, length, text }   ← atomic replace (delete+insert)
 *
 * transform(incoming, concurrent) → new op
 * apply(content, op)              → new string
 * rebase(incoming, log, baseVer)  → transformed op ready to apply at HEAD
 */

function transform(incoming, concurrent) {
  // Normalise replace → [delete, insert] pair for transform purposes,
  // then re-wrap at the end.  This keeps the transform matrix small.
  if (incoming.type === 'replace') {
    return transformReplace(incoming, concurrent);
  }
  if (concurrent.type === 'replace') {
    // Treat concurrent replace as a delete followed by an insert
    const asDel = { ...concurrent, type: 'delete' };
    const asIns = { ...concurrent, type: 'insert', position: concurrent.position };
    let op = transform(incoming, asDel);
    op = transform(op, asIns);
    return op;
  }

  if (incoming.type === 'insert') return transformInsert(incoming, concurrent);
  if (incoming.type === 'delete') return transformDelete(incoming, concurrent);
  throw new Error(`Unknown op type: ${incoming.type}`);
}

// ── replace vs anything ───────────────────────────────────────────────────────
function transformReplace(rep, concurrent) {
  // Transform replace as: transform its delete portion, then its insert portion
  const asDel = { ...rep, type: 'delete' };
  const transformedDel = transformDelete(asDel, concurrent);

  // Insert rides at the same position as the (now-transformed) delete start
  const asIns = { ...rep, type: 'insert', position: transformedDel.position };
  const transformedIns = transformInsert(asIns, concurrent);

  return {
    ...rep,
    position: transformedDel.position,
    length:   transformedDel.length,
    text:     transformedIns.text,  // text doesn't change, only position could
  };
}

// ── insert vs insert / delete ─────────────────────────────────────────────────
function transformInsert(ins, concurrent) {
  if (concurrent.type === 'insert') {
    if (
      concurrent.position < ins.position ||
      (concurrent.position === ins.position && concurrent.clientId < ins.clientId)
    ) {
      return { ...ins, position: ins.position + concurrent.text.length };
    }
    return ins;
  }

  if (concurrent.type === 'delete') {
    if (concurrent.position + concurrent.length <= ins.position) {
      return { ...ins, position: ins.position - concurrent.length };
    }
    if (concurrent.position >= ins.position) {
      return ins;
    }
    return { ...ins, position: concurrent.position };
  }

  return ins;
}

// ── delete vs insert / delete ─────────────────────────────────────────────────
function transformDelete(del, concurrent) {
  if (concurrent.type === 'insert') {
    if (concurrent.position <= del.position) {
      return { ...del, position: del.position + concurrent.text.length };
    }
    if (concurrent.position < del.position + del.length) {
      return { ...del, length: del.length + concurrent.text.length };
    }
    return del;
  }

  if (concurrent.type === 'delete') {
    const aStart = concurrent.position;
    const aEnd   = concurrent.position + concurrent.length;
    const bStart = del.position;
    const bEnd   = del.position + del.length;

    if (aEnd <= bStart) return { ...del, position: del.position - concurrent.length };
    if (aStart >= bEnd) return del;

    const newStart  = Math.min(bStart, aStart);
    const overlap   = Math.min(bEnd, aEnd) - Math.max(bStart, aStart);
    const newLength = del.length - overlap;

    if (newLength <= 0) return { ...del, position: newStart, length: 0 };
    return { ...del, position: newStart, length: newLength };
  }

  return del;
}

// ── apply ─────────────────────────────────────────────────────────────────────
function apply(content, op) {
  if (op.type === 'insert') {
    const pos = Math.min(op.position, content.length);
    return content.slice(0, pos) + op.text + content.slice(pos);
  }
  if (op.type === 'delete') {
    const pos = Math.min(op.position, content.length);
    const len = Math.min(op.length, content.length - pos);
    return content.slice(0, pos) + content.slice(pos + len);
  }
  if (op.type === 'replace') {
    const pos = Math.min(op.position, content.length);
    const len = Math.min(op.length, content.length - pos);
    return content.slice(0, pos) + op.text + content.slice(pos + len);
  }
  throw new Error(`Unknown op type: ${op.type}`);
}

// ── rebase ────────────────────────────────────────────────────────────────────
function rebase(incoming, log, baseVersion) {
  const concurrent = log.filter((o) => o.version > baseVersion);
  let op = { ...incoming };
  for (const c of concurrent) {
    op = transform(op, c);
  }
  return op;
}

module.exports = { transform, apply, rebase };
