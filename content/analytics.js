/**
 * SPM Pro v5 · content/analytics.js
 *
 * Analytics engine — stateless computation layer.
 * Consumes normalised PostData + history arrays.
 * Produces structured reports consumed by the UI and exported to CSV/JSON.
 *
 * Computes (spec §6):
 *  • Engagement Rate
 *  • Growth Rate  (likes, comments — per time window)
 *  • Viral Detection Score
 *  • Trend direction
 *  • Hashtag / mention frequency
 *  • Best posting time inference
 *  • Post performance tier (high / average / low)
 *
 * All functions are PURE — no side-effects, no DOM access.
 * Returns plain objects safe to JSON.stringify.
 */
'use strict';

const SpmAnalytics = (() => {

  // ════════════════════════════════════════════════════════
  //  CONSTANTS
  // ════════════════════════════════════════════════════════

  // Viral thresholds — tunable per niche
  const VIRAL = {
    ENGAGE_HIGH:  5.0,   // % — above this = high engagement
    ENGAGE_VIRAL: 10.0,  // % — above this = viral territory
    GROWTH_FAST:  50,    // % growth per hour = fast
    GROWTH_VIRAL: 200,   // % growth per hour = viral
    MIN_LIKES_FOR_VIRAL: 1000,
  };

  const TIER_THRESHOLDS = {
    high:    0.05,  // top 5 % engagement
    average: 0.02,  // 2 – 5 %
    // below 2 % = low
  };

  // ════════════════════════════════════════════════════════
  //  §6.1 — ENGAGEMENT RATE
  //
  //  Standard formula: (likes + comments) / followers × 100
  //  Returns { rate, ratePercent, tier, label }
  // ════════════════════════════════════════════════════════
  function computeEngagement(likes, comments, followers, shares = 0) {
    const l = normalizeNumber(likes)    ?? 0;
    const c = normalizeNumber(comments) ?? 0;
    const s = normalizeNumber(shares)   ?? 0;
    const f = normalizeNumber(followers);

    if (!f || f <= 0) {
      return { rate: null, ratePercent: '—', tier: 'unknown', label: 'No follower data', interactions: l + c + s };
    }

    const interactions = l + c + s;
    const rate         = (interactions / f) * 100;
    const tier         = rate >= VIRAL.ENGAGE_VIRAL ? 'viral'
                       : rate >= VIRAL.ENGAGE_HIGH  ? 'high'
                       : rate >= 2.0               ? 'average'
                       : 'low';

    const tierLabels = { viral:'🔥 Viral', high:'📈 High', average:'✅ Average', low:'📉 Low' };

    return {
      rate:        parseFloat(rate.toFixed(4)),
      ratePercent: rate.toFixed(2) + '%',
      tier,
      label:       tierLabels[tier] ?? tier,
      interactions,
      breakdown:   { likes: l, comments: c, shares: s },
    };
  }

  // ════════════════════════════════════════════════════════
  //  §6.2 — GROWTH RATE
  //
  //  Computes velocity between consecutive history snapshots.
  //  Returns array of growth events + summary stats.
  //
  //  growthHistory: [{ ts, likes, comments }]  (sorted oldest→newest)
  // ════════════════════════════════════════════════════════
  function computeGrowthRate(history) {
    if (!Array.isArray(history) || history.length < 2) {
      return { events: [], avgLikesPerHour: 0, avgCommentsPerHour: 0, peakLikesPerHour: 0, peakCommentsPerHour: 0, trend: 'insufficient_data' };
    }

    // Sort by timestamp ascending
    const sorted  = [...history].filter(h => h.ts != null).sort((a, b) => a.ts - b.ts);
    if (sorted.length < 2) return { events: [], avgLikesPerHour: 0, avgCommentsPerHour: 0, peakLikesPerHour: 0, peakCommentsPerHour: 0, trend: 'insufficient_data' };

    const events = [];

    for (let i = 1; i < sorted.length; i++) {
      const prev    = sorted[i - 1];
      const curr    = sorted[i];
      const dtMs    = curr.ts - prev.ts;
      const dtHours = dtMs / 3_600_000;
      if (dtHours <= 0) continue;

      const prevLikes    = normalizeNumber(prev.likes)    ?? 0;
      const currLikes    = normalizeNumber(curr.likes)    ?? 0;
      const prevComments = normalizeNumber(prev.comments) ?? 0;
      const currComments = normalizeNumber(curr.comments) ?? 0;

      const likeDelta    = currLikes    - prevLikes;
      const commentDelta = currComments - prevComments;
      const likeRate     = likeDelta    / dtHours;
      const commentRate  = commentDelta / dtHours;

      // Percentage growth (avoid div/0)
      const likeGrowthPct    = prevLikes    > 0 ? (likeDelta    / prevLikes    * 100) : null;
      const commentGrowthPct = prevComments > 0 ? (commentDelta / prevComments * 100) : null;

      events.push({
        fromTs:          prev.ts,
        toTs:            curr.ts,
        dtHours:         parseFloat(dtHours.toFixed(3)),
        likeDelta,
        commentDelta,
        likesPerHour:    parseFloat(likeRate.toFixed(2)),
        commentsPerHour: parseFloat(commentRate.toFixed(2)),
        likeGrowthPct:   likeGrowthPct   != null ? parseFloat(likeGrowthPct.toFixed(2))    : null,
        commentGrowthPct:commentGrowthPct!= null ? parseFloat(commentGrowthPct.toFixed(2)) : null,
      });
    }

    if (!events.length) return { events: [], avgLikesPerHour:0, avgCommentsPerHour:0, peakLikesPerHour:0, peakCommentsPerHour:0, trend:'flat' };

    const avgLikes    = events.reduce((s, e) => s + e.likesPerHour,    0) / events.length;
    const avgComments = events.reduce((s, e) => s + e.commentsPerHour, 0) / events.length;
    const peakLikes   = Math.max(...events.map(e => e.likesPerHour));
    const peakComments= Math.max(...events.map(e => e.commentsPerHour));

    // Trend: compare first-half avg vs second-half avg
    const mid       = Math.floor(events.length / 2);
    const firstHalf = events.slice(0, mid);
    const secondHalf= events.slice(mid);
    const firstAvg  = firstHalf.length  ? firstHalf.reduce( (s,e) => s+e.likesPerHour,0) / firstHalf.length  : 0;
    const secondAvg = secondHalf.length ? secondHalf.reduce((s,e) => s+e.likesPerHour,0) / secondHalf.length : 0;
    const trend = secondAvg > firstAvg * 1.1 ? 'accelerating'
                : secondAvg < firstAvg * 0.9 ? 'decelerating'
                : 'stable';

    return {
      events,
      avgLikesPerHour:    parseFloat(avgLikes.toFixed(2)),
      avgCommentsPerHour: parseFloat(avgComments.toFixed(2)),
      peakLikesPerHour:   parseFloat(peakLikes.toFixed(2)),
      peakCommentsPerHour:parseFloat(peakComments.toFixed(2)),
      trend,
      dataPoints: sorted.length,
    };
  }

  // ════════════════════════════════════════════════════════
  //  §6.3 — VIRAL DETECTION
  //
  //  Composite score (0–100) combining:
  //   • Absolute like count
  //   • Engagement rate
  //   • Like velocity (likes/hour)
  //   • Comment-to-like ratio (signals discussion)
  //
  //  Returns { score, isViral, label, signals }
  // ════════════════════════════════════════════════════════
  function detectViral(postData, history, profileData) {
    const likes     = normalizeNumber(postData?.likes)    ?? 0;
    const comments  = normalizeNumber(postData?.comments) ?? 0;
    const followers = normalizeNumber(profileData?.followers ?? postData?.followers);
    const signals   = [];
    let score = 0;

    // Signal 1: engagement rate (0–35 pts)
    const engage = computeEngagement(likes, comments, followers);
    if (engage.rate != null) {
      const engagePts = Math.min(35, (engage.rate / VIRAL.ENGAGE_VIRAL) * 35);
      score += engagePts;
      if (engage.tier === 'viral')   signals.push({ key:'engagement', label:'🔥 Viral engagement rate ('    + engage.ratePercent + ')', weight: engagePts });
      else if (engage.tier === 'high') signals.push({ key:'engagement', label:'📈 High engagement rate ('   + engage.ratePercent + ')', weight: engagePts });
    }

    // Signal 2: absolute likes (0–25 pts)
    if (likes >= VIRAL.MIN_LIKES_FOR_VIRAL) {
      const likesPts = Math.min(25, Math.log10(likes / VIRAL.MIN_LIKES_FOR_VIRAL + 1) * 25);
      score += likesPts;
      signals.push({ key:'likes_volume', label:`❤️ ${spmFmt(likes)} likes`, weight: parseFloat(likesPts.toFixed(1)) });
    }

    // Signal 3: growth velocity (0–30 pts) — requires history
    if (history && history.length >= 2) {
      const growth = computeGrowthRate(history);
      if (growth.peakLikesPerHour > 0) {
        const velPts = Math.min(30, (growth.peakLikesPerHour / VIRAL.GROWTH_VIRAL) * 30);
        score += velPts;
        signals.push({ key:'velocity', label:`⚡ ${growth.peakLikesPerHour.toFixed(0)} likes/hr peak`, weight: parseFloat(velPts.toFixed(1)) });
      }
      if (growth.trend === 'accelerating') {
        score += 5;
        signals.push({ key:'trend', label:'📈 Accelerating growth trend', weight: 5 });
      }
    }

    // Signal 4: comment-to-like ratio (0–10 pts)
    // High ratio (>5 %) = discussion-driven = stronger virality signal
    if (likes > 0 && comments > 0) {
      const ratio = comments / likes;
      if (ratio >= 0.05) {
        const ratioPts = Math.min(10, ratio * 100);
        score += ratioPts;
        signals.push({ key:'discussion', label:`💬 ${(ratio * 100).toFixed(1)}% comment ratio`, weight: parseFloat(ratioPts.toFixed(1)) });
      }
    }

    const finalScore = Math.min(100, Math.round(score));
    const isViral = finalScore >= 60;
    const label   = finalScore >= 80 ? '🔥 Going Viral'
                  : finalScore >= 60 ? '📈 Viral Potential'
                  : finalScore >= 40 ? '✅ Good Performance'
                  : finalScore >= 20 ? '📊 Average'
                  :                    '📉 Low Engagement';

    return { score: finalScore, isViral, label, signals, engage };
  }

  // ════════════════════════════════════════════════════════
  //  HASHTAG ANALYTICS
  //
  //  Frequency map + reach estimate from caption + comments
  // ════════════════════════════════════════════════════════
  function analyzeHashtags(postData, commentList = []) {
    const allText = [
      postData?.caption ?? '',
      ...commentList.map(c => c.text ?? ''),
    ].join(' ');

    const allTags = extractHashtags(allText);
    const freq    = new Map();
    allTags.forEach(tag => freq.set(tag, (freq.get(tag) ?? 0) + 1));

    const sorted = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));

    return {
      unique:    sorted.length,
      topTags:   sorted.slice(0, 10),
      all:       sorted,
      caption:   postData?.hashtags ?? [],
    };
  }

  // ════════════════════════════════════════════════════════
  //  MENTION ANALYTICS
  // ════════════════════════════════════════════════════════
  function analyzeMentions(postData, commentList = []) {
    const allText = [postData?.caption ?? '', ...commentList.map(c => c.text ?? '')].join(' ');
    const all     = extractMentions(allText);
    const freq    = new Map();
    all.forEach(m => freq.set(m, (freq.get(m) ?? 0) + 1));
    const sorted  = [...freq.entries()].sort((a,b)=>b[1]-a[1]).map(([mention,count])=>({mention,count}));
    return { unique: sorted.length, top: sorted.slice(0, 10), all: sorted };
  }

  // ════════════════════════════════════════════════════════
  //  BEST POSTING TIME
  //
  //  From history, find which hour-of-day had highest
  //  avg likes/hour growth.
  // ════════════════════════════════════════════════════════
  function bestPostingTime(history) {
    if (!history || history.length < 5) return { available: false, reason: 'Need at least 5 data points' };

    // Group growth events by hour-of-day
    const growth  = computeGrowthRate(history);
    if (!growth.events.length) return { available: false, reason: 'No growth data' };

    const byHour  = new Array(24).fill(null).map(() => ({ total: 0, count: 0 }));
    growth.events.forEach(ev => {
      const hour = new Date(ev.fromTs).getHours();
      byHour[hour].total += ev.likesPerHour;
      byHour[hour].count += 1;
    });

    const hourlyAvg = byHour.map((h, i) => ({
      hour:   i,
      label:  i.toString().padStart(2,'0') + ':00',
      avgLikesPerHour: h.count ? parseFloat((h.total / h.count).toFixed(2)) : 0,
    })).filter(h => h.avgLikesPerHour > 0).sort((a,b) => b.avgLikesPerHour - a.avgLikesPerHour);

    if (!hourlyAvg.length) return { available: false, reason: 'Insufficient spread' };

    return {
      available:   true,
      bestHour:    hourlyAvg[0].hour,
      bestLabel:   hourlyAvg[0].label,
      ranking:     hourlyAvg.slice(0, 5),
    };
  }

  // ════════════════════════════════════════════════════════
  //  FULL REPORT  —  dashboard-ready structured output
  //
  //  Produces a single object ready for JSON export or UI rendering.
  // ════════════════════════════════════════════════════════
  function buildReport(postData, history, profileData, commentList = []) {
    const engage     = computeEngagement(postData?.likes, postData?.comments, profileData?.followers ?? postData?.followers, postData?.shares);
    const growth     = computeGrowthRate(history);
    const viral      = detectViral(postData, history, profileData ?? {});
    const hashtags   = analyzeHashtags(postData, commentList);
    const mentions   = analyzeMentions(postData, commentList);
    const postingTime= bestPostingTime(history);

    return {
      meta: {
        generatedAt:  Date.now(),
        generatedAtHuman: new Date().toLocaleString(),
        postId:       postData?.postId  ?? '',
        url:          postData?.url     ?? location.href,
        platform:     postData?.platform ?? SPM.PLATFORM,
        dataSource:   postData?.source  ?? 'unknown',
      },
      post: {
        username:   postData?.username  ?? '',
        caption:    postData?.caption   ?? '',
        isVideo:    postData?.isVideo   ?? false,
        mediaUrl:   postData?.mediaUrl  ?? '',
        postedAt:   postData?.ts        ?? null,
        postedAtHuman: postData?.ts ? new Date(postData.ts).toLocaleString() : '—',
      },
      stats: {
        likes:      postData?.likes     ?? null,
        comments:   postData?.comments  ?? null,
        shares:     postData?.shares    ?? null,
        reach:      postData?.reach     ?? null,
        followers:  profileData?.followers ?? postData?.followers ?? null,
      },
      engagement: engage,
      growth,
      viral,
      hashtags,
      mentions,
      postingTime,
      history: history.slice(-50),   // last 50 snapshots for dashboard chart
    };
  }

  // ════════════════════════════════════════════════════════
  //  COMPARE TWO POSTS
  //
  //  Side-by-side analytics for competitor tracking.
  // ════════════════════════════════════════════════════════
  function comparePosts(postA, postB, followersA = null, followersB = null) {
    const eA = computeEngagement(postA.likes, postA.comments, followersA ?? postA.followers, postA.shares);
    const eB = computeEngagement(postB.likes, postB.comments, followersB ?? postB.followers, postB.shares);

    const winner = (eA.rate != null && eB.rate != null)
      ? (eA.rate >= eB.rate ? 'A' : 'B')
      : 'unknown';

    return {
      postA: { ...postA, engagement: eA },
      postB: { ...postB, engagement: eB },
      winner,
      delta: {
        likes:       (normalizeNumber(postA.likes)    ?? 0) - (normalizeNumber(postB.likes)    ?? 0),
        comments:    (normalizeNumber(postA.comments) ?? 0) - (normalizeNumber(postB.comments) ?? 0),
        engageRate:  eA.rate != null && eB.rate != null ? parseFloat((eA.rate - eB.rate).toFixed(4)) : null,
      },
    };
  }

  // ════════════════════════════════════════════════════════
  //  EXPORT FORMATTERS
  // ════════════════════════════════════════════════════════

  /** Convert a history array → CSV string */
  function historyToCsv(history) {
    const headers = ['Time','Platform','URL','PostID','Likes','Comments','Shares','Reach','Followers','EngageRate','Source'];
    const rows    = history.map(h => [
      h.ts ? new Date(h.ts).toLocaleString() : '',
      h.platform ?? '',
      h.url      ?? '',
      h.postId   ?? '',
      h.likes    ?? '',
      h.comments ?? '',
      h.shares   ?? '',
      h.reach    ?? '',
      h.followers?? '',
      h.engageRate ?? '',
      h.source   ?? '',
    ]);
    return [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))
      .join('\n');
  }

  // ════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════
  return {
    computeEngagement,    // (likes, comments, followers, shares?) → EngageResult
    computeGrowthRate,    // (history[]) → GrowthResult
    detectViral,          // (postData, history[], profileData) → ViralResult
    analyzeHashtags,      // (postData, comments[]) → HashtagReport
    analyzeMentions,      // (postData, comments[]) → MentionReport
    bestPostingTime,      // (history[]) → TimeReport
    buildReport,          // (postData, history[], profileData, comments[]) → FullReport
    comparePosts,         // (postA, postB, fA?, fB?) → CompareResult
    historyToCsv,         // (history[]) → string
  };

})();
