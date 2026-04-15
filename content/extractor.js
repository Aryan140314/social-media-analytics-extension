/**
 * SPM Pro v7 · content/extractor.js
 *
 * BUG FIXES in this version (from screenshots):
 *
 * FIX 1 – Shares always "—" on Reels
 *   Root cause: action button counts on Reels are in SVG-sibling spans,
 *   not in text like "308 shares". Added aria-label digit scan + vertical
 *   action panel scan for every action type.
 *
 * FIX 2 – Comments count "—" on post view
 *   Root cause: "193" is inside a button aria-label="193 comments".
 *   Previous selector missed it. Added dedicated aria-label scan.
 *
 * FIX 3 – Reach/Views always "—"
 *   Root cause: View count on Reels is rendered as a plain <span> in the
 *   video overlay, NOT next to a "views" label. Added a full-page numeric
 *   scan targeting the video play counter.
 *
 * FIX 4 – Comments tab shows "0 found"
 *   Root cause: _igDomComments() used `ul > li` which Instagram Reels
 *   no longer use. Comments are in role="listitem" divs or have a
 *   time/Reply sibling pattern. Complete rewrite with 4 strategies.
 *
 * FIX 5 – Profile shows wrong account ("Sexy munda" instead of post author)
 *   Root cause: profile() scraped the first <header> img + title on the
 *   page, which could be a commenter's hover card.
 *   Fix: extract post author ONLY from Reel overlay / post header /
 *   og:title, never from comment sections.
 *
 * FIX 6 – "Failed" / console errors → analytics/history save broken
 *   Root cause: buildReport() called with null postData; spmSend failing
 *   silently; SpmStorage.saveSnapshot throwing on missing postId.
 *   Fix: null-guard everywhere, ensure postId fallback to URL hash.
 */
'use strict';

const SpmExtractor = (() => {

  // ── Caches ────────────────────────────────────────────────
  const _postCache    = SpmCache(SPM.MAX_CACHE);
  const _profileCache = SpmCache(200);
  const _commentCache = SpmCache(200);
  const _apiDedup     = SpmDedup(2000);

  let _latestPost    = null;
  let _latestProfile = null;

  // Rate-limited entry point – prevents pipeline hammering
  const processApiPayload = spmRateLimit(function (payload) {
    if (!payload || typeof payload !== 'object') return null;
    try { return extractPostData(payload); }
    catch (e) { spmLog.error('[Extractor] processApiPayload:', e); return null; }
  }, 800);

  // ══════════════════════════════════════════════════════════
  //  PRIMARY — extractPostData(apiResponse)
  // ══════════════════════════════════════════════════════════
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

      // Reels / Clips shapes
      const clip = apiResponse?.data?.xdt_api__v1__clips__home__connection_v2?.edges?.[0]?.node?.media
                ?? apiResponse?.items?.[0]
                ?? apiResponse?.media;
      if (safeExtract(clip)) return _fromNode(clip);

      return _deepWalk(apiResponse);
    } catch (e) { spmLog.error('[Extractor] extractPostData:', e); return null; }
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

      // FIX 6: ensure postId never empty (fall back to URL hash)
      const postId = String(
        node.id ?? node.shortcode ?? node.pk ?? node.code ??
        location.href.split('/p/')?.[1]?.split('/')?.[0] ??
        location.href.split('/reel/')?.[1]?.split('/')?.[0] ??
        Date.now()
      );

      const postData = {
        postId, username, followers, likes, comments, shares, reach,
        caption,
        hashtags:  extractHashtags(caption),
        mentions:  extractMentions(caption),
        mediaUrls, mediaUrl: mediaUrls[0] ?? '', isVideo, ts,
        source:   'api',
        platform: 'instagram',
        url:      location.href,
      };

      const { valid, errors } = validatePostSchema(postData);
      if (!valid) spmLog.warn('[Extractor] Schema issues (non-fatal):', errors);

      // Strong dedup key: postId:likes:comments
      const dedupKey = `${postId}:${likes}:${comments}`;
      if (_apiDedup.isNew(dedupKey)) {
        _postCache.set(postId, postData);
        _latestPost = postData;
        spmLog.info('[Extractor] ✓ API post:', { postId: postId.slice(0,12), likes, comments, shares, reach, isVideo });
      } else {
        spmLog.debug('[Extractor] Dedup skip:', dedupKey);
        return _latestPost;
      }

      if (node.owner) _extractProfile(node.owner);
      _extractComments(postId, node);
      return postData;
    } catch (e) { spmLog.error('[Extractor] _fromNode:', e); return null; }
  }

  function _collectMediaUrls(node) {
    const urls = new Set();
    const add  = u => { if (u && typeof u === 'string') urls.add(u); };
    add(node.display_url); add(node.video_url); add(node.image_versions2?.candidates?.[0]?.url);
    const sc = node.edge_sidecar_to_children?.edges ?? node.carousel_media ?? [];
    sc.forEach(e => { const n = e.node ?? e; add(n.display_url); add(n.video_url); add(n.image_versions2?.candidates?.[0]?.url); });
    return [...urls];
  }

  function _extractProfile(user) {
    if (!user?.username) return;
    const p = {
      username:   user.username,
      name:       user.full_name ?? '',
      followers:  normalizeNumber(user.follower_count ?? user.edge_followed_by?.count ?? null),
      following:  normalizeNumber(user.following_count ?? user.edge_follow?.count ?? null),
      posts:      normalizeNumber(user.media_count ?? user.edge_owner_to_timeline_media?.count ?? null),
      bio:        user.biography ?? '',
      avatarSrc:  user.profile_pic_url_hd ?? user.profile_pic_url ?? '',
    };
    _profileCache.set(user.username, p);
    _latestProfile = p;
    spmLog.info('[Extractor] Profile cached:', user.username, 'followers:', p.followers);
  }

  function _extractComments(postId, node) {
    const edges = node?.edge_media_to_comment?.edges ?? node?.comments?.edges ?? [];
    if (!edges.length) return;
    const dedup = SpmDedup(500), list = [];
    edges.forEach(e => {
      const n = e?.node; if (!n?.text) return;
      const key = String(n.id ?? n.text.slice(0, 30));
      if (!dedup.isNew(key)) return;
      list.push({
        id: String(n.id ?? ''), username: n.owner?.username ?? '?', text: n.text,
        likes: normalizeNumber(n.edge_liked_by?.count ?? null),
        ts: normalizeTimestamp(n.created_at ?? null),
        hashtags: extractHashtags(n.text), mentions: extractMentions(n.text),
      });
    });
    if (list.length && postId) _commentCache.set(postId, list);
  }

  function _deepWalk(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    if (safeExtract(obj)) { const r = _fromNode(obj); if (r) return r; }
    if (obj.username && (obj.follower_count != null || obj.edge_followed_by != null)) _extractProfile(obj);
    for (const child of (Array.isArray(obj) ? obj : Object.values(obj))) {
      if (child && typeof child === 'object') { const r = _deepWalk(child, depth + 1); if (r) return r; }
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════
  //  DOM FALLBACK — Complete rewrite for Instagram Reels
  // ══════════════════════════════════════════════════════════

  /** Best post container — tries modal first, then article, then full page */
  function _root() {
    return spmQ('div[role="dialog"] article')
        ?? spmQ('main article')
        ?? spmQ('article')
        ?? spmQ('[role="main"]')
        ?? document;
  }

  // ── FIX 1, 2, 3: Reels-aware stat scraping ──────────────
  function _igDomStats() {
    const result = { source: 'dom' };

    try {
      // ════════════════════════════════════════
      //  STRATEGY A — aria-label digit scan
      //  Works for both Posts and Reels because
      //  every action button has aria-label with
      //  the count embedded, e.g.:
      //    "35,282 likes. Like"
      //    "193 comments"
      //    "308"  (reposts/shares)
      // ════════════════════════════════════════
      const ariaEls = spmQA('[aria-label]');
      for (const el of ariaEls) {
        const lbl = (el.getAttribute('aria-label') ?? '').trim();
        if (!lbl || !/\d/.test(lbl)) continue;

        // Likes
        if (!result.likes && /like/i.test(lbl)) {
          result.likes = normalizeNumber(lbl.replace(/[^\d,]/g, '').split(',')[0] + lbl.match(/,\d+/g)?.join('') ?? lbl.match(/[\d,]+/)?.[0]);
          // Re-parse properly
          const m = lbl.match(/^([\d,]+)/);
          if (m) result.likes = normalizeNumber(m[1]);
        }
        // Comments
        if (!result.comments && /comment/i.test(lbl)) {
          const m = lbl.match(/^([\d,]+)/);
          if (m) result.comments = normalizeNumber(m[1]);
        }
        // Shares / reposts
        if (!result.shares && /(share|repost|send)/i.test(lbl)) {
          const m = lbl.match(/^([\d,]+)/);
          if (m) result.shares = normalizeNumber(m[1]);
        }
      }

      // ════════════════════════════════════════
      //  STRATEGY B — span text next to action icons
      //  Instagram Reels vertical sidebar shows:
      //    [SVG heart icon]
      //    <span>35K</span>
      //    [SVG comment icon]
      //    <span>193</span>
      //    [SVG repost icon]
      //    <span>308</span>
      //  We collect all standalone numeric spans in
      //  the action area and assign them in order.
      // ════════════════════════════════════════
      if (!result.likes || !result.comments || !result.shares) {
        // The action button container for Reels is a flex column
        // Each button has an icon and a count span sibling
        const actionAreas = spmQA('section, [class*="action"], [class*="Action"]');
        for (const area of actionAreas) {
          const numericSpans = spmQA('span, div', area).filter(el => {
            const t = (el.innerText ?? '').trim();
            return /^[\d,.]+[KkMmBb]?$/.test(t) && el.children.length === 0;
          });
          if (numericSpans.length >= 2) {
            // Try to match by position: first = likes, second = comments, third = shares
            if (!result.likes    && numericSpans[0]) result.likes    = normalizeNumber(numericSpans[0].innerText.trim());
            if (!result.comments && numericSpans[1]) result.comments = normalizeNumber(numericSpans[1].innerText.trim());
            if (!result.shares   && numericSpans[2]) result.shares   = normalizeNumber(numericSpans[2].innerText.trim());
            break;
          }
        }
      }

      // ════════════════════════════════════════
      //  STRATEGY C — text pattern scan
      //  "1,001 likes" / "View all 193 comments"
      // ════════════════════════════════════════
      for (const el of spmQA('span, a, div')) {
        const t = (el.innerText ?? '').trim();
        if (t.length > 80) continue; // skip large containers

        if (!result.likes) {
          const m1 = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
          if (m1) { result.likes = normalizeNumber(m1[1]) + 1; continue; }
          const m2 = t.match(/^([\d,]+)\s+likes?$/i);
          if (m2) { result.likes = normalizeNumber(m2[1]); continue; }
        }
        if (!result.comments) {
          const m1 = t.match(/[Vv]iew all ([\d,]+) comments?/);
          if (m1) { result.comments = normalizeNumber(m1[1]); continue; }
          const m2 = t.match(/^([\d,]+)\s+comments?$/i);
          if (m2) { result.comments = normalizeNumber(m2[1]); continue; }
        }
        if (!result.shares) {
          const m = t.match(/^([\d,]+)\s+shares?$/i);
          if (m) { result.shares = normalizeNumber(m[1]); continue; }
        }
      }

      // ════════════════════════════════════════
      //  STRATEGY D — SVG sibling scan
      //  Each SVG action icon has a sibling/child
      //  span with the count.
      // ════════════════════════════════════════
      if (!result.shares) {
        // Try SVG elements whose aria-label or title contains "share"/"repost"
        const shareSvgs = spmQA('svg[aria-label*="hare"], svg[aria-label*="epost"], svg[aria-label*="end"]');
        for (const svg of shareSvgs) {
          const parent = svg.closest('div, button, span') ?? svg.parentElement;
          if (!parent) continue;
          // Look up to 3 levels for a numeric sibling
          let el = parent;
          for (let i = 0; i < 4; i++) {
            const spans = spmQA('span', el?.parentElement ?? el);
            for (const sp of spans) {
              const t = (sp.innerText ?? '').trim();
              if (/^[\d,.]+[KkMmBb]?$/.test(t) && t !== '0') {
                result.shares = normalizeNumber(t); break;
              }
            }
            if (result.shares) break;
            el = el?.parentElement;
          }
          if (result.shares) break;
        }
      }

      // ════════════════════════════════════════
      //  REACH / VIEWS — FIX 3
      //  On Reels the view count can appear as:
      //   • "308K views" plain text in overlay
      //   • A number-only span (play counter)
      //   • Inside a button aria-label
      // ════════════════════════════════════════
      const hasVideo = spmQA('video').length > 0;

      if (!hasVideo) {
        result.reach = null;
        result.reachIsNA = true;
      } else {
        // S1: exact "N views" / "N plays" text
        for (const el of spmQA('span, div, strong')) {
          const t = (el.innerText ?? '').trim();
          if (t.length > 30) continue;
          const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
          if (m) { result.reach = normalizeNumber(m[1]); break; }
        }
        // S2: aria-label with "view" + number
        if (!result.reach) {
          for (const el of ariaEls) {
            const lbl = (el.getAttribute('aria-label') ?? '');
            if (/view/i.test(lbl) && /\d/.test(lbl)) {
              const m = lbl.match(/([\d,.]+[KkMmBb]?)\s*views?/i);
              if (m) { result.reach = normalizeNumber(m[1]); break; }
            }
          }
        }
        // S3: number + "views" anywhere in page with small text budget
        if (!result.reach) {
          for (const el of spmQA('span, div')) {
            const t = (el.innerText ?? '').trim();
            if (t.length > 40) continue;
            const m = t.match(/([\d,.]+[KkMmBb]?)\s*(views?|plays?)/i);
            if (m) { result.reach = normalizeNumber(m[1]); break; }
          }
        }
        // S4: video element aria-label
        if (!result.reach) {
          for (const vid of spmQA('video')) {
            const lbl = vid.getAttribute('aria-label') ?? '';
            const m   = lbl.match(/([\d,.]+[KkMmBb]?)\s*views?/i);
            if (m) { result.reach = normalizeNumber(m[1]); break; }
          }
        }
      }

      // Caption + media
      result.caption   = spmQ('meta[property="og:description"]')?.content ?? '';
      result.hashtags  = extractHashtags(result.caption);
      result.mentions  = extractMentions(result.caption);
      result.mediaUrls = _igDomMedia();
      result.mediaUrl  = result.mediaUrls[0] ?? '';
      result.isVideo   = hasVideo;

      // FIX 6: ensure postId never empty for DOM-scraped data
      result.postId = (
        location.href.split('/p/')?.[1]?.split('/')?.[0] ??
        location.href.split('/reel/')?.[1]?.split('/')?.[0] ??
        location.href.split('/tv/')?.[1]?.split('/')?.[0] ??
        String(Date.now())
      );

      spmLog.info('[Extractor DOM] likes:', result.likes,
        '| comments:', result.comments,
        '| shares:', result.shares,
        '| reach:', result.reach);

    } catch (e) { spmLog.error('[Extractor] _igDomStats:', e); }
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
    } catch (e) { spmLog.error('[Extractor] _igDomMedia:', e); }
    return [...u].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
  }

  // ══════════════════════════════════════════════════════════
  //  FIX 4 — Comments tab: complete rewrite for Reel layout
  //  Instagram Reels do NOT use ul>li for comments.
  //  They use div-based lists with role="listitem" or
  //  comment containers identified by having a timestamp
  //  and a Reply button.
  // ══════════════════════════════════════════════════════════
  function _igDomComments() {
    const results = [];
    const seen    = SpmDedup(1000);

    try {
      // ── STRATEGY 1: role="listitem" (Reels comment panel) ──
      const listItems = spmQA('[role="listitem"]');
      if (listItems.length > 0) {
        spmLog.debug('[Comments] Strategy 1: role=listitem found', listItems.length);
        listItems.forEach(item => _parseCommentElement(item, results, seen));
      }

      // ── STRATEGY 2: Classic ul > li (photo post / dialog) ──
      if (results.length === 0) {
        const lis = spmQA('ul > li, ol > li');
        spmLog.debug('[Comments] Strategy 2: ul>li found', lis.length);
        // Skip first li (caption)
        lis.slice(1).forEach(li => _parseCommentElement(li, results, seen));
      }

      // ── STRATEGY 3: Any container with a time element + link ──
      // This catches any layout: look for elements that have
      // a <time> or "Reply" sibling — these are always comment rows
      if (results.length === 0) {
        spmLog.debug('[Comments] Strategy 3: time+link scan');
        const timeEls = spmQA('time');
        timeEls.forEach(timeEl => {
          // Walk up to find the comment container (usually 3-5 levels up)
          let container = timeEl;
          for (let i = 0; i < 5; i++) {
            container = container?.parentElement;
            if (!container) break;
            // Check if this level has a username link
            const userLink = spmQA('a[href^="/"]', container)
              .find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
            if (userLink) {
              _parseCommentElement(container, results, seen);
              break;
            }
          }
        });
      }

      // ── STRATEGY 4: Any div containing "Reply" button + user link ──
      if (results.length === 0) {
        spmLog.debug('[Comments] Strategy 4: Reply button scan');
        const replyBtns = spmQA('button, span').filter(el =>
          (el.innerText ?? '').trim() === 'Reply'
        );
        replyBtns.forEach(btn => {
          let container = btn;
          for (let i = 0; i < 6; i++) {
            container = container?.parentElement;
            if (!container) break;
            const userLink = spmQA('a[href^="/"]', container)
              .find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
            if (userLink) {
              _parseCommentElement(container, results, seen);
              break;
            }
          }
        });
      }

    } catch (e) { spmLog.error('[Extractor] _igDomComments:', e); }

    spmLog.info('[Extractor] Comments scraped from DOM:', results.length);
    return results;
  }

  /** Parse a comment from any container element */
  function _parseCommentElement(el, results, seen) {
    try {
      if (!el || results.length >= SPM.MAX_COMMENTS) return;

      // Find username link (profile link pattern: /username/ or /username)
      const userLink = spmQA('a[href^="/"]', el)
        .find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
      const username = userLink?.innerText?.trim() ?? '?';
      if (username === '?') return; // no username = not a comment

      // Get all text, strip username prefix and trailing actions
      let fullText = (el.innerText ?? '').trim();

      // Remove username from start
      if (fullText.startsWith(username)) {
        fullText = fullText.slice(username.length).trim();
      }

      // Remove trailing time + action words (Reply, Like, N likes, etc.)
      fullText = fullText
        .replace(/\s*\d+[wdhms]\s*$/gi, '')           // time like "3m", "2w"
        .replace(/\s*(Reply|Like|Translate|See translation)\s*$/gi, '')
        .replace(/\s*[\d,]+\s*likes?\s*$/gi, '')
        .trim();

      if (!fullText || fullText.length < 1) return;
      if (/^(Reply|View replies|Load more|Translate|See)/i.test(fullText)) return;

      const key = username + ':' + fullText.slice(0, 40);
      if (!seen.isNew(key)) return;

      const timeEl  = spmQ('time', el);
      const likeM   = (el.innerText ?? '').match(/(\d+)\s*likes?/i);

      results.push({
        id:       null,
        username,
        text:     fullText,
        likes:    likeM ? normalizeNumber(likeM[1]) : null,
        ts:       normalizeTimestamp(timeEl?.getAttribute('datetime') ?? null),
        time:     timeEl?.innerText?.trim() ?? '',
        hashtags: extractHashtags(fullText),
        mentions: extractMentions(fullText),
      });
    } catch (e) { spmLog.debug('[parseCommentElement] error:', e); }
  }

  // ══════════════════════════════════════════════════════════
  //  FIX 5 — Profile: ONLY grab post author, not commenter
  //  The previous version grabbed any profile card on the page.
  //  Now we specifically target the post author from:
  //    1. API cache (most reliable)
  //    2. Reel header username link (below the video)
  //    3. Post modal header
  //    4. og:title / page title (last resort)
  //  NEVER from comment author cards
  // ══════════════════════════════════════════════════════════
  function profile() {
    try {
      // 1. API cache is always accurate
      if (_latestProfile) return _latestProfile;

      const p = {};

      // 2. Try to get post author username from Reel overlay / post header
      // Reel overlay: the username appears as a link in the bottom section
      // of the video, OR in a dedicated "header" section of the post dialog
      const postAuthorUsername = _getPostAuthorUsername();
      if (postAuthorUsername) p.username = postAuthorUsername;

      // 3. Profile stats from meta (most reliable for follower counts)
      const desc = spmQ('meta[name="description"]')?.content ?? '';
      const mF = desc.match(/([\d,KkMm.]+)\s*Followers/i);
      const mG = desc.match(/([\d,KkMm.]+)\s*Following/i);
      const mP = desc.match(/([\d,KkMm.]+)\s*Posts/i);
      if (mF) p.followers = normalizeNumber(mF[1]);
      if (mG) p.following = normalizeNumber(mG[1]);
      if (mP) p.posts     = normalizeNumber(mP[1]);

      // 4. Name + avatar from page title or og tags
      // og:title is typically "username on Instagram: caption"
      const ogTitle = spmQ('meta[property="og:title"]')?.content ?? '';
      if (ogTitle && !p.name) {
        const titleM = ogTitle.match(/^(.+?)\s+(?:on Instagram|•)/i);
        if (titleM) p.name = titleM[1].trim();
      }
      if (!p.name) {
        const pageTitle = document.title;
        const titleM = pageTitle.match(/^(.+?)\s*[•(|@-]/);
        if (titleM) p.name = titleM[1].trim();
      }

      // 5. Avatar — only from the post header, NOT comment cards
      //    The post header is the first <header> or [class*="header"] inside
      //    the post dialog/article
      const postArea  = spmQ('div[role="dialog"] article, main article, article') ?? document;
      const headerImg = spmQ('header img[alt*="profile picture"], header img', postArea);
      if (headerImg?.src && spmValidateUrl(headerImg.src)) p.avatarSrc = headerImg.src;

      // 6. Bio from og:description (not from DOM, avoids comment text)
      p.bio = (spmQ('meta[property="og:description"]')?.content ?? '').slice(0, 300);

      spmLog.info('[Extractor] Profile DOM:', p.username, 'followers:', p.followers);
      return p;
    } catch (e) { spmLog.error('[Extractor] profile:', e); return {}; }
  }

  /**
   * _getPostAuthorUsername()
   *
   * Finds the POST AUTHOR's username without confusing it with
   * commenters. Looks in specific places only.
   */
  function _getPostAuthorUsername() {
    try {
      // Post modal header: the very first user link in the article/dialog header
      const postArea = spmQ('div[role="dialog"] article, main article, article');
      if (postArea) {
        // The header section of the post (not the comments section)
        const header = spmQ('header', postArea) ?? spmQ('[class*="header"]', postArea);
        if (header) {
          const link = spmQA('a[href^="/"]', header)
            .find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
          if (link?.innerText?.trim()) return link.innerText.trim();
        }

        // Fallback: first user link in the article that points to a simple /username/ path
        // (not /username/tagged/, /username/followers/ etc.)
        const firstLink = spmQA('a[href^="/"]', postArea)
          .find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') ?? ''));
        if (firstLink?.innerText?.trim()) return firstLink.innerText.trim();
      }

      // For Reels in feed: username is in the overlay at bottom-left
      // og:title: "username • Original audio" or "username on Instagram"
      const ogTitle = spmQ('meta[property="og:title"]')?.content ?? '';
      const m = ogTitle.match(/^([A-Za-z0-9._]+)\s*(?:on Instagram|•|–)/i)
             ?? ogTitle.match(/^@?([A-Za-z0-9._]+)/);
      if (m?.[1]) return m[1].replace(/^@/, '');

      return null;
    } catch (e) { spmLog.debug('[_getPostAuthorUsername]', e); return null; }
  }

  // ── Facebook DOM (unchanged) ──────────────────────────────
  function _fbDomStats() {
    const base = { platform: 'facebook', url: location.href, ts: Date.now(), source: 'dom', hashtags: [], mentions: [], mediaUrls: [], postId: String(Date.now()) };
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

  // ── Public stats() — API wins, DOM fills gaps ─────────────
  function stats() {
    // FIX 6: wrap in try/catch, never throw
    const base = { platform: SPM.PLATFORM, url: location.href, ts: Date.now(),
      postId: String(Date.now()), hashtags: [], mentions: [], mediaUrls: [] };
    try {
      if (!SPM.IS_IG) return _fbDomStats();
      const dom = _igDomStats();
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
    } catch (e) { spmLog.error('[Extractor] stats:', e); return base; }
  }

  function comments(postId) {
    // FIX 4: return API cache first, then call fixed DOM scraper
    try {
      if (postId && _commentCache.has(postId)) return _commentCache.get(postId);
      if (_latestPost?.postId && _commentCache.has(_latestPost.postId)) return _commentCache.get(_latestPost.postId);
      return _igDomComments();
    } catch (e) { spmLog.error('[Extractor] comments:', e); return []; }
  }

  function profileGridMedia() {
    const u = new Set();
    try {
      spmQA('article img, main img, [role="main"] img')
        .forEach(img => { if ((img.naturalWidth ?? img.width) > 150) u.add(img.src); });
      spmQA('video[poster]').forEach(v => { if (v.poster) u.add(v.poster); });
    } catch (e) { spmLog.error('[Extractor] profileGridMedia:', e); }
    return [...u].filter(spmValidateUrl).slice(0, 100);
  }

  function resetCache() {
    _postCache.clear(); _profileCache.clear(); _commentCache.clear(); _apiDedup.clear();
    _latestPost = null; _latestProfile = null;
    spmLog.info('[Extractor] Cache reset');
  }

  return {
    extractPostData,
    processApiPayload,
    stats, profile, comments, profileGridMedia, resetCache,
    getPostCache:    () => _postCache,
    getProfileCache: () => _profileCache,
    getLatestPost:   () => _latestPost,
    hasApiData:      () => _latestPost !== null,
  };

})();
