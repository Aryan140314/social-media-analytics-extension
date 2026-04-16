/**
 * SPM Pro v8 · content/extractor.js
 * ─────────────────────────────────────────────────────────────
 * Data extraction layer.
 * Primary  : extractPostData(rawApiJson)  — called by monitor.js
 * Fallback : stats() / profile() / comments() — DOM scraping
 *
 * BUG FIXES:
 *  #5  Handles all known Instagram GraphQL response shapes
 *  #6  Optional chaining on every API field access
 *  #7  Dedup key = postId:likes:comments  (NOT url+length)
 *  #9  try/catch error boundary in every public function
 *  #13 Race condition guard: _fromNode returns cached if dedupe hit
 */
'use strict';

const SpmExtractor = (() => {

  // ── Internal state ────────────────────────────────────────
  const _postCache    = SpmCache(SPM.MAX_CACHE);
  const _profileCache = SpmCache(200);
  const _commentCache = SpmCache(200);
  // FIX #7: dedup key uses postId:likes:comments, not url+byteLength
  const _seenPosts    = SpmDedup(2000);

  let _latestPost    = null;
  let _latestProfile = null;

  // Rate-limit so rapid DOM mutations don't flood the pipeline
  const processApiPayload = spmRateLimit(_safeExtract, 600);

  function _safeExtract(payload) {
    // FIX #9: error boundary — extractor failure must not crash pipeline
    try { return extractPostData(payload); }
    catch (e) { spmLog.error('[Extractor] processApiPayload boundary:', e.message); return null; }
  }

  // ════════════════════════════════════════════════════════
  //  extractPostData(raw)
  //  FIX #5: handles ALL known Instagram response shapes
  // ════════════════════════════════════════════════════════
  function extractPostData(raw) {
    if (!raw || typeof raw !== 'object') return null;

    // Log shape for debugging
    spmLog.debug('[Extractor] Trying shapes on keys:', Object.keys(raw).slice(0,6));

    try {

      // ── Shape 1: Single post page (modern)  ─────────────
      // data.data.xdt_shortcode_media
      const xdt = raw?.data?.xdt_shortcode_media;
      if (safeExtract(xdt)) {
        spmLog.pipe('[Extractor] Shape 1: xdt_shortcode_media');
        return _fromNode(xdt);
      }

      // ── Shape 2: Single post page (legacy) ──────────────
      // data.data.shortcode_media
      const sc = raw?.data?.shortcode_media;
      if (safeExtract(sc)) {
        spmLog.pipe('[Extractor] Shape 2: shortcode_media');
        return _fromNode(sc);
      }

      // ── Shape 3: User timeline / feed ───────────────────
      // data.data.user.edge_owner_to_timeline_media.edges[0].node
      const tlEdges = raw?.data?.user?.edge_owner_to_timeline_media?.edges;
      if (Array.isArray(tlEdges) && tlEdges.length > 0) {
        spmLog.pipe('[Extractor] Shape 3: timeline edges');
        _tryExtractProfile(raw?.data?.user);
        const node = tlEdges[0]?.node;
        if (safeExtract(node)) return _fromNode(node);
      }

      // ── Shape 4: Hashtag feed ────────────────────────────
      // data.data.hashtag.edge_hashtag_to_media.edges[0].node
      const htEdges = raw?.data?.hashtag?.edge_hashtag_to_media?.edges;
      if (Array.isArray(htEdges) && htEdges.length > 0) {
        spmLog.pipe('[Extractor] Shape 4: hashtag feed');
        const node = htEdges[0]?.node;
        if (safeExtract(node)) return _fromNode(node);
      }

      // ── Shape 5: Reels / Clips ───────────────────────────
      // data.data.xdt_api__v1__clips__... OR items[0] OR media
      const reelEdges = raw?.data?.xdt_api__v1__clips__home__connection_v2?.edges;
      if (Array.isArray(reelEdges) && reelEdges.length > 0) {
        spmLog.pipe('[Extractor] Shape 5a: clips connection');
        const node = reelEdges[0]?.node?.media ?? reelEdges[0]?.node;
        if (safeExtract(node)) return _fromNode(node);
      }

      // ── Shape 6: items[] array (IG API v1 format) ────────
      if (Array.isArray(raw?.items) && raw.items.length > 0) {
        spmLog.pipe('[Extractor] Shape 6: items[]');
        const node = raw.items[0];
        if (safeExtract(node)) return _fromNode(node);
      }

      // ── Shape 7: top-level media object ─────────────────
      if (safeExtract(raw?.media)) {
        spmLog.pipe('[Extractor] Shape 7: raw.media');
        return _fromNode(raw.media);
      }

      // ── Shape 8: deep-walk fallback ──────────────────────
      // Catches any unknown shape by recursively scanning the tree
      spmLog.debug('[Extractor] Trying deep-walk fallback');
      return _deepWalk(raw, 0);

    } catch (e) {
      spmLog.error('[Extractor] extractPostData:', e.message);
      return null;
    }
  }

  // ── Build a canonical PostData from a validated API node ──
  function _fromNode(node) {
    if (!safeExtract(node)) return null;

    try {
      // FIX #6: optional chaining on EVERY field, normalizeNumber on all counts
      const likes    = normalizeNumber(node?.like_count ?? node?.edge_media_preview_like?.count ?? node?.edge_liked_by?.count ?? null);
      const comments = normalizeNumber(node?.comment_count ?? node?.edge_media_to_comment?.count ?? node?.edge_media_preview_comment?.count ?? null);
      const shares   = normalizeNumber(node?.reshare_count ?? null);
      const reach    = normalizeNumber(node?.video_view_count ?? node?.play_count ?? node?.view_count ?? null);
      const followers= normalizeNumber(node?.owner?.edge_followed_by?.count ?? null);
      const isVideo  = !!(node?.is_video || node?.video_url || node?.product_type === 'igtv' || node?.product_type === 'clips');
      const caption  = node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? node?.caption?.text ?? node?.accessibility_caption ?? '';
      const username = node?.owner?.username ?? node?.user?.username ?? '';
      const ts       = normalizeTimestamp(node?.taken_at_timestamp ?? node?.taken_at ?? null);
      const mediaUrls= _collectMediaUrls(node).filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);

      // FIX #7 + FIX #6: postId with guaranteed fallback
      const postId = String(
        node?.id ?? node?.shortcode ?? node?.pk ?? node?.code ??
        location.href.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ??
        `dom_${Date.now()}`
      );

      const postData = {
        postId, username, followers, likes, comments, shares, reach,
        caption,
        hashtags:  extractHashtags(caption),
        mentions:  extractMentions(caption),
        mediaUrls,
        mediaUrl:  mediaUrls[0] ?? '',
        isVideo,   ts,
        source:    'api',
        platform:  'instagram',
        url:       location.href,
      };

      // Schema validation (non-fatal)
      const { valid, errors } = validatePostSchema(postData);
      if (!valid) spmLog.warn('[Extractor] Schema issues:', errors);

      // FIX #7: strong dedup key — postId + current like/comment counts
      const dedupKey = `${postId}:${likes ?? 'x'}:${comments ?? 'x'}`;
      if (!_seenPosts.isNew(dedupKey)) {
        spmLog.debug('[Extractor] Dedup hit — returning cached:', dedupKey);
        return _latestPost; // return cached, don't re-process
      }

      // Cache and update latest
      _postCache.set(postId, postData);
      _latestPost = postData;
      spmLog.pipe('[Extractor] ✓ Post stored:', { postId: postId.slice(0,15), likes, comments, shares, reach, isVideo });

      // Side-effects: cache profile and comments if present in same payload
      if (node?.owner) _tryExtractProfile(node.owner);
      _tryExtractComments(postId, node);

      return postData;

    } catch (e) {
      spmLog.error('[Extractor] _fromNode:', e.message);
      return null;
    }
  }

  // ── Collect all media URLs (handles carousel) ─────────────
  function _collectMediaUrls(node) {
    const urls = new Set();
    const add  = u => { if (u && typeof u === 'string' && u.startsWith('http')) urls.add(u); };

    try {
      add(node?.display_url);
      add(node?.video_url);
      add(node?.image_versions2?.candidates?.[0]?.url);

      // Carousel / sidecar
      const sidecar = node?.edge_sidecar_to_children?.edges ?? node?.carousel_media ?? [];
      sidecar.forEach(e => {
        const n = e?.node ?? e;
        add(n?.display_url);
        add(n?.video_url);
        add(n?.image_versions2?.candidates?.[0]?.url);
      });
    } catch (e) { spmLog.debug('[_collectMediaUrls]', e.message); }

    return [...urls];
  }

  // ── Extract profile from owner/user node ──────────────────
  function _tryExtractProfile(user) {
    try {
      if (!user?.username) return;
      const p = {
        username:  user.username,
        name:      user.full_name ?? '',
        followers: normalizeNumber(user.follower_count ?? user.edge_followed_by?.count ?? null),
        following: normalizeNumber(user.following_count ?? user.edge_follow?.count ?? null),
        posts:     normalizeNumber(user.media_count ?? user.edge_owner_to_timeline_media?.count ?? null),
        bio:       user.biography ?? '',
        avatarSrc: user.profile_pic_url_hd ?? user.profile_pic_url ?? '',
      };
      _profileCache.set(user.username, p);
      _latestProfile = p;
      spmLog.pipe('[Extractor] Profile cached:', user.username, 'followers:', p.followers);
    } catch (e) { spmLog.debug('[_tryExtractProfile]', e.message); }
  }

  // ── Extract comments from API edges ───────────────────────
  function _tryExtractComments(postId, node) {
    try {
      const edges = node?.edge_media_to_comment?.edges ?? node?.comments?.edges ?? [];
      if (!edges.length) return;
      const dedup = SpmDedup(500);
      const list  = [];
      edges.forEach(e => {
        const n = e?.node; if (!n?.text) return;
        const key = String(n.id ?? n.text.slice(0, 30));
        if (!dedup.isNew(key)) return;
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
        spmLog.pipe('[Extractor] Comments cached:', list.length);
      }
    } catch (e) { spmLog.debug('[_tryExtractComments]', e.message); }
  }

  // ── Deep-walk fallback (unknown response shape) ───────────
  function _deepWalk(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    try {
      if (safeExtract(obj)) {
        const r = _fromNode(obj);
        if (r) return r;
      }
      if (obj.username && (obj.follower_count != null || obj.edge_followed_by != null)) {
        _tryExtractProfile(obj);
      }
      const children = Array.isArray(obj) ? obj : Object.values(obj);
      for (const child of children) {
        if (child && typeof child === 'object') {
          const r = _deepWalk(child, depth + 1);
          if (r) return r;
        }
      }
    } catch (e) { spmLog.debug('[_deepWalk] depth', depth, e.message); }
    return null;
  }

  // ════════════════════════════════════════════════════════
  //  DOM FALLBACK — complete multi-strategy scraper
  //  Works on Posts, Reels, and Stories
  // ════════════════════════════════════════════════════════

  function _postRoot() {
    return spmQ('div[role="dialog"] article')
        ?? spmQ('main article')
        ?? spmQ('article')
        ?? spmQ('[role="main"]')
        ?? document;
  }

  function _igDomStats() {
    const result = { source: 'dom' };
    try {
      // ── LIKES ──────────────────────────────────────────
      // S1: aria-label scan (most reliable for Reels)
      for (const el of spmQA('[aria-label]')) {
        const lbl = el.getAttribute('aria-label') ?? '';
        if (/like/i.test(lbl) && /\d/.test(lbl)) {
          const m = lbl.match(/^([\d,]+)/);
          if (m) { result.likes = normalizeNumber(m[1]); break; }
        }
      }
      // S2: "Liked by X and N others" / "N likes"
      if (!result.likes) {
        for (const el of spmQA('span, a')) {
          const t = (el.innerText ?? '').trim();
          if (t.length > 60) continue;
          const m1 = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
          if (m1) { result.likes = normalizeNumber(m1[1]) + 1; break; }
          const m2 = t.match(/^([\d,]+)\s+likes?$/i);
          if (m2) { result.likes = normalizeNumber(m2[1]); break; }
        }
      }

      // ── COMMENTS ───────────────────────────────────────
      // S1: aria-label "N comments"
      for (const el of spmQA('[aria-label]')) {
        const lbl = el.getAttribute('aria-label') ?? '';
        if (/comment/i.test(lbl) && /\d/.test(lbl)) {
          const m = lbl.match(/^([\d,]+)/);
          if (m) { result.comments = normalizeNumber(m[1]); break; }
        }
      }
      // S2: "View all N comments" / "N comments"
      if (!result.comments) {
        for (const el of spmQA('span, a')) {
          const t = (el.innerText ?? '').trim();
          if (t.length > 60) continue;
          const m1 = t.match(/[Vv]iew all ([\d,]+) comments?/);
          if (m1) { result.comments = normalizeNumber(m1[1]); break; }
          const m2 = t.match(/^([\d,]+)\s+comments?$/i);
          if (m2) { result.comments = normalizeNumber(m2[1]); break; }
        }
      }

      // ── SHARES ─────────────────────────────────────────
      // S1: aria-label "N shares/reposts"
      for (const el of spmQA('[aria-label]')) {
        const lbl = el.getAttribute('aria-label') ?? '';
        if (/(share|repost|send)/i.test(lbl) && /\d/.test(lbl)) {
          const m = lbl.match(/^([\d,]+)/);
          if (m) { result.shares = normalizeNumber(m[1]); break; }
        }
      }
      // S2: Reel action panel — ordered numeric spans
      if (!result.shares) {
        for (const area of spmQA('section, [class*="action"]')) {
          const nums = spmQA('span', area)
            .filter(el => /^[\d,.]+[KkMmBb]?$/.test((el.innerText ?? '').trim()) && !el.children.length);
          if (nums.length >= 3) {
            if (!result.likes    && nums[0]) result.likes    = normalizeNumber(nums[0].innerText.trim());
            if (!result.comments && nums[1]) result.comments = normalizeNumber(nums[1].innerText.trim());
            if (!result.shares   && nums[2]) result.shares   = normalizeNumber(nums[2].innerText.trim());
            break;
          }
        }
      }

      // ── REACH / VIEWS ───────────────────────────────────
      const hasVideo = spmQA('video').length > 0;
      if (!hasVideo) {
        result.reach = null; result.reachIsNA = true;
      } else {
        // S1: exact "N views" / "N plays" text
        for (const el of spmQA('span, div, strong')) {
          const t = (el.innerText ?? '').trim();
          if (t.length > 30) continue;
          const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
          if (m) { result.reach = normalizeNumber(m[1]); break; }
        }
        // S2: inline "N views" anywhere
        if (!result.reach) {
          for (const el of spmQA('span, div')) {
            const t = (el.innerText ?? '').trim();
            if (t.length > 40) continue;
            const m = t.match(/([\d,.]+[KkMmBb]?)\s*(views?|plays?)/i);
            if (m) { result.reach = normalizeNumber(m[1]); break; }
          }
        }
        // S3: aria-label on video
        if (!result.reach) {
          for (const vid of spmQA('video, [aria-label*="view"]')) {
            const lbl = vid.getAttribute('aria-label') ?? '';
            const m   = lbl.match(/([\d,.]+[KkMmBb]?)\s*views?/i);
            if (m) { result.reach = normalizeNumber(m[1]); break; }
          }
        }
      }

      // ── META / MEDIA ────────────────────────────────────
      result.caption   = spmQ('meta[property="og:description"]')?.content ?? '';
      result.hashtags  = extractHashtags(result.caption);
      result.mentions  = extractMentions(result.caption);
      result.mediaUrls = _igDomMedia();
      result.mediaUrl  = result.mediaUrls[0] ?? '';
      result.isVideo   = hasVideo;
      result.postId    = location.href.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ?? `dom_${Date.now()}`;

      spmLog.pipe('[Extractor DOM] likes:', result.likes,
        '| comments:', result.comments,
        '| shares:', result.shares,
        '| reach:', result.reach);

    } catch (e) { spmLog.error('[Extractor] _igDomStats:', e.message); }
    return result;
  }

  function _igDomMedia() {
    const u = new Set();
    try {
      spmQA('img[src*="cdninstagram"],img[src*="fbcdn"],img[src*="scontent"]')
        .forEach(img => { if ((img.naturalWidth ?? img.width) > 200) u.add(img.src); });
      spmQA('video[src],video source[src]')
        .forEach(v => { const s = v.src ?? v.getAttribute('src'); if (s) u.add(s); });
      const og = spmQ('meta[property="og:image"]');
      if (og?.content) u.add(og.content);
    } catch (e) { spmLog.error('[Extractor] _igDomMedia:', e.message); }
    return [...u].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
  }

  // ── FIX #5 comments — 4-strategy DOM scraper ─────────────
  function _igDomComments() {
    const results = [];
    const seen    = SpmDedup(1000);
    try {
      // S1: role="listitem" (Reels comment panel)
      let containers = spmQA('[role="listitem"]');
      // S2: ul > li (classic photo post)
      if (!containers.length) containers = spmQA('ul > li').slice(1);
      // S3: time element parent walk
      if (!containers.length) {
        spmQA('time').forEach(t => {
          let el = t;
          for (let i=0; i<5; i++) {
            el = el?.parentElement; if (!el) break;
            if (spmQA('a[href^="/"]', el).some(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''))) {
              containers = [...containers, el]; break;
            }
          }
        });
      }
      // S4: Reply button parent walk
      if (!containers.length) {
        spmQA('button, span').filter(el => (el.innerText ?? '').trim() === 'Reply').forEach(btn => {
          let el = btn;
          for (let i=0; i<6; i++) {
            el = el?.parentElement; if (!el) break;
            if (spmQA('a[href^="/"]', el).some(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''))) {
              containers = [...containers, el]; break;
            }
          }
        });
      }

      containers.forEach(c => {
        try {
          const userLink = spmQA('a[href^="/"]', c).find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
          const username = userLink?.innerText?.trim() ?? '?';
          if (username === '?') return;
          let text = (c.innerText ?? '').trim();
          if (text.startsWith(username)) text = text.slice(username.length).trim();
          text = text.replace(/\s*\d+[wdhms]\s*$/gi, '').replace(/\s*(Reply|Like|Translate)\s*$/gi, '').replace(/\s*[\d,]+\s*likes?\s*$/gi, '').trim();
          if (!text || /^(Reply|View replies|Load more)/i.test(text)) return;
          const key = username + ':' + text.slice(0, 40);
          if (!seen.isNew(key)) return;
          const timeEl = spmQ('time', c);
          const likeM  = (c.innerText ?? '').match(/(\d+)\s*likes?/i);
          if (results.length < SPM.MAX_COMMENTS) {
            results.push({ id:null, username, text,
              likes: likeM ? normalizeNumber(likeM[1]) : null,
              ts: normalizeTimestamp(timeEl?.getAttribute('datetime') ?? null),
              time: timeEl?.innerText?.trim() ?? '',
              hashtags: extractHashtags(text), mentions: extractMentions(text),
            });
          }
        } catch (e) { spmLog.debug('[comment item]', e.message); }
      });
    } catch (e) { spmLog.error('[Extractor] _igDomComments:', e.message); }
    spmLog.pipe('[Extractor DOM] Comments scraped:', results.length);
    return results;
  }

  // ── Profile: post author only, never commenter ────────────
  function profile() {
    try {
      if (_latestProfile) return _latestProfile;
      const p = {};

      // From og:title (always the post author)
      const ogTitle = spmQ('meta[property="og:title"]')?.content ?? '';
      const tm = ogTitle.match(/^(.+?)\s+(?:on Instagram|•)/i) ?? ogTitle.match(/^@?([A-Za-z0-9._]+)/);
      if (tm?.[1]) p.username = tm[1].replace(/^@/, '');

      // From post article header (not comment section)
      const postArea = spmQ('div[role="dialog"] article, main article, article') ?? document;
      if (!p.username) {
        const hdr = spmQ('header', postArea);
        if (hdr) {
          const link = spmQA('a[href^="/"]', hdr).find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
          if (link?.innerText?.trim()) p.username = link.innerText.trim();
        }
      }

      // Follower counts from meta description
      const desc = spmQ('meta[name="description"]')?.content ?? '';
      const mF = desc.match(/([\d,KkMm.]+)\s*Followers/i);
      const mG = desc.match(/([\d,KkMm.]+)\s*Following/i);
      const mP = desc.match(/([\d,KkMm.]+)\s*Posts/i);
      if (mF) p.followers = normalizeNumber(mF[1]);
      if (mG) p.following = normalizeNumber(mG[1]);
      if (mP) p.posts     = normalizeNumber(mP[1]);

      // Name from page title
      const pageTitle = document.title;
      const titleM = pageTitle.match(/^(.+?)\s*[•(|@-]/);
      if (titleM && !p.name) p.name = titleM[1].trim();

      // Avatar from post header only
      const headerImg = spmQ('header img[alt*="profile picture"], header img', postArea);
      if (headerImg?.src && spmValidateUrl(headerImg.src)) p.avatarSrc = headerImg.src;

      p.bio = (spmQ('meta[property="og:description"]')?.content ?? '').slice(0, 300);
      spmLog.pipe('[Extractor] Profile (DOM):', p.username, 'followers:', p.followers);
      return p;
    } catch (e) { spmLog.error('[Extractor] profile:', e.message); return {}; }
  }

  // ── Public stats() — merge API + DOM ─────────────────────
  function stats() {
    const base = {
      platform: SPM.PLATFORM, url: location.href, ts: Date.now(),
      postId: location.href.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ?? `dom_${Date.now()}`,
      hashtags: [], mentions: [], mediaUrls: [],
    };
    try {
      if (!SPM.IS_IG) return _fbDomStats();

      const dom = _igDomStats();

      if (_latestPost) {
        // API data is primary, DOM fills any nulls
        return {
          ...base,
          ...(_latestPost),
          likes:    _latestPost.likes    ?? dom.likes    ?? null,
          comments: _latestPost.comments ?? dom.comments ?? null,
          shares:   _latestPost.shares   ?? dom.shares   ?? null,
          reach:    _latestPost.reach    ?? dom.reach    ?? null,
          reachIsNA:(_latestPost.reach == null) && !!dom.reachIsNA,
          mediaUrls:[...new Set([...(_latestPost.mediaUrls ?? []), ...(dom.mediaUrls ?? [])])].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA),
          source:   'api',
        };
      }

      return { ...base, ...dom };
    } catch (e) { spmLog.error('[Extractor] stats:', e.message); return base; }
  }

  function comments(postId) {
    try {
      if (postId && _commentCache.has(postId)) return _commentCache.get(postId);
      if (_latestPost?.postId && _commentCache.has(_latestPost.postId)) return _commentCache.get(_latestPost.postId);
      return _igDomComments();
    } catch (e) { spmLog.error('[Extractor] comments:', e.message); return []; }
  }

  function _fbDomStats() {
    const base = { platform:'facebook', url:location.href, ts:Date.now(), source:'dom',
      hashtags:[], mentions:[], mediaUrls:[], postId:`dom_${Date.now()}` };
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
    } catch (e) { spmLog.error('[Extractor] _fbDomStats:', e.message); return base; }
  }

  function profileGridMedia() {
    const u = new Set();
    try {
      spmQA('article img, main img, [role="main"] img')
        .forEach(img => { if ((img.naturalWidth ?? img.width) > 150) u.add(img.src); });
      spmQA('video[poster]').forEach(v => { if (v.poster) u.add(v.poster); });
    } catch (e) { spmLog.error('[Extractor] profileGridMedia:', e.message); }
    return [...u].filter(spmValidateUrl).slice(0, 100);
  }

  function resetCache() {
    _postCache.clear(); _profileCache.clear(); _commentCache.clear(); _seenPosts.clear();
    _latestPost = null; _latestProfile = null;
    spmLog.pipe('[Extractor] Cache reset');
  }

  return {
    extractPostData,      // raw API JSON → PostData | null
    processApiPayload,    // rate-limited + error-boundary wrapper
    stats,                // merged API+DOM stats
    profile,              // post author profile
    comments,             // comments from API cache or DOM
    profileGridMedia,
    resetCache,
    getLatestPost:    () => _latestPost,
    getLatestProfile: () => _latestProfile,
    hasApiData:       () => _latestPost !== null,
  };

})();
