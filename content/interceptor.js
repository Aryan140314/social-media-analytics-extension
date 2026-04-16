/**
 * SPM Pro v8 · content/interceptor.js
 * ─────────────────────────────────────────────────────────────
 * Execution context : MAIN world (injected via <script src>)
 * Responsibility    : Patch fetch + XHR, parse GraphQL JSON,
 *                     relay to ISOLATED world via postMessage.
 *
 * BUG FIXES:
 *  #1  Injected via chrome.runtime.getURL  (not inline script)
 *  #2  Patches BOTH fetch AND XMLHttpRequest
 *  #3  Uses window.postMessage to send to monitor.js
 *  #4  response.clone() used correctly — never consumes original
 *  #11 All async paths wrapped in try/catch
 */

(function () {
  'use strict';

  // ── Guard: inject once ──────────────────────────────────
  if (window.__SPM_INTERCEPTOR_V8) return;
  window.__SPM_INTERCEPTOR_V8 = true;

  // ── Config ──────────────────────────────────────────────
  const DEBUG           = true;
  const POST_MSG_TYPE   = 'SPM_API_DATA';
  // Endpoints worth intercepting
  const ENDPOINT_RE     = /graphql|\/api\/v[12]\//i;

  // ── Logger ──────────────────────────────────────────────
  const log = {
    info:  (...a) => DEBUG && console.info( '[SPM Interceptor]', ...a),
    warn:  (...a) =>           console.warn( '[SPM Interceptor WARN]', ...a),
    error: (...a) =>           console.error('[SPM Interceptor ERROR]', ...a),
  };

  // ── Rolling dedup — prevents same payload firing twice ──
  // FIX #7: key = content hash (length + first 32 chars), NOT url
  const _seen = new Set();
  function _isNew(text) {
    const key = text.length + ':' + text.slice(0, 32);
    if (_seen.has(key)) return false;
    _seen.add(key);
    if (_seen.size > 400) {
      const evict = [..._seen].slice(0, 100);
      evict.forEach(k => _seen.delete(k));
    }
    return true;
  }

  // ── Relay payload to ISOLATED world ─────────────────────
  // FIX #3: use window.postMessage (NOT chrome.runtime.sendMessage)
  function _relay(json) {
    try {
      window.postMessage({ type: POST_MSG_TYPE, payload: json }, window.location.origin || '*');
      log.info('Relayed payload, keys:', Object.keys(json).slice(0, 5));
    } catch (e) {
      log.error('postMessage relay failed:', e.message);
    }
  }

  // ── Parse raw text body ──────────────────────────────────
  // FIX #11: wrapped in try/catch, handles non-JSON silently
  function _processBody(text, url) {
    if (!text || text.length < 10) return;
    try {
      const json = JSON.parse(text);
      if (!_isNew(text)) {
        log.info('Dedup: skipping already-seen payload from', url.split('?')[0]);
        return;
      }
      log.info('New payload from', url.split('?')[0].slice(-50));
      _relay(json);
    } catch {
      // Non-JSON response (HTML, plain text) — ignore silently
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PATCH 1 — window.fetch
  //  FIX #4: use response.clone() so page still gets body
  // ═══════════════════════════════════════════════════════
  const _OrigFetch = window.fetch;

  window.fetch = async function (...args) {
    // ALWAYS execute original fetch first — never block page
    let response;
    try {
      response = await _OrigFetch.apply(this, args);
    } catch (networkError) {
      // Network failure — re-throw as normal, don't interfere
      throw networkError;
    }

    try {
      const url = typeof args[0] === 'string' ? args[0]
        : args[0] instanceof URL              ? args[0].href
        : args[0]?.url                        ?? '';

      if (ENDPOINT_RE.test(url)) {
        // Clone BEFORE reading — page gets the original body
        // FIX #4: response.clone() used correctly
        const clone = response.clone();
        clone.text()
          .then(text => _processBody(text, url))
          .catch(e  => log.warn('clone().text() failed:', e.message));
      }
    } catch (e) {
      log.error('fetch hook wrapper error:', e.message);
    }

    return response; // always return original, untouched
  };

  log.info('fetch patched ✓');

  // ═══════════════════════════════════════════════════════
  //  PATCH 2 — XMLHttpRequest
  // ═══════════════════════════════════════════════════════
  const _XHRProto = XMLHttpRequest.prototype;
  const _origOpen = _XHRProto.open;
  const _origSend = _XHRProto.send;

  _XHRProto.open = function (method, url, ...rest) {
    // Store URL on instance for use in load handler
    this._spm_url = typeof url === 'string' ? url : String(url ?? '');
    return _origOpen.apply(this, [method, url, ...rest]);
  };

  _XHRProto.send = function (...args) {
    if (ENDPOINT_RE.test(this._spm_url ?? '')) {
      this.addEventListener('load', function () {
        try {
          _processBody(this.responseText, this._spm_url);
        } catch (e) {
          log.error('XHR load handler error:', e.message);
        }
      });
    }
    return _origSend.apply(this, args); // unmodified
  };

  log.info('XHR patched ✓');
  log.info('Interceptor v8 active — watching:', ENDPOINT_RE.source);

})();
