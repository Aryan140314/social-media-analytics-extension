/**
 * SPM Pro v9 · content/interceptor.js
 *
 * Runs in MAIN world — injected via <script src> from monitor.js.
 * Patches window.fetch + XMLHttpRequest.
 * Forwards parsed GraphQL JSON to ISOLATED world via postMessage.
 *
 * Requirements addressed:
 *  R1  – Duplicate injection guard
 *  R1  – Patches both fetch AND XHR
 *  R1  – Filters only /graphql/ and /api/v1/ endpoints
 *  R2  – Sends { type: "IG_API_RESPONSE", payload } via postMessage
 *  R7  – try/catch in every code path
 *  R8  – DEBUG flag and per-stage logging
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────
   * 0. Guard — run once per page context
   * ───────────────────────────────────────────────────────── */
  if (window.__SPM_V9) return;
  window.__SPM_V9 = true;

  /* ─────────────────────────────────────────────────────────
   * 1. Config
   * ───────────────────────────────────────────────────────── */
  const DEBUG        = true;
  const MSG_TYPE     = 'IG_API_RESPONSE';           // R2 — must match monitor.js
  const ENDPOINT_RE  = /graphql|\/api\/v1\//i;      // R1 — filter relevant calls

  /* ─────────────────────────────────────────────────────────
   * 2. Logger
   * ───────────────────────────────────────────────────────── */
  const log = {
    info : (...a) => DEBUG && console.info ('[SPM:interceptor]', ...a),
    warn : (...a) =>           console.warn ('[SPM:interceptor]', ...a),
    error: (...a) =>           console.error('[SPM:interceptor]', ...a),
  };

  /* ─────────────────────────────────────────────────────────
   * 3. Deduplication — R6: key on content, NOT on URL
   *    Uses first 64 chars of body + length as a fast hash.
   * ───────────────────────────────────────────────────────── */
  const _seen = new Set();

  function _isNew(text) {
    const key = `${text.length}:${text.slice(0, 64)}`;
    if (_seen.has(key)) return false;
    _seen.add(key);
    if (_seen.size > 300) {
      const stale = [..._seen].slice(0, 75);
      stale.forEach(k => _seen.delete(k));
    }
    return true;
  }

  /* ─────────────────────────────────────────────────────────
   * 4. Parse + emit
   * ───────────────────────────────────────────────────────── */
  function _emit(json) {
    // R2 — window.postMessage to reach monitor.js in ISOLATED world
    try {
      window.postMessage({ type: MSG_TYPE, payload: json }, '*');
      log.info('Emitted payload, top-level keys:', Object.keys(json).slice(0, 6));
    } catch (e) {
      log.error('postMessage failed:', e.message);
    }
  }

  function _process(text, url) {
    // R7 — try/catch so a bad response never crashes the interceptor
    try {
      if (!text || text.length < 10) return;
      const json = JSON.parse(text);      // throws if not JSON → caught below
      if (!_isNew(text)) {
        log.info('Dedup skip for', url.split('?')[0].slice(-60));
        return;
      }
      log.info('New payload from', url.split('?')[0].slice(-60));
      _emit(json);
    } catch {
      // Not JSON — silently ignore (HTML pages, CSS, plain text)
    }
  }

  /* ─────────────────────────────────────────────────────────
   * 5. Patch window.fetch
   *    R1 — response.clone() so the page body is untouched
   * ───────────────────────────────────────────────────────── */
  const _origFetch = window.fetch;

  window.fetch = async function (...args) {
    // Always execute the real fetch first — never delay the page
    const response = await _origFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0]
        : args[0] instanceof URL             ? args[0].href
        : (args[0]?.url ?? '');

      if (ENDPOINT_RE.test(url)) {
        // Clone before reading — page still gets the original body stream
        response.clone().text()
          .then(text => _process(text, url))
          .catch(e    => log.warn('clone().text() error:', e.message));
      }
    } catch (e) {
      log.error('fetch wrapper error:', e.message);
    }

    return response;                        // always return original
  };

  /* ─────────────────────────────────────────────────────────
   * 6. Patch XMLHttpRequest
   * ───────────────────────────────────────────────────────── */
  const _proto    = XMLHttpRequest.prototype;
  const _origOpen = _proto.open;
  const _origSend = _proto.send;

  _proto.open = function (method, url, ...rest) {
    this._spm_url = String(url ?? '');
    return _origOpen.apply(this, [method, url, ...rest]);
  };

  _proto.send = function (...args) {
    if (ENDPOINT_RE.test(this._spm_url ?? '')) {
      this.addEventListener('load', function () {
        try { _process(this.responseText, this._spm_url); }
        catch (e) { log.error('XHR load handler:', e.message); }
      });
    }
    return _origSend.apply(this, args);     // always call original
  };

  log.info('v9 active — fetch ✓  XHR ✓  filter:', ENDPOINT_RE.source);

})();
