// ═══════════════════════════════════════════════════════════════
//  SPM Pro v3  ·  content/utils.js
//  Shared utilities — loaded first by all content modules
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Constants ───────────────────────────────────────────────────
const SPM = {
  VERSION:        '3.0.0',
  MAX_HISTORY:    200,
  MAX_COMMENTS:   500,
  MAX_LOG:         50,
  MAX_MEDIA:       20,
  ALLOWED_HOSTS:  ['fbcdn.net', 'cdninstagram.com', 'facebook.com', 'instagram.com'],
  IS_FB:          location.hostname.includes('facebook.com'),
  IS_IG:          location.hostname.includes('instagram.com'),
  PLATFORM:       location.hostname.includes('facebook.com') ? 'facebook' : 'instagram',
};

// ── DOM helpers ─────────────────────────────────────────────────
function spmQ(sel, root = document)  { try { return root.querySelector(sel);      } catch { return null; } }
function spmQA(sel, root = document) { try { return [...root.querySelectorAll(sel)]; } catch { return []; } }

/** Cache of element refs to avoid repeated queries */
const _elCache = new Map();
function spmEl(id) {
  if (!_elCache.has(id)) _elCache.set(id, document.getElementById(id));
  return _elCache.get(id);
}
function spmElFresh(id) {
  _elCache.delete(id);
  return document.getElementById(id);
}
function spmClearElCache() { _elCache.clear(); }

// ── Number helpers ──────────────────────────────────────────────
/** Parse "1.2K", "58", "3.4M" → integer */
function spmParseNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').trim();
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  if (/[Mm]/.test(s)) return Math.round(n * 1_000_000);
  if (/[Kk]/.test(s)) return Math.round(n * 1_000);
  return Math.round(n);
}

/** Format integer → "1.2K", "3.4M" */
function spmFmt(n) {
  if (n == null) return '—';
  const v = typeof n === 'string' ? spmParseNum(n) : n;
  if (v == null || isNaN(v)) return String(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1).replace(/\.0$/, '')     + 'K';
  return v.toLocaleString();
}

/** Compute engagement rate as a % string */
function spmEngagement(likes, comments, followers) {
  const l = spmParseNum(likes)    || 0;
  const c = spmParseNum(comments) || 0;
  const f = spmParseNum(followers);
  if (!f || f === 0) return null;
  return ((l + c) / f * 100).toFixed(2) + '%';
}

// ── Time helpers ────────────────────────────────────────────────
function spmTs()   { return new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }
function spmDate() { return new Date().toLocaleString(); }
function spmAgo(t) {
  const d = Date.now() - t, m = Math.floor(d / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// ── Performance helpers ─────────────────────────────────────────
/** Standard debounce — prevents fn firing more than once per `delay` ms */
function spmDebounce(fn, delay = 400) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

/** Throttle — fn runs at most once per `limit` ms */
function spmThrottle(fn, limit = 1000) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= limit) { last = now; fn.apply(this, args); }
  };
}

// ── Security helpers ────────────────────────────────────────────
/** Only allow downloads from trusted social-media CDN hosts */
function spmValidateUrl(url) {
  try {
    const u = new URL(url);
    if (!['https:'].includes(u.protocol)) return false;
    return SPM.ALLOWED_HOSTS.some(h => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

/** Escape HTML to prevent XSS in innerHTML */
function spmEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Validate incoming runtime messages (schema guard) */
function spmValidateMsg(msg, requiredKeys = []) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.type || typeof msg.type !== 'string') return false;
  return requiredKeys.every(k => Object.prototype.hasOwnProperty.call(msg, k));
}

// ── Bounded array helper ────────────────────────────────────────
/** Push to array with a hard size cap — O(1) amortised */
function spmBoundedPush(arr, item, maxLen) {
  arr.push(item);
  if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
}

// ── Storage wrappers (Promise-based) ───────────────────────────
function spmGet(keys) {
  return new Promise(resolve => {
    try { chrome.storage.local.get(keys, r => resolve(chrome.runtime.lastError ? {} : r)); }
    catch { resolve({}); }
  });
}

function spmSet(obj) {
  return new Promise(resolve => {
    try { chrome.storage.local.set(obj, () => resolve(!chrome.runtime.lastError)); }
    catch { resolve(false); }
  });
}

function spmRemove(keys) {
  return new Promise(resolve => {
    try { chrome.storage.local.remove(keys, () => resolve(!chrome.runtime.lastError)); }
    catch { resolve(false); }
  });
}

// ── Safe message sender ─────────────────────────────────────────
function spmSend(msg) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(res);
      });
    } catch { resolve(null); }
  });
}

// ── Logging ─────────────────────────────────────────────────────
const spmLog = {
  info:  (...a) => console.info('[SPM]',  ...a),
  warn:  (...a) => console.warn('[SPM]',  ...a),
  error: (...a) => console.error('[SPM ERROR]', ...a),
};
