const Document = require('../models/Document');
const { apply, rebase } = require('../ot/transform');
const validateOp = require('../utils/validateOp');

// Agent secret is set in .env — agent-op events must carry it
const AGENT_SECRET = process.env.AGENT_SECRET;

// Max ops to keep in history (prune oldest when exceeded)
const HISTORY_CAP = Document.LIMITS?.HISTORY_MAX ?? 50_000;

/**
 * Attach all document-room socket events to `io`.
 *
 * Client events:
 *   join-doc   { docId }
 *   op         { docId, op: { type, position, text?, length?, version, clientId } }
 *   cursor     { docId, clientId, position }
 *   agent-op   { docId, op, baseVersion, secret }
 *
 * Server emits:
 *   doc-init   { doc: { _id, title, content, version } }
 *   op         { op, version }
 *   cursor     { clientId, position }
 *   error      { message }
 */
module.exports = function attachDocHandler(io) {
  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── join-doc ──────────────────────────────────────────────────────────────
    socket.on('join-doc', async (payload) => {
      try {
        const docId = sanitizeId(payload?.docId);
        if (!docId) return socket.emit('error', { message: 'Invalid docId.' });

        let doc = await Document.findById(docId).select('-history'); // don't send history to client
        if (!doc) {
          doc = await Document.create({ _id: docId });
        }

        if (socket.currentDocId) socket.leave(socket.currentDocId);
        socket.currentDocId = docId;
        socket.join(docId);

        socket.emit('doc-init', {
          doc: pick(doc, ['_id', 'title', 'content', 'version']),
        });

        console.log(`[socket] ${socket.id} joined doc ${docId}`);
      } catch (err) {
        console.error('[join-doc]', err.message);
        socket.emit('error', { message: 'Could not load document.' });
      }
    });

    // ── op (human keystroke) ──────────────────────────────────────────────────
    socket.on('op', async (payload) => {
      try {
        const docId = sanitizeId(payload?.docId);
        if (!docId) return socket.emit('error', { message: 'Invalid docId.' });

        // Validate op shape before anything touches the DB
        const check = validateOp(payload?.op);
        if (!check.valid) {
          return socket.emit('error', { message: `Bad op: ${check.reason}` });
        }

        const op = payload.op;

        const doc = await Document.findById(docId);
        if (!doc) return socket.emit('error', { message: 'Document not found.' });

        // Guard: version must not be ahead of the document
        if (op.version > doc.version) {
          return socket.emit('error', { message: 'op.version is ahead of document.' });
        }

        const rebased = rebase(op, doc.history, op.version);
        const newContent = apply(doc.content, rebased);

        // Reject if result exceeds content limit
        if (newContent.length > Document.LIMITS.CONTENT_MAX) {
          return socket.emit('error', { message: 'Document size limit exceeded.' });
        }

        const newVersion = doc.version + 1;
        rebased.version = newVersion;
        rebased.clientId = op.clientId.trim();

        // Build the update — prune oldest history entries if cap is exceeded
        const historySize = doc.history.length;
        const updateOp = {
          $set: { content: newContent, version: newVersion },
          $push: { history: rebased },
        };
        if (historySize >= HISTORY_CAP) {
          // Remove oldest entry and add new one atomically
          updateOp.$pop = { history: -1 };  // -1 removes from front
        }

        await Document.findByIdAndUpdate(docId, updateOp);

        io.to(docId).emit('op', { op: rebased, version: newVersion });

        console.log(`[op] doc=${docId} v${newVersion} ${rebased.type}@${rebased.position}`);
      } catch (err) {
        console.error('[op]', err.message);
        socket.emit('error', { message: 'Failed to apply op.' });
      }
    });

    // ── agent-op (AI large rewrite, arrives late) ─────────────────────────────
    socket.on('agent-op', async (payload) => {
      try {
        // ── authenticate the agent ──────────────────────────────────────────
        if (!AGENT_SECRET || payload?.secret !== AGENT_SECRET) {
          return socket.emit('error', { message: 'Unauthorized agent-op.' });
        }

        const docId = sanitizeId(payload?.docId);
        if (!docId) return socket.emit('error', { message: 'Invalid docId.' });

        const check = validateOp(payload?.op);
        if (!check.valid) {
          return socket.emit('error', { message: `Bad agent op: ${check.reason}` });
        }

        const baseVersion = payload.baseVersion;
        if (!Number.isInteger(baseVersion) || baseVersion < 0) {
          return socket.emit('error', { message: 'Invalid baseVersion.' });
        }

        const op = payload.op;

        const doc = await Document.findById(docId);
        if (!doc) return socket.emit('error', { message: 'Document not found.' });

        const rebased = rebase(op, doc.history, baseVersion);
        const newContent = apply(doc.content, rebased);

        if (newContent.length > Document.LIMITS.CONTENT_MAX) {
          return socket.emit('error', { message: 'Document size limit exceeded.' });
        }

        const newVersion = doc.version + 1;
        rebased.version = newVersion;
        rebased.clientId = (op.clientId || 'agent').trim().slice(0, Document.LIMITS.CLIENT_ID_MAX);

        const historySize = doc.history.length;
        const updateOp = {
          $set: { content: newContent, version: newVersion },
          $push: { history: rebased },
        };
        if (historySize >= HISTORY_CAP) {
          updateOp.$pop = { history: -1 };
        }

        await Document.findByIdAndUpdate(docId, updateOp);

        io.to(docId).emit('op', { op: rebased, version: newVersion });

        console.log(`[agent-op] doc=${docId} v${newVersion} rebased from base=${baseVersion}`);
      } catch (err) {
        console.error('[agent-op]', err.message);
        socket.emit('error', { message: 'Failed to apply agent op.' });
      }
    });

    // ── cursor ────────────────────────────────────────────────────────────────
    socket.on('cursor', (payload) => {
      const docId = sanitizeId(payload?.docId);
      if (!docId) return;

      const clientId = typeof payload?.clientId === 'string'
        ? payload.clientId.trim().slice(0, 128)
        : null;
      const position = Number.isInteger(payload?.position) && payload.position >= 0
        ? payload.position
        : null;

      if (!clientId || position === null) return;

      socket.to(docId).emit('cursor', { clientId, position });
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Allow only MongoDB ObjectId-looking strings or short alphanumeric ids */
function sanitizeId(id) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  // Accept 24-char hex ObjectId OR alphanumeric slug up to 64 chars
  if (/^[a-f0-9]{24}$/.test(trimmed) || /^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/** Return only the listed keys from an object */
function pick(obj, keys) {
  return keys.reduce((acc, k) => { acc[k] = obj[k]; return acc; }, {});
}
