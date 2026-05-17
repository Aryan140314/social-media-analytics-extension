/* ============================================================
   utils.js — Foundation layer (loaded first)
   v10 — fixes: normalizeTimestamp ms/sec detection,
         unified storage (single source of truth),
         spmSend with SW wake-up retry,
         removed DEBUG flag (use SPM.DEBUG)
   ============================================================ */

'use strict';

// ─── Constants ────────────────────────────────────────────────
const SPM = {
  VERSION: '10.0.0',
  DEBUG: false,          // FIX: was true in all files — set once here, used everywhere
  MAX_HISTORY: 500,
  MAX_COMMENTS: 500,
  MAX_MEDIA: 50,         // FIX: was 20, silently truncating carousels
  MAX_CACHE: 1000,
  ALLOWED_HOSTS: ['fbcdn.net', 'cdninstagram.com', 'facebook.com', 'instagram.com'],
  IS_FB: location.hostname.includes('facebook.com'),
  IS_IG: location.hostname.includes('instagram.com'),
  get PLATFORM() { return this.IS_FB ? 'facebook' : 'instagram'; }, // FIX: was static string
};

// ─── Logging ──────────────────────────────────────────────────
function spmLog(...args) { if (SPM.DEBUG) console.log('[SPM]', ...args); }
function spmWarn(...args) { console.warn('[SPM]', ...args); }
function spmErr(...args)  { console.error('[SPM]', ...args); }

// ─── Number normalisation ─────────────────────────────────────
// "1.2K" → 1200, "3.4M" → 3400000, 42 → 42
function normalizeNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim().replace(/,/g, '');
  if (!s) return null;
  const m = s.match(/^([\d.]+)\s*([KkMmBb]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mul = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1;
  return Math.round(n * mul);
}

// ─── Timestamp normalisation ──────────────────────────────────
// FIX v10: detect seconds vs ms correctly to avoid 1000x error
// Rule: Unix timestamps < 1e10 are seconds; >= 1e10 are milliseconds.
// Current time as of 2025 is ~1.7e9 seconds / ~1.7e12 ms.
function normalizeTimestamp(v) {
  if (v == null) return null;
  let n;
  if (typeof v === 'string') {
    // ISO string or numeric string
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.getTime();
    n = parseFloat(v);
    if (isNaN(n)) return null;
  } else {
    n = v;
  }
  if (typeof n !== 'number' || isNaN(n)) return null;
  // FIX: was just "n * 1000" which would double-multiply ms timestamps
  return n < 1e10 ? Math.round(n * 1000) : Math.round(n);
}

// ─── Rolling dedup Set (auto-evicts oldest at maxSize) ────────
function SpmDedup(maxSize) {
  const _keys = []; // FIX: track insertion order for correct eviction
  const _set = new Set();
  return {
    isNew(key) {
      if (_set.has(key)) return false;
      if (_keys.length >= maxSize) {
        const oldest = _keys.shift();
        _set.delete(oldest);
      }
      _keys.push(key);
      _set.add(key);
      return true;
    },
    has(key)  { return _set.has(key); },
    clear()   { _keys.length = 0; _set.clear(); },
  };
}

// ─── LRU cache ────────────────────────────────────────────────
function SpmCache(maxSize) {
  const _map = new Map();
  return {
    get(k) { return _map.get(k) ?? null; },
    set(k, v) {
      if (_map.size >= maxSize && !_map.has(k)) {
        _map.delete(_map.keys().next().value); // evict oldest
      }
      _map.set(k, v);
    },
    has(k)  { return _map.has(k); },
    clear() { _map.clear(); },
  };
}

// ─── Rate limiter ─────────────────────────────────────────────
function spmRateLimit(fn, delayMs) {
  let timer = null;
  return function(...args) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, delayMs);
  };
}

// ─── Debounce ─────────────────────────────────────────────────
function spmDebounce(fn, delayMs) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

// ─── Storage (SINGLE source of truth) ─────────────────────────
// FIX v10: v9 had TWO separate storage namespaces:
//   - SpmStorage (content) used { [postId]: { meta, history[] } }
//   - background.js used spm_history (flat array, 200 cap)
// popup.js and SpmMonitor.getHistory() saw different data.
// v10: everything goes through SpmStorage. background.js no longer
// maintains its own spm_history. popup.js uses GET_HISTORY → background
// which now delegates to chrome.storage.local directly.
const SpmStorage = {
  _KEY: 'spm_data',

  async _load() {
    return new Promise(res => {
      chrome.storage.local.get(this._KEY, r => res(r[this._KEY] || {}));
    });
  },

  async _save(data) {
    return new Promise(res => {
      chrome.storage.local.set({ [this._KEY]: data }, res);
    });
  },

  async saveSnapshot(snap) {
    if (!snap || !snap.postId) { spmWarn('saveSnapshot: missing postId'); return; }
    const data = await this._load();
    const entry = data[snap.postId] || { meta: {}, history: [] };
    entry.meta = {
      postId: snap.postId,
      username: snap.username,
      url: snap.url,
      platform: snap.platform,
      lastSeen: Date.now(),
    };
    entry.history.push({
      ts: Date.now(),
      likes: snap.likes ?? null,
      comments: snap.comments ?? null,
      shares: snap.shares ?? null,
      reach: snap.reach ?? null,
      engagement: snap.engagement ?? null,
      viralScore: snap.viralScore ?? null,
    });
    // Cap history per post
    if (entry.history.length > SPM.MAX_HISTORY) {
      entry.history = entry.history.slice(-SPM.MAX_HISTORY);
    }
    data[snap.postId] = entry;
    await this._save(data);
    spmLog('Saved snapshot for', snap.postId);
  },

  async getAllHistory() {
    const data = await this._load();
    return Object.values(data).map(e => ({
      ...e.meta,
      history: e.history,
      latest: e.history[e.history.length - 1] || null,
    }));
  },

  async getPostHistory(postId) {
    const data = await this._load();
    return data[postId] || null;
  },

  async clearAll() {
    return new Promise(res => chrome.storage.local.remove(this._KEY, res));
  },
};

// ─── Safe chrome.runtime.sendMessage with SW wake-up ─────────
// FIX v10: MV3 service workers sleep after ~30s of inactivity.
// Sending a message to a sleeping SW throws "Could not establish
// connection." We retry once after a short pause.
async function spmSend(msg) {
  const _try = () => new Promise(res => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) { res({ error: chrome.runtime.lastError.message }); }
      else { res(response || {}); }
    });
  });
  const r1 = await _try();
  if (!r1.error) return r1;
  // Retry after 200ms (gives SW time to wake)
  await new Promise(res => setTimeout(res, 200));
  return _try();
}

// ─── Schema validation ────────────────────────────────────────
function validatePostSchema(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['not an object'] };
  if (!data.postId)     errors.push('missing postId');
  if (!data.platform)   errors.push('missing platform');
  if (!data.source)     errors.push('missing source');
  if (data.likes != null && !Number.isInteger(data.likes)) errors.push('likes not integer');
  return { valid: errors.length === 0, errors };
}

// ─── Safe node validator ──────────────────────────────────────
function safeExtract(node) {
  if (!node || typeof node !== 'object') return null;
  const id = node.id || node.pk || node.shortcode || node.code;
  if (!id) return null;
  const hasEngagement = node.like_count != null || node.edge_media_preview_like != null
    || node.likes != null || node.edge_liked_by != null;
  if (!hasEngagement) return null;
  return node;
}

// ─── URL security ─────────────────────────────────────────────
function spmValidateUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return SPM.ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

// ─── XSS prevention ───────────────────────────────────────────
function spmEsc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Formatting ───────────────────────────────────────────────
function spmFmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

// ─── Text helpers ─────────────────────────────────────────────
function extractHashtags(text) {
  if (!text) return [];
  return [...new Set((text.match(/#[\w\u00C0-\u024F]+/g) || []))];
}

function extractMentions(text) {
  if (!text) return [];
  return [...new Set((text.match(/@[\w.]+/g) || []))];
}
