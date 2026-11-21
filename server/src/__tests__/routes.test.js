/**
 * Route tests — uses a real in-memory Express app but mocks Mongoose
 * so no MongoDB connection is needed.
 */

process.env.AGENT_SECRET = 'test-secret';
process.env.MONGO_URI    = 'mongodb://localhost/test'; // never actually connected

const express    = require('express');
const request    = require('supertest');
const Document   = require('../models/Document');

// ── mock Mongoose model ───────────────────────────────────────────────────────
jest.mock('../models/Document', () => {
  const docs = new Map();
  let counter = 1;

  function makeId() { return String(counter++).padStart(24, '0'); }

  const LIMITS = {
    TITLE_MAX: 300, CONTENT_MAX: 2_000_000,
    CLIENT_ID_MAX: 128, HISTORY_MAX: 50_000, TEXT_OP_MAX: 100_000,
  };

  // minimal lean() / toObject() shim
  function wrap(obj) {
    return {
      ...obj,
      toObject() { return { ...obj }; },
      lean() { return { ...obj }; },
    };
  }

  const Model = {
    LIMITS,
    create: jest.fn(async (data) => {
      const id = data._id || makeId();
      const doc = { _id: id, title: data.title || 'Untitled', content: '', version: 0, history: [], createdAt: new Date(), updatedAt: new Date() };
      docs.set(id, doc);
      return wrap(doc);
    }),
    find: jest.fn(() => ({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [...docs.values()].map(d => ({ ...d })) }) }) }),
    })),
    findById: jest.fn((id) => {
      const d = docs.get(String(id));
      // Return a thenable with .lean() so routes can do findById(id).lean()
      const result = {
        lean: () => Promise.resolve(d ? { ...d } : null),
      };
      return result;
    }),
    findByIdAndUpdate: jest.fn((id, update, opts) => {
      const d = docs.get(String(id));
      if (d) {
        if (update.$set) Object.assign(d, update.$set);
        if (update.$push?.history) d.history.push(update.$push.history);
        docs.set(String(id), d);
      }
      return {
        lean: () => Promise.resolve(d ? { ...d } : null),
      };
    }),
    findByIdAndDelete: jest.fn((id) => {
      const d = docs.get(String(id));
      if (d) docs.delete(String(id));
      return Promise.resolve(d ? { ...d } : null);
    }),
    // reset between tests
    _reset() { docs.clear(); counter = 1; },
  };

  return Model;
});

// ── build app without starting server ────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.set('io', null); // no socket in tests

  // skip rate-limit in tests
  jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());

  const docsRouter = require('../routes/docs');
  app.use('/docs', docsRouter);
  return app;
}

let app;

beforeAll(() => { app = buildApp(); });
beforeEach(() => { Document._reset(); });

// ─── POST /docs ───────────────────────────────────────────────────────────────
describe('POST /docs', () => {
  test('creates a document with default title', async () => {
    const res = await request(app).post('/docs').send({});
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Untitled');
    expect(res.body._id).toBeDefined();
    expect(res.body.history).toBeUndefined(); // stripped from response
  });

  test('creates a document with custom title', async () => {
    const res = await request(app).post('/docs').send({ title: 'My Doc' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('My Doc');
  });

  test('title over 300 chars is truncated not rejected', async () => {
    const res = await request(app).post('/docs').send({ title: 'x'.repeat(400) });
    expect(res.status).toBe(201);
    expect(res.body.title.length).toBeLessThanOrEqual(300);
  });

  test('non-string title falls back to Untitled', async () => {
    const res = await request(app).post('/docs').send({ title: { $gt: '' } });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Untitled');
  });
});

// ─── GET /docs ────────────────────────────────────────────────────────────────
describe('GET /docs', () => {
  test('returns doc list', async () => {
    await request(app).post('/docs').send({ title: 'A' });
    await request(app).post('/docs').send({ title: 'B' });
    const res = await request(app).get('/docs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.docs)).toBe(true);
  });
});

// ─── GET /docs/:id ────────────────────────────────────────────────────────────
describe('GET /docs/:id', () => {
  test('returns existing doc', async () => {
    const created = (await request(app).post('/docs').send({ title: 'T' })).body;
    const res = await request(app).get(`/docs/${created._id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('T');
    expect(res.body.history).toBeUndefined();
  });

  test('returns 404 for unknown id', async () => {
    const res = await request(app).get('/docs/000000000000000000000001');
    expect(res.status).toBe(404);
  });

  test('returns 400 for injected id', async () => {
    // Express strips path traversal sequences, so test a NoSQL-style id instead
    const res = await request(app).get('/docs/' + encodeURIComponent('{"$gt":""}'));
    expect(res.status).toBe(400);
  });
});

// ─── PATCH /docs/:id/title ────────────────────────────────────────────────────
describe('PATCH /docs/:id/title', () => {
  test('renames a document', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app)
      .patch(`/docs/${created._id}/title`)
      .send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
  });

  test('returns 400 when title missing', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app)
      .patch(`/docs/${created._id}/title`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 for bad id', async () => {
    // Use an id with special chars that our sanitizer rejects
    const res = await request(app)
      .patch('/docs/' + encodeURIComponent('{"$gt":""}') + '/title')
      .send({ title: 'x' });
    expect(res.status).toBe(400);
  });
});

// ─── POST /docs/:id/agent-rewrite ─────────────────────────────────────────────
describe('POST /docs/:id/agent-rewrite', () => {
  const validOp = {
    type: 'insert', position: 0, text: 'Hello', clientId: 'agent', version: 0,
  };

  test('returns 401 without secret', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app)
      .post(`/docs/${created._id}/agent-rewrite`)
      .send({ op: validOp, baseVersion: 0 });
    expect(res.status).toBe(401);
  });

  test('returns 401 with wrong secret', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app)
      .post(`/docs/${created._id}/agent-rewrite`)
      .set('x-agent-secret', 'wrong')
      .send({ op: validOp, baseVersion: 0 });
    expect(res.status).toBe(401);
  });

  test('applies valid agent op', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app)
      .post(`/docs/${created._id}/agent-rewrite`)
      .set('x-agent-secret', 'test-secret')
      .send({ op: validOp, baseVersion: 0 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
  });

  test('returns 400 for invalid op shape', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app)
      .post(`/docs/${created._id}/agent-rewrite`)
      .set('x-agent-secret', 'test-secret')
      .send({ op: { type: 'insert', position: -1, text: 'x', clientId: 'a', version: 0 }, baseVersion: 0 });
    expect(res.status).toBe(400);
  });

  test('returns 409 when baseVersion is ahead of document', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app)
      .post(`/docs/${created._id}/agent-rewrite`)
      .set('x-agent-secret', 'test-secret')
      .send({ op: validOp, baseVersion: 99 });
    expect(res.status).toBe(409);
  });
});

// ─── DELETE /docs/:id ─────────────────────────────────────────────────────────
describe('DELETE /docs/:id', () => {
  test('returns 401 without secret', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app).delete(`/docs/${created._id}`);
    expect(res.status).toBe(401);
  });

  test('deletes with valid secret', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    const res = await request(app)
      .delete(`/docs/${created._id}`)
      .set('x-agent-secret', 'test-secret');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  test('returns 404 for already-deleted doc', async () => {
    const created = (await request(app).post('/docs').send({})).body;
    await request(app).delete(`/docs/${created._id}`).set('x-agent-secret', 'test-secret');
    const res = await request(app).delete(`/docs/${created._id}`).set('x-agent-secret', 'test-secret');
    expect(res.status).toBe(404);
  });
});
