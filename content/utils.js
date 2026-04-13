/**
 * SPM Pro v6 · content/utils.js
 * Foundation: constants, normalisation, dedup/cache, helpers.
 * Fixes: schema validation, strong dedup keys, rate limiting, debug flag.
 */
'use strict';

// ── Debug flag ────────────────────────────────────────────────
const SPM_DEBUG = true; // Shows [SPM] logs in DevTools console

const SPM = {
  VERSION:       '6.0.0',
  MAX_HISTORY:   500,
  MAX_COMMENTS:  500,
  MAX_LOG:        50,
  MAX_MEDIA:      20,
  MAX_CACHE:     1000,
  ALLOWED_HOSTS: ['fbcdn.net','cdninstagram.com','facebook.com','instagram.com','scontent','scontent-'],
  IS_FB:  location.hostname.includes('facebook.com'),
  IS_IG:  location.hostname.includes('instagram.com'),
  PLATFORM: location.hostname.includes('facebook.com') ? 'facebook' : 'instagram',
};

// ── Structured logging (fix #6) ──────────────────────────────
const spmLog = {
  info:  (...a) => SPM_DEBUG && console.info( '%c[SPM v6]',    'color:#1877f2;font-weight:700', ...a),
  warn:  (...a) =>               console.warn( '%c[SPM WARN]',  'color:#f39c12;font-weight:700', ...a),
  error: (...a) =>               console.error('%c[SPM ERROR]', 'color:#e74c3c;font-weight:700', ...a),
  debug: (...a) => SPM_DEBUG && console.debug('%c[SPM DEBUG]', 'color:#888', ...a),
};

// ── DOM helpers ───────────────────────────────────────────────
function spmQ(s, r=document)  { try{return r.querySelector(s);}    catch(e){spmLog.error('spmQ:',s,e);return null;} }
function spmQA(s, r=document) { try{return[...r.querySelectorAll(s)];}catch(e){spmLog.error('spmQA:',s,e);return[];} }

const _elCache = new Map();
function spmEl(id)         { if(!_elCache.has(id)) _elCache.set(id,document.getElementById(id)); return _elCache.get(id); }
function spmElFresh(id)    { const el=document.getElementById(id); _elCache.set(id,el); return el; }
function spmClearElCache() { _elCache.clear(); }

// ── §3 — normalizeNumber (fix: handles all edge cases) ───────
function normalizeNumber(v) {
  if(v==null) return null;
  if(typeof v==='number') return isNaN(v)?null:Math.round(v);
  const s=String(v).replace(/,/g,'').replace(/\s+/g,'').trim();
  if(!s||/^[-–—]$/.test(s)||/^n\/a$/i.test(s)) return null;
  const n=parseFloat(s);
  if(isNaN(n)) return null;
  if(/[Bb]/.test(s)) return Math.round(n*1_000_000_000);
  if(/[Mm]/.test(s)) return Math.round(n*1_000_000);
  if(/[Kk]/.test(s)) return Math.round(n*1_000);
  return Math.round(n);
}

// ── §3 — normalizeTimestamp ───────────────────────────────────
function normalizeTimestamp(v) {
  if(v==null) return null;
  if(typeof v==='number') return v<1e12?v*1000:v;
  if(typeof v==='string') {
    const d=new Date(v.trim());
    if(!isNaN(d.getTime())) return d.getTime();
    const n=Number(v.trim());
    if(!isNaN(n)) return normalizeTimestamp(n);
  }
  return null;
}

function spmFmt(n) {
  if(n==null) return '—';
  const v=typeof n==='string'?normalizeNumber(n):n;
  if(v==null||isNaN(v)) return String(n);
  if(v>=1_000_000_000) return (v/1_000_000_000).toFixed(1).replace(/\.0$/,'')+'B';
  if(v>=1_000_000)     return (v/1_000_000).toFixed(1).replace(/\.0$/,'')+'M';
  if(v>=1_000)         return (v/1_000).toFixed(1).replace(/\.0$/,'')+'K';
  return v.toLocaleString();
}

function spmNormalise(obj) {
  if(!obj||typeof obj!=='object') return obj;
  const out={...obj};
  for(const k of ['likes','comments','shares','reach','followers','following','posts','views'])
    if(k in out) out[k]=normalizeNumber(out[k]);
  if('ts' in out) out.ts=normalizeTimestamp(out.ts)??out.ts;
  return out;
}

// ── §2 — Schema Validation (fix #2) ─────────────────────────
/**
 * validatePostSchema(data) — ensures extracted post has minimum required fields.
 * Returns { valid, errors[] }
 */
function validatePostSchema(data) {
  const errors = [];
  if (!data || typeof data !== 'object')             { return { valid: false, errors: ['data is null/non-object'] }; }
  if (!data.postId || typeof data.postId !== 'string') errors.push('missing postId');
  if (data.likes !== null && typeof data.likes !== 'number')    errors.push('likes must be number|null');
  if (data.comments !== null && typeof data.comments !== 'number') errors.push('comments must be number|null');
  if (data.ts !== null && typeof data.ts !== 'number')          errors.push('ts must be number|null');
  if (!Array.isArray(data.hashtags))                  errors.push('hashtags must be array');
  if (!Array.isArray(data.mentions))                  errors.push('mentions must be array');
  if (!Array.isArray(data.mediaUrls))                 errors.push('mediaUrls must be array');
  return { valid: errors.length === 0, errors };
}

/** safeExtract — validates a raw node before trusting it */
function safeExtract(node) {
  if (!node) return null;
  if (typeof node !== 'object') return null;
  // Must have an id or shortcode
  if (!node.id && !node.shortcode && !node.pk && !node.code) return null;
  // Must have at least one engagement signal
  const hasLikes    = node.like_count != null || node.edge_media_preview_like != null || node.edge_liked_by != null;
  const hasComments = node.comment_count != null || node.edge_media_to_comment != null;
  if (!hasLikes && !hasComments) return null;
  return node; // passes validation
}

// ── §4 — Dedup (fix #3: strong key = postId+likes+comments) ─
function SpmDedup(maxSize=1000) {
  const set=new Set();
  return {
    isNew(key) {
      if(set.has(key)) return false;
      set.add(key);
      if(set.size>maxSize){const old=[...set].slice(0,Math.floor(maxSize/4));old.forEach(k=>set.delete(k));}
      return true;
    },
    has(k){return set.has(k);},
    clear(){set.clear();},
    size(){return set.size;},
  };
}

function SpmCache(maxSize=1000) {
  const map=new Map();
  return {
    get(k){return map.get(k)??null;},
    set(k,v){map.set(k,v);if(map.size>maxSize){const old=[...map.keys()].slice(0,Math.floor(maxSize/4));old.forEach(k=>map.delete(k));}},
    has(k){return map.has(k);},
    delete(k){map.delete(k);},
    clear(){map.clear();},
    size(){return map.size;},
    values(){return[...map.values()];},
    entries(){return[...map.entries()];},
  };
}

// ── §4 — Rate limiter (fix #4) ───────────────────────────────
function spmRateLimit(fn, delayMs=1000) {
  let last=0;
  return function(...args) {
    const now=Date.now();
    if(now-last>=delayMs) { last=now; return fn.apply(this,args); }
    spmLog.debug('Rate limited, skipping call');
  };
}

// ── §5 — Structured storage (fix #5) ─────────────────────────
/**
 * Storage schema:
 *   spm_posts: { [postId]: { meta:{...}, history:[{ts,likes,comments,...}] } }
 *   spm_settings: { theme, notifications, autosave }
 */
const SpmStorage = {
  async getPost(postId) {
    const r = await spmGet(['spm_posts']);
    return (r.spm_posts ?? {})[postId] ?? null;
  },
  async saveSnapshot(snap) {
    try {
      const r     = await spmGet(['spm_posts']);
      const posts = r.spm_posts ?? {};
      const id    = snap.postId || snap.url || 'unknown';
      if (!posts[id]) posts[id] = { meta: {}, history: [] };
      // Update meta with latest values
      posts[id].meta = {
        postId:   snap.postId,
        url:      snap.url,
        username: snap.username,
        platform: snap.platform,
        mediaUrl: snap.mediaUrl,
        caption:  (snap.caption ?? '').slice(0,200),
        lastSeen: Date.now(),
      };
      // Append to history (capped at 100 per post)
      const histEntry = { ts:snap.ts||Date.now(), likes:snap.likes, comments:snap.comments,
        shares:snap.shares, reach:snap.reach, engageRate:snap.engageRate, viralScore:snap.viralScore };
      posts[id].history.push(histEntry);
      if (posts[id].history.length > 100) posts[id].history = posts[id].history.slice(-100);
      // Cap total posts stored at 50
      const keys = Object.keys(posts);
      if (keys.length > 50) {
        const oldest = keys.sort((a,b)=>(posts[a].meta.lastSeen||0)-(posts[b].meta.lastSeen||0)).slice(0,keys.length-50);
        oldest.forEach(k=>delete posts[k]);
      }
      await spmSet({ spm_posts: posts });
      return true;
    } catch(e) { spmLog.error('SpmStorage.saveSnapshot:', e); return false; }
  },
  async getAllHistory() {
    const r = await spmGet(['spm_posts']);
    const posts = r.spm_posts ?? {};
    // Flatten to array for backwards compat with charts
    const flat = [];
    Object.values(posts).forEach(p => {
      p.history.forEach(h => flat.push({ ...p.meta, ...h }));
    });
    return flat.sort((a,b)=>(a.ts||0)-(b.ts||0));
  },
  async clearAll() { return spmRemove(['spm_posts','spm_settings']); },
};

function spmBoundedPush(arr,item,maxLen) { arr.push(item); if(arr.length>maxLen) arr.splice(0,arr.length-maxLen); }
function spmDebounce(fn,ms=400) { let t; return function(...a){clearTimeout(t);t=setTimeout(()=>fn.apply(this,a),ms);}; }
function spmThrottle(fn,ms=1000) { let last=0; return function(...a){const n=Date.now();if(n-last>=ms){last=n;fn.apply(this,a);}}; }
function spmTs()   { return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function spmAgo(t) { const d=Date.now()-t,m=Math.floor(d/60_000); if(m<1)return'just now'; if(m<60)return m+'m ago'; const h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }
function spmValidateUrl(url) { try{const u=new URL(url);return u.protocol==='https:'&&SPM.ALLOWED_HOSTS.some(h=>u.hostname.includes(h));}catch{return false;} }
function spmEsc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function extractHashtags(t) { if(!t)return[]; return[...new Set((t.match(/#[\w\u0080-\uFFFF]+/g)??[]).map(x=>x.toLowerCase()))]; }
function extractMentions(t) { if(!t)return[]; return[...new Set((t.match(/@[\w.]+/g)??[]).map(x=>x.toLowerCase()))]; }
function spmGet(k)  { return new Promise(r=>{try{chrome.storage.local.get(k,res=>r(chrome.runtime.lastError?{}:res));}catch{r({});}}); }
function spmSet(o)  { return new Promise(r=>{try{chrome.storage.local.set(o,()=>r(!chrome.runtime.lastError));}catch{r(false);}}); }
function spmRemove(k){ return new Promise(r=>{try{chrome.storage.local.remove(k,()=>r(!chrome.runtime.lastError));}catch{r(false);}}); }
function spmSend(msg){ return new Promise(r=>{try{chrome.runtime.sendMessage(msg,res=>{if(chrome.runtime.lastError){r(null);return;}r(res);});}catch(e){spmLog.error('spmSend:',e);r(null);}}); }
