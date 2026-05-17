'use strict';

// FIX v10: reads from spm_recent (lightweight index) instead of
// the old spm_history flat array that was out of sync with content storage.
chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, response => {
  const list = document.getElementById('list');
  const history = response?.history || [];
  if (!history.length) return;
  list.innerHTML = history.slice(0, 10).map(item => `
    <div class="item">
      <div class="item-username">${esc(item.username || 'Unknown')}</div>
      <div class="item-stats">❤ ${fmt(item.likes)} · ${new Date(item.ts).toLocaleString()}</div>
      <div class="item-url"><a href="${esc(item.url)}" target="_blank">${esc(item.url)}</a></div>
    </div>`).join('');
});

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
