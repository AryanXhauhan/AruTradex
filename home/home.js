/* ==========================================
   home.js - TradingView Widget Management
   ========================================== */

// Wait for TradingView library to load
(function initTradingView() {
  if (typeof TradingView === 'undefined') {
    console.log('⏳ Waiting for TradingView library...');
    setTimeout(initTradingView, 100);
    return;
  }
  
  console.log('✅ TradingView library loaded');
  renderAllCharts();
})();

// Render all chart widgets
function renderAllCharts() {
  renderHeroChart();
  renderCryptoWidget();
  renderFuturesWidget();
  renderForexWidget();
  
  console.log('✅ All TradingView widgets initialized');
}

/* -------------------- Hero Chart (Gold) -------------------- */
function renderHeroChart() {
  const container = document.getElementById('chart-widget');
  if (!container) {
    console.warn('⚠️ Chart widget container not found');
    return;
  }

  try {
    new TradingView.widget({
      container_id: "chart-widget",
      width: "100%",
      height: 500,
      symbol: "OANDA:XAUUSD",
      interval: "60",
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
      locale: "en",
      toolbar_bg: "#0a0a0a",
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: false,
      studies: [
        "MASimple@tv-basicstudies",
        "RSI@tv-basicstudies"
      ]
    });
    console.log('✅ Hero chart (Gold) loaded');
  } catch (err) {
    console.error('❌ Hero chart error:', err);
  }
}

/* -------------------- Crypto Widget (BTC) -------------------- */
function renderCryptoWidget() {
  const container = document.getElementById('crypto-widget');
  if (!container) {
    console.warn('⚠️ Crypto widget container not found');
    return;
  }

  try {
    new TradingView.widget({
      container_id: "crypto-widget",
      width: "100%",
      height: 400,
      symbol: "BINANCE:BTCUSDT",
      interval: "60",
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
      locale: "en",
      toolbar_bg: "#0a0a0a",
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      studies: ["RSI@tv-basicstudies"]
    });
    console.log('✅ Crypto widget (BTC) loaded');
  } catch (err) {
    console.error('❌ Crypto widget error:', err);
  }
}

/* -------------------- Futures Widget (Nasdaq) -------------------- */
function renderFuturesWidget() {
  const container = document.getElementById('futures-widget');
  if (!container) {
    console.warn('⚠️ Futures widget container not found');
    return;
  }

  try {
    new TradingView.widget({
      container_id: "futures-widget",
      width: "100%",
      height: 400,
      symbol: "CME_MINI:NQ1!",
      interval: "60",
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
      locale: "en",
      toolbar_bg: "#0a0a0a",
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true
    });
    console.log('✅ Futures widget (Nasdaq) loaded');
  } catch (err) {
    console.error('❌ Futures widget error:', err);
  }
}

/* -------------------- Forex Widget (EUR/USD) -------------------- */
function renderForexWidget() {
  const container = document.getElementById('forex-widget');
  if (!container) {
    console.warn('⚠️ Forex widget container not found');
    return;
  }

  try {
    new TradingView.widget({
      container_id: "forex-widget",
      width: "100%",
      height: 400,
      symbol: "OANDA:EURUSD",
      interval: "60",
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
      locale: "en",
      toolbar_bg: "#0a0a0a",
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true
    });
    console.log('✅ Forex widget (EUR/USD) loaded');
  } catch (err) {
    console.error('❌ Forex widget error:', err);
  }
}

/* -------------------- AI Signals -------------------- */
(function aiSignalsModule(){
  // Temporarily changed API_BASE to invalid URL to simulate API failure for testing error handling
  const API_BASE = "http://localhost:3000_invalid";
  const SYMBOLS=[
    {pair:"BINANCE:BTCUSDT",label:"BTC/USDT"},
    {pair:"BINANCE:ETHUSDT",label:"ETH/USDT"},
    {pair:"BINANCE:BNBUSDT",label:"BNB/USDT"},
    {pair:"BINANCE:XRPUSDT",label:"XRP/USDT"},
    {pair:"BINANCE:DOGEUSDT",label:"DOGE/USDT"}
  ];
  const TIMEFRAMES=["1m","5m","15m","1h","4h"];
  const REFRESH_MS=30000, CONF_CUTOFF=0.72;

  function ensureCard(sym){
    let card=document.querySelector(`.card.signal[data-pair="${sym.pair}"]`);
    if(!card){
      const grid=document.getElementById("sigGrid"); if(!grid) return null;
      card=document.createElement("article");
      card.className="card signal ai-signal"; card.dataset.pair=sym.pair;
      card.innerHTML=`<div class="card-head"><strong>${sym.label}</strong><span class="chip ai-chip">--</span></div>
      <div class="card-body"><ul class="metrics"><li class="muted">Loading...</li></ul></div>`;
      grid.appendChild(card);
    }
    return card;
  }
  function buildTFRow(tf,p){
    const conf=Math.round((p.confidence||0)*100)+"%";
    const dir=(p.label||"none").toUpperCase();
    const color=dir==="LONG"?"var(--success)":dir==="SHORT"?"var(--danger)":"var(--muted)";
    return `<li class="tf-row" data-tf="${tf}">
      <div style="width:44px">${tf}</div>
      <div style="width:70px;font-weight:700;color:${color}">${dir}</div>
      <div style="width:48px">${conf}</div>
      <div style="flex:1">E:${p.entry?Number(p.entry).toFixed(2):"-"}</div>
      <div style="flex:1">SL:${p.sl?Number(p.sl).toFixed(2):"-"}</div>
      <div style="flex:1">TP:${p.tp?Number(p.tp).toFixed(2):"-"}</div>
    </li>`;
  }
  async function batchPredict(symbol){
    try{
      const r=await fetch(`${API_BASE}/batch_predict`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({symbol,timeframes:TIMEFRAMES,limit:300})
      });
      if(!r.ok) return null;
      return (await r.json()).predictions||[];
    }catch{ return null; }
  }
  function updateCard(sym,preds,tf=null,highOnly=false){
    const card=ensureCard(sym); if(!card) return;
    const metrics=card.querySelector(".metrics"); metrics.innerHTML="";
    if(!preds||!preds.length){ metrics.innerHTML="<li>No data</li>"; card.querySelector(".chip").textContent="--"; return; }
    TIMEFRAMES.forEach(t=>{
      if(tf&&t!==tf) return;
      const p=preds.find(x=>x.timeframe===t)||{label:"none",confidence:0};
      if(highOnly&&(p.confidence||0)<CONF_CUTOFF) return;
      metrics.insertAdjacentHTML("beforeend",buildTFRow(t,p));
    });
    const rows=Array.from(metrics.querySelectorAll(".tf-row")); let longs=0,shorts=0;
    rows.forEach(r=>{const d=r.querySelector("div:nth-child(2)")?.textContent.toLowerCase();if(d==="long")longs++;if(d==="short")shorts++;});
    const avg=preds.reduce((s,p)=>s+(p.confidence||0),0)/(preds.length||1);
    const chip=card.querySelector(".chip");
    chip.textContent=Math.round(avg*100)+"%";
    chip.classList.toggle("up",longs>shorts); chip.classList.toggle("down",shorts>longs);
  }
  async function refreshAll(tf=null){
    const highOnly=document.getElementById("highConfToggle")?.checked;
    const results=await Promise.all(SYMBOLS.map(s=>batchPredict(s.pair)));
    SYMBOLS.forEach((s,i)=>updateCard(s,results[i],tf,highOnly));
  }
  document.addEventListener("DOMContentLoaded",()=>{
    refreshAll();
    setInterval(()=>refreshAll(),REFRESH_MS);
    document.getElementById("sigTimeframes")?.addEventListener("click",e=>{
      const b=e.target.closest("button[data-tf]"); if(!b) return;
      document.querySelectorAll("#sigTimeframes .btn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active"); refreshAll(b.dataset.tf);
    });
    document.getElementById("highConfToggle")?.addEventListener("change",()=>refreshAll());
  });
  window.__AX=window.__AX||{}; window.__AX.updateAiSignals=refreshAll;
})();

console.log('🔥 home.js loaded successfully');
