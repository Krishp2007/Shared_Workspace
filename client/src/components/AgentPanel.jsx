import { useState } from 'react';

const SUGGESTIONS = [
  'Fix grammar and spelling',
  'Make it more concise',
  'Rewrite in a formal tone',
  'Rewrite in a casual tone',
  'Summarise in 3 bullet points',
  'Expand with more detail',
  'Translate to Spanish',
];

/**
 * AgentPanel
 *
 * Props:
 *   docId     — current document id
 *   version   — current doc version (sent as baseVersion so server can rebase)
 *   onError   — called with error message string
 */
export default function AgentPanel({ docId, version, onError }) {
  const [open, setOpen]             = useState(false);
  const [instruction, setInstruction] = useState('');
  const [status, setStatus]         = useState('idle'); // idle | thinking | done | error
  const [statusMsg, setStatusMsg]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed) return;

    setStatus('thinking');
    setStatusMsg('Gemini is thinking…');

    try {
      const secret = import.meta.env.VITE_AGENT_SECRET || 'change_this_before_deploy';

      const res = await fetch(`/docs/${docId}/agent-rewrite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-secret': secret,
        },
        body: JSON.stringify({ instruction: trimmed, baseVersion: version }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setStatus('done');
      setStatusMsg('Done ✓');
      setInstruction('');
      setTimeout(() => { setStatus('idle'); setStatusMsg(''); }, 2500);
    } catch (err) {
      setStatus('error');
      setStatusMsg(err.message);
      onError?.(err.message);
      setTimeout(() => { setStatus('idle'); setStatusMsg(''); }, 4000);
    }
  }

  return (
    <div className="agent-panel">
      <button
        className="agent-toggle"
        onClick={() => setOpen(v => !v)}
        title="AI Agent (Gemini)"
      >
        ✦ Agent {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="agent-dropdown">
          <form className="agent-form" onSubmit={handleSubmit}>
            <input
              className="agent-input"
              placeholder="Instruction for Gemini…"
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              disabled={status === 'thinking'}
              autoFocus
            />
            <button
              type="submit"
              className={`agent-run-btn ${status}`}
              disabled={status === 'thinking' || !instruction.trim()}
            >
              {status === 'thinking' ? '…' : status === 'done' ? '✓' : 'Run'}
            </button>
          </form>

          {/* Quick suggestion chips */}
          {status === 'idle' && (
            <div className="agent-suggestions">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className="agent-chip"
                  type="button"
                  onClick={() => setInstruction(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Status message */}
          {statusMsg && (
            <p className={`agent-status-msg agent-status-${status}`}>
              {statusMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
