'use strict';

function ago(t) {
  const d = Date.now()-t, m = Math.floor(d/60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m+'m ago';
  const h = Math.floor(m/60);
  if (h < 24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function fmt(n) {
  if (n == null || isNaN(n)) return null;
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return Number(n).toLocaleString();
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

chrome.storage.local.get(['spm_history'], r => {
  const history = r.spm_history || [];
  const el = document.getElementById('recent');
  if (!history.length) {
    el.innerHTML = `<div class="empty"><div class="icon">🔍</div>No posts monitored yet.<br>Open a post and click 📊</div>`;
    return;
  }

  // Deduplicate: keep latest snapshot per URL
  const byUrl = {};
  history.forEach(h => { if (!byUrl[h.url] || h.ts > byUrl[h.url].ts) byUrl[h.url] = h; });

  const rows = Object.values(byUrl).sort((a,b) => b.ts - a.ts).slice(0, 5);
  el.innerHTML = rows.map(h => {
    let path = h.url || '';
    try { path = new URL(h.url).pathname.slice(0, 45) + '…'; } catch {}
    const badges = [
      h.likes    != null ? `❤️ ${fmt(h.likes)}`    : null,
      h.comments != null ? `💬 ${fmt(h.comments)}` : null,
      h.shares   != null ? `🔁 ${fmt(h.shares)}`   : null,
      h.engageRate       ? `📊 ${esc(h.engageRate)}` : null,
    ].filter(Boolean);
    return `<div class="row">
      <div class="row-top">
        <span class="plat">${esc((h.platform||'?').toUpperCase())}</span>
        <span class="url" title="${esc(h.url)}">${esc(path)}</span>
      </div>
      <div class="badges">${badges.map(b=>`<span class="badge">${b}</span>`).join('')||'<span class="badge">No stats</span>'}</div>
      <div class="time">Updated ${ago(h.ts)}</div>
    </div>`;
  }).join('');
});

document.getElementById('clear-btn').addEventListener('click', () => {
  chrome.storage.local.remove('spm_history', () => {
    document.getElementById('recent').innerHTML = `<div class="empty"><div class="icon">🗑️</div>History cleared.</div>`;
  });
});
