// ═══════════════════════════════════════════════════════════════
//  SPM Pro v4  ·  content/utils.js
// ═══════════════════════════════════════════════════════════════
'use strict';

const SPM_DEBUG = false; // set true to enable verbose console logs

const SPM = {
  VERSION:       '4.0.0',
  MAX_HISTORY:   200,
  MAX_COMMENTS:  500,
  MAX_LOG:        50,
  MAX_MEDIA:      20,
  ALLOWED_HOSTS: ['fbcdn.net','cdninstagram.com','facebook.com','instagram.com'],
  IS_FB:         location.hostname.includes('facebook.com'),
  IS_IG:         location.hostname.includes('instagram.com'),
  PLATFORM:      location.hostname.includes('facebook.com') ? 'facebook' : 'instagram',
};

const spmLog = {
  info:  (...a) => SPM_DEBUG && console.info( '[SPM]',       ...a),
  warn:  (...a) =>               console.warn( '[SPM WARN]',  ...a),
  error: (...a) =>               console.error('[SPM ERROR]', ...a),
  debug: (...a) => SPM_DEBUG && console.debug('[SPM DEBUG]', ...a),
};

function spmQ(sel, root=document)  { try{return root.querySelector(sel);}    catch(e){spmLog.error('spmQ',sel,e);return null;} }
function spmQA(sel, root=document) { try{return[...root.querySelectorAll(sel)];}catch(e){spmLog.error('spmQA',sel,e);return[];} }

const _elCache = new Map();
function spmEl(id)         { if(!_elCache.has(id)) _elCache.set(id,document.getElementById(id)); return _elCache.get(id); }
function spmElFresh(id)    { const el=document.getElementById(id); _elCache.set(id,el); return el; }
function spmClearElCache() { _elCache.clear(); }

// Number normalisation — always stores/returns integers, not strings
function spmParseNum(v) {
  if(v==null) return null;
  if(typeof v==='number') return Math.round(v);
  const s=String(v).replace(/,/g,'').replace(/\s+/g,'').trim();
  if(!s||s==='—'||s.startsWith('N/A')) return null;
  const n=parseFloat(s);
  if(isNaN(n)) return null;
  if(/[Mm]/.test(s)) return Math.round(n*1_000_000);
  if(/[Kk]/.test(s)) return Math.round(n*1_000);
  return Math.round(n);
}
function spmFmt(n) {
  if(n==null) return '—';
  const v=typeof n==='string'?spmParseNum(n):n;
  if(v==null||isNaN(v)) return String(n);
  if(v>=1_000_000) return (v/1_000_000).toFixed(1).replace(/\.0$/,'')+'M';
  if(v>=1_000)     return (v/1_000).toFixed(1).replace(/\.0$/,'')+'K';
  return v.toLocaleString();
}
function spmEngagement(likes,comments,followers) {
  const l=spmParseNum(likes)||0, c=spmParseNum(comments)||0, f=spmParseNum(followers);
  if(!f||f<=0) return null;
  return((l+c)/f*100).toFixed(2)+'%';
}
// Normalise stats object: all numeric fields become integers
function spmNormalise(stats) {
  const n={...stats};
  for(const key of ['likes','comments','shares','reach','followers','following','posts']) {
    if(key in n) n[key]=spmParseNum(n[key]);
  }
  return n;
}

function spmTs()   { return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function spmAgo(t) {
  const d=Date.now()-t,m=Math.floor(d/60_000);
  if(m<1)  return 'just now';
  if(m<60) return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}

function spmDebounce(fn,delay=400)  { let t; return function(...a){clearTimeout(t);t=setTimeout(()=>fn.apply(this,a),delay);}; }
function spmThrottle(fn,limit=1000) { let last=0; return function(...a){const n=Date.now();if(n-last>=limit){last=n;fn.apply(this,a);}}; }

function spmValidateUrl(url) {
  try { const u=new URL(url); return u.protocol==='https:'&&SPM.ALLOWED_HOSTS.some(h=>u.hostname.endsWith(h)); }
  catch{return false;}
}
function spmEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function spmValidateMsg(msg,required=[]) {
  if(!msg||typeof msg!=='object') return false;
  if(!msg.type||typeof msg.type!=='string') return false;
  return required.every(k=>Object.prototype.hasOwnProperty.call(msg,k));
}

function spmBoundedPush(arr,item,maxLen) { arr.push(item); if(arr.length>maxLen) arr.splice(0,arr.length-maxLen); }

// Rolling dedup set
function SpmDedup(maxSize=1000) {
  const set=new Set();
  return {
    isNew(key) {
      if(set.has(key)) return false;
      set.add(key);
      if(set.size>maxSize){const first=set.values().next().value;set.delete(first);}
      return true;
    },
    clear(){set.clear();},
  };
}

function spmGet(keys) { return new Promise(r=>{try{chrome.storage.local.get(keys,res=>r(chrome.runtime.lastError?{}:res));}catch{r({});}}); }
function spmSet(obj)  { return new Promise(r=>{try{chrome.storage.local.set(obj,()=>r(!chrome.runtime.lastError));}catch{r(false);}}); }
function spmRemove(k) { return new Promise(r=>{try{chrome.storage.local.remove(k,()=>r(!chrome.runtime.lastError));}catch{r(false);}}); }
function spmSend(msg) {
  return new Promise(r=>{
    try { chrome.runtime.sendMessage(msg,res=>{ if(chrome.runtime.lastError){spmLog.debug('sendMessage:',chrome.runtime.lastError.message);r(null);return;}r(res);}); }
    catch(e){spmLog.error('spmSend',e);r(null);}
  });
}
