import { useState } from 'react';
import { agentRewrite } from '../api/docsApi';

/**
 * AgentPanel
 *
 * Props:
 *   docId       — current document id
 *   content     — current canonical content (used to build the replace op)
 *   version     — current doc version (sent as baseVersion)
 *   onApplied   — called with { version } after the agent op lands
 *   onError     — called with error message string
 */
export default function AgentPanel({ docId, content, version, onApplied, onError }) {
  const [open, setOpen]       = useState(false);
  const [instruction, setInstruction] = useState('');
  const [status, setStatus]   = useState('idle'); // idle | thinking | done | error

  // ── The "agent" for the demo ──────────────────────────────────────────────
  // Real production: call an LLM API here, get back new text, build the op.
  // Demo: runs a set of deterministic text transforms locally so the UI
  // works end-to-end without an LLM key.
  function runAgentLocally(text, instruction) {
    const cmd = instruction.trim().toLowerCase();

    if (cmd.includes('uppercase') || cmd.includes('upper case')) {
      return text.toUpperCase();
    }
    if (cmd.includes('lowercase') || cmd.includes('lower case')) {
      return text.toLowerCase();
    }
    if (cmd.includes('reverse')) {
      return text.split('').reverse().join('');
    }
    if (cmd.startsWith('prepend ') || cmd.startsWith('prefix ')) {
      const prefix = instruction.trim().split(' ').slice(1).join(' ');
      return prefix + '\n' + text;
    }
    if (cmd.startsWith('append ') || cmd.startsWith('suffix ')) {
      const suffix = instruction.trim().split(' ').slice(1).join(' ');
      return text + '\n' + suffix;
    }
    if (cmd.includes('remove blank') || cmd.includes('remove empty')) {
      return text.split('\n').filter(l => l.trim() !== '').join('\n');
    }
    if (cmd.includes('title case')) {
      return text.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    }
    if (cmd.startsWith('replace ')) {
      // "replace foo with bar"
      const match = instruction.match(/replace (.+?) with (.+)/i);
      if (match) return text.split(match[1]).join(match[2]);
    }
    // Default: wrap with a note
    return `[Agent: "${instruction}"]\n${text}`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!instruction.trim() || !content) return;

    setStatus('thinking');

    // Simulate agent "thinking" delay (300ms)
    await new Promise(r => setTimeout(r, 300));

    try {
      const newText = runAgentLocally(content, instruction);

      if (newText === content) {
        setStatus('idle');
        return;
      }

      // Build a single replace op covering the entire document
      const op = {
        type:      'replace',
        position:  0,
        length:    content.length,
        text:      newText,
        clientId:  'agent-ui',
        version,
      };

      const result = await agentRewrite(docId, op, version);
      setStatus('done');
      setInstruction('');
      onApplied?.(result);

      // Reset done state after 2s
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      setStatus('error');
      onError?.(err.message);
      setTimeout(() => setStatus('idle'), 3000);
    }
  }

  return (
    <div className="agent-panel">
      <button
        className="agent-toggle"
        onClick={() => setOpen(v => !v)}
        title="AI Agent"
      >
        ⚡ Agent {open ? '▲' : '▼'}
      </button>

      {open && (
        <form className="agent-form" onSubmit={handleSubmit}>
          <input
            className="agent-input"
            placeholder='e.g. "uppercase", "replace hello with hi", "title case"'
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            disabled={status === 'thinking'}
            autoFocus
          />
          <button
            type="submit"
            className="agent-run-btn"
            disabled={status === 'thinking' || !instruction.trim()}
          >
            {status === 'thinking' ? '…' : status === 'done' ? '✓' : 'Run'}
          </button>
        </form>
      )}
    </div>
  );
}
