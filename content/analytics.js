/* ============================================================
   analytics.js — Engagement, growth rate, viral score
   v10 — fixes: chart divide-by-zero guards,
         viral score when followers=null,
         consistent NaN prevention
   ============================================================ */

'use strict';

const SpmAnalytics = (() => {

  // ── Safe math helpers ─────────────────────────────────────────
  const _i  = (v, fb = 0)  => (Number.isFinite(v) ? Math.round(v)       : fb);
  const _in = (v)           => (Number.isFinite(v) ? Math.round(v)       : null);
  const _r2 = (v)           => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const _pct = (v)          => (Number.isFinite(v) ? (v * 100).toFixed(2) + '%' : '—');

  // ── Engagement tiers ─────────────────────────────────────────
  const TIERS = [
    { min: 0.06,  label: 'Viral',    tier: 'viral'   },
    { min: 0.03,  label: 'High',     tier: 'high'    },
    { min: 0.01,  label: 'Average',  tier: 'average' },
    { min: 0,     label: 'Low',      tier: 'low'     },
  ];

  // ── Compute engagement rate ───────────────────────────────────
  function computeEngagement(likes, comments, followers, shares) {
    const l = _i(likes);
    const c = _i(comments);
    const s = _i(shares);
    const f = _i(followers);
    const interactions = l + c + s;

    // FIX: v9 returned NaN when followers=0; now falls back to 'unknown'
    if (f <= 0) {
      return {
        rate: null,
        ratePercent: '—',
        tier: 'unknown',
        label: 'Unknown (no follower data)',
        interactions,
        breakdown: { likes: l, comments: c, shares: s },
      };
    }

    const rate = interactions / f;
    if (!Number.isFinite(rate)) {
      return { rate: null, ratePercent: '—', tier: 'unknown', label: 'Unknown', interactions, breakdown: { likes: l, comments: c, shares: s } };
    }

    const tierObj = TIERS.find(t => rate >= t.min) || TIERS[TIERS.length - 1];
    return {
      rate:        _r2(rate),
      ratePercent: _pct(rate),
      tier:        tierObj.tier,
      label:       tierObj.label,
      interactions,
      breakdown:   { likes: l, comments: c, shares: s },
    };
  }

  // ── Compute growth rate ───────────────────────────────────────
  // FIX v10: added guard for single-point history (was dividing by 0)
  function computeGrowthRate(history) {
    if (!Array.isArray(history) || history.length < 2) {
      return { events: history || [], avgLikesPerHour: null, peakLikesPerHour: null, trend: 'insufficient_data' };
    }

    const events = history
      .filter(h => h.ts && h.likes != null)
      .sort((a, b) => a.ts - b.ts);

    if (events.length < 2) {
      return { events, avgLikesPerHour: null, peakLikesPerHour: null, trend: 'insufficient_data' };
    }

    const rates = [];
    for (let i = 1; i < events.length; i++) {
      const dtHours = (events[i].ts - events[i - 1].ts) / 3_600_000;
      if (dtHours <= 0) continue; // FIX: skip zero-duration intervals
      const dLikes = Math.max(0, events[i].likes - events[i - 1].likes);
      rates.push(dLikes / dtHours);
    }

    if (!rates.length) {
      return { events, avgLikesPerHour: null, peakLikesPerHour: null, trend: 'insufficient_data' };
    }

    const avg  = rates.reduce((a, b) => a + b, 0) / rates.length;
    const peak = Math.max(...rates);

    // Trend: compare first half vs second half of rates
    let trend = 'stable';
    if (rates.length >= 4) {
      const half = Math.floor(rates.length / 2);
      const firstAvg  = rates.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const secondAvg = rates.slice(half).reduce((a, b) => a + b, 0) / (rates.length - half);
      if (!Number.isFinite(firstAvg) || !Number.isFinite(secondAvg)) {
        trend = 'insufficient_data';
      } else if (secondAvg > firstAvg * 1.2) {
        trend = 'accelerating';
      } else if (secondAvg < firstAvg * 0.8) {
        trend = 'decelerating';
      }
    }

    return {
      events,
      avgLikesPerHour:  _r2(avg),
      peakLikesPerHour: _r2(peak),
      trend,
    };
  }

  // ── Viral detection score (0–100) ─────────────────────────────
  // FIX v10: when followers=null, engagement component (35pts)
  // was silently returning 0, skewing the score. Now we scale
  // the other signals proportionally when follower data is missing.
  function detectViral(postData, history, profileData) {
    if (!postData) return _emptyViral();

    const likes    = _i(postData.likes);
    const comments = _i(postData.comments);
    const followers = _i(postData.followers || profileData?.followers, 0);
    const hasFollowers = followers > 0;

    let score = 0;
    const signals = [];

    // Signal 1: Engagement rate (35 pts if followers known, else skip and scale others)
    if (hasFollowers) {
      const engage = computeEngagement(likes, comments, followers, postData.shares);
      const rate   = engage.rate ?? 0;
      const ePts   = rate >= 0.10 ? 35 : rate >= 0.06 ? 28 : rate >= 0.03 ? 18 : rate >= 0.01 ? 8 : 0;
      score += ePts;
      if (ePts > 0) signals.push(`Engagement ${engage.ratePercent} (${ePts}pts)`);
    }

    // Signal 2: Absolute likes (25 pts, or 35 if no followers for scale compensation)
    const likeMax  = hasFollowers ? 25 : 35;
    const likePts  = likes >= 1_000_000 ? likeMax : likes >= 100_000 ? Math.round(likeMax * 0.8) :
                     likes >= 10_000    ? Math.round(likeMax * 0.5)  : likes >= 1_000 ? Math.round(likeMax * 0.2) : 0;
    score += likePts;
    if (likePts > 0) signals.push(`${spmFmt(likes)} likes (${likePts}pts)`);

    // Signal 3: Growth velocity (30 pts)
    const growth = computeGrowthRate(history);
    const gph    = growth.avgLikesPerHour ?? 0;
    const gPts   = gph >= 10_000 ? 30 : gph >= 1_000 ? 22 : gph >= 100 ? 12 : gph >= 10 ? 5 : 0;
    score += gPts;
    if (gPts > 0) signals.push(`${spmFmt(gph)}/hr growth (${gPts}pts)`);

    // Signal 4: Comment ratio (10 pts)
    const ratio  = likes > 0 ? comments / likes : 0;
    const rPts   = ratio >= 0.1 ? 10 : ratio >= 0.05 ? 6 : ratio >= 0.02 ? 3 : 0;
    score += rPts;
    if (rPts > 0) signals.push(`Comment ratio ${(ratio * 100).toFixed(1)}% (${rPts}pts)`);

    // Cap at 100
    score = Math.min(100, score);

    const label = score >= 80 ? 'Viral 🔥' : score >= 60 ? 'Trending ⬆' : score >= 40 ? 'Growing' : score >= 20 ? 'Normal' : 'Low';

    return {
      score,
      isViral: score >= 60,
      label,
      signals,
      engage: hasFollowers ? computeEngagement(likes, comments, followers, postData.shares) : null,
    };
  }

  function _emptyViral() {
    return { score: 0, isViral: false, label: 'Unknown', signals: [], engage: null };
  }

  // ── Empty report (never throws) ───────────────────────────────
  function _emptyReport() {
    return {
      meta:       { generatedAt: Date.now(), version: SPM.VERSION },
      post:       null,
      stats:      { likes: null, comments: null, shares: null, reach: null, reachIsNA: true },
      engagement: { rate: null, ratePercent: '—', tier: 'unknown', label: 'No data', interactions: 0, breakdown: {} },
      growth:     { events: [], avgLikesPerHour: null, peakLikesPerHour: null, trend: 'insufficient_data' },
      viral:      _emptyViral(),
      hashtags:   [],
      mentions:   [],
      history:    [],
    };
  }

  // ── Full report ───────────────────────────────────────────────
  function buildReport(postData, history, profileData, commentList) {
    // FIX v9 already fixed "buildReport(null) crashing UI" — keeping safe guard
    if (!postData) return _emptyReport();

    const followers = postData.followers || profileData?.followers || null;

    try {
      const engagement = computeEngagement(
        postData.likes, postData.comments, followers, postData.shares
      );
      const growth = computeGrowthRate(history || []);
      const viral  = detectViral(postData, history || [], profileData);

      return {
        meta: { generatedAt: Date.now(), version: SPM.VERSION, source: postData.source },
        post: {
          postId:   postData.postId,
          username: postData.username,
          url:      postData.url,
          ts:       postData.ts,
          isVideo:  postData.isVideo,
          platform: postData.platform,
        },
        stats: {
          likes:     postData.likes,
          comments:  postData.comments,
          shares:    postData.shares,
          reach:     postData.reach,
          followers,
          reachIsNA: !postData.isVideo,
        },
        engagement,
        growth,
        viral,
        hashtags: postData.hashtags || [],
        mentions: postData.mentions || [],
        history:  history || [],
        comments: commentList || [],
      };
    } catch (err) {
      spmErr('buildReport error:', err);
      return _emptyReport();
    }
  }

  return { computeEngagement, computeGrowthRate, detectViral, buildReport };
})();
