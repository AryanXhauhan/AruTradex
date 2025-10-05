/* =========================
   main.js — consolidated client script
   ========================= */

/* -------------------- Fetch Override for TradingView Telemetry -------------------- */
// Override fetch to mock TradingView telemetry requests and prevent ERR_CONNECTION_REFUSED errors
const originalFetch = window.fetch;
window.fetch = function(url, options) {
  if (typeof url === 'string' && url.includes('tradingview.com') && (url.includes('telemetry') || url.includes('snowplow') || url.includes('report') || url.includes('track'))) {
    // Return a resolved promise with a fake successful response
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, statusText: 'OK' }));
  }
  return originalFetch.apply(this, arguments);
};

/* -------------------- XMLHttpRequest Override for TradingView Telemetry -------------------- */
// Also override XMLHttpRequest since some requests might use it instead of fetch
const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...args) {
  if (typeof url === 'string' && url.includes('tradingview.com') && (url.includes('telemetry') || url.includes('snowplow') || url.includes('report') || url.includes('track'))) {
    // Mock the request by preventing it from actually sending
    this._isMocked = true;
    // Call original open but we'll intercept send
    return originalOpen.call(this, method, 'data:text/plain,', ...args);
  }
  return originalOpen.apply(this, [method, url, ...args]);
};

const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(body) {
  if (this._isMocked) {
    // Simulate a successful response
    setTimeout(() => {
      if (this.onreadystatechange) {
        this.readyState = 4;
        this.status = 200;
        this.statusText = 'OK';
        this.responseText = '{}';
        this.response = '{}';
        this.onreadystatechange();
      }
      if (this.onload) this.onload();
    }, 0);
    return;
  }
  return originalSend.apply(this, arguments);
};

/* -------------------- Utilities -------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* -------------------- Year -------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});

/* -------------------- Theme toggle -------------------- */
const THEME_KEY = 'ax-theme';
const btnTheme = document.getElementById('btnTheme');
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.body.setAttribute('data-theme', saved);
  if (btnTheme) btnTheme.textContent = document.body.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';
})();
function toggleTheme() {
  const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  if (btnTheme) btnTheme.textContent = next === 'dark' ? '🌙' : '☀️';
}
btnTheme && btnTheme.addEventListener('click', toggleTheme);

/* -------------------- Avatar & Logout -------------------- */
(function avatarModule() {
  const AV_KEY = 'ax-user';
  const avatarBtn = document.getElementById('userAvatarBtn') || document.querySelector('.avatar');
  const avatarImg = document.getElementById('userAvatarImg') || (avatarBtn ? avatarBtn.querySelector('img') : null);
  const avatarMenu = document.getElementById('avatarMenu');
  const menuUserImg = document.getElementById('menuUserImg');
  const menuUsername = document.getElementById('menuUsername');
  const menuUserEmail = document.getElementById('menuUserEmail');
  const btnLogout = document.getElementById('btnLogout');

  function getUser() {
    try { return JSON.parse(localStorage.getItem(AV_KEY)) || null; }
    catch { return null; }
  }
  function createInitialAvatar(name, bg = '#1f2937', fg = '#fff', size = 128) {
    const initial = (name?.trim()[0] || '?').toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>
      <rect width='100%' height='100%' fill='${bg}' rx='20' ry='20'/>
      <text x='50%' y='50%' dy='.06em' font-family='Inter, Arial, sans-serif' font-size='64' fill='${fg}' text-anchor='middle' alignment-baseline='middle'>${initial}</text>
    </svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  function renderAvatar() {
    const user = getUser();
    if (!user) {
      const guestSrc = createInitialAvatar('G');
      if (avatarImg) avatarImg.src = guestSrc;
      if (menuUserImg) menuUserImg.src = guestSrc;
      if (menuUsername) menuUsername.textContent = 'Guest';
      if (menuUserEmail) menuUserEmail.textContent = '';
      if (btnLogout) { btnLogout.textContent = 'Login'; btnLogout.onclick = () => location.href = 'login.html'; }
      return;
    }
    const name = user.username || user.name || 'User';
    const email = user.email || '';
    const src = user.avatarUrl || createInitialAvatar(name);
    if (avatarImg) avatarImg.src = src;
    if (menuUserImg) menuUserImg.src = src;
    if (menuUsername) menuUsername.textContent = name;
    if (menuUserEmail) menuUserEmail.textContent = email;
    if (btnLogout) btnLogout.textContent = 'Logout';
  }
  async function logout() {
    try {
      const mod = await import('/login/firebase.js').catch(()=>null);
      const { signOut } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js').catch(()=>({}));
      if (mod?.auth && signOut) await signOut(mod.auth);
    } catch {}
    finally {
      localStorage.removeItem(AV_KEY);
      location.href = './home/home.html';
    }
  }
  avatarBtn?.addEventListener('click', () => {
    if (!avatarMenu) return;
    avatarMenu.toggleAttribute('aria-hidden');
  });
  btnLogout?.addEventListener('click', () => {
    if (btnLogout.textContent.trim().toLowerCase() === 'login') location.href = 'login.html';
    else logout();
  });
  document.addEventListener('DOMContentLoaded', renderAvatar);
  window.__AX = window.__AX || {};
  window.__AX.avatarRefresh = renderAvatar;
})();

/* -------------------- TradingView Charts -------------------- */
function initAdvanced(symbol = 'BINANCE:BTCUSDT', interval = '60') {
  if (!window.TradingView) {
    setTimeout(() => initAdvanced(symbol, interval), 200);
    return;
  }
  const container = document.getElementById('axAdvancedChart');
  if (!container) return;
  container.innerHTML = '';

  try {
    new TradingView.widget({
      container_id: "axAdvancedChart",
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
      style: "1",
      locale: "en",
      toolbar_bg: "rgba(0,0,0,0)",
      hide_side_toolbar: false,   // ✅ left tools ON
      hide_top_toolbar: false,    // ✅ top tools ON
      allow_symbol_change: true,  // ✅ user can change ticker
      save_image: true,           // ✅ user can take snapshot
      studies: [
        "MACD@tv-basicstudies",
        "RSI@tv-basicstudies",
        "TripleEMA@tv-basicstudies"
      ]
    });
  } catch (err) {
    console.warn('TradingView widget init failed, retrying:', err);
    setTimeout(() => initAdvanced(symbol, interval), 300);
  }

  const title = document.getElementById('chartTitle');
  if (title) { title.innerHTML = 'Advanced: <span>' + symbol + '</span>'; }
}

function initChartWall(interval="15") {
  if (!window.TradingView) return setTimeout(()=>initChartWall(interval),200);
  const container = document.getElementById('tv_chart_container');
  if (!container) return;
  container.innerHTML = '';
  new TradingView.widget({
    symbol:"BINANCE:BTCUSDT", interval,
    autosize:true, container_id:"tv_chart_container",
    theme: document.body.getAttribute('data-theme')==='dark'?'dark':'light',
    style:"1", locale:"en",
    studies:["RSI@tv-basicstudies","MACD@tv-basicstudies"]
  });
}
document.getElementById('btnFullscreen')?.addEventListener('click', () => {
  const chartContainer = document.getElementById('axAdvancedChart');
  if (!chartContainer) return;
  if (!document.fullscreenElement) chartContainer.requestFullscreen();
  else document.exitFullscreen();
});
document.querySelectorAll("#intervalBtns .btn").forEach(btn=>{
  btn.addEventListener("click",()=>initChartWall(btn.dataset.int));
});
document.getElementById('quickChips')?.addEventListener('click', e=>{
  const sym = e.target.closest('[data-sym]')?.dataset.sym;
  if (sym) initAdvanced(sym);
});
document.getElementById('btnSearch')?.addEventListener('click',()=>{
  const q=$('#q')?.value.trim(); if(q) initAdvanced(q);
});
$('#q')?.addEventListener('keydown',e=>{ if(e.key==='Enter') $('#btnSearch')?.click(); });
document.getElementById('intervalBtns')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-int]'); if(!b) return;
  initAdvanced($('#q')?.value.trim()||'BINANCE:BTCUSDT', b.dataset.int);
});
window.addEventListener('load',()=>{ initAdvanced(); initChartWall(); });

/* -------------------- AI Signals (Enhanced with test_backtest.js) -------------------- */
(function aiSignalsModule(){
  const SYMBOLS=[
    {pair:"BINANCE:BTCUSDT",label:"BTC/USDT"},
    {pair:"BINANCE:ETHUSDT",label:"ETH/USDT"},
    {pair:"BINANCE:BNBUSDT",label:"BNB/USDT"},
    {pair:"BINANCE:XRPUSDT",label:"XRP/USDT"},
    {pair:"BINANCE:DOGEUSDT",label:"DOGE/USDT"}
  ];
  const TIMEFRAMES=["1m","5m","15m","1h","4h"];
  
  function ensureCard(sym){
    let card=document.querySelector(`.card.signal[data-pair="${sym.pair}"]`);
    if(!card){
      const grid=document.getElementById('sigGrid'); 
      if(!grid) return null;
      card=document.createElement("article");
      card.className="card signal ai-signal"; 
      card.dataset.pair=sym.pair;
      card.innerHTML=`<div class="card-head"><strong style="background: linear-gradient(179deg, #ffad00, #ffffff); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${sym.label} — AI Signal</strong><span class="chip ai-chip">Loading...</span></div>
      <div class="card-body"><ul class="metrics"><li class="muted">Awaiting data…</li></ul><div class="mini-box" aria-hidden="true"></div></div>`;
      grid.appendChild(card);
    }
    return card;
  }
  
  function buildTFRow(tf,p){
    const conf=Math.round((p.confidence||0)*100)+"%";
    const dir=(p.label||"none").toUpperCase();
    const color=dir==="LONG"?"var(--success)":dir==="SHORT"?"var(--danger)":"var(--muted)";
    return `<li class="tf-row" data-tf="${tf}" style="display:flex; gap:10px; padding:8px; background:rgba(255,255,255,0.02); border-radius:8px; margin-bottom:6px;">
      <div style="width:44px; font-weight:700;">${tf}</div>
      <div style="width:70px; font-weight:700; color:${color};">${dir}</div>
      <div style="width:48px; color:var(--muted);">${conf}</div>
      <div style="flex:1; font-size:13px;">Entry: $${p.entry?Number(p.entry).toFixed(2):"-"}</div>
      <div style="flex:1; font-size:13px;">SL: $${p.sl?Number(p.sl).toFixed(2):"-"}</div>
      <div style="flex:1; font-size:13px;">TP: $${p.tp?Number(p.tp).toFixed(2):"-"}</div>
    </li>`;
  }
  
  function updateCard(sym,preds,tf=null,highOnly=false){
    const card=ensureCard(sym); 
    if(!card) return;
    const metrics=card.querySelector(".metrics"); 
    metrics.innerHTML="";
    
    if(!preds||!preds.length){ 
      metrics.innerHTML="<li>No data available</li>"; 
      card.querySelector(".chip").textContent="--"; 
      return; 
    }
    
    TIMEFRAMES.forEach(t=>{
      if(tf&&t!==tf) return;
      const p=preds.find(x=>x.timeframe===t)||{label:"none",confidence:0};
      if(highOnly&&(p.confidence||0)<0.72) return;
      metrics.insertAdjacentHTML("beforeend",buildTFRow(t,p));
    });
    
    const rows=metrics.querySelectorAll(".tf-row"); 
    let longs=0,shorts=0;
    rows.forEach(r=>{
      const d=r.querySelector("div:nth-child(2)")?.textContent.toLowerCase();
      if(d==="long")longs++;
      if(d==="short")shorts++;
    });
    
    const avg=preds.reduce((s,p)=>s+(p.confidence||0),0)/(preds.length||1);
    const chip=card.querySelector(".chip");
    chip.textContent=Math.round(avg*100)+"%";
    chip.classList.toggle("up",longs>shorts); 
    chip.classList.toggle("down",shorts>longs);
  }
  
  async function refreshAll(tf=null){
    const highOnly=document.getElementById('highConfToggle')?.checked;
    
    // Use SignalGenerator from test_backtest.js
    if(window.SignalGenerator){
      try {
        const results = await window.SignalGenerator.updateAllSignals();
        SYMBOLS.forEach((s)=>{
          const predictions = results[s.pair];
          if(predictions) updateCard(s, predictions, tf, highOnly);
        });
      } catch(err) {
        console.error('Signal generation error:', err);
      }
    }
  }
  
  document.addEventListener("DOMContentLoaded",()=>{
    // Wait for SignalGenerator to load
    setTimeout(refreshAll, 1000);
    
    // Listen for signal updates
    window.addEventListener('signalsUpdated', (e) => {
      const results = e.detail;
      SYMBOLS.forEach((s)=>{
        const predictions = results[s.pair];
        if(predictions) updateCard(s, predictions, null, document.getElementById('highConfToggle')?.checked);
      });
    });
    
    document.getElementById('sigTimeframes')?.addEventListener("click",e=>{
      const b=e.target.closest("button[data-tf]"); 
      if(!b) return;
      document.querySelectorAll("#sigTimeframes .btn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active"); 
      refreshAll(b.dataset.tf);
    });
    
    document.getElementById('highConfToggle')?.addEventListener("change",()=>refreshAll());
  });
  
  window.__AX=window.__AX||{}; 
  window.__AX.updateAiSignals=refreshAll;
})();

/* -------------------- Polls -------------------- */
const samplePolls=[
  {id:1,question:"Do you think Bitcoin will reach $100K by end of 2024?",options:[{id:'yes',text:"Yes",votes:124},{id:'no',text:"No",votes:87}],totalVotes:211,createdAt:"2h ago"},
];
function loadPolls(){
  const c=$("#activePolls"); if(!c) return; c.innerHTML="";
  samplePolls.forEach(p=>{
    const div=document.createElement("div"); div.className="poll-card";
    div.innerHTML=`<div class="poll-question">${p.question}</div>
      <div>${p.options.map(o=>`<label><input type="radio" name="p${p.id}" value="${o.id}">${o.text}</label>`).join("")}</div>
      <small>${p.totalVotes} votes • ${p.createdAt}</small>`;
    c.appendChild(div);
  });
}

/* -------------------- Trending Assets -------------------- */
async function loadTrendingAssets(){
  const c=$("#trendingAssets"); if(!c) return; c.innerHTML="Loading...";
  try{
    const d=await (await fetch("https://api.binance.com/api/v3/ticker/24hr")).json();
    const movers=d.filter(x=>x.symbol.endsWith("USDT")).sort((a,b)=>Math.abs(b.priceChangePercent)-Math.abs(a.priceChangePercent)).slice(0,6);
    c.innerHTML=""; movers.forEach(m=>{const div=document.createElement("div");div.className="card";div.innerHTML=`<h3>${m.symbol}</h3><p>${parseFloat(m.lastPrice).toFixed(2)} USDT</p><strong>${parseFloat(m.priceChangePercent).toFixed(2)}%</strong>`;c.appendChild(div);});
  }catch{c.innerHTML="Failed to load"; }
}

/* -------------------- News -------------------- */
async function loadNews(){
  const ul=$("#newsTicker"); if(!ul) return; ul.innerHTML="<li>Loading...</li>";
  try{
    const j=await (await fetch("https://cryptopanic.com/api/v1/posts/?auth_token=demo&public=true")).json();
    ul.innerHTML=""; j.results.slice(0,10).forEach(n=>{const li=document.createElement("li");li.innerHTML=`<a href="${n.url}" target="_blank">${n.title}</a>`;ul.appendChild(li);});
  }catch{ul.innerHTML="<li>News unavailable</li>";}
}

// Combined: sparkles on move + breathing glow on stop
(function cursorSparkleAndStopGlow() {
  const sparkleCountPerMove = 2;   // particles per mousemove event (tweak)
  const sparkleLifetime = 700;     // must match CSS animation (~700ms)
  const stopDelay = 160;           // ms to wait before considering cursor "stopped" (tweak)
  const stopMoveTolerance = 6;     // px tolerance to consider as stopped (tiny micro movement ok)
  const pulseOnShow = true;        // outward pulse when glow appears

  // create glow element
  const glow = document.createElement('div');
  glow.className = 'cursor-stop-glow';
  document.body.appendChild(glow);

  let stopTimer = null;
  let lastPos = { x: 0, y: 0 };
  let isGlowVisible = false;

  // helper: position glow
  function posGlow(x, y) {
    glow.style.left = `${x}px`;
    glow.style.top = `${y}px`;
  }

  function showGlow(withPulse = false) {
    if (withPulse) {
      glow.classList.add('pulse');
      setTimeout(() => glow.classList.remove('pulse'), 700);
    }
    glow.classList.add('visible');
    isGlowVisible = true;
  }
  function hideGlow() {
    glow.classList.remove('visible');
    isGlowVisible = false;
  }

  // create one sparkle at (x,y) with small randomized velocity
  function spawnSparkle(x, y) {
    const s = document.createElement('div');
    s.className = 'sparkle';
    // slight random offsets so particles don't stack exactly on pointer
    const offsetX = (Math.random() - 0.5) * 10;
    const offsetY = (Math.random() - 0.5) * 10;
    s.style.left = `${x + offsetX}px`;
    s.style.top = `${y + offsetY}px`;

    // optional size variance
    const size = 6 + Math.round(Math.random() * 6); // 6..12px
    s.style.width = `${size}px`;
    s.style.height = `${size}px`;
    s.style.borderRadius = `${size/2}px`;

    document.body.appendChild(s);
    // clean up after animation
    setTimeout(() => s.remove(), sparkleLifetime + 40);
  }

  // main mousemove handler
  document.addEventListener('mousemove', (e) => {
    const x = e.clientX;
    const y = e.clientY;

    // update glow position even if hidden so it appears exactly where cursor stops
    posGlow(x, y);

    // spawn sparkles
    for (let i = 0; i < sparkleCountPerMove; i++) spawnSparkle(x, y);

    // hide glow while moving
    if (isGlowVisible) hideGlow();

    // debounce logic for stop detection
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      // compute distance moved since last position
      const dx = Math.abs(x - lastPos.x);
      const dy = Math.abs(y - lastPos.y);
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist <= stopMoveTolerance) {
        // show breathing glow (with pulse)
        showGlow(pulseOnShow);
      } else {
        // if micro movement, schedule another check
        stopTimer = setTimeout(() => showGlow(pulseOnShow), stopDelay);
      }
      lastPos = { x, y };
    }, stopDelay);

    // update last pos for tolerance check
    lastPos = { x, y };
  }, { passive: true });

  // hide on leave/mousedown
  document.addEventListener('mouseleave', () => { if (stopTimer) clearTimeout(stopTimer); hideGlow(); });
  document.addEventListener('mousedown', () => { if (stopTimer) clearTimeout(stopTimer); hideGlow(); });
})();
