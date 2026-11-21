const mongoose = require('mongoose');

// Each op in the history log
const opSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true }, // who sent it
    type: { type: String, enum: ['insert', 'delete'], required: true },
    position: { type: Number, required: true }, // character offset
    text: { type: String, default: '' },        // insert: chars added
    length: { type: Number, default: 0 },       // delete: chars removed
    version: { type: Number, required: true },  // doc version this op was based on
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    title: { type: String, default: 'Untitled' },
    content: { type: String, default: '' },   // canonical text
    version: { type: Number, default: 0 },    // increments on every applied op
    history: { type: [opSchema], default: [] }, // full op log for rebase
  },
  { timestamps: true }
);

module.exports = mongoose.model('Document', documentSchema);
