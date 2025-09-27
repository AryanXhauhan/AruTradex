// Load TradingView Script
(function loadTVScript() {
  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/tv.js";
  script.onload = () => {
    renderChartWidgets(); // Once script loads, render charts
  };
  document.head.appendChild(script);
})();

// Chart rendering
function renderChartWidgets() {
  // Hero chart – XAUUSD (Gold)
  new TradingView.widget({
    container_id: "chart-widget",
    width: "100%",
    height: 500,
    symbol: "OANDA:XAUUSD",
    interval: "60",
    timezone: "Etc/UTC",
    theme: "light",
    style: "1",
    locale: "en",
    toolbar_bg: "#f1f3f6",
    enable_publishing: false,
    hide_side_toolbar: false,
    allow_symbol_change: true
  });

  // Crypto widget – BTCUSDT
  new TradingView.widget({
    container_id: "crypto-widget",
    width: "100%",
    height: 400,
    symbol: "BINANCE:BTCUSDT",
    interval: "60",
    timezone: "Etc/UTC",
    theme: "light",
    style: "1",
    locale: "en",
    toolbar_bg: "#f5f5f5",
    enable_publishing: false,
    allow_symbol_change: true
  });

  // Futures widget – Nasdaq Futures
  new TradingView.widget({
    container_id: "futures-widget",
    width: "100%",
    height: 400,
    symbol: "CME_MINI:NQ1!",
    interval: "60",
    timezone: "Etc/UTC",
    theme: "light",
    style: "1",
    locale: "en",
    toolbar_bg: "#f5f5f5",
    enable_publishing: false,
    allow_symbol_change: true
  });

  // Forex widget – EUR/USD
  new TradingView.widget({
    container_id: "forex-widget",
    width: "100%",
    height: 400,
    symbol: "OANDA:EURUSD",
    interval: "60",
    timezone: "Etc/UTC",
    theme: "light",
    style: "1",
    locale: "en",
    toolbar_bg: "#f5f5f5",
    enable_publishing: false,
    allow_symbol_change: true
  });
}
