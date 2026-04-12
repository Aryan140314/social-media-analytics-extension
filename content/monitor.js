/**
 * SPM Pro v5 · content/monitor.js
 *
 * Integration layer — connects the 4 modules into a pipeline:
 *
 *  [network] → interceptor.js (MAIN world)
 *           → postMessage IG_API_RESPONSE
 *           → monitor.js (ISOLATED world) [here]
 *           → SpmExtractor.extractPostData()
 *           → SpmAnalytics.computeEngagement / detectViral
 *           → PUSH_HISTORY to background.js
 *           → emit events → ui.js
 *
 * Also handles:
 *  • SPA navigation (MutationObserver + polling)
 *  • DOM content change detection (debounced MutationObserver)
 *  • Periodic auto-monitor with change alerts
 */
'use strict';

const SpmMonitor = (() => {

  // ── State ─────────────────────────────────────────────────
  let _monitorTimer        = null;
  let _monitorActive       = false;
  let _monitorInterval     = 60;    // seconds
  let _alertThreshold      = 1;     // min absolute change for alert
  let _lastStats           = {};
  let _log                 = [];    // bounded event log
  let _navObserver         = null;
  let _domObserver         = null;
  let _lastUrl             = location.href;
  let _interceptorInjected = false;

  // ── History (per-page, capped) ────────────────────────────
  const _localHistory = [];

  // ── Event bus ─────────────────────────────────────────────
  const _bus = {};
  function _on(ev, fn)  { (_bus[ev] = _bus[ev] ?? []).push(fn); }
  function _emit(ev, d) { (_bus[ev] ?? []).forEach(fn => { try { fn(d); } catch(e) { spmLog.error('EventBus', ev, e); } }); }

  // ── Dedup for PUSH_HISTORY (avoid writing duplicates) ─────
  const _histDedup = SpmDedup(500);

  // ════════════════════════════════════════════════════════
  //  STEP 1 — Inject interceptor.js into MAIN world
  // ════════════════════════════════════════════════════════
  function _injectInterceptor() {
    if (_interceptorInjected) return;
    try {
      const s    = document.createElement('script');
      s.src      = chrome.runtime.getURL('content/interceptor.js');
      s.onload   = function () { this.remove(); spmLog.info('Interceptor injected ✓'); };
      s.onerror  = function () { spmLog.warn('Interceptor injection failed — DOM fallback only'); this.remove(); };
      (document.head ?? document.documentElement).appendChild(s);
      _interceptorInjected = true;
    } catch (e) { spmLog.error('_injectInterceptor:', e); }
  }

  // ════════════════════════════════════════════════════════
  //  STEP 2 — Listen for IG_API_RESPONSE postMessages
  // ════════════════════════════════════════════════════════
  function _startApiListener() {
    window.addEventListener('message', async function (event) {
      // Security: same-origin only
      if (event.origin && event.origin !== location.origin) return;
      if (event.data?.type !== 'IG_API_RESPONSE') return;

      const payload = event.data?.payload;
      if (!payload || typeof payload !== 'object') return;

      spmLog.debug('postMessage received, keys:', Object.keys(payload));

      try {
        // ── STEP 3: Extract via extractor.js ───────────────
        const postData = SpmExtractor.extractPostData(payload);
        if (!postData) return; // not a post-containing response

        spmLog.info('Pipeline: post extracted', { id: postData.postId, likes: postData.likes });

        // ── STEP 4: Run analytics ──────────────────────────
        const profile  = SpmExtractor.profile();
        const comments = SpmExtractor.comments(postData.postId);
        const report   = SpmAnalytics.buildReport(postData, _localHistory, profile, comments);

        spmLog.info('Pipeline: analytics', {
          engageRate: report.engagement.ratePercent,
          viral:      report.viral.label,
        });

        // ── STEP 5: Store in local history (bounded) ───────
        const snap = _buildSnapshot(postData, report);
        spmBoundedPush(_localHistory, snap, SPM.MAX_HISTORY);

        // ── STEP 6: Persist to background (deduped) ────────
        await _pushHistory(snap);

        // ── STEP 7: Notify UI layer ────────────────────────
        _emit('apiData',   { postData, report });
        _emit('stats',     postData);

        // ── STEP 8: Check auto-monitor alerts ─────────────
        if (_monitorActive) _checkAlerts(postData);

      } catch (e) {
        spmLog.error('Pipeline error:', e);
      }
    });
    spmLog.info('API listener active ✓');
  }

  // ── Build normalised snapshot for history storage ─────────
  function _buildSnapshot(postData, report) {
    return {
      postId:      postData.postId     ?? '',
      platform:    postData.platform   ?? SPM.PLATFORM,
      url:         postData.url        ?? location.href,
      username:    postData.username   ?? '',
      likes:       postData.likes      ?? null,   // already integers
      comments:    postData.comments   ?? null,
      shares:      postData.shares     ?? null,
      reach:       postData.reach      ?? null,
      followers:   report.stats.followers ?? null,
      caption:     (postData.caption   ?? '').slice(0, 200),
      hashtags:    postData.hashtags   ?? [],
      mentions:    postData.mentions   ?? [],
      mediaUrl:    postData.mediaUrl   ?? '',
      isVideo:     postData.isVideo    ?? false,
      ts:          Date.now(),
      postedAt:    postData.ts         ?? null,
      source:      postData.source     ?? 'api',
      engageRate:  report.engagement.ratePercent ?? null,
      viralScore:  report.viral.score   ?? null,
      viralLabel:  report.viral.label   ?? null,
    };
  }

  // ── Push snapshot to background service worker ────────────
  async function _pushHistory(snap) {
    const key = (snap.postId || snap.url) + ':' + snap.likes + ':' + snap.comments;
    if (!_histDedup.isNew(key)) { spmLog.debug('PUSH_HISTORY: dedup skip', key); return; }
    const res = await spmSend({ type: 'PUSH_HISTORY', data: snap });
    if (res?.ok) spmLog.info('PUSH_HISTORY OK — likes:', snap.likes, 'engage:', snap.engageRate);
    else          spmLog.warn('PUSH_HISTORY failed:', res);
  }

  // ════════════════════════════════════════════════════════
  //  SPA NAVIGATION — MutationObserver + polling
  // ════════════════════════════════════════════════════════
  function _startNavWatcher() {
    if (_navObserver) return;

    const _handle = spmDebounce(() => {
      if (location.href === _lastUrl) return;
      const from = _lastUrl;
      _lastUrl   = location.href;
      _lastStats = {};
      SpmExtractor.resetCache();
      spmClearElCache();
      spmLog.info('Navigation:', from.split('/').pop(), '→', _lastUrl.split('/').pop());
      _emit('navigate', { from, to: _lastUrl });
    }, 600);

    _navObserver = new MutationObserver(_handle);
    _navObserver.observe(document.body, { childList: true, subtree: true });
    // Polling fallback for pushState / hash changes
    setInterval(() => { if (location.href !== _lastUrl) _handle(); }, 1500);
  }

  // ════════════════════════════════════════════════════════
  //  DOM CONTENT WATCHER — re-scrape on lazy-loaded updates
  // ════════════════════════════════════════════════════════
  function _startDomWatcher(onContentChange) {
    if (_domObserver) _domObserver.disconnect();
    const debounced = spmDebounce(onContentChange, 1200);
    _domObserver    = new MutationObserver(debounced);
    const root      = document.querySelector('article, [role="main"]') ?? document.body;
    _domObserver.observe(root, { childList: true, subtree: true, characterData: true });
  }

  // ════════════════════════════════════════════════════════
  //  AUTO-MONITOR — periodic tick with change detection
  // ════════════════════════════════════════════════════════
  async function _tick() {
    try {
      const fresh = SpmExtractor.stats();
      _checkAlerts(fresh);
      _lastStats = fresh;
      _emit('tick', { fresh, prev: _lastStats });
    } catch (e) { spmLog.error('Monitor tick:', e); }
  }

  function _checkAlerts(fresh) {
    const alerts = [];
    const _chk = (key, label) => {
      const n = fresh[key], o = _lastStats[key];
      if (n == null || o == null) return;
      const diff = n - o;
      if (Math.abs(diff) >= _alertThreshold) alerts.push({ key, label, diff, from: o, to: n });
    };
    _chk('likes',    'Likes');
    _chk('comments', 'Comments');
    _chk('shares',   'Shares');
    if (!alerts.length) return;

    const msg   = alerts.map(a => `${a.label}: ${a.diff > 0 ? '+' : ''}${a.diff.toLocaleString()}`).join(' · ');
    const entry = { ts: Date.now(), alerts, isAlert: true, msg };
    spmBoundedPush(_log, entry, SPM.MAX_LOG);
    _emit('alert', entry);
    spmSend({ type: 'NOTIFY', title: '📊 Stats Changed', body: msg });
    spmLog.info('Alert:', msg);
  }

  // ════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════
  function init(onContentChange) {
    _injectInterceptor();
    _startApiListener();
    _startNavWatcher();
    if (typeof onContentChange === 'function') _startDomWatcher(onContentChange);
    spmLog.info('SpmMonitor v5 init ✓');
  }

  function startAutoMonitor(opts = {}) {
    if (opts.interval)  _monitorInterval = Math.max(10, +opts.interval);
    if (opts.threshold) _alertThreshold  = Math.max(1,  +opts.threshold);
    stopAutoMonitor();
    _monitorActive = true;
    _tick();
    _monitorTimer  = setInterval(_tick, _monitorInterval * 1000);
    _emit('stateChange', { active: true });
    spmLog.info(`Auto-monitor: every ${_monitorInterval}s, threshold ${_alertThreshold}`);
  }

  function stopAutoMonitor() {
    if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
    _monitorActive = false;
    _emit('stateChange', { active: false });
  }

  function getHistory()    { return [..._localHistory]; }
  function getReport()     {
    const p = SpmExtractor.getLatestPost();
    if (!p) return null;
    return SpmAnalytics.buildReport(p, _localHistory, SpmExtractor.profile(), SpmExtractor.comments(p.postId));
  }

  function on(ev, fn)       { _on(ev, fn); }
  function isActive()       { return _monitorActive; }
  function getLog()         { return [..._log]; }
  function clearLog()       { _log = []; }
  function setLastStats(s)  { _lastStats = s; }
  function setInterval_(s)  { _monitorInterval = Math.max(10, +s||60); if (_monitorActive) startAutoMonitor(); }
  function setThreshold(n)  { _alertThreshold  = Math.max(1,  +n||1); }

  return {
    init,
    startAutoMonitor,
    stopAutoMonitor,
    getHistory,
    getReport,
    on,
    isActive,
    getLog, clearLog,
    setLastStats,
    setInterval:    setInterval_,
    setThreshold,
  };

})();
