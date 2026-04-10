// ═══════════════════════════════════════════════════════════════
//  SPM Pro v3  ·  content/ui.js
//  Sidebar UI — consumes SpmExtractor + SpmMonitor.
//  Single responsibility: render and handle user interactions.
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Guard against double-injection ──────────────────────────────
if (document.getElementById('spm-root')) {
  spmLog.warn('SPM already injected — skipping');
} else {

// ── App state (UI layer only) ───────────────────────────────────
const _ui = {
  open:         false,
  activeTab:    'stats',
  settings:     { theme: 'light', notifications: true, autosave: true },
  currentStats: {},
  profile:      {},
  comments:     [],
  mediaUrls:    [],
  history:      [],
};

// ── Load persisted state ────────────────────────────────────────
async function _loadPersistedState() {
  const r = await spmGet(['spm_settings', 'spm_history']);
  if (r.spm_settings) Object.assign(_ui.settings, r.spm_settings);
  if (r.spm_history)  _ui.history = r.spm_history;
  _applyTheme();
  const toggle = spmEl('theme-toggle');
  if (toggle) toggle.checked = _ui.settings.theme === 'dark';
}

// ── Build sidebar HTML ──────────────────────────────────────────
function _buildSidebar() {
  const root = document.createElement('div');
  root.id = 'spm-root';
  root.innerHTML = /* html */`
    <div id="spm-resize-handle" title="Drag to resize"></div>
    <div id="spm-sidebar">

      <!-- Header -->
      <div id="spm-header">
        <span id="spm-logo">📊 SPM Pro</span>
        <span id="spm-platform-badge">${SPM.PLATFORM}</span>
        <span id="spm-monitor-dot" title="Auto-monitor status"></span>
        <button id="spm-close-btn" aria-label="Close sidebar">✕</button>
      </div>

      <!-- Tab bar -->
      <nav id="spm-tabs" role="tablist">
        <button class="spm-tab active" data-tab="stats"     role="tab" aria-selected="true"><span>📊</span>Stats</button>
        <button class="spm-tab"        data-tab="comments"  role="tab"><span>💬</span>Comments</button>
        <button class="spm-tab"        data-tab="profile"   role="tab"><span>👤</span>Profile</button>
        <button class="spm-tab"        data-tab="analytics" role="tab"><span>📈</span>Analytics</button>
        <button class="spm-tab"        data-tab="downloads" role="tab"><span>⬇️</span>Downloads</button>
        <button class="spm-tab"        data-tab="settings"  role="tab"><span>⚙️</span>Settings</button>
      </nav>

      <!-- Tab panels -->
      <div id="spm-content" role="main">
        ${_tplStats()}
        ${_tplComments()}
        ${_tplProfile()}
        ${_tplAnalytics()}
        ${_tplDownloads()}
        ${_tplSettings()}
      </div>

      <!-- Status bar -->
      <footer id="spm-statusbar">
        <span class="spm-dot" id="spm-dot"></span>
        <span id="spm-status-text">Ready</span>
        <span id="spm-last-update"></span>
      </footer>
    </div>
  `;
  document.body.appendChild(root);

  // FAB button
  const fab = document.createElement('button');
  fab.id        = 'spm-fab';
  fab.title     = 'Social Post Monitor Pro';
  fab.innerText = '📊';
  fab.setAttribute('aria-label', 'Toggle Social Post Monitor');
  document.body.appendChild(fab);

  return root;
}

// ─────────────────────────────────────────────────────────────
//  TAB TEMPLATES
// ─────────────────────────────────────────────────────────────

function _tplStats() { return /* html */`
<section class="spm-panel active" id="panel-stats" role="tabpanel">

  <div class="spm-stats-grid">
    <div class="spm-stat-card" id="card-likes">
      <div class="spm-stat-icon">❤️</div>
      <div class="spm-stat-value" id="s-likes">—</div>
      <div class="spm-stat-label">Likes</div>
      <div class="spm-stat-change" id="s-likes-chg"></div>
    </div>
    <div class="spm-stat-card" id="card-comments">
      <div class="spm-stat-icon">💬</div>
      <div class="spm-stat-value" id="s-comments">—</div>
      <div class="spm-stat-label">Comments</div>
      <div class="spm-stat-change" id="s-comments-chg"></div>
    </div>
    <div class="spm-stat-card" id="card-shares">
      <div class="spm-stat-icon">🔁</div>
      <div class="spm-stat-value" id="s-shares">—</div>
      <div class="spm-stat-label">Shares</div>
      <div class="spm-stat-change" id="s-shares-chg"></div>
    </div>
    <div class="spm-stat-card" id="card-reach">
      <div class="spm-stat-icon">👁️</div>
      <div class="spm-stat-value" id="s-reach">—</div>
      <div class="spm-stat-label">Reach / Views</div>
    </div>
  </div>

  <!-- Engagement bar -->
  <div class="spm-engage-bar">
    <div class="spm-engage-label">
      <span>Engagement Rate</span>
      <strong id="s-engage-val">— (load profile for followers)</strong>
    </div>
    <div class="spm-engage-track"><div class="spm-engage-fill" id="s-engage-fill" style="width:0%"></div></div>
  </div>

  <div class="spm-btn-row">
    <button class="spm-btn spm-btn-primary"   id="btn-refresh">🔄 Refresh</button>
    <button class="spm-btn spm-btn-secondary" id="btn-export-csv">📥 Export CSV</button>
  </div>

  <!-- Auto-monitor -->
  <div class="spm-section-title">🔔 Auto Monitor</div>
  <div class="spm-card">
    <div class="spm-row-between">
      <span class="spm-label-bold">Watch for changes</span>
      <label class="spm-toggle"><input type="checkbox" id="monitor-toggle"><span class="spm-toggle-track"></span></label>
    </div>
    <div class="spm-row-gap" style="margin-top:8px;font-size:11px;color:var(--muted)">
      Interval:
      <select class="spm-select" id="mon-interval">
        <option value="15">15 sec</option>
        <option value="30">30 sec</option>
        <option value="60" selected>1 min</option>
        <option value="300">5 min</option>
        <option value="600">10 min</option>
      </select>
      Alert if ≥
      <select class="spm-select" id="mon-threshold">
        <option value="1">1</option>
        <option value="5">5</option>
        <option value="10">10</option>
        <option value="25">25</option>
        <option value="50">50</option>
      </select>
    </div>
    <div id="monitor-log" class="spm-monitor-log"></div>
  </div>

  <div id="s-reach-note" class="spm-note" style="display:none">
    📷 Photo post — Instagram doesn't show view counts for photos. Views only show on Reels &amp; Videos.
  </div>
</section>`;
}

function _tplComments() { return /* html */`
<section class="spm-panel" id="panel-comments" role="tabpanel">
  <div class="spm-row-gap" style="margin-bottom:8px">
    <input  class="spm-input" id="comment-search" placeholder="🔍 Search comments…" aria-label="Search comments"/>
    <button class="spm-btn spm-btn-primary" style="width:auto;white-space:nowrap" id="btn-load-comments">Load</button>
  </div>
  <div class="spm-row-gap" style="margin-bottom:10px">
    <button class="spm-btn spm-btn-secondary" id="btn-copy-comments">📋 Copy All</button>
    <button class="spm-btn spm-btn-secondary" id="btn-load-more">Load More</button>
  </div>
  <div id="comment-count" class="spm-muted-text">No comments loaded yet</div>
  <div id="comment-list" class="spm-comment-list">
    <div class="spm-empty"><div class="spm-empty-icon">💬</div><p>Click "Load" to scrape comments</p></div>
  </div>
</section>`;
}

function _tplProfile() { return /* html */`
<section class="spm-panel" id="panel-profile" role="tabpanel">
  <div id="profile-content">
    <div class="spm-empty"><div class="spm-empty-icon">👤</div><p>Click below to load profile</p></div>
  </div>
  <button class="spm-btn spm-btn-primary" id="btn-load-profile">👤 Load Profile Stats</button>
  <div class="spm-note" style="margin-top:8px">
    💡 Visit the profile page (e.g. instagram.com/username) for complete follower counts.
  </div>
</section>`;
}

function _tplAnalytics() { return /* html */`
<section class="spm-panel" id="panel-analytics" role="tabpanel">
  <div class="spm-section-title">Likes Over Time</div>
  <div class="spm-chart-card"><div id="chart-likes" class="spm-chart-area"></div></div>
  <div class="spm-section-title">Comments Over Time</div>
  <div class="spm-chart-card"><div id="chart-comments" class="spm-chart-area"></div></div>
  <div class="spm-section-title">Engagement Rate Over Time</div>
  <div class="spm-chart-card"><div id="chart-engage" class="spm-chart-area"></div></div>
  <div class="spm-section-title">History Log</div>
  <div class="spm-chart-card" style="padding:0;overflow:auto">
    <table class="spm-table" id="history-table">
      <thead><tr><th>When</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Engage%</th></tr></thead>
      <tbody id="history-tbody"></tbody>
    </table>
  </div>
  <div class="spm-btn-row" style="margin-top:10px">
    <button class="spm-btn spm-btn-secondary" id="btn-clear-history">🗑️ Clear History</button>
    <button class="spm-btn spm-btn-secondary" id="btn-export-json">📤 Export JSON</button>
  </div>
</section>`;
}

function _tplDownloads() { return /* html */`
<section class="spm-panel" id="panel-downloads" role="tabpanel">
  <div class="spm-section-title">Post Media</div>
  <div id="media-grid" class="spm-media-grid">
    <div class="spm-empty" style="grid-column:1/-1"><div class="spm-empty-icon">🖼️</div><p>Refresh stats to detect media</p></div>
  </div>
  <div class="spm-btn-row">
    <button class="spm-btn spm-btn-success"   id="btn-dl-all">⬇️ Download All</button>
    <button class="spm-btn spm-btn-secondary" id="btn-scan-media">🔍 Re-scan</button>
  </div>

  <div class="spm-section-title" style="margin-top:14px">Bulk Profile Download</div>
  <div class="spm-note">Navigate to a profile page then click below to download all visible media thumbnails.</div>
  <div class="spm-disclaimer">⚠️ Only download media you have rights to use. Downloading others' content may violate platform terms of service.</div>
  <button class="spm-btn spm-btn-warning" id="btn-bulk-profile">📦 Bulk Download Profile</button>

  <div id="bulk-wrap" style="display:none;margin-top:8px">
    <div class="spm-prog-track"><div class="spm-prog-fill" id="bulk-fill" style="width:0%"></div></div>
    <div class="spm-muted-text" id="bulk-text" style="text-align:center;margin-top:4px">Preparing…</div>
  </div>
</section>`;
}

function _tplSettings() { return /* html */`
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
    <div><div class="spm-label-bold">💾 Auto-save Snapshots</div><div class="spm-muted-text">Save stats to history on refresh</div></div>
    <label class="spm-toggle"><input type="checkbox" id="autosave-toggle" checked><span class="spm-toggle-track"></span></label>
  </div>
  <button class="spm-btn spm-btn-secondary" id="btn-export-settings">📤 Export All Data (JSON)</button>
  <button class="spm-btn spm-btn-danger"    id="btn-clear-all">🗑️ Clear All Saved Data</button>

  <div class="spm-section-title">Compliance</div>
  <div class="spm-disclaimer">
    ⚠️ <strong>Terms of Service Notice:</strong> Scraping data from Facebook and Instagram may violate their Terms of Service. This extension is intended for personal use on your own posts only. The developer is not responsible for any account actions resulting from its use.
  </div>

  <div class="spm-section-title">About</div>
  <div class="spm-card" style="font-size:11px;color:var(--muted)">
    <strong>📊 Social Post Monitor Pro</strong> v${SPM.VERSION}<br/>
    Facebook &amp; Instagram · Manifest V3 · Brave / Chrome / Edge
  </div>
</section>`;
}

// ─────────────────────────────────────────────────────────────
//  WIRING — event listeners
// ─────────────────────────────────────────────────────────────
function _wire() {
  // FAB + close
  spmEl('spm-fab').addEventListener('click', _toggleSidebar);
  spmEl('spm-close-btn').addEventListener('click', _closeSidebar);

  // Tabs
  spmQA('.spm-tab').forEach(t => t.addEventListener('click', () => _switchTab(t.dataset.tab)));

  // Stats tab
  spmEl('btn-refresh').addEventListener('click',    () => _runScrape(true));
  spmEl('btn-export-csv').addEventListener('click', _exportCSV);
  spmEl('monitor-toggle').addEventListener('change', e => _onMonitorToggle(e.target.checked));
  spmEl('mon-interval').addEventListener('change',  e => SpmMonitor.setInterval(+e.target.value));
  spmEl('mon-threshold').addEventListener('change', e => SpmMonitor.setThreshold(+e.target.value));

  // Comments tab
  spmEl('btn-load-comments').addEventListener('click',    _loadComments);
  spmEl('btn-copy-comments').addEventListener('click',    _copyComments);
  spmEl('btn-load-more').addEventListener('click',        _clickLoadMore);
  spmEl('comment-search').addEventListener('input', spmDebounce(e => _filterComments(e.target.value), 250));

  // Profile tab
  spmEl('btn-load-profile').addEventListener('click', _loadProfile);

  // Analytics tab
  spmEl('btn-clear-history').addEventListener('click',  _clearHistory);
  spmEl('btn-export-json').addEventListener('click',    _exportJSON);

  // Downloads tab
  spmEl('btn-dl-all').addEventListener('click',       _dlAll);
  spmEl('btn-scan-media').addEventListener('click',   () => _runScrape(true));
  spmEl('btn-bulk-profile').addEventListener('click', _bulkDownloadProfile);

  // Settings tab
  spmEl('theme-toggle').addEventListener('change',   e => _setTheme(e.target.checked ? 'dark' : 'light'));
  spmEl('notif-toggle').addEventListener('change',   e => _saveSetting('notifications', e.target.checked));
  spmEl('autosave-toggle').addEventListener('change',e => _saveSetting('autosave', e.target.checked));
  spmEl('btn-export-settings').addEventListener('click', _exportJSON);
  spmEl('btn-clear-all').addEventListener('click',   _clearAll);

  // Resize handle
  _initResizeHandle();
}

// ─────────────────────────────────────────────────────────────
//  SIDEBAR OPEN/CLOSE/TABS
// ─────────────────────────────────────────────────────────────
function _toggleSidebar() { _ui.open ? _closeSidebar() : _openSidebar(); }

function _openSidebar() {
  _ui.open = true;
  spmEl('spm-root').classList.add('spm-open');
  spmEl('spm-fab').classList.add('spm-fab-open');
  spmEl('spm-fab').innerText = '✕';
  if (_ui.activeTab === 'analytics') _renderCharts();
  if (_ui.activeTab === 'downloads') _renderMediaGrid();
}

function _closeSidebar() {
  _ui.open = false;
  spmEl('spm-root').classList.remove('spm-open');
  spmEl('spm-fab').classList.remove('spm-fab-open');
  spmEl('spm-fab').innerText = '📊';
}

function _switchTab(tab) {
  _ui.activeTab = tab;
  spmQA('.spm-tab').forEach(t => {
    const on = t.dataset.tab === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  spmQA('.spm-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  if (tab === 'analytics') _renderCharts();
  if (tab === 'downloads') _renderMediaGrid();
}

function _applyTheme() {
  const root = document.getElementById('spm-root');
  if (root) root.classList.toggle('spm-dark', _ui.settings.theme === 'dark');
}

function _setTheme(t) {
  _ui.settings.theme = t;
  _applyTheme();
  _saveSetting('theme', t);
}

async function _saveSetting(key, val) {
  _ui.settings[key] = val;
  await spmSet({ spm_settings: _ui.settings });
}

// ─────────────────────────────────────────────────────────────
//  STATUS BAR
// ─────────────────────────────────────────────────────────────
let _statusTimer = null;
function _setStatus(msg, type = 'idle', autoClear = true) {
  const dot  = spmEl('spm-dot');
  const text = spmEl('spm-status-text');
  const upd  = spmEl('spm-last-update');
  if (!text) return;
  text.textContent = msg;
  if (dot) { dot.className = 'spm-dot'; if (type === 'ok') dot.classList.add('dot-ok'); if (type === 'err') dot.classList.add('dot-err'); }
  if (upd) upd.textContent = spmTs();
  if (_statusTimer) clearTimeout(_statusTimer);
  if (autoClear && type !== 'err') _statusTimer = setTimeout(() => { if (text) text.textContent = 'Ready'; }, 3500);
}

function _setLoading(btnId, loading, originalText) {
  const btn = spmElFresh(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) { btn.dataset.orig = btn.innerText; btn.innerText = '⏳ Loading…'; }
  else btn.innerText = btn.dataset.orig || originalText || btn.innerText;
}

// ─────────────────────────────────────────────────────────────
//  SCRAPE + UPDATE STATS PANEL
// ─────────────────────────────────────────────────────────────
const _runScrape = spmDebounce(async (showLoading = false) => {
  if (showLoading) _setLoading('btn-refresh', true);
  _setStatus('Scanning page…', 'idle', false);
  try {
    const fresh = SpmExtractor.stats();
    const prev  = _ui.currentStats;
    _ui.currentStats = fresh;
    _ui.mediaUrls    = fresh.mediaUrls || [];

    _updateStatsUI(fresh, prev);
    if (_ui.activeTab === 'downloads') _renderMediaGrid();

    // Persist snapshot
    if (_ui.settings.autosave !== false) {
      const snap = {
        platform: fresh.platform, url: fresh.url, ts: Date.now(),
        likes:    spmParseNum(fresh.likes),
        comments: spmParseNum(fresh.comments),
        shares:   spmParseNum(fresh.shares),
        reach:    spmParseNum(fresh.reach),
        engageRate: _computeEngage(fresh),
      };
      spmBoundedPush(_ui.history, snap, SPM.MAX_HISTORY);
      await spmSet({ spm_history: _ui.history });
      if (_ui.activeTab === 'analytics') _renderCharts();
    }

    SpmMonitor.setLastStats(fresh);
    _setStatus('Updated ' + spmTs(), 'ok');
  } catch (err) {
    spmLog.error('Scrape failed:', err);
    _setStatus('Scrape error — see console', 'err', false);
  } finally {
    if (showLoading) _setLoading('btn-refresh', false);
  }
}, 300);

function _computeEngage(stats) {
  return spmEngagement(stats.likes, stats.comments, _ui.profile.followers);
}

function _updateStatsUI(fresh, prev) {
  const set = (id, val, muted) => {
    const el = spmElFresh(id); if (!el) return;
    el.textContent = spmFmt(val) || '—';
    el.style.color = muted ? 'var(--muted)' : '';
    el.style.fontSize = String(val||'').length > 7 ? '14px' : '';
  };
  set('s-likes',    fresh.likes);
  set('s-comments', fresh.comments);
  set('s-shares',   fresh.shares);
  set('s-reach',    fresh.reach,    fresh.reachIsNA);

  // Change indicators
  const _chg = (id, newV, oldV) => {
    const el = spmElFresh(id); if (!el) return;
    const n = spmParseNum(newV), o = spmParseNum(oldV);
    if (n == null || o == null || n === o) { el.textContent = ''; return; }
    const d = n - o;
    el.textContent = (d > 0 ? '▲ +' : '▼ ') + Math.abs(d).toLocaleString();
    el.className   = 'spm-stat-change ' + (d > 0 ? 'chg-up' : 'chg-down');
  };
  _chg('s-likes-chg',    fresh.likes,    prev.likes);
  _chg('s-comments-chg', fresh.comments, prev.comments);

  // Engagement rate
  const rate = _computeEngage(fresh);
  const rEl  = spmElFresh('s-engage-val');
  const fEl  = spmElFresh('s-engage-fill');
  if (rEl) rEl.textContent = rate || '— (load profile for followers)';
  if (fEl && rate) fEl.style.width = Math.min(100, parseFloat(rate) * 5) + '%';

  // Reach note
  const note = spmElFresh('s-reach-note');
  if (note) note.style.display = fresh.reachIsNA ? 'block' : 'none';
}

// ─────────────────────────────────────────────────────────────
//  AUTO-MONITOR
// ─────────────────────────────────────────────────────────────
function _onMonitorToggle(on) {
  const dot = spmElFresh('spm-monitor-dot');
  if (on) {
    SpmMonitor.start({ interval: +spmEl('mon-interval').value, threshold: +spmEl('mon-threshold').value });
    if (dot) { dot.classList.add('dot-active'); dot.title = 'Monitoring active'; }
    _addMonitorLog({ isAlert: false, ts: Date.now(), msg: '▶ Started' });
  } else {
    SpmMonitor.stop();
    if (dot) { dot.classList.remove('dot-active'); dot.title = 'Monitor off'; }
    _addMonitorLog({ isAlert: false, ts: Date.now(), msg: '⏹ Stopped' });
  }
}

function _addMonitorLog(entry) {
  const log = spmElFresh('monitor-log');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'spm-log-item' + (entry.isAlert ? ' spm-log-alert' : '');
  div.textContent = `[${new Date(entry.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}] ${entry.msg || (entry.alerts||[]).map(a=>`${a.label} ${a.diff>0?'+':''}${a.diff}`).join(' · ')}`;
  log.prepend(div);
  // Keep only last MAX_LOG items in DOM
  while (log.children.length > SPM.MAX_LOG) log.removeChild(log.lastChild);
}

// ─────────────────────────────────────────────────────────────
//  COMMENT MANAGER
// ─────────────────────────────────────────────────────────────
async function _loadComments() {
  _setLoading('btn-load-comments', true);
  _setStatus('Scraping comments…', 'idle', false);
  try {
    await new Promise(r => setTimeout(r, 100)); // yield to browser
    _ui.comments = SpmExtractor.comments();
    _renderCommentList(_ui.comments);
    spmElFresh('comment-count').textContent = `${_ui.comments.length} comment${_ui.comments.length!==1?'s':''} found`;
    _setStatus(`Loaded ${_ui.comments.length} comments`, 'ok');
  } catch (err) {
    spmLog.error('Comments error:', err);
    _setStatus('Failed to load comments', 'err', false);
  } finally {
    _setLoading('btn-load-comments', false);
  }
}

function _renderCommentList(items) {
  const list = spmElFresh('comment-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="spm-empty"><div class="spm-empty-icon">💬</div><p>No comments detected</p></div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  items.forEach(c => {
    const div = document.createElement('div');
    div.className = 'spm-comment-item';
    div.innerHTML = /* html */`
      <div class="spm-comment-header">
        <div class="spm-avatar">${spmEsc(c.username.charAt(0).toUpperCase())}</div>
        <span class="spm-comment-user">@${spmEsc(c.username)}</span>
        ${c.time ? `<span class="spm-comment-time">${spmEsc(c.time)}</span>` : ''}
      </div>
      <div class="spm-comment-text">${spmEsc(c.text)}</div>
      ${c.likes ? `<div class="spm-comment-meta">❤️ ${spmEsc(c.likes)} likes</div>` : ''}
    `;
    frag.appendChild(div);
  });
  list.innerHTML = '';
  list.appendChild(frag);
}

const _filterComments = spmDebounce(function(q) {
  const lo  = q.toLowerCase();
  const filtered = lo ? _ui.comments.filter(c => c.username.toLowerCase().includes(lo) || c.text.toLowerCase().includes(lo)) : _ui.comments;
  _renderCommentList(filtered);
  const el = spmElFresh('comment-count');
  if (el) el.textContent = `${filtered.length} of ${_ui.comments.length} shown`;
}, 200);

function _copyComments() {
  if (!_ui.comments.length) { _setStatus('No comments loaded', 'err'); return; }
  const text = _ui.comments.map(c => `@${c.username}: ${c.text}`).join('\n');
  navigator.clipboard.writeText(text)
    .then(()  => _setStatus(`Copied ${_ui.comments.length} comments ✓`, 'ok'))
    .catch(err => { spmLog.error('Clipboard error:', err); _setStatus('Copy failed', 'err'); });
}

function _clickLoadMore() {
  const btn = spmQA('button, span').find(el => /load more|view more|view all/i.test((el.innerText||'').trim()));
  if (btn) { btn.click(); setTimeout(_loadComments, 1400); _setStatus('Loading more…', 'idle', false); }
  else _setStatus('No "Load more" button found', 'err');
}

// ─────────────────────────────────────────────────────────────
//  PROFILE
// ─────────────────────────────────────────────────────────────
async function _loadProfile() {
  _setLoading('btn-load-profile', true);
  _setStatus('Loading profile…', 'idle', false);
  try {
    _ui.profile = SpmExtractor.profile();
    _renderProfile(_ui.profile);
    _setStatus('Profile loaded ✓', 'ok');
    // Re-compute engagement rate with follower data
    if (_ui.currentStats.likes) _updateStatsUI(_ui.currentStats, {});
  } catch (err) {
    spmLog.error('Profile error:', err);
    _setStatus('Profile load failed', 'err', false);
  } finally {
    _setLoading('btn-load-profile', false);
  }
}

function _renderProfile(p) {
  const c = spmElFresh('profile-content');
  if (!c) return;
  const hasStats = p.followers || p.following || p.posts;
  c.innerHTML = /* html */`
    <div class="spm-profile-card">
      ${p.avatarSrc
        ? `<img class="spm-profile-img" src="${spmEsc(p.avatarSrc)}" alt="Profile" onerror="this.style.display='none'"/>`
        : `<div class="spm-profile-placeholder">👤</div>`}
      <div>
        <div class="spm-profile-name">${spmEsc(p.name || p.username || 'Unknown')}</div>
        ${p.username ? `<div class="spm-muted-text">@${spmEsc(p.username)}</div>` : ''}
        ${p.bio      ? `<div class="spm-profile-bio">${spmEsc(p.bio)}</div>` : ''}
      </div>
    </div>
    ${hasStats ? `
    <div class="spm-profile-stats">
      <div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(spmParseNum(p.followers))}</div><div class="spm-muted-text">Followers</div></div>
      <div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(spmParseNum(p.following))}</div><div class="spm-muted-text">Following</div></div>
      <div class="spm-profile-stat"><div class="spm-profile-stat-val">${spmFmt(spmParseNum(p.posts))}</div><div class="spm-muted-text">Posts</div></div>
    </div>` : `<div class="spm-note">Visit the profile page for complete follower counts.</div>`}
  `;
}

// ─────────────────────────────────────────────────────────────
//  ANALYTICS — SVG CHARTS
// ─────────────────────────────────────────────────────────────
function _renderCharts() {
  const hist = _ui.history.filter(h =>
    h.url === location.href || h.url?.split('?')[0] === location.href.split('?')[0]
  );
  _drawLineChart('chart-likes',    hist, 'likes',    'Likes');
  _drawLineChart('chart-comments', hist, 'comments', 'Comments');
  _drawEngageChart('chart-engage', hist);
  _renderHistoryTable(hist);
}

function _drawLineChart(containerId, data, field, label) {
  const c = spmElFresh(containerId);
  if (!c) return;
  const pts = data.map(h => ({ x: h.ts, y: h[field] })).filter(p => p.y != null);
  if (pts.length < 2) {
    c.innerHTML = `<div class="spm-chart-empty">Not enough data yet.<br/>Refresh stats a few times.</div>`;
    return;
  }
  c.innerHTML = _svgLine(pts, label, 'var(--accent)');
}

function _drawEngageChart(containerId, data) {
  const c = spmElFresh(containerId);
  if (!c) return;
  const pts = data.map(h => {
    const r = h.engageRate ? parseFloat(h.engageRate) : null;
    return { x: h.ts, y: r };
  }).filter(p => p.y != null);
  if (pts.length < 2) { c.innerHTML = `<div class="spm-chart-empty">Needs follower data + multiple snapshots.</div>`; return; }
  c.innerHTML = _svgLine(pts, 'Engage%', 'var(--green)');
}

function _svgLine(pts, label, color) {
  const W = 340, H = 130, P = {t:14,r:10,b:26,l:40};
  const cW = W-P.l-P.r, cH = H-P.t-P.b;
  const ys = pts.map(p=>p.y), mn = Math.min(...ys), mx = Math.max(...ys), rng = mx-mn||1;
  const xS = i => P.l + (i/(pts.length-1||1))*cW;
  const yS = v => P.t + cH - ((v-mn)/rng)*cH;
  const line = pts.map((p,i)=>`${xS(i)},${yS(p.y)}`).join(' ');
  const area = `${line} ${xS(pts.length-1)},${P.t+cH} ${xS(0)},${P.t+cH}`;
  const ticks = [0,.5,1].map(t=>{
    const y=P.t+t*cH, v=mx-t*rng;
    const lbl = v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':Math.round(v).toString();
    return `<line x1="${P.l}" y1="${y}" x2="${W-P.r}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,2" stroke-width="1"/>
            <text x="${P.l-4}" y="${y+4}" text-anchor="end" font-size="9" fill="var(--muted)">${lbl}</text>`;
  }).join('');
  const xlbls = [0, Math.floor((pts.length-1)/2), pts.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>
    `<text x="${xS(i)}" y="${H-4}" text-anchor="middle" font-size="9" fill="var(--muted)">${new Date(pts[i].x).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text>`
  ).join('');
  const dots = pts.map((p,i)=>
    `<circle cx="${xS(i)}" cy="${yS(p.y)}" r="3" fill="${color}" stroke="var(--bg)" stroke-width="1.5"><title>${Math.round(p.y).toLocaleString()}</title></circle>`
  ).join('');
  const uid = label.replace(/[^a-z]/gi,'');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".2"/>
      <stop offset="100%" stop-color="${color}" stop-opacity=".01"/>
    </linearGradient></defs>
    ${ticks}
    <polygon points="${area}" fill="url(#g${uid})"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${xlbls}
  </svg>`;
}

function _renderHistoryTable(hist) {
  const tbody = spmElFresh('history-tbody');
  if (!tbody) return;
  if (!hist.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:16px">No history for this URL yet</td></tr>`;
    return;
  }
  const frag = document.createDocumentFragment();
  [...hist].reverse().slice(0,40).forEach(h => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${spmAgo(h.ts)}</td><td>${spmFmt(h.likes)||'—'}</td><td>${spmFmt(h.comments)||'—'}</td><td>${spmFmt(h.shares)||'—'}</td><td>${h.engageRate||'—'}</td>`;
    frag.appendChild(tr);
  });
  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

async function _clearHistory() {
  if (!confirm('Clear all history for this session?')) return;
  _ui.history = [];
  await spmRemove('spm_history');
  _renderCharts();
  _setStatus('History cleared', 'ok');
}

// ─────────────────────────────────────────────────────────────
//  DOWNLOADS
// ─────────────────────────────────────────────────────────────
function _renderMediaGrid() {
  const grid = spmElFresh('media-grid');
  if (!grid) return;
  const urls = _ui.mediaUrls;
  if (!urls.length) {
    grid.innerHTML = `<div class="spm-empty" style="grid-column:1/-1"><div class="spm-empty-icon">🖼️</div><p>No media detected</p></div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  urls.forEach((url, i) => {
    const isVid = /\.mp4|video/i.test(url);
    const wrap  = document.createElement('div');
    wrap.className = 'spm-thumb';
    wrap.dataset.url = url;
    wrap.dataset.i   = i;
    wrap.innerHTML = isVid
      ? `<div class="spm-thumb-inner spm-thumb-video">🎬<div class="spm-thumb-badge">MP4</div></div><div class="spm-thumb-overlay">⬇️</div>`
      : `<img src="${spmEsc(url)}" alt="media ${i+1}" loading="lazy" onerror="this.closest('.spm-thumb').style.display='none'"/><div class="spm-thumb-overlay">⬇️</div>`;
    wrap.addEventListener('click', () => _dlOne(url, i));
    frag.appendChild(wrap);
  });
  grid.innerHTML = '';
  grid.appendChild(frag);
}

async function _dlOne(url, idx) {
  if (!spmValidateUrl(url)) { _setStatus('Invalid/blocked URL', 'err'); return; }
  const ext = /\.mp4|video/i.test(url) ? 'mp4' : 'jpg';
  const fn  = `${SPM.PLATFORM}_post_${Date.now()}_${idx}.${ext}`;
  const res = await spmSend({ type: 'DOWNLOAD_MEDIA', url, filename: fn });
  _setStatus(res?.ok ? `Downloading ${fn}…` : ('Download failed: ' + (res?.error||'unknown')), res?.ok?'ok':'err');
}

async function _dlAll() {
  if (!_ui.mediaUrls.length) { _setStatus('No media found', 'err'); return; }
  _setStatus(`Queuing ${_ui.mediaUrls.length} downloads…`, 'ok');
  const prefix = `${SPM.PLATFORM}_${Date.now()}`;
  const res = await spmSend({ type: 'BULK_DOWNLOAD', urls: _ui.mediaUrls, prefix });
  _setStatus(res?.ok ? `Downloaded ${res.count} file(s) ✓` : 'Bulk download error', res?.ok?'ok':'err');
}

async function _bulkDownloadProfile() {
  _setLoading('btn-bulk-profile', true);
  _setStatus('Scanning profile grid…', 'idle', false);
  const wrap = spmElFresh('bulk-wrap');
  const fill = spmElFresh('bulk-fill');
  const text = spmElFresh('bulk-text');
  if (wrap) wrap.style.display = 'block';
  if (fill) fill.style.width = '20%';
  try {
    const urls = SpmExtractor.profileGridMedia();
    if (!urls.length) { _setStatus('No media found on this page', 'err', false); return; }
    if (text) text.textContent = `Found ${urls.length} files — downloading…`;
    if (fill) fill.style.width = '50%';
    const prefix = `${SPM.PLATFORM}_profile_${Date.now()}`;
    const res = await spmSend({ type: 'BULK_DOWNLOAD', urls, prefix });
    if (fill) fill.style.width = '100%';
    if (text) text.textContent = `✅ Downloaded ${res?.count||0} files`;
    _setStatus(`Bulk: ${res?.count||0} files ✓`, 'ok');
    setTimeout(() => { if(wrap) wrap.style.display='none'; }, 4000);
  } catch (err) {
    spmLog.error('Bulk download error:', err);
    _setStatus('Bulk download failed', 'err', false);
  } finally {
    _setLoading('btn-bulk-profile', false);
  }
}

// ─────────────────────────────────────────────────────────────
//  EXPORT
// ─────────────────────────────────────────────────────────────
function _exportCSV() {
  const rows = [['Time','Platform','URL','Likes','Comments','Shares','Reach','Engage%']];
  _ui.history.forEach(h => rows.push([
    new Date(h.ts).toLocaleString(), h.platform||SPM.PLATFORM, h.url||location.href,
    h.likes||'', h.comments||'', h.shares||'', h.reach||'', h.engageRate||'',
  ]));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  _downloadBlob(csv, `spm_export_${Date.now()}.csv`, 'text/csv');
  _setStatus('CSV exported ✓', 'ok');
}

async function _exportJSON() {
  const r = await spmGet(['spm_history']);
  const json = JSON.stringify({ exported: new Date().toISOString(), history: r.spm_history||[] }, null, 2);
  _downloadBlob(json, `spm_data_${Date.now()}.json`, 'application/json');
  _setStatus('JSON exported ✓', 'ok');
}

function _downloadBlob(content, filename, mime) {
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 5000);
}

async function _clearAll() {
  if (!confirm('Delete ALL saved data? Cannot be undone.')) return;
  _ui.history = [];
  await spmRemove('spm_history');
  _setStatus('All data cleared', 'ok');
}

// ─────────────────────────────────────────────────────────────
//  RESIZE HANDLE
// ─────────────────────────────────────────────────────────────
function _initResizeHandle() {
  const handle = spmEl('spm-resize-handle');
  const root   = spmEl('spm-root');
  if (!handle || !root) return;
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('mousedown', e => {
    dragging = true; startX = e.clientX; startW = root.offsetWidth;
    handle.classList.add('dragging');
    const onMove = spmThrottle(e2 => {
      if (!dragging) return;
      const w = Math.min(700, Math.max(280, startW - (e2.clientX - startX)));
      root.style.width = w + 'px';
    }, 16);
    const onUp = () => {
      dragging = false;
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',  onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ─────────────────────────────────────────────────────────────
//  MONITOR EVENTS → UI
// ─────────────────────────────────────────────────────────────
function _wireMonitorEvents() {
  SpmMonitor.on('tick', ({ fresh, alerts, logEntry }) => {
    _ui.currentStats = fresh;
    _updateStatsUI(fresh, _ui.currentStats);
    _addMonitorLog(logEntry);
  });
  SpmMonitor.on('navigate', () => {
    spmClearElCache(); // DOM has changed — clear cached refs
    _ui.currentStats = {};
    _ui.comments     = [];
    _ui.mediaUrls    = [];
    // Delay re-scrape to let new page DOM settle
    setTimeout(() => _runScrape(false), 2000);
  });
}

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────
function _init() {
  try {
    _buildSidebar();
    spmClearElCache(); // fresh cache after DOM build
    _wire();
    _wireMonitorEvents();
    SpmMonitor.init();
    _loadPersistedState().then(() => {
      // Initial scrape after page settles
      setTimeout(() => _runScrape(false), 1500);
    });
    spmLog.info('SPM Pro v3 initialized on', SPM.PLATFORM);
  } catch (err) {
    spmLog.error('Init failed:', err);
  }
}

if (document.readyState === 'complete') {
  _init();
} else {
  window.addEventListener('load', _init, { once: true });
}

} // end guard
