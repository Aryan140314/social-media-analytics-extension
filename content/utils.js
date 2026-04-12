/**
 * SPM Pro v5 · content/utils.js
 *
 * Foundation layer — loaded first by every other module.
 * Provides: constants, DOM helpers, normalisation (§3),
 *           deduplication primitives (§4), storage wrappers,
 *           structured logging, perf utilities.
 */
'use strict';

// ─── Debug flag ───────────────────────────────────────────────
const SPM_DEBUG = false; // flip true for verbose console output

// ─── Global constants ────────────────────────────────────────
const SPM = {
  VERSION:       '5.0.0',
  MAX_HISTORY:   500,    // history entries kept in storage
  MAX_COMMENTS:  500,
  MAX_LOG:        50,
  MAX_MEDIA:      20,
  MAX_CACHE:     1000,   // items in the post / API cache
  ALLOWED_HOSTS: ['fbcdn.net', 'cdninstagram.com', 'facebook.com', 'instagram.com'],
  IS_FB:         location.hostname.includes('facebook.com'),
  IS_IG:         location.hostname.includes('instagram.com'),
  PLATFORM:      location.hostname.includes('facebook.com') ? 'facebook' : 'instagram',
};

// ─── Structured logging ──────────────────────────────────────
const spmLog = {
  info:  (...a) => SPM_DEBUG && console.info( '%c[SPM v5]',       'color:#1877f2;font-weight:700', ...a),
  warn:  (...a) =>               console.warn( '%c[SPM WARN]',     'color:#f39c12;font-weight:700', ...a),
  error: (...a) =>               console.error('%c[SPM ERROR]',    'color:#e74c3c;font-weight:700', ...a),
  debug: (...a) => SPM_DEBUG && console.debug('%c[SPM DEBUG]',    'color:#8888aa', ...a),
  group: (label, fn) => { if (!SPM_DEBUG) return; console.groupCollapsed('[SPM] ' + label); try { fn(); } finally { console.groupEnd(); } },
};

// ─── DOM helpers ─────────────────────────────────────────────
function spmQ(sel, root = document)  { try { return root.querySelector(sel);        } catch (e) { spmLog.error('spmQ:', sel, e);  return null; } }
function spmQA(sel, root = document) { try { return [...root.querySelectorAll(sel)]; } catch (e) { spmLog.error('spmQA:', sel, e); return [];   } }

const _elCache = new Map();
function spmEl(id)         { if (!_elCache.has(id)) _elCache.set(id, document.getElementById(id)); return _elCache.get(id); }
function spmElFresh(id)    { const el = document.getElementById(id); _elCache.set(id, el); return el; }
function spmClearElCache() { _elCache.clear(); }

// ═══════════════════════════════════════════════════════════
//  §3 — NORMALISATION LAYER
// ═══════════════════════════════════════════════════════════

/**
 * normalizeNumber(v) → integer | null
 *
 * Converts any representation to a plain integer.
 *   "1.2K"  → 1200
 *   "3.4M"  → 3_400_000
 *   "1.1B"  → 1_100_000_000
 *   "8,321" → 8321
 *   58      → 58
 *   null    → null
 */
function normalizeNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : Math.round(v);
  const s = String(v).replace(/,/g, '').replace(/\s+/g, '').trim();
  if (!s || /^[-–—]$/.test(s) || /^n\/a$/i.test(s)) return null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  if (/[Bb]/.test(s)) return Math.round(n * 1_000_000_000);
  if (/[Mm]/.test(s)) return Math.round(n * 1_000_000);
  if (/[Kk]/.test(s)) return Math.round(n * 1_000);
  return Math.round(n);
}

/**
 * normalizeTimestamp(v) → Unix ms | null
 *
 * Accepts:
 *   • Unix seconds (IG API): 1_700_000_000
 *   • Unix milliseconds:      1_700_000_000_000
 *   • ISO string:             "2024-01-15T10:30:00.000Z"
 *   • Relative string:        "3 hours ago" → not parseable → null
 */
function normalizeTimestamp(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    // Heuristic: IG API returns seconds; browser uses ms
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return null;
    // Try ISO / RFC strings first
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.getTime();
    // Try pure numeric string
    const n = Number(trimmed);
    if (!isNaN(n)) return normalizeTimestamp(n);
    return null; // relative strings ("3h ago") cannot be resolved here
  }
  return null;
}

/** Format integer → human-readable "1.2K" / "3.4M" */
function spmFmt(n) {
  if (n == null) return '—';
  const v = typeof n === 'string' ? normalizeNumber(n) : n;
  if (v == null || isNaN(v)) return String(n);
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(1).replace(/\.0$/, '')     + 'M';
  if (v >= 1_000)         return (v / 1_000).toFixed(1).replace(/\.0$/, '')         + 'K';
  return v.toLocaleString();
}

/** Normalise every numeric / timestamp field in an object to canonical types */
function spmNormalise(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of ['likes','comments','shares','reach','followers','following','posts','views']) {
    if (k in out) out[k] = normalizeNumber(out[k]);
  }
  if ('ts' in out) out.ts = normalizeTimestamp(out.ts) ?? out.ts;
  return out;
}

// ─── Security helpers ────────────────────────────────────────
function spmValidateUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SPM.ALLOWED_HOSTS.some(h => u.hostname.endsWith(h));
  } catch { return false; }
}
function spmEsc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ═══════════════════════════════════════════════════════════
//  §4 — DEDUPLICATION + CACHE PRIMITIVES
// ═══════════════════════════════════════════════════════════

/**
 * SpmDedup(maxSize) — rolling Set-based deduplication.
 * Evicts oldest 25 % when full so memory stays bounded.
 */
function SpmDedup(maxSize = 1000) {
  const set = new Set();
  return {
    isNew(key) {
      if (set.has(key)) return false;
      set.add(key);
      if (set.size > maxSize) {
        const evict = [...set].slice(0, Math.floor(maxSize / 4));
        evict.forEach(k => set.delete(k));
      }
      return true;
    },
    has(key)  { return set.has(key); },
    clear()   { set.clear(); },
    size()    { return set.size; },
  };
}

/**
 * SpmCache(maxSize) — Map-based LRU-ish key-value store.
 * Evicts oldest 25 % when full.
 */
function SpmCache(maxSize = 1000) {
  const map = new Map();
  return {
    get(key)        { return map.get(key) ?? null; },
    set(key, value) {
      map.set(key, value);
      if (map.size > maxSize) {
        const evict = [...map.keys()].slice(0, Math.floor(maxSize / 4));
        evict.forEach(k => map.delete(k));
      }
    },
    has(key)  { return map.has(key); },
    delete(k) { map.delete(k); },
    clear()   { map.clear(); },
    size()    { return map.size; },
    values()  { return [...map.values()]; },
    entries() { return [...map.entries()]; },
  };
}

// ─── Bounded array ───────────────────────────────────────────
function spmBoundedPush(arr, item, maxLen) {
  arr.push(item);
  if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
}

// ─── Performance helpers ─────────────────────────────────────
function spmDebounce(fn, ms = 400) {
  let t;
  return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}
function spmThrottle(fn, ms = 1000) {
  let last = 0;
  return function (...a) { const now = Date.now(); if (now - last >= ms) { last = now; fn.apply(this, a); } };
}

// ─── Time helpers ────────────────────────────────────────────
function spmTs()   { return new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
function spmAgo(t) {
  const d = Date.now() - t, m = Math.floor(d / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// ─── Storage wrappers ────────────────────────────────────────
function spmGet(keys)  { return new Promise(r => { try { chrome.storage.local.get(keys,  res => r(chrome.runtime.lastError ? {} : res)); } catch { r({}); } }); }
function spmSet(obj)   { return new Promise(r => { try { chrome.storage.local.set(obj,   ()  => r(!chrome.runtime.lastError)); } catch { r(false); } }); }
function spmRemove(k)  { return new Promise(r => { try { chrome.storage.local.remove(k, ()  => r(!chrome.runtime.lastError)); } catch { r(false); } }); }

// ─── Safe message sender ─────────────────────────────────────
function spmSend(msg) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) { spmLog.debug('sendMessage:', chrome.runtime.lastError.message); resolve(null); return; }
        resolve(res);
      });
    } catch (e) { spmLog.error('spmSend:', e); resolve(null); }
  });
}

// ─── Hashtag / mention extraction ───────────────────────────
function extractHashtags(text) {
  if (!text) return [];
  return [...new Set((text.match(/#[\w\u0080-\uFFFF]+/g) ?? []).map(t => t.toLowerCase()))];
}
function extractMentions(text) {
  if (!text) return [];
  return [...new Set((text.match(/@[\w.]+/g) ?? []).map(m => m.toLowerCase()))];
}
