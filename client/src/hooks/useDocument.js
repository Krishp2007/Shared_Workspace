import { useState, useCallback, useRef } from 'react';

/**
 * useDocument()
 *
 * Owns all document state and the client-side OT logic.
 *
 * State:
 *   content  — the string shown in the editor
 *   version  — last server-acknowledged version
 *   title    — document title
 *   status   — 'idle' | 'loading' | 'connected' | 'error'
 *   error    — error message string or null
 */
export function useDocument() {
  const [content, setContent] = useState('');
  const [version, setVersion] = useState(0);
  const [title, setTitle]     = useState('Untitled');
  const [status, setStatus]   = useState('idle');
  const [error, setError]     = useState(null);

  // Ops we sent but haven't been ack'd yet.
  // Used to avoid re-applying our own ops when they come back rebased.
  const pendingOpsRef = useRef([]);

  // ── doc-init ──────────────────────────────────────────────────────────────
  const handleInit = useCallback(({ doc }) => {
    setContent(doc.content);
    setVersion(doc.version);
    setTitle(doc.title);
    setStatus('connected');
    setError(null);
    pendingOpsRef.current = [];
  }, []);

  // ── remote op (from another client) ──────────────────────────────────────
  // Server sends `op` only to OTHER sockets, never back to the sender.
  // So every op received here is genuinely remote — apply unconditionally.
  const handleRemoteOp = useCallback(({ op, version: newVersion }) => {
    setVersion(newVersion);
    setContent((prev) => applyOp(prev, op));
  }, []);

  // ── op-ack (server confirmed our own op) ──────────────────────────────────
  // The server may have rebased our op. We receive { op: rebasedOp, version }.
  // Our optimistic content used the ORIGINAL position. If the server shifted
  // it, we need to reconcile: roll back one op and re-apply the rebased one.
  const handleAck = useCallback(({ op: rebasedOp, version: newVersion }) => {
    setVersion(newVersion);

    if (!rebasedOp) return;

    // Find the matching pending op by clientId + original version
    const idx = pendingOpsRef.current.findIndex(
      (p) => p.clientId === rebasedOp.clientId && p.version === rebasedOp.version - 1
    );
    if (idx === -1) return; // already cleaned up

    const originalOp = pendingOpsRef.current[idx];
    pendingOpsRef.current.splice(idx, 1);

    // If position didn't change there's nothing to fix
    const positionShifted =
      originalOp.position !== rebasedOp.position ||
      originalOp.length   !== rebasedOp.length;

    if (positionShifted) {
      // Undo the original optimistic op then re-apply the rebased one
      setContent((prev) => {
        const undone = undoOp(prev, originalOp);
        return applyOp(undone, rebasedOp);
      });
    }
  }, []);

  // ── build ops from textarea onChange ─────────────────────────────────────
  // Returns [] or [op] or [deleteOp, insertOp] for a replace.
  const buildOpFromChange = useCallback(
    (oldContent, newContent, clientId, currentVersion) => {
      const result = diffToOp(oldContent, newContent, clientId, currentVersion);
      if (!result) return [];
      const ops = Array.isArray(result) ? result : [result];
      setContent(newContent);               // optimistic update
      pendingOpsRef.current.push(...ops);
      return ops;
    },
    []
  );

  const setLoading   = useCallback(() => setStatus('loading'), []);
  const setConnected = useCallback(() => setStatus('connected'), []);
  const handleError  = useCallback(({ message }) => {
    setError(message);
    setStatus('error');
  }, []);

  return {
    content, version, title, setTitle, status, error,
    handleInit, handleRemoteOp, handleAck,
    buildOpFromChange, setLoading, setConnected, handleError,
  };
}

// ─── string helpers ───────────────────────────────────────────────────────────

function applyOp(content, op) {
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
  return content;
}

// Reverse a previously applied op (best-effort — only used for reconciliation)
function undoOp(content, op) {
  if (op.type === 'insert') {
    // Remove the text we inserted
    const pos = Math.min(op.position, content.length);
    const len = Math.min(op.text.length, content.length - pos);
    return content.slice(0, pos) + content.slice(pos + len);
  }
  if (op.type === 'delete') {
    // We don't have the deleted text, so we can't truly undo.
    // The reconciliation path only triggers for inserts (position shift),
    // so this branch is a safety fallback — return as-is.
    return content;
  }
  return content;
}

/**
 * diffToOp — derive op(s) from two consecutive textarea values.
 * Uses longest-common-prefix/suffix — accurate for all single-event changes.
 * Returns null | op | [deleteOp, insertOp]
 */
function diffToOp(oldStr, newStr, clientId, version) {
  if (oldStr === newStr) return null;

  let prefixLen = 0;
  while (
    prefixLen < oldStr.length &&
    prefixLen < newStr.length &&
    oldStr[prefixLen] === newStr[prefixLen]
  ) prefixLen++;

  let oldSuffix = oldStr.length;
  let newSuffix = newStr.length;
  while (
    oldSuffix > prefixLen &&
    newSuffix > prefixLen &&
    oldStr[oldSuffix - 1] === newStr[newSuffix - 1]
  ) { oldSuffix--; newSuffix--; }

  const deletedLen  = oldSuffix - prefixLen;
  const insertedStr = newStr.slice(prefixLen, newSuffix);

  // Replace: single atomic replace op — no race between delete and insert
  if (deletedLen > 0 && insertedStr.length > 0) {
    return { type: 'replace', position: prefixLen, length: deletedLen, text: insertedStr, clientId, version };
  }

  if (deletedLen > 0) {
    return { type: 'delete', position: prefixLen, length: deletedLen, clientId, version };
  }

  if (insertedStr.length > 0) {
    return { type: 'insert', position: prefixLen, text: insertedStr, clientId, version };
  }

  return null;
}
