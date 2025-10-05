# server.py
"""
FastAPI batch_predict server for XAUUSD (via OANDA, AlphaVantage or client-provided candles)
and BINANCE:BTCUSDT (public REST).
Endpoint: POST /batch_predict
See README comments in code for env vars and usage.
"""
import os
import json
import logging
from typing import List, Dict, Optional, Any, Tuple
from datetime import datetime, timezone, timedelta

import joblib
import pandas as pd
import numpy as np
try:
    import pandas_ta as ta
except ImportError:
    ta = None
import httpx
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# -------------------- Logging --------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ax-batch-predict")

# -------------------- App + CORS --------------------
app = FastAPI(title="AI Batch Predict - AruTradeX Demo")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],            # DEV: allow all. Lock down in prod.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- Configuration --------------------
MODEL_PATH = "rf_signal_model.joblib"
META_PATH = "model_meta.json"
BINANCE_REST = "https://api.binance.com/api/v3/klines"
ALPHA_BASE = "https://www.alphavantage.co/query"
DEFAULT_LIMIT = 300
SUPPORTED_TFS = ["1m", "5m", "15m", "1h", "4h"]
CACHE_TTL_SECONDS = 15  # short TTL for recent klines

# OANDA config (optional). Set environment variables:
#   OANDA_TOKEN (string) and optionally OANDA_ENV ("practice" or "live")
OANDA_TOKEN = os.getenv("OANDA_TOKEN", None)
OANDA_ENV = os.getenv("OANDA_ENV", "practice")  # "practice" or "live"
OANDA_API_BASE = "https://api-fxpractice.oanda.com" if OANDA_ENV == "practice" else "https://api-fxtrade.oanda.com"

# Alpha Vantage API key (optional). Set env var ALPHA_VANTAGE_KEY
ALPHA_VANTAGE_KEY = os.getenv("ALPHA_VANTAGE_KEY", None)

# -------------------- Try load model --------------------
MODEL = None
META = None
if os.path.exists(MODEL_PATH) and os.path.exists(META_PATH):
    try:
        MODEL = joblib.load(MODEL_PATH)
        with open(META_PATH, "r") as f:
            META = json.load(f)
        logger.info(f"Loaded model: {MODEL_PATH}")
    except Exception:
        logger.exception("Failed to load model; will use heuristic fallback.")
        MODEL = None
        META = None
else:
    logger.info("Model not found. Server will use heuristic fallback predictions.")

# -------------------- Simple in-memory cache --------------------
# cache key -> (timestamp_utc, payload)
_CACHE: Dict[str, Tuple[datetime, Any]] = {}

def cache_get(key: str) -> Optional[Any]:
    row = _CACHE.get(key)
    if not row:
        return None
    ts, payload = row
    if datetime.now(timezone.utc) - ts > timedelta(seconds=CACHE_TTL_SECONDS):
        _CACHE.pop(key, None)
        return None
    return payload

def cache_set(key: str, payload: Any):
    _CACHE[key] = (datetime.now(timezone.utc), payload)

# -------------------- Pydantic models --------------------
class CandleWindow(BaseModel):
    timestamp: List[str]
    open: List[float]
    high: List[float]
    low: List[float]
    close: List[float]
    volume: Optional[List[float]] = None

class BatchRequest(BaseModel):
    symbol: str
    timeframes: List[str]
    candles: Optional[Dict[str, CandleWindow]] = None
    limit: Optional[int] = DEFAULT_LIMIT

class Prediction(BaseModel):
    timeframe: str
    label: str
    confidence: float
    entry: float
    sl: float
    tp: float
    source: str

# -------------------- Utilities: candles & aggregation --------------------
async def fetch_binance_klines(symbol: str, interval: str, limit: int = DEFAULT_LIMIT) -> pd.DataFrame:
    """Fetch klines from Binance REST. Returns DF with timestamp (UTC), open, high, low, close, volume."""
    cache_key = f"binance::{symbol}::{interval}::{limit}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    params = {"symbol": symbol.replace("BINANCE:", ""), "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(BINANCE_REST, params=params)
        r.raise_for_status()
        data = r.json()
    df = pd.DataFrame(data, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time","q","n","taker_base_vol","taker_quote_vol","ignore"
    ])
    df["timestamp"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    for col in ["open","high","low","close","volume"]:
        df[col] = df[col].astype(float)
    out = df[["timestamp","open","high","low","close","volume"]]
    cache_set(cache_key, out)
    return out

def candles_to_df(obj: Dict[str, Any]) -> pd.DataFrame:
    """Convert CandleWindow-like dict to dataframe, clean NaNs and ensure UTC timestamps."""
    df = pd.DataFrame({
        "timestamp": pd.to_datetime(obj["timestamp"]),
        "open": obj["open"],
        "high": obj["high"],
        "low": obj["low"],
        "close": obj["close"],
        "volume": obj.get("volume", [0]*len(obj["timestamp"]))
    })
    # ensure timezone-aware UTC
    try:
        if df['timestamp'].dt.tz is None:
            df['timestamp'] = df['timestamp'].dt.tz_localize('UTC')
        else:
            df['timestamp'] = df['timestamp'].dt.tz_convert('UTC')
    except Exception:
        df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True)

    # coerce numeric, drop rows where any OHLC is missing
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    df["volume"] = df["volume"].fillna(0).astype(float)

    return df.sort_values("timestamp").reset_index(drop=True)

def aggregate_from_1m(df_1m: pd.DataFrame, target_tf: str) -> pd.DataFrame:
    if target_tf == "1m":
        return df_1m.copy()
    offset_map = {"5m":"5T","15m":"15T","1h":"1H","4h":"4H"}
    if target_tf not in offset_map:
        raise ValueError("unsupported tf for aggregation: " + target_tf)
    df = df_1m.set_index("timestamp")
    o = df["open"].resample(offset_map[target_tf]).first()
    h = df["high"].resample(offset_map[target_tf]).max()
    l = df["low"].resample(offset_map[target_tf]).min()
    c = df["close"].resample(offset_map[target_tf]).last()
    v = df["volume"].resample(offset_map[target_tf]).sum()
    agg = pd.concat([o,h,l,c,v], axis=1).dropna().reset_index()
    agg.columns = ["timestamp","open","high","low","close","volume"]
    return agg

# -------------------- Alpha Vantage integration (fallback for XAUUSD) --------------------
# AlphaVantage supports FX_INTRADAY for currency pairs (intervals: 1min,5min,15min,30min,60min).
# We'll request intraday for XAU/USD (from_symbol=XAU, to_symbol=USD). For 4h we aggregate 60min -> 4h.
ALPHA_INTERVAL_MAP = {"1m":"1min","5m":"5min","15m":"15min","1h":"60min"}

async def fetch_alpha_vantage_candles(symbol: str, interval: str, limit: int = DEFAULT_LIMIT) -> Optional[pd.DataFrame]:
    """Fetch intraday candles from Alpha Vantage for XAU/USD when key is available.
       symbol can be 'XAUUSD' or 'ALPHA:XAUUSD'."""
    if not ALPHA_VANTAGE_KEY:
        logger.info("ALPHA_VANTAGE_KEY not set — skipping AlphaVantage fetch for %s", symbol)
        return None

    # normalize instrument to XAU / USD
    inst_raw = symbol.split(":",1)[1] if ":" in symbol else symbol
    inst = inst_raw.replace("_","").upper()
    # attempt to interpret XAUUSD -> from=XAU to=USD
    if len(inst) >= 6:
        from_sym = inst[:3]
        to_sym = inst[3:]
    else:
        logger.warning("AlphaVantage: unusual instrument format: %s", inst)
        return None

    if interval not in ALPHA_INTERVAL_MAP and interval != "4h":
        logger.warning("AlphaVantage: unsupported interval requested: %s", interval)
        return None

    av_interval = ALPHA_INTERVAL_MAP.get(interval, "60min")  # 4h handled later via aggregation
    cache_key = f"av::{from_sym}_{to_sym}::{av_interval}::{limit}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    params = {
        "function": "FX_INTRADAY",
        "from_symbol": from_sym,
        "to_symbol": to_sym,
        "interval": av_interval,
        "outputsize": "full",
        "apikey": ALPHA_VANTAGE_KEY
    }

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(ALPHA_BASE, params=params)
            r.raise_for_status()
            js = r.json()
    except Exception as e:
        logger.exception("AlphaVantage HTTP request failed for %s/%s: %s", from_sym, to_sym, str(e))
        return None

    # parse response structure: keys like "Time Series FX (1min)" or error message / note
    # check for rate limit note
    if "Note" in js:
        logger.warning("AlphaVantage rate limit / note: %s", js.get("Note")[:200])
        return None
    if "Error Message" in js:
        logger.warning("AlphaVantage error for %s_%s: %s", from_sym, to_sym, js.get("Error Message"))
        return None

    # find the timeseries object
    ts_key = None
    for k in js.keys():
        if k.startswith("Time Series"):
            ts_key = k; break
    if ts_key is None:
        logger.warning("AlphaVantage response missing Time Series for %s_%s", from_sym, to_sym)
        return None

    ts = js[ts_key]
    rows = []
    for ts_str, obj in ts.items():
        try:
            t = pd.to_datetime(ts_str, utc=True)
        except Exception:
            try:
                t = pd.to_datetime(ts_str)
                if t.tzinfo is None:
                    t = t.tz_localize("UTC")
                else:
                    t = t.tz_convert("UTC")
            except Exception:
                continue
        # obj fields: '1. open', '2. high', '3. low', '4. close'
        try:
            o = float(obj.get("1. open", np.nan))
            h = float(obj.get("2. high", np.nan))
            l = float(obj.get("3. low", np.nan))
            c = float(obj.get("4. close", np.nan))
        except Exception:
            continue
        rows.append({"timestamp": t, "open": o, "high": h, "low": l, "close": c, "volume": 0.0})

    if not rows:
        logger.info("AlphaVantage returned no rows for %s_%s", from_sym, to_sym)
        return None

    df = pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)

    # If user requested 4h, aggregate 60min -> 4H; for other tfs we may need to slice to `limit`
    if interval == "4h":
        # ensure we have 60min base; if av_interval is 60min we can aggregate
        df_60 = df.copy()
        df_60 = df_60.set_index("timestamp").resample("60T").agg({"open":"first","high":"max","low":"min","close":"last","volume":"sum"}).dropna().reset_index()
        df = df_60.set_index("timestamp").resample("4H").agg({"open":"first","high":"max","low":"min","close":"last","volume":"sum"}).dropna().reset_index()

    # limit rows to 'limit' most recent
    if len(df) > limit:
        df = df.tail(limit).reset_index(drop=True)

    cache_set(cache_key, df)
    logger.info("Fetched %d AlphaVantage candles for %s_%s interval=%s", len(df), from_sym, to_sym, av_interval)
    return df

# -------------------- OANDA integration (optional) --------------------
# (unchanged from earlier - keep robust implementation)
async def fetch_oanda_candles(symbol: str, granularity: str, count: int = DEFAULT_LIMIT) -> Optional[pd.DataFrame]:
    if not OANDA_TOKEN:
        logger.info("OANDA_TOKEN not set — skipping OANDA fetch for %s", symbol)
        return None
    map_tf = {"1m":"M1","5m":"M5","15m":"M15","1h":"H1","4h":"H4"}
    if granularity not in map_tf:
        logger.warning("Unsupported OANDA tf requested: %s", granularity)
        return None
    inst_raw = symbol.split(":", 1)[1] if ":" in symbol else symbol
    inst_clean = inst_raw.replace("-", "").replace("/", "").upper()
    if "_" in inst_raw:
        inst = inst_raw.upper()
    else:
        if len(inst_clean) >= 6:
            inst = inst_clean[:3] + "_" + inst_clean[3:]
        else:
            inst = inst_clean
    url = f"{OANDA_API_BASE}/v3/instruments/{inst}/candles"
    params = {"granularity": map_tf[granularity], "count": int(count), "price": "M"}
    headers = {"Authorization": f"Bearer {OANDA_TOKEN}"}
    cache_key = f"oanda::{inst}::{map_tf[granularity]}::{count}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(url, params=params, headers=headers)
            if r.status_code != 200:
                body = ""
                try:
                    body = r.text[:1000]
                except Exception:
                    pass
                logger.warning("OANDA fetch returned %s for %s. Body: %s", r.status_code, inst, body)
                return None
            js = r.json()
    except Exception as e:
        logger.exception("OANDA HTTP request failed for %s: %s", inst, str(e))
        return None
    try:
        rows = []
        for c in js.get("candles", []):
            t = c.get("time")
            if not t:
                continue
            price_obj = c.get("mid") or c.get("midpoint") or {}
            def safe_float(d, k):
                try:
                    return float(d.get(k)) if isinstance(d, dict) and d.get(k) is not None else np.nan
                except Exception:
                    return np.nan
            o = safe_float(price_obj, "o")
            h = safe_float(price_obj, "h")
            l = safe_float(price_obj, "l")
            cl = safe_float(price_obj, "c")
            vol = int(c.get("volume", 0) or 0)
            try:
                ts = pd.to_datetime(t)
                if ts.tzinfo is None:
                    ts = ts.tz_localize("UTC")
                else:
                    ts = ts.tz_convert("UTC")
            except Exception:
                ts = pd.to_datetime(t, utc=True)
            rows.append({"timestamp": ts, "open": o, "high": h, "low": l, "close": cl, "volume": vol})
        if not rows:
            logger.info("OANDA response for %s contained no usable candles", inst)
            return None
        df = pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)
        cache_set(cache_key, df)
        logger.info("Fetched %d OANDA candles for %s (%s)", len(df), inst, map_tf[granularity])
        return df
    except Exception as e:
        logger.exception("Failed to parse OANDA response for %s: %s", inst, str(e))
        return None

# -------------------- Feature engineering (robust) --------------------
def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy().reset_index(drop=True)
    if df.empty or len(df) < 3:
        return pd.DataFrame()
    try:
        c = df["close"]; h = df["high"]; l = df["low"]
        df["ret_1"] = c.pct_change()
        df["ema8"] = ta.ema(c, length=8)
        df["ema21"] = ta.ema(c, length=21)
        df["ema50"] = ta.ema(c, length=50)
        df["rsi14"] = ta.rsi(c, length=14)
        df["atr14"] = ta.atr(h, l, c, length=14)
        df["std5"] = c.pct_change().rolling(5).std()
        df["mom5"] = c - c.shift(5)
        df = df.dropna().reset_index(drop=True)
        return df
    except Exception:
        logger.exception("pandas-ta compute_features failed — falling back to simple pandas implementations")
        try:
            df["ema8"] = df["close"].ewm(span=8, adjust=False).mean()
            df["ema21"] = df["close"].ewm(span=21, adjust=False).mean()
            df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
            delta = df["close"].diff()
            up = delta.clip(lower=0).rolling(14).mean()
            down = -delta.clip(upper=0).rolling(14).mean()
            df["rsi14"] = 100 - (100 / (1 + (up / down).replace([np.inf, -np.inf], np.nan).fillna(0)))
            df["atr14"] = (df["high"].combine(df["close"].shift(1), max) - df["low"].combine(df["close"].shift(1), min)).rolling(14).mean()
            df["std5"] = df["close"].pct_change().rolling(5).std().fillna(0)
            df["mom5"] = df["close"] - df["close"].shift(5)
            df = df.dropna().reset_index(drop=True)
            return df
        except Exception:
            logger.exception("Fallback compute_features failed")
            return pd.DataFrame()

# -------------------- Predict helpers (unchanged) --------------------
def heuristic_signal_from_df(df: pd.DataFrame) -> Dict[str, Any]:
    if df is None or df.empty:
        return {"label":"none","confidence":0.0,"entry":0.0,"sl":0.0,"tp":0.0}
    feat = compute_features(df)
    if feat is None or feat.empty:
        last_close = float(df["close"].iloc[-1]) if len(df) > 0 else 0.0
        return {"label":"none","confidence":0.0,"entry":float(last_close),"sl":0.0,"tp":0.0}
    last = feat.iloc[-1]
    last_close = float(df["close"].iloc[-1])
    atr = float(last.get("atr14", np.nan)) if "atr14" in feat.columns else (np.std(df["close"].diff().dropna()) * 2)
    if np.isnan(atr) or atr == 0:
        atr = max((np.std(df["close"].diff().dropna()) * 2), 1e-8)
    ema8 = float(last.get("ema8", last_close))
    ema21 = float(last.get("ema21", last_close))
    ema50 = float(last.get("ema50", last_close))
    rsi = float(last.get("rsi14", 50))
    if ema8 > ema21 > ema50 and rsi > 50:
        label = "long"
    elif ema8 < ema21 < ema50 and rsi < 50:
        label = "short"
    else:
        label = "none"
    sl = last_close - 1.2*atr if label == "long" else (last_close + 1.2*atr if label=="short" else 0.0)
    tp = last_close + 2.4*atr if label == "long" else (last_close - 2.4*atr if label == "short" else 0.0)
    conf = 0.5
    if label != "none":
        sep = abs(ema8 - ema50) / (ema50 if ema50!=0 else 1)
        conf = min(0.95, 0.55 + sep*5 + (abs(rsi-50)/50)*0.3)
    return {"label": label, "confidence": float(conf), "entry": float(last_close), "sl": float(sl), "tp": float(tp)}

def model_predict_from_df(df: pd.DataFrame):
    if MODEL is None or META is None:
        return heuristic_signal_from_df(df)
    featdf = compute_features(df)
    if featdf is None or featdf.empty:
        return heuristic_signal_from_df(df)
    feat_cols = META.get("features", [])
    if not feat_cols:
        return heuristic_signal_from_df(df)
    X = featdf.iloc[[-1]][feat_cols].fillna(0)
    try:
        probs = MODEL.predict_proba(X)[0]
    except Exception:
        logger.exception("Model predict_proba failed; falling back to heuristic")
        return heuristic_signal_from_df(df)
    classes = MODEL.classes_
    idx = int(np.argmax(probs))
    cls = classes[idx]
    label_map = META.get("label_map", {"0":"none","1":"long","2":"short"})
    label = label_map.get(str(int(cls)), "none") if isinstance(cls, (int, np.integer)) else label_map.get(str(cls), "none")
    confidence = float(probs[idx])
    last_close = float(df["close"].iloc[-1])
    atr = float(featdf["atr14"].iloc[-1]) if "atr14" in featdf.columns else (np.std(df["close"].diff().dropna()) * 2)
    if np.isnan(atr) or atr == 0:
        atr = max((np.std(df["close"].diff().dropna()) * 2), 1e-8)
    sl = last_close - 1.2*atr if label == "long" else (last_close + 1.2*atr if label == "short" else 0.0)
    tp = last_close + 2.4*atr if label == "long" else (last_close - 2.4*atr if label == "short" else 0.0)
    return {"label": label, "confidence": confidence, "entry": last_close, "sl": sl, "tp": tp}

# -------------------- Main endpoint --------------------
@app.post("/batch_predict", response_model=Dict[str, List[Prediction]])
async def batch_predict(req: BatchRequest):
    symbol = req.symbol.strip()
    timeframes = req.timeframes or ["1m"]
    if any(tf not in SUPPORTED_TFS for tf in timeframes):
        raise HTTPException(status_code=400, detail=f"Supported timeframes: {SUPPORTED_TFS}")
    limit = req.limit or DEFAULT_LIMIT

    is_binance = symbol.upper().startswith("BINANCE:")
    is_oanda = symbol.upper().startswith("OANDA:")
    # alpha detection: if symbol contains XAU or prefix ALPHA:
    is_alpha_candidate = ("XAU" in symbol.upper()) or symbol.upper().startswith("ALPHA:")

    results: List[Prediction] = []
    for tf in timeframes:
        try:
            df = None
            src = None

            # 1) client supplied candles for the TF
            if req.candles and tf in req.candles:
                df = candles_to_df(req.candles[tf].dict())
                src = "client-candles"
            else:
                # 2) Binance auto-fetch
                if is_binance:
                    df = await fetch_binance_klines(symbol, tf, limit=limit)
                    src = "binance-rest"
                # 3) OANDA auto-fetch (if configured)
                elif is_oanda:
                    df = await fetch_oanda_candles(symbol, tf, count=limit)
                    src = "oanda-rest" if df is not None else "no-data"
                # 4) AlphaVantage fallback for XAUUSD / gold (if key present)
                elif is_alpha_candidate and ALPHA_VANTAGE_KEY:
                    df = await fetch_alpha_vantage_candles(symbol, tf, limit=limit)
                    src = "alpha-vantage" if df is not None else "no-data"
                else:
                    # 5) local CSV fallback for other symbols (existing behavior)
                    local_csv_candidates = [
                        f"historical_{symbol.replace(':','_')}_1m.csv",
                        f"{symbol.replace(':','_')}_1m.csv",
                        f"historical_{symbol.replace(':','_')}.csv",
                        f"{symbol.replace(':','_')}.csv"
                    ]
                    found = None
                    for c in local_csv_candidates:
                        if os.path.exists(c):
                            found = c; break
                    if found:
                        df1 = pd.read_csv(found, parse_dates=["timestamp"])
                        df1 = df1.sort_values("timestamp").reset_index(drop=True)
                        if tf == "1m":
                            df = df1
                        else:
                            df = aggregate_from_1m(df1, tf)
                        src = f"local-csv:{os.path.basename(found)}"
                    else:
                        # no data path -> safe response
                        results.append(Prediction(timeframe=tf, label="none", confidence=0.0, entry=0.0, sl=0.0, tp=0.0, source="no-data"))
                        continue

            # validate df
            if df is None or df.empty:
                results.append(Prediction(timeframe=tf, label="none", confidence=0.0, entry=0.0, sl=0.0, tp=0.0, source="no-data"))
                continue

            # ensure numeric & drop bad rows
            for col in ["open","high","low","close","volume"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce")
            df = df.dropna(subset=["open","high","low","close"]).reset_index(drop=True)
            if "volume" in df.columns:
                df["volume"] = df["volume"].fillna(0).astype(float)

            # ensure enough rows
            if len(df) < 50:
                res = heuristic_signal_from_df(df)
                res["timeframe"] = tf
                res["source"] = src if src else "heuristic"
                results.append(Prediction(**res))
                continue

            # predict (model or heuristic)
            pred = model_predict_from_df(df) if MODEL is not None else heuristic_signal_from_df(df)
            pred["timeframe"] = tf
            pred["source"] = "model" if MODEL is not None else src or "heuristic"
            entry = float(pred.get("entry") or 0.0)
            sl = float(pred.get("sl") or 0.0)
            tp = float(pred.get("tp") or 0.0)
            results.append(Prediction(timeframe=tf, label=pred.get("label","none"), confidence=float(pred.get("confidence",0)), entry=entry, sl=sl, tp=tp, source=pred.get("source","heuristic")))
        except Exception as e:
            logger.exception("Exception while processing %s %s", symbol, tf)
            results.append(Prediction(timeframe=tf, label="none", confidence=0.0, entry=0.0, sl=0.0, tp=0.0, source=f"error:{str(e)[:120]}"))

    return {"predictions": results}

# -------------------- Small helper endpoints --------------------
@app.get("/")
async def root():
    return {"status":"ok","note":"POST /batch_predict with {symbol, timeframes}. See server logs for details."}

@app.get("/predict_demo")
async def predict_demo():
    return {
        "note": "Example: POST /batch_predict {symbol:'BINANCE:BTCUSDT', timeframes:['1m','5m']}. Set OANDA_TOKEN env var or ALPHA_VANTAGE_KEY env var to enable fetching XAUUSD automatically."
    }
