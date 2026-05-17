/* ============================================================
   monitor.js — Pipeline orchestrator + SPA navigation watcher
   v10 — fixes: duplicate navigation events (MutationObserver
         AND setInterval both firing — now use lock flag),
         interceptor.js listener race condition (already fixed
         in v9, preserved here),
         SW-sleeping spmSend handled via utils.js
   ============================================================ */

'use strict';

const SpmMonitor = (() => {

  let _lastUrl    = location.href;
  let _report     = null;
  let _autoTimer  = null;
  let _injected   = false;
  let _navLock    = false; // FIX v10: prevent duplicate nav handling
  const _listeners = {};

  // ── Event emitter ─────────────────────────────────────────────
  function _on(event, fn)    { (_listeners[event] = _listeners[event] || []).push(fn); }
  function _emit(event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch (e) { spmErr('listener error', e); } });
  }

  // ── Inject interceptor.js into MAIN world ─────────────────────
  // FIX (carried from v9): listener MUST be attached before script injection
  // to avoid missing the first message (race condition).
  function _inject() {
    if (_injected) return;
    _injected = true;
    _attachMessageListener(); // FIRST
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('content/interceptor.js');
    s.onload = () => { spmLog('interceptor.js injected'); s.remove(); };
    s.onerror = () => spmWarn('interceptor.js failed to load');
    (document.head || document.documentElement).appendChild(s); // SECOND
  }

  // ── Message listener ──────────────────────────────────────────
  function _attachMessageListener() {
    window.addEventListener('message', function (event) {
      if (event.source !== window) return;           // security: same window only
      if (event.data?.type !== 'IG_API_RESPONSE') return; // type guard
      // FIX v10: interceptor now sends to location.origin, so no origin mismatch
      _runPipeline(event.data.payload);
    });
  }

  // ── 6-stage pipeline ──────────────────────────────────────────
  async function _runPipeline(payload) {
    try {
      // Stage A: Extract
      const postData = SpmExtractor.extractPostData(payload);
      if (!postData) return; // filtered (not a post, or duplicate)

      // Stage B: Get history for this post
      const stored  = await SpmStorage.getPostHistory(postData.postId);
      const history = stored?.history || [];
      const profile = SpmExtractor.profile();
      const comments = SpmExtractor.getComments(postData.postId);

      // Stage C: Build analytics report
      const report = SpmAnalytics.buildReport(postData, history, profile, comments);
      _report = report;

      // Stage D: Build snapshot
      const snap = {
        postId:      postData.postId,
        username:    postData.username,
        url:         postData.url,
        platform:    postData.platform,
        likes:       postData.likes,
        comments:    postData.comments,
        shares:      postData.shares,
        reach:       postData.reach,
        engagement:  report.engagement?.rate ?? null,
        viralScore:  report.viral?.score ?? null,
        ts:          Date.now(),
      };

      // Stage E: Save to unified storage (FIX v10: single storage, not dual)
      await SpmStorage.saveSnapshot(snap);

      // Stage F: Notify background (for popup display) + emit to UI
      await spmSend({ type: 'PUSH_HISTORY', data: snap });
      _emit('apiData', { postData, report });

      spmLog('Pipeline complete for', postData.postId);
    } catch (err) {
      spmErr('Pipeline error:', err);
    }
  }

  // ── SPA navigation detection ──────────────────────────────────
  // FIX v10: v9 used BOTH MutationObserver AND setInterval to detect navigation.
  // Both would fire nearly simultaneously on a route change, causing:
  //   - extractor cache reset twice
  //   - 'navigate' event emitted twice
  //   - pipeline potentially running twice
  // Fix: use a shared lock flag — first handler wins, second is ignored
  // within a 500ms window.
  function _handleNavChange() {
    const current = location.href;
    if (current === _lastUrl) return;
    if (_navLock) return; // FIX: ignore second trigger within 500ms
    _navLock = true;
    setTimeout(() => { _navLock = false; }, 500);

    _lastUrl = current;
    SpmExtractor.resetCache();
    _report = null;
    _emit('navigate', { url: current });
    spmLog('Navigated to', current);
  }

  // MutationObserver watches DOM changes
  const _mutationObserver = new MutationObserver(spmRateLimit(_handleNavChange, 300));

  // setInterval as fallback (catches pushState navigations MutationObserver might miss)
  let _navInterval = null;

  // ── Auto-monitor ──────────────────────────────────────────────
  function startAutoMonitor({ interval = 30_000, threshold = 5 } = {}) {
    if (_autoTimer) stopAutoMonitor();
    let prevLikes = null;
    _autoTimer = setInterval(async () => {
      const post = SpmExtractor.stats();
      if (!post) return;
      _emit('tick', { fresh: post });
      if (prevLikes != null && post.likes != null) {
        const delta = post.likes - prevLikes;
        if (delta >= threshold) {
          _emit('alert', { type: 'like_spike', delta, post });
          await spmSend({ type: 'NOTIFY', title: 'SPM Alert', message: `+${spmFmt(delta)} likes on ${post.username || 'post'}` });
        }
      }
      prevLikes = post.likes;
    }, interval);
    _emit('stateChange', { active: true });
    spmLog('Auto-monitor started, interval:', interval);
  }

  function stopAutoMonitor() {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
    _emit('stateChange', { active: false });
    spmLog('Auto-monitor stopped');
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    init(onContentChange) {
      _inject();
      _mutationObserver.observe(document.body, { childList: true, subtree: true });
      // setInterval fallback — FIX: no longer duplicates because of _navLock
      _navInterval = setInterval(_handleNavChange, 1500);
      if (typeof onContentChange === 'function') _on('navigate', onContentChange);
      spmLog('SpmMonitor initialized');
    },

    destroy() {
      _mutationObserver.disconnect();
      if (_navInterval) { clearInterval(_navInterval); _navInterval = null; }
      stopAutoMonitor();
      // FIX v10: clear listener registry to prevent memory leaks on re-init
      Object.keys(_listeners).forEach(k => { _listeners[k] = []; });
    },

    startAutoMonitor,
    stopAutoMonitor,
    getHistory: () => SpmStorage.getAllHistory(),
    getReport:  () => _report,
    on:         _on,
  };
})();
