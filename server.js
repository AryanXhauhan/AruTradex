/* =========================
   server.js — ARUTRADEX Production Server
   Advanced Trading Platform with Firebase Auth & Redis Sessions
   ========================= */

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const axios = require('axios');

// Firebase Admin SDK
const admin = require('firebase-admin');

// Redis for session management
const Redis = require('ioredis');

// Technical Indicators
const { SMA, EMA, RSI, MACD, BollingerBands } = require('technicalindicators');

// AruAlgo for VIP Signals
const AruAlgo = require('./arualgo-chart/indicators/arualgo_v6_7.js');

/* -------------------- Configuration -------------------- */

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 8081;

/* -------------------- Redis Setup -------------------- */

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

/* -------------------- Firebase Admin Setup -------------------- */

// Initialize Firebase Admin (uncomment when you have serviceAccount.json)
/*
const serviceAccount = require('./config/serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
*/

// Temporary initialization (for development without Firebase)
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
    console.log('✅ Firebase Admin initialized');
  }
} catch (err) {
  console.log('⚠️  Firebase Admin not configured (optional for dev)');
}

/* -------------------- Middleware -------------------- */

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] ${req.method} ${req.path}`);
  next();
});

/* -------------------- Firebase Auth Middleware -------------------- */

async function verifyFirebaseToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1] || req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'No authentication token provided' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/* -------------------- Session Management with Redis -------------------- */

async function getSession(sessionId) {
  try {
    const data = await redis.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Session get error:', error);
    return null;
  }
}

async function setSession(sessionId, data, ttl = 3600) {
  try {
    await redis.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Session set error:', error);
    return false;
  }
}

async function deleteSession(sessionId) {
  try {
    await redis.del(`session:${sessionId}`);
    return true;
  } catch (error) {
    console.error('Session delete error:', error);
    return false;
  }
}

/* -------------------- Static File Serving -------------------- */

// Main static directory
app.use(express.static(path.join(__dirname)));

// Subdirectory routes
app.use('/home', express.static(path.join(__dirname, 'home')));
app.use('/pricing', express.static(path.join(__dirname, 'home', 'pricing')));
app.use('/login', express.static(path.join(__dirname, 'login')));
app.use('/signup', express.static(path.join(__dirname, 'signup')));
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

/* -------------------- HTML Routes -------------------- */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'home', 'home.html'));
});

app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'home', 'home.html'));
});

app.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, 'home', 'pricing', 'pricing.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login', 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'signup', 'signup.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'dashboard.html'));
});

/* -------------------- API Endpoints -------------------- */

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'ARUTRADEX server running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    redis: redis.status,
    version: '1.0.0'
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'server updated', timestamp: new Date().toISOString() });
});

// Batch Predict Endpoint for VIP Signals
app.post('/batch_predict', async (req, res) => {
  try {
    const { symbol, timeframes, limit } = req.body;
    if (!symbol || !timeframes || !Array.isArray(timeframes)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Clean symbol (remove exchange prefix like BINANCE:)
    const cleanSymbol = symbol.replace(/^[^:]*:/, '');

    const predictions = [];

    for (const tf of timeframes) {
      // Map timeframe to Binance interval
      const intervalMap = {
        '1m': '1m',
        '5m': '5m',
        '15m': '15m',
        '1h': '1h',
        '4h': '4h'
      };
      const interval = intervalMap[tf] || '1h';

      // Fetch klines from Binance
      const response = await axios.get(
        `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${limit || 300}`
      );
      const klines = response.data;

      // Convert klines to candle format
      const candles = klines.map(k => ({
        time: parseInt(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));

      const aruAlgo = new AruAlgo();
      let lastResult = null;
      for (const candle of candles) {
        lastResult = aruAlgo.processCandle(candle);
      }

      if (!lastResult || !lastResult.ready) {
        predictions.push({ timeframe: tf, label: 'none', confidence: 0 });
        continue;
      }

      // Check for signals in signalLabels
      const signals = lastResult.signalLabels || [];
      let label = 'none';
      let confidence = 0;
      let entry = lastResult.close;
      let sl = lastResult.lastSL;
      let tp = lastResult.lastTP;

      if (signals.length > 0) {
        // Take the latest signal
        const latestSignal = signals[signals.length - 1];
        if (latestSignal.type.includes('Buy')) {
          label = 'long';
          confidence = 0.9;
        } else if (latestSignal.type.includes('Sell')) {
          label = 'short';
          confidence = 0.9;
        }
        entry = latestSignal.price;
        sl = latestSignal.sl;
        tp = latestSignal.tp;
      }

      predictions.push({
        timeframe: tf,
        label,
        confidence,
        entry,
        sl,
        tp
      });
    }

    res.json({ predictions });
  } catch (error) {
    console.error('Batch predict error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile (protected route)
app.get('/api/user/profile', verifyFirebaseToken, async (req, res) => {
  try {
    const userRecord = await admin.auth().getUser(req.user.uid);
    res.json({
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      emailVerified: userRecord.emailVerified
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Session endpoints
app.post('/api/session/create', async (req, res) => {
  const { userId, data } = req.body;
  const sessionId = `${userId}_${Date.now()}`;
  
  const success = await setSession(sessionId, data, 7200); // 2 hours
  
  if (success) {
    res.cookie('sessionId', sessionId, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7200000 
    });
    res.json({ success: true, sessionId });
  } else {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.get('/api/session/get', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'No session found' });
  }
  
  const sessionData = await getSession(sessionId);
  
  if (sessionData) {
    res.json({ success: true, data: sessionData });
  } else {
    res.status(404).json({ error: 'Session expired or not found' });
  }
});

app.delete('/api/session/destroy', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  
  if (sessionId) {
    await deleteSession(sessionId);
    res.clearCookie('sessionId');
  }
  
  res.json({ success: true, message: 'Session destroyed' });
});

// Market data proxy (to avoid CORS issues)
app.get('/api/market/ticker/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    
    // Cache in Redis for 10 seconds
    await redis.setex(`market:${symbol}`, 10, JSON.stringify(response.data));
    
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

app.get('/api/market/klines/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = '1h', limit = 100 } = req.query;
    
    const response = await axios.get(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch klines data' });
  }
});

// Technical Indicators API
app.post('/api/indicators/sma', (req, res) => {
  try {
    const { values, period = 14 } = req.body;
    const result = SMA.calculate({ period, values });
    res.json({ indicator: 'SMA', period, result });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input for SMA calculation' });
  }
});

app.post('/api/indicators/ema', (req, res) => {
  try {
    const { values, period = 14 } = req.body;
    const result = EMA.calculate({ period, values });
    res.json({ indicator: 'EMA', period, result });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input for EMA calculation' });
  }
});

app.post('/api/indicators/rsi', (req, res) => {
  try {
    const { values, period = 14 } = req.body;
    const result = RSI.calculate({ period, values });
    res.json({ indicator: 'RSI', period, result });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input for RSI calculation' });
  }
});

app.post('/api/indicators/macd', (req, res) => {
  try {
    const { values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9 } = req.body;
    const result = MACD.calculate({ 
      values, 
      fastPeriod, 
      slowPeriod, 
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false 
    });
    res.json({ indicator: 'MACD', result });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input for MACD calculation' });
  }
});

app.post('/api/indicators/bollinger', (req, res) => {
  try {
    const { values, period = 20, stdDev = 2 } = req.body;
    const result = BollingerBands.calculate({ period, values, stdDev });
    res.json({ indicator: 'BollingerBands', period, stdDev, result });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input for Bollinger Bands calculation' });
  }
});

/* -------------------- WebSocket Server for Real-Time Data -------------------- */

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws, req) => {
  console.log(`🔌 WebSocket client connected from ${req.socket.remoteAddress}`);
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'subscribe') {
        const { symbol } = data;
        console.log(`📊 Client subscribed to ${symbol}`);
        
        // Send initial data
        const response = await axios.get(
          `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
        );
        
        ws.send(JSON.stringify({
          type: 'ticker',
          symbol,
          data: response.data
        }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
  });
  
  // Heartbeat mechanism
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// WebSocket heartbeat check every 30 seconds
const wsInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(wsInterval);
});

/* -------------------- Error Handling -------------------- */

// 404 Handler
app.use((req, res, next) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 - Page Not Found | ARUTRADEX</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          color: white;
        }
        .container {
          text-align: center;
          padding: 2rem;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        h1 { font-size: 8rem; margin-bottom: 1rem; font-weight: 900; }
        h2 { font-size: 2rem; margin-bottom: 1rem; }
        p { font-size: 1.2rem; margin-bottom: 2rem; opacity: 0.9; }
        a {
          display: inline-block;
          padding: 1rem 2rem;
          background: white;
          color: #667eea;
          text-decoration: none;
          border-radius: 50px;
          font-weight: 600;
          transition: transform 0.3s;
        }
        a:hover { transform: scale(1.05); }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>404</h1>
        <h2>Page Not Found</h2>
        <p>The page you're looking for doesn't exist.</p>
        <a href="/">← Return to Home</a>
      </div>
    </body>
    </html>
  `);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  res.status(500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal Server Error' 
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

/* -------------------- Server Startup -------------------- */

const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║            🚀 ARUTRADEX SERVER v1.0 🚀               ║
║                                                       ║
║  Status:     ✅ Running                               ║
║  HTTP Port:  ${PORT}                                      ║
║  WS Port:    ${WS_PORT}                                     ║
║  URL:        http://localhost:${PORT}                     ║
║  WebSocket:  ws://localhost:${WS_PORT}                     ║
║  Time:       ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}       ║
║  Node:       ${process.version}                                ║
║  Env:        ${process.env.NODE_ENV || 'development'}                        ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
  `);
  
  console.log('\n📦 Dependencies Loaded:');
  console.log('   • Express 5.1.0');
  console.log('   • Firebase Admin 13.4.0');
  console.log('   • Redis (ioredis) 5.7.0');
  console.log('   • WebSocket (ws) 8.18.3');
  console.log('   • Technical Indicators 3.1.0');
  console.log('   • Axios 1.12.1');
  
  console.log('\n🌐 Available Routes:');
  console.log('   • http://localhost:' + PORT + '/');
  console.log('   • http://localhost:' + PORT + '/home');
  console.log('   • http://localhost:' + PORT + '/pricing');
  console.log('   • http://localhost:' + PORT + '/login');
  console.log('   • http://localhost:' + PORT + '/signup');
  console.log('   • http://localhost:' + PORT + '/dashboard');
  
  console.log('\n🔌 API Endpoints:');
  console.log('   • GET  /api/health');
  console.log('   • GET  /api/user/profile (protected)');
  console.log('   • POST /api/session/create');
  console.log('   • GET  /api/market/ticker/:symbol');
  console.log('   • POST /api/indicators/rsi');
  console.log('   • POST /api/indicators/macd');
  
  console.log('\n💡 Press Ctrl+C to stop the server\n');
});

/* -------------------- Graceful Shutdown -------------------- */

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  console.log('\n⚠️  Shutting down gracefully...');
  
  // Close WebSocket server
  wss.close(() => {
    console.log('✅ WebSocket server closed');
  });
  
  // Close HTTP server
  server.close(async () => {
    console.log('✅ HTTP server closed');
    
    // Close Redis connection
    await redis.quit();
    console.log('✅ Redis connection closed');
    
    console.log('✅ ARUTRADEX server shut down successfully');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('❌ Forcing shutdown...');
    process.exit(1);
  }, 10000);
}

module.exports = app;
