// ═══════════════════════════════════════════════════════════════
//  SPM Pro v4  ·  content/interceptor.js
//  Runs in MAIN world (page JS context) to intercept fetch + XHR.
//  Parsed API data is sent to the content-script world via
//  window.postMessage({ spmData: ... }).
//  This file is injected as a separate content script with
//  "world": "MAIN" so it shares the page's JS context.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Deduplication: don't re-emit the same payload ─────────────
  const _seen = new Set();
  function _dedup(key) {
    if (_seen.has(key)) return false;
    _seen.add(key);
    if (_seen.size > 500) {
      // Evict oldest entries to prevent unbounded growth
      const arr = [..._seen];
      arr.slice(0, 250).forEach(k => _seen.delete(k));
    }
    return true;
  }

  // ── Emit parsed data to content script world ──────────────────
  function _emit(type, payload) {
    window.postMessage({ __spm: true, type, payload }, '*');
  }

  // ─────────────────────────────────────────────────────────────
  //  INSTAGRAM GraphQL parsers
  // ─────────────────────────────────────────────────────────────
  function _parseIGMediaNode(node) {
    if (!node) return null;
    const likeCount  = node.like_count
                    ?? node.edge_media_preview_like?.count
                    ?? node.edge_liked_by?.count
                    ?? null;
    const commentCnt = node.comment_count
                    ?? node.edge_media_to_comment?.count
                    ?? node.edge_media_preview_comment?.count
                    ?? null;
    const views      = node.video_view_count ?? node.play_count ?? null;
    const mediaUrls  = [];

    // Single image
    if (node.display_url)         mediaUrls.push(node.display_url);
    if (node.image_versions2?.candidates?.[0]?.url) mediaUrls.push(node.image_versions2.candidates[0].url);

    // Carousel
    const sidecar = node.edge_sidecar_to_children?.edges || node.carousel_media || [];
    sidecar.forEach(e => {
      const n = e.node || e;
      if (n.display_url)          mediaUrls.push(n.display_url);
      if (n.video_url)            mediaUrls.push(n.video_url);
      if (n.image_versions2?.candidates?.[0]?.url) mediaUrls.push(n.image_versions2.candidates[0].url);
    });

    // Video
    if (node.video_url) mediaUrls.push(node.video_url);

    if (likeCount == null && commentCnt == null) return null; // not a post node

    return {
      likes:     likeCount,
      comments:  commentCnt,
      shares:    node.reshare_count ?? null,
      reach:     views,
      reachIsNA: views == null && !node.is_video,
      mediaUrls: [...new Set(mediaUrls)].slice(0, 20),
      shortcode: node.shortcode || node.code || null,
    };
  }

  function _parseIGProfile(user) {
    if (!user) return null;
    return {
      username:  user.username,
      name:      user.full_name,
      followers: user.follower_count  ?? user.edge_followed_by?.count ?? null,
      following: user.following_count ?? user.edge_follow?.count       ?? null,
      posts:     user.media_count     ?? user.edge_owner_to_timeline_media?.count ?? null,
      bio:       user.biography || '',
      avatarSrc: user.profile_pic_url_hd || user.profile_pic_url || null,
      isVerified:user.is_verified || false,
    };
  }

  function _parseIGComments(payload) {
    const edges = payload?.comments?.edges
               || payload?.edge_media_to_comment?.edges
               || [];
    return edges.map(e => ({
      username: e.node?.owner?.username || '?',
      text:     e.node?.text            || '',
      time:     e.node?.created_at      || null,
      likes:    e.node?.edge_liked_by?.count ?? null,
      id:       e.node?.id              || null,
    })).filter(c => c.text);
  }

  // ── Walk any JSON object depth-first, looking for IG data ────
  function _walkIG(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return;

    // Media node (post)
    if (obj.like_count != null || obj.edge_media_preview_like != null || obj.edge_liked_by != null) {
      const parsed = _parseIGMediaNode(obj);
      if (parsed) {
        const key = `media:${parsed.shortcode}:${parsed.likes}`;
        if (_dedup(key)) _emit('IG_STATS', parsed);
      }
    }

    // User/profile node
    if (obj.username && (obj.follower_count != null || obj.edge_followed_by != null)) {
      const parsed = _parseIGProfile(obj);
      if (parsed) {
        const key = `profile:${parsed.username}`;
        if (_dedup(key)) _emit('IG_PROFILE', parsed);
      }
    }

    // Comments response
    if (obj.comments?.edges || obj.edge_media_to_comment?.edges) {
      const comments = _parseIGComments(obj);
      if (comments.length) {
        const key = `comments:${comments.map(c=>c.id).join(',')}`;
        if (_dedup(key)) _emit('IG_COMMENTS', { comments });
      }
    }

    // Recurse into arrays and objects
    if (Array.isArray(obj)) {
      obj.forEach(item => _walkIG(item, depth + 1));
    } else {
      Object.values(obj).forEach(val => {
        if (val && typeof val === 'object') _walkIG(val, depth + 1);
      });
    }
  }

  // ── Process raw response body text ───────────────────────────
  function _processResponseText(text, urlHint) {
    if (!text || text.length < 20) return;
    try {
      const json = JSON.parse(text);
      if (urlHint.includes('instagram.com')) _walkIG(json);
    } catch {
      // Not JSON — ignore (e.g. HTML responses)
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  FETCH INTERCEPT
  // ─────────────────────────────────────────────────────────────
  const _OrigFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const response = await _OrigFetch.apply(this, args);

    // Only intercept Instagram API calls
    if (!url.includes('instagram.com') && !url.includes('graph.instagram')) {
      return response;
    }
    // Only intercept likely data endpoints
    if (!/graphql|api\/v1|\/media\//i.test(url)) return response;

    try {
      const clone = response.clone();
      clone.text().then(text => _processResponseText(text, url)).catch(() => {});
    } catch {
      // Never break the original request
    }
    return response;
  };

  // ─────────────────────────────────────────────────────────────
  //  XHR INTERCEPT
  // ─────────────────────────────────────────────────────────────
  const _OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr   = new _OrigXHR();
    let   _url  = '';

    const _origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      _url = url || '';
      return _origOpen(method, url, ...rest);
    };

    xhr.addEventListener('load', function () {
      if (!_url.includes('instagram.com') && !_url.includes('graph.instagram')) return;
      if (!/graphql|api\/v1|\/media\//i.test(_url)) return;
      try {
        _processResponseText(xhr.responseText, _url);
      } catch {
        // Never break the page
      }
    });

    return xhr;
  }
  // Preserve static properties
  Object.setPrototypeOf(PatchedXHR, _OrigXHR);
  Object.assign(PatchedXHR, _OrigXHR);
  window.XMLHttpRequest = PatchedXHR;

  // ─────────────────────────────────────────────────────────────
  //  FACEBOOK GraphQL parsers (basic)
  // ─────────────────────────────────────────────────────────────
  function _walkFB(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;

    // FB post feedback node
    if (obj.reaction_count?.count != null || obj.comment_count?.total_count != null) {
      const data = {
        likes:    obj.reaction_count?.count ?? null,
        comments: obj.comment_count?.total_count ?? null,
        shares:   obj.share_count?.count ?? null,
        reach:    obj.impression_count ?? null,
      };
      if (data.likes != null || data.comments != null) {
        const key = `fb:${data.likes}:${data.comments}`;
        if (_dedup(key)) _emit('FB_STATS', data);
      }
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => _walkFB(item, depth + 1));
    } else {
      Object.values(obj).forEach(val => {
        if (val && typeof val === 'object') _walkFB(val, depth + 1);
      });
    }
  }

  const _processFB = function (text, url) {
    if (!text || !url.includes('facebook.com')) return;
    try {
      // FB often returns multiple JSON objects separated by newlines or uses __bbox wrapping
      const cleaned = text.replace(/^for\s*\([^)]*\);\s*/,''); // strip JSONP guard
      // Try each line as a JSON object
      cleaned.split('\n').forEach(line => {
        if (!line.trim()) return;
        try { _walkFB(JSON.parse(line)); } catch {}
      });
    } catch {}
  };

  // Extend fetch intercept for Facebook
  const _fbapiPattern = /graphql|api\/graphql/i;
  const _origFetch2 = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const response = await _origFetch2.apply(this, args);

    if (url.includes('facebook.com') && _fbapiPattern.test(url)) {
      try {
        response.clone().text().then(t => _processFB(t, url)).catch(() => {});
      } catch {}
    }
    return response;
  };

  console.log('[SPM Interceptor] Network interception active');
})();
