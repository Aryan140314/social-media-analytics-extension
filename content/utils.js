/**
 * SPM Pro v8 · content/utils.js
 * Foundation layer — loaded first by every module.
 */
'use strict';

// ── Global debug flag ────────────────────────────────────────
// FIX #8: DEBUG flag controls all pipeline logging
const SPM_DEBUG = true;

// ── Constants ────────────────────────────────────────────────
const SPM = {
  VERSION:       '8.0.0',
  MAX_HISTORY:   500,
  MAX_COMMENTS:  500,
  MAX_LOG:        50,
  MAX_MEDIA:      20,
  MAX_CACHE:     1000,
  ALLOWED_HOSTS: ['fbcdn.net','cdninstagram.com','facebook.com','instagram.com','scontent'],
  IS_FB:  location.hostname.includes('facebook.com'),
  IS_IG:  location.hostname.includes('instagram.com'),
  PLATFORM: location.hostname.includes('facebook.com') ? 'facebook' : 'instagram',
};

// ── Structured logging ───────────────────────────────────────
const spmLog = {
  info:  (...a) => SPM_DEBUG && console.info( '%c[SPM]',       'color:#1877f2;font-weight:700', ...a),
  warn:  (...a) =>               console.warn( '%c[SPM WARN]',  'color:#f39c12;font-weight:700', ...a),
  error: (...a) =>               console.error('%c[SPM ERROR]', 'color:#e74c3c;font-weight:700', ...a),
  debug: (...a) => SPM_DEBUG && console.debug('%c[SPM DBG]',   'color:#888', ...a),
  pipe:  (...a) => SPM_DEBUG && console.info( '%c[SPM PIPE]',  'color:#27ae60;font-weight:700', ...a),
};

// ── DOM helpers ──────────────────────────────────────────────
function spmQ(s,r=document)  { try{return r.querySelector(s);}    catch(e){spmLog.error('spmQ:',s,e);return null;} }
function spmQA(s,r=document) { try{return[...r.querySelectorAll(s)];}catch(e){spmLog.error('spmQA:',s,e);return[];} }

const _elCache = new Map();
function spmEl(id)         { if(!_elCache.has(id))_elCache.set(id,document.getElementById(id)); return _elCache.get(id); }
function spmElFresh(id)    { const el=document.getElementById(id); _elCache.set(id,el); return el; }
function spmClearElCache() { _elCache.clear(); }

// ── normalizeNumber — FIX #6: no crashes on undefined/null ───
function normalizeNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : Math.round(v);
  const s = String(v).replace(/,/g,'').replace(/\s+/g,'').trim();
  if (!s || /^[-–—]$/.test(s) || /^n\/a$/i.test(s)) return null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  if (/[Bb]/.test(s)) return Math.round(n * 1_000_000_000);
  if (/[Mm]/.test(s)) return Math.round(n * 1_000_000);
  if (/[Kk]/.test(s)) return Math.round(n * 1_000);
  return Math.round(n);
}

// ── normalizeTimestamp ───────────────────────────────────────
function normalizeTimestamp(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const d = new Date(v.trim());
    if (!isNaN(d.getTime())) return d.getTime();
    const n = Number(v.trim());
    if (!isNaN(n)) return normalizeTimestamp(n);
  }
  return null;
}

// ── Format number ────────────────────────────────────────────
function spmFmt(n) {
  if (n == null) return '—';
  const v = typeof n === 'string' ? normalizeNumber(n) : n;
  if (v == null || isNaN(v)) return String(n);
  if (v >= 1_000_000_000) return (v/1e9).toFixed(1).replace(/\.0$/,'')+'B';
  if (v >= 1_000_000)     return (v/1e6).toFixed(1).replace(/\.0$/,'')+'M';
  if (v >= 1_000)         return (v/1e3).toFixed(1).replace(/\.0$/,'')+'K';
  return v.toLocaleString();
}

// ── Normalise stats object ───────────────────────────────────
function spmNormalise(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {...obj};
  for (const k of ['likes','comments','shares','reach','followers','following','posts','views'])
    if (k in out) out[k] = normalizeNumber(out[k]);
  if ('ts' in out) out.ts = normalizeTimestamp(out.ts) ?? out.ts;
  return out;
}

// ── Schema validation — FIX #6 ──────────────────────────────
function validatePostSchema(data) {
  const errors = [];
  if (!data || typeof data !== 'object')        { return { valid:false, errors:['not an object'] }; }
  if (!data.postId)                             errors.push('missing postId');
  if (data.likes    !== null && typeof data.likes    !== 'number') errors.push('likes must be number|null');
  if (data.comments !== null && typeof data.comments !== 'number') errors.push('comments must be number|null');
  if (!Array.isArray(data.hashtags))            errors.push('hashtags must be array');
  if (!Array.isArray(data.mediaUrls))           errors.push('mediaUrls must be array');
  return { valid: errors.length === 0, errors };
}

// ── safeExtract — validates raw API node before trusting it ──
function safeExtract(node) {
  if (!node || typeof node !== 'object') return null;
  const hasId  = node.id || node.shortcode || node.pk || node.code;
  const hasEng = node.like_count != null || node.edge_media_preview_like != null
              || node.edge_liked_by != null || node.comment_count != null;
  if (!hasId && !hasEng) return null;
  return node;
}

// ── Security ─────────────────────────────────────────────────
function spmValidateUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SPM.ALLOWED_HOSTS.some(h => u.hostname.includes(h));
  } catch { return false; }
}
function spmEsc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Dedup (rolling Set) — FIX #7 ────────────────────────────
// Key must be post.id + value snapshot, NOT url+byteLength
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
    has(k)  { return set.has(k); },
    clear() { set.clear(); },
    size()  { return set.size; },
  };
}

// ── Cache (Map-based LRU-ish) ────────────────────────────────
function SpmCache(maxSize = 1000) {
  const map = new Map();
  return {
    get(k)        { return map.get(k) ?? null; },
    set(k, v)     { map.set(k, v); if (map.size > maxSize) { const evict=[...map.keys()].slice(0,Math.floor(maxSize/4)); evict.forEach(k=>map.delete(k)); } },
    has(k)        { return map.has(k); },
    delete(k)     { map.delete(k); },
    clear()       { map.clear(); },
    size()        { return map.size; },
    values()      { return [...map.values()]; },
  };
}

// ── Performance helpers ──────────────────────────────────────
function spmBoundedPush(arr, item, maxLen) { arr.push(item); if (arr.length > maxLen) arr.splice(0, arr.length - maxLen); }
function spmDebounce(fn, ms=400) { let t; return function(...a){clearTimeout(t);t=setTimeout(()=>fn.apply(this,a),ms);}; }
function spmThrottle(fn, ms=1000){ let l=0; return function(...a){const n=Date.now();if(n-l>=ms){l=n;fn.apply(this,a);}}; }
function spmRateLimit(fn, ms=800){ let l=0; return function(...a){const n=Date.now();if(n-l>=ms){l=n;return fn.apply(this,a);}}; }

// ── Time helpers ─────────────────────────────────────────────
function spmTs()   { return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function spmAgo(t) { const d=Date.now()-t,m=Math.floor(d/60000); if(m<1)return'just now'; if(m<60)return m+'m ago'; const h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }

// ── Text extractors ──────────────────────────────────────────
function extractHashtags(t) { if(!t)return[]; return[...new Set((t.match(/#[\w\u0080-\uFFFF]+/g)??[]).map(x=>x.toLowerCase()))]; }
function extractMentions(t) { if(!t)return[]; return[...new Set((t.match(/@[\w.]+/g)??[]).map(x=>x.toLowerCase()))]; }

// ── Storage helpers ──────────────────────────────────────────
function spmGet(k)  { return new Promise(r=>{try{chrome.storage.local.get(k,res=>r(chrome.runtime.lastError?{}:res));}catch{r({});}}); }
function spmSet(o)  { return new Promise(r=>{try{chrome.storage.local.set(o,()=>r(!chrome.runtime.lastError));}catch{r(false);}}); }
function spmRemove(k){ return new Promise(r=>{try{chrome.storage.local.remove(k,()=>r(!chrome.runtime.lastError));}catch{r(false);}}); }

// ── Safe chrome.runtime.sendMessage — FIX #12 ───────────────
// Handles disconnected ports, missing receivers, and null responses
function spmSend(msg) {
  return new Promise(resolve => {
    try {
      if (!chrome?.runtime?.sendMessage) { resolve(null); return; }
      chrome.runtime.sendMessage(msg, res => {
        const err = chrome.runtime.lastError;
        if (err) {
          spmLog.debug('spmSend:', err.message);
          resolve(null);
          return;
        }
        resolve(res ?? null);
      });
    } catch (e) {
      spmLog.error('spmSend threw:', e.message);
      resolve(null);
    }
  });
}

// ── Structured post storage (indexed by postId) — FIX #5 ────
const SpmStorage = {
  async getPost(postId) {
    try {
      const r = await spmGet(['spm_posts']);
      return (r.spm_posts ?? {})[postId] ?? null;
    } catch (e) { spmLog.error('SpmStorage.getPost:', e); return null; }
  },
  async saveSnapshot(snap) {
    try {
      if (!snap) return false;
      // FIX #6: ensure postId always exists
      const id = snap.postId
        || location.href.split('/p/')?.[1]?.split('/')?.[0]
        || location.href.split('/reel/')?.[1]?.split('/')?.[0]
        || String(Date.now());

      const r     = await spmGet(['spm_posts']);
      const posts = r.spm_posts ?? {};
      if (!posts[id]) posts[id] = { meta:{}, history:[] };

      posts[id].meta = {
        postId:   id,
        url:      snap.url ?? location.href,
        username: snap.username ?? '',
        platform: snap.platform ?? SPM.PLATFORM,
        mediaUrl: snap.mediaUrl ?? '',
        caption:  (snap.caption ?? '').slice(0,200),
        lastSeen: Date.now(),
      };

      const entry = {
        ts:          snap.ts || Date.now(),
        likes:       snap.likes       ?? null,
        comments:    snap.comments    ?? null,
        shares:      snap.shares      ?? null,
        reach:       snap.reach       ?? null,
        engageRate:  snap.engageRate  ?? null,
        viralScore:  snap.viralScore  ?? null,
      };
      posts[id].history.push(entry);
      if (posts[id].history.length > 100) posts[id].history = posts[id].history.slice(-100);

      // Cap total posts at 50
      const keys = Object.keys(posts);
      if (keys.length > 50) {
        keys.sort((a,b) => (posts[a].meta.lastSeen||0) - (posts[b].meta.lastSeen||0))
            .slice(0, keys.length - 50)
            .forEach(k => delete posts[k]);
      }

      await spmSet({ spm_posts: posts });
      return true;
    } catch (e) { spmLog.error('SpmStorage.saveSnapshot:', e); return false; }
  },
  async getAllHistory() {
    try {
      const r = await spmGet(['spm_posts']);
      const posts = r.spm_posts ?? {};
      const flat = [];
      Object.values(posts).forEach(p =>
        p.history.forEach(h => flat.push({ ...p.meta, ...h }))
      );
      return flat.sort((a,b) => (a.ts||0) - (b.ts||0));
    } catch (e) { spmLog.error('SpmStorage.getAllHistory:', e); return []; }
  },
  async clearAll() {
    try { return spmRemove(['spm_posts','spm_settings']); }
    catch (e) { spmLog.error('SpmStorage.clearAll:', e); return false; }
  },
};
