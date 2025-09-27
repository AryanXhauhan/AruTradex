// Minimal interactive behaviours for pricing page
document.addEventListener('DOMContentLoaded', () => {
  const monthlyRadio = document.getElementById('billingMonth');
  const annualRadio = document.getElementById('billingLifetime');
  const cards = document.querySelectorAll('.pricing-grid .card');

  function updatePrices(islifetime) {
    cards.forEach(card => {
      const month = card.dataset.month;
      const lifetime = card.dataset.lifetime ?? month;
      const amountEl = card.querySelector('.price .price-amount');

      if (!amountEl) return;
      if (islifetime) {
        amountEl.textContent = formatNumber(lifetime);
        const period = card.querySelector('.period');
        if (period) period.textContent = '(lifetime)';
      } else {
        amountEl.textContent = formatNumber(month);
        const period = card.querySelector('.period');
        if (period) period.textContent = '/month';
      }
    });
  }

  function formatNumber(n) {
    // simple thousands formatting (e.g., 10399 -> 10,399)
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Initial state (monthly)
  updatePrices(false);

  // Event listeners for radio buttons
  monthlyRadio.addEventListener('change', () => {
    if (monthlyRadio.checked) updatePrices(false);
  });

  annualRadio.addEventListener('change', () => {
    if (annualRadio.checked) updatePrices(true);
  });

  // Buy button demo handlers
  document.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      const card = ev.target.closest('.card');
      const tier = card ? card.querySelector('.tier').textContent : 'plan';
      window.location.href = '../signup/signup.html?plan=' + encodeURIComponent(tier);
    });
  });
});
