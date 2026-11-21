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
 *
 * Returns helpers used by Editor and useSocket callbacks.
 */
export function useDocument() {
  const [content, setContent]  = useState('');
  const [version, setVersion]  = useState(0);
  const [title, setTitle]      = useState('Untitled');
  const [status, setStatus]    = useState('idle');
  const [error, setError]      = useState(null);

  // Track pending (sent but not yet ack'd) ops so we can compose them
  // against incoming remote ops before applying to local content.
  // For the MVP we keep a simple "last sent op" buffer.
  const pendingOpsRef = useRef([]);

  // ── Called when server sends doc-init ──────────────────────────────────────
  const handleInit = useCallback(({ doc }) => {
    setContent(doc.content);
    setVersion(doc.version);
    setTitle(doc.title);
    setStatus('connected');
    setError(null);
    pendingOpsRef.current = [];
  }, []);

  // ── Called when server broadcasts a confirmed op ───────────────────────────
  // The server has already rebased this op — we just apply it.
  // If it's one of our own pending ops (same clientId + version), we
  // acknowledge it and drop it from the pending queue instead of re-applying.
  const handleRemoteOp = useCallback(({ op, version: newVersion }) => {
    setVersion(newVersion);
    setContent((prev) => applyOp(prev, op));
  }, []);

  // ── Build op(s) from a textarea change event ──────────────────────────────
  // Returns an array of ops (usually 1, two for a replace).
  // Caller sends each op to the server in order.
  const buildOpFromChange = useCallback(
    (oldContent, newContent, clientId, currentVersion) => {
      const result = diffToOp(oldContent, newContent, clientId, currentVersion);
      if (!result) return [];
      const ops = Array.isArray(result) ? result : [result];
      // Optimistically update local state immediately
      setContent(newContent);
      pendingOpsRef.current.push(...ops);
      return ops;
    },
    []
  );

  // ── Called when server acks our own op (op-ack) ───────────────────────────
  // Just sync the version number — content already applied optimistically.
  const handleAck = useCallback(({ version: newVersion }) => {
    setVersion(newVersion);
  }, []);

  const setLoading = useCallback(() => setStatus('loading'), []);
  const setConnected = useCallback(() => setStatus('connected'), []);
  const handleError = useCallback(({ message }) => {
    setError(message);
    setStatus('error');
  }, []);

  return {
    content,
    version,
    title,
    setTitle,
    status,
    error,
    handleInit,
    handleRemoteOp,
    handleAck,
    buildOpFromChange,
    setLoading,
    setConnected,
    handleError,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Apply a server op to a string.
 * Mirrors server-side apply() — kept here so client stays in sync without
 * importing server code.
 */
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
  return content;
}

/**
 * diffToOp(oldStr, newStr, clientId, version)
 *
 * Derives a single insert or delete op from two consecutive textarea values.
 * Browsers always produce one contiguous diff per input event, so this
 * simple longest-common-prefix/suffix approach is accurate.
 *
 * Returns null when old === new.
 */
function diffToOp(oldStr, newStr, clientId, version) {
  if (oldStr === newStr) return null;

  // Find common prefix length
  let prefixLen = 0;
  while (
    prefixLen < oldStr.length &&
    prefixLen < newStr.length &&
    oldStr[prefixLen] === newStr[prefixLen]
  ) prefixLen++;

  // Find common suffix length (don't overlap with prefix)
  let oldSuffix = oldStr.length;
  let newSuffix = newStr.length;
  while (
    oldSuffix > prefixLen &&
    newSuffix > prefixLen &&
    oldStr[oldSuffix - 1] === newStr[newSuffix - 1]
  ) { oldSuffix--; newSuffix--; }

  const deletedLen  = oldSuffix - prefixLen;  // chars removed from old
  const insertedStr = newStr.slice(prefixLen, newSuffix); // chars added in new

  if (deletedLen > 0 && insertedStr.length > 0) {
    // Replace = delete + insert. Emit delete now; the insertion will be
    // picked up in the next diff cycle automatically because React sets
    // the value after each onChange, so the next event sees old=afterDelete.
    // We also emit the insert immediately as a second op so single-event
    // replacements (paste, autocorrect) work correctly.
    // Return an array; caller must send both.
    return [
      {
        type: 'delete',
        position: prefixLen,
        length: deletedLen,
        clientId,
        version,
      },
      {
        type: 'insert',
        position: prefixLen,
        text: insertedStr,
        clientId,
        version, // server will rebase the insert against the delete
      },
    ];
  }

  if (deletedLen > 0) {
    return {
      type: 'delete',
      position: prefixLen,
      length: deletedLen,
      clientId,
      version,
    };
  }

  if (insertedStr.length > 0) {
    return {
      type: 'insert',
      position: prefixLen,
      text: insertedStr,
      clientId,
      version,
    };
  }

  return null;
}
