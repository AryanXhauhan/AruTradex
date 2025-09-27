// server.js
// Node 16+
// npm i express ws axios body-parser

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');

const AruAlgo = require('./indicators/arualgo_v6_7'); // ensure this exists

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // serve index.html and assets

const server = http.createServer(app);

// NOTE: create WebSocket.Server without path restriction so client can connect to ws://host:port OR ws://host:port/ws
const wss = new WebSocket.Server({ server });

// ---------------- In-memory stores (swap with Redis in prod) ----------------
const users = new Map(); // sessionId -> { userId, premiumUntil: epochMillis }
const connections = new Map(); // ws -> { sessionId, subscriptions: Set<key> }
const indicatorInstances = new Map(); // key = symbol::interval -> AruAlgo instance
const currentCandles = new Map(); // key = symbol::interval -> [candles]
const feeders = new Map(); // key -> { ws }

// ---------------- Helpers ----------------
function keyFor(symbol, interval) {
  return `${symbol.toUpperCase()}::${interval}`;
}

function isPremium(sessionId) {
  const u = users.get(sessionId);
  return !!(u && u.premiumUntil && u.premiumUntil > Date.now());
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch(_) { return null; }
}

function createSubKey(symbol, indicator) {
  return `${symbol.toUpperCase()}::${indicator || ''}`;
}

function parseCandle(input) {
  if (!input) return null;
  const { time, open, high, low, close, volume } = input;
  if (time == null || open == null || high == null || low == null || close == null) return null;
  return {
    time: Number(time),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume ?? 0)
  };
}

// Broadcast to all connected WS clients (safe)
function broadcastAll(obj) {
  const payload = JSON.stringify(obj);
  for (const [ws] of connections.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(payload); } catch (err) { console.warn('broadcastAll send error', err && err.message); }
    }
  }
}

// Broadcast indicator updates only to clients subscribed to that indicator
function broadcastIndicator(symbol, interval, indicatorName, payload) {
  const key = createSubKey(keyFor(symbol, interval), indicatorName); // subscribers subscribe by symbol::interval::indicator
  const payloadMsg = JSON.stringify({ type: 'indicator_update', symbol, interval, indicator: indicatorName, data: payload });
  for (const [ws, meta] of connections.entries()) {
    if (!meta || !meta.subscriptions) continue;
    if (meta.subscriptions.has(key)) {
      if (!isPremium(meta.sessionId)) {
        try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'error', reason:'premium_expired' })); } catch(_) {}
        meta.subscriptions.delete(key);
        continue;
      }
      try { if (ws.readyState === WebSocket.OPEN) ws.send(payloadMsg); } catch(err) { console.warn('broadcastIndicator send failed', err && err.message); }
    }
  }
}

// ---------------- WebSocket server for frontends ----------------
wss.on('connection', (ws, req) => {
  // Accept connections from both ws://host:port and ws://host:port/ws
  const remote = req.socket.remoteAddress + ':' + req.socket.remotePort;
  console.log('WS connection incoming from', remote, 'url:', req.url);

  connections.set(ws, { sessionId: null, subscriptions: new Set() });
  ws.isAlive = true;
  ws.on('pong', function () { this.isAlive = true; });

  // send welcome (only if open)
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'welcome', msg: 'connected to arualgo feed' }));
  }

  ws.on('message', (raw) => {
    const msg = typeof raw === 'string' ? safeJsonParse(raw) : null;
    if (!msg || !msg.type) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'error', reason:'invalid_message' }));
      return;
    }
    const meta = connections.get(ws);

    if (msg.type === 'auth') {
      const sid = msg.sessionId || ('guest-' + Math.random().toString(36).slice(2,8));
      meta.sessionId = sid;
      if (!users.has(sid)) {
        users.set(sid, { userId: sid, premiumUntil: msg.demoPremium ? Date.now() + 5*60*1000 : 0 });
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'auth_ok', sessionId: sid, premium: isPremium(sid) }));
      return;
    }

    if (msg.type === 'subscribe') {
      // subscribe to symbol + interval + optional indicator name
      const symbol = (msg.symbol || 'BTCUSDT').toUpperCase();
      const interval = msg.interval || '1m';
      const indicator = msg.indicator || null;

      // if indicator requested, require premium
      if (indicator && !isPremium(meta.sessionId)) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'error', reason:'indicator_requires_premium' }));
        return;
      }

      // ensure feeder exists
      startFeeder(symbol, interval);

      const subKey = createSubKey(keyFor(symbol, interval), indicator);
      meta.subscriptions.add(subKey);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'subscribed', symbol, interval, indicator }));
      return;
    }

    if (msg.type === 'unsubscribe') {
      const symbol = (msg.symbol || 'BTCUSDT').toUpperCase();
      const interval = msg.interval || '1m';
      const indicator = msg.indicator || null;
      const subKey = createSubKey(keyFor(symbol, interval), indicator);
      const m = connections.get(ws);
      if (m) m.subscriptions.delete(subKey);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'unsubscribed', symbol, interval, indicator }));
      return;
    }

    if (msg.type === 'get_snapshot') {
      const symbol = (msg.symbol || 'BTCUSDT').toUpperCase();
      const interval = msg.interval || '1m';
      const limit = Math.min(1000, msg.limit || 500);
      const arr = currentCandles.get(keyFor(symbol, interval)) || [];
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'snapshot', symbol, interval, data: arr.slice(-limit) }));
      return;
    }

    if (msg.type === 'ping') {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'pong' }));
      return;
    }

    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'error', reason:'unknown_type' }));
  });

  ws.on('close', (code, reason) => {
    connections.delete(ws);
    console.log('WS closed', remote, 'code:', code, 'reason:', reason && reason.toString && reason.toString());
  });

  ws.on('error', (err) => {
    connections.delete(ws);
    console.warn('client ws err', err && err.message);
  });
});

// heartbeat to drop dead sockets
const heartbeatInterval = setInterval(() => {
  for (const ws of connections.keys()) {
    if (ws.isAlive === false) {
      connections.delete(ws);
      try { ws.terminate(); } catch(_) {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(() => {}); } catch(_) {}
  }
}, 30000);

// ---------------- REST endpoints ----------------

// Health
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// History (Binance public REST)
const BINANCE_REST = 'https://api.binance.com';
app.get('/history', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const interval = req.query.interval || '1m';
    const limit = Math.min(1000, Number(req.query.limit || 500));
    const url = `${BINANCE_REST}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const r = await axios.get(url, { timeout: 10000 });
    const data = r.data.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5])
    }));
    currentCandles.set(keyFor(symbol, interval), data.slice(-1000));
    res.json({ ok: true, symbol, interval, data });
  } catch (err) {
    console.error('history err', err && err.message);
    res.status(500).json({ error: 'failed_fetch_history' });
  }
});

// Ingest (manual feeder or other source can POST closed candles)
app.post('/ingest', (req, res) => {
  try {
    const { symbol, interval, candle } = req.body;
    if (!symbol || !candle) return res.status(400).json({ error: 'symbol and candle required' });
    const sym = String(symbol).toUpperCase();
    const intv = String(interval || '1m');
    const ck = parseCandle(candle);
    if (!ck) return res.status(400).json({ error: 'invalid_candle' });

    // store into currentCandles
    const key = keyFor(sym, intv);
    const arr = currentCandles.get(key) || [];
    if (arr.length > 0 && arr[arr.length - 1].time === ck.time) arr[arr.length - 1] = ck;
    else arr.push(ck);
    if (arr.length > 2000) arr.shift();
    currentCandles.set(key, arr);

    // ensure indicator instance
    let inst = indicatorInstances.get(key);
    if (!inst) {
      inst = new AruAlgo();
      // seed from existing cached candles for better continuity
      const seed = currentCandles.get(key) || [];
      for (const c of seed) inst.processCandle(c);
      indicatorInstances.set(key, inst);
    }

    // feed closed candle into indicator
    const out = inst.processCandle(ck);
    if (out && out.ready) {
      // broadcast indicator update to subscribers
      broadcastIndicator(sym, intv, 'arualgo_v6_7', out);
    }

    // broadcast candle update to all clients for drawing
    broadcastAll({ type: 'candles_update', symbol: sym, interval: intv, candle: ck, isFinal: true });

    res.json({ ok: true });
  } catch (err) {
    console.error('ingest error', err && err.stack || err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Demo: grant/revoke premium (testing)
app.post('/demo/grant', (req, res) => {
  const { sessionId, minutes } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const mins = Number(minutes) || 10;
  users.set(sessionId, { userId: sessionId, premiumUntil: Date.now() + mins*60*1000 });
  res.json({ ok: true, sessionId, premiumUntil: users.get(sessionId).premiumUntil });
});
app.post('/demo/revoke', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  users.set(sessionId, { userId: sessionId, premiumUntil: 0 });
  res.json({ ok: true, sessionId });
});

// ---------------- Binance feeder (per symbol+interval) ----------------
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';

function startFeeder(symbol='BTCUSDT', interval='1m') {
  const key = keyFor(symbol, interval);
  if (feeders.has(key)) return;
  console.log('Starting feeder for', key);

  // seed candles may already exist (if /history called)
  const seedCandles = currentCandles.get(key) || [];

  // ensure indicator instance and seed it
  let inst = indicatorInstances.get(key);
  if (!inst) {
    inst = new AruAlgo();
    if (seedCandles.length > 0) {
      for (const c of seedCandles) inst.processCandle(c);
      console.log(`Seeded ${seedCandles.length} candles for ${key}`);
    }
    indicatorInstances.set(key, inst);
  }

  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  const url = `${BINANCE_WS_BASE}/${stream}`;
  const bws = new WebSocket(url);

  bws.on('open', () => console.log('Binance feeder connected for', key));
  bws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg || !msg.k) return;
      const k = msg.k;
      const candle = {
        time: Math.floor(k.t / 1000),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v)
      };
      const isFinal = !!k.x;

      // maintain cache
      let arr = currentCandles.get(key) || [];
      if (arr.length > 0 && arr[arr.length - 1].time === candle.time) arr[arr.length - 1] = candle;
      else {
        arr.push(candle);
        if (arr.length > 2000) arr.shift();
      }
      currentCandles.set(key, arr);

      // broadcast partial/updated candle to all clients
      broadcastAll({ type: 'candles_update', symbol, interval, candle, isFinal });

      // only process final candles through indicator to avoid repainting
      if (isFinal) {
        const instance = indicatorInstances.get(key);
        if (instance) {
          const out = instance.processCandle(candle);
          if (out && out.ready) {
            broadcastIndicator(symbol, interval, 'arualgo_v6_7', out);
          }
        }
      }
    } catch (err) {
      console.error('feeder parse err', err && err.message);
    }
  });

  bws.on('close', () => {
    console.log('Binance feeder closed for', key);
    feeders.delete(key);
    // try restart after short delay
    setTimeout(() => startFeeder(symbol, interval), 2000);
  });

  bws.on('error', (err) => {
    console.warn('Binance feeder error', err && err.message);
    try { bws.terminate(); } catch(_) {}
  });

  feeders.set(key, { ws: bws });
}

// Start default feeder
startFeeder('BTCUSDT', '1m');

// ---------------- Start server ----------------
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Cleanup
process.on('SIGINT', () => {
  console.log('shutting down...');
  clearInterval(heartbeatInterval);
  for (const f of feeders.values()) {
    try { f.ws.terminate(); } catch(_) {}
  }
  wss.close();
  server.close(() => process.exit(0));
});
