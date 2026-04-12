/**
 * SPM Pro v5 · content/extractor.js
 *
 * Data extraction layer.
 *
 * PRIMARY  : extractPostData(apiResponse)  — parses raw GraphQL JSON
 * FALLBACK : stats() / profile() / comments()  — DOM scraping
 *
 * Every returned PostData object is normalised (integers not strings)
 * and deduplicated via an internal Map cache.
 *
 * PostData schema (spec §2):
 * {
 *   postId     : string
 *   username   : string
 *   followers  : number | null
 *   likes      : number | null
 *   comments   : number | null
 *   caption    : string
 *   hashtags   : string[]
 *   mentions   : string[]
 *   mediaUrls  : string[]
 *   mediaUrl   : string          ← primary (first) media URL
 *   isVideo    : boolean
 *   ts         : number | null   ← Unix ms
 *   source     : 'api' | 'dom'
 *   platform   : 'instagram' | 'facebook'
 *   url        : string
 *   shares     : number | null
 *   reach      : number | null
 * }
 */
'use strict';

const SpmExtractor = (() => {

  // ── Internal state ────────────────────────────────────────
  // Post cache: postId → PostData  (deduplication + fast lookup)
  const _postCache    = SpmCache(SPM.MAX_CACHE);
  // Profile cache: username → ProfileData
  const _profileCache = SpmCache(200);
  // Raw comment cache: postId → Comment[]
  const _commentCache = SpmCache(200);
  // Dedup for incoming API payloads
  const _apiDedup     = SpmDedup(2000);

  // ── Latest extracted data (for UI consumption) ────────────
  let _latestPost    = null;
  let _latestProfile = null;

  // ════════════════════════════════════════════════════════
  //  PRIMARY — extractPostData(apiResponse)  (spec §2)
  //
  //  Accepts the raw JSON object forwarded by interceptor.js.
  //  Walks all known IG GraphQL shapes and returns a
  //  normalised PostData object, or null if nothing found.
  // ════════════════════════════════════════════════════════
  function extractPostData(apiResponse) {
    if (!apiResponse || typeof apiResponse !== 'object') return null;

    try {
      // ── Shape A: xdt_shortcode_media  (modern single-post) ──
      const xdt = apiResponse?.data?.xdt_shortcode_media;
      if (xdt) return _fromMediaNode(xdt);

      // ── Shape B: shortcode_media  (legacy) ───────────────
      const sc = apiResponse?.data?.shortcode_media;
      if (sc)  return _fromMediaNode(sc);

      // ── Shape C: timeline / feed edges ───────────────────
      const edges = apiResponse?.data?.user?.edge_owner_to_timeline_media?.edges;
      if (Array.isArray(edges) && edges.length > 0) {
        _extractProfileNode(apiResponse?.data?.user);  // bonus: cache profile too
        return _fromMediaNode(edges[0]?.node);
      }

      // ── Shape D: media list (e.g. hashtag feed) ──────────
      const tagEdges = apiResponse?.data?.hashtag?.edge_hashtag_to_media?.edges;
      if (Array.isArray(tagEdges) && tagEdges.length > 0) {
        return _fromMediaNode(tagEdges[0]?.node);
      }

      // ── Shape E: deep-walk fallback ───────────────────────
      // Handles any unknown IG response structure
      return _deepWalk(apiResponse);

    } catch (e) {
      spmLog.error('[Extractor] extractPostData:', e);
      return null;
    }
  }

  // ── Build a normalised PostData from any IG media node ───
  function _fromMediaNode(node) {
    if (!node || typeof node !== 'object') return null;

    // Must have at least one engagement metric to be a real post
    const rawLikes    = node.like_count
                     ?? node.edge_media_preview_like?.count
                     ?? node.edge_liked_by?.count
                     ?? null;
    const rawComments = node.comment_count
                     ?? node.edge_media_to_comment?.count
                     ?? node.edge_media_preview_comment?.count
                     ?? null;

    if (rawLikes == null && rawComments == null) return null;

    // ── Normalise all numbers immediately (spec §3) ──────
    const likes    = normalizeNumber(rawLikes);
    const comments = normalizeNumber(rawComments);
    const shares   = normalizeNumber(node.reshare_count ?? null);
    const reach    = normalizeNumber(node.video_view_count ?? node.play_count ?? null);
    const followers = normalizeNumber(node.owner?.edge_followed_by?.count ?? null);
    const isVideo   = !!(node.is_video || node.video_url || node.product_type === 'igtv');

    // ── Caption, hashtags, mentions ───────────────────────
    const caption  = node.edge_media_to_caption?.edges?.[0]?.node?.text
                  ?? node.caption?.text
                  ?? node.accessibility_caption
                  ?? '';
    const hashtags = extractHashtags(caption);
    const mentions = extractMentions(caption);

    // ── Username ──────────────────────────────────────────
    const username = node.owner?.username ?? node.user?.username ?? '';

    // ── Media URLs (carousel + single) ───────────────────
    const mediaUrls = _collectMediaUrls(node).filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
    const mediaUrl  = mediaUrls[0] ?? '';

    // ── Timestamp (spec §3: normalizeTimestamp) ───────────
    const ts = normalizeTimestamp(node.taken_at_timestamp ?? node.taken_at ?? null);

    // ── Post ID ───────────────────────────────────────────
    const postId = String(node.id ?? node.shortcode ?? node.pk ?? '');

    // ── Build final object ────────────────────────────────
    const postData = {
      postId,
      username,
      followers,
      likes,
      comments,
      shares,
      reach,
      caption,
      hashtags,
      mentions,
      mediaUrls,
      mediaUrl,
      isVideo,
      ts,
      source:   'api',
      platform: 'instagram',
      url:      location.href,
    };

    // ── Cache + dedup (spec §4) ───────────────────────────
    if (postId && _apiDedup.isNew('post:' + postId)) {
      _postCache.set(postId, postData);
      _latestPost = postData;
      spmLog.info('[Extractor] Post cached:', postId, { likes, comments });
    }

    // ── Cache profile if owner data present ───────────────
    if (node.owner) _extractProfileNode(node.owner);
    // ── Cache comments if present ─────────────────────────
    _extractCommentEdges(postId, node);

    return postData;
  }

  // ── Collect all media URLs (handles carousel / sidecar) ──
  function _collectMediaUrls(node) {
    const urls = new Set();
    const _add = u => { if (u && typeof u === 'string') urls.add(u); };

    _add(node.display_url);
    _add(node.video_url);
    _add(node.image_versions2?.candidates?.[0]?.url);

    // Sidecar (carousel) — edge_sidecar_to_children or carousel_media
    const sidecar = node.edge_sidecar_to_children?.edges ?? node.carousel_media ?? [];
    sidecar.forEach(e => {
      const n = e.node ?? e;
      _add(n.display_url);
      _add(n.video_url);
      _add(n.image_versions2?.candidates?.[0]?.url);
    });

    return [...urls];
  }

  // ── Extract + cache profile from a user/owner node ───────
  function _extractProfileNode(user) {
    if (!user?.username) return;
    const profile = {
      username:   user.username,
      name:       user.full_name ?? '',
      followers:  normalizeNumber(user.follower_count  ?? user.edge_followed_by?.count  ?? null),
      following:  normalizeNumber(user.following_count ?? user.edge_follow?.count        ?? null),
      posts:      normalizeNumber(user.media_count     ?? user.edge_owner_to_timeline_media?.count ?? null),
      bio:        user.biography ?? '',
      avatarSrc:  user.profile_pic_url_hd ?? user.profile_pic_url ?? '',
      isVerified: !!(user.is_verified),
      isPrivate:  !!(user.is_private),
    };
    _profileCache.set(user.username, profile);
    _latestProfile = profile;
    spmLog.info('[Extractor] Profile cached:', user.username, { followers: profile.followers });
  }

  // ── Extract + cache comment edges ────────────────────────
  function _extractCommentEdges(postId, node) {
    const edges = node?.edge_media_to_comment?.edges
               ?? node?.comments?.edges
               ?? [];
    if (!edges.length) return;

    const commentDedup = SpmDedup(500);
    const list = [];
    edges.forEach(e => {
      const n = e?.node;
      if (!n?.text) return;
      const key = String(n.id ?? n.text.slice(0, 30));
      if (!commentDedup.isNew(key)) return;
      list.push({
        id:       String(n.id ?? ''),
        username: n.owner?.username ?? '?',
        text:     n.text,
        likes:    normalizeNumber(n.edge_liked_by?.count ?? null),
        ts:       normalizeTimestamp(n.created_at ?? null),
        hashtags: extractHashtags(n.text),
        mentions: extractMentions(n.text),
      });
    });
    if (list.length && postId) {
      _commentCache.set(postId, list);
      spmLog.info('[Extractor] Comments cached:', postId, list.length);
    }
  }

  // ── Deep-walk: find any media node in unknown JSON tree ──
  function _deepWalk(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;

    if (obj.like_count != null || obj.edge_media_preview_like != null) {
      const r = _fromMediaNode(obj);
      if (r) return r;
    }
    if (obj.username && (obj.follower_count != null || obj.edge_followed_by != null)) {
      _extractProfileNode(obj);
    }

    const children = Array.isArray(obj) ? obj : Object.values(obj);
    for (const child of children) {
      if (child && typeof child === 'object') {
        const r = _deepWalk(child, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  // ════════════════════════════════════════════════════════
  //  DOM FALLBACK (spec §10 — maintain compatibility)
  //  Used when API cache is empty.
  // ════════════════════════════════════════════════════════

  function _domRoot() {
    return spmQ('div[role="dialog"] article')
        ?? spmQ('main article')
        ?? spmQ('article')
        ?? spmQ('[role="main"]')
        ?? document;
  }

  function _igDomStats() {
    const r = _domRoot();
    const result = { source: 'dom' };
    try {
      // Likes
      for (const el of spmQA('span, a', r)) {
        const t = (el.innerText ?? '').trim();
        const m1 = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
        if (m1) { result.likes = normalizeNumber(m1[1]) + 1; break; }
        const m2 = t.match(/^([\d,]+)\s+likes?$/i);
        if (m2) { result.likes = normalizeNumber(m2[1]); break; }
      }
      if (!result.likes) {
        for (const el of spmQA('[aria-label]', r)) {
          const lbl = el.getAttribute('aria-label') ?? '';
          if (/like/i.test(lbl) && /\d/.test(lbl)) { result.likes = normalizeNumber(lbl.match(/[\d,]+/)?.[0]); break; }
        }
      }
      // Comments
      for (const el of spmQA('span, a', r)) {
        const t = (el.innerText ?? '').trim();
        const m = t.match(/[Vv]iew all ([\d,]+) comments?/);
        if (m) { result.comments = normalizeNumber(m[1]); break; }
        const m2 = t.match(/^([\d,]+)\s+comments?$/i);
        if (m2) { result.comments = normalizeNumber(m2[1]); break; }
      }
      // Caption from og:description
      result.caption = spmQ('meta[property="og:description"]')?.content ?? '';
      result.hashtags = extractHashtags(result.caption);
      result.mentions = extractMentions(result.caption);
      // Media
      result.mediaUrls = _igDomMedia();
      result.mediaUrl  = result.mediaUrls[0] ?? '';
      result.isVideo   = spmQA('video', r).length > 0;
      // Reach
      if (!result.isVideo) { result.reach = null; result.reachIsNA = true; }
      else {
        for (const el of spmQA('span, div', r)) {
          const t = (el.innerText ?? '').trim();
          const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
          if (m) { result.reach = normalizeNumber(m[1]); break; }
        }
      }
    } catch (e) { spmLog.error('[Extractor] _igDomStats:', e); }
    return result;
  }

  function _igDomMedia() {
    const u = new Set();
    const r = _domRoot();
    try {
      spmQA('img[src*="cdninstagram"], img[src*="fbcdn"]', r)
        .forEach(img => { if ((img.naturalWidth ?? img.width) > 200) u.add(img.src); });
      spmQA('img[src*="cdninstagram"], img[src*="fbcdn"]')
        .forEach(img => { if ((img.naturalWidth ?? img.naturalHeight) > 100) u.add(img.src); });
      spmQA('video[src], video source[src]', r)
        .forEach(v => { const s = v.src ?? v.getAttribute('src'); if (s) u.add(s); });
      const og = spmQ('meta[property="og:image"]');
      if (og?.content) u.add(og.content);
    } catch (e) { spmLog.error('[Extractor] _igDomMedia:', e); }
    return [...u].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
  }

  // ════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════

  /** stats() — merged view: API wins, DOM fills gaps */
  function stats() {
    const base = { platform: SPM.PLATFORM, url: location.href, ts: Date.now() };
    try {
      if (!SPM.IS_IG) return _fbDomStats();

      const dom = _igDomStats();
      if (_latestPost) {
        return {
          ...base,
          ...(_latestPost),
          likes:     _latestPost.likes    ?? dom.likes    ?? null,
          comments:  _latestPost.comments ?? dom.comments ?? null,
          reach:     _latestPost.reach    ?? dom.reach    ?? null,
          reachIsNA: (_latestPost.reach == null) && !!dom.reachIsNA,
          mediaUrls: [...new Set([...(_latestPost.mediaUrls??[]), ...(dom.mediaUrls??[])])].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA),
          source:    'api',
        };
      }
      return { ...base, ...dom, postId: '', username: '', followers: null, hashtags: [], mentions: [] };
    } catch (e) { spmLog.error('[Extractor] stats:', e); return { ...base, source:'error', mediaUrls:[] }; }
  }

  function profile() {
    try {
      if (_latestProfile) return _latestProfile;
      // DOM fallback
      const p = {};
      const titleM = document.title.match(/^(.+?)\s*[•(|@-]/);
      if (titleM) p.name = titleM[1].trim();
      const hdr = spmQ('header') ?? spmQ('main header');
      if (hdr) { const av = spmQ('img[alt*="profile picture"]', hdr) ?? spmQ('img', hdr); if (av?.src && spmValidateUrl(av.src)) p.avatarSrc = av.src; }
      for (const el of spmQA('span, li')) {
        const t = (el.innerText ?? '').trim();
        const m = t.match(/^([\d,KkMm.]+)\s+(followers?|following|posts?)$/i);
        if (m) {
          const k = m[2].toLowerCase().replace(/s$/,'');
          if (k==='follower' && !p.followers) p.followers = normalizeNumber(m[1]);
          if (k==='following'&& !p.following) p.following = normalizeNumber(m[1]);
          if (k==='post'     && !p.posts)     p.posts     = normalizeNumber(m[1]);
        }
      }
      const desc = spmQ('meta[name="description"]')?.content ?? '';
      [/([\d,KkMm.]+)\s*Followers/i, /([\d,KkMm.]+)\s*Following/i, /([\d,KkMm.]+)\s*Posts/i]
        .forEach((re, i) => { const m = desc.match(re); if (m) { const keys=['followers','following','posts']; if (!p[keys[i]]) p[keys[i]] = normalizeNumber(m[1]); } });
      p.bio = (spmQ('meta[property="og:description"]')?.content ?? '').slice(0, 300);
      return p;
    } catch (e) { spmLog.error('[Extractor] profile:', e); return {}; }
  }

  function comments(postId) {
    if (postId && _commentCache.has(postId)) return _commentCache.get(postId);
    if (_latestPost?.postId && _commentCache.has(_latestPost.postId)) return _commentCache.get(_latestPost.postId);
    return _igDomComments();
  }

  function _igDomComments() {
    const r = _domRoot(), results = [], seen = SpmDedup(1000);
    try {
      spmQA('ul > li', r).slice(1).forEach(li => {
        const userLink = spmQA('a[href^="/"]', li).find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
        const username = userLink?.innerText?.trim() ?? '?';
        let text = (li.innerText ?? '').trim();
        if (text.startsWith(username)) text = text.slice(username.length).trim();
        text = text.replace(/\s*(Reply|Like|[\d,]+\s*likes?)\s*$/gi, '').trim();
        if (!text || /^(Reply|View replies|Load more)/i.test(text)) return;
        if (!seen.isNew(username + ':' + text.slice(0, 40))) return;
        const timeEl = spmQ('time', li);
        const likeM  = (li.innerText ?? '').match(/(\d+)\s*likes?/i);
        if (results.length < SPM.MAX_COMMENTS) {
          results.push({ id:null, username, text, likes: likeM ? normalizeNumber(likeM[1]) : null,
            ts: normalizeTimestamp(timeEl?.getAttribute('datetime') ?? null),
            hashtags: extractHashtags(text), mentions: extractMentions(text) });
        }
      });
    } catch (e) { spmLog.error('[Extractor] _igDomComments:', e); }
    return results;
  }

  function _fbDomStats() {
    const base = { platform:'facebook', url:location.href, ts:Date.now(), source:'dom', hashtags:[], mentions:[], mediaUrls:[] };
    try {
      const r = spmQ('[role="main"]') ?? document;
      const result = {};
      for (const el of spmQA('[aria-label]', r)) {
        const lbl = el.getAttribute('aria-label') ?? '';
        if (/\d/.test(lbl) && /react/i.test(lbl)   && !result.likes)    result.likes    = normalizeNumber(lbl.match(/[\d,]+/)?.[0]);
        if (/\d/.test(lbl) && /comment/i.test(lbl)  && !result.comments) result.comments = normalizeNumber(lbl.match(/[\d,]+/)?.[0]);
        if (/\d/.test(lbl) && /share/i.test(lbl)    && !result.shares)   result.shares   = normalizeNumber(lbl.match(/[\d,]+/)?.[0]);
      }
      return { ...base, ...result };
    } catch (e) { spmLog.error('[Extractor] _fbDomStats:', e); return base; }
  }

  function profileGridMedia() {
    const u = new Set();
    try {
      spmQA('article img, main img, [role="main"] img').forEach(img => { if ((img.naturalWidth ?? img.width) > 150) u.add(img.src); });
      spmQA('video[poster]').forEach(v => { if (v.poster) u.add(v.poster); });
    } catch (e) { spmLog.error('[Extractor] profileGridMedia:', e); }
    return [...u].filter(spmValidateUrl).slice(0, 100);
  }

  function resetCache() {
    _postCache.clear();
    _profileCache.clear();
    _commentCache.clear();
    _apiDedup.clear();
    _latestPost    = null;
    _latestProfile = null;
    spmLog.info('[Extractor] Cache reset');
  }

  // Expose cache for analytics engine
  function getPostCache()    { return _postCache;    }
  function getProfileCache() { return _profileCache; }
  function getLatestPost()   { return _latestPost;   }

  return {
    extractPostData,           // ← primary entry point
    stats,
    profile,
    comments,
    profileGridMedia,
    resetCache,
    getPostCache,
    getProfileCache,
    getLatestPost,
    hasApiData: () => _latestPost !== null,
  };

})();
