import { useState, useMemo } from 'react';
import DocList from './components/DocList';
import Editor  from './components/Editor';

/**
 * Stable random client ID for this browser tab.
 * Stored in sessionStorage so it survives hot-reloads but each new tab
 * gets a fresh id (which is what we want for cursor differentiation).
 */
function getClientId() {
  const KEY = 'sw_client_id';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export default function App() {
  const clientId = useMemo(() => getClientId(), []);
  const [docId, setDocId] = useState(null);

  if (docId) {
    return (
      <Editor
        docId={docId}
        clientId={clientId}
        onBack={() => setDocId(null)}
      />
    );
  }

  return <DocList onSelect={setDocId} />;
}
