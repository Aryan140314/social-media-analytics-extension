function ago(t) {
  const d=Date.now()-t, m=Math.floor(d/60000);
  if(m<1) return 'just now'; if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function fmt(n) {
  if(n==null) return null;
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  if(n>=1e3) return (n/1e3).toFixed(1)+'K';
  return n.toLocaleString();
}

chrome.storage.local.get(['spm_history'], r => {
  const history = r.spm_history || [];
  const el = document.getElementById('recent');

  if (!history.length) {
    el.innerHTML = `<div class="no-data"><div class="icon">🔍</div>No posts monitored yet.<br/>Open a post and click 📊</div>`;
    return;
  }

  // Group by URL, keep latest snapshot
  const byUrl = {};
  history.forEach(h => {
    if (!byUrl[h.url] || h.ts > byUrl[h.url].ts) byUrl[h.url] = h;
  });

  const rows = Object.values(byUrl).sort((a,b)=>b.ts-a.ts).slice(0,5);
  el.innerHTML = rows.map(h => {
    const urlPath = (() => { try { return new URL(h.url).pathname.slice(0,40)+'…'; } catch(e) { return (h.url||'').slice(0,40); } })();
    const badges = [
      h.likes    != null ? `❤️ ${fmt(h.likes)}`    : null,
      h.comments != null ? `💬 ${fmt(h.comments)}` : null,
      h.shares   != null ? `🔁 ${fmt(h.shares)}`   : null,
    ].filter(Boolean);
    return `<div class="stat-row" style="flex-direction:column;align-items:flex-start">
      <div style="display:flex;align-items:center;gap:6px;width:100%">
        <span class="stat-platform">${(h.platform||'?').toUpperCase()}</span>
        <span class="stat-url" title="${h.url}">${urlPath}</span>
      </div>
      <div class="badges">${badges.map(b=>`<span class="badge">${b}</span>`).join('')||'<span class="badge">No stats</span>'}</div>
      <div class="stat-time">Updated ${ago(h.ts)}</div>
    </div>`;
  }).join('');
});

document.getElementById('clear-btn').onclick = () => {
  chrome.storage.local.remove('spm_history', () => {
    document.getElementById('recent').innerHTML = `<div class="no-data"><div class="icon">🗑️</div>History cleared.</div>`;
  });
};
