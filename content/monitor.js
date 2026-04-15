/**
 * SPM Pro v7 · content/monitor.js
 *
 * FIX 6 – "Failed" / console error / history not saving
 *   • Null-guard every step of the pipeline
 *   • buildReport() only called when postData is non-null
 *   • saveSnapshot() receives guaranteed postId
 *   • spmSend errors are caught and logged, never thrown
 *   • All async paths have try/catch
 */
'use strict';

const SpmMonitor = (() => {

  let _monitorTimer    = null;
  let _monitorActive   = false;
  let _monitorInterval = 60;
  let _alertThreshold  = 1;
  let _lastStats       = {};
  let _log             = [];
  let _lastUrl         = location.href;
  let _interceptorInjected = false;
  const _localHistory  = [];

  const _bus = {};
  function _on(ev, fn)  { (_bus[ev] = _bus[ev] ?? []).push(fn); }
  function _emit(ev, d) { (_bus[ev] ?? []).forEach(fn => { try { fn(d); } catch (e) { spmLog.error('[Monitor] EventBus', ev, e); } }); }

  const _histDedup = SpmDedup(500);

  // ── Inject interceptor.js ─────────────────────────────────
  function _injectInterceptor() {
    if (_interceptorInjected) return;
    try {
      const s    = document.createElement('script');
      s.src      = chrome.runtime.getURL('content/interceptor.js');
      s.onload   = function () { this.remove(); spmLog.info('[Monitor] Interceptor injected ✓'); };
      s.onerror  = function () { spmLog.warn('[Monitor] Interceptor failed — DOM-only mode'); this.remove(); };
      (document.head ?? document.documentElement).appendChild(s);
      _interceptorInjected = true;
    } catch (e) { spmLog.error('[Monitor] _injectInterceptor:', e); }
  }

  // ── API postMessage listener ──────────────────────────────
  function _startApiListener() {
    window.addEventListener('message', async function (ev) {
      if (ev.origin && ev.origin !== location.origin) return;
      if (ev.data?.type !== 'IG_API_RESPONSE') return;
      const payload = ev.data?.payload;
      if (!payload || typeof payload !== 'object') return;

      spmLog.debug('[Monitor] postMessage received');
      try {
        const postData = SpmExtractor.processApiPayload(payload);
        if (!postData) return; // not a post response, skip silently

        // FIX 6: null-guard profile before calling buildReport
        let report = null;
        try {
          const prof     = SpmExtractor.profile() ?? {};
          const cmnts    = SpmExtractor.comments(postData.postId) ?? [];
          report = SpmAnalytics.buildReport(postData, _localHistory, prof, cmnts);
        } catch (e) {
          spmLog.error('[Monitor] buildReport failed:', e);
          report = null;
        }

        const snap = _buildSnap(postData, report);
        spmBoundedPush(_localHistory, snap, SPM.MAX_HISTORY);

        // FIX 6: save to structured storage
        try { await SpmStorage.saveSnapshot(snap); }
        catch (e) { spmLog.error('[Monitor] SpmStorage.saveSnapshot:', e); }

        // Push to background (best-effort, non-blocking)
        _pushBg(snap).catch(e => spmLog.error('[Monitor] _pushBg:', e));

        _emit('apiData', { postData, report });
        _emit('stats', postData);
        if (_monitorActive) _checkAlerts(postData);

        spmLog.info('[Monitor] Pipeline ✓ likes:', postData.likes,
          '| comments:', postData.comments,
          '| shares:', postData.shares,
          '| viral:', report?.viral?.label ?? 'N/A');

      } catch (e) {
        spmLog.error('[Monitor] Pipeline error:', e);
        // Do NOT re-throw — the "Failed" status is set by ui.js catch block
      }
    });
    spmLog.info('[Monitor] API listener active ✓');
  }

  // FIX 6: ensure postId always present in snapshot
  function _buildSnap(postData, report) {
    const postId = postData.postId
                ?? location.href.split('/p/')?.[1]?.split('/')?.[0]
                ?? location.href.split('/reel/')?.[1]?.split('/')?.[0]
                ?? String(Date.now());
    return {
      postId,
      platform:   postData.platform   ?? SPM.PLATFORM,
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

  const _pushBgDedup = SpmDedup(500);
  async function _pushBg(snap) {
    const key = (snap.postId || snap.url) + ':' + snap.likes + ':' + snap.comments;
    if (!_pushBgDedup.isNew(key)) return;
    try {
      const res = await spmSend({ type: 'PUSH_HISTORY', data: snap });
      if (!res?.ok) spmLog.warn('[Monitor] PUSH_HISTORY bg response:', res);
    } catch (e) { spmLog.error('[Monitor] _pushBg:', e); }
  }

  // ── SPA Navigation watcher ────────────────────────────────
  function _startNavWatcher() {
    const handle = spmDebounce(() => {
      if (location.href === _lastUrl) return;
      const from  = _lastUrl;
      _lastUrl    = location.href;
      _lastStats  = {};
      try { SpmExtractor.resetCache(); } catch (e) { spmLog.error('[Monitor] resetCache:', e); }
      spmClearElCache();
      spmLog.info('[Monitor] Navigate →', _lastUrl.split('/').slice(-3).join('/'));
      _emit('navigate', { from, to: _lastUrl });
    }, 600);

    try {
      new MutationObserver(handle).observe(document.body, { childList: true, subtree: true });
    } catch (e) { spmLog.error('[Monitor] MutationObserver:', e); }
    setInterval(() => { if (location.href !== _lastUrl) handle(); }, 1500);
  }

  function _startDomWatcher(cb) {
    try {
      const deb  = spmDebounce(cb, 1200);
      const obs  = new MutationObserver(deb);
      const root = document.querySelector('article, [role="main"]') ?? document.body;
      obs.observe(root, { childList: true, subtree: true, characterData: true });
    } catch (e) { spmLog.error('[Monitor] _startDomWatcher:', e); }
  }

  // ── Auto-monitor tick ─────────────────────────────────────
  async function _tick() {
    try {
      const fresh = SpmExtractor.stats();
      _checkAlerts(fresh);
      _lastStats = fresh;
      _emit('tick', { fresh, prev: _lastStats });
    } catch (e) { spmLog.error('[Monitor] tick:', e); }
  }

  function _checkAlerts(fresh) {
    if (!fresh) return;
    const alerts = [];
    const chk = (k, label) => {
      const n = fresh[k], o = _lastStats[k];
      if (n == null || o == null) return;
      const d = n - o;
      if (Math.abs(d) >= _alertThreshold) alerts.push({ key: k, label, diff: d, from: o, to: n });
    };
    chk('likes', 'Likes'); chk('comments', 'Comments'); chk('shares', 'Shares');
    if (!alerts.length) return;
    const msg   = alerts.map(a => `${a.label}: ${a.diff > 0 ? '+' : ''}${a.diff.toLocaleString()}`).join(' · ');
    const entry = { ts: Date.now(), alerts, isAlert: true, msg };
    spmBoundedPush(_log, entry, SPM.MAX_LOG);
    _emit('alert', entry);
    spmSend({ type: 'NOTIFY', title: '📊 Stats Changed', body: msg }).catch(() => {});
  }

  // ── Public API ────────────────────────────────────────────
  function init(onContentChange) {
    try {
      _injectInterceptor();
      _startApiListener();
      _startNavWatcher();
      if (typeof onContentChange === 'function') _startDomWatcher(onContentChange);
      spmLog.info('[Monitor] v7 init ✓');
    } catch (e) { spmLog.error('[Monitor] init:', e); }
  }

  function startAutoMonitor(opts = {}) {
    try {
      if (opts.interval)  _monitorInterval = Math.max(10, +opts.interval);
      if (opts.threshold) _alertThreshold  = Math.max(1,  +opts.threshold);
      stopAutoMonitor();
      _monitorActive = true;
      _tick();
      _monitorTimer  = setInterval(_tick, _monitorInterval * 1000);
      _emit('stateChange', { active: true });
      spmLog.info('[Monitor] Auto-monitor started, interval:', _monitorInterval + 's');
    } catch (e) { spmLog.error('[Monitor] startAutoMonitor:', e); }
  }

  function stopAutoMonitor() {
    if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
    _monitorActive = false;
    _emit('stateChange', { active: false });
  }

  async function getHistory() {
    try {
      const stored = await SpmStorage.getAllHistory();
      return (stored && stored.length > 0) ? stored : [..._localHistory];
    } catch (e) {
      spmLog.error('[Monitor] getHistory:', e);
      return [..._localHistory];
    }
  }

  function getReport() {
    try {
      const p = SpmExtractor.getLatestPost();
      if (!p) return null;
      return SpmAnalytics.buildReport(p, _localHistory, SpmExtractor.profile() ?? {}, SpmExtractor.comments(p.postId) ?? []);
    } catch (e) { spmLog.error('[Monitor] getReport:', e); return null; }
  }

  function on(ev, fn)      { _on(ev, fn); }
  function isActive()      { return _monitorActive; }
  function getLog()        { return [..._log]; }
  function clearLog()      { _log = []; }
  function setLastStats(s) { _lastStats = s; }
  function setInterval_(s) { _monitorInterval = Math.max(10, +s || 60); if (_monitorActive) startAutoMonitor(); }
  function setThreshold(n) { _alertThreshold  = Math.max(1,  +n || 1);  }

  return {
    init, startAutoMonitor, stopAutoMonitor,
    getHistory, getReport,
    on, isActive, getLog, clearLog, setLastStats,
    setInterval: setInterval_, setThreshold,
  };

})();
