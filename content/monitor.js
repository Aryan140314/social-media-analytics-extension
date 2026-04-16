/**
 * SPM Pro v9 · content/monitor.js
 *
 * Wires the full pipeline:
 *   interceptor.js  →  postMessage  →  [here]
 *   →  SpmExtractor  →  SpmAnalytics  →  UI events + storage
 *
 * Requirements addressed:
 *  R1  – Injects interceptor.js via chrome.runtime.getURL
 *  R2  – Listens with window.addEventListener (NOT chrome.runtime)
 *  R2  – Validates event.source === window  AND  event.data.type
 *  R7  – Every pipeline stage in its own try/catch
 *  R8  – DEBUG logging at each stage
 *  Race condition: listener attached BEFORE script tag is appended
 */
'use strict';

const SpmMonitor = (() => {

  /* ─── Config ─────────────────────────────────────────────── */
  const DEBUG = true;
  const log = {
    info : (...a) => DEBUG && console.info ('[SPM:monitor]', ...a),
    warn : (...a) =>           console.warn ('[SPM:monitor]', ...a),
    error: (...a) =>           console.error('[SPM:monitor]', ...a),
    pipe : (...a) => DEBUG && console.info ('%c[SPM:pipe]', 'color:#27ae60;font-weight:700', ...a),
  };

  /* ─── State ──────────────────────────────────────────────── */
  let _injected          = false;
  let _listenerAttached  = false;
  let _monitorTimer      = null;
  let _monitorActive     = false;
  let _monitorInterval   = 60;     // seconds
  let _alertThreshold    = 1;
  let _lastStats         = {};
  let _lastUrl           = location.href;
  const _log             = [];     // monitor event log (bounded)
  const _localHistory    = [];     // in-memory history for current session
  const _pushDedup       = SpmDedup(500);

  /* ─── Event bus (internal only) ─────────────────────────── */
  const _bus = {};
  function _on(ev, fn)  { (_bus[ev] = _bus[ev] ?? []).push(fn); }
  function _emit(ev, d) {
    (_bus[ev] ?? []).forEach(fn => {
      try { fn(d); } catch (e) { log.error(`EventBus "${ev}":`, e.message); }
    });
  }

  /* ═══════════════════════════════════════════════════════════
   * STEP 1 — Inject interceptor.js into the MAIN world
   *
   * Race-condition fix: _attachListener() is called BEFORE the
   * script tag is added to the DOM, so no message can arrive
   * before the listener is ready.
   * ═══════════════════════════════════════════════════════════ */
  function _inject() {
    if (_injected) return;

    _attachListener();        // ← listener first, injection second

    try {
      const s    = document.createElement('script');
      s.src      = chrome.runtime.getURL('content/interceptor.js');
      s.onload   = function () { this.remove(); log.info('Interceptor loaded ✓'); };
      s.onerror  = function () { this.remove(); log.warn('Interceptor load failed — DOM mode only'); };
      (document.head ?? document.documentElement).appendChild(s);
      _injected = true;
      log.info('Interceptor script tag appended');
    } catch (e) {
      log.error('_inject:', e.message);
    }
  }

  /* ═══════════════════════════════════════════════════════════
   * STEP 2 — window.postMessage listener
   *
   * R2 — uses window.addEventListener (NOT chrome.runtime)
   * R2 — validates event.source === window
   * R2 — checks event.data.type === "IG_API_RESPONSE"
   * ═══════════════════════════════════════════════════════════ */
  function _attachListener() {
    if (_listenerAttached) return;
    _listenerAttached = true;

    window.addEventListener('message', function onMessage(event) {
      // R2 — reject messages from other frames / extensions
      if (event.source !== window) return;

      // R2 — only process our own message type
      if (!event.data || event.data.type !== 'IG_API_RESPONSE') return;

      const payload = event.data.payload;
      if (!payload || typeof payload !== 'object') {
        log.warn('Message received with missing/invalid payload');
        return;
      }

      log.pipe('postMessage received — payload keys:', Object.keys(payload).slice(0, 6));

      // Run pipeline asynchronously — never block the message handler
      _runPipeline(payload).catch(e => log.error('Pipeline top-level:', e.message));
    });

    log.info('postMessage listener attached ✓');
  }

  /* ═══════════════════════════════════════════════════════════
   * STEP 3 — Full pipeline  (R7: each stage isolated)
   * ═══════════════════════════════════════════════════════════ */
  async function _runPipeline(payload) {

    /* Stage A — Extract ─────────────────────────────────── */
    let postData = null;
    try {
      postData = SpmExtractor.extractPostData(payload);
      log.pipe('A:extract —', postData ? `postId=${postData.postId?.slice(0,14)} likes=${postData.likes}` : 'null (not a post payload)');
    } catch (e) {
      log.error('A:extract:', e.message);
      return;                              // can't continue without post data
    }

    if (!postData) return;                 // valid but not a post — skip silently

    /* Stage B — Analytics ───────────────────────────────── */
    let report = null;
    try {
      report = SpmAnalytics.buildReport(
        postData,
        _localHistory,
        SpmExtractor.getLatestProfile() ?? {},
        SpmExtractor.getComments(postData.postId) ?? []
      );
      log.pipe('B:analytics — engage:', report.engagement.ratePercent, 'viral:', report.viral.label);
    } catch (e) {
      log.error('B:analytics:', e.message);
      // analytics failure must not block saving or UI update
    }

    /* Stage C — Snapshot ────────────────────────────────── */
    let snap = null;
    try {
      snap = _buildSnap(postData, report);
      spmBoundedPush(_localHistory, snap, SPM.MAX_HISTORY);
      log.pipe('C:snapshot built');
    } catch (e) {
      log.error('C:snapshot:', e.message);
      return;
    }

    /* Stage D — Persist ─────────────────────────────────── */
    try {
      await SpmStorage.saveSnapshot(snap);
      log.pipe('D:storage saved ✓');
    } catch (e) {
      log.error('D:storage:', e.message);
      // don't return — UI should still update
    }

    /* Stage E — Background push ─────────────────────────── */
    try {
      const key = `${snap.postId}:${snap.likes}:${snap.comments}`;
      if (_pushDedup.isNew(key)) {
        const res = await spmSend({ type: 'PUSH_HISTORY', data: snap });
        log.pipe('E:background push —', res?.ok ? 'OK' : 'no-ok response');
      }
    } catch (e) {
      log.error('E:bg push:', e.message);
    }

    /* Stage F — Notify UI ───────────────────────────────── */
    try {
      _emit('apiData', { postData, report });
      if (_monitorActive) _checkAlerts(postData);
      log.pipe('F:UI notified ✓');
    } catch (e) {
      log.error('F:ui emit:', e.message);
    }
  }

  /* ─── Snapshot builder ───────────────────────────────────── */
  function _buildSnap(postData, report) {
    return {
      postId:     postData.postId      ?? `url_${Date.now()}`,
      platform:   postData.platform    ?? SPM.PLATFORM,
      url:        postData.url         ?? location.href,
      username:   postData.username    ?? '',
      likes:      postData.likes       ?? null,
      comments:   postData.comments    ?? null,
      shares:     postData.shares      ?? null,
      reach:      postData.reach       ?? null,
      followers:  report?.stats?.followers ?? null,
      caption:    (postData.caption    ?? '').slice(0, 200),
      hashtags:   postData.hashtags    ?? [],
      mentions:   postData.mentions    ?? [],
      mediaUrl:   postData.mediaUrl    ?? '',
      isVideo:    postData.isVideo     ?? false,
      ts:         Date.now(),
      postedAt:   postData.ts          ?? null,
      source:     postData.source      ?? 'api',
      engageRate: report?.engagement?.ratePercent ?? null,
      viralScore: report?.viral?.score            ?? null,
      viralLabel: report?.viral?.label            ?? null,
    };
  }

  /* ─── SPA navigation watcher ─────────────────────────────── */
  function _watchNavigation() {
    const handle = spmDebounce(() => {
      if (location.href === _lastUrl) return;
      const prev = _lastUrl;
      _lastUrl   = location.href;
      _lastStats = {};
      try { SpmExtractor.resetCache(); } catch {}
      spmClearElCache();
      log.info('Navigate →', _lastUrl.slice(-50));
      _emit('navigate', { from: prev, to: _lastUrl });
    }, 600);

    try { new MutationObserver(handle).observe(document.body, { childList:true, subtree:true }); }
    catch (e) { log.error('MutationObserver:', e.message); }
    setInterval(() => { if (location.href !== _lastUrl) handle(); }, 1500);
  }

  function _watchContent(cb) {
    try {
      const target = document.querySelector('article,[role="main"]') ?? document.body;
      new MutationObserver(spmDebounce(cb, 1200))
        .observe(target, { childList:true, subtree:true, characterData:true });
    } catch (e) { log.error('Content observer:', e.message); }
  }

  /* ─── Auto-monitor ───────────────────────────────────────── */
  function _checkAlerts(fresh) {
    if (!fresh) return;
    const alerts = [];
    const chk = (k, label) => {
      const n = fresh[k], o = _lastStats[k];
      if (typeof n !== 'number' || typeof o !== 'number') return;
      const d = n - o;
      if (Math.abs(d) >= _alertThreshold) alerts.push({ key:k, label, diff:d });
    };
    chk('likes', 'Likes'); chk('comments', 'Comments'); chk('shares', 'Shares');
    if (!alerts.length) return;

    const msg   = alerts.map(a => `${a.label}: ${a.diff > 0 ? '+' : ''}${a.diff.toLocaleString()}`).join(' · ');
    const entry = { ts:Date.now(), isAlert:true, msg, alerts };
    spmBoundedPush(_log, entry, SPM.MAX_LOG);
    _emit('alert', entry);
    spmSend({ type:'NOTIFY', title:'📊 Stats Changed', body:msg }).catch(() => {});
  }

  async function _tick() {
    try {
      const fresh = SpmExtractor.stats();
      if (fresh) { _checkAlerts(fresh); _lastStats = fresh; _emit('tick', { fresh }); }
    } catch (e) { log.error('Tick:', e.message); }
  }

  /* ─── Public API ─────────────────────────────────────────── */
  function init(onContentChange) {
    try {
      _inject();
      _watchNavigation();
      if (typeof onContentChange === 'function') _watchContent(onContentChange);
      log.info('v9 init ✓  platform:', SPM.PLATFORM);
    } catch (e) { log.error('init:', e.message); }
  }

  function startAutoMonitor(opts = {}) {
    try {
      if (opts.interval)  _monitorInterval = Math.max(10, +opts.interval);
      if (opts.threshold) _alertThreshold  = Math.max(1,  +opts.threshold);
      stopAutoMonitor();
      _monitorActive = true;
      _tick();
      _monitorTimer  = setInterval(_tick, _monitorInterval * 1_000);
      _emit('stateChange', { active:true });
      log.info('Auto-monitor ON  every', _monitorInterval + 's');
    } catch (e) { log.error('startAutoMonitor:', e.message); }
  }

  function stopAutoMonitor() {
    if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
    _monitorActive = false;
    _emit('stateChange', { active:false });
  }

  async function getHistory() {
    try {
      const stored = await SpmStorage.getAllHistory();
      return stored?.length ? stored : [..._localHistory];
    } catch (e) { log.error('getHistory:', e.message); return [..._localHistory]; }
  }

  function getReport() {
    try {
      const p = SpmExtractor.getLatestPost();
      if (!p) return null;
      return SpmAnalytics.buildReport(
        p, _localHistory,
        SpmExtractor.getLatestProfile() ?? {},
        SpmExtractor.getComments(p.postId) ?? []
      );
    } catch (e) { log.error('getReport:', e.message); return null; }
  }

  function on(ev, fn)      { _on(ev, fn); }
  function isActive()      { return _monitorActive; }
  function getLog()        { return [..._log]; }
  function setLastStats(s) { if (s) _lastStats = s; }
  function setInterval_(s) { _monitorInterval = Math.max(10, +s || 60); if (_monitorActive) startAutoMonitor(); }
  function setThreshold(n) { _alertThreshold  = Math.max(1,  +n || 1); }

  return {
    init, startAutoMonitor, stopAutoMonitor,
    getHistory, getReport,
    on, isActive, getLog, setLastStats,
    setInterval: setInterval_, setThreshold,
  };

})();
