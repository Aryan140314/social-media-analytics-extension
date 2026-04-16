/**
 * SPM Pro v8 · content/monitor.js
 * ─────────────────────────────────────────────────────────────
 * Integration layer — wires the pipeline:
 *   interceptor.js → postMessage → [here] → extractor → analytics → UI
 *
 * BUG FIXES:
 *  #1  Injects interceptor.js via chrome.runtime.getURL
 *  #3  Listens with window.addEventListener (NOT chrome.runtime.onMessage)
 *  #4  Validates event.source === window  (security + correctness)
 *  #9  Every pipeline stage in its own try/catch
 *  #11 All async code in try/catch
 *  #12 spmSend responses validated
 *  #13 Race condition: listener starts before injection completes
 */
'use strict';

const SpmMonitor = (() => {

  let _monitorTimer       = null;
  let _monitorActive      = false;
  let _monitorInterval    = 60;
  let _alertThreshold     = 1;
  let _lastStats          = {};
  let _log                = [];
  let _lastUrl            = location.href;
  let _injected           = false;
  let _listenerAttached   = false;
  const _localHistory     = [];
  const _histDedup        = SpmDedup(500);

  // ── Event bus ─────────────────────────────────────────────
  const _bus = {};
  function _on(ev, fn)  { (_bus[ev] = _bus[ev] ?? []).push(fn); }
  function _emit(ev, d) {
    (_bus[ev] ?? []).forEach(fn => {
      try { fn(d); } catch (e) { spmLog.error('[Monitor] EventBus', ev, e.message); }
    });
  }

  // ════════════════════════════════════════════════════════
  //  STEP 1 — Inject interceptor.js into MAIN world
  //  FIX #1: uses chrome.runtime.getURL (not inline code)
  //  FIX #13: listener is attached BEFORE injection, so no
  //           race condition — messages queue in the event loop
  // ════════════════════════════════════════════════════════
  function _injectInterceptor() {
    if (_injected) return;

    // FIX #13: attach message listener FIRST, then inject
    // This prevents the race where interceptor fires before listener is ready
    _attachMessageListener();

    try {
      const s    = document.createElement('script');
      s.src      = chrome.runtime.getURL('content/interceptor.js');
      s.onload   = function () {
        this.remove();
        spmLog.info('[Monitor] Interceptor injected and loaded ✓');
      };
      s.onerror  = function () {
        spmLog.warn('[Monitor] Interceptor load failed — DOM-only mode');
        this.remove();
      };
      (document.head ?? document.documentElement).appendChild(s);
      _injected = true;
      spmLog.info('[Monitor] Interceptor script appended to DOM');
    } catch (e) {
      spmLog.error('[Monitor] _injectInterceptor:', e.message);
    }
  }

  // ════════════════════════════════════════════════════════
  //  STEP 2 — window.postMessage listener
  //  FIX #3: listens on window.addEventListener, NOT chrome.runtime
  //  FIX #4: validates event.source === window
  // ════════════════════════════════════════════════════════
  function _attachMessageListener() {
    if (_listenerAttached) return;
    _listenerAttached = true;

    window.addEventListener('message', function (event) {
      // FIX #4: reject messages from other frames / windows
      if (event.source !== window) return;

      // Only process our own message type
      if (!event.data || event.data.type !== 'SPM_API_DATA') return;

      const payload = event.data?.payload;
      if (!payload || typeof payload !== 'object') {
        spmLog.warn('[Monitor] Received message with empty payload');
        return;
      }

      spmLog.pipe('[Monitor] postMessage received, size:', JSON.stringify(payload).length);

      // Process asynchronously so we don't block the message handler
      _processPipeline(payload).catch(e => {
        spmLog.error('[Monitor] Pipeline async error:', e.message);
      });
    });

    spmLog.info('[Monitor] postMessage listener attached ✓');
  }

  // ════════════════════════════════════════════════════════
  //  STEP 3 — Full pipeline with error boundaries
  //  FIX #9: each stage isolated in try/catch
  // ════════════════════════════════════════════════════════
  async function _processPipeline(payload) {

    // ── Stage A: Extract ─────────────────────────────────
    let postData = null;
    try {
      postData = SpmExtractor.processApiPayload(payload);
    } catch (e) {
      spmLog.error('[Monitor] Stage A (extract) error:', e.message);
      return;
    }

    if (!postData) {
      spmLog.debug('[Monitor] Stage A: no post data in payload, skipping');
      return; // Not a post-containing response — normal, skip silently
    }

    spmLog.pipe('[Monitor] Stage A ✓ — postId:', postData.postId?.slice(0,15),
      'likes:', postData.likes, 'comments:', postData.comments);

    // ── Stage B: Analytics ───────────────────────────────
    let report = null;
    try {
      const prof   = SpmExtractor.getLatestProfile() ?? {};
      const cmnts  = SpmExtractor.comments(postData.postId) ?? [];
      report = SpmAnalytics.buildReport(postData, _localHistory, prof, cmnts);
    } catch (e) {
      spmLog.error('[Monitor] Stage B (analytics) error:', e.message);
      // Continue — analytics failure should not block saving or UI update
      report = null;
    }

    spmLog.pipe('[Monitor] Stage B ✓ — engage:', report?.engagement?.ratePercent ?? 'N/A',
      'viral:', report?.viral?.label ?? 'N/A');

    // ── Stage C: Build snapshot ──────────────────────────
    let snap = null;
    try {
      snap = _buildSnapshot(postData, report);
    } catch (e) {
      spmLog.error('[Monitor] Stage C (snapshot) error:', e.message);
      return;
    }

    // ── Stage D: Persist to structured storage ───────────
    try {
      const saved = await SpmStorage.saveSnapshot(snap);
      if (saved) {
        spmBoundedPush(_localHistory, snap, SPM.MAX_HISTORY);
        spmLog.pipe('[Monitor] Stage D ✓ — snapshot saved');
      } else {
        spmLog.warn('[Monitor] Stage D: save returned false');
      }
    } catch (e) {
      spmLog.error('[Monitor] Stage D (storage) error:', e.message);
      // Don't return — UI update should still happen
    }

    // ── Stage E: Push to background service worker ───────
    // FIX #12: verify response from sendMessage
    try {
      const key = (snap.postId || snap.url) + ':' + snap.likes + ':' + snap.comments;
      if (_histDedup.isNew(key)) {
        const res = await spmSend({ type: 'PUSH_HISTORY', data: snap });
        if (res?.ok) {
          spmLog.pipe('[Monitor] Stage E ✓ — background push OK');
        } else {
          spmLog.warn('[Monitor] Stage E: background response:', JSON.stringify(res));
        }
      }
    } catch (e) {
      spmLog.error('[Monitor] Stage E (background push) error:', e.message);
    }

    // ── Stage F: Notify UI ───────────────────────────────
    try {
      _emit('apiData', { postData, report });
      _emit('stats', postData);
    } catch (e) {
      spmLog.error('[Monitor] Stage F (UI emit) error:', e.message);
    }

    // ── Stage G: Auto-monitor alert check ────────────────
    if (_monitorActive) {
      try { _checkAlerts(postData); }
      catch (e) { spmLog.error('[Monitor] Stage G (alerts) error:', e.message); }
    }

    spmLog.pipe('[Monitor] Pipeline complete ✓');
  }

  // ── Build normalised snapshot ─────────────────────────────
  function _buildSnapshot(postData, report) {
    return {
      // FIX #6: guaranteed postId
      postId:     postData.postId
               ?? location.href.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1]
               ?? String(Date.now()),
      platform:   postData.platform   ?? SPM.PLATFORM,
      url:        postData.url         ?? location.href,
      username:   postData.username    ?? '',
      likes:      postData.likes       ?? null,
      comments:   postData.comments    ?? null,
      shares:     postData.shares      ?? null,
      reach:      postData.reach       ?? null,
      followers:  report?.stats?.followers ?? null,
      caption:    (postData.caption    ?? '').slice(0, 200),
      hashtags:   Array.isArray(postData.hashtags) ? postData.hashtags : [],
      mentions:   Array.isArray(postData.mentions) ? postData.mentions : [],
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

  // ── SPA Navigation watcher ────────────────────────────────
  function _startNavWatcher() {
    const _handle = spmDebounce(() => {
      if (location.href === _lastUrl) return;
      const from = _lastUrl;
      _lastUrl   = location.href;
      _lastStats = {};
      try { SpmExtractor.resetCache(); } catch (e) {}
      spmClearElCache();
      spmLog.info('[Monitor] Navigation detected →', _lastUrl.slice(-50));
      _emit('navigate', { from, to: _lastUrl });
    }, 600);

    try {
      new MutationObserver(_handle).observe(document.body, { childList:true, subtree:true });
    } catch (e) { spmLog.error('[Monitor] MutationObserver:', e.message); }
    setInterval(() => { if (location.href !== _lastUrl) _handle(); }, 1500);
    spmLog.info('[Monitor] Nav watcher started ✓');
  }

  function _startDomWatcher(cb) {
    try {
      const deb  = spmDebounce(cb, 1200);
      const obs  = new MutationObserver(deb);
      const root = document.querySelector('article, [role="main"]') ?? document.body;
      obs.observe(root, { childList:true, subtree:true, characterData:true });
    } catch (e) { spmLog.error('[Monitor] _startDomWatcher:', e.message); }
  }

  // ── Auto-monitor tick ─────────────────────────────────────
  async function _tick() {
    try {
      const fresh = SpmExtractor.stats();
      if (fresh) {
        _checkAlerts(fresh);
        _lastStats = fresh;
        _emit('tick', { fresh });
      }
    } catch (e) { spmLog.error('[Monitor] tick:', e.message); }
  }

  function _checkAlerts(fresh) {
    if (!fresh) return;
    const alerts = [];
    const _chk = (k, label) => {
      const n = fresh[k], o = _lastStats[k];
      if (n == null || o == null || typeof n !== 'number' || typeof o !== 'number') return;
      const d = n - o;
      if (Math.abs(d) >= _alertThreshold) alerts.push({ key:k, label, diff:d, from:o, to:n });
    };
    _chk('likes','Likes'); _chk('comments','Comments'); _chk('shares','Shares');
    if (!alerts.length) return;

    const msg   = alerts.map(a => `${a.label}: ${a.diff>0?'+':''}${a.diff.toLocaleString()}`).join(' · ');
    const entry = { ts:Date.now(), alerts, isAlert:true, msg };
    spmBoundedPush(_log, entry, SPM.MAX_LOG);
    _emit('alert', entry);
    spmSend({ type:'NOTIFY', title:'📊 Stats Changed', body:msg }).catch(() => {});
    spmLog.info('[Monitor] Alert triggered:', msg);
  }

  // ── Public API ────────────────────────────────────────────
  function init(onContentChange) {
    try {
      // FIX #13: listener attached inside _injectInterceptor before script tag added
      _injectInterceptor();
      _startNavWatcher();
      if (typeof onContentChange === 'function') _startDomWatcher(onContentChange);
      spmLog.info('[Monitor] v8 init ✓ — platform:', SPM.PLATFORM);
    } catch (e) { spmLog.error('[Monitor] init:', e.message); }
  }

  function startAutoMonitor(opts = {}) {
    try {
      if (opts.interval)  _monitorInterval = Math.max(10, +opts.interval);
      if (opts.threshold) _alertThreshold  = Math.max(1,  +opts.threshold);
      stopAutoMonitor();
      _monitorActive = true;
      _tick();
      _monitorTimer  = setInterval(_tick, _monitorInterval * 1000);
      _emit('stateChange', { active:true });
      spmLog.info('[Monitor] Auto-monitor ON — every', _monitorInterval+'s, threshold', _alertThreshold);
    } catch (e) { spmLog.error('[Monitor] startAutoMonitor:', e.message); }
  }

  function stopAutoMonitor() {
    if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
    _monitorActive = false;
    _emit('stateChange', { active:false });
  }

  async function getHistory() {
    try {
      const stored = await SpmStorage.getAllHistory();
      return (stored && stored.length > 0) ? stored : [..._localHistory];
    } catch (e) {
      spmLog.error('[Monitor] getHistory:', e.message);
      return [..._localHistory];
    }
  }

  function getReport() {
    try {
      const p = SpmExtractor.getLatestPost();
      if (!p) return null;
      return SpmAnalytics.buildReport(
        p, _localHistory,
        SpmExtractor.getLatestProfile() ?? {},
        SpmExtractor.comments(p.postId) ?? []
      );
    } catch (e) { spmLog.error('[Monitor] getReport:', e.message); return null; }
  }

  function on(ev, fn)      { _on(ev, fn); }
  function isActive()      { return _monitorActive; }
  function getLog()        { return [..._log]; }
  function clearLog()      { _log = []; }
  function setLastStats(s) { if (s) _lastStats = s; }
  function setInterval_(s) { _monitorInterval = Math.max(10, +s || 60); if (_monitorActive) startAutoMonitor(); }
  function setThreshold(n) { _alertThreshold  = Math.max(1,  +n || 1);  }

  return {
    init,
    startAutoMonitor, stopAutoMonitor,
    getHistory, getReport,
    on, isActive, getLog, clearLog, setLastStats,
    setInterval: setInterval_, setThreshold,
  };

})();
