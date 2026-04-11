// ═══════════════════════════════════════════════════════════════
//  SPM Pro v4  ·  content/extractor.js
//  Priority: 1) API (interceptor.js) → 2) Scoped DOM → 3) Meta
//  All values normalised to integers. Full error handling.
// ═══════════════════════════════════════════════════════════════
'use strict';

const SpmExtractor = (() => {

  // ── API cache from network interceptor ───────────────────────
  const _api      = { stats: null, profile: null, comments: [] };
  const _apiDedup = SpmDedup(2000);

  // Listen for interceptor → postMessage bridge
  window.addEventListener('message', ev => {
    if (!ev.data?.__spm) return;
    const { type, payload } = ev.data;
    try {
      if (type === 'IG_STATS' || type === 'FB_STATS') {
        _api.stats = spmNormalise({ ...(_api.stats || {}), ...payload });
        spmLog.info('API stats:', _api.stats);
        window.dispatchEvent(new CustomEvent('spm:apiStats', { detail: _api.stats }));
      }
      if (type === 'IG_PROFILE') {
        _api.profile = spmNormalise(payload);
        window.dispatchEvent(new CustomEvent('spm:apiProfile', { detail: _api.profile }));
      }
      if (type === 'IG_COMMENTS' && Array.isArray(payload?.comments)) {
        payload.comments.forEach(c => {
          const key = 'c:' + (c.id || c.username + c.text.slice(0, 20));
          if (_apiDedup.isNew(key)) spmBoundedPush(_api.comments, c, SPM.MAX_COMMENTS);
        });
        window.dispatchEvent(new CustomEvent('spm:apiComments', { detail: _api.comments }));
      }
    } catch(e) { spmLog.error('interceptor msg:', e); }
  });

  // ── Scoped post root (avoids full-DOM scan) ──────────────────
  function _root() {
    return spmQ('div[role="dialog"] article')
        || spmQ('main article')
        || spmQ('article')
        || spmQ('[role="main"]')
        || document;
  }

  // ─── Instagram DOM fallback ───────────────────────────────────
  function _igDom() {
    const r = _root(), result = {};
    try {
      // Likes
      for (const el of spmQA('span, a', r)) {
        const t = (el.innerText || '').trim();
        const m1 = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
        if (m1) { result.likes = spmParseNum(m1[1]) + 1; break; }
        const m2 = t.match(/^([\d,]+)\s+likes?$/i);
        if (m2) { result.likes = spmParseNum(m2[1]); break; }
        const m3 = t.match(/^[Ll]iked by ([\d,]+) people/);
        if (m3) { result.likes = spmParseNum(m3[1]); break; }
      }
      if (!result.likes) {
        for (const el of spmQA('[aria-label]', r)) {
          const lbl = el.getAttribute('aria-label') || '';
          if (/like/i.test(lbl) && /\d/.test(lbl)) { result.likes = spmParseNum(lbl.match(/[\d,]+/)?.[0]); break; }
        }
      }
      // Comments
      for (const el of spmQA('span, a', r)) {
        const t = (el.innerText || '').trim();
        const m1 = t.match(/[Vv]iew all ([\d,]+) comments?/);
        if (m1) { result.comments = spmParseNum(m1[1]); break; }
        const m2 = t.match(/^([\d,]+)\s+comments?$/i);
        if (m2) { result.comments = spmParseNum(m2[1]); break; }
      }
      if (!result.comments) {
        const lis = spmQA('ul > li', r).slice(1).filter(li => {
          const t = (li.innerText || '').trim();
          return t.length > 1 && !/^[Vv]iew/i.test(t);
        });
        if (lis.length) result.comments = lis.length;
      }
      // Reach
      const hasVideo = spmQA('video', r).length > 0;
      if (!hasVideo) { result.reach = null; result.reachIsNA = true; }
      else {
        for (const el of spmQA('span, div', r)) {
          const t = (el.innerText||'').trim();
          const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
          if (m) { result.reach = spmParseNum(m[1]); break; }
        }
      }
    } catch(e) { spmLog.error('_igDom:', e); }
    return result;
  }

  function _igMedia() {
    const u = new Set();
    const r = _root();
    try {
      spmQA('img[src*="cdninstagram"], img[src*="fbcdn"]', r)
        .forEach(img => { if ((img.naturalWidth||img.width) > 200) u.add(img.src); });
      // Carousel: search whole page for hidden slides
      spmQA('img[src*="cdninstagram"], img[src*="fbcdn"]')
        .forEach(img => { if ((img.naturalWidth||img.naturalHeight) > 100) u.add(img.src); });
      spmQA('video[src], video source[src]', r)
        .forEach(v => { const s = v.src||v.getAttribute('src'); if (s) u.add(s); });
      const og = spmQ('meta[property="og:image"]');
      if (og?.content) u.add(og.content);
    } catch(e) { spmLog.error('_igMedia:', e); }
    return [...u].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
  }

  function igStats() {
    const base = { platform:'instagram', url:location.href, ts:Date.now() };
    try {
      const dom = _igDom();
      if (_api.stats) {
        return { ...base, source:'api',
          likes:    _api.stats.likes    ?? dom.likes    ?? null,
          comments: _api.stats.comments ?? dom.comments ?? null,
          shares:   _api.stats.shares   ?? null,
          reach:    _api.stats.reach    ?? dom.reach    ?? null,
          reachIsNA:(_api.stats.reach == null) && !!dom.reachIsNA,
          mediaUrls:(_api.stats.mediaUrls||[]).filter(spmValidateUrl).concat(_igMedia()).slice(0,SPM.MAX_MEDIA),
        };
      }
      return { ...base, source:'dom', ...dom, mediaUrls: _igMedia() };
    } catch(e) { spmLog.error('igStats:', e); return { ...base, source:'err', mediaUrls:[] }; }
  }

  function igProfile() {
    try {
      if (_api.profile) return _api.profile;
      const p = {};
      const titleM = document.title.match(/^(.+?)\s*[•(|@-]/);
      if (titleM) p.name = titleM[1].trim();
      const hdr = spmQ('header') || spmQ('main header');
      if (hdr) {
        const av = spmQ('img[alt*="profile picture"]', hdr) || spmQ('img', hdr);
        if (av?.src && spmValidateUrl(av.src)) p.avatarSrc = av.src;
      }
      for (const el of spmQA('span, li')) {
        const t = (el.innerText||'').trim();
        const m = t.match(/^([\d,KkMm.]+)\s+(followers?|following|posts?)$/i);
        if (m) {
          const k = m[2].toLowerCase().replace(/s$/,'');
          if (k==='follower'&&!p.followers) p.followers=spmParseNum(m[1]);
          if (k==='following'&&!p.following) p.following=spmParseNum(m[1]);
          if (k==='post'&&!p.posts)          p.posts=spmParseNum(m[1]);
        }
      }
      const desc = spmQ('meta[name="description"]')?.content||'';
      const mF=desc.match(/([\d,KkMm.]+)\s*Followers/i);
      const mG=desc.match(/([\d,KkMm.]+)\s*Following/i);
      const mP=desc.match(/([\d,KkMm.]+)\s*Posts/i);
      if (mF&&!p.followers) p.followers=spmParseNum(mF[1]);
      if (mG&&!p.following) p.following=spmParseNum(mG[1]);
      if (mP&&!p.posts)     p.posts=spmParseNum(mP[1]);
      p.bio = (spmQ('meta[property="og:description"]')?.content||spmQ('meta[name="description"]')?.content||'').slice(0,200);
      return spmNormalise(p);
    } catch(e) { spmLog.error('igProfile:', e); return {}; }
  }

  function igComments() {
    try {
      if (_api.comments.length > 0) return [..._api.comments];
      const r=_root(), results=[], seen=SpmDedup(1000);
      const lis = spmQA('ul > li', r).slice(1);
      for (const li of lis) {
        const userLink = spmQA('a[href^="/"]', li).find(a=>/^\/[^/]+\/?$/.test(a.getAttribute('href')||''));
        const username = userLink?.innerText?.trim()||'?';
        let text = (li.innerText||'').trim();
        if (text.startsWith(username)) text=text.slice(username.length).trim();
        text = text.replace(/\s*(Reply|Like|[\d,]+\s*likes?)\s*$/gi,'').trim();
        if (!text||/^(Reply|View replies|Load more)/i.test(text)) continue;
        const key = username+':'+text.slice(0,40);
        if (!seen.isNew(key)) continue;
        const timeEl=spmQ('time',li);
        const likeM=(li.innerText||'').match(/(\d+)\s*likes?/i);
        if (results.length>=SPM.MAX_COMMENTS) break;
        results.push({ username, text, time:timeEl?.getAttribute('datetime')||timeEl?.innerText?.trim()||'', likes:likeM?spmParseNum(likeM[1]):null, id:null });
      }
      return results;
    } catch(e) { spmLog.error('igComments:', e); return []; }
  }

  // ─── Facebook ─────────────────────────────────────────────────
  function fbStats() {
    const base={platform:'facebook',url:location.href,ts:Date.now()};
    try {
      if (_api.stats) return {...base,source:'api',...spmNormalise(_api.stats),mediaUrls:_fbMedia()};
      const r=spmQ('[role="main"]')||spmQ('article')||document, result={};
      for (const el of spmQA('[aria-label]',r)) {
        const lbl=el.getAttribute('aria-label')||'';
        if (/\d/.test(lbl)&&/react/i.test(lbl)&&!result.likes)    result.likes=spmParseNum(lbl.match(/[\d,]+/)?.[0]);
        if (/\d/.test(lbl)&&/comment/i.test(lbl)&&!result.comments) result.comments=spmParseNum(lbl.match(/[\d,]+/)?.[0]);
        if (/\d/.test(lbl)&&/share/i.test(lbl)&&!result.shares)   result.shares=spmParseNum(lbl.match(/[\d,]+/)?.[0]);
      }
      if (!result.shares) {
        for (const el of spmQA('span,div',r)) {
          const t=(el.innerText||'').trim();
          if (/^\d[\d,KkMm]*\s*shares?/i.test(t)){result.shares=spmParseNum(t.match(/[\d,KkMm]+/)?.[0]);break;}
        }
      }
      return {...base,source:'dom',...result,mediaUrls:_fbMedia()};
    } catch(e) { spmLog.error('fbStats:',e); return {...base,source:'err',mediaUrls:[]}; }
  }
  function _fbMedia() {
    const u=new Set();
    try {
      spmQA('img[src*="fbcdn"]').forEach(img=>{if((img.naturalWidth||img.width)>200)u.add(img.src);});
      spmQA('video[src],video source[src]').forEach(v=>{const s=v.src||v.getAttribute('src');if(s)u.add(s);});
      const og=spmQ('meta[property="og:image"]');if(og?.content)u.add(og.content);
    } catch(e){spmLog.error('_fbMedia:',e);}
    return [...u].filter(spmValidateUrl).slice(0,SPM.MAX_MEDIA);
  }
  function fbProfile() {
    try {
      if (_api.profile) return _api.profile;
      const p={};
      const t=document.title.match(/^(.+?)\s*[-|•]/); if(t) p.name=t[1].trim();
      const desc=spmQ('meta[name="description"]')?.content||'';
      const mF=desc.match(/([\d,]+)\s*(friends|followers)/i); if(mF) p.followers=spmParseNum(mF[1]);
      const r=spmQ('[role="main"]')||document;
      for (const el of spmQA('span,div',r)) {
        const tx=(el.innerText||'').trim();
        if(/(followers|people follow)/i.test(tx)&&/\d/.test(tx)&&!p.followers) p.followers=spmParseNum(tx.match(/[\d,]+/)?.[0]);
      }
      const av=spmQ('img[alt*="profile"]'); if(av?.src&&spmValidateUrl(av.src)) p.avatarSrc=av.src;
      return spmNormalise(p);
    } catch(e){spmLog.error('fbProfile:',e);return{};}
  }
  function fbComments() {
    try {
      if (_api.comments.length>0) return [..._api.comments];
      const results=[],seen=SpmDedup(500);
      for (const c of spmQA('[data-testid="UFI2Comment/root"],[role="article"]')) {
        const username=spmQ('a[href*="facebook.com"]',c)?.innerText?.trim()||'?';
        const text=spmQ('[dir="auto"]',c)?.innerText?.trim()||'';
        if(!text) continue;
        const key=username+text.slice(0,40);
        if(!seen.isNew(key)) continue;
        results.push({username,text,time:spmQ('abbr,time',c)?.innerText?.trim()||'',likes:null,id:null});
        if(results.length>=SPM.MAX_COMMENTS) break;
      }
      return results;
    } catch(e){spmLog.error('fbComments:',e);return[];}
  }

  function profileGridMedia() {
    const u=new Set();
    try {
      spmQA('article img,main img,[role="main"] img').forEach(img=>{if((img.naturalWidth||img.width)>150)u.add(img.src);});
      spmQA('video[poster]').forEach(v=>{if(v.poster)u.add(v.poster);});
    } catch(e){spmLog.error('profileGridMedia:',e);}
    return [...u].filter(spmValidateUrl).slice(0,100);
  }

  function resetCache() { _api.stats=null; _api.profile=null; _api.comments=[]; _apiDedup.clear(); }

  return {
    stats:  ()=>SPM.IS_FB?fbStats():igStats(),
    profile:()=>SPM.IS_FB?fbProfile():igProfile(),
    comments:()=>SPM.IS_FB?fbComments():igComments(),
    profileGridMedia, resetCache,
    hasApiData: ()=>_api.stats!==null,
  };

})();
