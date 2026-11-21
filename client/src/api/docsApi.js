const BASE = '/docs';

async function handleResponse(res) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function listDocs({ limit = 20, skip = 0 } = {}) {
  return handleResponse(await fetch(`${BASE}?limit=${limit}&skip=${skip}`));
}

export async function getDoc(id) {
  return handleResponse(await fetch(`${BASE}/${id}`));
}

export async function createDoc(title = 'Untitled') {
  return handleResponse(
    await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
  );
}

export async function renameDoc(id, title) {
  return handleResponse(
    await fetch(`${BASE}/${id}/title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
  );
}

export async function agentRewrite(docId, op, baseVersion) {
  // Secret read from .env — never hardcoded in real production
  const secret = import.meta.env.VITE_AGENT_SECRET || 'change_this_before_deploy';
  return handleResponse(
    await fetch(`${BASE}/${docId}/agent-rewrite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-secret': secret,
      },
      body: JSON.stringify({ op, baseVersion }),
    })
  );
}
