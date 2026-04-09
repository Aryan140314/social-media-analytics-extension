// ═══════════════════════════════════════════════════════════
//  Social Post Monitor Pro  —  Content Script
//  Full DevTools-style sidebar for Facebook & Instagram
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';
  if (document.getElementById('spm-root')) return; // prevent double-inject

  const IS_FB = location.hostname.includes('facebook.com');
  const IS_IG = location.hostname.includes('instagram.com');
  const PLATFORM = IS_FB ? 'Facebook' : 'Instagram';

  // ── State ──────────────────────────────────────────────────
  const state = {
    open: false,
    activeTab: 'stats',
    theme: 'light',
    monitorActive: false,
    monitorTimer: null,
    monitorInterval: 60,   // seconds
    alertThreshold: 1,
    lastStats: {},
    currentStats: {},
    comments: [],
    profile: {},
    mediaUrls: [],
    history: [],
    monitorLog: [],
  };

  // ── Utilities ──────────────────────────────────────────────
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function sid(id) { return document.getElementById(id); }
  function fmt(n)  { if (n == null) return '—'; const v = parseInt(String(n).replace(/,/g, ''), 10); if (isNaN(v)) return n; if (v >= 1e6) return (v/1e6).toFixed(1)+'M'; if (v >= 1e3) return (v/1e3).toFixed(1)+'K'; return v.toLocaleString(); }
  function ts()    { return new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }
  function ago(t)  { const d = Date.now()-t, m = Math.floor(d/60000); if(m<1) return 'just now'; if(m<60) return m+'m ago'; const h=Math.floor(m/60); if(h<24) return h+'h ago'; return Math.floor(h/24)+'d ago'; }

  // ── Load persisted settings ─────────────────────────────────
  chrome.runtime.sendMessage({type:'GET_SETTINGS'}, res => {
    const s = res?.settings || {};
    if (s.theme)           { state.theme = s.theme; applyTheme(); }
    if (s.monitorInterval) state.monitorInterval = s.monitorInterval;
    if (s.alertThreshold)  state.alertThreshold  = s.alertThreshold;
  });
  chrome.runtime.sendMessage({type:'GET_HISTORY'}, res => {
    state.history = res?.history || [];
  });

  // ─────────────────────────────────────────────────────────────
  //  SIDEBAR HTML
  // ─────────────────────────────────────────────────────────────
  function buildSidebar() {
    const root = document.createElement('div');
    root.id = 'spm-root';
    root.innerHTML = `
      <div id="spm-resize-handle"></div>
      <div id="spm-sidebar">

        <!-- Header -->
        <div id="spm-header">
          <span id="spm-logo">📊 SPM Pro</span>
          <span id="spm-platform-badge">${PLATFORM}</span>
          <span id="spm-monitor-indicator" title="Auto-monitor"></span>
          <button id="spm-close-btn" title="Close sidebar">✕</button>
        </div>

        <!-- Tabs -->
        <div id="spm-tabs">
          <div class="spm-tab active" data-tab="stats">
            <span class="spm-tab-icon">📊</span>Stats
          </div>
          <div class="spm-tab" data-tab="comments">
            <span class="spm-tab-icon">💬</span>Comments
          </div>
          <div class="spm-tab" data-tab="profile">
            <span class="spm-tab-icon">👤</span>Profile
          </div>
          <div class="spm-tab" data-tab="analytics">
            <span class="spm-tab-icon">📈</span>Analytics
          </div>
          <div class="spm-tab" data-tab="downloads">
            <span class="spm-tab-icon">⬇️</span>Downloads
          </div>
          <div class="spm-tab" data-tab="settings">
            <span class="spm-tab-icon">⚙️</span>Settings
          </div>
        </div>

        <!-- Content -->
        <div id="spm-content">
          ${renderStatsPanel()}
          ${renderCommentsPanel()}
          ${renderProfilePanel()}
          ${renderAnalyticsPanel()}
          ${renderDownloadsPanel()}
          ${renderSettingsPanel()}
        </div>

        <!-- Status bar -->
        <div id="spm-statusbar">
          <span class="spm-status-dot" id="spm-dot"></span>
          <span id="spm-status-text">Ready</span>
          <span id="spm-last-update"></span>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    // FAB toggle
    const fab = document.createElement('button');
    fab.id = 'spm-fab';
    fab.title = 'Social Post Monitor Pro';
    fab.textContent = '📊';
    document.body.appendChild(fab);

    return root;
  }

  // ─────────────────────────────────────────────────────────────
  //  PANEL HTML TEMPLATES
  // ─────────────────────────────────────────────────────────────
  function renderStatsPanel() {
    return `<div class="spm-tab-panel active" id="panel-stats">
      <div class="spm-stats-grid">
        <div class="spm-stat-card">
          <div class="spm-stat-icon">❤️</div>
          <div class="spm-stat-value" id="s-likes">—</div>
          <div class="spm-stat-label">Likes</div>
          <div class="spm-stat-change" id="s-likes-chg"></div>
        </div>
        <div class="spm-stat-card">
          <div class="spm-stat-icon">💬</div>
          <div class="spm-stat-value" id="s-comments">—</div>
          <div class="spm-stat-label">Comments</div>
          <div class="spm-stat-change" id="s-comments-chg"></div>
        </div>
        <div class="spm-stat-card">
          <div class="spm-stat-icon">🔁</div>
          <div class="spm-stat-value" id="s-shares">—</div>
          <div class="spm-stat-label">Shares</div>
          <div class="spm-stat-change" id="s-shares-chg"></div>
        </div>
        <div class="spm-stat-card">
          <div class="spm-stat-icon">👁️</div>
          <div class="spm-stat-value" id="s-reach">—</div>
          <div class="spm-stat-label">Reach/Views</div>
          <div class="spm-stat-change" id="s-reach-chg"></div>
        </div>
      </div>

      <div class="spm-engage-bar" id="s-engage-bar">
        <div class="spm-engage-label">
          <span>Engagement Rate</span>
          <strong id="s-engage-rate">—</strong>
        </div>
        <div class="spm-engage-track"><div class="spm-engage-fill" id="s-engage-fill" style="width:0%"></div></div>
      </div>

      <div class="spm-btn-row" style="margin-bottom:8px">
        <button class="spm-btn spm-btn-primary" id="btn-refresh">🔄 Refresh</button>
        <button class="spm-btn spm-btn-secondary" id="btn-export-csv">📥 CSV</button>
      </div>

      <!-- Auto-monitor -->
      <div class="spm-section-title">Auto Monitor</div>
      <div class="spm-monitor-card">
        <div class="spm-monitor-header">
          <span class="spm-monitor-title">📡 Watch for changes</span>
          <label class="spm-toggle">
            <input type="checkbox" id="monitor-toggle">
            <span class="spm-toggle-slider"></span>
          </label>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">
          Interval: <select class="spm-select" id="monitor-interval-sel">
            <option value="15">15 sec</option>
            <option value="30">30 sec</option>
            <option value="60" selected>1 min</option>
            <option value="300">5 min</option>
            <option value="600">10 min</option>
          </select>
          &nbsp; Alert if ≥ <select class="spm-select" id="monitor-threshold-sel">
            <option value="1">1</option>
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
          </select> change
        </div>
        <div class="spm-monitor-log" id="monitor-log">
          <div style="color:var(--muted);font-size:11px">No events yet…</div>
        </div>
      </div>

      <div id="s-reach-note" class="spm-note" style="display:none">
        📷 Photo post — Reach/Views only shown on Reels & Videos, or your own posts via Insights.
      </div>
    </div>`;
  }

  function renderCommentsPanel() {
    return `<div class="spm-tab-panel" id="panel-comments">
      <div class="spm-comment-toolbar">
        <input class="spm-search-input" id="comment-search" placeholder="🔍 Search comments…" />
        <button class="spm-btn spm-btn-primary" style="width:auto;margin:0;padding:7px 10px" id="btn-load-comments">Load</button>
      </div>
      <div style="display:flex;gap:7px;margin-bottom:10px">
        <button class="spm-btn spm-btn-secondary" style="margin:0" id="btn-copy-comments">📋 Copy All</button>
        <button class="spm-btn spm-btn-secondary" style="margin:0" id="btn-load-more-comments">Load More</button>
      </div>
      <div class="spm-comment-count" id="comment-count">No comments loaded</div>
      <div class="spm-comment-list" id="comment-list">
        <div class="spm-empty-state">
          <div class="spm-empty-icon">💬</div>
          <p>Click "Load" to scrape comments from this post</p>
        </div>
      </div>
    </div>`;
  }

  function renderProfilePanel() {
    return `<div class="spm-tab-panel" id="panel-profile">
      <div id="profile-content">
        <div class="spm-empty-state">
          <div class="spm-empty-icon">👤</div>
          <p>Click below to load profile stats</p>
        </div>
      </div>
      <button class="spm-btn spm-btn-primary" id="btn-load-profile">👤 Load Profile Stats</button>
      <div class="spm-note" style="margin-top:8px">
        ℹ️ For best results, visit the profile page directly. On post pages, limited info is available.
      </div>
    </div>`;
  }

  function renderAnalyticsPanel() {
    return `<div class="spm-tab-panel" id="panel-analytics">
      <div class="spm-section-title">Likes Over Time</div>
      <div class="spm-chart-card">
        <div class="spm-chart-container" id="chart-likes"></div>
      </div>
      <div class="spm-section-title">Comments Over Time</div>
      <div class="spm-chart-card">
        <div class="spm-chart-container" id="chart-comments"></div>
      </div>
      <div class="spm-section-title">History Log</div>
      <div class="spm-chart-card" style="padding:0;overflow:auto">
        <table class="spm-history-table" id="history-table">
          <thead>
            <tr>
              <th>Time</th><th>Likes</th><th>Comments</th><th>Shares</th>
            </tr>
          </thead>
          <tbody id="history-tbody"></tbody>
        </table>
      </div>
      <button class="spm-btn spm-btn-danger" style="margin-top:10px" id="btn-clear-history">🗑️ Clear History</button>
    </div>`;
  }

  function renderDownloadsPanel() {
    return `<div class="spm-tab-panel" id="panel-downloads">
      <div class="spm-section-title">Post Media</div>
      <div class="spm-media-grid" id="media-grid">
        <div class="spm-empty-state" style="grid-column:1/-1">
          <div class="spm-empty-icon">🖼️</div>
          <p>Refresh stats to detect media</p>
        </div>
      </div>

      <div class="spm-btn-row">
        <button class="spm-btn spm-btn-success" id="btn-dl-all">⬇️ Download All</button>
        <button class="spm-btn spm-btn-secondary" id="btn-scan-media">🔍 Re-scan</button>
      </div>

      <div class="spm-section-title" style="margin-top:14px">Bulk Profile Download</div>
      <div class="spm-note">Navigate to a profile page (e.g. instagram.com/username/) then click below to collect all visible post thumbnails.</div>
      <button class="spm-btn spm-btn-warning" id="btn-bulk-profile">📦 Bulk Download Profile</button>
      <div id="bulk-progress" style="display:none">
        <div class="spm-progress-bar"><div class="spm-progress-fill" id="bulk-fill" style="width:0%"></div></div>
        <div class="spm-bulk-progress" id="bulk-progress-text">Preparing…</div>
      </div>
    </div>`;
  }

  function renderSettingsPanel() {
    return `<div class="spm-tab-panel" id="panel-settings">
      <div class="spm-section-title">Appearance</div>
      <div class="spm-setting-row">
        <div class="spm-setting-info">
          <div class="spm-setting-label">🌙 Dark Mode</div>
          <div class="spm-setting-desc">Switch between light and dark sidebar</div>
        </div>
        <label class="spm-toggle">
          <input type="checkbox" id="theme-toggle">
          <span class="spm-toggle-slider"></span>
        </label>
      </div>

      <div class="spm-section-title">Notifications</div>
      <div class="spm-setting-row">
        <div class="spm-setting-info">
          <div class="spm-setting-label">🔔 Desktop Alerts</div>
          <div class="spm-setting-desc">Send a notification when stats change</div>
        </div>
        <label class="spm-toggle">
          <input type="checkbox" id="notif-toggle" checked>
          <span class="spm-toggle-slider"></span>
        </label>
      </div>

      <div class="spm-section-title">Data</div>
      <div class="spm-setting-row">
        <div class="spm-setting-info">
          <div class="spm-setting-label">💾 Auto-save Snapshots</div>
          <div class="spm-setting-desc">Save stats to history on every refresh</div>
        </div>
        <label class="spm-toggle">
          <input type="checkbox" id="autosave-toggle" checked>
          <span class="spm-toggle-slider"></span>
        </label>
      </div>
      <button class="spm-btn spm-btn-secondary" id="btn-export-settings">📤 Export All Data (JSON)</button>
      <button class="spm-btn spm-btn-danger"    id="btn-clear-all">🗑️ Clear All Saved Data</button>

      <div class="spm-section-title">About</div>
      <div class="spm-setting-row" style="flex-direction:column;align-items:flex-start;gap:4px">
        <div class="spm-setting-label">📊 Social Post Monitor Pro v2.0</div>
        <div class="spm-setting-desc">Supports Facebook & Instagram<br>Manifest V3 · Chrome / Brave / Edge</div>
      </div>
    </div>`;
  }

  // ─────────────────────────────────────────────────────────────
  //  INIT & WIRE UP
  // ─────────────────────────────────────────────────────────────
  function init() {
    const root = buildSidebar();
    applyTheme();

    // FAB
    sid('spm-fab').onclick = toggleSidebar;
    sid('spm-close-btn').onclick = closeSidebar;

    // Tabs
    $$('.spm-tab', root).forEach(tab => {
      tab.onclick = () => switchTab(tab.dataset.tab);
    });

    // Stats tab
    sid('btn-refresh').onclick    = () => { setStatus('Scanning…','ok'); scrapeAndUpdate(); };
    sid('btn-export-csv').onclick = exportCSV;
    sid('monitor-toggle').onchange = e => toggleMonitor(e.target.checked);
    sid('monitor-interval-sel').onchange = e => { state.monitorInterval = +e.target.value; restartMonitorIfActive(); };
    sid('monitor-threshold-sel').onchange = e => { state.alertThreshold = +e.target.value; };

    // Comments tab
    sid('btn-load-comments').onclick      = loadComments;
    sid('btn-copy-comments').onclick      = copyComments;
    sid('btn-load-more-comments').onclick = clickLoadMoreComments;
    sid('comment-search').oninput = e => filterComments(e.target.value);

    // Profile tab
    sid('btn-load-profile').onclick = loadProfile;

    // Analytics tab
    sid('btn-clear-history').onclick = clearHistory;

    // Downloads tab
    sid('btn-dl-all').onclick         = downloadAllMedia;
    sid('btn-scan-media').onclick     = () => { scrapeAndUpdate(); setStatus('Re-scanning media…','ok'); };
    sid('btn-bulk-profile').onclick   = bulkDownloadProfile;

    // Settings tab
    sid('theme-toggle').onchange     = e => setTheme(e.target.checked ? 'dark' : 'light');
    sid('btn-export-settings').onclick = exportJSON;
    sid('btn-clear-all').onclick     = clearAllData;

    // Resize handle
    initResizeHandle();

    // SPA navigation watcher
    watchNavigation();

    // Auto-run initial scrape after a short delay
    setTimeout(() => scrapeAndUpdate(), 1200);
  }

  function toggleSidebar() {
    state.open ? closeSidebar() : openSidebar();
  }
  function openSidebar() {
    state.open = true;
    sid('spm-root').classList.add('spm-open');
    sid('spm-fab').classList.add('spm-open');
    sid('spm-fab').textContent = '✕';
    if (state.activeTab === 'analytics') renderCharts();
  }
  function closeSidebar() {
    state.open = false;
    sid('spm-root').classList.remove('spm-open');
    sid('spm-fab').classList.remove('spm-open');
    sid('spm-fab').textContent = '📊';
  }

  function switchTab(tab) {
    state.activeTab = tab;
    $$('.spm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $$('.spm-tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    if (tab === 'analytics') renderCharts();
    if (tab === 'downloads') renderMediaGrid();
  }

  function applyTheme() {
    const root = sid('spm-root');
    if (!root) return;
    root.classList.toggle('spm-dark', state.theme === 'dark');
    const toggle = sid('theme-toggle');
    if (toggle) toggle.checked = state.theme === 'dark';
  }

  function setTheme(t) {
    state.theme = t;
    applyTheme();
    chrome.runtime.sendMessage({type:'SAVE_SETTINGS', settings:{theme:t, monitorInterval:state.monitorInterval, alertThreshold:state.alertThreshold}});
  }

  function setStatus(msg, type = 'idle') {
    const dot  = sid('spm-dot');
    const text = sid('spm-status-text');
    const upd  = sid('spm-last-update');
    if (!text) return;
    text.textContent = msg;
    if (dot) {
      dot.className = 'spm-status-dot';
      if (type === 'ok')  dot.classList.add('ok');
      if (type === 'err') dot.classList.add('err');
    }
    if (upd) upd.textContent = ts();
  }

  function initResizeHandle() {
    const handle = sid('spm-resize-handle');
    const root   = sid('spm-root');
    if (!handle || !root) return;
    let dragging = false, startX, startW;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      startX   = e.clientX;
      startW   = root.offsetWidth;
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', () => {
        dragging = false;
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
      }, {once: true});
    });
    function onMove(e) {
      if (!dragging) return;
      const newW = Math.min(640, Math.max(280, startW - (e.clientX - startX)));
      root.style.width = newW + 'px';
    }
  }

  function watchNavigation() {
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        state.mediaUrls   = [];
        state.comments    = [];
        state.profile     = {};
        state.lastStats   = {};
        state.currentStats = {};
        setTimeout(() => scrapeAndUpdate(), 1800);
      }
    }).observe(document.body, {childList: true, subtree: true});
  }

  // ─────────────────────────────────────────────────────────────
  //  SCRAPERS
  // ─────────────────────────────────────────────────────────────
  function scrapeStats() {
    return IS_FB ? scrapeFacebook() : scrapeInstagram();
  }

  function scrapeFacebook() {
    const d = {platform:'facebook', url:location.href};
    // Likes
    $$('[aria-label]').forEach(el => {
      const lbl = el.getAttribute('aria-label') || '';
      if (/\d/.test(lbl) && /react/i.test(lbl) && !d.likes)
        d.likes = lbl.match(/[\d,]+/)?.[0];
    });
    if (!d.likes) {
      for (const sel of ['span[aria-label*="reaction"]','[data-testid="UFI2ReactionsCount/root"]']) {
        const el = $(sel); if (el?.innerText) { d.likes = el.innerText.trim(); break; }
      }
    }
    // Comments
    $$('[aria-label]').forEach(el => {
      const lbl = el.getAttribute('aria-label') || '';
      if (/\d/.test(lbl) && /comment/i.test(lbl) && !d.comments)
        d.comments = lbl.match(/[\d,]+/)?.[0];
    });
    // Shares
    $$('[aria-label]').forEach(el => {
      const lbl = el.getAttribute('aria-label') || '';
      if (/\d/.test(lbl) && /share/i.test(lbl) && !d.shares)
        d.shares = lbl.match(/[\d,]+/)?.[0];
    });
    if (!d.shares) {
      $$('span,div').forEach(el => {
        const t = (el.innerText||'').trim();
        if (/^\d[\d,KkMm]*\s*share/i.test(t) && !d.shares) d.shares = t;
      });
    }
    // Reach
    $$('span,div').forEach(el => {
      const t = (el.innerText||'').trim();
      if (/(reach|people reached)/i.test(t) && /\d/.test(t) && !d.reach)
        d.reach = t.match(/[\d,KkMm]+/)?.[0];
    });
    d.mediaUrls = extractFBMedia();
    return d;
  }

  function extractFBMedia() {
    const u = new Set();
    $$('img[src*="fbcdn"]').forEach(img => {
      if ((img.naturalWidth||img.width) > 200) u.add(img.src);
    });
    $$('video source[src],video[src]').forEach(v => { const s=v.src||v.getAttribute('src'); if(s) u.add(s); });
    const og = $('meta[property="og:image"]'); if (og) u.add(og.content);
    return [...u].slice(0,10);
  }

  function scrapeInstagram() {
    const d = {platform:'instagram', url:location.href};
    const all = $$('span, a');

    // ── Likes ──
    for (const el of all) {
      const t = (el.innerText||'').trim();
      const m = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
      if (m) { d.likes = String(parseInt(m[1].replace(/,/g,''),10)+1); break; }
      const m2 = t.match(/^([\d,]+)\s+likes?$/i);
      if (m2) { d.likes = m2[1]; break; }
      const m3 = t.match(/^[Ll]iked by ([\d,]+) people/);
      if (m3) { d.likes = m3[1]; break; }
    }
    if (!d.likes) {
      $$('[aria-label]').forEach(el => {
        const lbl = el.getAttribute('aria-label')||'';
        if (/like/i.test(lbl) && /\d/.test(lbl) && !d.likes)
          d.likes = lbl.match(/[\d,]+/)?.[0];
      });
    }

    // ── Comments ──
    for (const el of all) {
      const t = (el.innerText||'').trim();
      const m = t.match(/[Vv]iew all ([\d,]+) comments?/);
      if (m) { d.comments = m[1]; break; }
      const m2 = t.match(/^([\d,]+)\s+comments?$/i);
      if (m2) { d.comments = m2[1]; break; }
    }
    if (!d.comments) {
      const lis = $$('div[role="dialog"] ul > li, article ul > li').slice(1)
        .filter(li => {
          const t = (li.innerText||'').trim();
          return t.length > 1 && !/^[Vv]iew/i.test(t);
        });
      if (lis.length) d.comments = `${lis.length} (visible)`;
    }
    if (!d.comments) {
      const replies = $$('button,span').filter(el=>(el.innerText||'').trim()==='Reply');
      if (replies.length) d.comments = `${replies.length} (visible)`;
    }

    // ── Reach / Views ──
    const hasVideo = $$('video').length > 0;
    if (!hasVideo) {
      d.reach = 'N/A (Photo)';
      d.reachIsNA = true;
    } else {
      for (const el of $$('span,div')) {
        const t = (el.innerText||'').trim();
        const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
        if (m) { d.reach = m[1]; break; }
      }
      if (!d.reach) d.reach = '—';
    }

    d.mediaUrls = extractIGMedia();
    return d;
  }

  function extractIGMedia() {
    const u = new Set();
    $$('article img[src*="cdninstagram"],article img[src*="fbcdn"]')
      .forEach(img => { if ((img.naturalWidth||img.width) > 200) u.add(img.src); });
    $$('video source[src],video[src]').forEach(v => { const s=v.src||v.getAttribute('src'); if(s) u.add(s); });
    const og = $('meta[property="og:image"]'); if (og) u.add(og.content);
    return [...u].slice(0,10);
  }

  // ── Scrape & update all panels ─────────────────────────────
  function scrapeAndUpdate() {
    const fresh = scrapeStats();
    state.lastStats    = {...state.currentStats};
    state.currentStats = fresh;
    state.mediaUrls    = fresh.mediaUrls || [];

    updateStatsPanel(fresh);
    if (state.activeTab === 'downloads') renderMediaGrid();

    // Save to history
    const autosave = sid('autosave-toggle');
    if (!autosave || autosave.checked) {
      const snap = {
        platform: fresh.platform,
        url:      fresh.url,
        likes:    parseNum(fresh.likes),
        comments: parseNum(fresh.comments),
        shares:   parseNum(fresh.shares),
        reach:    parseNum(fresh.reach),
      };
      state.history.push({...snap, ts: Date.now()});
      chrome.runtime.sendMessage({type:'PUSH_HISTORY', data: snap});
      if (state.activeTab === 'analytics') renderCharts();
    }

    setStatus('Updated ' + ts(), 'ok');
  }

  function parseNum(v) {
    if (!v || v === '—' || v === 'N/A (Photo)') return null;
    const s = String(v).replace(/,/g,'').replace(/[KkMm].*/, '');
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    if (/K|k/.test(String(v))) return Math.round(n*1000);
    if (/M|m/.test(String(v))) return Math.round(n*1000000);
    return Math.round(n);
  }

  // ─────────────────────────────────────────────────────────────
  //  STATS PANEL UPDATE
  // ─────────────────────────────────────────────────────────────
  function updateStatsPanel(d) {
    const set = (id, val, naClass) => {
      const el = sid(id); if(!el) return;
      el.textContent = fmt(val) || '—';
      if (naClass) el.style.color = 'var(--muted)';
      else el.style.color = '';
    };
    set('s-likes',    d.likes);
    set('s-comments', d.comments);
    set('s-shares',   d.shares);
    set('s-reach',    d.reach, d.reachIsNA);

    // Change indicators
    const showChg = (chgId, newVal, oldVal) => {
      const el = sid(chgId); if (!el) return;
      const n = parseNum(newVal), o = parseNum(oldVal);
      if (n == null || o == null) { el.textContent=''; return; }
      const diff = n - o;
      if (diff === 0) { el.textContent=''; return; }
      el.textContent = (diff>0?'▲ +':'▼ ') + Math.abs(diff).toLocaleString();
      el.className = 'spm-stat-change ' + (diff>0?'up':'down');
    };
    showChg('s-likes-chg',    d.likes,    state.lastStats.likes);
    showChg('s-comments-chg', d.comments, state.lastStats.comments);
    showChg('s-shares-chg',   d.shares,   state.lastStats.shares);

    // Reach note
    const note = sid('s-reach-note');
    if (note) note.style.display = d.reachIsNA ? 'block' : 'none';

    // Engagement rate (likes+comments / followers * 100)
    const likes    = parseNum(d.likes)    || 0;
    const comments = parseNum(d.comments) || 0;
    const followers = parseNum(state.profile.followers) || 0;
    if (followers > 0) {
      const rate = ((likes + comments) / followers * 100).toFixed(2);
      const el = sid('s-engage-rate'); if (el) el.textContent = rate + '%';
      const fill = sid('s-engage-fill'); if (fill) fill.style.width = Math.min(100, rate*5) + '%';
    } else {
      const el = sid('s-engage-rate'); if (el) el.textContent = '— (no follower data)';
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  AUTO-MONITOR
  // ─────────────────────────────────────────────────────────────
  function toggleMonitor(on) {
    state.monitorActive = on;
    sid('spm-monitor-indicator').classList.toggle('active', on);
    if (on) {
      startMonitor();
      addMonitorLog('▶ Monitoring started — checking every ' + state.monitorInterval + 's', false);
    } else {
      stopMonitor();
      addMonitorLog('⏹ Monitoring stopped', false);
    }
  }

  function startMonitor() {
    stopMonitor();
    state.monitorTimer = setInterval(doMonitorTick, state.monitorInterval * 1000);
  }

  function stopMonitor() {
    if (state.monitorTimer) { clearInterval(state.monitorTimer); state.monitorTimer = null; }
  }

  function restartMonitorIfActive() {
    if (state.monitorActive) startMonitor();
  }

  function doMonitorTick() {
    const prev = {...state.currentStats};
    scrapeAndUpdate();
    const curr = state.currentStats;

    const likesChg    = (parseNum(curr.likes)    || 0) - (parseNum(prev.likes)    || 0);
    const commentsChg = (parseNum(curr.comments) || 0) - (parseNum(prev.comments) || 0);

    const alerts = [];
    if (Math.abs(likesChg)    >= state.alertThreshold) alerts.push(`Likes ${likesChg>0?'+':''}${likesChg}`);
    if (Math.abs(commentsChg) >= state.alertThreshold) alerts.push(`Comments ${commentsChg>0?'+':''}${commentsChg}`);

    if (alerts.length) {
      const msg = alerts.join(' · ');
      addMonitorLog('🔔 ' + msg, true);
      const notifToggle = sid('notif-toggle');
      if (!notifToggle || notifToggle.checked) {
        chrome.runtime.sendMessage({
          type:  'NOTIFY',
          title: '📊 Post Stats Changed',
          body:  msg + '\n' + (curr.url||location.href).slice(0,60),
        });
      }
    } else {
      addMonitorLog('✓ No changes detected', false);
    }
  }

  function addMonitorLog(msg, isAlert) {
    state.monitorLog.unshift({msg, isAlert, t: ts()});
    state.monitorLog = state.monitorLog.slice(0, 20);
    const log = sid('monitor-log');
    if (!log) return;
    log.innerHTML = state.monitorLog.map(e =>
      `<div class="spm-log-item${e.isAlert?' alert':''}">[${e.t}] ${e.msg}</div>`
    ).join('');
  }

  // ─────────────────────────────────────────────────────────────
  //  COMMENT MANAGER
  // ─────────────────────────────────────────────────────────────
  function loadComments() {
    setStatus('Scraping comments…', 'ok');
    const items = scrapeComments();
    state.comments = items;
    renderCommentList(items);
    sid('comment-count').textContent = `${items.length} comment${items.length!==1?'s':''} found`;
    setStatus(`Loaded ${items.length} comments`, 'ok');
  }

  function scrapeComments() {
    const results = [];
    // Instagram: each comment is an <li> in the dialog UL
    const containers = [
      ...$$('div[role="dialog"] ul > li'),
      ...$$('article ul > li'),
    ];
    const seen = new Set();

    containers.slice(1).forEach(li => {
      const username = ($('a[href*="/"]', li)||{}).innerText?.trim() ||
                       ($('[class*="username"]', li)||{}).innerText?.trim() || '?';
      const allText  = (li.innerText||'').trim();
      // Remove username from start of text
      const text = allText.startsWith(username)
        ? allText.slice(username.length).trim()
        : allText;
      // Skip empty, "Reply", "View replies" etc.
      if (!text || /^(Reply|View replies|Like|[0-9]+\s*Reply)/i.test(text)) return;
      const timeEl = $('time', li);
      const time   = timeEl?.getAttribute('datetime') || timeEl?.innerText || '';
      const likes  = (text.match(/(\d+)\s+likes?/i)||[])[1] || null;
      const key    = username + text.slice(0,30);
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ username, text: text.replace(/\s*\d+\s*likes?\s*Reply\s*$/i,'').trim(), time, likes });
    });

    // Facebook comments
    if (IS_FB && results.length === 0) {
      $$('[data-testid="UFI2Comment/root"], [class*="commentContainer"]').forEach(c => {
        const username = ($('a[href*="facebook.com"]', c)||{}).innerText?.trim() || '?';
        const text     = ($('[dir="auto"]', c)||{}).innerText?.trim() || '';
        const time     = ($('abbr,time', c)||{}).innerText?.trim() || '';
        if (!text) return;
        results.push({username, text, time, likes: null});
      });
    }
    return results;
  }

  function renderCommentList(items) {
    const list = sid('comment-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<div class="spm-empty-state"><div class="spm-empty-icon">💬</div><p>No comments detected on this page</p></div>`;
      return;
    }
    list.innerHTML = items.map(c => `
      <div class="spm-comment-item">
        <div class="spm-comment-header">
          <div class="spm-comment-avatar">${c.username.charAt(0).toUpperCase()}</div>
          <span class="spm-comment-username">@${c.username}</span>
          ${c.time ? `<span class="spm-comment-time">${c.time}</span>` : ''}
        </div>
        <div class="spm-comment-text">${escHtml(c.text)}</div>
        ${c.likes ? `<div class="spm-comment-meta">❤️ ${c.likes} likes</div>` : ''}
      </div>
    `).join('');
  }

  function filterComments(query) {
    const q = query.toLowerCase();
    const filtered = q ? state.comments.filter(c =>
      c.username.toLowerCase().includes(q) || c.text.toLowerCase().includes(q)
    ) : state.comments;
    renderCommentList(filtered);
    sid('comment-count').textContent = `${filtered.length} of ${state.comments.length} shown`;
  }

  function copyComments() {
    if (!state.comments.length) { setStatus('No comments loaded', 'err'); return; }
    const text = state.comments.map(c => `@${c.username}: ${c.text}`).join('\n');
    navigator.clipboard.writeText(text).then(() => setStatus(`Copied ${state.comments.length} comments ✓`, 'ok'));
  }

  function clickLoadMoreComments() {
    // Try clicking "Load more comments" / "View more comments" buttons
    const btn = $$('button, span').find(el =>
      /load more|view more|view all/i.test((el.innerText||'').trim())
    );
    if (btn) {
      btn.click();
      setTimeout(loadComments, 1200);
      setStatus('Loading more comments…', 'ok');
    } else {
      setStatus('No "Load more" button found', 'err');
    }
  }

  function escHtml(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─────────────────────────────────────────────────────────────
  //  PROFILE SCRAPER
  // ─────────────────────────────────────────────────────────────
  function loadProfile() {
    setStatus('Scraping profile…', 'ok');
    const p = IS_FB ? scrapeFBProfile() : scrapeIGProfile();
    state.profile = p;
    renderProfilePanel2(p);
    setStatus('Profile loaded ✓', 'ok');
  }

  function scrapeIGProfile() {
    const p = {};
    // From post page header
    const header = $('header') || $('[class*="header"]');
    if (header) {
      const links = $$('a[href*="/"]', header);
      p.username = links.find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href')))?.innerText?.trim();
      const avatar = $('img[alt*="profile picture"], img[alt*="avatar"]', header) || $('header img');
      if (avatar) p.avatarSrc = avatar.src;
    }
    // From profile page
    $$('span, div').forEach(el => {
      const t = (el.innerText||'').trim();
      const m = t.match(/^([\d,KkMm.]+)\s+(followers?|following|posts?)$/i);
      if (m) {
        const key = m[2].toLowerCase().replace(/s$/,'');
        if (key === 'follower' && !p.followers) p.followers = m[1];
        if (key === 'following' && !p.following) p.following = m[1];
        if (key === 'post' && !p.posts)     p.posts      = m[1];
      }
    });
    // Meta description often has "N Followers, N Following, N Posts"
    const desc = $('meta[name="description"]')?.content || '';
    const mFollowers = desc.match(/([\d,KkMm]+)\s*Followers/i);
    const mFollowing = desc.match(/([\d,KkMm]+)\s*Following/i);
    const mPosts     = desc.match(/([\d,KkMm]+)\s*Posts/i);
    if (mFollowers && !p.followers) p.followers = mFollowers[1];
    if (mFollowing && !p.following) p.following = mFollowing[1];
    if (mPosts     && !p.posts)     p.posts     = mPosts[1];

    // Bio text
    const bioSel = ['meta[property="og:description"]', 'meta[name="description"]'];
    for (const s of bioSel) {
      const m = $(s)?.content;
      if (m && m.length > 10) { p.bio = m.slice(0,200); break; }
    }
    // Page title for name
    const title = document.title;
    const mTitle = title.match(/^(.+?)\s*(?:\(|•|\||-)/);
    if (mTitle) p.name = mTitle[1].trim();
    return p;
  }

  function scrapeFBProfile() {
    const p = {};
    const desc = $('meta[name="description"]')?.content || '';
    const title = document.title;
    const mTitle = title.match(/^(.+?)\s*[-|•]/);
    if (mTitle) p.name = mTitle[1].trim();
    const mFriends = desc.match(/([\d,]+)\s*(friends|followers)/i);
    if (mFriends) p.followers = mFriends[1];
    $$('span,div').forEach(el => {
      const t=(el.innerText||'').trim();
      if (/(followers|people follow)/i.test(t) && /\d/.test(t) && !p.followers)
        p.followers = t.match(/[\d,]+/)?.[0];
    });
    const avatar = $('image[xlink\\:href], img[data-imgperflogname="profileCoverPhoto"]') || $('img[alt*="profile"]');
    if (avatar) p.avatarSrc = avatar.src || avatar.getAttribute('xlink:href');
    return p;
  }

  function renderProfilePanel2(p) {
    const container = sid('profile-content');
    if (!container) return;
    const hasStats = p.followers || p.following || p.posts;
    container.innerHTML = `
      <div class="spm-profile-header">
        ${p.avatarSrc
          ? `<img class="spm-profile-avatar" src="${p.avatarSrc}" alt="avatar"/>`
          : `<div class="spm-profile-avatar-placeholder">👤</div>`}
        <div>
          <div class="spm-profile-name">${escHtml(p.name || p.username || 'Unknown')}</div>
          ${p.username ? `<div class="spm-profile-handle">@${escHtml(p.username)}</div>` : ''}
          ${p.bio ? `<div class="spm-profile-bio">${escHtml(p.bio.slice(0,120))}…</div>` : ''}
        </div>
      </div>
      ${hasStats ? `
      <div class="spm-profile-stats">
        <div class="spm-profile-stat">
          <div class="spm-profile-stat-val">${fmt(p.followers)||'—'}</div>
          <div class="spm-profile-stat-label">Followers</div>
        </div>
        <div class="spm-profile-stat">
          <div class="spm-profile-stat-val">${fmt(p.following)||'—'}</div>
          <div class="spm-profile-stat-label">Following</div>
        </div>
        <div class="spm-profile-stat">
          <div class="spm-profile-stat-val">${fmt(p.posts)||'—'}</div>
          <div class="spm-profile-stat-label">Posts</div>
        </div>
      </div>` : `
      <div class="spm-note">
        For follower counts, visit the profile page directly (e.g. instagram.com/username).
      </div>`}
    `;
  }

  // ─────────────────────────────────────────────────────────────
  //  ANALYTICS — SVG CHARTS
  // ─────────────────────────────────────────────────────────────
  function renderCharts() {
    const history = state.history.filter(h => h.url === location.href || h.url?.startsWith(location.href.split('?')[0]));
    renderLineChart(sid('chart-likes'),    history.map(h=>({x:h.ts, y:h.likes||0})),    'Likes');
    renderLineChart(sid('chart-comments'), history.map(h=>({x:h.ts, y:h.comments||0})), 'Comments');
    renderHistoryTable(history);
  }

  function renderLineChart(container, data, label) {
    if (!container) return;
    data = data.filter(d => d.y != null);
    if (data.length < 2) {
      container.innerHTML = `<div class="spm-chart-empty">📊 Not enough data yet.<br>Refresh stats a few times to build a chart.</div>`;
      return;
    }
    const W = (container.offsetWidth || 320) - 4;
    const H = 140;
    const P = {t:16, r:14, b:28, l:42};
    const cW = W - P.l - P.r;
    const cH = H - P.t - P.b;
    const vals = data.map(d=>d.y);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const xS = i => P.l + (i/(data.length-1||1))*cW;
    const yS = v => P.t + cH - ((v-min)/range)*cH;
    const pts = data.map((d,i)=>`${xS(i)},${yS(d.y)}`).join(' ');
    const areaPts = `${pts} ${xS(data.length-1)},${P.t+cH} ${xS(0)},${P.t+cH}`;
    // Y-axis ticks
    const ticks = [0, .25, .5, .75, 1].map(t => {
      const y = P.t + t*cH, v = Math.round(max - t*range);
      return `<line x1="${P.l}" y1="${y}" x2="${W-P.r}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3" stroke-width="1"/>
              <text x="${P.l-4}" y="${y+4}" text-anchor="end" font-size="9" fill="var(--muted)">${fmt(v)}</text>`;
    }).join('');
    // X-axis labels (show 3 evenly spaced)
    const idxs = data.length===1 ? [0] : [0, Math.floor((data.length-1)/2), data.length-1];
    const xlbls = idxs.map(i =>
      `<text x="${xS(i)}" y="${H-4}" text-anchor="middle" font-size="9" fill="var(--muted)">${new Date(data[i].x).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text>`
    ).join('');
    const dots = data.map((d,i) =>
      `<circle cx="${xS(i)}" cy="${yS(d.y)}" r="3.5" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5"><title>${fmt(d.y)} • ${new Date(d.x).toLocaleString()}</title></circle>`
    ).join('');
    container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
      <defs>
        <linearGradient id="spm-g-${label}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity=".25"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity=".02"/>
        </linearGradient>
      </defs>
      ${ticks}
      <polygon points="${areaPts}" fill="url(#spm-g-${label})"/>
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${xlbls}
    </svg>`;
  }

  function renderHistoryTable(history) {
    const tbody = sid('history-tbody');
    if (!tbody) return;
    if (!history.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px">No history yet</td></tr>`;
      return;
    }
    tbody.innerHTML = [...history].reverse().slice(0,30).map(h => `
      <tr>
        <td>${ago(h.ts)}</td>
        <td>${fmt(h.likes)||'—'}</td>
        <td>${fmt(h.comments)||'—'}</td>
        <td>${fmt(h.shares)||'—'}</td>
      </tr>
    `).join('');
  }

  function clearHistory() {
    if (!confirm('Clear all history?')) return;
    state.history = [];
    chrome.runtime.sendMessage({type:'CLEAR_HISTORY'}, () => {
      renderCharts();
      setStatus('History cleared', 'ok');
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  DOWNLOADS
  // ─────────────────────────────────────────────────────────────
  function renderMediaGrid() {
    const grid = sid('media-grid');
    if (!grid) return;
    const urls = state.mediaUrls;
    if (!urls.length) {
      grid.innerHTML = `<div class="spm-empty-state" style="grid-column:1/-1"><div class="spm-empty-icon">🖼️</div><p>No media detected on this post</p></div>`;
      return;
    }
    grid.innerHTML = urls.map((url, i) => {
      const isVideo = /\.mp4|video/i.test(url);
      return `
        <div class="spm-media-thumb-wrap" data-url="${escHtml(url)}" data-i="${i}">
          ${isVideo
            ? `<div style="width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;font-size:28px">🎬</div>
               <div class="spm-media-badge">MP4</div>`
            : `<img src="${escHtml(url)}" alt="media ${i+1}" loading="lazy" onerror="this.parentElement.style.display='none'"/>`}
          <div class="spm-media-overlay">⬇️</div>
        </div>`;
    }).join('');
    grid.querySelectorAll('.spm-media-thumb-wrap').forEach(el => {
      el.onclick = () => dlOne(el.dataset.url, +el.dataset.i);
    });
  }

  function dlOne(url, idx) {
    const ext = /\.mp4|video/i.test(url) ? 'mp4' : 'jpg';
    const fn  = `${PLATFORM.toLowerCase()}_post_${Date.now()}_${idx}.${ext}`;
    chrome.runtime.sendMessage({type:'DOWNLOAD_MEDIA', url, filename: fn}, res => {
      setStatus(res?.ok ? `Downloading ${fn}…` : ('Error: '+res?.error), res?.ok?'ok':'err');
    });
  }

  function downloadAllMedia() {
    if (!state.mediaUrls.length) { setStatus('No media to download', 'err'); return; }
    const prefix = `${PLATFORM.toLowerCase()}_${Date.now()}`;
    chrome.runtime.sendMessage({type:'BULK_DOWNLOAD', urls: state.mediaUrls, prefix}, res => {
      setStatus(`Downloaded ${res?.count||0} files ✓`, 'ok');
    });
    setStatus(`Queuing ${state.mediaUrls.length} downloads…`, 'ok');
  }

  function bulkDownloadProfile() {
    setStatus('Scanning profile for media…', 'ok');
    const progress = sid('bulk-progress');
    const fill     = sid('bulk-fill');
    const ptext    = sid('bulk-progress-text');
    if (progress) progress.style.display = 'block';

    // Collect all post thumbnail images visible on the profile grid
    const imgs = new Set();
    $$('article img, main img, [role="main"] img').forEach(img => {
      if ((img.naturalWidth || img.width) > 150) imgs.add(img.src);
    });
    // Also video thumbnails
    $$('video[poster]').forEach(v => imgs.add(v.poster));

    const urls = [...imgs].filter(Boolean).slice(0, 100);
    if (!urls.length) { setStatus('No media found on this page', 'err'); if(progress) progress.style.display='none'; return; }

    if (ptext) ptext.textContent = `Found ${urls.length} media files — downloading…`;
    if (fill)  fill.style.width = '30%';

    const prefix = `${PLATFORM.toLowerCase()}_profile_${Date.now()}`;
    chrome.runtime.sendMessage({type:'BULK_DOWNLOAD', urls, prefix}, res => {
      if (fill)  fill.style.width = '100%';
      if (ptext) ptext.textContent = `✅ Downloaded ${res?.count||0} files!`;
      setStatus(`Bulk download: ${res?.count||0} files ✓`, 'ok');
      setTimeout(() => { if(progress) progress.style.display='none'; }, 3000);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  EXPORT
  // ─────────────────────────────────────────────────────────────
  function exportCSV() {
    const rows = [['Time','Platform','URL','Likes','Comments','Shares','Reach']];
    state.history.forEach(h => {
      rows.push([
        new Date(h.ts).toLocaleString(),
        h.platform||PLATFORM.toLowerCase(),
        h.url||location.href,
        h.likes||'',
        h.comments||'',
        h.shares||'',
        h.reach||'',
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadBlob(csv, `spm_export_${Date.now()}.csv`, 'text/csv');
    setStatus('CSV exported ✓', 'ok');
  }

  function exportJSON() {
    chrome.runtime.sendMessage({type:'GET_HISTORY'}, res => {
      const json = JSON.stringify({exported: new Date().toISOString(), history: res.history||[]}, null, 2);
      downloadBlob(json, `spm_data_${Date.now()}.json`, 'application/json');
      setStatus('JSON exported ✓', 'ok');
    });
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], {type: mime});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function clearAllData() {
    if (!confirm('Delete ALL saved data? This cannot be undone.')) return;
    chrome.runtime.sendMessage({type:'CLEAR_HISTORY'}, () => {
      state.history = [];
      state.monitorLog = [];
      setStatus('All data cleared', 'ok');
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  BOOT
  // ─────────────────────────────────────────────────────────────
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

})();
