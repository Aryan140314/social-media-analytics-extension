// ═══════════════════════════════════════════════════════════════
//  SPM Pro v4  ·  content/ui.js
//  Sidebar UI — driven by SpmExtractor + SpmMonitor events.
// ═══════════════════════════════════════════════════════════════
'use strict';

if (document.getElementById('spm-root')) {
  spmLog.warn('SPM already injected');
} else {

const _ui = {
  open:      false,
  activeTab: 'stats',
  settings:  { theme:'light', notifications:true, autosave:true },
  current:   {},
  profile:   {},
  comments:  [],
  mediaUrls: [],
  history:   [],
};

// ── Load persisted state ────────────────────────────────────────
async function _loadState() {
  const r = await spmGet(['spm_settings','spm_history']);
  if (r.spm_settings) Object.assign(_ui.settings, r.spm_settings);
  if (r.spm_history)  _ui.history = r.spm_history;
  _applyTheme();
  const t = spmEl('theme-toggle'); if(t) t.checked = _ui.settings.theme==='dark';
}

// ── Build DOM ───────────────────────────────────────────────────
function _buildSidebar() {
  const root = document.createElement('div');
  root.id = 'spm-root';
  root.innerHTML = `
    <div id="spm-resize-handle"></div>
    <div id="spm-sidebar">
      <div id="spm-header">
        <span id="spm-logo">📊 SPM Pro</span>
        <span id="spm-platform-badge">${SPM.PLATFORM}</span>
        <span id="spm-source-badge" class="spm-src-dom" title="Data source">DOM</span>
        <span id="spm-monitor-dot" title="Auto-monitor"></span>
        <button id="spm-close-btn">✕</button>
      </div>
      <nav id="spm-tabs">
        <button class="spm-tab active" data-tab="stats"><span>📊</span>Stats</button>
        <button class="spm-tab" data-tab="comments"><span>💬</span>Comments</button>
        <button class="spm-tab" data-tab="profile"><span>👤</span>Profile</button>
        <button class="spm-tab" data-tab="analytics"><span>📈</span>Analytics</button>
        <button class="spm-tab" data-tab="downloads"><span>⬇️</span>Downloads</button>
        <button class="spm-tab" data-tab="settings"><span>⚙️</span>Settings</button>
      </nav>
      <div id="spm-content">
        ${_tStats()}${_tComments()}${_tProfile()}${_tAnalytics()}${_tDownloads()}${_tSettings()}
      </div>
      <footer id="spm-statusbar">
        <span class="spm-dot" id="spm-dot"></span>
        <span id="spm-status-text">Ready</span>
        <span id="spm-last-update"></span>
      </footer>
    </div>`;
  document.body.appendChild(root);

  const fab = document.createElement('button');
  fab.id='spm-fab'; fab.title='Social Post Monitor Pro'; fab.innerText='📊';
  document.body.appendChild(fab);
  return root;
}

function _tStats() { return `
<section class="spm-panel active" id="panel-stats">
  <div class="spm-stats-grid">
    <div class="spm-stat-card"><div class="spm-stat-icon">❤️</div><div class="spm-stat-value" id="s-likes">—</div><div class="spm-stat-label">Likes</div><div class="spm-stat-change" id="s-likes-chg"></div></div>
    <div class="spm-stat-card"><div class="spm-stat-icon">💬</div><div class="spm-stat-value" id="s-comments">—</div><div class="spm-stat-label">Comments</div><div class="spm-stat-change" id="s-comments-chg"></div></div>
    <div class="spm-stat-card"><div class="spm-stat-icon">🔁</div><div class="spm-stat-value" id="s-shares">—</div><div class="spm-stat-label">Shares</div><div class="spm-stat-change" id="s-shares-chg"></div></div>
    <div class="spm-stat-card"><div class="spm-stat-icon">👁️</div><div class="spm-stat-value" id="s-reach">—</div><div class="spm-stat-label">Reach/Views</div></div>
  </div>
  <div class="spm-engage-bar">
    <div class="spm-engage-label"><span>Engagement Rate</span><strong id="s-engage-val">—</strong></div>
    <div class="spm-engage-track"><div class="spm-engage-fill" id="s-engage-fill" style="width:0%"></div></div>
  </div>
  <div class="spm-btn-row">
    <button class="spm-btn spm-btn-primary" id="btn-refresh">🔄 Refresh</button>
    <button class="spm-btn spm-btn-secondary" id="btn-export-csv">📥 CSV</button>
  </div>
  <div class="spm-section-title">🔔 Auto Monitor</div>
  <div class="spm-card">
    <div class="spm-row-between">
      <span class="spm-label-bold">Watch for changes</span>
      <label class="spm-toggle"><input type="checkbox" id="monitor-toggle"><span class="spm-toggle-track"></span></label>
    </div>
    <div class="spm-row-gap" style="margin-top:8px;font-size:11px;color:var(--muted)">
      Interval: <select class="spm-select" id="mon-interval">
        <option value="15">15s</option><option value="30">30s</option>
        <option value="60" selected>1min</option><option value="300">5min</option><option value="600">10min</option>
      </select>
      Alert if ≥ <select class="spm-select" id="mon-threshold">
        <option value="1">1</option><option value="5">5</option>
        <option value="10">10</option><option value="25">25</option><option value="50">50</option>
      </select>
    </div>
    <div id="monitor-log" class="spm-monitor-log"></div>
  </div>
  <div id="s-reach-note" class="spm-note" style="display:none">📷 Photo — Instagram doesn't show view counts for photos.</div>
</section>`; }

function _tComments() { return `
<section class="spm-panel" id="panel-comments">
  <div class="spm-row-gap" style="margin-bottom:8px">
    <input class="spm-input" id="comment-search" placeholder="🔍 Search comments…"/>
    <button class="spm-btn spm-btn-primary" style="width:auto;white-space:nowrap" id="btn-load-comments">Load</button>
  </div>
  <div class="spm-row-gap" style="margin-bottom:10px">
    <button class="spm-btn spm-btn-secondary" id="btn-copy-comments">📋 Copy All</button>
    <button class="spm-btn spm-btn-secondary" id="btn-load-more">Load More</button>
  </div>
  <div id="comment-count" class="spm-muted-text">No comments loaded</div>
  <div id="comment-list" class="spm-comment-list">
    <div class="spm-empty"><div class="spm-empty-icon">💬</div><p>Click "Load" to fetch comments</p></div>
  </div>
</section>`; }

function _tProfile() { return `
<section class="spm-panel" id="panel-profile">
  <div id="profile-content"><div class="spm-empty"><div class="spm-empty-icon">👤</div><p>Click below to load profile</p></div></div>
  <button class="spm-btn spm-btn-primary" id="btn-load-profile">👤 Load Profile Stats</button>
  <div class="spm-note" style="margin-top:8px">💡 Visit the profile page for complete follower data.</div>
</section>`; }

function _tAnalytics() { return `
<section class="spm-panel" id="panel-analytics">
  <div class="spm-section-title">Likes Over Time</div>
  <div class="spm-chart-card"><div id="chart-likes" class="spm-chart-area"></div></div>
  <div class="spm-section-title">Comments Over Time</div>
  <div class="spm-chart-card"><div id="chart-comments" class="spm-chart-area"></div></div>
  <div class="spm-section-title">Engagement Over Time</div>
  <div class="spm-chart-card"><div id="chart-engage" class="spm-chart-area"></div></div>
  <div class="spm-section-title">History Log</div>
  <div class="spm-chart-card" style="padding:0;overflow:auto">
    <table class="spm-table"><thead><tr><th>When</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Engage%</th></tr></thead>
    <tbody id="history-tbody"></tbody></table>
  </div>
  <div class="spm-btn-row" style="margin-top:10px">
    <button class="spm-btn spm-btn-secondary" id="btn-clear-history">🗑️ Clear</button>
    <button class="spm-btn spm-btn-secondary" id="btn-export-json">📤 JSON</button>
  </div>
</section>`; }

function _tDownloads() { return `
<section class="spm-panel" id="panel-downloads">
  <div class="spm-section-title">Post Media</div>
  <div id="media-grid" class="spm-media-grid">
    <div class="spm-empty" style="grid-column:1/-1"><div class="spm-empty-icon">🖼️</div><p>Refresh stats first</p></div>
  </div>
  <div class="spm-btn-row">
    <button class="spm-btn spm-btn-success"   id="btn-dl-all">⬇️ Download All</button>
    <button class="spm-btn spm-btn-secondary" id="btn-scan-media">🔍 Re-scan</button>
  </div>
  <div class="spm-section-title" style="margin-top:14px">Bulk Profile Download</div>
  <div class="spm-disclaimer">⚠️ Only download content you own or have rights to. Downloading others' media may violate platform Terms of Service.</div>
  <button class="spm-btn spm-btn-warning" id="btn-bulk-profile">📦 Bulk Download Profile</button>
  <div id="bulk-wrap" style="display:none;margin-top:8px">
    <div class="spm-prog-track"><div class="spm-prog-fill" id="bulk-fill" style="width:0%"></div></div>
    <div class="spm-muted-text" id="bulk-text" style="text-align:center;margin-top:4px">Preparing…</div>
  </div>
</section>`; }

function _tSettings() { return `
<section class="spm-panel" id="panel-settings">
  <div class="spm-section-title">Appearance</div>
  <div class="spm-setting-row">
    <div><div class="spm-label-bold">🌙 Dark Mode</div><div class="spm-muted-text">Switch sidebar theme</div></div>
    <label class="spm-toggle"><input type="checkbox" id="theme-toggle"><span class="spm-toggle-track"></span></label>
  </div>
  <div class="spm-section-title">Notifications</div>
  <div class="spm-setting-row">
    <div><div class="spm-label-bold">🔔 Desktop Alerts</div><div class="spm-muted-text">Notify when stats change</div></div>
    <label class="spm-toggle"><input type="checkbox" id="notif-toggle" checked><span class="spm-toggle-track"></span></label>
  </div>
  <div class="spm-section-title">Data</div>
  <div class="spm-setting-row">
    <div><div class="spm-label-bold">💾 Auto-save Snapshots</div><div class="spm-muted-text">Save stats on each refresh</div></div>
    <label class="spm-toggle"><input type="checkbox" id="autosave-toggle" checked><span class="spm-toggle-track"></span></label>
  </div>
  <button class="spm-btn spm-btn-secondary" id="btn-export-settings">📤 Export Data (JSON)</button>
  <button class="spm-btn spm-btn-danger"    id="btn-clear-all">🗑️ Clear All Data</button>
  <div class="spm-section-title">Compliance</div>
  <div class="spm-disclaimer">⚠️ Scraping Facebook/Instagram may violate their Terms of Service. Intended for personal use on your own posts only.</div>
  <div class="spm-section-title">About</div>
  <div class="spm-card" style="font-size:11px;color:var(--muted)">
    📊 <strong>SPM Pro v${SPM.VERSION}</strong> · Facebook &amp; Instagram<br/>
    Manifest V3 · Brave / Chrome / Edge<br/>
    API interception + DOM fallback
  </div>
</section>`; }

// ── Wire events ─────────────────────────────────────────────────
function _wire() {
  spmEl('spm-fab').onclick     = _toggle;
  spmEl('spm-close-btn').onclick = _close;
  spmQA('.spm-tab').forEach(t => t.onclick = () => _switchTab(t.dataset.tab));

  spmEl('btn-refresh').onclick   = () => _scrape(true);
  spmEl('btn-export-csv').onclick = _exportCSV;
  spmEl('monitor-toggle').onchange = e => _onMonitor(e.target.checked);
  spmEl('mon-interval').onchange   = e => SpmMonitor.setInterval(+e.target.value);
  spmEl('mon-threshold').onchange  = e => SpmMonitor.setThreshold(+e.target.value);

  spmEl('btn-load-comments').onclick  = _loadComments;
  spmEl('btn-copy-comments').onclick  = _copyComments;
  spmEl('btn-load-more').onclick      = _clickLoadMore;
  spmEl('comment-search').oninput     = spmDebounce(e => _filterComments(e.target.value), 250);

  spmEl('btn-load-profile').onclick = _loadProfile;
  spmEl('btn-clear-history').onclick = _clearHistory;
  spmEl('btn-export-json').onclick   = _exportJSON;

  spmEl('btn-dl-all').onclick      = _dlAll;
  spmEl('btn-scan-media').onclick  = () => _scrape(true);
  spmEl('btn-bulk-profile').onclick = _bulkDownload;

  spmEl('theme-toggle').onchange    = e => _setTheme(e.target.checked?'dark':'light');
  spmEl('notif-toggle').onchange    = e => _saveSetting('notifications', e.target.checked);
  spmEl('autosave-toggle').onchange = e => _saveSetting('autosave', e.target.checked);
  spmEl('btn-export-settings').onclick = _exportJSON;
  spmEl('btn-clear-all').onclick    = _clearAll;

  _initResize();
}

// ── Sidebar open/close/tabs ──────────────────────────────────────
function _toggle() { _ui.open ? _close() : _open(); }
function _open()   { _ui.open=true; spmEl('spm-root').classList.add('spm-open'); spmEl('spm-fab').classList.add('spm-fab-open'); spmEl('spm-fab').innerText='✕'; if(_ui.activeTab==='analytics') _renderCharts(); if(_ui.activeTab==='downloads') _renderMediaGrid(); }
function _close()  { _ui.open=false; spmEl('spm-root').classList.remove('spm-open'); spmEl('spm-fab').classList.remove('spm-fab-open'); spmEl('spm-fab').innerText='📊'; }
function _switchTab(t) {
  _ui.activeTab=t;
  spmQA('.spm-tab').forEach(el=>{ el.classList.toggle('active',el.dataset.tab===t); el.setAttribute('aria-selected',String(el.dataset.tab===t)); });
  spmQA('.spm-panel').forEach(p=>p.classList.toggle('active',p.id===`panel-${t}`));
  if(t==='analytics') _renderCharts();
  if(t==='downloads') _renderMediaGrid();
}
function _applyTheme() { document.getElementById('spm-root')?.classList.toggle('spm-dark', _ui.settings.theme==='dark'); }
function _setTheme(t)  { _ui.settings.theme=t; _applyTheme(); _saveSetting('theme',t); }
async function _saveSetting(k,v) { _ui.settings[k]=v; await spmSet({spm_settings:_ui.settings}); }

// ── Status bar ───────────────────────────────────────────────────
let _stTimer=null;
function _setStatus(msg,type='idle',autoClear=true) {
  const dot=spmEl('spm-dot'),txt=spmEl('spm-status-text'),upd=spmEl('spm-last-update');
  if(!txt) return;
  txt.textContent=msg;
  if(dot){dot.className='spm-dot'; if(type==='ok')dot.classList.add('dot-ok'); if(type==='err')dot.classList.add('dot-err');}
  if(upd) upd.textContent=spmTs();
  if(_stTimer) clearTimeout(_stTimer);
  if(autoClear&&type!=='err') _stTimer=setTimeout(()=>{if(txt)txt.textContent='Ready';},3500);
}
function _setLoading(id,on) {
  const b=spmElFresh(id); if(!b) return;
  b.disabled=on;
  if(on){b.dataset.orig=b.innerText;b.innerText='⏳…';}
  else b.innerText=b.dataset.orig||b.innerText;
}
function _setSourceBadge(source) {
  const el=spmElFresh('spm-source-badge'); if(!el) return;
  el.textContent   = source==='api' ? 'API ✓' : 'DOM';
  el.className     = 'spm-src-' + (source==='api'?'api':'dom');
  el.title         = source==='api' ? 'Data from network API (accurate)' : 'Data scraped from DOM (approximate)';
}

// ── Core scrape ──────────────────────────────────────────────────
const _scrape = spmDebounce(async function(showLoader=false) {
  if(showLoader) _setLoading('btn-refresh',true);
  _setStatus('Scanning…','idle',false);
  try {
    const fresh = SpmExtractor.stats();
    const prev  = _ui.current;
    _ui.current  = fresh;
    _ui.mediaUrls = fresh.mediaUrls||[];

    _updateStatsUI(fresh, prev);
    _setSourceBadge(fresh.source||'dom');
    if(_ui.activeTab==='downloads') _renderMediaGrid();

    if(_ui.settings.autosave!==false) {
      const snap = spmNormalise({ platform:fresh.platform, url:fresh.url, ts:Date.now(),
        likes:fresh.likes, comments:fresh.comments, shares:fresh.shares, reach:fresh.reach,
        engageRate:spmEngagement(fresh.likes,fresh.comments,_ui.profile.followers) });
      spmBoundedPush(_ui.history, snap, SPM.MAX_HISTORY);
      await spmSet({ spm_history: _ui.history });
      if(_ui.activeTab==='analytics') _renderCharts();
    }
    SpmMonitor.setLastStats(fresh);
    _setStatus('Updated '+spmTs(), 'ok');
  } catch(e) {
    spmLog.error('_scrape:', e);
    _setStatus('Error — see console','err',false);
  } finally { if(showLoader) _setLoading('btn-refresh',false); }
}, 300);

function _updateStatsUI(fresh, prev) {
  const _set = (id,val,muted) => { const el=spmElFresh(id); if(!el) return; el.textContent=spmFmt(val)||'—'; el.style.color=muted?'var(--muted)':''; el.style.fontSize=String(val||'').length>7?'13px':''; };
  _set('s-likes',    fresh.likes);
  _set('s-comments', fresh.comments);
  _set('s-shares',   fresh.shares);
  _set('s-reach',    fresh.reach, fresh.reachIsNA);

  const _chg = (id,nv,ov) => { const el=spmElFresh(id); if(!el) return; const n=nv,o=ov; if(n==null||o==null||n===o){el.textContent='';return;} const d=n-o; el.textContent=(d>0?'▲ +':'▼ ')+Math.abs(d).toLocaleString(); el.className='spm-stat-change '+(d>0?'chg-up':'chg-down'); };
  _chg('s-likes-chg',    fresh.likes,    prev.likes);
  _chg('s-comments-chg', fresh.comments, prev.comments);

  const rate=spmEngagement(fresh.likes,fresh.comments,_ui.profile.followers);
  const rEl=spmElFresh('s-engage-val'),fEl=spmElFresh('s-engage-fill');
  if(rEl) rEl.textContent=rate||'— (load profile for followers)';
  if(fEl&&rate) fEl.style.width=Math.min(100,parseFloat(rate)*5)+'%';

  const note=spmElFresh('s-reach-note'); if(note) note.style.display=fresh.reachIsNA?'block':'none';
}

// ── Monitor ──────────────────────────────────────────────────────
function _onMonitor(on) {
  const dot=spmElFresh('spm-monitor-dot');
  if(on) { SpmMonitor.start({interval:+spmEl('mon-interval').value, threshold:+spmEl('mon-threshold').value}); dot?.classList.add('dot-active'); _addMonitorLog({isAlert:false,ts:Date.now(),msg:'▶ Started'}); }
  else   { SpmMonitor.stop(); dot?.classList.remove('dot-active'); _addMonitorLog({isAlert:false,ts:Date.now(),msg:'⏹ Stopped'}); }
}
function _addMonitorLog(entry) {
  const log=spmElFresh('monitor-log'); if(!log) return;
  const div=document.createElement('div');
  div.className='spm-log-item'+(entry.isAlert?' spm-log-alert':'');
  const t=new Date(entry.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  div.textContent=`[${t}] ${entry.msg||(entry.alerts||[]).map(a=>`${a.label} ${a.diff>0?'+':''}${a.diff}`).join(' · ')}`;
  log.prepend(div);
  while(log.children.length>SPM.MAX_LOG) log.removeChild(log.lastChild);
}

// ── Comments ─────────────────────────────────────────────────────
async function _loadComments() {
  _setLoading('btn-load-comments',true); _setStatus('Scraping comments…','idle',false);
  try {
    await new Promise(r=>setTimeout(r,80));
    _ui.comments = SpmExtractor.comments();
    _renderCommentList(_ui.comments);
    spmElFresh('comment-count').textContent=`${_ui.comments.length} comment${_ui.comments.length!==1?'s':''} found`;
    _setStatus(`Loaded ${_ui.comments.length} comments`,'ok');
  } catch(e) { spmLog.error('_loadComments:',e); _setStatus('Failed','err',false); }
  finally { _setLoading('btn-load-comments',false); }
}
function _renderCommentList(items) {
  const list=spmElFresh('comment-list'); if(!list) return;
  if(!items.length){list.innerHTML=`<div class="spm-empty"><div class="spm-empty-icon">💬</div><p>No comments detected</p></div>`;return;}
  const frag=document.createDocumentFragment();
  items.forEach(c=>{
    const div=document.createElement('div'); div.className='spm-comment-item';
    div.innerHTML=`<div class="spm-comment-header"><div class="spm-avatar">${spmEsc(c.username.charAt(0).toUpperCase())}</div><span class="spm-comment-user">@${spmEsc(c.username)}</span>${c.time?`<span class="spm-comment-time">${spmEsc(String(c.time))}</span>`:''}</div><div class="spm-comment-text">${spmEsc(c.text)}</div>${c.likes!=null?`<div class="spm-comment-meta">❤️ ${spmFmt(c.likes)}</div>`:''}`;
    frag.appendChild(div);
  });
  list.innerHTML=''; list.appendChild(frag);
}
const _filterComments = spmDebounce(function(q) {
  const lo=q.toLowerCase(), filtered=lo?_ui.comments.filter(c=>c.username.toLowerCase().includes(lo)||c.text.toLowerCase().includes(lo)):_ui.comments;
  _renderCommentList(filtered);
  const el=spmElFresh('comment-count'); if(el) el.textContent=`${filtered.length} of ${_ui.comments.length} shown`;
},200);
function _copyComments() {
  if(!_ui.comments.length){_setStatus('No comments loaded','err');return;}
  navigator.clipboard.writeText(_ui.comments.map(c=>`@${c.username}: ${c.text}`).join('\n'))
    .then(()=>_setStatus(`Copied ${_ui.comments.length} comments ✓`,'ok'))
    .catch(e=>{spmLog.error('clipboard:',e);_setStatus('Copy failed','err');});
}
function _clickLoadMore() {
  const btn=spmQA('button,span').find(el=>/load more|view more|view all/i.test((el.innerText||'').trim()));
  if(btn){btn.click();setTimeout(_loadComments,1400);_setStatus('Loading more…','idle',false);}
  else _setStatus('No "Load more" button found','err');
}

// ── Profile ──────────────────────────────────────────────────────
async function _loadProfile() {
  _setLoading('btn-load-profile',true); _setStatus('Loading profile…','idle',false);
  try {
    _ui.profile=SpmExtractor.profile();
    const c=spmElFresh('profile-content'); if(c) {
      const p=_ui.profile, hasStats=p.followers||p.following||p.posts;
      c.innerHTML=`<div class="spm-profile-card">${p.avatarSrc?`<img class="spm-profile-img" src="${spmEsc(p.avatarSrc)}" alt="avatar" onerror="this.style.display='none'"/>`: `<div class="spm-profile-placeholder">👤</div>`}<div><div class="spm-profile-name">${spmEsc(p.name||p.username||'Unknown')}</div>${p.username?`<div class="spm-muted-text">@${spmEsc(p.username)}</div>`:''} ${p.bio?`<div class="spm-profile-bio">${spmEsc(p.bio)}</div>`:''}</div></div>${hasStats?`<div class="spm-profile-stats"><div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(p.followers)}</div><div class="spm-muted-text">Followers</div></div><div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(p.following)}</div><div class="spm-muted-text">Following</div></div><div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(p.posts)}</div><div class="spm-muted-text">Posts</div></div></div>`:`<div class="spm-note">Visit the profile page for full follower data.</div>`}`;
    }
    _updateStatsUI(_ui.current,{}); // re-compute engage with follower data
    _setStatus('Profile loaded ✓','ok');
  } catch(e){spmLog.error('_loadProfile:',e);_setStatus('Failed','err',false);}
  finally{_setLoading('btn-load-profile',false);}
}

// ── Analytics / Charts ────────────────────────────────────────────
function _renderCharts() {
  const hist=_ui.history.filter(h=>h.url&&(h.url===location.href||h.url.split('?')[0]===location.href.split('?')[0]));
  _drawChart('chart-likes',    hist, 'likes',    'var(--accent)');
  _drawChart('chart-comments', hist, 'comments', 'var(--green)');
  _drawChart('chart-engage',   hist.map(h=>({...h,engageRateNum:h.engageRate?parseFloat(h.engageRate):null})), 'engageRateNum', 'var(--orange)');
  _renderHistoryTable(hist);
}
function _drawChart(id, data, field, color) {
  const c=spmElFresh(id); if(!c) return;
  const pts=data.map(h=>({x:h.ts,y:h[field]})).filter(p=>p.y!=null);
  if(pts.length<2){c.innerHTML=`<div class="spm-chart-empty">Not enough data yet — refresh a few times.</div>`;return;}
  const W=340,H=130,P={t:14,r:10,b:26,l:40},cW=W-P.l-P.r,cH=H-P.t-P.b;
  const ys=pts.map(p=>p.y),mn=Math.min(...ys),mx=Math.max(...ys),rng=mx-mn||1;
  const xS=i=>P.l+(i/(pts.length-1||1))*cW, yS=v=>P.t+cH-((v-mn)/rng)*cH;
  const line=pts.map((p,i)=>`${xS(i)},${yS(p.y)}`).join(' ');
  const area=`${line} ${xS(pts.length-1)},${P.t+cH} ${xS(0)},${P.t+cH}`;
  const ticks=[0,.5,1].map(t=>{const y=P.t+t*cH,v=mx-t*rng;const lbl=v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':Math.round(v).toString();return`<line x1="${P.l}" y1="${y}" x2="${W-P.r}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,2" stroke-width="1"/><text x="${P.l-4}" y="${y+4}" text-anchor="end" font-size="9" fill="var(--muted)">${lbl}</text>`;}).join('');
  const xlbls=[0,Math.floor((pts.length-1)/2),pts.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text x="${xS(i)}" y="${H-4}" text-anchor="middle" font-size="9" fill="var(--muted)">${new Date(pts[i].x).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text>`).join('');
  const dots=pts.map((p,i)=>`<circle cx="${xS(i)}" cy="${yS(p.y)}" r="3" fill="${color}" stroke="var(--bg)" stroke-width="1.5"><title>${Math.round(p.y).toLocaleString()}</title></circle>`).join('');
  const uid=id.replace(/[^a-z]/gi,'');
  c.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".2"/><stop offset="100%" stop-color="${color}" stop-opacity=".01"/></linearGradient></defs>${ticks}<polygon points="${area}" fill="url(#g${uid})"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}${xlbls}</svg>`;
}
function _renderHistoryTable(hist) {
  const tb=spmElFresh('history-tbody'); if(!tb) return;
  if(!hist.length){tb.innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:16px">No history for this URL yet</td></tr>`;return;}
  const frag=document.createDocumentFragment();
  [...hist].reverse().slice(0,40).forEach(h=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${spmAgo(h.ts)}</td><td>${spmFmt(h.likes)||'—'}</td><td>${spmFmt(h.comments)||'—'}</td><td>${spmFmt(h.shares)||'—'}</td><td>${h.engageRate||'—'}</td>`;
    frag.appendChild(tr);
  });
  tb.innerHTML=''; tb.appendChild(frag);
}
async function _clearHistory() {
  if(!confirm('Clear all history?')) return;
  _ui.history=[]; await spmRemove('spm_history'); _renderCharts(); _setStatus('History cleared','ok');
}

// ── Downloads ────────────────────────────────────────────────────
function _renderMediaGrid() {
  const grid=spmElFresh('media-grid'); if(!grid) return;
  const urls=_ui.mediaUrls;
  if(!urls.length){grid.innerHTML=`<div class="spm-empty" style="grid-column:1/-1"><div class="spm-empty-icon">🖼️</div><p>No media found</p></div>`;return;}
  const frag=document.createDocumentFragment();
  urls.forEach((url,i)=>{
    const isVid=/\.mp4|video/i.test(url);
    const w=document.createElement('div'); w.className='spm-thumb'; w.dataset.url=url; w.dataset.i=i;
    w.innerHTML=isVid?`<div class="spm-thumb-inner spm-thumb-video">🎬<div class="spm-thumb-badge">MP4</div></div><div class="spm-thumb-overlay">⬇️</div>`:`<img src="${spmEsc(url)}" alt="media ${i+1}" loading="lazy" onerror="this.closest('.spm-thumb').style.display='none'"/><div class="spm-thumb-overlay">⬇️</div>`;
    w.onclick=()=>_dlOne(url,i); frag.appendChild(w);
  });
  grid.innerHTML=''; grid.appendChild(frag);
}
async function _dlOne(url,idx) {
  if(!spmValidateUrl(url)){_setStatus('Blocked URL','err');return;}
  const ext=/\.mp4|video/i.test(url)?'mp4':'jpg';
  const res=await spmSend({type:'DOWNLOAD_MEDIA',url,filename:`${SPM.PLATFORM}_${Date.now()}_${idx}.${ext}`});
  _setStatus(res?.ok?'Downloading…':'Download failed: '+(res?.error||'?'), res?.ok?'ok':'err');
}
async function _dlAll() {
  if(!_ui.mediaUrls.length){_setStatus('No media','err');return;}
  _setStatus(`Queuing ${_ui.mediaUrls.length} downloads…`,'ok');
  const res=await spmSend({type:'BULK_DOWNLOAD',urls:_ui.mediaUrls,prefix:`${SPM.PLATFORM}_${Date.now()}`});
  _setStatus(res?.ok?`Downloaded ${res.count} file(s) ✓`:'Bulk error', res?.ok?'ok':'err');
}
async function _bulkDownload() {
  _setLoading('btn-bulk-profile',true); _setStatus('Scanning profile grid…','idle',false);
  const wrap=spmElFresh('bulk-wrap'),fill=spmElFresh('bulk-fill'),text=spmElFresh('bulk-text');
  if(wrap) wrap.style.display='block'; if(fill) fill.style.width='20%';
  try {
    const urls=SpmExtractor.profileGridMedia();
    if(!urls.length){_setStatus('No media found on this page','err',false);return;}
    if(text) text.textContent=`Found ${urls.length} files…`; if(fill) fill.style.width='50%';
    const res=await spmSend({type:'BULK_DOWNLOAD',urls,prefix:`${SPM.PLATFORM}_profile_${Date.now()}`});
    if(fill) fill.style.width='100%'; if(text) text.textContent=`✅ ${res?.count||0} files downloaded`;
    _setStatus(`Bulk: ${res?.count||0} files ✓`,'ok');
    setTimeout(()=>{if(wrap)wrap.style.display='none';},4000);
  } catch(e){spmLog.error('_bulkDownload:',e);_setStatus('Bulk failed','err',false);}
  finally{_setLoading('btn-bulk-profile',false);}
}

// ── Export ───────────────────────────────────────────────────────
function _exportCSV() {
  const rows=[['Time','Platform','URL','Likes','Comments','Shares','Reach','Engage%','Source']];
  _ui.history.forEach(h=>rows.push([new Date(h.ts).toLocaleString(),h.platform||SPM.PLATFORM,h.url||location.href,h.likes||'',h.comments||'',h.shares||'',h.reach||'',h.engageRate||'',h.source||'']));
  _blob(rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'), `spm_export_${Date.now()}.csv`, 'text/csv');
  _setStatus('CSV exported ✓','ok');
}
async function _exportJSON() {
  const r=await spmGet(['spm_history']);
  _blob(JSON.stringify({exported:new Date().toISOString(),history:r.spm_history||[]},null,2), `spm_data_${Date.now()}.json`, 'application/json');
  _setStatus('JSON exported ✓','ok');
}
function _blob(content, filename, mime) {
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=filename; a.style.display='none';
  document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);document.body.removeChild(a);},5000);
}
async function _clearAll() {
  if(!confirm('Delete ALL saved data?')) return;
  _ui.history=[]; await spmRemove('spm_history'); _setStatus('All data cleared','ok');
}

// ── Resize handle ─────────────────────────────────────────────────
function _initResize() {
  const h=spmEl('spm-resize-handle'),root=spmEl('spm-root'); if(!h||!root) return;
  let drag=false,sx=0,sw=0;
  h.onmousedown=e=>{drag=true;sx=e.clientX;sw=root.offsetWidth;h.classList.add('dragging');
    const mv=spmThrottle(e2=>{if(!drag) return; root.style.width=Math.min(700,Math.max(280,sw-(e2.clientX-sx)))+'px';},16);
    const up=()=>{drag=false;h.classList.remove('dragging');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
  };
}

// ── Monitor + API events → UI ────────────────────────────────────
function _wireEvents() {
  SpmMonitor.on('tick', ({fresh,alerts,logEntry})=>{ _ui.current=fresh; _updateStatsUI(fresh,_ui.current); _addMonitorLog(logEntry); });
  SpmMonitor.on('navigate', ()=>{ spmClearElCache(); _ui.current={}; _ui.comments=[]; _ui.mediaUrls=[]; setTimeout(()=>_scrape(false),2000); });

  // React to fresh API data from interceptor
  window.addEventListener('spm:apiStats', e=>{ spmLog.info('Reacting to API stats event'); _scrape(false); });
  window.addEventListener('spm:apiProfile', e=>{ _ui.profile=spmNormalise(e.detail); _updateStatsUI(_ui.current,{}); });
  window.addEventListener('spm:apiComments', e=>{ _ui.comments=e.detail; const ct=spmElFresh('comment-count'); if(ct) ct.textContent=`${_ui.comments.length} comments (from API)`; _renderCommentList(_ui.comments); });
}

// ── Boot ─────────────────────────────────────────────────────────
function _init() {
  try {
    _buildSidebar();
    spmClearElCache();
    _wire();
    _wireEvents();
    SpmMonitor.init(() => _scrape(false)); // pass content-change callback
    _loadState().then(() => setTimeout(() => _scrape(false), 1500));
    spmLog.info('SPM Pro v4 ready on', SPM.PLATFORM);
  } catch(e) { spmLog.error('Init failed:', e); }
}

if (document.readyState==='complete') _init();
else window.addEventListener('load', _init, {once:true});

} // end guard
