/**
 * SPM Pro v5 · content/interceptor.js
 *
 * Execution context : MAIN world (page JS).
 * Injected as <script src="..."> from monitor.js at document_start.
 *
 * Intercepts BOTH:
 *   • window.fetch         (modern requests)
 *   • XMLHttpRequest       (legacy + some IG internal calls)
 *
 * Captures endpoints matching:
 *   • /graphql/
 *   • /api/v1/
 *   • /api/v2/
 *
 * Sends structured message via window.postMessage:
 *   { type: "IG_API_RESPONSE", payload: <parsed JSON> }
 *
 * Design principles:
 *   • NEVER delay or modify the original request/response
 *   • Use response.clone() for non-destructive reading
 *   • Bounded dedup Set prevents repeated processing
 *   • All errors are caught — nothing propagates to page JS
 */

(function () {
  'use strict';

  // ── Guard: inject only once ──────────────────────────────
  if (window.__spmInterceptorV5) return;
  window.__spmInterceptorV5 = true;

  // ── Config ───────────────────────────────────────────────
  const POST_MESSAGE_TYPE  = 'IG_API_RESPONSE';
  const RELEVANT_ENDPOINTS = /graphql|\/api\/v[12]\//i;

  // ── Rolling dedup (keyed by url + response byte length) ──
  const _seen = new Set();
  function _isNew(key) {
    if (_seen.has(key)) return false;
    _seen.add(key);
    // Cap: evict oldest 25 % when over 600 entries
    if (_seen.size > 600) {
      const old = [..._seen].slice(0, 150);
      old.forEach(k => _seen.delete(k));
    }
    return true;
  }

  // ── Resolve URL string from fetch arguments ──────────────
  function _resolveUrl(input) {
    if (typeof input === 'string')          return input;
    if (input instanceof URL)               return input.href;
    if (input && typeof input === 'object') return input.url ?? '';
    return '';
  }

  // ── Emit structured message to ISOLATED world ────────────
  function _emit(payload) {
    try {
      window.postMessage({ type: POST_MESSAGE_TYPE, payload }, '*');
    } catch (e) {
      console.error('[SPM Interceptor] postMessage error:', e);
    }
  }

  // ── Parse text → JSON → dedup → emit ────────────────────
  function _process(text, url) {
    if (!text || text.length < 10) return;
    try {
      const json = JSON.parse(text);
      // Dedup key: URL path + payload byte-length
      const urlPath = (() => { try { return new URL(url).pathname; } catch { return url; } })();
      const key     = urlPath + ':' + text.length;
      if (!_isNew(key)) return;
      _emit(json);
    } catch {
      // Non-JSON body (HTML error page, plain text) — ignore silently
    }
  }

  // ════════════════════════════════════════════════════════
  //  INTERCEPT 1 — window.fetch
  // ════════════════════════════════════════════════════════
  const _OrigFetch = window.fetch;

  window.fetch = async function (...args) {
    // Step 1: execute original — NEVER block or delay
    const response = await _OrigFetch.apply(this, args);

    try {
      const url = _resolveUrl(args[0]);
      if (RELEVANT_ENDPOINTS.test(url)) {
        // Step 2: clone so the page receives the original intact body
        response.clone().text()
          .then(text => _process(text, url))
          .catch(() => {}); // swallow clone errors
      }
    } catch (e) {
      console.error('[SPM Interceptor] fetch hook error:', e);
    }

    return response; // always return original, unmodified
  };

  // ════════════════════════════════════════════════════════
  //  INTERCEPT 2 — XMLHttpRequest
  // ════════════════════════════════════════════════════════
  const _XHRProto   = XMLHttpRequest.prototype;
  const _OrigOpen   = _XHRProto.open;
  const _OrigSend   = _XHRProto.send;

  _XHRProto.open = function (method, url, ...rest) {
    // Store resolved URL on instance for use in load handler
    this._spmUrl = String(url ?? '');
    return _OrigOpen.apply(this, [method, url, ...rest]);
  };

  _XHRProto.send = function (...args) {
    if (RELEVANT_ENDPOINTS.test(this._spmUrl ?? '')) {
      this.addEventListener('load', function () {
        try { _process(this.responseText, this._spmUrl); }
        catch (e) { console.error('[SPM Interceptor] XHR load handler error:', e); }
      });
    }
    return _OrigSend.apply(this, args); // unmodified send
  };

  console.log('[SPM Interceptor v5] fetch + XHR patched ✓  watching:', RELEVANT_ENDPOINTS.source);

})();
