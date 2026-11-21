require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const attachDocHandler = require('./socket/docHandler');

const app = express();
app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── HTTP + Socket.io server ───────────────────────────────────────────────────
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',       // tighten in production
    methods: ['GET', 'POST'],
  },
});

attachDocHandler(io);

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('[mongo] connected');
    const PORT = process.env.PORT || 4000;
    httpServer.listen(PORT, () =>
      console.log(`[server] listening on http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error('[mongo] connection failed:', err.message);
    process.exit(1);
  });
