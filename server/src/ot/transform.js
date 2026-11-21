/**
 * Operational Transformation engine
 *
 * An "op" is:
 *   { type: 'insert', position, text }
 *   { type: 'delete', position, length }
 *
 * transform(incoming, concurrent)
 *   Returns a new op that produces the same logical change
 *   after `concurrent` has already been applied to the document.
 *
 * apply(content, op)
 *   Applies op to a string and returns the new string.
 */

function transform(incoming, concurrent) {
  if (incoming.type === 'insert') {
    return transformInsert(incoming, concurrent);
  }
  if (incoming.type === 'delete') {
    return transformDelete(incoming, concurrent);
  }
  throw new Error(`Unknown op type: ${incoming.type}`);
}

// --- insert vs insert / delete ---

function transformInsert(ins, concurrent) {
  if (concurrent.type === 'insert') {
    // If concurrent insert is before (or at same position, tie-break by clientId
    // so both clients converge on the same order), shift our position right.
    if (
      concurrent.position < ins.position ||
      (concurrent.position === ins.position &&
        concurrent.clientId < ins.clientId)
    ) {
      return { ...ins, position: ins.position + concurrent.text.length };
    }
    return ins;
  }

  if (concurrent.type === 'delete') {
    // Concurrent delete is entirely before our insert
    if (concurrent.position + concurrent.length <= ins.position) {
      return { ...ins, position: ins.position - concurrent.length };
    }
    // Concurrent delete starts at or after our insert position — no shift
    if (concurrent.position >= ins.position) {
      return ins;
    }
    // Our insert is inside the deleted range — move to start of deletion
    return { ...ins, position: concurrent.position };
  }

  return ins;
}

// --- delete vs insert / delete ---

function transformDelete(del, concurrent) {
  if (concurrent.type === 'insert') {
    // Concurrent insert is before our delete range — shift right
    if (concurrent.position <= del.position) {
      return { ...del, position: del.position + concurrent.text.length };
    }
    // Concurrent insert is inside our delete range — extend length
    if (concurrent.position < del.position + del.length) {
      return { ...del, length: del.length + concurrent.text.length };
    }
    return del;
  }

  if (concurrent.type === 'delete') {
    const aStart = concurrent.position;
    const aEnd = concurrent.position + concurrent.length;
    const bStart = del.position;
    const bEnd = del.position + del.length;

    // Concurrent delete is entirely before ours
    if (aEnd <= bStart) {
      return { ...del, position: del.position - concurrent.length };
    }
    // Concurrent delete is entirely after ours
    if (aStart >= bEnd) {
      return del;
    }

    // Overlapping — trim our delete to cover only what concurrent didn't remove
    const newStart = Math.min(bStart, aStart);
    // Characters in our range that concurrent already deleted
    const overlap = Math.min(bEnd, aEnd) - Math.max(bStart, aStart);
    const newLength = del.length - overlap;

    if (newLength <= 0) {
      // Everything we wanted to delete is already gone — no-op delete
      return { ...del, position: newStart, length: 0 };
    }
    return { ...del, position: newStart, length: newLength };
  }

  return del;
}

/**
 * Apply an op to a string.  Returns the new string.
 */
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
  throw new Error(`Unknown op type: ${op.type}`);
}

/**
 * Rebase `incoming` on top of all ops in `log` that were applied
 * after the version the incoming op was based on.
 *
 * @param {object}   incoming  - the op to rebase
 * @param {object[]} log       - full history array from the Document model
 * @param {number}   baseVersion - version the incoming op was computed against
 * @returns {object} transformed op ready to apply at HEAD
 */
function rebase(incoming, log, baseVersion) {
  // Only transform against ops that were applied after baseVersion
  const concurrent = log.filter((o) => o.version > baseVersion);
  let op = { ...incoming };
  for (const c of concurrent) {
    op = transform(op, c);
  }
  return op;
}

module.exports = { transform, apply, rebase };
