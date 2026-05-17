/* ============================================================
   ui.js — DevTools-style right sidebar, 6 tabs
   v10 — fixes: debounce losing showLoader arg,
         event listener cleanup on re-init,
         SVG charts guard for <2 data points,
         system dark/light mode change listener,
         scrape button explicit immediate call
   ============================================================ */

'use strict';

(function () {
  const _TAB_IDS = ['stats', 'comments', 'profile', 'analytics', 'downloads', 'settings'];
  let _sidebar   = null;
  let _activeTab = 'stats';
  let _darkMode  = false;
  let _initialized = false;

  // ── Build sidebar DOM ─────────────────────────────────────────
  function _buildSidebar() {
    if (_sidebar) { _sidebar.remove(); _sidebar = null; }

    _sidebar = document.createElement('div');
    _sidebar.id = 'spm-sidebar';
    _sidebar.innerHTML = `
      <div id="spm-header">
        <span id="spm-title">📊 SPM v${SPM.VERSION}</span>
        <span id="spm-status" class="spm-status">Waiting…</span>
        <button id="spm-close" title="Close">✕</button>
      </div>
      <div id="spm-tabs">
        ${_TAB_IDS.map(t => `<button class="spm-tab${t === 'stats' ? ' spm-tab--active' : ''}" data-tab="${t}">${_tabLabel(t)}</button>`).join('')}
      </div>
      <div id="spm-body">
        ${_TAB_IDS.map(t => `<div class="spm-panel" id="spm-panel-${t}" style="display:${t === 'stats' ? 'block' : 'none'}">${_buildPanel(t)}</div>`).join('')}
      </div>
    `;

    document.body.appendChild(_sidebar);
    _attachSidebarEvents();
  }

  function _tabLabel(tab) {
    return { stats: '📈 Stats', comments: '💬 Comments', profile: '👤 Profile',
             analytics: '📊 Analytics', downloads: '⬇ Downloads', settings: '⚙ Settings' }[tab] || tab;
  }

  function _buildPanel(tab) {
    switch (tab) {
      case 'stats':
        return `
          <div class="spm-cards">
            <div class="spm-card" id="spm-card-likes"><span class="spm-card-label">Likes</span><span class="spm-card-val" id="spm-likes">—</span></div>
            <div class="spm-card" id="spm-card-comments"><span class="spm-card-label">Comments</span><span class="spm-card-val" id="spm-comments">—</span></div>
            <div class="spm-card" id="spm-card-shares"><span class="spm-card-label">Shares</span><span class="spm-card-val" id="spm-shares">—</span></div>
            <div class="spm-card" id="spm-card-reach"><span class="spm-card-label">Reach/Views</span><span class="spm-card-val" id="spm-reach">—</span></div>
          </div>
          <div id="spm-engage-bar-wrap">
            <div class="spm-label-row"><span>Engagement</span><span id="spm-engage-pct">—</span></div>
            <div class="spm-bar-track"><div class="spm-bar-fill" id="spm-engage-bar" style="width:0%"></div></div>
            <div id="spm-engage-tier" class="spm-tier"></div>
          </div>
          <div id="spm-viral-wrap">
            <div class="spm-label-row"><span>Viral Score</span><span id="spm-viral-label">—</span></div>
            <div class="spm-viral-ring">
              <svg viewBox="0 0 80 80" width="80" height="80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#e0e0e0" stroke-width="8"/>
                <circle id="spm-viral-arc" cx="40" cy="40" r="34" fill="none" stroke="#f97316"
                  stroke-width="8" stroke-linecap="round" stroke-dasharray="213.6" stroke-dashoffset="213.6"
                  transform="rotate(-90 40 40)"/>
              </svg>
              <span id="spm-viral-score" class="spm-viral-num">0</span>
            </div>
            <div id="spm-viral-signals" class="spm-signals"></div>
          </div>
          <div id="spm-auto-wrap">
            <button id="spm-auto-btn" class="spm-btn">▶ Start Auto Monitor</button>
            <span id="spm-auto-status" class="spm-small"></span>
          </div>
          <button id="spm-scrape-btn" class="spm-btn spm-btn--secondary">🔄 Scrape DOM</button>
        `;

      case 'comments':
        return `
          <div class="spm-row">
            <button id="spm-load-comments" class="spm-btn">Load Comments</button>
            <input id="spm-comment-search" class="spm-input" placeholder="Search…" type="text">
            <button id="spm-copy-comments" class="spm-btn spm-btn--sm">Copy All</button>
          </div>
          <div id="spm-comment-list" class="spm-list"></div>
        `;

      case 'profile':
        return `
          <div id="spm-profile-card" class="spm-profile-card">
            <div class="spm-profile-avatar" id="spm-avatar"></div>
            <div class="spm-profile-info">
              <div id="spm-profile-name" class="spm-profile-name">—</div>
              <div id="spm-profile-username" class="spm-small">—</div>
            </div>
          </div>
          <div class="spm-cards">
            <div class="spm-card"><span class="spm-card-label">Followers</span><span class="spm-card-val" id="spm-p-followers">—</span></div>
            <div class="spm-card"><span class="spm-card-label">Following</span><span class="spm-card-val" id="spm-p-following">—</span></div>
            <div class="spm-card"><span class="spm-card-label">Posts</span><span class="spm-card-val" id="spm-p-posts">—</span></div>
          </div>
          <div id="spm-profile-bio" class="spm-bio"></div>
          <div id="spm-profile-note" class="spm-small spm-muted">Visit the profile page to load follower count.</div>
        `;

      case 'analytics':
        return `
          <div id="spm-charts">
            <div class="spm-chart-title">Likes over time</div>
            <svg id="spm-chart-likes" class="spm-chart" viewBox="0 0 300 80"></svg>
            <div class="spm-chart-title">Comments over time</div>
            <svg id="spm-chart-comments" class="spm-chart" viewBox="0 0 300 80"></svg>
            <div class="spm-chart-title">Engagement rate over time</div>
            <svg id="spm-chart-engage" class="spm-chart" viewBox="0 0 300 80"></svg>
          </div>
          <div id="spm-history-table-wrap">
            <div class="spm-chart-title">History</div>
            <div id="spm-history-table"></div>
          </div>
          <div id="spm-growth-info" class="spm-small"></div>
        `;

      case 'downloads':
        return `
          <div class="spm-row">
            <button id="spm-dl-all" class="spm-btn">⬇ Download All Media</button>
            <button id="spm-dl-profile" class="spm-btn spm-btn--secondary">⬇ Profile Grid</button>
          </div>
          <div id="spm-media-grid" class="spm-media-grid"></div>
        `;

      case 'settings':
        return `
          <div class="spm-setting-row">
            <label>Dark Mode</label>
            <input type="checkbox" id="spm-dark-toggle">
          </div>
          <div class="spm-setting-row">
            <label>Notifications</label>
            <input type="checkbox" id="spm-notif-toggle" checked>
          </div>
          <div class="spm-setting-row">
            <label>Auto-save snapshots</label>
            <input type="checkbox" id="spm-autosave-toggle" checked>
          </div>
          <hr>
          <button id="spm-export-btn" class="spm-btn">📤 Export JSON</button>
          <button id="spm-clear-btn" class="spm-btn spm-btn--danger">🗑 Clear All Data</button>
          <div id="spm-settings-status" class="spm-small spm-muted"></div>
        `;

      default: return '';
    }
  }

  // ── Attach events (all in one place for easy cleanup) ─────────
  // FIX v10: v9 added listeners inline during build, meaning re-initializing
  // the sidebar would stack duplicate listeners (memory leak + double-firing).
  // Now all listeners are attached once after build.
  function _attachSidebarEvents() {
    _q('#spm-close')?.addEventListener('click', _toggleSidebar);

    // Tab switching
    _sidebar.querySelectorAll('.spm-tab').forEach(btn => {
      btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
    });

    // Stats tab
    _q('#spm-auto-btn')?.addEventListener('click', _toggleAutoMonitor);
    // FIX v10: scrape button calls _scrape directly (not debounced version)
    // so the loader always shows immediately on click.
    _q('#spm-scrape-btn')?.addEventListener('click', () => _scrapeAndUpdate(true));

    // Comments tab
    _q('#spm-load-comments')?.addEventListener('click', _loadComments);
    _q('#spm-comment-search')?.addEventListener('input', spmDebounce(_filterComments, 200));
    _q('#spm-copy-comments')?.addEventListener('click', _copyComments);

    // Downloads tab
    _q('#spm-dl-all')?.addEventListener('click', _downloadAllMedia);
    _q('#spm-dl-profile')?.addEventListener('click', _downloadProfileGrid);

    // Settings tab
    _q('#spm-dark-toggle')?.addEventListener('change', e => _setDarkMode(e.target.checked));
    _q('#spm-clear-btn')?.addEventListener('click', _clearData);
    _q('#spm-export-btn')?.addEventListener('click', _exportData);
  }

  // ── Tab switching ─────────────────────────────────────────────
  function _switchTab(tabId) {
    if (!_TAB_IDS.includes(tabId)) return;
    _activeTab = tabId;
    _sidebar.querySelectorAll('.spm-tab').forEach(b => {
      b.classList.toggle('spm-tab--active', b.dataset.tab === tabId);
    });
    _TAB_IDS.forEach(t => {
      const panel = _q(`#spm-panel-${t}`);
      if (panel) panel.style.display = t === tabId ? 'block' : 'none';
    });
  }

  // ── Scrape (immediate, not debounced, fixes showLoader issue) ─
  // FIX v10: was wrapped in spmDebounce() — debouncing meant the showLoader
  // param from the final call was used, but rapid clicks would lose it.
  // Now _scrapeAndUpdate is immediate; the debounced version is only used
  // for auto-refresh (not user-triggered).
  async function _scrapeAndUpdate(showLoader = false) {
    if (showLoader) _setStatus('Scraping…');
    const fresh = SpmExtractor.stats();
    if (!fresh) { _setStatus('No data yet'); return; }
    _updateStatsUI(fresh, null);
    const stored = await SpmStorage.getPostHistory(fresh.postId);
    const report = SpmAnalytics.buildReport(fresh, stored?.history || [], SpmExtractor.profile(), []);
    _updateEngageBar(report.engagement);
    _updateViralCard(report.viral);
    _updateAnalyticsTab(report);
    _setStatus('Done');
  }

  // Debounced version only for auto-triggers
  const _scrapeDebounced = spmDebounce(() => _scrapeAndUpdate(false), 300);

  // ── Monitor event listeners ───────────────────────────────────
  function _attachMonitorListeners() {
    SpmMonitor.on('apiData', ({ postData, report }) => {
      if (!postData) return;
      _updateStatsUI(postData, report);
      if (report?.viral)      _updateViralCard(report.viral);
      if (report?.engagement) _updateEngageBar(report.engagement);
      _updateProfileTab(SpmExtractor.profile());
      _updateMediaGrid(postData.mediaUrls);
      _updateAnalyticsTab(report);
      _setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    });

    SpmMonitor.on('navigate', () => {
      _setStatus('Navigated — waiting for data…');
      _resetStatCards();
    });

    SpmMonitor.on('stateChange', ({ active }) => {
      const btn = _q('#spm-auto-btn');
      const st  = _q('#spm-auto-status');
      if (btn) btn.textContent = active ? '⏹ Stop Auto Monitor' : '▶ Start Auto Monitor';
      if (st)  st.textContent  = active ? 'Monitoring active' : '';
    });

    SpmMonitor.on('alert', entry => {
      _setStatus(`⚠ ${entry.type}: +${spmFmt(entry.delta)}`);
    });
  }

  // ── UI update helpers ─────────────────────────────────────────
  function _updateStatsUI(post, report) {
    _setText('#spm-likes',    spmFmt(post.likes));
    _setText('#spm-comments', spmFmt(post.comments));
    _setText('#spm-shares',   post.shares != null ? spmFmt(post.shares) : '—');
    _setText('#spm-reach',    post.isVideo && post.reach != null ? spmFmt(post.reach) : (post.isVideo ? '—' : 'N/A'));
  }

  function _updateEngageBar(engagement) {
    if (!engagement) return;
    const pct  = engagement.rate != null ? Math.min(100, engagement.rate * 1000) : 0;
    const bar  = _q('#spm-engage-bar');
    const pctEl = _q('#spm-engage-pct');
    const tierEl = _q('#spm-engage-tier');
    if (bar)   bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = engagement.ratePercent;
    if (tierEl) {
      tierEl.textContent = engagement.label;
      tierEl.className = `spm-tier spm-tier--${engagement.tier}`;
    }
  }

  function _updateViralCard(viral) {
    if (!viral) return;
    const arc   = _q('#spm-viral-arc');
    const score = _q('#spm-viral-score');
    const label = _q('#spm-viral-label');
    const sigs  = _q('#spm-viral-signals');
    const circumference = 213.6;
    if (arc)   arc.style.strokeDashoffset = String(circumference - (viral.score / 100) * circumference);
    if (score) score.textContent = String(viral.score);
    if (label) label.textContent = viral.label;
    if (sigs)  sigs.innerHTML = (viral.signals || []).map(s => `<span class="spm-signal">${spmEsc(s)}</span>`).join('');
  }

  // ── Analytics tab with SVG charts ────────────────────────────
  // FIX v10: v9 had no guard for <2 data points → empty path / NaN coords
  function _updateAnalyticsTab(report) {
    if (!report) return;

    _renderChart('#spm-chart-likes', report.history, 'likes');
    _renderChart('#spm-chart-comments', report.history, 'comments');
    _renderChart('#spm-chart-engage', report.history, 'engagement');

    const growthEl = _q('#spm-growth-info');
    if (growthEl && report.growth) {
      const g = report.growth;
      growthEl.textContent = g.avgLikesPerHour != null
        ? `Avg growth: ${spmFmt(g.avgLikesPerHour)}/hr · Trend: ${g.trend}`
        : 'Not enough data for growth rate.';
    }

    // History table
    const tableEl = _q('#spm-history-table');
    if (tableEl && report.history?.length) {
      tableEl.innerHTML = `
        <table class="spm-table">
          <thead><tr><th>Time</th><th>Likes</th><th>Comments</th><th>Engagement</th></tr></thead>
          <tbody>${report.history.slice(-20).reverse().map(h => `
            <tr>
              <td>${h.ts ? new Date(h.ts).toLocaleTimeString() : '—'}</td>
              <td>${spmFmt(h.likes)}</td>
              <td>${spmFmt(h.comments)}</td>
              <td>${h.engagement != null ? (h.engagement * 100).toFixed(2) + '%' : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`;
    } else if (tableEl) {
      tableEl.innerHTML = '<div class="spm-muted">No history yet — refresh a few times.</div>';
    }
  }

  // SVG line chart — FIX v10: guard for 0 or 1 points
  function _renderChart(selector, history, field) {
    const svg = _q(selector);
    if (!svg) return;

    const points = (history || []).filter(h => h[field] != null).slice(-30);

    // FIX: need at least 2 points to draw a line
    if (points.length < 2) {
      svg.innerHTML = '<text x="10" y="40" class="spm-chart-empty">Not enough data</text>';
      return;
    }

    const vals = points.map(p => p[field]);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1; // FIX: prevent divide-by-zero when all values are equal

    const W = 300, H = 80, PAD = 8;
    const toX = i => PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const toY = v => H - PAD - ((v - minV) / range) * (H - PAD * 2);

    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p[field]).toFixed(1)}`).join(' ');

    svg.innerHTML = `
      <path d="${spmEsc(d)}" fill="none" stroke="var(--spm-accent)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${toX(points.length - 1).toFixed(1)}" cy="${toY(vals[vals.length - 1]).toFixed(1)}" r="3" fill="var(--spm-accent)"/>
    `;
  }

  // ── Profile tab ───────────────────────────────────────────────
  function _updateProfileTab(profile) {
    if (!profile) return;
    _setText('#spm-profile-name',     profile.fullName || profile.username || '—');
    _setText('#spm-profile-username', profile.username ? '@' + profile.username : '—');
    _setText('#spm-p-followers',      spmFmt(profile.followers));
    _setText('#spm-p-following',      spmFmt(profile.following));
    _setText('#spm-p-posts',          spmFmt(profile.posts));
    const bioEl = _q('#spm-profile-bio');
    if (bioEl) bioEl.textContent = profile.bio || '';
    const avatarEl = _q('#spm-avatar');
    if (avatarEl && profile.avatar && spmValidateUrl(profile.avatar)) {
      avatarEl.style.backgroundImage = `url(${profile.avatar})`;
    }
  }

  // ── Media grid ────────────────────────────────────────────────
  function _updateMediaGrid(urls) {
    const grid = _q('#spm-media-grid');
    if (!grid || !urls?.length) return;
    grid.innerHTML = urls.map(u => `
      <div class="spm-media-item">
        <img src="${spmEsc(u)}" class="spm-media-thumb" loading="lazy" onerror="this.style.display='none'">
        <button class="spm-dl-one spm-btn spm-btn--sm" data-url="${spmEsc(u)}">⬇</button>
      </div>`).join('');
    grid.querySelectorAll('.spm-dl-one').forEach(btn => {
      btn.addEventListener('click', () => spmSend({ type: 'DOWNLOAD_MEDIA', url: btn.dataset.url }));
    });
  }

  // ── Comments tab ──────────────────────────────────────────────
  let _allComments = [];
  function _loadComments() {
    const post = SpmExtractor.getLatestPost();
    _allComments = post ? SpmExtractor.getComments(post.postId) : [];
    _renderComments(_allComments);
  }

  function _renderComments(list) {
    const el = _q('#spm-comment-list');
    if (!el) return;
    if (!list?.length) { el.innerHTML = '<div class="spm-muted">No comments found.</div>'; return; }
    el.innerHTML = list.map(c => `
      <div class="spm-comment">
        <span class="spm-comment-user">${spmEsc(c.username)}</span>
        <span class="spm-comment-text">${spmEsc(c.text)}</span>
      </div>`).join('');
  }

  function _filterComments() {
    const q = (_q('#spm-comment-search')?.value || '').toLowerCase();
    _renderComments(q ? _allComments.filter(c => c.text?.toLowerCase().includes(q)) : _allComments);
  }

  function _copyComments() {
    const text = _allComments.map(c => `${c.username}: ${c.text}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // ── Downloads ─────────────────────────────────────────────────
  async function _downloadAllMedia() {
    const post = SpmExtractor.getLatestPost();
    if (!post?.mediaUrls?.length) return;
    await spmSend({ type: 'BULK_DOWNLOAD', urls: post.mediaUrls });
  }

  async function _downloadProfileGrid() {
    const urls = SpmExtractor.profileGridMedia();
    if (!urls.length) return;
    await spmSend({ type: 'BULK_DOWNLOAD', urls });
  }

  // ── Settings ──────────────────────────────────────────────────
  async function _clearData() {
    await SpmStorage.clearAll();
    await spmSend({ type: 'CLEAR_HISTORY' });
    _setText('#spm-settings-status', 'All data cleared.');
    setTimeout(() => _setText('#spm-settings-status', ''), 2000);
  }

  async function _exportData() {
    const history = await SpmStorage.getAllHistory();
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `spm-export-${Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Dark mode ─────────────────────────────────────────────────
  function _setDarkMode(on) {
    _darkMode = on;
    _sidebar?.classList.toggle('spm-dark', on);
    const toggle = _q('#spm-dark-toggle');
    if (toggle) toggle.checked = on;
  }

  // FIX v10: listen to system theme changes
  function _attachSystemThemeListener() {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', e => {
      // Only auto-switch if user hasn't manually set a preference
      const stored = localStorage.getItem('spm-dark-mode');
      if (stored === null) _setDarkMode(e.matches);
    });
    // Init from system
    if (localStorage.getItem('spm-dark-mode') === null) {
      _setDarkMode(mq.matches);
    }
  }

  // ── Auto-monitor toggle ───────────────────────────────────────
  let _autoActive = false;
  function _toggleAutoMonitor() {
    _autoActive ? SpmMonitor.stopAutoMonitor() : SpmMonitor.startAutoMonitor({ interval: 30_000, threshold: 5 });
    _autoActive = !_autoActive;
  }

  // ── Toggle sidebar visibility ─────────────────────────────────
  function _toggleSidebar() {
    if (!_sidebar) return;
    _sidebar.classList.toggle('spm-hidden');
  }

  // ── Reset stat cards on navigation ───────────────────────────
  function _resetStatCards() {
    ['#spm-likes', '#spm-comments', '#spm-shares', '#spm-reach'].forEach(s => _setText(s, '—'));
    const bar = _q('#spm-engage-bar');
    if (bar) bar.style.width = '0%';
    const arc = _q('#spm-viral-arc');
    if (arc) arc.style.strokeDashoffset = '213.6';
  }

  // ── Floating button ───────────────────────────────────────────
  function _buildToggleButton() {
    const existing = document.getElementById('spm-toggle-btn');
    if (existing) existing.remove();
    const btn = document.createElement('button');
    btn.id = 'spm-toggle-btn';
    btn.textContent = '📊';
    btn.title = 'Social Post Monitor';
    btn.addEventListener('click', _toggleSidebar);
    document.body.appendChild(btn);
  }

  // ── Helpers ───────────────────────────────────────────────────
  function _q(sel) { return _sidebar?.querySelector(sel) || document.querySelector(sel); }
  function _setText(sel, val) { const el = _q(sel); if (el) el.textContent = val ?? '—'; }
  function _setStatus(msg) { _setText('#spm-status', msg); }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    if (_initialized) {
      // FIX v10: destroy cleans up old listeners before re-init
      SpmMonitor.destroy?.();
    }
    _initialized = true;

    _buildSidebar();
    _buildToggleButton();
    _attachMonitorListeners();
    _attachSystemThemeListener(); // FIX v10: new
    SpmMonitor.init();

    spmLog('UI initialized');
  }

  // Auto-start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
