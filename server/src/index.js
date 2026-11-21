require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const attachDocHandler = require('./socket/docHandler');

// ─── CORS origin from env ─────────────────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

const app = express();

// ── Security middleware ───────────────────────────────────────────────────────

// Only allow requests from our front-end origin
app.use(cors({ origin: ALLOWED_ORIGIN, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));

// Parse JSON but cap body size — prevents memory-exhaustion via huge payloads
app.use(express.json({ limit: '256kb' }));

// Global rate-limit: 300 requests / 1 min per IP
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, slow down.' },
  })
);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── HTTP + Socket.io server ───────────────────────────────────────────────────
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
  // Reject any single socket message larger than 1 MB
  maxHttpBufferSize: 1e6,
});

attachDocHandler(io);

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI, {
    // Block NoSQL injection: strips $ and . from query filter keys
    sanitizeFilter: true,
  })
  .then(() => {
    console.log('[mongo] connected — sanitizeFilter: ON');
    const PORT = process.env.PORT || 4000;
    httpServer.listen(PORT, () =>
      console.log(`[server] listening on http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error('[mongo] connection failed:', err.message);
    process.exit(1);
  });
