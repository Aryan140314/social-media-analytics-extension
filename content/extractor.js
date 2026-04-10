// ═══════════════════════════════════════════════════════════════
//  SPM Pro v3  ·  content/extractor.js
//  All scraping logic — separated from UI and monitor concerns.
//  Uses aria-labels + semantic fallbacks (no brittle class names).
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Public API ──────────────────────────────────────────────────
const SpmExtractor = (() => {

  // ── Instagram: scrape post stats ─────────────────────────────
  function igStats() {
    const result = { platform: 'instagram', url: location.href, ts: Date.now() };

    // ── Likes ──────────────────────────────────────────────────
    // Strategy 1: "Liked by X and 58 others"
    for (const el of spmQA('span, a')) {
      const t = (el.innerText || '').trim();
      const m1 = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
      if (m1) { result.likes = String(spmParseNum(m1[1]) + 1); break; }
      const m2 = t.match(/^([\d,]+)\s+likes?$/i);
      if (m2) { result.likes = m2[1]; break; }
      const m3 = t.match(/^[Ll]iked by ([\d,]+) people/);
      if (m3) { result.likes = m3[1]; break; }
    }
    // Fallback: aria-label on like button
    if (!result.likes) {
      for (const el of spmQA('[aria-label]')) {
        const lbl = el.getAttribute('aria-label') || '';
        if (/like/i.test(lbl) && /\d/.test(lbl)) {
          result.likes = lbl.match(/[\d,]+/)?.[0] || null;
          if (result.likes) break;
        }
      }
    }

    // ── Comments ───────────────────────────────────────────────
    // Strategy 1: "View all N comments"
    for (const el of spmQA('span, a')) {
      const t = (el.innerText || '').trim();
      const m1 = t.match(/[Vv]iew all ([\d,]+) comments?/);
      if (m1) { result.comments = m1[1]; break; }
      const m2 = t.match(/^([\d,]+)\s+comments?$/i);
      if (m2) { result.comments = m2[1]; break; }
    }
    // Strategy 2: count visible <li> rows (skip caption = index 0)
    if (!result.comments) {
      const lis = spmQA('div[role="dialog"] ul > li, article ul > li')
        .slice(1)
        .filter(li => {
          const t = (li.innerText || '').trim();
          return t.length > 1 && !/^[Vv]iew/i.test(t);
        });
      if (lis.length) result.comments = `${lis.length} (visible)`;
    }
    // Strategy 3: count Reply buttons as proxy
    if (!result.comments) {
      const r = spmQA('button, span').filter(el => (el.innerText || '').trim() === 'Reply');
      if (r.length) result.comments = `${r.length} (visible)`;
    }

    // ── Reach / Views ──────────────────────────────────────────
    const hasVideo = spmQA('video').length > 0;
    if (!hasVideo) {
      result.reach = 'N/A (Photo)';
      result.reachIsNA = true;
    } else {
      for (const el of spmQA('span, div')) {
        const t = (el.innerText || '').trim();
        const m = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
        if (m) { result.reach = m[1]; break; }
      }
      if (!result.reach) {
        for (const el of spmQA('span')) {
          const t    = (el.innerText || '').trim();
          const next = (el.nextElementSibling?.innerText || '').trim();
          if (/^[\d,.]+[KkMm]?$/.test(t) && /views?/i.test(next)) {
            result.reach = t; break;
          }
        }
      }
      result.reach = result.reach || '—';
    }

    // ── Media URLs ─────────────────────────────────────────────
    result.mediaUrls = igMedia();
    return result;
  }

  function igMedia() {
    const u = new Set();
    spmQA('article img[src*="cdninstagram"], article img[src*="fbcdn"]')
      .forEach(img => { if ((img.naturalWidth || img.width) > 200) u.add(img.src); });
    spmQA('video[src], video source[src]')
      .forEach(v => { const s = v.src || v.getAttribute('src'); if (s) u.add(s); });
    const og = spmQ('meta[property="og:image"]');
    if (og?.content) u.add(og.content);
    return [...u].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
  }

  // ── Instagram: scrape profile page ────────────────────────────
  function igProfile() {
    const p = {};

    // From page title → "Username • Instagram"
    const titleM = document.title.match(/^(.+?)\s*[•(|@-]/);
    if (titleM) p.name = titleM[1].trim();

    // Avatar — look for the profile pic in the header area
    const hdr = spmQ('header') || spmQ('main header');
    if (hdr) {
      const av = spmQ('img[alt*="profile picture"]', hdr) || spmQ('img', hdr);
      if (av?.src && spmValidateUrl(av.src)) p.avatarSrc = av.src;
    }

    // Follower / Following / Posts via semantic text patterns
    for (const el of spmQA('span, li')) {
      const t = (el.innerText || '').trim();
      const m = t.match(/^([\d,KkMm.]+)\s+(followers?|following|posts?)$/i);
      if (m) {
        const key = m[2].toLowerCase().replace(/s$/, '');
        if (key === 'follower'  && !p.followers) p.followers = m[1];
        if (key === 'following' && !p.following) p.following = m[1];
        if (key === 'post'      && !p.posts)     p.posts     = m[1];
      }
    }

    // Meta description as reliable fallback: "N Followers, N Following, N Posts"
    const desc = spmQ('meta[name="description"]')?.content || '';
    const mF = desc.match(/([\d,KkMm.]+)\s*Followers/i);
    const mG = desc.match(/([\d,KkMm.]+)\s*Following/i);
    const mP = desc.match(/([\d,KkMm.]+)\s*Posts/i);
    if (mF && !p.followers) p.followers = mF[1];
    if (mG && !p.following) p.following = mG[1];
    if (mP && !p.posts)     p.posts     = mP[1];

    // Bio from og:description
    p.bio = spmQ('meta[property="og:description"]')?.content
          || spmQ('meta[name="description"]')?.content
          || '';
    if (p.bio.length > 200) p.bio = p.bio.slice(0, 200) + '…';

    return p;
  }

  // ── Instagram: scrape visible comments ───────────────────────
  function igComments() {
    const results = [];
    const seen    = new Set();

    const lis = [
      ...spmQA('div[role="dialog"] ul > li'),
      ...spmQA('article ul > li'),
    ].slice(1); // skip caption row

    for (const li of lis) {
      // Extract username from first <a> that links to a profile
      const userLink = spmQA('a[href^="/"]', li)
        .find(a => /^\/[^/]+\/?$/.test(a.getAttribute('href') || ''));
      const username = userLink?.innerText?.trim() || '?';

      // Full text, then strip username prefix + trailing action text
      let text = (li.innerText || '').trim();
      if (text.startsWith(username)) text = text.slice(username.length).trim();
      text = text.replace(/\s*(Reply|Like|[\d,]+\s*likes?)\s*$/gi, '').trim();

      if (!text || /^(Reply|View replies|Load more)/i.test(text)) continue;

      const key = username + ':' + text.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);

      const timeEl = spmQ('time', li);
      const time   = timeEl?.getAttribute('datetime') || timeEl?.innerText?.trim() || '';
      const likeM  = (li.innerText || '').match(/(\d+)\s*likes?/i);

      if (results.length >= SPM.MAX_COMMENTS) break;
      results.push({ username, text, time, likes: likeM ? likeM[1] : null });
    }
    return results;
  }

  // ── Facebook: scrape post stats ───────────────────────────────
  function fbStats() {
    const result = { platform: 'facebook', url: location.href, ts: Date.now() };

    // Likes — prefer aria-label on reaction buttons
    for (const el of spmQA('[aria-label]')) {
      const lbl = el.getAttribute('aria-label') || '';
      if (/\d/.test(lbl) && /react/i.test(lbl)) {
        result.likes = lbl.match(/[\d,]+/)?.[0];
        if (result.likes) break;
      }
    }
    // Fallback: text-based
    if (!result.likes) {
      for (const sel of ['[data-testid="UFI2ReactionsCount/root"]', 'span[aria-label*="reaction"]']) {
        const el = spmQ(sel);
        if (el?.innerText?.trim()) { result.likes = el.innerText.trim(); break; }
      }
    }

    // Comments
    for (const el of spmQA('[aria-label]')) {
      const lbl = el.getAttribute('aria-label') || '';
      if (/\d/.test(lbl) && /comment/i.test(lbl)) {
        result.comments = lbl.match(/[\d,]+/)?.[0];
        if (result.comments) break;
      }
    }

    // Shares
    for (const el of spmQA('[aria-label]')) {
      const lbl = el.getAttribute('aria-label') || '';
      if (/\d/.test(lbl) && /share/i.test(lbl)) {
        result.shares = lbl.match(/[\d,]+/)?.[0];
        if (result.shares) break;
      }
    }
    if (!result.shares) {
      for (const el of spmQA('span, div')) {
        const t = (el.innerText || '').trim();
        if (/^\d[\d,KkMm]*\s*shares?/i.test(t)) { result.shares = t.match(/[\d,KkMm]+/)?.[0]; break; }
      }
    }

    // Reach (only visible on own posts)
    for (const el of spmQA('span, div')) {
      const t = (el.innerText || '').trim();
      if (/(people reached|reach)/i.test(t) && /\d/.test(t)) {
        result.reach = t.match(/[\d,KkMm]+/)?.[0];
        if (result.reach) break;
      }
    }

    result.mediaUrls = fbMedia();
    return result;
  }

  function fbMedia() {
    const u = new Set();
    spmQA('img[src*="fbcdn"]')
      .forEach(img => { if ((img.naturalWidth || img.width) > 200) u.add(img.src); });
    spmQA('video[src], video source[src]')
      .forEach(v => { const s = v.src || v.getAttribute('src'); if (s) u.add(s); });
    const og = spmQ('meta[property="og:image"]');
    if (og?.content) u.add(og.content);
    return [...u].filter(spmValidateUrl).slice(0, SPM.MAX_MEDIA);
  }

  // ── Facebook: scrape profile ──────────────────────────────────
  function fbProfile() {
    const p = {};
    const titleM = document.title.match(/^(.+?)\s*[-|•]/);
    if (titleM) p.name = titleM[1].trim();
    const desc = spmQ('meta[name="description"]')?.content || '';
    const mF = desc.match(/([\d,]+)\s*(friends|followers)/i);
    if (mF) p.followers = mF[1];
    for (const el of spmQA('span, div')) {
      const t = (el.innerText || '').trim();
      if (/(followers|people follow)/i.test(t) && /\d/.test(t) && !p.followers)
        p.followers = t.match(/[\d,]+/)?.[0];
    }
    const av = spmQ('img[data-imgperflogname="profileCoverPhoto"]') || spmQ('img[alt*="profile"]');
    if (av?.src && spmValidateUrl(av.src)) p.avatarSrc = av.src;
    return p;
  }

  // ── Facebook: scrape visible comments ────────────────────────
  function fbComments() {
    const results = [];
    const seen    = new Set();
    for (const c of spmQA('[data-testid="UFI2Comment/root"], [role="article"]')) {
      const username = spmQ('a[href*="facebook.com"]', c)?.innerText?.trim() || '?';
      const text     = spmQ('[dir="auto"]', c)?.innerText?.trim() || '';
      const time     = spmQ('abbr, time', c)?.innerText?.trim() || '';
      if (!text) continue;
      const key = username + text.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      if (results.length >= SPM.MAX_COMMENTS) break;
      results.push({ username, text, time, likes: null });
    }
    return results;
  }

  // ── Bulk profile media (for profile grid pages) ───────────────
  function profileGridMedia() {
    const u = new Set();
    spmQA('article img, main img, [role="main"] img')
      .forEach(img => { if ((img.naturalWidth || img.width) > 150) u.add(img.src); });
    spmQA('video[poster]')
      .forEach(v => { if (v.poster) u.add(v.poster); });
    return [...u].filter(spmValidateUrl).slice(0, 100);
  }

  // ── Public interface ──────────────────────────────────────────
  return {
    stats:           () => SPM.IS_FB ? fbStats()    : igStats(),
    profile:         () => SPM.IS_FB ? fbProfile()  : igProfile(),
    comments:        () => SPM.IS_FB ? fbComments() : igComments(),
    profileGridMedia,
  };

})();
