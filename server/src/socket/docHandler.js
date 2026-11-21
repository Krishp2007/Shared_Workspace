const Document = require('../models/Document');
const { apply, rebase } = require('../ot/transform');

/**
 * Attach all document-room socket events to `io`.
 *
 * Client events:
 *   join-doc   { docId }
 *   op         { docId, op: { type, position, text?, length?, version, clientId } }
 *   cursor     { docId, clientId, position }
 *   agent-op   { docId, op, baseVersion }   ← AI agent large rewrite (sent as one op or batched)
 *
 * Server emits:
 *   doc-init   { doc: { _id, title, content, version } }
 *   op         { op, version }              ← rebased + applied op, broadcast to room
 *   cursor     { clientId, position }
 *   error      { message }
 */
module.exports = function attachDocHandler(io) {
  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── join-doc ──────────────────────────────────────────────────────────────
    socket.on('join-doc', async ({ docId }) => {
      try {
        // Find or create the document
        let doc = await Document.findById(docId);
        if (!doc) {
          doc = await Document.create({ _id: docId });
        }

        // Leave any previous doc room (one doc per socket at a time)
        if (socket.currentDocId) {
          socket.leave(socket.currentDocId);
        }
        socket.currentDocId = docId;
        socket.join(docId);

        socket.emit('doc-init', {
          doc: {
            _id: doc._id,
            title: doc.title,
            content: doc.content,
            version: doc.version,
          },
        });

        console.log(`[socket] ${socket.id} joined doc ${docId}`);
      } catch (err) {
        console.error('[join-doc]', err);
        socket.emit('error', { message: 'Could not load document.' });
      }
    });

    // ── op (human keystroke) ──────────────────────────────────────────────────
    socket.on('op', async ({ docId, op }) => {
      try {
        const doc = await Document.findById(docId);
        if (!doc) return socket.emit('error', { message: 'Document not found.' });

        // Rebase incoming op against any ops applied after op.version
        const rebased = rebase(op, doc.history, op.version);

        // Apply to canonical content
        const newContent = apply(doc.content, rebased);

        // Persist
        const newVersion = doc.version + 1;
        rebased.version = newVersion;
        rebased.clientId = op.clientId;

        await Document.findByIdAndUpdate(docId, {
          $set: { content: newContent, version: newVersion },
          $push: { history: rebased },
        });

        // Broadcast the rebased op to everyone in the room (including sender)
        io.to(docId).emit('op', { op: rebased, version: newVersion });

        console.log(
          `[op] doc=${docId} v${newVersion} ${rebased.type}@${rebased.position}`
        );
      } catch (err) {
        console.error('[op]', err);
        socket.emit('error', { message: 'Failed to apply op.' });
      }
    });

    // ── agent-op (AI large rewrite, arrives late) ─────────────────────────────
    // The agent sends the op it computed at baseVersion.
    // We rebase it against everything applied since, then apply normally.
    // Human edits in the same range are preserved because OT shifts/trims the
    // agent op around them rather than overwriting.
    socket.on('agent-op', async ({ docId, op, baseVersion }) => {
      try {
        const doc = await Document.findById(docId);
        if (!doc) return socket.emit('error', { message: 'Document not found.' });

        const rebased = rebase(op, doc.history, baseVersion);

        const newContent = apply(doc.content, rebased);
        const newVersion = doc.version + 1;
        rebased.version = newVersion;
        rebased.clientId = op.clientId || 'agent';

        await Document.findByIdAndUpdate(docId, {
          $set: { content: newContent, version: newVersion },
          $push: { history: rebased },
        });

        io.to(docId).emit('op', { op: rebased, version: newVersion });

        console.log(
          `[agent-op] doc=${docId} v${newVersion} rebased from base=${baseVersion}`
        );
      } catch (err) {
        console.error('[agent-op]', err);
        socket.emit('error', { message: 'Failed to apply agent op.' });
      }
    });

    // ── cursor ────────────────────────────────────────────────────────────────
    socket.on('cursor', ({ docId, clientId, position }) => {
      // Broadcast to everyone else in the room
      socket.to(docId).emit('cursor', { clientId, position });
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });
};
