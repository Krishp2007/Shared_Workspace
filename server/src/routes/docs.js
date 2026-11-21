const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const Document = require('../models/Document');
const validateOp = require('../utils/validateOp');

const { TITLE_MAX, CONTENT_MAX } = Document.LIMITS;

// Agent-only routes need the secret from env
const AGENT_SECRET = process.env.AGENT_SECRET;

// Stricter rate-limit for write routes (create / agent-rewrite)
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests.' },
});

// ─── POST /docs — create a new document ──────────────────────────────────────
router.post('/', writeLimiter, async (req, res) => {
  try {
    const title = sanitizeString(req.body?.title, 'Untitled', TITLE_MAX);
    const doc = await Document.create({ title });
    return res.status(201).json(safeDoc(doc));
  } catch (err) {
    console.error('[POST /docs]', err.message);
    return res.status(500).json({ error: 'Could not create document.' });
  }
});

// ─── GET /docs — list documents (title + meta, no content/history) ────────────
router.get('/', async (req, res) => {
  try {
    const limit = clampInt(req.query?.limit, 20, 1, 100);
    const skip  = clampInt(req.query?.skip, 0, 0, 1_000_000);

    const docs = await Document
      .find({}, 'title version createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json({ docs, skip, limit });
  } catch (err) {
    console.error('[GET /docs]', err.message);
    return res.status(500).json({ error: 'Could not list documents.' });
  }
});

// ─── GET /docs/:id — fetch one document ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid document id.' });

    const doc = await Document.findById(id).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    return res.json(safeDoc(doc));
  } catch (err) {
    console.error('[GET /docs/:id]', err.message);
    return res.status(500).json({ error: 'Could not fetch document.' });
  }
});

// ─── PATCH /docs/:id/title — rename a document ───────────────────────────────
router.patch('/:id/title', writeLimiter, async (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid document id.' });

    const title = sanitizeString(req.body?.title, null, TITLE_MAX);
    if (!title) return res.status(400).json({ error: 'title is required.' });

    const doc = await Document.findByIdAndUpdate(
      id,
      { $set: { title } },
      { new: true, runValidators: true, select: '-history' }
    ).lean();

    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    return res.json(safeDoc(doc));
  } catch (err) {
    console.error('[PATCH /docs/:id/title]', err.message);
    return res.status(500).json({ error: 'Could not rename document.' });
  }
});

// ─── POST /docs/:id/agent-rewrite ─────────────────────────────────────────────
// Two modes:
//   1. { instruction, baseVersion }  → server calls Gemini, builds op, applies
//   2. { op, baseVersion }           → raw op path (scripts / tests)
router.post('/:id/agent-rewrite', writeLimiter, async (req, res) => {
  try {
    // ── auth ───────────────────────────────────────────────────────────────
    const secret = req.headers['x-agent-secret'];
    if (!AGENT_SECRET || secret !== AGENT_SECRET) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid document id.' });

    const { op: rawOp, instruction, baseVersion } = req.body ?? {};

    if (!Number.isInteger(baseVersion) || baseVersion < 0) {
      return res.status(400).json({ error: 'baseVersion must be a non-negative integer.' });
    }

    // ── load doc ───────────────────────────────────────────────────────────
    const { apply, rebase } = require('../ot/transform');
    const doc = await Document.findById(id).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    if (baseVersion > doc.version) {
      return res.status(409).json({ error: 'baseVersion is ahead of document.' });
    }

    // ── build op ───────────────────────────────────────────────────────────
    let op;

    if (instruction) {
      // Gemini path: generate new text then build a replace op
      if (typeof instruction !== 'string' || instruction.trim().length === 0) {
        return res.status(400).json({ error: 'instruction must be a non-empty string.' });
      }
      if (instruction.length > 2000) {
        return res.status(400).json({ error: 'instruction too long (max 2000 chars).' });
      }

      const { rewriteWithGemini } = require('../services/gemini');
      const newText = await rewriteWithGemini(doc.content, instruction.trim());

      op = {
        type:     'replace',
        position: 0,
        length:   doc.content.length,
        text:     newText,
        clientId: 'gemini-agent',
        version:  baseVersion,
      };
    } else {
      // Raw op path
      const check = validateOp(rawOp);
      if (!check.valid) return res.status(400).json({ error: `Bad op: ${check.reason}` });
      op = rawOp;
    }

    // ── rebase + apply ─────────────────────────────────────────────────────
    const rebased = rebase(op, doc.history, baseVersion);
    const newContent = apply(doc.content, rebased);

    if (newContent.length > CONTENT_MAX) {
      return res.status(413).json({ error: 'Document size limit exceeded.' });
    }

    const newVersion = doc.version + 1;
    rebased.version  = newVersion;
    rebased.clientId = (op.clientId || 'agent').trim().slice(0, 128);

    await Document.findByIdAndUpdate(id, {
      $set:  { content: newContent, version: newVersion },
      $push: { history: { $each: [rebased], $slice: -50000 } },
    });

    const io = req.app.get('io');
    if (io) io.to(id).emit('op', { op: rebased, version: newVersion });

    console.log(`[agent-rewrite] doc=${id} v${newVersion} via ${instruction ? 'gemini' : 'raw-op'}`);
    return res.json({ version: newVersion, op: rebased });
  } catch (err) {
    console.error('[POST /docs/:id/agent-rewrite]', err.message);
    // Surface Gemini-specific errors clearly
    if (err.message?.includes('GEMINI_API_KEY')) {
      return res.status(500).json({ error: 'Gemini API key not configured on server.' });
    }
    if (err.message?.includes('API_KEY_INVALID') || err.status === 400) {
      return res.status(502).json({ error: 'Gemini API key is invalid.' });
    }
    return res.status(500).json({ error: 'Could not apply agent rewrite.' });
  }
});

// ─── DELETE /docs/:id — remove a document ─────────────────────────────────────
router.delete('/:id', writeLimiter, async (req, res) => {
  try {
    const secret = req.headers['x-agent-secret'];
    if (!AGENT_SECRET || secret !== AGENT_SECRET) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid document id.' });

    const doc = await Document.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    return res.json({ deleted: true, id });
  } catch (err) {
    console.error('[DELETE /docs/:id]', err.message);
    return res.status(500).json({ error: 'Could not delete document.' });
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function sanitizeId(id) {
  if (typeof id !== 'string') return null;
  const t = id.trim();
  if (/^[a-f0-9]{24}$/.test(t) || /^[a-zA-Z0-9_-]{1,64}$/.test(t)) return t;
  return null;
}

function sanitizeString(val, fallback, max) {
  if (typeof val !== 'string') return fallback;
  const t = val.trim().slice(0, max);
  return t.length ? t : fallback;
}

function clampInt(val, def, min, max) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// Strip history and __v from API responses
function safeDoc(doc) {
  const { history, __v, ...safe } = doc.toObject ? doc.toObject() : doc;
  return safe;
}

module.exports = router;
