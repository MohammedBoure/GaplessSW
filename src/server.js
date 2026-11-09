/**
 * Gapless Main Server & Real-Time WebSocket Hub
 *
 * Mounts:
 * - `/`       -> Mobile-first Client Gateway & Discovery Chat Interface
 * - `/admin`  -> Admin Management Dashboard (PINs, Custom Context, Lockouts, Security Audit)
 * - `/dev`    -> Developer Co-Pilot Live Dashboard (Ghost Mode, Secret Notes, One-Click PRD)
 */
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const config = require('./config');
const { verifyToken } = require('./security/auth');
const { ensureSandboxEnvironment } = require('./security/sandbox');
const { PinRepo } = require('./db/repository');
const createClientRouter = require('./routes/client');
const createAdminRouter = require('./routes/admin');
const createDevRouter = require('./routes/dev');

// Ensure strict sandbox directory and PreToolUse gate exist on startup
ensureSandboxEnvironment();

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Security headers via Helmet (configured to allow inline scripts/styles, Google Fonts, and HTTP network origins)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    hsts: false
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static assets & uploaded wireframes
app.use('/uploads', express.static(config.UPLOADS_DIR));
app.use(express.static(config.PUBLIC_DIR));

// Mount API routers
app.use('/api/client', createClientRouter(io));
app.use('/api/admin', createAdminRouter(io));
app.use('/api/dev', createDevRouter(io));

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Gapless Requirements Discovery Engine',
    sandboxActive: true,
    timestamp: Date.now()
  });
});

// Page routes
app.get('/', (_req, res) => {
  res.sendFile(path.join(config.PUBLIC_DIR, 'index.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(config.PUBLIC_DIR, 'admin.html'));
});

app.get('/dev', (_req, res) => {
  res.sendFile(path.join(config.PUBLIC_DIR, 'dev.html'));
});

// Socket.IO Real-Time Collaboration & Monitoring
const activeClientSockets = new Map(); // pinId -> Set of socket.id

function broadcastOnlineClients() {
  const onlinePinIds = [];
  for (const [pinId, set] of activeClientSockets.entries()) {
    if (set.size > 0) onlinePinIds.push(pinId);
  }
  io.to('dev_monitors').emit('dev:online_pins', onlinePinIds);
}

io.on('connection', (socket) => {
  // Client joins their PIN room
  socket.on('client:join', ({ token }) => {
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'client') return;

    const pinRecord = PinRepo.getById(payload.pinId);
    if (!pinRecord || pinRecord.status !== 'active') return;

    socket.pinId = pinRecord.id;
    socket.join(`pin:${pinRecord.id}`);

    if (!activeClientSockets.has(pinRecord.id)) {
      activeClientSockets.set(pinRecord.id, new Set());
    }
    activeClientSockets.get(pinRecord.id).add(socket.id);
    broadcastOnlineClients();
  });

  // Client live typing indicator forwarded to Developer Co-Pilot
  socket.on('client:typing', ({ isTyping }) => {
    if (!socket.pinId) return;
    io.to('dev_monitors').emit('dev:client_typing', {
      pinId: socket.pinId,
      isTyping: Boolean(isTyping)
    });
  });

  // Developer / Admin joins monitoring room
  socket.on('dev:join', ({ token }) => {
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') return;

    socket.isDevMonitor = true;
    socket.join('dev_monitors');
    broadcastOnlineClients();
  });

  // Developer typing indicator in Ghost Mode (optional preview)
  socket.on('dev:ghost_typing', ({ pinId, isTyping }) => {
    if (!socket.isDevMonitor || !pinId) return;
    io.to(`pin:${pinId}`).emit('chat:typing', {
      isTyping: Boolean(isTyping),
      sender: 'ai'
    });
  });

  socket.on('disconnect', () => {
    if (socket.pinId && activeClientSockets.has(socket.pinId)) {
      const set = activeClientSockets.get(socket.pinId);
      set.delete(socket.id);
      if (set.size === 0) {
        activeClientSockets.delete(socket.pinId);
      }
      broadcastOnlineClients();
    }
  });
});

if (require.main === module) {
  const { execSync } = require('child_process');

  function getNetworkAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
    return addresses;
  }

  function startServer() {
    server.listen(config.PORT, config.HOST, () => {
      const netIps = getNetworkAddresses();
      console.log(`=============================================================`);
      console.log(`🚀 Gapless System running on http://${config.HOST}:${config.PORT}`);
      console.log(`   - Local Client Gateway:        http://localhost:${config.PORT}/`);
      console.log(`   - Local Admin Dashboard:       http://localhost:${config.PORT}/admin`);
      console.log(`   - Local Developer Co-Pilot:    http://localhost:${config.PORT}/dev`);
      for (const ip of netIps) {
        console.log(`   - Network Client Gateway:      http://${ip}:${config.PORT}/`);
        console.log(`   - Network Admin Dashboard:     http://${ip}:${config.PORT}/admin`);
        console.log(`   - Network Developer Co-Pilot:  http://${ip}:${config.PORT}/dev`);
      }
      console.log(`=============================================================`);
    });
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${config.PORT} is busy. Freeing previous process on port ${config.PORT}...`);
      try {
        execSync(`fuser -k ${config.PORT}/tcp 2>/dev/null || true`);
      } catch {
        // ignore
      }
      setTimeout(() => {
        server.close();
        startServer();
      }, 600);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  startServer();
}

module.exports = { app, server, io };
