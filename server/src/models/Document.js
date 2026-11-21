const mongoose = require('mongoose');

// ─── limits (single source of truth — routes + socket import these) ───────────
const LIMITS = {
  TITLE_MAX: 300,
  CONTENT_MAX: 2_000_000,   // 2 MB of plain text per document
  CLIENT_ID_MAX: 128,
  HISTORY_MAX: 50_000,       // cap stored ops; older ops pruned on write
  TEXT_OP_MAX: 100_000,      // single insert payload
};

// ─── op sub-document ──────────────────────────────────────────────────────────
const opSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      required: true,
      trim: true,
      maxlength: LIMITS.CLIENT_ID_MAX,
    },
    type: {
      type: String,
      enum: ['insert', 'delete', 'replace'],
      required: true,
    },
    position: {
      type: Number,
      required: true,
      min: 0,
    },
    // insert payload
    text: {
      type: String,
      default: '',
      maxlength: LIMITS.TEXT_OP_MAX,
    },
    // delete payload
    length: {
      type: Number,
      default: 0,
      min: 0,
    },
    // document version AFTER this op was applied
    version: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }   // no per-op ObjectIds — saves space and leaks nothing
);

// ─── document ─────────────────────────────────────────────────────────────────
const documentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: 'Untitled',
      trim: true,
      maxlength: LIMITS.TITLE_MAX,
    },
    content: {
      type: String,
      default: '',
      maxlength: LIMITS.CONTENT_MAX,
    },
    version: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Full op log kept for OT rebase.
    // We keep at most HISTORY_MAX ops; a background prune can be added later.
    history: {
      type: [opSchema],
      default: [],
    },
  },
  {
    strict: true,          // reject any field not in the schema
    timestamps: true,      // createdAt / updatedAt
    versionKey: false,     // drop __v from all responses
  }
);

// ─── index ────────────────────────────────────────────────────────────────────
// Fast lookup by updatedAt for "recently active docs" queries
documentSchema.index({ updatedAt: -1 });

// ─── export limits so other modules stay in sync ─────────────────────────────
documentSchema.statics.LIMITS = LIMITS;

module.exports = mongoose.model('Document', documentSchema);
