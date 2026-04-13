/**
 * SPM Pro v6 · content/extractor.js
 *
 * Critical fixes:
 *  #2  Schema validation via safeExtract() + validatePostSchema()
 *  #3  Strong dedup key: postId:likes:comments (not url+byteLength)
 *  #4  Rate-limited pipeline entry (processApiPayload)
 *  DOM Comments/Shares/Reach: 4 fallback strategies each for Reels support
 */
'use strict';

const SpmExtractor = (() => {

  const _postCache    = SpmCache(SPM.MAX_CACHE);
  const _profileCache = SpmCache(200);
  const _commentCache = SpmCache(200);
  const _apiDedup     = SpmDedup(2000);
  let   _latestPost   = null;
  let   _latestProfile= null;

  // Rate-limited entry point — prevents pipeline hammering on rapid DOM mutations
  const processApiPayload = spmRateLimit(function(payload) {
    if (!payload || typeof payload !== 'object') return null;
    try { return extractPostData(payload); }
    catch(e) { spmLog.error('[Extractor] processApiPayload:', e); return null; }
  }, 800);

  // ════════════════════════════════════════════════════════
  //  PRIMARY extractPostData(apiResponse)
  // ════════════════════════════════════════════════════════
  function extractPostData(apiResponse) {
    if (!apiResponse || typeof apiResponse !== 'object') return null;
    try {
      const xdt = apiResponse?.data?.xdt_shortcode_media;
      if (safeExtract(xdt)) return _fromNode(xdt);

      const sc = apiResponse?.data?.shortcode_media;
      if (safeExtract(sc)) return _fromNode(sc);

      const edges = apiResponse?.data?.user?.edge_owner_to_timeline_media?.edges;
      if (Array.isArray(edges) && edges.length > 0) {
        _extractProfile(apiResponse?.data?.user);
        const node = edges[0]?.node;
        if (safeExtract(node)) return _fromNode(node);
      }

      const tagEdges = apiResponse?.data?.hashtag?.edge_hashtag_to_media?.edges;
      if (Array.isArray(tagEdges) && tagEdges.length > 0) {
        const node = tagEdges[0]?.node;
        if (safeExtract(node)) return _fromNode(node);
      }

      // Reels / Clips API shape
      const clip = apiResponse?.data?.xdt_api__v1__clips__home__connection_v2?.edges?.[0]?.node?.media
                ?? apiResponse?.items?.[0]
                ?? apiResponse?.media;
      if (safeExtract(clip)) return _fromNode(clip);

      return _deepWalk(apiResponse);
    } catch(e) { spmLog.error('[Extractor] extractPostData:', e); return null; }
  }

  function _fromNode(node) {
    if (!safeExtract(node)) return null;
    try {
      const likes    = normalizeNumber(node.like_count ?? node.edge_media_preview_like?.count ?? node.edge_liked_by?.count ?? null);
      const comments = normalizeNumber(node.comment_count ?? node.edge_media_to_comment?.count ?? node.edge_media_preview_comment?.count ?? null);
      const shares   = normalizeNumber(node.reshare_count ?? null);
      const reach    = normalizeNumber(node.video_view_count ?? node.play_count ?? node.view_count ?? null);
      const followers= normalizeNumber(node.owner?.edge_followed_by?.count ?? null);
      const isVideo  = !!(node.is_video || node.video_url || node.product_type === 'igtv' || node.product_type === 'clips');
      const caption  = node.edge_media_to_caption?.edges?.[0]?.node?.text ?? node.caption?.text ?? node.accessibility_caption ?? '';
      const username = node.owner?.username ?? node.user?.username ?? '';
      const mediaUrls= _collectMediaUrls(node).filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
      const ts       = normalizeTimestamp(node.taken_at_timestamp ?? node.taken_at ?? null);
      const postId   = String(node.id ?? node.shortcode ?? node.pk ?? node.code ?? '');

      const postData = {
        postId, username, followers, likes, comments, shares, reach,
        caption, hashtags: extractHashtags(caption), mentions: extractMentions(caption),
        mediaUrls, mediaUrl: mediaUrls[0] ?? '', isVideo, ts,
        source: 'api', platform: 'instagram', url: location.href,
      };

      // Schema validation (fix #2)
      const { valid, errors } = validatePostSchema(postData);
      if (!valid) spmLog.warn('[Extractor] Schema issues (non-fatal):', errors);

      // Strong dedup key: postId + likes + comments (fix #3)
      const dedupKey = `${postId}:${likes}:${comments}`;
      if (postId && _apiDedup.isNew(dedupKey)) {
        _postCache.set(postId, postData);
        _latestPost = postData;
        spmLog.info('[Extractor] ✓ Post API data:', { postId, likes, comments, shares, reach, isVideo });
      } else {
        spmLog.debug('[Extractor] Dedup skip:', dedupKey);
        return _latestPost;
      }

      if (node.owner) _extractProfile(node.owner);
      _extractComments(postId, node);
      return postData;
    } catch(e) { spmLog.error('[Extractor] _fromNode:', e); return null; }
  }

  function _collectMediaUrls(node) {
    const urls = new Set();
    const add  = u => { if (u && typeof u === 'string') urls.add(u); };
    add(node.display_url); add(node.video_url); add(node.image_versions2?.candidates?.[0]?.url);
    const sc = node.edge_sidecar_to_children?.edges ?? node.carousel_media ?? [];
    sc.forEach(e => { const n=e.node??e; add(n.display_url); add(n.video_url); add(n.image_versions2?.candidates?.[0]?.url); });
    return [...urls];
  }

  function _extractProfile(user) {
    if (!user?.username) return;
    const p = { username:user.username, name:user.full_name??'',
      followers:normalizeNumber(user.follower_count??user.edge_followed_by?.count??null),
      following:normalizeNumber(user.following_count??user.edge_follow?.count??null),
      posts:normalizeNumber(user.media_count??user.edge_owner_to_timeline_media?.count??null),
      bio:user.biography??'', avatarSrc:user.profile_pic_url_hd??user.profile_pic_url??'' };
    _profileCache.set(user.username, p);
    _latestProfile = p;
    spmLog.info('[Extractor] Profile:', user.username, 'followers:', p.followers);
  }

  function _extractComments(postId, node) {
    const edges = node?.edge_media_to_comment?.edges ?? node?.comments?.edges ?? [];
    if (!edges.length) return;
    const dedup = SpmDedup(500), list = [];
    edges.forEach(e => {
      const n=e?.node; if(!n?.text) return;
      const key=String(n.id??n.text.slice(0,30));
      if (!dedup.isNew(key)) return;
      list.push({ id:String(n.id??''), username:n.owner?.username??'?', text:n.text,
        likes:normalizeNumber(n.edge_liked_by?.count??null), ts:normalizeTimestamp(n.created_at??null),
        hashtags:extractHashtags(n.text), mentions:extractMentions(n.text) });
    });
    if (list.length && postId) _commentCache.set(postId, list);
  }

  function _deepWalk(obj, depth=0) {
    if (!obj||typeof obj!=='object'||depth>10) return null;
    if (safeExtract(obj)) { const r=_fromNode(obj); if(r) return r; }
    if (obj.username&&(obj.follower_count!=null||obj.edge_followed_by!=null)) _extractProfile(obj);
    for (const child of (Array.isArray(obj)?obj:Object.values(obj))) {
      if (child&&typeof child==='object') { const r=_deepWalk(child,depth+1); if(r) return r; }
    }
    return null;
  }

  // ════════════════════════════════════════════════════════
  //  DOM FALLBACK — 4 strategies per field, Reels-aware
  //  THIS IS THE FIX FOR Comments / Shares / Reach = "—"
  // ════════════════════════════════════════════════════════
  function _root() {
    return spmQ('div[role="dialog"] article') ?? spmQ('main article')
        ?? spmQ('article') ?? spmQ('[role="main"]') ?? document;
  }

  function _igDomStats() {
    const r = _root();
    const result = { source: 'dom' };

    // ── LIKES (4 strategies) ─────────────────────────────
    // S1: "Liked by X and N others"
    for (const el of spmQA('span, a', r)) {
      const t = (el.innerText ?? '').trim();
      const m1 = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
      if (m1) { result.likes = normalizeNumber(m1[1]) + 1; break; }
      const m2 = t.match(/^([\d,]+)\s+likes?$/i);
      if (m2) { result.likes = normalizeNumber(m2[1]); break; }
    }
    // S2: aria-label on like/heart button
    if (result.likes == null) {
      for (const el of spmQA('[aria-label]', r)) {
        const lbl = el.getAttribute('aria-label') ?? '';
        if (/like/i.test(lbl) && /\d/.test(lbl)) { result.likes = normalizeNumber(lbl.match(/[\d,]+/)?.[0]); break; }
      }
    }
    // S3: section span counts (Reels feed)
    if (result.likes == null) {
      for (const el of spmQA('section span span, section a span, [class*="count"] span')) {
        const t = (el.innerText ?? '').trim();
        if (/^[\d,.]+[KkMmBb]?$/.test(t) && t !== '0') { result.likes = normalizeNumber(t); break; }
      }
    }

    // ── COMMENTS (4 strategies) ──────────────────────────
    // S1: "View all N comments" or "N comments"
    for (const el of spmQA('span, a', r)) {
      const t = (el.innerText ?? '').trim();
      const m1 = t.match(/[Vv]iew all ([\d,]+) comments?/);
      if (m1) { result.comments = normalizeNumber(m1[1]); break; }
      const m2 = t.match(/^([\d,]+)\s+comments?$/i);
      if (m2) { result.comments = normalizeNumber(m2[1]); break; }
    }
    // S2: aria-label containing "comment" + digit
    if (result.comments == null) {
      for (const el of spmQA('[aria-label]', r)) {
        const lbl = (el.getAttribute('aria-label') ?? '');
        if (/comment/i.test(lbl) && /\d/.test(lbl)) {
          result.comments = normalizeNumber(lbl.match(/[\d,]+/)?.[0]); break;
        }
      }
    }
    // S3: Reels vertical layout — numeric span below comment icon
    if (result.comments == null) {
      const commentSvgs = spmQA('svg[aria-label*="omment"], svg[aria-label*="Comment"]', r);
      commentSvgs.forEach(svg => {
        const container = svg.closest('div') ?? svg.parentElement;
        if (!container) return;
        // Look for sibling/child span with a number
        const spans = spmQA('span', container.parentElement ?? container);
        for (const sp of spans) {
          const t = (sp.innerText ?? '').trim();
          if (/^[\d,.]+[KkMmBb]?$/.test(t)) { result.comments = normalizeNumber(t); break; }
        }
      });
    }
    // S4: count visible comment <li> rows
    if (result.comments == null) {
      const lis = spmQA('ul > li', r).slice(1).filter(li => {
        const t = (li.innerText ?? '').trim();
        return t.length > 1 && !/^[Vv]iew/i.test(t) && !/^(Reply|Load)/i.test(t);
      });
      if (lis.length > 0) result.comments = lis.length;
    }

    // ── SHARES (3 strategies) ────────────────────────────
    // S1: aria-label with "share" or "send" + number
    for (const el of spmQA('[aria-label]', r)) {
      const lbl = (el.getAttribute('aria-label') ?? '');
      if (/share|send/i.test(lbl) && /\d/.test(lbl)) {
        result.shares = normalizeNumber(lbl.match(/[\d,]+/)?.[0]); break;
      }
    }
    // S2: text "N shares"
    if (result.shares == null) {
      for (const el of spmQA('span, div', r)) {
        const t = (el.innerText ?? '').trim();
        if (/^\d[\d,KkMm]*\s*shares?$/i.test(t)) { result.shares = normalizeNumber(t.match(/[\d,KkMm]+/)?.[0]); break; }
      }
    }
    // S3: Reels send/share SVG sibling count
    if (result.shares == null) {
      const shareSvgs = spmQA('svg[aria-label*="hare"], svg[aria-label*="end"]', r);
      shareSvgs.forEach(svg => {
        const container = svg.closest('div') ?? svg.parentElement;
        if (!container) return;
        const spans = spmQA('span', container.parentElement ?? container);
        for (const sp of spans) {
          const t = (sp.innerText ?? '').trim();
          if (/^[\d,.]+[KkMmBb]?$/.test(t)) { result.shares = normalizeNumber(t); break; }
        }
      });
    }

    // ── REACH / VIEWS (4 strategies) ────────────────────
    const hasVideo = spmQA('video', r).length > 0 || spmQA('video').length > 0;

    if (!hasVideo) {
      result.reach = null; result.reachIsNA = true;
    } else {
      // S1: exact "N views" or "N plays"
      for (const el of spmQA('span, div, strong', r)) {
        const t = (el.innerText ?? '').trim();
        const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
        if (m) { result.reach = normalizeNumber(m[1]); break; }
      }
      // S2: number immediately before/after "views" sibling
      if (result.reach == null) {
        for (const el of spmQA('span, strong')) {
          const t    = (el.innerText ?? '').trim();
          const nxt  = (el.nextElementSibling?.innerText ?? '').trim();
          const prv  = (el.previousElementSibling?.innerText ?? '').trim();
          if (/views?|plays?/i.test(nxt) && /^[\d,.]+[KkMmBb]?$/.test(t)) { result.reach = normalizeNumber(t); break; }
          if (/views?|plays?/i.test(prv) && /^[\d,.]+[KkMmBb]?$/.test(t)) { result.reach = normalizeNumber(t); break; }
        }
      }
      // S3: inline "N views" pattern anywhere on page
      if (result.reach == null) {
        for (const el of spmQA('span, div')) {
          const t = (el.innerText ?? '').trim();
          if (t.length > 50) continue; // skip large blobs
          const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)\s*$/i);
          if (m) { result.reach = normalizeNumber(m[1]); break; }
        }
      }
      // S4: video aria-label
      if (result.reach == null) {
        for (const vid of spmQA('video, [aria-label*="view"], [aria-label*="View"]')) {
          const lbl = vid.getAttribute('aria-label') ?? '';
          const m   = lbl.match(/([\d,.]+[KkMmBb]?)\s*views?/i);
          if (m) { result.reach = normalizeNumber(m[1]); break; }
        }
      }
    }

    result.caption   = spmQ('meta[property="og:description"]')?.content ?? '';
    result.hashtags  = extractHashtags(result.caption);
    result.mentions  = extractMentions(result.caption);
    result.mediaUrls = _igDomMedia();
    result.mediaUrl  = result.mediaUrls[0] ?? '';
    result.isVideo   = hasVideo;

    spmLog.info('[Extractor DOM] likes:', result.likes,
      '| comments:', result.comments,
      '| shares:', result.shares,
      '| reach:', result.reach);

    return result;
  }

  function _igDomMedia() {
    const u = new Set(); const r = _root();
    try {
      spmQA('img[src*="cdninstagram"],img[src*="fbcdn"],img[src*="scontent"]', r)
        .forEach(img=>{if((img.naturalWidth??img.width)>200)u.add(img.src);});
      spmQA('img[src*="cdninstagram"],img[src*="fbcdn"],img[src*="scontent"]')
        .forEach(img=>{if((img.naturalWidth??img.naturalHeight)>100)u.add(img.src);});
      spmQA('video[src],video source[src]',r)
        .forEach(v=>{const s=v.src??v.getAttribute('src');if(s)u.add(s);});
      const og=spmQ('meta[property="og:image"]');
      if(og?.content) u.add(og.content);
    } catch(e){spmLog.error('[Extractor] _igDomMedia:',e);}
    return [...u].filter(spmValidateUrl).slice(0,SPM.MAX_MEDIA);
  }

  function _fbDomStats() {
    const base={platform:'facebook',url:location.href,ts:Date.now(),source:'dom',hashtags:[],mentions:[],mediaUrls:[]};
    try {
      const r=spmQ('[role="main"]')??document; const result={};
      for(const el of spmQA('[aria-label]',r)){
        const lbl=el.getAttribute('aria-label')??'';
        if(/\d/.test(lbl)&&/react/i.test(lbl)&&!result.likes)    result.likes=normalizeNumber(lbl.match(/[\d,]+/)?.[0]);
        if(/\d/.test(lbl)&&/comment/i.test(lbl)&&!result.comments) result.comments=normalizeNumber(lbl.match(/[\d,]+/)?.[0]);
        if(/\d/.test(lbl)&&/share/i.test(lbl)&&!result.shares)   result.shares=normalizeNumber(lbl.match(/[\d,]+/)?.[0]);
      }
      return{...base,...result};
    } catch(e){spmLog.error('[Extractor] _fbDomStats:',e);return base;}
  }

  function stats() {
    const base={platform:SPM.PLATFORM,url:location.href,ts:Date.now()};
    try {
      if(!SPM.IS_IG) return _fbDomStats();
      const dom=_igDomStats();
      if(_latestPost){
        return{...base,..._latestPost,
          likes:   _latestPost.likes    ??dom.likes    ??null,
          comments:_latestPost.comments ??dom.comments ??null,
          shares:  _latestPost.shares   ??dom.shares   ??null,
          reach:   _latestPost.reach    ??dom.reach    ??null,
          reachIsNA:(_latestPost.reach==null)&&!!dom.reachIsNA,
          mediaUrls:[...new Set([...(_latestPost.mediaUrls??[]),...(dom.mediaUrls??[])])].filter(spmValidateUrl).slice(0,SPM.MAX_MEDIA),
          source:'api'};
      }
      return{...base,...dom,postId:'',username:'',followers:null,
        hashtags:dom.hashtags??[],mentions:dom.mentions??[]};
    } catch(e){spmLog.error('[Extractor] stats:',e);return{...base,source:'error',mediaUrls:[]};}
  }

  function profile() {
    try {
      if(_latestProfile) return _latestProfile;
      const p={};
      const tm=document.title.match(/^(.+?)\s*[•(|@-]/);if(tm)p.name=tm[1].trim();
      const hdr=spmQ('header')??spmQ('main header');
      if(hdr){const av=spmQ('img[alt*="profile picture"]',hdr)??spmQ('img',hdr);if(av?.src&&spmValidateUrl(av.src))p.avatarSrc=av.src;}
      for(const el of spmQA('span,li')){
        const t=(el.innerText??'').trim();
        const m=t.match(/^([\d,KkMm.]+)\s+(followers?|following|posts?)$/i);
        if(m){const k=m[2].toLowerCase().replace(/s$/,'');
          if(k==='follower'&&!p.followers)p.followers=normalizeNumber(m[1]);
          if(k==='following'&&!p.following)p.following=normalizeNumber(m[1]);
          if(k==='post'&&!p.posts)p.posts=normalizeNumber(m[1]);}
      }
      const desc=spmQ('meta[name="description"]')?.content??'';
      [/([\d,KkMm.]+)\s*Followers/i,/([\d,KkMm.]+)\s*Following/i,/([\d,KkMm.]+)\s*Posts/i]
        .forEach((re,i)=>{const m=desc.match(re);if(m){const keys=['followers','following','posts'];if(!p[keys[i]])p[keys[i]]=normalizeNumber(m[1]);}});
      p.bio=(spmQ('meta[property="og:description"]')?.content??'').slice(0,300);
      return p;
    } catch(e){spmLog.error('[Extractor] profile:',e);return{};}
  }

  function comments(postId) {
    if(postId&&_commentCache.has(postId)) return _commentCache.get(postId);
    if(_latestPost?.postId&&_commentCache.has(_latestPost.postId)) return _commentCache.get(_latestPost.postId);
    return _igDomComments();
  }

  function _igDomComments() {
    const r=_root(),results=[],seen=SpmDedup(1000);
    try {
      spmQA('ul>li',r).slice(1).forEach(li=>{
        const ul=spmQA('a[href^="/"]',li).find(a=>/^\/[^/]+\/?$/.test(a.getAttribute('href')??''));
        const username=ul?.innerText?.trim()??'?';
        let text=(li.innerText??'').trim();
        if(text.startsWith(username))text=text.slice(username.length).trim();
        text=text.replace(/\s*(Reply|Like|[\d,]+\s*likes?)\s*$/gi,'').trim();
        if(!text||/^(Reply|View replies|Load more)/i.test(text)) return;
        if(!seen.isNew(username+':'+text.slice(0,40))) return;
        const timeEl=spmQ('time',li);
        const likeM=(li.innerText??'').match(/(\d+)\s*likes?/i);
        if(results.length<SPM.MAX_COMMENTS)
          results.push({id:null,username,text,likes:likeM?normalizeNumber(likeM[1]):null,
            ts:normalizeTimestamp(timeEl?.getAttribute('datetime')??null),
            hashtags:extractHashtags(text),mentions:extractMentions(text)});
      });
    } catch(e){spmLog.error('[Extractor] _igDomComments:',e);}
    return results;
  }

  function profileGridMedia() {
    const u=new Set();
    try {
      spmQA('article img,main img,[role="main"] img').forEach(img=>{if((img.naturalWidth??img.width)>150)u.add(img.src);});
      spmQA('video[poster]').forEach(v=>{if(v.poster)u.add(v.poster);});
    } catch(e){spmLog.error('[Extractor] profileGridMedia:',e);}
    return[...u].filter(spmValidateUrl).slice(0,100);
  }

  function resetCache() {
    _postCache.clear();_profileCache.clear();_commentCache.clear();_apiDedup.clear();
    _latestPost=null;_latestProfile=null;
    spmLog.info('[Extractor] Cache reset');
  }

  return {
    extractPostData, processApiPayload,
    stats, profile, comments, profileGridMedia, resetCache,
    getPostCache:()=>_postCache, getProfileCache:()=>_profileCache,
    getLatestPost:()=>_latestPost, hasApiData:()=>_latestPost!==null,
  };

})();
