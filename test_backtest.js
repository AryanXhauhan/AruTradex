/* =========================
   test_backtest.js — Advanced AI Signal Generator with Live Data
   AruTradeX VIP Signals Backend
   ========================= */

// ============= CONFIGURATION =============
const CONFIG = {
  BINANCE_API: 'https://api.binance.com/api/v3',
  BINANCE_WS: 'wss://stream.binance.com:9443/ws',
  SYMBOLS: [
    { pair: 'BINANCE:BTCUSDT', symbol: 'BTCUSDT', label: 'BTC/USDT' },
    { pair: 'BINANCE:ETHUSDT', symbol: 'ETHUSDT', label: 'ETH/USDT' },
    { pair: 'BINANCE:BNBUSDT', symbol: 'BNBUSDT', label: 'BNB/USDT' },
    { pair: 'BINANCE:XRPUSDT', symbol: 'XRPUSDT', label: 'XRP/USDT' },
    { pair: 'BINANCE:DOGEUSDT', symbol: 'DOGEUSDT', label: 'DOGE/USDT' },
  ],
  TIMEFRAMES: {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1h': '1h',
    '4h': '4h'
  },
  INDICATORS: {
    RSI_PERIOD: 14,
    RSI_OVERBOUGHT: 70,
    RSI_OVERSOLD: 30,
    MACD_FAST: 12,
    MACD_SLOW: 26,
    MACD_SIGNAL: 9,
    EMA_SHORT: 20,
    EMA_LONG: 50,
    EMA_TREND: 200,
    ATR_PERIOD: 14,
    BB_PERIOD: 20,
    BB_STD: 2
  }
};

// ============= TECHNICAL INDICATORS =============

/**
 * Calculate Simple Moving Average (SMA)
 */
function calculateSMA(data, period) {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push(sum / period);
  }
  return result;
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const emaData = [data[0]];

  for (let i = 1; i < data.length; i++) {
    const ema = data[i] * k + emaData[i - 1] * (1 - k);
    emaData.push(ema);
  }
  return emaData;
}

/**
 * Calculate Relative Strength Index (RSI)
 */
function calculateRSI(data, period = 14) {
  const changes = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }

  const gains = changes.map(change => change > 0 ? change : 0);
  const losses = changes.map(change => change < 0 ? -change : 0);

  const avgGain = calculateSMA(gains, period);
  const avgLoss = calculateSMA(losses, period);

  const rsi = [];
  for (let i = 0; i < avgGain.length; i++) {
    if (avgLoss[i] === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain[i] / avgLoss[i];
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const emaFast = calculateEMA(data, fastPeriod);
  const emaSlow = calculateEMA(data, slowPeriod);

  const macdLine = [];
  for (let i = 0; i < emaFast.length && i < emaSlow.length; i++) {
    macdLine.push(emaFast[i] - emaSlow[i]);
  }

  const signalLine = calculateEMA(macdLine, signalPeriod);
  const histogram = [];

  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + macdLine.length - signalLine.length] - signalLine[i]);
  }

  return { macdLine, signalLine, histogram };
}

/**
 * Calculate Bollinger Bands
 */
function calculateBollingerBands(data, period = 20, stdDev = 2) {
  const sma = calculateSMA(data, period);
  const bands = [];

  for (let i = 0; i < sma.length; i++) {
    const dataSlice = data.slice(i, i + period);
    const mean = sma[i];
    const variance = dataSlice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const std = Math.sqrt(variance);

    bands.push({
      upper: mean + (std * stdDev),
      middle: mean,
      lower: mean - (std * stdDev)
    });
  }
  return bands;
}

/**
 * Calculate Average True Range (ATR)
 */
function calculateATR(high, low, close, period = 14) {
  const tr = [];
  for (let i = 1; i < high.length; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr.push(Math.max(hl, hc, lc));
  }
  return calculateSMA(tr, period);
}

// ============= DATA FETCHING =============

/**
 * Fetch candlestick data from Binance API
 */
async function fetchKlines(symbol, interval, limit = 300) {
  try {
    const url = `${CONFIG.BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json();

    return data.map(candle => ({
      time: candle[0],
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5])
    }));
  } catch (error) {
    console.error(`Error fetching klines for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get current price from Binance API
 */
async function getCurrentPrice(symbol) {
  try {
    const url = `${CONFIG.BINANCE_API}/ticker/price?symbol=${symbol}`;
    const response = await fetch(url);
    const data = await response.json();
    return parseFloat(data.price);
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    return null;
  }
}

// ============= SIGNAL GENERATION =============

/**
 * Generate trading signal based on multiple indicators
 */
function generateSignal(klines) {
  if (!klines || klines.length < 200) {
    return { label: 'none', confidence: 0, reason: 'Insufficient data' };
  }

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  // Calculate indicators
  const rsi = calculateRSI(closes, CONFIG.INDICATORS.RSI_PERIOD);
  const macd = calculateMACD(closes, CONFIG.INDICATORS.MACD_FAST, CONFIG.INDICATORS.MACD_SLOW, CONFIG.INDICATORS.MACD_SIGNAL);
  const ema20 = calculateEMA(closes, CONFIG.INDICATORS.EMA_SHORT);
  const ema50 = calculateEMA(closes, CONFIG.INDICATORS.EMA_LONG);
  const ema200 = calculateEMA(closes, CONFIG.INDICATORS.EMA_TREND);
  const bb = calculateBollingerBands(closes, CONFIG.INDICATORS.BB_PERIOD, CONFIG.INDICATORS.BB_STD);
  const atr = calculateATR(highs, lows, closes, CONFIG.INDICATORS.ATR_PERIOD);

  // Get latest values
  const currentRSI = rsi[rsi.length - 1];
  const currentMACD = macd.macdLine[macd.macdLine.length - 1];
  const currentSignal = macd.signalLine[macd.signalLine.length - 1];
  const currentHistogram = macd.histogram[macd.histogram.length - 1];
  const currentPrice = closes[closes.length - 1];
  const currentEMA20 = ema20[ema20.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];
  const currentEMA200 = ema200[ema200.length - 1];
  const currentBB = bb[bb.length - 1];
  const currentATR = atr[atr.length - 1];

  // Signal scoring system
  let longScore = 0;
  let shortScore = 0;
  let signals = [];

  // RSI Analysis (Weight: 20%)
  if (currentRSI < CONFIG.INDICATORS.RSI_OVERSOLD) {
    longScore += 20;
    signals.push('RSI Oversold');
  } else if (currentRSI > CONFIG.INDICATORS.RSI_OVERBOUGHT) {
    shortScore += 20;
    signals.push('RSI Overbought');
  } else if (currentRSI > 40 && currentRSI < 60) {
    longScore += 10;
    shortScore += 10;
  }

  // MACD Analysis (Weight: 25%)
  if (currentMACD > currentSignal && currentHistogram > 0) {
    longScore += 25;
    signals.push('MACD Bullish');
  } else if (currentMACD < currentSignal && currentHistogram < 0) {
    shortScore += 25;
    signals.push('MACD Bearish');
  }

  // Check for MACD crossover (extra weight)
  const prevHistogram = macd.histogram[macd.histogram.length - 2];
  if (currentHistogram > 0 && prevHistogram < 0) {
    longScore += 15;
    signals.push('MACD Bullish Crossover');
  } else if (currentHistogram < 0 && prevHistogram > 0) {
    shortScore += 15;
    signals.push('MACD Bearish Crossover');
  }

  // EMA Trend Analysis (Weight: 20%)
  if (currentPrice > currentEMA20 && currentEMA20 > currentEMA50 && currentEMA50 > currentEMA200) {
    longScore += 20;
    signals.push('Strong Uptrend');
  } else if (currentPrice < currentEMA20 && currentEMA20 < currentEMA50 && currentEMA50 < currentEMA200) {
    shortScore += 20;
    signals.push('Strong Downtrend');
  } else if (currentPrice > currentEMA50) {
    longScore += 10;
    signals.push('Above EMA50');
  } else if (currentPrice < currentEMA50) {
    shortScore += 10;
    signals.push('Below EMA50');
  }

  // Bollinger Bands Analysis (Weight: 15%)
  const bbWidth = (currentBB.upper - currentBB.lower) / currentBB.middle;
  if (currentPrice < currentBB.lower) {
    longScore += 15;
    signals.push('BB Oversold');
  } else if (currentPrice > currentBB.upper) {
    shortScore += 15;
    signals.push('BB Overbought');
  }

  // Volume Analysis (Weight: 10%)
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  if (currentVolume > avgVolume * 1.5) {
    if (longScore > shortScore) {
      longScore += 10;
      signals.push('High Volume Confirmation');
    } else if (shortScore > longScore) {
      shortScore += 10;
      signals.push('High Volume Confirmation');
    }
  }

  // Momentum Analysis (Weight: 10%)
  const momentum = closes[closes.length - 1] - closes[closes.length - 10];
  if (momentum > 0) {
    longScore += 10;
    signals.push('Positive Momentum');
  } else {
    shortScore += 10;
    signals.push('Negative Momentum');
  }

  // Determine final signal
  const totalScore = Math.max(longScore, shortScore);
  const confidence = Math.min(totalScore / 100, 0.99);

  let label = 'none';
  if (longScore > shortScore && confidence >= 0.55) {
    label = 'long';
  } else if (shortScore > longScore && confidence >= 0.55) {
    label = 'short';
  }

  // Calculate entry, stop loss, and take profit
  const entryPrice = currentPrice;
  const atrMultiplier = 2;
  const riskRewardRatio = 2.5;

  let stopLoss, takeProfit;
  if (label === 'long') {
    stopLoss = entryPrice - (currentATR * atrMultiplier);
    takeProfit = entryPrice + (currentATR * atrMultiplier * riskRewardRatio);
  } else if (label === 'short') {
    stopLoss = entryPrice + (currentATR * atrMultiplier);
    takeProfit = entryPrice - (currentATR * atrMultiplier * riskRewardRatio);
  } else {
    stopLoss = entryPrice;
    takeProfit = entryPrice;
  }

  return {
    label,
    confidence,
    entry: entryPrice,
    sl: stopLoss,
    tp: takeProfit,
    indicators: {
      rsi: currentRSI,
      macd: currentMACD,
      signal: currentSignal,
      ema20: currentEMA20,
      ema50: currentEMA50,
      ema200: currentEMA200,
      atr: currentATR
    },
    signals: signals.join(', '),
    longScore,
    shortScore
  };
}

/**
 * Generate signals for all timeframes
 */
async function batchPredict(symbol) {
  const predictions = [];

  for (const [tf, interval] of Object.entries(CONFIG.TIMEFRAMES)) {
    try {
      const klines = await fetchKlines(symbol, interval, 300);
      if (klines) {
        const signal = generateSignal(klines);
        predictions.push({
          timeframe: tf,
          ...signal
        });
      }
    } catch (error) {
      console.error(`Error generating signal for ${symbol} ${tf}:`, error);
      predictions.push({
        timeframe: tf,
        label: 'none',
        confidence: 0,
        entry: 0,
        sl: 0,
        tp: 0,
        error: error.message
      });
    }
  }

  return predictions;
}

// ============= MAIN EXECUTION =============

/**
 * Update all signals for all symbols
 */
async function updateAllSignals() {
  console.log('🚀 Starting signal generation...');
  const startTime = Date.now();

  const results = {};

  for (const symbolConfig of CONFIG.SYMBOLS) {
    console.log(`📊 Processing ${symbolConfig.label}...`);
    const predictions = await batchPredict(symbolConfig.symbol);
    results[symbolConfig.pair] = predictions;

    // Log summary
    const highConfSignals = predictions.filter(p => p.confidence >= 0.70);
    console.log(`   ✓ Generated ${predictions.length} signals (${highConfSignals.length} high-confidence)`);
  }

  const endTime = Date.now();
  console.log(`✅ Signal generation complete in ${endTime - startTime}ms\n`);

  return results;
}

/**
 * Display signals in console (for testing)
 */
function displaySignals(results) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('          VIP SIGNALS DASHBOARD');
  console.log('═══════════════════════════════════════════════════\n');

  for (const [pair, predictions] of Object.entries(results)) {
    console.log(`\n📈 ${pair}`);
    console.log('─'.repeat(50));

    predictions.forEach(pred => {
      const icon = pred.label === 'long' ? '🟢' : pred.label === 'short' ? '🔴' : '⚪';
      const confPercent = (pred.confidence * 100).toFixed(1);

      console.log(`${icon} ${pred.timeframe.padEnd(4)} | ${pred.label.toUpperCase().padEnd(6)} | Conf: ${confPercent}%`);
      console.log(`   Entry: $${pred.entry?.toFixed(2) || 'N/A'} | SL: $${pred.sl?.toFixed(2) || 'N/A'} | TP: $${pred.tp?.toFixed(2) || 'N/A'}`);
      if (pred.signals) {
        console.log(`   Signals: ${pred.signals}`);
      }
      console.log('');
    });
  }

  console.log('═══════════════════════════════════════════════════\n');
}

// ============= API SERVER (Optional - for Express.js) =============

/**
 * If you want to run this as a server, use this with Express.js:
 * 
 * const express = require('express');
 * const cors = require('cors');
 * const app = express();
 * 
 * app.use(cors());
 * app.use(express.json());
 * 
 * app.post('/batch_predict', async (req, res) => {
 *   try {
 *     const { symbol, timeframes, limit } = req.body;
 *     const predictions = await batchPredict(symbol);
 *     res.json({ predictions });
 *   } catch (error) {
 *     res.status(500).json({ error: error.message });
 *   }
 * });
 * 
 * app.listen(8000, () => {
 *   console.log('Signal API running on http://localhost:8000');
 * });
 */

// ============= EXPORT & RUN =============

// For browser usage
if (typeof window !== 'undefined') {
  window.SignalGenerator = {
    updateAllSignals,
    batchPredict,
    fetchKlines,
    getCurrentPrice,
    CONFIG
  };

  // Auto-update every 30 seconds
  setInterval(async () => {
    const results = await updateAllSignals();
    window.dispatchEvent(new CustomEvent('signalsUpdated', { detail: results }));
  }, 30000);

  // Initial load
  updateAllSignals().then(results => {
    window.dispatchEvent(new CustomEvent('signalsUpdated', { detail: results }));
  });
}

// For Node.js usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    updateAllSignals,
    batchPredict,
    fetchKlines,
    getCurrentPrice,
    displaySignals,
    CONFIG
  };
}

// Test run (comment out in production)
if (typeof window === 'undefined') {
  updateAllSignals()
    .then(displaySignals)
    .catch(console.error);
}
