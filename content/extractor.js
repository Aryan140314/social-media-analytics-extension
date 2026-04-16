/**
 * SPM Pro v9 · content/extractor.js
 *
 * Requirements addressed:
 *  R3  – Handles xdt_shortcode_media, shortcode_media, graphql fallback + 5 more shapes
 *  R3  – Optional chaining on every API field
 *  R3  – Returns null safely when data is invalid
 *  R6  – Dedup key = post.id  (not URL, not byteLength)
 *  R7  – try/catch in every function
 *  R8  – DEBUG logs at each decision point
 */
'use strict';

const SpmExtractor = (() => {

  const DEBUG = true;
  const log = {
    info : (...a) => DEBUG && console.info ('[SPM:extractor]', ...a),
    warn : (...a) =>           console.warn ('[SPM:extractor]', ...a),
    error: (...a) =>           console.error('[SPM:extractor]', ...a),
  };

  /* ─── Caches ─────────────────────────────────────────────── */
  const _posts    = SpmCache(SPM.MAX_CACHE);   // postId → PostData
  const _profiles = SpmCache(200);             // username → ProfileData
  const _comments = SpmCache(200);             // postId → Comment[]
  // R6 — dedup key uses post.id + like/comment snapshot
  const _seenIds  = SpmDedup(2000);

  let _latestPost    = null;
  let _latestProfile = null;

  /* ═══════════════════════════════════════════════════════════
   * PUBLIC — extractPostData(raw)
   *
   * R3 — tries every known Instagram response shape in order.
   * Returns a normalised PostData object, or null.
   * ═══════════════════════════════════════════════════════════ */
  function extractPostData(raw) {
    if (!raw || typeof raw !== 'object') return null;

    try {
      // Shape 1: xdt_shortcode_media  (modern single-post endpoint)
      const xdt = raw?.data?.xdt_shortcode_media;
      if (_valid(xdt)) { log.info('Shape 1: xdt_shortcode_media'); return _build(xdt); }

      // Shape 2: shortcode_media  (legacy single-post endpoint)
      const sc = raw?.data?.shortcode_media;
      if (_valid(sc))  { log.info('Shape 2: shortcode_media');     return _build(sc);  }

      // Shape 3: user timeline / feed
      const tl = raw?.data?.user?.edge_owner_to_timeline_media?.edges;
      if (Array.isArray(tl) && tl.length > 0) {
        log.info('Shape 3: timeline edges');
        _tryProfile(raw?.data?.user);
        const n = tl[0]?.node;
        if (_valid(n)) return _build(n);
      }

      // Shape 4: hashtag feed
      const ht = raw?.data?.hashtag?.edge_hashtag_to_media?.edges;
      if (Array.isArray(ht) && ht.length > 0) {
        log.info('Shape 4: hashtag feed');
        const n = ht[0]?.node;
        if (_valid(n)) return _build(n);
      }

      // Shape 5: reels/clips connection
      const rc = raw?.data?.xdt_api__v1__clips__home__connection_v2?.edges;
      if (Array.isArray(rc) && rc.length > 0) {
        log.info('Shape 5: clips connection');
        const n = rc[0]?.node?.media ?? rc[0]?.node;
        if (_valid(n)) return _build(n);
      }

      // Shape 6: items[] array  (IG API v1 format)
      if (Array.isArray(raw?.items) && raw.items.length > 0) {
        log.info('Shape 6: items[]');
        const n = raw.items[0];
        if (_valid(n)) return _build(n);
      }

      // Shape 7: top-level media object
      if (_valid(raw?.media)) { log.info('Shape 7: raw.media'); return _build(raw.media); }

      // Shape 8: graphql fallback — walk the tree
      log.info('Shape 8: deep-walk fallback');
      return _deepWalk(raw, 0);

    } catch (e) {
      log.error('extractPostData:', e.message);
      return null;
    }
  }

  /* ─── Validate a raw node ────────────────────────────────── */
  function _valid(node) {
    if (!node || typeof node !== 'object') return false;
    const hasId  = node.id || node.shortcode || node.pk || node.code;
    const hasEng = node.like_count != null
                || node.edge_media_preview_like != null
                || node.edge_liked_by != null
                || node.comment_count != null;
    return !!(hasId || hasEng);
  }

  /* ─── Build canonical PostData from a validated node ─────── */
  function _build(node) {
    if (!node) return null;

    try {
      // R3 — optional chaining on every single field access
      const likes    = _n(node?.like_count ?? node?.edge_media_preview_like?.count ?? node?.edge_liked_by?.count);
      const comments = _n(node?.comment_count ?? node?.edge_media_to_comment?.count ?? node?.edge_media_preview_comment?.count);
      const shares   = _n(node?.reshare_count);
      const reach    = _n(node?.video_view_count ?? node?.play_count ?? node?.view_count);
      const followers= _n(node?.owner?.edge_followed_by?.count);
      const isVideo  = !!(node?.is_video || node?.video_url || node?.product_type === 'igtv' || node?.product_type === 'clips');
      const caption  = node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? node?.caption?.text ?? node?.accessibility_caption ?? '';
      const username = node?.owner?.username ?? node?.user?.username ?? '';
      const ts       = _ts(node?.taken_at_timestamp ?? node?.taken_at);
      const mediaUrls= _media(node);

      // R6 — postId with guaranteed non-empty fallback
      const postId = String(
        node?.id        ??
        node?.shortcode ??
        node?.pk        ??
        node?.code      ??
        location.href.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ??
        `fallback_${Date.now()}`
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

      // R6 — dedup by postId + engagement snapshot, not URL
      const key = `${postId}:${likes ?? '-'}:${comments ?? '-'}`;
      if (!_seenIds.isNew(key)) {
        log.info('Dedup hit — returning cached:', postId.slice(0, 14));
        return _latestPost;
      }

      _posts.set(postId, postData);
      _latestPost = postData;
      log.info('✓ Stored postId:', postId.slice(0, 14),
        '| likes:', likes, '| comments:', comments,
        '| shares:', shares, '| reach:', reach);

      if (node?.owner) _tryProfile(node.owner);
      _tryComments(postId, node);

      return postData;

    } catch (e) {
      log.error('_build:', e.message);
      return null;
    }
  }

  /* ─── Collect all media URLs (carousel-aware) ─────────────── */
  function _media(node) {
    const u = new Set();
    const add = v => { if (v && typeof v === 'string' && v.startsWith('http')) u.add(v); };
    try {
      add(node?.display_url);
      add(node?.video_url);
      add(node?.image_versions2?.candidates?.[0]?.url);
      const sidecar = node?.edge_sidecar_to_children?.edges ?? node?.carousel_media ?? [];
      sidecar.forEach(e => {
        const n = e?.node ?? e;
        add(n?.display_url); add(n?.video_url); add(n?.image_versions2?.candidates?.[0]?.url);
      });
    } catch { /* ignore */ }
    return [...u].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
  }

  /* ─── Cache profile from any user/owner node ─────────────── */
  function _tryProfile(user) {
    try {
      if (!user?.username) return;
      const p = {
        username:  user.username,
        name:      user.full_name       ?? '',
        followers: _n(user.follower_count  ?? user.edge_followed_by?.count),
        following: _n(user.following_count ?? user.edge_follow?.count),
        posts:     _n(user.media_count     ?? user.edge_owner_to_timeline_media?.count),
        bio:       user.biography           ?? '',
        avatarSrc: user.profile_pic_url_hd  ?? user.profile_pic_url ?? '',
      };
      _profiles.set(user.username, p);
      _latestProfile = p;
      log.info('Profile cached:', user.username, 'followers:', p.followers);
    } catch (e) { log.error('_tryProfile:', e.message); }
  }

  /* ─── Cache comments from API edges ──────────────────────── */
  function _tryComments(postId, node) {
    try {
      const edges = node?.edge_media_to_comment?.edges ?? node?.comments?.edges ?? [];
      if (!edges.length) return;
      const seen = SpmDedup(500);
      const list = [];
      edges.forEach(e => {
        const n = e?.node;
        if (!n?.text) return;
        const k = String(n.id ?? n.text.slice(0, 30));
        if (!seen.isNew(k)) return;
        list.push({
          id:       String(n.id ?? ''),
          username: n.owner?.username ?? '?',
          text:     n.text,
          likes:    _n(n.edge_liked_by?.count),
          ts:       _ts(n.created_at),
          hashtags: extractHashtags(n.text),
          mentions: extractMentions(n.text),
        });
      });
      if (list.length && postId) _comments.set(postId, list);
    } catch (e) { log.error('_tryComments:', e.message); }
  }

  /* ─── Deep-walk: unknown shapes ──────────────────────────── */
  function _deepWalk(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    try {
      if (_valid(obj)) { const r = _build(obj); if (r) return r; }
      if (obj.username && (obj.follower_count != null || obj.edge_followed_by != null)) _tryProfile(obj);
      for (const child of (Array.isArray(obj) ? obj : Object.values(obj))) {
        if (child && typeof child === 'object') {
          const r = _deepWalk(child, depth + 1);
          if (r) return r;
        }
      }
    } catch (e) { log.error('_deepWalk depth', depth, ':', e.message); }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════
   * DOM FALLBACK — used when API data is unavailable
   * ═══════════════════════════════════════════════════════════ */

  function _root() {
    return spmQ('div[role="dialog"] article')
        ?? spmQ('main article')
        ?? spmQ('article')
        ?? spmQ('[role="main"]')
        ?? document;
  }

  /* Shared aria-label scanner — used by likes, comments, shares */
  function _scanAriaLabels(pattern) {
    for (const el of spmQA('[aria-label]')) {
      const lbl = el.getAttribute('aria-label') ?? '';
      if (pattern.test(lbl) && /\d/.test(lbl)) {
        const m = lbl.match(/^([\d,]+)/);
        if (m) return _n(m[1]);
      }
    }
    return null;
  }

  function _domStats() {
    const result = { source: 'dom' };
    try {
      // ── Likes ──────────────────────────────────────────
      result.likes = _scanAriaLabels(/like/i);
      if (!result.likes) {
        for (const el of spmQA('span, a')) {
          const t = (el.innerText ?? '').trim();
          if (t.length > 60) continue;
          const m1 = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
          if (m1) { result.likes = _n(m1[1]) + 1; break; }
          const m2 = t.match(/^([\d,]+)\s+likes?$/i);
          if (m2) { result.likes = _n(m2[1]); break; }
        }
      }

      // ── Comments ───────────────────────────────────────
      result.comments = _scanAriaLabels(/comment/i);
      if (!result.comments) {
        for (const el of spmQA('span, a')) {
          const t = (el.innerText ?? '').trim();
          if (t.length > 60) continue;
          const m1 = t.match(/[Vv]iew all ([\d,]+) comments?/);
          if (m1) { result.comments = _n(m1[1]); break; }
          const m2 = t.match(/^([\d,]+)\s+comments?$/i);
          if (m2) { result.comments = _n(m2[1]); break; }
        }
      }

      // ── Shares ─────────────────────────────────────────
      result.shares = _scanAriaLabels(/(share|repost|send)/i);
      if (!result.shares) {
        // Reel vertical panel: ordered numeric spans in action area
        for (const area of spmQA('section, [class*="action"]')) {
          const nums = spmQA('span', area).filter(el =>
            /^[\d,.]+[KkMmBb]?$/.test((el.innerText ?? '').trim()) && !el.children.length
          );
          if (nums.length >= 3) {
            if (!result.likes    && nums[0]) result.likes    = _n(nums[0].innerText.trim());
            if (!result.comments && nums[1]) result.comments = _n(nums[1].innerText.trim());
            if (!result.shares   && nums[2]) result.shares   = _n(nums[2].innerText.trim());
            break;
          }
        }
      }

      // ── Reach / Views ───────────────────────────────────
      const hasVideo = spmQA('video').length > 0;
      if (!hasVideo) {
        result.reach = null; result.reachIsNA = true;
      } else {
        for (const el of spmQA('span, div, strong')) {
          const t = (el.innerText ?? '').trim();
          if (t.length > 30) continue;
          const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
          if (m) { result.reach = _n(m[1]); break; }
        }
        if (!result.reach) {
          for (const el of spmQA('span, div')) {
            const t = (el.innerText ?? '').trim();
            if (t.length > 40) continue;
            const m = t.match(/([\d,.]+[KkMmBb]?)\s*(views?|plays?)/i);
            if (m) { result.reach = _n(m[1]); break; }
          }
        }
      }

      result.caption   = spmQ('meta[property="og:description"]')?.content ?? '';
      result.hashtags  = extractHashtags(result.caption);
      result.mentions  = extractMentions(result.caption);
      result.mediaUrls = _domMedia();
      result.mediaUrl  = result.mediaUrls[0] ?? '';
      result.isVideo   = hasVideo;
      result.postId    = location.href.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ?? `dom_${Date.now()}`;

      log.info('DOM stats — likes:', result.likes, '| comments:', result.comments,
        '| shares:', result.shares, '| reach:', result.reach);

    } catch (e) { log.error('_domStats:', e.message); }
    return result;
  }

  function _domMedia() {
    const u = new Set();
    try {
      spmQA('img[src*="cdninstagram"],img[src*="fbcdn"],img[src*="scontent"]')
        .forEach(img => { if ((img.naturalWidth ?? img.width) > 200) u.add(img.src); });
      spmQA('video[src],video source[src]')
        .forEach(v => { const s = v.src ?? v.getAttribute('src'); if (s) u.add(s); });
      const og = spmQ('meta[property="og:image"]');
      if (og?.content) u.add(og.content);
    } catch { /* ignore */ }
    return [...u].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
  }

  /* R3 — 4-strategy DOM comment scraper */
  function _domComments() {
    const results = [], seen = SpmDedup(1000);
    try {
      let containers = spmQA('[role="listitem"]');
      if (!containers.length) containers = spmQA('ul > li').slice(1);
      if (!containers.length) {
        spmQA('time').forEach(t => {
          let el = t;
          for (let i = 0; i < 5; i++) {
            el = el?.parentElement; if (!el) break;
            const hasPfLink = spmQA('a[href^="/"]', el).some(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
            if (hasPfLink) { containers = [...containers, el]; break; }
          }
        });
      }
      containers.forEach(c => {
        try {
          const link = spmQA('a[href^="/"]', c).find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
          const username = link?.innerText?.trim() ?? '?';
          if (username === '?') return;
          let text = (c.innerText ?? '').trim();
          if (text.startsWith(username)) text = text.slice(username.length).trim();
          text = text.replace(/\s*\d+[wdhms]\s*$/gi, '')
                     .replace(/\s*(Reply|Like|Translate)\s*$/gi, '')
                     .replace(/\s*[\d,]+\s*likes?\s*$/gi, '')
                     .trim();
          if (!text || /^(Reply|View replies|Load more)/i.test(text)) return;
          if (!seen.isNew(username + ':' + text.slice(0, 40))) return;
          const timeEl = spmQ('time', c);
          const likeM  = (c.innerText ?? '').match(/(\d+)\s*likes?/i);
          if (results.length < SPM.MAX_COMMENTS) {
            results.push({
              id:       null, username, text,
              likes:    likeM ? _n(likeM[1]) : null,
              ts:       _ts(timeEl?.getAttribute('datetime')),
              time:     timeEl?.innerText?.trim() ?? '',
              hashtags: extractHashtags(text),
              mentions: extractMentions(text),
            });
          }
        } catch { /* skip bad item */ }
      });
    } catch (e) { log.error('_domComments:', e.message); }
    log.info('DOM comments scraped:', results.length);
    return results;
  }

  /* DOM profile — post author only, never commenter ────────── */
  function _domProfile() {
    const p = {};
    try {
      // og:title is always the post author, e.g. "username on Instagram: …"
      const ogTitle = spmQ('meta[property="og:title"]')?.content ?? '';
      const m = ogTitle.match(/^(.+?)\s+(?:on Instagram|•)/i) ?? ogTitle.match(/^@?([A-Za-z0-9._]+)/);
      if (m?.[1]) p.username = m[1].replace(/^@/, '');

      // First user link inside the post article <header>
      if (!p.username) {
        const postArea = spmQ('div[role="dialog"] article, main article, article') ?? document;
        const hdr      = spmQ('header', postArea);
        if (hdr) {
          const lnk = spmQA('a[href^="/"]', hdr).find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
          if (lnk?.innerText?.trim()) p.username = lnk.innerText.trim();
        }
      }

      const desc = spmQ('meta[name="description"]')?.content ?? '';
      const mF = desc.match(/([\d,KkMm.]+)\s*Followers/i);
      const mG = desc.match(/([\d,KkMm.]+)\s*Following/i);
      const mP = desc.match(/([\d,KkMm.]+)\s*Posts/i);
      if (mF) p.followers = _n(mF[1]);
      if (mG) p.following = _n(mG[1]);
      if (mP) p.posts     = _n(mP[1]);

      const titleM = document.title.match(/^(.+?)\s*[•(|@-]/);
      if (titleM && !p.name) p.name = titleM[1].trim();

      const postArea2 = spmQ('div[role="dialog"] article, main article, article') ?? document;
      const hdrImg    = spmQ('header img[alt*="profile picture"], header img', postArea2);
      if (hdrImg?.src && spmValidateUrl(hdrImg.src)) p.avatarSrc = hdrImg.src;

      p.bio = (spmQ('meta[property="og:description"]')?.content ?? '').slice(0, 300);
    } catch (e) { log.error('_domProfile:', e.message); }
    return p;
  }

  /* ─── Number + timestamp helpers ────────────────────────── */
  // inline versions that avoid double-importing
  function _n(v)  { return normalizeNumber(v); }
  function _ts(v) { return normalizeTimestamp(v); }

  /* ═══════════════════════════════════════════════════════════
   * PUBLIC surface
   * ═══════════════════════════════════════════════════════════ */

  /** Merged stats: API wins, DOM fills gaps */
  function stats() {
    const base = {
      platform: SPM.PLATFORM, url: location.href, ts: Date.now(),
      postId: location.href.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ?? `dom_${Date.now()}`,
      hashtags: [], mentions: [], mediaUrls: [],
    };
    try {
      if (!SPM.IS_IG) return _fbStats();
      const dom = _domStats();
      if (_latestPost) {
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
    } catch (e) { log.error('stats:', e.message); return base; }
  }

  function profile() {
    try { return _latestProfile ?? _domProfile(); }
    catch (e) { log.error('profile:', e.message); return {}; }
  }

  function getComments(postId) {
    try {
      if (postId && _comments.has(postId)) return _comments.get(postId);
      if (_latestPost?.postId && _comments.has(_latestPost.postId)) return _comments.get(_latestPost.postId);
      return _domComments();
    } catch (e) { log.error('getComments:', e.message); return []; }
  }

  function _fbStats() {
    const base = {
      platform:'facebook', url:location.href, ts:Date.now(), source:'dom',
      hashtags:[], mentions:[], mediaUrls:[],
      postId: `dom_${Date.now()}`,
    };
    try {
      const result = {};
      for (const el of spmQA('[aria-label]')) {
        const lbl = el.getAttribute('aria-label') ?? '';
        if (/\d/.test(lbl) && /react/i.test(lbl)   && !result.likes)    result.likes    = _n(lbl.match(/[\d,]+/)?.[0]);
        if (/\d/.test(lbl) && /comment/i.test(lbl)  && !result.comments) result.comments = _n(lbl.match(/[\d,]+/)?.[0]);
        if (/\d/.test(lbl) && /share/i.test(lbl)    && !result.shares)   result.shares   = _n(lbl.match(/[\d,]+/)?.[0]);
      }
      return { ...base, ...result };
    } catch (e) { log.error('_fbStats:', e.message); return base; }
  }

  function profileGridMedia() {
    const u = new Set();
    try {
      spmQA('article img,main img,[role="main"] img')
        .forEach(img => { if ((img.naturalWidth ?? img.width) > 150) u.add(img.src); });
      spmQA('video[poster]').forEach(v => { if (v.poster) u.add(v.poster); });
    } catch { /* ignore */ }
    return [...u].filter(spmValidateUrl).slice(0, 100);
  }

  function resetCache() {
    _posts.clear(); _profiles.clear(); _comments.clear(); _seenIds.clear();
    _latestPost = null; _latestProfile = null;
    log.info('Cache reset');
  }

  return {
    extractPostData,                    // primary — called by monitor.js
    stats,                              // merged API+DOM — called by UI scrape
    profile,
    getComments,
    getLatestPost:    () => _latestPost,
    getLatestProfile: () => _latestProfile,
    profileGridMedia,
    resetCache,
    hasApiData:       () => _latestPost !== null,
  };

})();
