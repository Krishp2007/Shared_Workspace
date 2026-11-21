import { useEffect, useState } from 'react';
import { listDocs, createDoc } from '../api/docsApi';

/**
 * DocList
 *
 * Props:
 *   onSelect(docId) — called when user opens a document
 */
export default function DocList({ onSelect }) {
  const [docs, setDocs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { docs } = await listDocs();
      setDocs(docs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    const title = newTitle.trim() || 'Untitled';
    try {
      const doc = await createDoc(title);
      setNewTitle('');
      setCreating(false);
      setDocs((prev) => [doc, ...prev]);
      onSelect(doc._id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="doclist-root">
      <div className="doclist-header">
        <h1>Shared Workspace</h1>
        <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : '+ New Doc'}
        </button>
      </div>

      {creating && (
        <form className="create-form" onSubmit={handleCreate}>
          <input
            autoFocus
            placeholder="Document title…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={300}
          />
          <button type="submit" className="btn-primary">Create</button>
        </form>
      )}

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p className="loading-text">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="empty-text">No documents yet. Create one above.</p>
      ) : (
        <ul className="doc-list">
          {docs.map((doc) => (
            <li key={doc._id} className="doc-item" onClick={() => onSelect(doc._id)}>
              <span className="doc-item-title">{doc.title}</span>
              <span className="doc-item-meta">
                v{doc.version} · {new Date(doc.updatedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
