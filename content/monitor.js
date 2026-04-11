// ═══════════════════════════════════════════════════════════════
//  SPM Pro v4  ·  content/monitor.js
//  - MutationObserver on document.body (SPA DOM changes)
//  - Interval poll as safety net
//  - Debounced refresh so rapid DOM mutations don't spam scrapes
//  - Emits events consumed by ui.js only
// ═══════════════════════════════════════════════════════════════
'use strict';

const SpmMonitor = (() => {

  let _timer        = null;
  let _active       = false;
  let _interval     = 60;
  let _threshold    = 1;
  let _lastStats    = {};
  let _log          = [];
  let _navObserver  = null;
  let _domObserver  = null;
  let _lastUrl      = location.href;

  // ── Event bus ────────────────────────────────────────────────
  const _listeners = {};
  function _on(ev, fn) { (_listeners[ev] = _listeners[ev]||[]).push(fn); }
  function _emit(ev, d) {
    (_listeners[ev]||[]).forEach(fn => { try { fn(d); } catch(e) { spmLog.error('emit', ev, e); } });
  }

  // ── SPA navigation watcher ───────────────────────────────────
  // MutationObserver detects React DOM swaps; polling covers hash/search changes
  function _startNavWatcher() {
    if (_navObserver) return;

    const _handleNavChange = spmDebounce(() => {
      if (location.href !== _lastUrl) {
        const from = _lastUrl;
        _lastUrl   = location.href;
        _lastStats = {};
        SpmExtractor.resetCache();
        spmClearElCache();
        spmLog.info('Navigation:', from, '→', _lastUrl);
        _emit('navigate', { from, to: _lastUrl });
      }
    }, 600);

    // MutationObserver — triggers on every React re-render
    _navObserver = new MutationObserver(_handleNavChange);
    _navObserver.observe(document.body, { childList: true, subtree: true });

    // Polling fallback for pushState / replaceState changes
    setInterval(() => {
      if (location.href !== _lastUrl) _handleNavChange();
    }, 1500);
  }

  // ── DOM content watcher ──────────────────────────────────────
  // Watches the post area for content changes (lazy-loaded stats, carousel swipes)
  // Debounced heavily so we don't re-scrape on every React re-render
  function _startDomWatcher(onContentChange) {
    if (_domObserver) { _domObserver.disconnect(); }
    const debouncedCb = spmDebounce(onContentChange, 1200);
    _domObserver = new MutationObserver(debouncedCb);
    // Observe nearest post container if available, else body
    const target = document.querySelector('article, [role="main"]') || document.body;
    _domObserver.observe(target, { childList: true, subtree: true, characterData: true });
    spmLog.debug('DOM watcher started on', target.tagName);
  }

  // ── Monitor tick ─────────────────────────────────────────────
  async function _tick() {
    try {
      const fresh = SpmExtractor.stats();
      const prev  = _lastStats;
      _lastStats  = fresh;

      const alerts = [];
      const _chk = (key, label) => {
        const n = fresh[key], o = prev[key];
        if (n==null || o==null) return;
        const diff = n - o;
        if (Math.abs(diff) >= _threshold) alerts.push({ key, label, diff, from:o, to:n });
      };
      _chk('likes',    'Likes');
      _chk('comments', 'Comments');
      _chk('shares',   'Shares');

      const entry = { ts:Date.now(), alerts, stats:{likes:fresh.likes,comments:fresh.comments,shares:fresh.shares}, isAlert:alerts.length>0 };
      spmBoundedPush(_log, entry, SPM.MAX_LOG);
      _emit('tick', { fresh, prev, alerts, logEntry:entry });

      if (alerts.length > 0) {
        const msg = alerts.map(a=>`${a.label}: ${a.diff>0?'+':''}${a.diff.toLocaleString()}`).join(' · ');
        spmSend({ type:'NOTIFY', title:'📊 Post Changed', body:msg });
      }
    } catch(e) { spmLog.error('Monitor tick:', e); }
  }

  // ── Public API ────────────────────────────────────────────────
  function init(onContentChange) {
    _startNavWatcher();
    if (onContentChange) _startDomWatcher(onContentChange);
  }

  function start(opts={}) {
    if (opts.interval)  _interval  = Math.max(10, +opts.interval);
    if (opts.threshold) _threshold = Math.max(1,  +opts.threshold);
    stop();
    _active = true;
    _tick();
    _timer = setInterval(_tick, _interval * 1000);
    spmLog.info('Monitor started, interval:', _interval+'s, threshold:', _threshold);
    _emit('stateChange', { active:true });
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer=null; }
    _active = false;
    _emit('stateChange', { active:false });
  }

  function setInterval_(s)  { _interval=Math.max(10,+s||60);  if(_active) start(); }
  function setThreshold(n)  { _threshold=Math.max(1, +n||1);  }
  function isActive()       { return _active; }
  function getLog()         { return [..._log]; }
  function clearLog()       { _log=[]; }
  function setLastStats(s)  { _lastStats=s; }
  function on(ev, fn)       { _on(ev, fn); }

  return { init, start, stop, setInterval:setInterval_, setThreshold, isActive, getLog, clearLog, setLastStats, on };
})();
