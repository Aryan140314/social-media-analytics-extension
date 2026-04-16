/**
 * SPM Pro v9 · content/analytics.js
 *
 * Pure computation — no DOM, no storage, no side effects.
 * Every function returns a safe object even on bad input.
 *
 * Requirements addressed:
 *  R4  – Prevents NaN via _safe() helper on every arithmetic result
 *  R4  – Handles missing fields with explicit null checks before division
 *  R4  – Safe defaults for all return types
 *  R7  – try/catch in every public function
 *  R8  – DEBUG logs
 */
'use strict';

const SpmAnalytics = (() => {

  const DEBUG = true;
  const log = {
    info : (...a) => DEBUG && console.info ('[SPM:analytics]', ...a),
    warn : (...a) =>           console.warn ('[SPM:analytics]', ...a),
    error: (...a) =>           console.error('[SPM:analytics]', ...a),
  };

  /* ─── Thresholds ─────────────────────────────────────────── */
  const T = { VIRAL:10, HIGH:5, MIN_LIKES_VIRAL:1_000, GROWTH_VIRAL:200 };

  /* ─── R4 helpers — zero NaN leaks past this point ─────────── */

  /** Normalise to integer or 0 (never NaN) */
  function _i(v, fallback = 0) {
    const n = normalizeNumber(v);
    return n != null && isFinite(n) ? n : fallback;
  }

  /** Normalise to integer or null (used where 0 ≠ null) */
  function _in(v) {
    const n = normalizeNumber(v);
    return n != null && isFinite(n) ? n : null;
  }

  /** Round to 2 dp; return null if not finite */
  function _r2(v) {
    return isFinite(v) ? parseFloat(v.toFixed(2)) : null;
  }

  /** Round to 4 dp; return null if not finite */
  function _r4(v) {
    return isFinite(v) ? parseFloat(v.toFixed(4)) : null;
  }

  /** Safe percentage string */
  function _pctStr(v) {
    return isFinite(v) ? v.toFixed(2) + '%' : '—';
  }

  /* ═══════════════════════════════════════════════════════════
   * computeEngagement(likes, comments, followers, shares?)
   *
   * R4 — returns null rate (not NaN) when followers ≤ 0
   * ═══════════════════════════════════════════════════════════ */
  function computeEngagement(likes, comments, followers, shares) {
    try {
      const l = _i(likes);
      const c = _i(comments);
      const s = _i(shares);
      const f = _in(followers);         // null if missing — R4 guard

      const interactions = l + c + s;

      if (!f || f <= 0) {
        return _engResult(null, interactions, l, c, s);
      }

      const rate = (interactions / f) * 100;

      // R4 — explicit isFinite guard before using rate
      if (!isFinite(rate)) {
        log.warn('computeEngagement: rate is not finite (f=%d, interactions=%d)', f, interactions);
        return _engResult(null, interactions, l, c, s);
      }

      log.info('Engagement — rate:', rate.toFixed(2) + '%', 'interactions:', interactions, 'followers:', f);
      return _engResult(rate, interactions, l, c, s);

    } catch (e) {
      log.error('computeEngagement:', e.message);
      return _engResult(null, 0, 0, 0, 0);
    }
  }

  function _engResult(rate, interactions, l, c, s) {
    const tier  = rate == null ? 'unknown'
                : rate >= T.VIRAL ? 'viral'
                : rate >= T.HIGH  ? 'high'
                : rate >= 2       ? 'average'
                :                   'low';
    return {
      rate:        _r4(rate),
      ratePercent: _pctStr(rate),
      tier,
      label:       { viral:'🔥 Viral', high:'📈 High', average:'✅ Average', low:'📉 Low', unknown:'— No follower data' }[tier],
      interactions,
      breakdown:   { likes:l, comments:c, shares:s },
    };
  }

  /* ═══════════════════════════════════════════════════════════
   * computeGrowthRate(history[])
   *
   * R4 — all division results checked with isFinite before storing
   * ═══════════════════════════════════════════════════════════ */
  function computeGrowthRate(history) {
    const _empty = {
      events:[], avgLikesPerHour:0, avgCommentsPerHour:0,
      peakLikesPerHour:0, peakCommentsPerHour:0, trend:'insufficient_data',
    };
    try {
      if (!Array.isArray(history) || history.length < 2) return _empty;

      const sorted = history
        .filter(h => h && typeof h.ts === 'number' && isFinite(h.ts))
        .sort((a, b) => a.ts - b.ts);

      if (sorted.length < 2) return _empty;

      const events = [];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1], curr = sorted[i];
        const dtH  = (curr.ts - prev.ts) / 3_600_000;
        if (!isFinite(dtH) || dtH <= 0) continue;

        const pL = _i(prev.likes), cL = _i(curr.likes);
        const pC = _i(prev.comments), cC = _i(curr.comments);
        const ld  = cL - pL, cd = cC - pC;

        // R4 — guard before pushing to events
        const lph = ld / dtH, cph = cd / dtH;
        if (!isFinite(lph) || !isFinite(cph)) continue;

        events.push({
          fromTs:          prev.ts,
          toTs:            curr.ts,
          dtHours:         _r2(dtH),
          likeDelta:       ld,
          commentDelta:    cd,
          likesPerHour:    _r2(lph),
          commentsPerHour: _r2(cph),
          likeGrowthPct:   pL > 0 ? _r2(ld / pL * 100) : null,
          commentGrowthPct:pC > 0 ? _r2(cd / pC * 100) : null,
        });
      }

      if (!events.length) return { ..._empty, trend:'flat' };

      const avgL  = events.reduce((s, e) => s + (e.likesPerHour    ?? 0), 0) / events.length;
      const avgC  = events.reduce((s, e) => s + (e.commentsPerHour ?? 0), 0) / events.length;
      const pkL   = Math.max(0, ...events.map(e => e.likesPerHour    ?? 0));
      const pkC   = Math.max(0, ...events.map(e => e.commentsPerHour ?? 0));

      const mid = Math.floor(events.length / 2);
      const fA  = mid ? events.slice(0, mid).reduce((s,e)=>s+(e.likesPerHour??0),0)/mid : 0;
      const sA  = (events.length-mid) ? events.slice(mid).reduce((s,e)=>s+(e.likesPerHour??0),0)/(events.length-mid) : 0;
      const trend = !isFinite(fA)||!isFinite(sA) ? 'stable'
                  : sA > fA * 1.1 ? 'accelerating'
                  : sA < fA * 0.9 ? 'decelerating'
                  :                  'stable';

      log.info('Growth — trend:', trend, 'avgLikes/hr:', _r2(avgL), 'peak:', _r2(pkL));

      return {
        events,
        avgLikesPerHour:    _r2(avgL) ?? 0,
        avgCommentsPerHour: _r2(avgC) ?? 0,
        peakLikesPerHour:   _r2(pkL) ?? 0,
        peakCommentsPerHour:_r2(pkC) ?? 0,
        trend,
        dataPoints: sorted.length,
      };

    } catch (e) {
      log.error('computeGrowthRate:', e.message);
      return _empty;
    }
  }

  /* ═══════════════════════════════════════════════════════════
   * detectViral(postData, history, profileData)
   *
   * R4 — score is always Math.round → integer 0–100, never NaN
   * ═══════════════════════════════════════════════════════════ */
  function detectViral(postData, history, profileData) {
    const _nullResult = {
      score:0, isViral:false, label:'📊 No data',
      signals:[], engage: _engResult(null,0,0,0,0),
    };
    try {
      if (!postData || typeof postData !== 'object') return _nullResult;

      const likes     = _i(postData.likes);
      const comments  = _i(postData.comments);
      const followers = _in(profileData?.followers ?? postData?.followers);
      const signals   = [];
      let   raw       = 0;

      // Signal 1: engagement rate (0–35 pts)
      const engage = computeEngagement(likes, comments, followers);
      if (engage.rate != null && isFinite(engage.rate)) {
        const pts = Math.min(35, (engage.rate / T.VIRAL) * 35);
        if (isFinite(pts) && pts > 0) {
          raw += pts;
          signals.push({ key:'engagement', label:`${engage.tier==='viral'?'🔥':'📈'} ${engage.ratePercent}`, weight:_r2(pts) });
        }
      }

      // Signal 2: absolute like count (0–25 pts)
      if (likes >= T.MIN_LIKES_VIRAL) {
        const pts = Math.min(25, Math.log10(likes / T.MIN_LIKES_VIRAL + 1) * 25);
        if (isFinite(pts) && pts > 0) {
          raw += pts;
          signals.push({ key:'likes', label:`❤️ ${spmFmt(likes)} likes`, weight:_r2(pts) });
        }
      }

      // Signal 3: growth velocity (0–30 pts)
      if (Array.isArray(history) && history.length >= 2) {
        const growth = computeGrowthRate(history);
        if (growth.peakLikesPerHour > 0) {
          const pts = Math.min(30, (growth.peakLikesPerHour / T.GROWTH_VIRAL) * 30);
          if (isFinite(pts) && pts > 0) {
            raw += pts;
            signals.push({ key:'velocity', label:`⚡ ${growth.peakLikesPerHour}/hr`, weight:_r2(pts) });
          }
        }
        if (growth.trend === 'accelerating') {
          raw += 5;
          signals.push({ key:'trend', label:'📈 Accelerating', weight:5 });
        }
      }

      // Signal 4: comment/like ratio (0–10 pts)
      if (likes > 0 && comments > 0) {
        const ratio = comments / likes;
        if (isFinite(ratio) && ratio >= 0.05) {
          const pts = Math.min(10, ratio * 100);
          if (isFinite(pts)) {
            raw += pts;
            signals.push({ key:'discussion', label:`💬 ${(ratio*100).toFixed(1)}% comment ratio`, weight:_r2(pts) });
          }
        }
      }

      // R4 — final score: always a valid integer 0–100
      const score   = Math.min(100, Math.max(0, Math.round(raw)));
      const isViral = score >= 60;
      const label   = score >= 80 ? '🔥 Going Viral'
                    : score >= 60 ? '🚀 Viral Potential'
                    : score >= 40 ? '✅ Good'
                    : score >= 20 ? '📊 Average'
                    :               '📉 Low';

      log.info('Viral — score:', score, 'label:', label, 'signals:', signals.length);
      return { score, isViral, label, signals, engage };

    } catch (e) {
      log.error('detectViral:', e.message);
      return _nullResult;
    }
  }

  /* ─── Hashtag / mention frequency ───────────────────────── */
  function analyzeHashtags(postData, commentList = []) {
    try {
      const text = [(postData?.caption ?? ''), ...(commentList ?? []).map(c => c?.text ?? '')].join(' ');
      const freq  = new Map();
      extractHashtags(text).forEach(t => freq.set(t, (freq.get(t) ?? 0) + 1));
      const sorted = [...freq.entries()].sort((a,b)=>b[1]-a[1]).map(([tag,count])=>({tag,count}));
      return { unique:sorted.length, topTags:sorted.slice(0,10), all:sorted, caption:postData?.hashtags??[] };
    } catch (e) {
      log.error('analyzeHashtags:', e.message);
      return { unique:0, topTags:[], all:[], caption:[] };
    }
  }

  function analyzeMentions(postData, commentList = []) {
    try {
      const text = [(postData?.caption ?? ''), ...(commentList ?? []).map(c => c?.text ?? '')].join(' ');
      const freq  = new Map();
      extractMentions(text).forEach(m => freq.set(m, (freq.get(m) ?? 0) + 1));
      const sorted = [...freq.entries()].sort((a,b)=>b[1]-a[1]).map(([m,count])=>({mention:m,count}));
      return { unique:sorted.length, top:sorted.slice(0,10), all:sorted };
    } catch (e) {
      log.error('analyzeMentions:', e.message);
      return { unique:0, top:[], all:[] };
    }
  }

  /* ═══════════════════════════════════════════════════════════
   * buildReport(postData, history, profileData, commentList)
   *
   * R4 — if postData is null/invalid, returns a fully safe
   *      empty report (no NaN anywhere, no crashes downstream)
   * ═══════════════════════════════════════════════════════════ */
  function buildReport(postData, history, profileData, commentList) {
    // R4 — guard at the top: never process null postData
    if (!postData || typeof postData !== 'object') {
      log.warn('buildReport called with null/invalid postData — returning empty report');
      return _emptyReport();
    }

    try {
      const hist  = Array.isArray(history)     ? history     : [];
      const prof  = profileData && typeof profileData === 'object' ? profileData : {};
      const cmts  = Array.isArray(commentList) ? commentList : [];

      const engagement = computeEngagement(postData.likes, postData.comments, prof.followers ?? postData.followers, postData.shares);
      const growth     = computeGrowthRate(hist);
      const viral      = detectViral(postData, hist, prof);
      const hashtags   = analyzeHashtags(postData, cmts);
      const mentions   = analyzeMentions(postData, cmts);

      log.info('Report built — engage:', engagement.ratePercent, '| viral:', viral.score + '/100');

      return {
        meta: {
          generatedAt:  Date.now(),
          postId:       postData.postId   ?? '',
          url:          postData.url       ?? location.href,
          platform:     postData.platform  ?? SPM.PLATFORM,
          dataSource:   postData.source    ?? 'unknown',
        },
        post: {
          username:     postData.username  ?? '',
          caption:      postData.caption   ?? '',
          isVideo:      postData.isVideo   ?? false,
          mediaUrl:     postData.mediaUrl  ?? '',
          postedAt:     postData.ts        ?? null,
        },
        stats: {
          likes:        postData.likes     ?? null,
          comments:     postData.comments  ?? null,
          shares:       postData.shares    ?? null,
          reach:        postData.reach     ?? null,
          followers:    prof.followers     ?? postData.followers ?? null,
        },
        engagement,
        growth,
        viral,
        hashtags,
        mentions,
        history: hist.slice(-50),
      };

    } catch (e) {
      log.error('buildReport:', e.message);
      return _emptyReport();
    }
  }

  function _emptyReport() {
    const emptyEng  = _engResult(null, 0, 0, 0, 0);
    const emptyViral= { score:0, isViral:false, label:'No data', signals:[], engage:emptyEng };
    return {
      meta:       { generatedAt:Date.now(), postId:'', url:location.href, platform:SPM.PLATFORM, dataSource:'unknown' },
      post:       { username:'', caption:'', isVideo:false, mediaUrl:'', postedAt:null },
      stats:      { likes:null, comments:null, shares:null, reach:null, followers:null },
      engagement: emptyEng,
      growth:     { events:[], avgLikesPerHour:0, avgCommentsPerHour:0, peakLikesPerHour:0, peakCommentsPerHour:0, trend:'insufficient_data' },
      viral:      emptyViral,
      hashtags:   { unique:0, topTags:[], all:[], caption:[] },
      mentions:   { unique:0, top:[], all:[] },
      history:    [],
    };
  }

  /* ─── CSV export ─────────────────────────────────────────── */
  function historyToCsv(history) {
    try {
      if (!Array.isArray(history) || !history.length) return '';
      const H = ['Time','Platform','URL','PostID','Likes','Comments','Shares','Reach','Followers','EngageRate','ViralScore','Source'];
      const rows = history.map(h => [
        h.ts ? new Date(h.ts).toLocaleString() : '',
        h.platform??'', h.url??'', h.postId??'',
        h.likes??'', h.comments??'', h.shares??'', h.reach??'',
        h.followers??'', h.engageRate??'', h.viralScore??'', h.source??'',
      ]);
      return [H, ...rows].map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    } catch (e) {
      log.error('historyToCsv:', e.message);
      return '';
    }
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
