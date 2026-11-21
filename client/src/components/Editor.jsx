import { useEffect, useRef, useCallback, useState } from 'react';
import { useDocument }  from '../hooks/useDocument';
import { useSocket }    from '../hooks/useSocket';
import CursorLayer      from './CursorLayer';
import AgentPanel       from './AgentPanel';

/**
 * Editor
 *
 * Props:
 *   docId      — MongoDB document id
 *   clientId   — stable random id for this browser tab
 *   onBack     — callback to return to doc list
 */
export default function Editor({ docId, clientId, onBack }) {
  const {
    content, version, title, setTitle,
    status, error,
    handleInit, handleRemoteOp, handleAck, buildOpFromChange,
    setLoading, handleError,
  } = useDocument();

  // Remote cursors: Map<clientId, { position }>
  const [cursors, setCursors] = useState(new Map());

  // Track content in a ref so socket callbacks always see current value
  // without stale closure issues
  const contentRef = useRef(content);
  useEffect(() => { contentRef.current = content; }, [content]);

  const versionRef = useRef(version);
  useEffect(() => { versionRef.current = version; }, [version]);

  // ── Socket callbacks ────────────────────────────────────────────────────────
  const handleCursor = useCallback(({ clientId: remoteId, position }) => {
    setCursors((prev) => {
      const next = new Map(prev);
      next.set(remoteId, { position });
      return next;
    });
  }, []);

  const { sendOp, sendCursor } = useSocket(docId, {
    onInit:   handleInit,
    onOp:     handleRemoteOp,
    onAck:    handleAck,
    onCursor: handleCursor,
    onError:  handleError,
  });

  // Set loading while socket handshake happens
  useEffect(() => { if (docId) setLoading(); }, [docId, setLoading]);

  // ── Textarea change → op ────────────────────────────────────────────────────
  const handleChange = useCallback((e) => {
    const newContent = e.target.value;
    const ops = buildOpFromChange(
      contentRef.current,
      newContent,
      clientId,
      versionRef.current
    );
    // Send each op in order (usually 1, two for a replace/paste)
    ops.forEach((op) => sendOp(op));
  }, [buildOpFromChange, clientId, sendOp]);

  // ── Cursor position → broadcast ─────────────────────────────────────────────
  const handleSelect = useCallback((e) => {
    sendCursor(clientId, e.target.selectionStart);
  }, [clientId, sendCursor]);

  // ── Title rename ────────────────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle]     = useState('');

  const startRename = () => { setDraftTitle(title); setEditingTitle(true); };
  const commitRename = async () => {
    setEditingTitle(false);
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === title) return;
    setTitle(trimmed);
    try {
      await fetch(`/docs/${docId}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
    } catch {
      // non-fatal — title reverts on next doc-init
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="editor-root">
      {/* Top bar */}
      <div className="editor-topbar">
        <button className="btn-back" onClick={onBack}>← Docs</button>

        {editingTitle ? (
          <input
            className="title-input"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); }}
            autoFocus
          />
        ) : (
          <h2 className="doc-title" onClick={startRename} title="Click to rename">
            {title}
          </h2>
        )}

        <span className={`status-pill status-${status}`}>{status}</span>

        <AgentPanel
          docId={docId}
          content={content}
          version={version}
          onError={(msg) => handleError({ message: msg })}
        />
      </div>

      {/* Remote cursor badges */}
      <CursorLayer cursors={cursors} myClientId={clientId} />

      {/* Error banner */}
      {error && <div className="error-banner">{error}</div>}

      {/* The editor */}
      <textarea
        className="editor-textarea"
        value={content}
        onChange={handleChange}
        onSelect={handleSelect}
        onKeyUp={handleSelect}
        onClick={handleSelect}
        disabled={status === 'loading'}
        spellCheck={false}
        placeholder={status === 'loading' ? 'Connecting…' : 'Start typing…'}
      />

      {/* Footer info */}
      <div className="editor-footer">
        <span>v{version}</span>
        <span>{content.length} chars</span>
        <span className="client-id-label">you: {clientId.slice(0, 8)}</span>
      </div>
    </div>
  );
}
