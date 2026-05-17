/* ============================================================
   interceptor.js — Network interceptor (MAIN world)
   v10 — CRITICAL FIX: XHR open() and send() were patched
         without calling the originals, breaking ALL XHR on page.
         FIX: postMessage origin changed from '*' to specific origin.
   ============================================================

   IMPORTANT: This file runs in the MAIN world.
   It is injected by monitor.js via <script src>, NOT as a content script.
   Do NOT add it to content_scripts in manifest.json.
*/

(function () {
  'use strict';

  const ENDPOINT_RE = /graphql|\/api\/v1\//i;
  const _allowedOrigin = location.origin; // FIX: was '*' — restrict to same origin

  // ─── Patch fetch ────────────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    // ALWAYS call original first and return its result
    const response = await _origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0]
        : (args[0] instanceof Request ? args[0].url : '');
      if (ENDPOINT_RE.test(url)) {
        // Clone before reading — original must remain readable
        response.clone().text().then(text => _process(text, url)).catch(() => {});
      }
    } catch (e) { /* never break the original fetch */ }
    return response;
  };

  // ─── Patch XHR ──────────────────────────────────────────────
  // CRITICAL FIX v10: v9 patched open() and send() without calling
  // the originals. This meant:
  //   - open() never set the URL on the real XHR object
  //   - send() added a listener but never actually sent the request
  // Result: every XHR on the page hung silently.
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._spm_url = url; // store for send handler
    return _origOpen.call(this, method, url, ...rest); // FIX: call original
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._spm_url && ENDPOINT_RE.test(this._spm_url)) {
      this.addEventListener('load', function () {
        try { _process(this.responseText, this._spm_url); } catch (e) {}
      });
    }
    return _origSend.apply(this, args); // FIX: call original so request actually fires
  };

  // ─── Process response ────────────────────────────────────────
  function _process(text, url) {
    if (!text || text[0] !== '{') return; // quick bail for non-JSON
    let json;
    try { json = JSON.parse(text); } catch (e) { return; }
    if (!json || typeof json !== 'object') return;
    // FIX: use specific origin instead of '*'
    window.postMessage({ type: 'IG_API_RESPONSE', payload: json }, _allowedOrigin);
  }

})();
