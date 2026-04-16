/**
 * SPM Pro v8 · content/analytics.js
 * ─────────────────────────────────────────────────────────────
 * Pure analytics engine — no DOM, no side-effects.
 *
 * BUG FIXES:
 *  #5  Every function guards against null/undefined inputs
 *  #7  No NaN in any output — Math.round/parseFloat only after
 *      explicit null checks; defaults to 0 or null cleanly
 *  #9  Error boundaries in all public functions
 */
'use strict';

const SpmAnalytics = (() => {

  const VIRAL = {
    ENGAGE_HIGH:  5.0,
    ENGAGE_VIRAL: 10.0,
    GROWTH_VIRAL: 200,
    MIN_LIKES:    1000,
  };

  // ── Safe number helper ────────────────────────────────────
  // FIX #5: ensures no NaN ever leaks into analytics output
  function _num(v, fallback = 0) {
    const n = normalizeNumber(v);
    return (n == null || isNaN(n)) ? fallback : n;
  }
  function _pct(v) {
    if (v == null || isNaN(v)) return null;
    return parseFloat(v.toFixed(4));
  }
  function _fmt2(v) {
    if (v == null || isNaN(v)) return null;
    return parseFloat(v.toFixed(2));
  }

  // ════════════════════════════════════════════════════════
  //  computeEngagement
  //  FIX #7: returns null rate (not NaN) when no followers
  // ════════════════════════════════════════════════════════
  function computeEngagement(likes, comments, followers, shares) {
    try {
      const l = _num(likes);
      const c = _num(comments);
      const s = _num(shares);
      const f = _num(followers, -1);
      const interactions = l + c + s;

      if (f <= 0) {
        return {
          rate:        null,
          ratePercent: '—',
          tier:        'unknown',
          label:       'No follower data',
          interactions,
          breakdown:   { likes: l, comments: c, shares: s },
        };
      }

      const rate = (interactions / f) * 100;
      // FIX #7: guard against NaN from division
      if (!isFinite(rate)) {
        return { rate:null, ratePercent:'—', tier:'unknown', label:'Calculation error', interactions, breakdown:{likes:l,comments:c,shares:s} };
      }

      const tier  = rate >= VIRAL.ENGAGE_VIRAL ? 'viral'
                  : rate >= VIRAL.ENGAGE_HIGH  ? 'high'
                  : rate >= 2.0               ? 'average'
                  :                             'low';

      return {
        rate:        _pct(rate),
        ratePercent: rate.toFixed(2) + '%',
        tier,
        label:       { viral:'🔥 Viral', high:'📈 High', average:'✅ Average', low:'📉 Low' }[tier] ?? tier,
        interactions,
        breakdown:   { likes: l, comments: c, shares: s },
      };
    } catch (e) {
      spmLog.error('[Analytics] computeEngagement:', e.message);
      return { rate:null, ratePercent:'—', tier:'unknown', label:'Error', interactions:0, breakdown:{likes:0,comments:0,shares:0} };
    }
  }

  // ════════════════════════════════════════════════════════
  //  computeGrowthRate
  //  FIX #5 #7: guards empty/invalid history
  // ════════════════════════════════════════════════════════
  function computeGrowthRate(history) {
    const empty = { events:[], avgLikesPerHour:0, avgCommentsPerHour:0, peakLikesPerHour:0, peakCommentsPerHour:0, trend:'insufficient_data' };
    try {
      if (!Array.isArray(history) || history.length < 2) return empty;

      const sorted = history
        .filter(h => h && h.ts != null && !isNaN(h.ts))
        .sort((a, b) => a.ts - b.ts);

      if (sorted.length < 2) return empty;

      const events = [];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i-1], curr = sorted[i];
        const dtH  = (curr.ts - prev.ts) / 3_600_000;
        if (dtH <= 0) continue;

        const pL = _num(prev.likes), cL = _num(curr.likes);
        const pC = _num(prev.comments), cC = _num(curr.comments);
        const ld  = cL - pL, cd = cC - pC;

        events.push({
          fromTs:          prev.ts,
          toTs:            curr.ts,
          dtHours:         _fmt2(dtH),
          likeDelta:       ld,
          commentDelta:    cd,
          likesPerHour:    _fmt2(ld / dtH),
          commentsPerHour: _fmt2(cd / dtH),
          likeGrowthPct:   pL > 0 ? _fmt2(ld / pL * 100) : null,
          commentGrowthPct:pC > 0 ? _fmt2(cd / pC * 100) : null,
        });
      }

      if (!events.length) return { ...empty, trend:'flat' };

      const avgL = events.reduce((s,e) => s + (e.likesPerHour ?? 0), 0) / events.length;
      const avgC = events.reduce((s,e) => s + (e.commentsPerHour ?? 0), 0) / events.length;
      const pkL  = Math.max(0, ...events.map(e => e.likesPerHour ?? 0));
      const pkC  = Math.max(0, ...events.map(e => e.commentsPerHour ?? 0));

      const mid  = Math.floor(events.length / 2);
      const fA   = mid ? events.slice(0,mid).reduce((s,e)=>s+(e.likesPerHour??0),0)/mid : 0;
      const sA   = (events.length-mid) ? events.slice(mid).reduce((s,e)=>s+(e.likesPerHour??0),0)/(events.length-mid) : 0;
      const trend= sA > fA*1.1 ? 'accelerating' : sA < fA*0.9 ? 'decelerating' : 'stable';

      return {
        events,
        avgLikesPerHour:    _fmt2(avgL),
        avgCommentsPerHour: _fmt2(avgC),
        peakLikesPerHour:   _fmt2(pkL),
        peakCommentsPerHour:_fmt2(pkC),
        trend,
        dataPoints: sorted.length,
      };
    } catch (e) {
      spmLog.error('[Analytics] computeGrowthRate:', e.message);
      return empty;
    }
  }

  // ════════════════════════════════════════════════════════
  //  detectViral
  //  FIX #7: score always 0–100 integer, never NaN
  // ════════════════════════════════════════════════════════
  function detectViral(postData, history, profileData) {
    try {
      const likes    = _num(postData?.likes);
      const comments = _num(postData?.comments);
      const followers= _num(profileData?.followers ?? postData?.followers, -1);
      const signals  = [];
      let   score    = 0;

      const engage = computeEngagement(likes, comments, followers > 0 ? followers : null);
      if (engage.rate != null && isFinite(engage.rate)) {
        const pts = Math.min(35, (engage.rate / VIRAL.ENGAGE_VIRAL) * 35);
        if (pts > 0) {
          score += pts;
          signals.push({ key:'engagement', label:`${engage.tier==='viral'?'🔥':'📈'} ${engage.ratePercent} engagement`, weight:_fmt2(pts) });
        }
      }

      if (likes >= VIRAL.MIN_LIKES) {
        const pts = Math.min(25, Math.log10(likes / VIRAL.MIN_LIKES + 1) * 25);
        score += pts;
        signals.push({ key:'likes', label:`❤️ ${spmFmt(likes)} likes`, weight:_fmt2(pts) });
      }

      if (Array.isArray(history) && history.length >= 2) {
        const growth = computeGrowthRate(history);
        if (growth.peakLikesPerHour > 0) {
          const pts = Math.min(30, (growth.peakLikesPerHour / VIRAL.GROWTH_VIRAL) * 30);
          score += pts;
          signals.push({ key:'velocity', label:`⚡ ${growth.peakLikesPerHour}/hr peak`, weight:_fmt2(pts) });
        }
        if (growth.trend === 'accelerating') { score += 5; signals.push({ key:'trend', label:'📈 Accelerating', weight:5 }); }
      }

      if (likes > 0 && comments > 0) {
        const ratio = comments / likes;
        if (isFinite(ratio) && ratio >= 0.05) {
          const pts = Math.min(10, ratio * 100);
          score += pts;
          signals.push({ key:'discussion', label:`💬 ${(ratio*100).toFixed(1)}% comment ratio`, weight:_fmt2(pts) });
        }
      }

      // FIX #7: ensure score is always a clean integer 0-100
      const finalScore = Math.min(100, Math.max(0, Math.round(score)));
      const isViral    = finalScore >= 60;
      const label      = finalScore >= 80 ? '🔥 Going Viral'
                       : finalScore >= 60 ? '🚀 Viral Potential'
                       : finalScore >= 40 ? '✅ Good'
                       : finalScore >= 20 ? '📊 Average'
                       :                   '📉 Low';

      return { score:finalScore, isViral, label, signals, engage };
    } catch (e) {
      spmLog.error('[Analytics] detectViral:', e.message);
      return { score:0, isViral:false, label:'Error', signals:[], engage:{ rate:null, ratePercent:'—', tier:'unknown', label:'Error', interactions:0, breakdown:{likes:0,comments:0,shares:0} } };
    }
  }

  // ── Hashtag / mention analytics ──────────────────────────
  function analyzeHashtags(postData, commentList = []) {
    try {
      const allText = [(postData?.caption ?? ''), ...(commentList ?? []).map(c => c?.text ?? '')].join(' ');
      const freq    = new Map();
      extractHashtags(allText).forEach(t => freq.set(t, (freq.get(t) ?? 0) + 1));
      const sorted  = [...freq.entries()].sort((a,b)=>b[1]-a[1]).map(([tag,count])=>({tag,count}));
      return { unique:sorted.length, topTags:sorted.slice(0,10), all:sorted, caption:postData?.hashtags ?? [] };
    } catch (e) { spmLog.error('[Analytics] analyzeHashtags:', e.message); return { unique:0, topTags:[], all:[], caption:[] }; }
  }

  function analyzeMentions(postData, commentList = []) {
    try {
      const allText = [(postData?.caption ?? ''), ...(commentList ?? []).map(c => c?.text ?? '')].join(' ');
      const freq    = new Map();
      extractMentions(allText).forEach(m => freq.set(m, (freq.get(m) ?? 0) + 1));
      const sorted  = [...freq.entries()].sort((a,b)=>b[1]-a[1]).map(([mention,count])=>({mention,count}));
      return { unique:sorted.length, top:sorted.slice(0,10), all:sorted };
    } catch (e) { spmLog.error('[Analytics] analyzeMentions:', e.message); return { unique:0, top:[], all:[] }; }
  }

  // ════════════════════════════════════════════════════════
  //  buildReport — FIX #7: null-safe, never throws
  //  FIX #10: called with validated postData
  // ════════════════════════════════════════════════════════
  function buildReport(postData, history, profileData, commentList) {
    // FIX #7: if postData is null/invalid, return a safe empty report
    if (!postData || typeof postData !== 'object') {
      spmLog.warn('[Analytics] buildReport called with null/invalid postData');
      return _emptyReport();
    }

    try {
      const safeHistory     = Array.isArray(history)     ? history     : [];
      const safeProfile     = profileData && typeof profileData === 'object' ? profileData : {};
      const safeComments    = Array.isArray(commentList) ? commentList : [];

      const engage   = computeEngagement(postData.likes, postData.comments, safeProfile.followers ?? postData.followers, postData.shares);
      const growth   = computeGrowthRate(safeHistory);
      const viral    = detectViral(postData, safeHistory, safeProfile);
      const hashtags = analyzeHashtags(postData, safeComments);
      const mentions = analyzeMentions(postData, safeComments);

      return {
        meta: {
          generatedAt:      Date.now(),
          postId:           postData.postId      ?? '',
          url:              postData.url          ?? location.href,
          platform:         postData.platform     ?? SPM.PLATFORM,
          dataSource:       postData.source       ?? 'unknown',
        },
        post: {
          username:         postData.username     ?? '',
          caption:          postData.caption      ?? '',
          isVideo:          postData.isVideo      ?? false,
          mediaUrl:         postData.mediaUrl     ?? '',
          postedAt:         postData.ts           ?? null,
        },
        stats: {
          likes:            postData.likes        ?? null,
          comments:         postData.comments     ?? null,
          shares:           postData.shares       ?? null,
          reach:            postData.reach        ?? null,
          followers:        safeProfile.followers ?? postData.followers ?? null,
        },
        engagement: engage,
        growth,
        viral,
        hashtags,
        mentions,
        history:  safeHistory.slice(-50),
      };
    } catch (e) {
      spmLog.error('[Analytics] buildReport:', e.message);
      return _emptyReport();
    }
  }

  function _emptyReport() {
    const emptyEngage = { rate:null, ratePercent:'—', tier:'unknown', label:'No data', interactions:0, breakdown:{likes:0,comments:0,shares:0} };
    const emptyViral  = { score:0, isViral:false, label:'No data', signals:[], engage:emptyEngage };
    return {
      meta:       { generatedAt:Date.now(), postId:'', url:location.href, platform:SPM.PLATFORM, dataSource:'unknown' },
      post:       { username:'', caption:'', isVideo:false, mediaUrl:'', postedAt:null },
      stats:      { likes:null, comments:null, shares:null, reach:null, followers:null },
      engagement: emptyEngage,
      growth:     { events:[], avgLikesPerHour:0, avgCommentsPerHour:0, peakLikesPerHour:0, peakCommentsPerHour:0, trend:'insufficient_data' },
      viral:      emptyViral,
      hashtags:   { unique:0, topTags:[], all:[], caption:[] },
      mentions:   { unique:0, top:[], all:[] },
      history:    [],
    };
  }

  function historyToCsv(history) {
    try {
      if (!Array.isArray(history) || !history.length) return '';
      const headers = ['Time','Platform','URL','PostID','Likes','Comments','Shares','Reach','Followers','EngageRate','ViralScore','Source'];
      const rows    = history.map(h => [
        h.ts ? new Date(h.ts).toLocaleString() : '',
        h.platform ?? '', h.url ?? '', h.postId ?? '',
        h.likes ?? '', h.comments ?? '', h.shares ?? '', h.reach ?? '',
        h.followers ?? '', h.engageRate ?? '', h.viralScore ?? '', h.source ?? '',
      ]);
      return [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    } catch (e) { spmLog.error('[Analytics] historyToCsv:', e.message); return ''; }
  }

  return {
    computeEngagement,
    computeGrowthRate,
    detectViral,
    analyzeHashtags,
    analyzeMentions,
    buildReport,
    historyToCsv,
  };

})();
