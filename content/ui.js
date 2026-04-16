/**
 * SPM Pro v8 · content/ui.js
 * ─────────────────────────────────────────────────────────────
 * Sidebar UI — driven by monitor events.
 *
 * BUG FIXES:
 *  #10 Every render function checks for null before touching DOM
 *  #9  try/catch on all event handlers
 *  #6  Falls back to "—" (not crash) for any missing value
 */
'use strict';

if (document.getElementById('spm-root')) {
  spmLog.warn('[UI] Already injected — skipping');
} else {

const _ui = {
  open:       false,
  activeTab:  'stats',
  settings:   { theme:'light', notifications:true, autosave:true },
  current:    null,   // FIX #10: starts null, not {}
  profile:    {},
  comments:   [],
  mediaUrls:  [],
  history:    [],
  report:     null,
};

// ── Load persisted settings ──────────────────────────────────
async function _loadState() {
  try {
    const r = await spmGet(['spm_settings']);
    if (r.spm_settings) Object.assign(_ui.settings, r.spm_settings);
    _ui.history = await SpmMonitor.getHistory();
    _applyTheme();
    const t = spmEl('theme-toggle');    if (t) t.checked = _ui.settings.theme === 'dark';
    const n = spmEl('notif-toggle');    if (n) n.checked = _ui.settings.notifications !== false;
    const a = spmEl('autosave-toggle'); if (a) a.checked = _ui.settings.autosave !== false;
  } catch (e) { spmLog.error('[UI] _loadState:', e.message); }
}

// ── Build sidebar DOM ────────────────────────────────────────
function _build() {
  const root = document.createElement('div');
  root.id    = 'spm-root';
  root.innerHTML = `
    <div id="spm-resize-handle"></div>
    <div id="spm-sidebar">
      <div id="spm-header">
        <span id="spm-logo">📊 SPM Pro</span>
        <span id="spm-platform-badge">${SPM.PLATFORM}</span>
        <span id="spm-source-badge" class="spm-src-dom" title="Data source">DOM</span>
        <span id="spm-monitor-dot" title="Auto-monitor"></span>
        <button id="spm-close-btn" aria-label="Close">✕</button>
      </div>
      <nav id="spm-tabs" role="tablist">
        <button class="spm-tab active" data-tab="stats"    ><span>📊</span>Stats</button>
        <button class="spm-tab"        data-tab="comments" ><span>💬</span>Comments</button>
        <button class="spm-tab"        data-tab="profile"  ><span>👤</span>Profile</button>
        <button class="spm-tab"        data-tab="analytics"><span>📈</span>Analytics</button>
        <button class="spm-tab"        data-tab="downloads"><span>⬇️</span>Downloads</button>
        <button class="spm-tab"        data-tab="settings" ><span>⚙️</span>Settings</button>
      </nav>
      <div id="spm-content">${_tStats()}${_tComments()}${_tProfile()}${_tAnalytics()}${_tDownloads()}${_tSettings()}</div>
      <footer id="spm-statusbar">
        <span class="spm-dot" id="spm-dot"></span>
        <span id="spm-status-text">Ready</span>
        <span id="spm-last-update"></span>
      </footer>
    </div>`;
  document.body.appendChild(root);

  const fab   = document.createElement('button');
  fab.id      = 'spm-fab';
  fab.title   = 'Social Post Monitor Pro';
  fab.innerText = '📊';
  document.body.appendChild(fab);
  return root;
}

// ── Tab HTML templates ───────────────────────────────────────
function _tStats() { return `
<section class="spm-panel active" id="panel-stats" role="tabpanel">
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
  <div class="spm-viral-card" id="spm-viral-card" style="display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span class="spm-label-bold" id="spm-viral-label-text">—</span>
      <div style="position:relative;width:44px;height:44px;flex-shrink:0">
        <svg viewBox="0 0 44 44" style="width:44px;height:44px">
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border)" stroke-width="4"/>
          <circle id="spm-viral-arc" cx="22" cy="22" r="18" fill="none" stroke="var(--accent)" stroke-width="4"
            stroke-dasharray="113" stroke-dashoffset="113" stroke-linecap="round" transform="rotate(-90 22 22)"/>
        </svg>
        <span id="spm-viral-score" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:11px;font-weight:800;color:var(--text)">0</span>
      </div>
    </div>
    <div id="spm-viral-signals" style="margin-top:6px"></div>
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
        <option value="1">1</option><option value="5">5</option><option value="10">10</option><option value="25">25</option><option value="50">50</option>
      </select>
    </div>
    <div id="monitor-log" class="spm-monitor-log"></div>
  </div>
  <div id="s-reach-note" class="spm-note" style="display:none">📷 Photo post — views only shown on Reels &amp; Videos.</div>
</section>`; }

function _tComments() { return `
<section class="spm-panel" id="panel-comments" role="tabpanel">
  <div class="spm-row-gap" style="margin-bottom:8px">
    <input class="spm-input" id="comment-search" placeholder="🔍 Search comments…" aria-label="Search"/>
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
<section class="spm-panel" id="panel-profile" role="tabpanel">
  <div id="profile-content"><div class="spm-empty"><div class="spm-empty-icon">👤</div><p>Click below to load profile</p></div></div>
  <button class="spm-btn spm-btn-primary" id="btn-load-profile">👤 Load Profile Stats</button>
  <div class="spm-note" style="margin-top:8px">💡 Visit the profile page for complete follower data.</div>
</section>`; }

function _tAnalytics() { return `
<section class="spm-panel" id="panel-analytics" role="tabpanel">
  <div id="analytics-summary" style="display:none;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px"></div>
  <div class="spm-section-title">Likes Over Time</div>
  <div class="spm-chart-card"><div id="chart-likes" class="spm-chart-area"></div></div>
  <div class="spm-section-title">Comments Over Time</div>
  <div class="spm-chart-card"><div id="chart-comments" class="spm-chart-area"></div></div>
  <div class="spm-section-title">Engagement Over Time</div>
  <div class="spm-chart-card"><div id="chart-engage" class="spm-chart-area"></div></div>
  <div class="spm-section-title">History Log</div>
  <div class="spm-chart-card" style="padding:0;overflow:auto">
    <table class="spm-table"><thead><tr><th>When</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Engage%</th><th>Viral</th></tr></thead>
    <tbody id="history-tbody"></tbody></table>
  </div>
  <div class="spm-btn-row" style="margin-top:10px">
    <button class="spm-btn spm-btn-secondary" id="btn-clear-history">🗑️ Clear</button>
    <button class="spm-btn spm-btn-secondary" id="btn-export-json">📤 JSON</button>
  </div>
</section>`; }

function _tDownloads() { return `
<section class="spm-panel" id="panel-downloads" role="tabpanel">
  <div class="spm-section-title">Post Media</div>
  <div id="media-grid" class="spm-media-grid">
    <div class="spm-empty" style="grid-column:1/-1"><div class="spm-empty-icon">🖼️</div><p>Refresh to detect media</p></div>
  </div>
  <div class="spm-btn-row">
    <button class="spm-btn spm-btn-success"   id="btn-dl-all">⬇️ Download All</button>
    <button class="spm-btn spm-btn-secondary" id="btn-scan-media">🔍 Re-scan</button>
  </div>
  <div class="spm-section-title" style="margin-top:14px">Bulk Profile Download</div>
  <div class="spm-disclaimer">⚠️ Only download content you own or have rights to use.</div>
  <button class="spm-btn spm-btn-warning" id="btn-bulk-profile">📦 Bulk Download</button>
  <div id="bulk-wrap" style="display:none;margin-top:8px">
    <div class="spm-prog-track"><div class="spm-prog-fill" id="bulk-fill" style="width:0%"></div></div>
    <div class="spm-muted-text" id="bulk-text" style="text-align:center;margin-top:4px">Preparing…</div>
  </div>
</section>`; }

function _tSettings() { return `
<section class="spm-panel" id="panel-settings" role="tabpanel">
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
    <div><div class="spm-label-bold">💾 Auto-save</div><div class="spm-muted-text">Save stats on each refresh</div></div>
    <label class="spm-toggle"><input type="checkbox" id="autosave-toggle" checked><span class="spm-toggle-track"></span></label>
  </div>
  <button class="spm-btn spm-btn-secondary" id="btn-export-settings">📤 Export JSON</button>
  <button class="spm-btn spm-btn-danger"    id="btn-clear-all">🗑️ Clear All Data</button>
  <div class="spm-section-title">Compliance</div>
  <div class="spm-disclaimer">⚠️ For personal use on your own posts only. Scraping may violate platform Terms.</div>
  <div class="spm-section-title">About</div>
  <div class="spm-card" style="font-size:11px;color:var(--muted)">📊 <strong>SPM Pro v${SPM.VERSION}</strong> · Instagram &amp; Facebook<br/>MV3 · Brave / Chrome / Edge</div>
</section>`; }

// ── Wire event handlers ──────────────────────────────────────
function _wire() {
  spmEl('spm-fab').onclick        = _toggle;
  spmEl('spm-close-btn').onclick  = _close;
  spmQA('.spm-tab').forEach(t => t.onclick = () => _switchTab(t.dataset.tab));

  spmEl('btn-refresh').onclick    = () => _scrape(true);
  spmEl('btn-export-csv').onclick = _exportCSV;

  spmEl('monitor-toggle').onchange  = e => _onMonitorToggle(e.target.checked);
  spmEl('mon-interval').onchange    = e => SpmMonitor.setInterval(+e.target.value);
  spmEl('mon-threshold').onchange   = e => SpmMonitor.setThreshold(+e.target.value);

  spmEl('btn-load-comments').onclick  = _loadComments;
  spmEl('btn-copy-comments').onclick  = _copyComments;
  spmEl('btn-load-more').onclick      = _clickLoadMore;
  spmEl('comment-search').oninput     = spmDebounce(e => _filterComments(e.target.value), 250);

  spmEl('btn-load-profile').onclick   = _loadProfile;
  spmEl('btn-clear-history').onclick  = _clearHistory;
  spmEl('btn-export-json').onclick    = _exportJSON;

  spmEl('btn-dl-all').onclick       = _dlAll;
  spmEl('btn-scan-media').onclick   = () => _scrape(true);
  spmEl('btn-bulk-profile').onclick = _bulkDownload;

  spmEl('theme-toggle').onchange     = e => _setTheme(e.target.checked ? 'dark' : 'light');
  spmEl('notif-toggle').onchange     = e => _saveSetting('notifications', e.target.checked);
  spmEl('autosave-toggle').onchange  = e => _saveSetting('autosave', e.target.checked);
  spmEl('btn-export-settings').onclick = _exportJSON;
  spmEl('btn-clear-all').onclick     = _clearAll;

  _initResize();
}

// ── Sidebar visibility ───────────────────────────────────────
function _toggle() { _ui.open ? _close() : _open(); }
function _open()   {
  _ui.open = true;
  spmEl('spm-root')?.classList.add('spm-open');
  spmEl('spm-fab')?.classList.add('spm-fab-open');
  if (spmEl('spm-fab')) spmEl('spm-fab').innerText = '✕';
  if (_ui.activeTab === 'analytics') _renderCharts().catch(()=>{});
  if (_ui.activeTab === 'downloads') _renderMediaGrid();
}
function _close()  {
  _ui.open = false;
  spmEl('spm-root')?.classList.remove('spm-open');
  spmEl('spm-fab')?.classList.remove('spm-fab-open');
  if (spmEl('spm-fab')) spmEl('spm-fab').innerText = '📊';
}
function _switchTab(t) {
  _ui.activeTab = t;
  spmQA('.spm-tab').forEach(el => { el.classList.toggle('active', el.dataset.tab===t); el.setAttribute('aria-selected', String(el.dataset.tab===t)); });
  spmQA('.spm-panel').forEach(p => p.classList.toggle('active', p.id===`panel-${t}`));
  if (t==='analytics') _renderCharts().catch(()=>{});
  if (t==='downloads') _renderMediaGrid();
}
function _applyTheme() { document.getElementById('spm-root')?.classList.toggle('spm-dark', _ui.settings.theme==='dark'); }
function _setTheme(t)  { _ui.settings.theme=t; _applyTheme(); _saveSetting('theme',t); }
async function _saveSetting(k, v) { try { _ui.settings[k]=v; await spmSet({spm_settings:_ui.settings}); } catch(e){spmLog.error('[UI] _saveSetting:',e.message);} }

// ── Status bar ───────────────────────────────────────────────
let _stTimer = null;
function _setStatus(msg, type='idle', autoClear=true) {
  try {
    const dot=spmEl('spm-dot'), txt=spmEl('spm-status-text'), upd=spmEl('spm-last-update');
    if (!txt) return;
    txt.textContent = msg;
    if (dot) { dot.className='spm-dot'; if(type==='ok')dot.classList.add('dot-ok'); if(type==='err')dot.classList.add('dot-err'); }
    if (upd) upd.textContent = spmTs();
    if (_stTimer) clearTimeout(_stTimer);
    if (autoClear && type !== 'err') _stTimer = setTimeout(() => { if (txt) txt.textContent='Ready'; }, 3500);
  } catch(e) {}
}
function _setLoading(id, on) {
  const b = spmElFresh(id); if (!b) return;
  b.disabled = on;
  if (on) { b.dataset.orig=b.innerText; b.innerText='⏳…'; }
  else b.innerText = b.dataset.orig || b.innerText;
}
function _setSourceBadge(src) {
  const el = spmElFresh('spm-source-badge'); if (!el) return;
  el.textContent = src==='api' ? 'API ✓' : 'DOM';
  el.className   = 'spm-src-' + (src==='api' ? 'api' : 'dom');
}

// ── Core scrape — FIX #10: null-safe ────────────────────────
const _scrape = spmDebounce(async function(showLoader=false) {
  if (showLoader) _setLoading('btn-refresh', true);
  _setStatus('Scanning…', 'idle', false);
  try {
    const fresh = SpmExtractor.stats();
    // FIX #10: check for valid data before updating UI
    if (!fresh) { _setStatus('No data yet', 'idle'); return; }

    const prev   = _ui.current ?? {};
    _ui.current  = fresh;
    _ui.mediaUrls= fresh.mediaUrls ?? [];

    _updateStatsUI(fresh, prev);
    _setSourceBadge(fresh.source ?? 'dom');
    if (_ui.activeTab === 'downloads') _renderMediaGrid();

    // Analytics (null-safe)
    let report = null;
    try {
      const prof = SpmExtractor.getLatestProfile() ?? {};
      report = SpmAnalytics.buildReport(fresh, _ui.history, prof, SpmExtractor.comments(fresh.postId) ?? []);
    } catch (e) { spmLog.warn('[UI] analytics in scrape:', e.message); }

    _ui.report = report;
    if (report?.viral)      _updateViralCard(report.viral);
    if (report?.engagement) _updateEngageBar(report.engagement);
    if (_ui.activeTab === 'analytics') _renderCharts().catch(()=>{});

    // Save snapshot
    if (_ui.settings.autosave !== false && fresh.postId) {
      try {
        const snap = { ...fresh, ts:Date.now(), engageRate:report?.engagement?.ratePercent, viralScore:report?.viral?.score };
        spmBoundedPush(_ui.history, snap, SPM.MAX_HISTORY);
        await SpmStorage.saveSnapshot(snap);
      } catch (e) { spmLog.warn('[UI] snapshot save:', e.message); }
    }

    SpmMonitor.setLastStats(fresh);
    _setStatus('Updated ' + spmTs(), 'ok');
  } catch (e) {
    spmLog.error('[UI] _scrape:', e.message);
    _setStatus('Error — see console', 'err', false);
  } finally {
    if (showLoader) _setLoading('btn-refresh', false);
  }
}, 300);

// ── Stat cards — FIX #10: null guards ───────────────────────
function _updateStatsUI(fresh, prev) {
  if (!fresh) return;
  try {
    const set = (id, val, muted) => {
      const el = spmElFresh(id); if (!el) return;
      el.textContent = spmFmt(val);
      el.style.color = muted ? 'var(--muted)' : '';
      el.style.fontSize = String(val ?? '').length > 7 ? '13px' : '';
    };
    set('s-likes',    fresh.likes);
    set('s-comments', fresh.comments);
    set('s-shares',   fresh.shares);
    set('s-reach',    fresh.reach, fresh.reachIsNA);

    const chg = (id, nv, ov) => {
      const el = spmElFresh(id); if (!el) return;
      if (nv==null || ov==null || typeof nv!=='number' || typeof ov!=='number' || nv===ov) { el.textContent=''; return; }
      const d = nv-ov; el.textContent=(d>0?'▲ +':'▼ ')+Math.abs(d).toLocaleString();
      el.className = 'spm-stat-change '+(d>0?'chg-up':'chg-down');
    };
    chg('s-likes-chg',    fresh.likes,    prev.likes);
    chg('s-comments-chg', fresh.comments, prev.comments);
    chg('s-shares-chg',   fresh.shares,   prev.shares);

    const note = spmElFresh('s-reach-note');
    if (note) note.style.display = fresh.reachIsNA ? 'block' : 'none';
  } catch (e) { spmLog.error('[UI] _updateStatsUI:', e.message); }
}

function _updateEngageBar(engage) {
  try {
    const rEl = spmElFresh('s-engage-val'), fEl = spmElFresh('s-engage-fill');
    if (rEl) rEl.textContent = engage?.rate != null ? engage.ratePercent : '— (load profile for followers)';
    if (fEl && engage?.rate != null) fEl.style.width = Math.min(100, engage.rate * 5) + '%';
  } catch (e) { spmLog.error('[UI] _updateEngageBar:', e.message); }
}

function _updateViralCard(viral) {
  try {
    const card = spmElFresh('spm-viral-card'); if (!card || !viral) return;
    card.style.display = 'block';
    const sc  = spmElFresh('spm-viral-score');
    const lbl = spmElFresh('spm-viral-label-text');
    const arc = document.getElementById('spm-viral-arc');
    const sig = spmElFresh('spm-viral-signals');
    if (sc)  sc.textContent  = viral.score ?? 0;
    if (lbl) { lbl.textContent=viral.label??'—'; lbl.style.color=viral.score>=60?'var(--red)':viral.score>=40?'var(--orange)':'var(--muted)'; }
    if (arc) { const c=113; arc.style.strokeDashoffset=String(c-((viral.score??0)/100)*c); arc.style.stroke=viral.score>=80?'#e74c3c':viral.score>=60?'#f39c12':viral.score>=40?'#27ae60':'var(--accent)'; }
    if (sig && viral.signals?.length) sig.innerHTML=viral.signals.map(s=>`<div class="spm-signal-item">${spmEsc(s.label)}<span class="spm-signal-weight">+${s.weight}</span></div>`).join('');
  } catch (e) { spmLog.error('[UI] _updateViralCard:', e.message); }
}

// ── Monitor event handlers ───────────────────────────────────
function _wireMonitorEvents() {
  // Live API data from pipeline
  SpmMonitor.on('apiData', ({ postData, report }) => {
    try {
      if (!postData) return; // FIX #10: null guard
      _ui.current  = postData;
      _ui.mediaUrls= postData.mediaUrls ?? [];
      _ui.report   = report ?? null;
      _updateStatsUI(postData, _ui.current ?? {});
      _setSourceBadge('api');
      if (report?.viral)      _updateViralCard(report.viral);
      if (report?.engagement) _updateEngageBar(report.engagement);
      if (_ui.activeTab === 'downloads') _renderMediaGrid();
      if (_ui.activeTab === 'analytics') _renderCharts().catch(()=>{});
      _setStatus('Live API data ✓', 'ok');
      spmLog.pipe('[UI] API data displayed:', 'likes', postData.likes, 'comments', postData.comments);
    } catch (e) { spmLog.error('[UI] apiData handler:', e.message); }
  });

  SpmMonitor.on('alert',       entry => { try { _addMonitorLog(entry); } catch(e){} });
  SpmMonitor.on('stateChange', ({active}) => {
    try { spmElFresh('spm-monitor-dot')?.classList.toggle('dot-active', active); } catch(e){}
  });
  SpmMonitor.on('tick', ({ fresh }) => {
    try {
      if (!fresh) return; // FIX #10
      _updateStatsUI(fresh, _ui.current ?? {});
    } catch (e) { spmLog.error('[UI] tick handler:', e.message); }
  });
  SpmMonitor.on('navigate', () => {
    try {
      spmClearElCache();
      _ui.current = null; _ui.comments=[]; _ui.mediaUrls=[]; _ui.report=null;
      setTimeout(() => _scrape(false), 2000);
    } catch(e) {}
  });
}

// ── Monitor toggle ───────────────────────────────────────────
function _onMonitorToggle(on) {
  try {
    if (on) {
      SpmMonitor.startAutoMonitor({ interval:+spmEl('mon-interval').value, threshold:+spmEl('mon-threshold').value });
      _addMonitorLog({ isAlert:false, ts:Date.now(), msg:'▶ Monitoring started' });
    } else {
      SpmMonitor.stopAutoMonitor();
      _addMonitorLog({ isAlert:false, ts:Date.now(), msg:'⏹ Stopped' });
    }
  } catch(e) { spmLog.error('[UI] _onMonitorToggle:', e.message); }
}
function _addMonitorLog(entry) {
  try {
    const log = spmElFresh('monitor-log'); if (!log) return;
    const div = document.createElement('div');
    div.className = 'spm-log-item' + (entry.isAlert ? ' spm-log-alert' : '');
    const t = new Date(entry.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    div.textContent = `[${t}] ${entry.msg ?? (entry.alerts ?? []).map(a=>`${a.label} ${a.diff>0?'+':''}${a.diff}`).join(' · ')}`;
    log.prepend(div);
    while (log.children.length > SPM.MAX_LOG) log.removeChild(log.lastChild);
  } catch(e) {}
}

// ── Comments tab ─────────────────────────────────────────────
async function _loadComments() {
  _setLoading('btn-load-comments', true);
  _setStatus('Loading comments…', 'idle', false);
  try {
    await new Promise(r => setTimeout(r, 80));
    _ui.comments = SpmExtractor.comments(_ui.current?.postId);
    _renderCommentList(_ui.comments);
    const ct = spmElFresh('comment-count');
    if (ct) ct.textContent = `${_ui.comments.length} comment${_ui.comments.length!==1?'s':''} found`;
    _setStatus(`Loaded ${_ui.comments.length} comments`, 'ok');
  } catch (e) {
    spmLog.error('[UI] _loadComments:', e.message);
    _setStatus('Failed to load', 'err', false);
  } finally { _setLoading('btn-load-comments', false); }
}
function _renderCommentList(items) {
  const list = spmElFresh('comment-list'); if (!list) return;
  if (!items?.length) { list.innerHTML=`<div class="spm-empty"><div class="spm-empty-icon">💬</div><p>No comments detected</p></div>`; return; }
  const frag = document.createDocumentFragment();
  items.forEach(c => {
    const div = document.createElement('div'); div.className='spm-comment-item';
    div.innerHTML=`<div class="spm-comment-header"><div class="spm-avatar">${spmEsc((c.username??'?').charAt(0).toUpperCase())}</div><span class="spm-comment-user">@${spmEsc(c.username??'?')}</span>${c.time?`<span class="spm-comment-time">${spmEsc(c.time)}</span>`:''}</div><div class="spm-comment-text">${spmEsc(c.text??'')}</div>${c.likes!=null?`<div class="spm-comment-meta">❤️ ${spmFmt(c.likes)}</div>`:''}`;
    frag.appendChild(div);
  });
  list.innerHTML=''; list.appendChild(frag);
}
const _filterComments = spmDebounce(q => {
  const lo=q.toLowerCase(), f=lo?_ui.comments.filter(c=>(c.username??'').toLowerCase().includes(lo)||(c.text??'').toLowerCase().includes(lo)):_ui.comments;
  _renderCommentList(f);
  const ct=spmElFresh('comment-count'); if(ct) ct.textContent=`${f.length} of ${_ui.comments.length} shown`;
}, 200);
function _copyComments() {
  if (!_ui.comments.length) { _setStatus('No comments', 'err'); return; }
  navigator.clipboard.writeText(_ui.comments.map(c=>`@${c.username}: ${c.text}`).join('\n'))
    .then(() => _setStatus(`Copied ${_ui.comments.length} ✓`,'ok'))
    .catch(() => _setStatus('Copy failed','err'));
}
function _clickLoadMore() {
  const btn=spmQA('button,span').find(el=>/load more|view more|view all/i.test((el.innerText||'').trim()));
  if (btn) { btn.click(); setTimeout(_loadComments, 1400); _setStatus('Loading more…','idle',false); }
  else _setStatus('No "Load more" button found','err');
}

// ── Profile tab ──────────────────────────────────────────────
async function _loadProfile() {
  _setLoading('btn-load-profile', true);
  _setStatus('Loading profile…', 'idle', false);
  try {
    _ui.profile = SpmExtractor.profile() ?? {};
    const p   = _ui.profile;
    const c   = spmElFresh('profile-content'); if (!c) return;
    const has = p.followers || p.following || p.posts;
    c.innerHTML=`<div class="spm-profile-card">${p.avatarSrc?`<img class="spm-profile-img" src="${spmEsc(p.avatarSrc)}" alt="avatar" onerror="this.style.display='none'"/>`:`<div class="spm-profile-placeholder">👤</div>`}<div><div class="spm-profile-name">${spmEsc(p.name||p.username||'Unknown')}</div>${p.username?`<div class="spm-muted-text">@${spmEsc(p.username)}</div>`:''} ${p.bio?`<div class="spm-profile-bio">${spmEsc(p.bio)}</div>`:''}</div></div>${has?`<div class="spm-profile-stats"><div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(p.followers)}</div><div class="spm-muted-text">Followers</div></div><div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(p.following)}</div><div class="spm-muted-text">Following</div></div><div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(p.posts)}</div><div class="spm-muted-text">Posts</div></div></div>`:`<div class="spm-note">Visit the profile page for follower data.</div>`}`;
    _setStatus('Profile loaded ✓','ok');
  } catch (e) { spmLog.error('[UI] _loadProfile:',e.message); _setStatus('Failed','err',false); }
  finally { _setLoading('btn-load-profile', false); }
}

// ── Analytics tab ────────────────────────────────────────────
async function _renderCharts() {
  try {
    const allHist  = await SpmMonitor.getHistory();
    const url0     = location.href.split('?')[0];
    const hist     = (allHist ?? []).filter(h => h?.url && (h.url===location.href || h.url.split('?')[0]===url0));

    // Summary tiles
    const sumEl = spmElFresh('analytics-summary');
    if (sumEl && _ui.report) {
      const r = _ui.report;
      sumEl.style.display='grid';
      sumEl.innerHTML=`
        <div class="spm-analytics-tile ${r.viral?.score>=60?'viral':''}"><div class="spm-analytics-tile-val">${r.engagement?.ratePercent||'—'}</div><div class="spm-analytics-tile-label">Engage</div></div>
        <div class="spm-analytics-tile"><div class="spm-analytics-tile-val">${r.growth?.trend||'—'}</div><div class="spm-analytics-tile-label">Growth</div></div>
        <div class="spm-analytics-tile ${r.viral?.score>=60?'viral':''}"><div class="spm-analytics-tile-val">${r.viral?.score??'—'}/100</div><div class="spm-analytics-tile-label">Viral</div></div>
        <div class="spm-analytics-tile"><div class="spm-analytics-tile-val">${r.hashtags?.unique||0}</div><div class="spm-analytics-tile-label">Tags</div></div>`;
    }

    _drawChart('chart-likes',    hist, 'likes',    'var(--accent)');
    _drawChart('chart-comments', hist, 'comments', 'var(--green)');
    _drawChart('chart-engage',   hist.map(h=>({...h,_er:h.engageRate?parseFloat(h.engageRate):null})), '_er', 'var(--orange)');
    _renderHistoryTable(hist);
  } catch (e) { spmLog.error('[UI] _renderCharts:', e.message); }
}

function _drawChart(id, data, field, color) {
  const c = spmElFresh(id); if (!c) return;
  try {
    const pts = (data ?? []).map(h => ({ x:h.ts, y:h[field] })).filter(p => p.y != null && !isNaN(p.y));
    if (pts.length < 2) { c.innerHTML=`<div class="spm-chart-empty">Not enough data — refresh a few times.</div>`; return; }
    const W=340,H=130,P={t:14,r:10,b:26,l:42},cW=W-P.l-P.r,cH=H-P.t-P.b;
    const ys=pts.map(p=>p.y),mn=Math.min(...ys),mx=Math.max(...ys),rng=mx-mn||1;
    const xS=i=>P.l+(i/(pts.length-1||1))*cW, yS=v=>P.t+cH-((v-mn)/rng)*cH;
    const line=pts.map((p,i)=>`${xS(i)},${yS(p.y)}`).join(' ');
    const area=`${line} ${xS(pts.length-1)},${P.t+cH} ${xS(0)},${P.t+cH}`;
    const ticks=[0,.5,1].map(t=>{const y=P.t+t*cH,v=mx-t*rng;const lbl=v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':Math.round(v).toString();return`<line x1="${P.l}" y1="${y}" x2="${W-P.r}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,2" stroke-width="1"/><text x="${P.l-4}" y="${y+4}" text-anchor="end" font-size="9" fill="var(--muted)">${lbl}</text>`;}).join('');
    const xlbls=[0,Math.floor((pts.length-1)/2),pts.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text x="${xS(i)}" y="${H-4}" text-anchor="middle" font-size="9" fill="var(--muted)">${new Date(pts[i].x).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text>`).join('');
    const dots=pts.map((p,i)=>`<circle cx="${xS(i)}" cy="${yS(p.y)}" r="3" fill="${color}" stroke="var(--bg)" stroke-width="1.5"><title>${Math.round(p.y).toLocaleString()}</title></circle>`).join('');
    const uid=id.replace(/[^a-z]/gi,'');
    c.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".2"/><stop offset="100%" stop-color="${color}" stop-opacity=".01"/></linearGradient></defs>${ticks}<polygon points="${area}" fill="url(#g${uid})"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}${xlbls}</svg>`;
  } catch (e) { spmLog.error('[UI] _drawChart:', id, e.message); c.innerHTML=`<div class="spm-chart-empty">Chart error</div>`; }
}

function _renderHistoryTable(hist) {
  const tb = spmElFresh('history-tbody'); if (!tb) return;
  try {
    if (!hist?.length) { tb.innerHTML=`<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px">No history for this post yet</td></tr>`; return; }
    const frag = document.createDocumentFragment();
    [...hist].reverse().slice(0,40).forEach(h => {
      const tr = document.createElement('tr');
      const vs = h.viralScore;
      const vc = vs>=60?'background:rgba(231,76,60,.12);color:#c0392b':vs>=40?'background:rgba(243,156,18,.12);color:#d35400':'';
      tr.innerHTML=`<td>${spmAgo(h.ts)}</td><td>${spmFmt(h.likes)}</td><td>${spmFmt(h.comments)}</td><td>${spmFmt(h.shares)}</td><td>${h.engageRate??'—'}</td><td style="${vc}">${vs!=null?vs+'/100':'—'}</td>`;
      frag.appendChild(tr);
    });
    tb.innerHTML=''; tb.appendChild(frag);
  } catch (e) { spmLog.error('[UI] _renderHistoryTable:', e.message); }
}
async function _clearHistory() {
  if (!confirm('Clear all history?')) return;
  _ui.history = [];
  try { await SpmStorage.clearAll(); } catch(e) {}
  _renderCharts().catch(()=>{});
  _setStatus('History cleared', 'ok');
}

// ── Downloads ────────────────────────────────────────────────
function _renderMediaGrid() {
  const grid = spmElFresh('media-grid'); if (!grid) return;
  try {
    const urls = _ui.mediaUrls ?? [];
    if (!urls.length) { grid.innerHTML=`<div class="spm-empty" style="grid-column:1/-1"><div class="spm-empty-icon">🖼️</div><p>No media found</p></div>`; return; }
    const frag = document.createDocumentFragment();
    urls.forEach((url, i) => {
      const isVid = /\.mp4|video/i.test(url);
      const w = document.createElement('div'); w.className='spm-thumb'; w.dataset.url=url; w.dataset.i=i;
      w.innerHTML=isVid?`<div class="spm-thumb-inner spm-thumb-video">🎬<div class="spm-thumb-badge">MP4</div></div><div class="spm-thumb-overlay">⬇️</div>`:`<img src="${spmEsc(url)}" alt="media ${i+1}" loading="lazy" onerror="this.closest('.spm-thumb').style.display='none'"/><div class="spm-thumb-overlay">⬇️</div>`;
      w.onclick = () => _dlOne(url, i);
      frag.appendChild(w);
    });
    grid.innerHTML=''; grid.appendChild(frag);
  } catch (e) { spmLog.error('[UI] _renderMediaGrid:', e.message); }
}
async function _dlOne(url, idx) {
  if (!spmValidateUrl(url)) { _setStatus('Invalid URL','err'); return; }
  const ext=/\.mp4|video/i.test(url)?'mp4':'jpg';
  try {
    const res = await spmSend({ type:'DOWNLOAD_MEDIA', url, filename:`${SPM.PLATFORM}_${Date.now()}_${idx}.${ext}` });
    _setStatus(res?.ok?'Downloading…':'Download failed', res?.ok?'ok':'err');
  } catch(e) { _setStatus('Download error','err'); }
}
async function _dlAll() {
  if (!_ui.mediaUrls?.length) { _setStatus('No media','err'); return; }
  try {
    const res = await spmSend({ type:'BULK_DOWNLOAD', urls:_ui.mediaUrls, prefix:`${SPM.PLATFORM}_${Date.now()}` });
    _setStatus(res?.ok?`Downloaded ${res.count} ✓`:'Error', res?.ok?'ok':'err');
  } catch(e) { _setStatus('Bulk error','err'); }
}
async function _bulkDownload() {
  _setLoading('btn-bulk-profile', true);
  const wrap=spmElFresh('bulk-wrap'),fill=spmElFresh('bulk-fill'),text=spmElFresh('bulk-text');
  if (wrap) wrap.style.display='block'; if (fill) fill.style.width='20%';
  try {
    const urls = SpmExtractor.profileGridMedia();
    if (!urls.length) { _setStatus('No media on page','err',false); return; }
    if (text) text.textContent=`Found ${urls.length}…`; if(fill) fill.style.width='50%';
    const res = await spmSend({ type:'BULK_DOWNLOAD', urls, prefix:`${SPM.PLATFORM}_profile_${Date.now()}` });
    if(fill) fill.style.width='100%'; if(text) text.textContent=`✅ ${res?.count||0} files`;
    _setStatus(`Bulk: ${res?.count||0} ✓`, 'ok');
    setTimeout(() => { if(wrap) wrap.style.display='none'; }, 4000);
  } catch(e) { spmLog.error('[UI] _bulkDownload:',e.message); _setStatus('Failed','err',false); }
  finally { _setLoading('btn-bulk-profile', false); }
}

// ── Export ───────────────────────────────────────────────────
async function _exportCSV() {
  try {
    const hist = await SpmMonitor.getHistory();
    _blob(SpmAnalytics.historyToCsv(hist), `spm_export_${Date.now()}.csv`, 'text/csv');
    _setStatus('CSV exported ✓','ok');
  } catch(e) { _setStatus('Export error','err'); }
}
async function _exportJSON() {
  try {
    const hist = await SpmMonitor.getHistory();
    _blob(JSON.stringify({exported:new Date().toISOString(),history:hist},null,2), `spm_data_${Date.now()}.json`, 'application/json');
    _setStatus('JSON exported ✓','ok');
  } catch(e) { _setStatus('Export error','err'); }
}
function _blob(content, filename, mime) {
  try {
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=filename; a.style.display='none';
    document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);document.body.removeChild(a);},5000);
  } catch(e) {}
}
async function _clearAll() {
  if (!confirm('Delete ALL saved data?')) return;
  _ui.history=[]; try { await SpmStorage.clearAll(); } catch(e) {}
  _setStatus('All data cleared','ok');
}

// ── Resize handle ────────────────────────────────────────────
function _initResize() {
  const h=spmEl('spm-resize-handle'), root=spmEl('spm-root'); if(!h||!root) return;
  let drag=false,sx=0,sw=0;
  h.onmousedown=e=>{
    drag=true;sx=e.clientX;sw=root.offsetWidth; h.classList.add('dragging');
    const mv=spmThrottle(e2=>{if(!drag)return;root.style.width=Math.min(700,Math.max(280,sw-(e2.clientX-sx)))+'px';},16);
    const up=()=>{drag=false;h.classList.remove('dragging');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
  };
}

// ── Boot ─────────────────────────────────────────────────────
function _init() {
  try {
    _build();
    spmClearElCache();
    _wire();
    _wireMonitorEvents();
    // FIX #13: init monitor AFTER wiring UI events (no race)
    SpmMonitor.init(() => _scrape(false));
    _loadState().then(() => setTimeout(() => _scrape(false), 1500));
    spmLog.pipe('[UI] SPM Pro v8 ready on', SPM.PLATFORM);
  } catch (e) { spmLog.error('[UI] Boot failed:', e.message); }
}

if (document.readyState === 'complete') _init();
else window.addEventListener('load', _init, { once:true });

} // end guard
