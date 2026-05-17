/* ============================================================
   extractor.js — Data extraction: API shapes + DOM fallback
   v10 — fixes: _deepWalk initial depth (was 0, now 6),
         non-post API response filtering,
         MAX_MEDIA cap raised to 50
   ============================================================ */

'use strict';

const SpmExtractor = (() => {
  const _apiCache   = SpmCache(SPM.MAX_CACHE);
  const _dedup      = SpmDedup(200);
  let _latestPost   = null;
  let _latestProfile = null;
  let _commentCache  = SpmCache(50);
  let _hasApiData    = false;

  // ── Dedup key ────────────────────────────────────────────────
  // FIX v9 already fixed this (was url+byteLength), keeping correct version:
  // include likes+comments so a post that gets new engagement is re-processed
  function _dedupKey(postId, likes, comments) {
    return `${postId}:${likes ?? '-'}:${comments ?? '-'}`;
  }

  // ── Shape detection: is this payload a post API response? ────
  // FIX v10: v9 fired on ANY GraphQL response (stories, DMs, explore, etc.)
  // _deepWalk would then try to extract a post from garbage data.
  function _looksLikePostPayload(raw) {
    if (!raw || typeof raw !== 'object') return false;
    // Quick check for common post-shaped keys
    const d = raw.data || raw;
    return !!(
      d.xdt_shortcode_media ||
      d.shortcode_media ||
      d.user?.edge_owner_to_timeline_media ||
      d.hashtag?.edge_hashtag_to_media ||
      d.xdt_api__v1__clips__home__connection ||
      raw.items ||
      raw.media ||
      raw.graphql
    );
  }

  // ── 8 GraphQL shapes ─────────────────────────────────────────
  function _extractFromShape(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw.data || raw;

    // Shape 1: modern single post
    if (d.xdt_shortcode_media)
      return _normalise(d.xdt_shortcode_media, 'api');

    // Shape 2: legacy single post
    if (d.shortcode_media)
      return _normalise(d.shortcode_media, 'api');

    // Shape 3: profile timeline
    const timelineEdges = d.user?.edge_owner_to_timeline_media?.edges;
    if (timelineEdges?.length)
      return _normalise(timelineEdges[0].node, 'api');

    // Shape 4: hashtag media
    const hashtagEdges = d.hashtag?.edge_hashtag_to_media?.edges;
    if (hashtagEdges?.length)
      return _normalise(hashtagEdges[0].node, 'api');

    // Shape 5: Reels/clips
    const clipKeys = Object.keys(d).filter(k => k.includes('clips'));
    for (const k of clipKeys) {
      const edges = d[k]?.edges;
      if (edges?.length) return _normalise(edges[0].node?.media || edges[0].node, 'api');
    }

    // Shape 6: API v1 items array
    if (Array.isArray(raw.items) && raw.items[0])
      return _normalise(raw.items[0], 'api');

    // Shape 7: top-level media
    if (raw.media)
      return _normalise(raw.media, 'api');

    // Shape 8: recursive walk — FIX v10: start at depth 6, not 0
    // depth=0 caused immediate return null with no recursion
    return _deepWalk(raw, 6);
  }

  // ── Recursive deep walk ───────────────────────────────────────
  // FIX v10: was _deepWalk(raw, 0) — depth 0 = no recursion = always null
  function _deepWalk(obj, depth) {
    if (depth <= 0 || !obj || typeof obj !== 'object') return null;
    const candidate = safeExtract(obj);
    if (candidate) return _normalise(candidate, 'api');
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const found = _deepWalk(v, depth - 1);
        if (found) return found;
      }
    }
    return null;
  }

  // ── Normalise any node into PostData ──────────────────────────
  function _normalise(node, source) {
    if (!node) return null;
    const postId = String(
      node.pk || node.id || node.shortcode || node.code || ''
    ).trim();
    if (!postId) return null;

    const caption = node.caption?.text
      || node.edge_media_to_caption?.edges?.[0]?.node?.text
      || '';

    const mediaUrls = _collectMediaUrls(node);

    return {
      postId,
      username:  node.owner?.username || node.user?.username || null,
      followers: normalizeNumber(
        node.owner?.edge_followed_by?.count
        || node.user?.follower_count
        || node.owner?.follower_count
        || null
      ),
      likes:     normalizeNumber(
        node.like_count
        || node.edge_media_preview_like?.count
        || node.edge_liked_by?.count
        || null
      ),
      comments:  normalizeNumber(
        node.comment_count
        || node.edge_media_to_comment?.count
        || null
      ),
      shares:    normalizeNumber(node.share_count || null),
      reach:     normalizeNumber(
        node.view_count
        || node.play_count
        || node.ig_play_count
        || null
      ),
      caption,
      hashtags:  extractHashtags(caption),
      mentions:  extractMentions(caption),
      mediaUrls,
      mediaUrl:  mediaUrls[0] || null,
      isVideo:   !!(node.is_video || node.video_url || node.video_versions),
      ts:        normalizeTimestamp(node.taken_at || node.taken_at_timestamp || null),
      source,
      platform:  SPM.PLATFORM,
      url:       location.href,
    };
  }

  // ── Collect media URLs ────────────────────────────────────────
  function _collectMediaUrls(node) {
    const urls = new Set();
    const add = u => { if (spmValidateUrl(u)) urls.add(u); };

    // Single image/video
    add(node.display_url || node.image_versions2?.candidates?.[0]?.url);
    add(node.video_url || node.video_versions?.[0]?.url);

    // Carousel / sidecar
    const edges = node.edge_sidecar_to_children?.edges || node.carousel_media || [];
    for (const e of edges.slice(0, SPM.MAX_MEDIA)) { // FIX: MAX_MEDIA raised to 50
      const n = e.node || e;
      add(n.display_url || n.image_versions2?.candidates?.[0]?.url);
      add(n.video_url || n.video_versions?.[0]?.url);
    }
    return [...urls];
  }

  // ── DOM fallback strategies ───────────────────────────────────
  function _domStats() {
    return {
      likes:    _domLikes(),
      comments: _domComments(),
      shares:   _domShares(),
      reach:    _domReach(),
    };
  }

  function _domLikes() {
    // Strategy 1: aria-label on like button
    const ariaBtn = document.querySelector('[aria-label*="like" i]');
    if (ariaBtn) {
      const m = ariaBtn.getAttribute('aria-label').match(/([\d,.]+[KkMm]?)\s+like/i);
      if (m) return normalizeNumber(m[1]);
    }
    // Strategy 2: "Liked by X and N others"
    const likedBy = document.querySelector('span[class*="like"]');
    if (likedBy) {
      const m = likedBy.textContent.match(/and\s+([\d,.]+[KkMm]?)\s+other/i);
      if (m) return normalizeNumber(m[1]);
    }
    // Strategy 3: section span with number
    const spans = document.querySelectorAll('section span');
    for (const s of spans) {
      const n = normalizeNumber(s.textContent.trim());
      if (n != null && n > 0) return n;
    }
    // Strategy 4: "N likes" text
    const all = document.querySelectorAll('span, a');
    for (const el of all) {
      const m = el.textContent.trim().match(/^([\d,.]+[KkMm]?)\s+like/i);
      if (m) return normalizeNumber(m[1]);
    }
    return null;
  }

  function _domComments() {
    // Strategy 1: aria-label with "comment"
    const ariaEl = document.querySelector('[aria-label*="comment" i]');
    if (ariaEl) {
      const m = ariaEl.getAttribute('aria-label').match(/([\d,.]+[KkMm]?)/);
      if (m) return normalizeNumber(m[1]);
    }
    // Strategy 2: "View all N comments"
    const all = document.querySelectorAll('span, a, button');
    for (const el of all) {
      const m = el.textContent.trim().match(/[Vv]iew\s+all\s+([\d,.]+[KkMm]?)\s+comment/i);
      if (m) return normalizeNumber(m[1]);
    }
    // Strategy 3: role="listitem" count
    const listitems = document.querySelectorAll('[role="listitem"]');
    if (listitems.length > 2) return listitems.length; // rough estimate
    // Strategy 4: Reply button siblings
    const replyBtns = document.querySelectorAll('button[type="button"]');
    let count = 0;
    for (const b of replyBtns) {
      if (/reply/i.test(b.textContent)) count++;
    }
    return count > 0 ? count : null;
  }

  function _domShares() {
    // Strategy 1: aria-label with "share"
    const ariaEl = document.querySelector('[aria-label*="share" i]');
    if (ariaEl) {
      const m = ariaEl.getAttribute('aria-label').match(/([\d,.]+[KkMm]?)/);
      if (m) return normalizeNumber(m[1]);
    }
    // Strategy 2: text pattern
    const all = document.querySelectorAll('span');
    for (const el of all) {
      const m = el.textContent.trim().match(/^([\d,.]+[KkMm]?)\s+share/i);
      if (m) return normalizeNumber(m[1]);
    }
    // Strategy 3: SVG sibling scan (share icon next to number)
    const svgs = document.querySelectorAll('svg');
    for (const svg of svgs) {
      const parent = svg.parentElement;
      if (!parent) continue;
      const sibling = parent.nextElementSibling || parent.parentElement?.nextElementSibling;
      if (sibling) {
        const n = normalizeNumber(sibling.textContent.trim());
        if (n != null && n >= 0) {
          const label = (parent.getAttribute('aria-label') || '').toLowerCase();
          if (label.includes('share')) return n;
        }
      }
    }
    return null;
  }

  function _domReach() {
    // Strategy 1: "N views" text
    const all = document.querySelectorAll('span, a');
    for (const el of all) {
      const m = el.textContent.trim().match(/^([\d,.]+[KkMm]?)\s+view/i);
      if (m) return normalizeNumber(m[1]);
    }
    // Strategy 2: sibling pattern near video
    const video = document.querySelector('video');
    if (video) {
      const parent = video.closest('div, article');
      if (parent) {
        const spans = parent.querySelectorAll('span');
        for (const s of spans) {
          const n = normalizeNumber(s.textContent.trim());
          if (n != null && n > 100) return n; // rough heuristic
        }
      }
    }
    // Strategy 3: inline scan
    const all2 = document.querySelectorAll('span, p');
    for (const el of all2) {
      const m = el.textContent.match(/(\d[\d,.]+[KkMm]?)\s+plays?/i);
      if (m) return normalizeNumber(m[1]);
    }
    // Strategy 4: video aria-label
    const vEl = document.querySelector('[aria-label*="view" i]');
    if (vEl) {
      const m = vEl.getAttribute('aria-label').match(/([\d,.]+[KkMm]?)/);
      if (m) return normalizeNumber(m[1]);
    }
    return null;
  }

  // ── Profile extraction ────────────────────────────────────────
  function _extractProfile(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw.data || raw;
    const user = d.user || d.User || raw.user;
    if (!user) return null;
    // Guard: must look like a post author, not a commenter
    if (!user.pk && !user.id) return null;
    return {
      userId:    String(user.pk || user.id || ''),
      username:  user.username || null,
      fullName:  user.full_name || null,
      followers: normalizeNumber(user.follower_count || user.edge_followed_by?.count || null),
      following: normalizeNumber(user.following_count || user.edge_follow?.count || null),
      posts:     normalizeNumber(user.media_count || user.edge_owner_to_timeline_media?.count || null),
      bio:       user.biography || null,
      avatar:    user.profile_pic_url || null,
      isVerified: !!(user.is_verified),
      isPrivate:  !!(user.is_private),
    };
  }

  // ── Comments extraction ───────────────────────────────────────
  function _extractComments(raw, postId) {
    const items = raw?.comments || raw?.data?.comments || [];
    if (!Array.isArray(items) || !items.length) return null;
    const list = items.slice(0, SPM.MAX_COMMENTS).map(c => ({
      id:       c.pk || c.id,
      username: c.user?.username || c.owner?.username || '?',
      text:     c.text || '',
      ts:       normalizeTimestamp(c.created_at || c.taken_at || null),
      likes:    normalizeNumber(c.comment_like_count || null),
    }));
    _commentCache.set(postId, list);
    return list;
  }

  // ── DOM comment scrape ────────────────────────────────────────
  function _domCommentList() {
    const results = [];
    // Try multiple selectors for comment items
    const selectors = [
      '[role="listitem"]',
      'ul > li',            // FIX v9 already fixed "ul > li fails on Reels" but keeping here
      '[data-testid="comment"]',
    ];
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length < 2) continue;
      for (const item of items) {
        const textEl = item.querySelector('span[dir="auto"]') || item.querySelector('span');
        if (!textEl) continue;
        const userEl = item.querySelector('a[href*="/"]');
        results.push({
          username: userEl?.textContent?.trim() || '?',
          text: textEl.textContent.trim(),
          ts: null,
          likes: null,
        });
      }
      if (results.length > 0) break;
    }
    return results.slice(0, SPM.MAX_COMMENTS);
  }

  // ── Profile grid media ────────────────────────────────────────
  function profileGridMedia() {
    const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    const urls = [];
    for (const a of links) {
      const img = a.querySelector('img');
      const src = img?.src;
      if (src && spmValidateUrl(src) && !urls.includes(src)) {
        urls.push(src);
      }
      if (urls.length >= SPM.MAX_MEDIA) break;
    }
    return urls;
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    extractPostData(rawJson) {
      if (!_looksLikePostPayload(rawJson)) return null; // FIX v10: filter non-post payloads
      const postData = _extractFromShape(rawJson);
      if (!postData) return null;

      // Profile
      const profile = _extractProfile(rawJson);
      if (profile?.username && profile.username === postData.username) {
        _latestProfile = profile;
      }

      // Comments
      if (rawJson.comments || rawJson.data?.comments) {
        _extractComments(rawJson, postData.postId);
      }

      // Dedup check
      const key = _dedupKey(postData.postId, postData.likes, postData.comments);
      if (!_dedup.isNew(key)) return null; // duplicate

      _latestPost = postData;
      _hasApiData = true;
      _apiCache.set(postData.postId, postData);
      return postData;
    },

    stats() {
      if (_latestPost) return _latestPost;
      // DOM fallback
      const dom = _domStats();
      if (!dom.likes && !dom.comments && !dom.reach) return null;
      const postId = location.pathname.split('/').filter(Boolean).pop() || 'unknown';
      return {
        postId,
        username: null,
        followers: null,
        likes: dom.likes,
        comments: dom.comments,
        shares: dom.shares,
        reach: dom.reach,
        caption: '',
        hashtags: [],
        mentions: [],
        mediaUrls: [],
        mediaUrl: null,
        isVideo: !!(dom.reach),
        ts: null,
        source: 'dom',
        platform: SPM.PLATFORM,
        url: location.href,
      };
    },

    profile()              { return _latestProfile; },
    getComments(postId)    { return _commentCache.get(postId) || _domCommentList(); },
    getLatestPost()        { return _latestPost; },
    getLatestProfile()     { return _latestProfile; },
    resetCache()           { _dedup.clear(); _apiCache.clear(); _latestPost = null; _latestProfile = null; _hasApiData = false; },
    hasApiData()           { return _hasApiData; },
    profileGridMedia,
  };
})();
