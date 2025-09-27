// indicators/arualgo_v6_7.js
// Pure JS conversion of Pine v6 "AruAlgo v6.7 Elite"
// Exposes class AruAlgo that maintains state and processes one closed candle at a time.

class AruAlgo {
  constructor(params = {}) {
    // default params from Pine
    this.sensitivity = params.sensitivity ?? 8;
    this.atrPeriod = params.atrPeriod ?? 20;
    this.trendEmaPeriod = params.trendEmaPeriod ?? 50;
    this.rsiPeriod = params.rsiPeriod ?? 14;
    this.rsiOverbought = params.rsiOverbought ?? 60;
    this.rsiOversold = params.rsiOversold ?? 40;
    this.adxPeriod = params.adxPeriod ?? 14;
    this.adxThreshold = params.adxThreshold ?? 15;
    this.slMultiplier = params.slMultiplier ?? 1.5;
    this.tpMultiplier = params.tpMultiplier ?? 2.0;

    // time-series windows
    this._candles = []; // {time,open,high,low,close,volume}
    this._maxLen = Math.max(5000, this.atrPeriod*10);

    // internal previous values (to mimic pine var / history)
    this.atrStopPrev = null; // previous atrStop (atrStop[1])
    this.lastSL = NaN;
    this.lastTP = NaN;

    // internal arrays for moving averages etc.
    this._emaCache = {}; // memoized EMA states keyed by period: { prev, k }
    this._rmaCache = {}; // for RMA (Wilder's MA) keyed by period
    this._rsiCache = { prevAvgGain: null, prevAvgLoss: null };
    // ADX related caches
    this._plusDM_rma = null;
    this._minusDM_rma = null;
    this._tr_rma = null;
    this._dx_rma = null;
  }

  // utility: keep candles array bounded
  _pushCandle(c) {
    this._candles.push(c);
    if (this._candles.length > this._maxLen) this._candles.shift();
  }

  // EMA incremental calc: input lastEMA (or null) and new value
  _ema(period, prevEma, value) {
    const k = 2 / (period + 1);
    if (prevEma === null || prevEma === undefined) return value; // seed
    return (value - prevEma) * k + prevEma;
  }

  // RMA (Wilder's moving average) incremental:
  // rma(n) = (prevRma*(n-1) + value) / n  (Wilder smoothing)
  _rma(period, prevRma, value) {
    if (prevRma === null || prevRma === undefined) return value;
    return (prevRma * (period - 1) + value) / period;
  }

  // ATR incremental: we'll compute TRs and apply RMA on TR
  // but we keep array and compute last ATR via RMA to match ta.rma in Pine
  _computeATRUsingRMA() {
    const p = this.atrPeriod;
    const n = this._candles.length;
    if (n < 2) return null;
    // compute TR for all candles (but we can just compute incremental from last)
    if (n === 2) {
      // seed tr_rma with first TR
      const tr = this._trueRange(this._candles[n-2], this._candles[n-1]);
      this._tr_rma = tr;
      return this._tr_rma;
    } else {
      const last = this._candles[n-1];
      const prev = this._candles[n-2];
      const tr = this._trueRange(prev, last);
      this._tr_rma = this._rma(p, this._tr_rma, tr);
      return this._tr_rma;
    }
  }

  _trueRange(prev, curr) {
    // TR = max(high - low, abs(high - prev.close), abs(low - prev.close))
    const a = curr.high - curr.low;
    const b = Math.abs(curr.high - prev.close);
    const c = Math.abs(curr.low - prev.close);
    return Math.max(a, b, c);
  }

  // RSI incremental (Wilder's smoothing as RMA)
  _updateRSI() {
    const p = this.rsiPeriod;
    const n = this._candles.length;
    if (n < 2) return null;
    const curr = this._candles[n-1];
    const prev = this._candles[n-2];
    const change = curr.close - prev.close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (this._rsiCache.prevAvgGain === null) {
      // seed with simple average if we have enough history
      if (n >= p + 1) {
        let sumGain = 0, sumLoss = 0;
        for (let i = n - p; i < n; i++) {
          const d = this._candles[i].close - this._candles[i-1].close;
          sumGain += Math.max(d,0);
          sumLoss += Math.max(-d,0);
        }
        this._rsiCache.prevAvgGain = sumGain / p;
        this._rsiCache.prevAvgLoss = sumLoss / p;
      } else {
        // not enough data to produce RSI
        return null;
      }
    } else {
      this._rsiCache.prevAvgGain = ( (this._rsiCache.prevAvgGain * (p - 1)) + gain ) / p;
      this._rsiCache.prevAvgLoss = ( (this._rsiCache.prevAvgLoss * (p - 1)) + loss ) / p;
    }
    const avgGain = this._rsiCache.prevAvgGain;
    const avgLoss = this._rsiCache.prevAvgLoss;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    return rsi;
  }

  // ADX custom calculation (uses RMA like Pine's ta.rma)
  _updateADX() {
    const n = this._candles.length;
    const p = this.adxPeriod;
    if (n < 2) return null;
    const curr = this._candles[n-1];
    const prev = this._candles[n-2];

    const up = curr.high - prev.high;
    const down = prev.low - curr.low;
    const plusDM = (up > down && up > 0) ? up : 0;
    const minusDM = (down > up && down > 0) ? down : 0;
    const tr = this._trueRange(prev, curr);

    // update rmas
    this._plusDM_rma = this._rma(p, this._plusDM_rma, plusDM);
    this._minusDM_rma = this._rma(p, this._minusDM_rma, minusDM);
    this._tr_rma = this._rma(p, this._tr_rma, tr);

    if (!this._tr_rma || this._tr_rma === 0) return 0;

    const plusDI = 100 * (this._plusDM_rma / this._tr_rma);
    const minusDI = 100 * (this._minusDM_rma / this._tr_rma);
    const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1e-9);

    // smooth DX into ADX via RMA
    this._dx_rma = this._rma(p, this._dx_rma, dx);
    return this._dx_rma;
  }

  // simple EMA series based on close
  _updateEMA(period) {
    const n = this._candles.length;
    if (n < 1) return null;
    const val = this._candles[n-1].close;
    const key = `ema_${period}`;
    let prev = this._emaCache[key] ?? null;
    const ema = this._ema(period, prev, val);
    this._emaCache[key] = ema;
    return ema;
  }

  // compute ATR (using RMA on TR) and return latest ATR value
  _updateATR() {
    return this._computeATRUsingRMA();
  }

  // Main processing method: call on each closed candle
  processCandle(candle) {
    // candle: {time (number or ISO), open, high, low, close, volume}
    // push to series
    this._pushCandle({
      time: (typeof candle.time === 'number') ? candle.time : Date.parse(candle.time)/1000,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: candle.volume ?? 0
    });

    const n = this._candles.length;
    if (n < 2) {
      return { ready: false };
    }

    // compute primitives
    const src = this._candles[n-1].close;
    const atr = this._updateATR(); // uses RMA of TR
    const trendEma = this._updateEMA(this.trendEmaPeriod);
    const rsi = this._updateRSI();
    const adx = this._updateADX();

    // atrStop logic (mirrors Pine's ternary chains)
    // Build nz(prev, srcPrev) style: if prev is null use previous close as fallback
    const prevAtrStop = (this.atrStopPrev === null || this.atrStopPrev === undefined)
      ? this._candles[n-2].close
      : this.atrStopPrev;

    const prevSrc = this._candles[n-2].close;
    const srcGreaterThanPrevAtrStop = src > prevAtrStop;
    const srcLessThanPrevAtrStop = src < prevAtrStop;
    const prevSrcGreaterThanPrevAtrStop = prevSrc > prevAtrStop;
    const prevSrcLessThanPrevAtrStop = prevSrc < prevAtrStop;

    const nLoss = this.sensitivity * (atr ?? 0);

    let atrStop;
    if (srcGreaterThanPrevAtrStop && prevSrcGreaterThanPrevAtrStop) {
      atrStop = Math.max(prevAtrStop, src - nLoss);
    } else if (srcLessThanPrevAtrStop && prevSrcLessThanPrevAtrStop) {
      atrStop = Math.min(prevAtrStop, src + nLoss);
    } else if (srcGreaterThanPrevAtrStop) {
      atrStop = src - nLoss;
    } else {
      atrStop = src + nLoss;
    }

    // store prev for next bar
    this.atrStopPrev = atrStop;

    // smoothedAtrStop = ema(atrStop, 5) -> we need a rolling EMA on atrStop itself
    // implement EMA on atrStop with period 5 using ema cache key 'atrstop_5'
    const atrStopKey = 'atrstop_5';
    const prevAtrStopEma = this._emaCache[atrStopKey] ?? null;
    const smoothedAtrStop = this._ema(5, prevAtrStopEma, atrStop);
    this._emaCache[atrStopKey] = smoothedAtrStop;

    // RSI confirmations
    const rsiBuyConfirm = (rsi !== null) ? (rsi < this.rsiOversold) : false;
    const rsiSellConfirm = (rsi !== null) ? (rsi > this.rsiOverbought) : false;

    // trend direction
    let trendDirection = 0;
    if (trendEma !== null) {
      trendDirection = (src > trendEma) ? 1 : (src < trendEma ? -1 : 0);
    }

    // emaLine = ta.ema(src, 1) -> that's basically src itself (EMA period 1 returns current value)
    const emaLine = src;

    // buyCond/sellCond (primary)
    const adxFilter = (adx !== null) ? (adx > this.adxThreshold) : false;

    const buyCond = (src > smoothedAtrStop)
      && (emaLine > smoothedAtrStop && (this._wasCrossOver(emaLine, smoothedAtrStop))) // ta.crossover(emaLine, smoothedAtrStop)
      && (trendDirection === 1 || trendDirection === 0)
      && rsiBuyConfirm
      && adxFilter;

    const sellCond = (src < smoothedAtrStop)
      && (smoothedAtrStop > emaLine && (this._wasCrossOver(smoothedAtrStop, emaLine))) // ta.crossover(smoothedAtrStop, emaLine)
      && (trendDirection === -1 || trendDirection === 0)
      && rsiSellConfirm
      && adxFilter;

    // Secondary simple cross conditions
    const simpleBuyCond = this._wasCrossOver(src, smoothedAtrStop);
    const simpleSellCond = this._wasCrossOver(smoothedAtrStop, src);

    // SL/TP distances based on current ATR
    const xATR = atr ?? 0;
    const slDistance = xATR * this.slMultiplier;
    const tpDistance = xATR * this.tpMultiplier;

    // Primary SL/TP
    let primaryBuySL = NaN, primaryBuyTP = NaN, primarySellSL = NaN, primarySellTP = NaN;
    if (buyCond) {
      primaryBuySL = src - slDistance;
      primaryBuyTP = src + tpDistance;
      this.lastSL = primaryBuySL;
      this.lastTP = primaryBuyTP;
    }
    if (sellCond) {
      primarySellSL = src + slDistance;
      primarySellTP = src - tpDistance;
      this.lastSL = primarySellSL;
      this.lastTP = primarySellTP;
    }

    // Secondary SL/TP
    let simpleBuySL = NaN, simpleBuyTP = NaN, simpleSellSL = NaN, simpleSellTP = NaN;
    if (simpleBuyCond) {
      simpleBuySL = src - slDistance;
      simpleBuyTP = src + tpDistance;
      this.lastSL = simpleBuySL;
      this.lastTP = simpleBuyTP;
    }
    if (simpleSellCond) {
      simpleSellSL = src + slDistance;
      simpleSellTP = src - tpDistance;
      this.lastSL = simpleSellSL;
      this.lastTP = simpleSellTP;
    }

    // barcolor decision (we return it as a string)
    const barColor = buyCond ? 'buy' : sellCond ? 'sell' : null;

    // Build a list of label texts if triggered (for frontend display)
    const signalLabels = [];
    if (buyCond) {
      signalLabels.push({
        type: 'primaryBuy',
        time: this._candles[n-1].time,
        price: src,
        sl: primaryBuySL,
        tp: primaryBuyTP,
        text: `🟢 BUY\nSL: ${this._round(primaryBuySL)}\nTP: ${this._round(primaryBuyTP)}`
      });
    }
    if (sellCond) {
      signalLabels.push({
        type: 'primarySell',
        time: this._candles[n-1].time,
        price: src,
        sl: primarySellSL,
        tp: primarySellTP,
        text: `🔴 SELL\nSL: ${this._round(primarySellSL)}\nTP: ${this._round(primarySellTP)}`
      });
    }
    if (simpleBuyCond) {
      signalLabels.push({
        type: 'simpleBuy',
        time: this._candles[n-1].time,
        price: src,
        sl: simpleBuySL,
        tp: simpleBuyTP,
        text: `⬆️\nSL: ${this._round(simpleBuySL)}\nTP: ${this._round(simpleBuyTP)}`
      });
    }
    if (simpleSellCond) {
      signalLabels.push({
        type: 'simpleSell',
        time: this._candles[n-1].time,
        price: src,
        sl: simpleSellSL,
        tp: simpleSellTP,
        text: `⬇️\nSL: ${this._round(simpleSellSL)}\nTP: ${this._round(simpleSellTP)}`
      });
    }

    // Return comprehensive object
    return {
      ready: true,
      time: this._candles[n-1].time,
      close: src,
      atr: xATR,
      smoothedAtrStop,
      trendEma,
      rsi,
      adx,
      buyCond,
      sellCond,
      simpleBuyCond,
      simpleSellCond,
      lastSL: Number.isFinite(this.lastSL) ? this.lastSL : null,
      lastTP: Number.isFinite(this.lastTP) ? this.lastTP : null,
      signalLabels,
      barColor
    };
  }

  // helper: naive crossover detection between two scalars using previous candle values
  // We use the previous candle's last-close and previous cached smoothedAtrStop/ema? but we don't store full history of these constructs.
  // So we approximate crossover based on previous candle's close relative to previous smoothedAtrStop/ema values.
  // To be close to pine's ta.crossover(a,b): returns true when a[1] <= b[1] and a > b
  _wasCrossOver(aNow, bNow) {
    // to evaluate a[1] and b[1] we can compute them using previous candle index:
    const n = this._candles.length;
    if (n < 2) return false;
    // previous candle values:
    const prevClose = this._candles[n-2].close;
    // We don't keep prev smoothedAtrStop value separately; but we *did* maintain atrStopPrev and an EMA cache for atrstop.
    // For improved accuracy, compute previous atrStop approximation by reversing last operations:
    // We'll approximate prev smoothedAtrStop by using prev atrStop value. We have atrStopPrev which is current atrStop stored.
    // However, JavaScript module doesn't keep "atrStop for previous bar separately" — but we can store last atrStop in cache.
    // Simpler approach: store lastSmoothedAtrStop in cache each process; but here we approximate using EMA cache.
    // We'll use a small stored variable _lastSmoothedAtrStop to have true previous value.
    const prevSmoothed = this._lastSmoothedAtrStop ?? bNow; // fallback
    const prevA = prevClose; // since emaLine is close
    const prevB = prevSmoothed;
    // Now apply crossover logic:
    return (prevA <= prevB) && (aNow > bNow);
  }

  _round(v) {
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 100) / 100;
  }
}

module.exports = AruAlgo;
