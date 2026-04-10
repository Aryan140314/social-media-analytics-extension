// ═══════════════════════════════════════════════════════════════
//  SPM Pro v3  ·  content/monitor.js
//  Auto-monitor, SPA navigation, change detection.
//  No direct UI calls — emits events consumed by ui.js.
// ═══════════════════════════════════════════════════════════════

'use strict';

const SpmMonitor = (() => {

  // ── Internal state ───────────────────────────────────────────
  let _timer        = null;
  let _active       = false;
  let _interval     = 60;   // seconds
  let _threshold    = 1;    // min change to alert
  let _lastStats    = {};
  let _log          = [];   // bounded array
  let _navObserver  = null;
  let _lastUrl      = location.href;

  // ── Event bus (simple pub/sub, no external libs) ─────────────
  const _listeners = {};
  function _on(event, fn)  { (_listeners[event] = _listeners[event] || []).push(fn); }
  function _emit(event, d) { (_listeners[event] || []).forEach(fn => { try { fn(d); } catch(e) { spmLog.error('emit', e); } }); }

  // ── Navigation watcher (handles Instagram/FB SPA routing) ────
  function _startNavWatcher() {
    if (_navObserver) return;
    // MutationObserver on document.body for child changes (SPA DOM swaps)
    _navObserver = new MutationObserver(spmThrottle(() => {
      if (location.href !== _lastUrl) {
        const prev = _lastUrl;
        _lastUrl = location.href;
        spmLog.info('Navigation detected:', prev, '→', _lastUrl);
        _emit('navigate', { from: prev, to: _lastUrl });
        // Reset per-page state
        _lastStats = {};
      }
    }, 500));
    _navObserver.observe(document.body, { childList: true, subtree: true });

    // Also poll as a safety net for hash/search changes
    setInterval(() => {
      if (location.href !== _lastUrl) {
        const prev = _lastUrl;
        _lastUrl = location.href;
        _emit('navigate', { from: prev, to: _lastUrl });
        _lastStats = {};
      }
    }, 1500);
  }

  // ── Monitor tick ─────────────────────────────────────────────
  async function _tick() {
    try {
      const fresh = SpmExtractor.stats();
      const prev  = _lastStats;
      _lastStats  = fresh;

      const alerts = [];
      const checkField = (key, label) => {
        const n = spmParseNum(fresh[key]);
        const o = spmParseNum(prev[key]);
        if (n == null || o == null) return;
        const diff = n - o;
        if (Math.abs(diff) >= _threshold) {
          alerts.push({ key, label, diff, from: o, to: n });
        }
      };
      checkField('likes',    'Likes');
      checkField('comments', 'Comments');
      checkField('shares',   'Shares');

      const logEntry = {
        ts:     Date.now(),
        alerts,
        stats:  { likes: fresh.likes, comments: fresh.comments, shares: fresh.shares },
        isAlert: alerts.length > 0,
      };
      spmBoundedPush(_log, logEntry, SPM.MAX_LOG);
      _emit('tick', { fresh, prev, alerts, logEntry });

      // Desktop notification if changes detected
      if (alerts.length > 0) {
        const msg = alerts.map(a => `${a.label}: ${a.diff > 0 ? '+' : ''}${a.diff.toLocaleString()}`).join(' · ');
        spmSend({ type: 'NOTIFY', title: '📊 Post Changed', body: msg });
      }
    } catch (err) {
      spmLog.error('Monitor tick failed:', err);
    }
  }

  // ── Public API ────────────────────────────────────────────────
  function start(opts = {}) {
    if (opts.interval)  _interval  = opts.interval;
    if (opts.threshold) _threshold = opts.threshold;
    stop();
    _active = true;
    _tick(); // immediate first tick
    _timer = setInterval(_tick, _interval * 1000);
    spmLog.info('Monitor started, interval:', _interval + 's');
    _emit('stateChange', { active: true });
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _active = false;
    _emit('stateChange', { active: false });
  }

  function setInterval_(s)   { _interval  = Math.max(10, +s || 60); if (_active) start(); }
  function setThreshold(n)   { _threshold = Math.max(1,  +n || 1);  }
  function isActive()        { return _active; }
  function getLog()          { return [..._log]; }
  function clearLog()        { _log = []; }
  function setLastStats(s)   { _lastStats = s; }
  function on(event, fn)     { _on(event, fn); }

  function init() {
    _startNavWatcher();
  }

  return { init, start, stop, setInterval: setInterval_, setThreshold, isActive, getLog, clearLog, setLastStats, on };

})();
