/**
 * SPM Pro v6 · content/analytics.js
 * Pure analytics engine — no DOM, no side-effects.
 * Produces dashboard-ready structured output.
 */
'use strict';

const SpmAnalytics = (() => {

  const VIRAL = { ENGAGE_HIGH:5.0, ENGAGE_VIRAL:10.0, GROWTH_FAST:50, GROWTH_VIRAL:200, MIN_LIKES:1000 };

  // ── Engagement Rate ───────────────────────────────────────
  function computeEngagement(likes, comments, followers, shares=0) {
    const l=normalizeNumber(likes)??0, c=normalizeNumber(comments)??0;
    const s=normalizeNumber(shares)??0, f=normalizeNumber(followers);
    const interactions=l+c+s;
    if(!f||f<=0) return{rate:null,ratePercent:'—',tier:'unknown',label:'No follower data',interactions};
    const rate=interactions/f*100;
    const tier=rate>=VIRAL.ENGAGE_VIRAL?'viral':rate>=VIRAL.ENGAGE_HIGH?'high':rate>=2?'average':'low';
    return{ rate:parseFloat(rate.toFixed(4)), ratePercent:rate.toFixed(2)+'%', tier,
      label:{viral:'🔥 Viral',high:'📈 High',average:'✅ Average',low:'📉 Low'}[tier],
      interactions, breakdown:{likes:l,comments:c,shares:s} };
  }

  // ── Growth Rate ───────────────────────────────────────────
  function computeGrowthRate(history) {
    const empty={events:[],avgLikesPerHour:0,avgCommentsPerHour:0,peakLikesPerHour:0,peakCommentsPerHour:0,trend:'insufficient_data'};
    if(!Array.isArray(history)||history.length<2) return empty;
    const sorted=[...history].filter(h=>h.ts!=null).sort((a,b)=>a.ts-b.ts);
    if(sorted.length<2) return empty;
    const events=[];
    for(let i=1;i<sorted.length;i++){
      const prev=sorted[i-1],curr=sorted[i];
      const dtH=(curr.ts-prev.ts)/3_600_000;
      if(dtH<=0) continue;
      const pL=normalizeNumber(prev.likes)??0,cL=normalizeNumber(curr.likes)??0;
      const pC=normalizeNumber(prev.comments)??0,cC=normalizeNumber(curr.comments)??0;
      const ld=cL-pL,cd=cC-pC;
      events.push({fromTs:prev.ts,toTs:curr.ts,dtHours:parseFloat(dtH.toFixed(3)),
        likeDelta:ld,commentDelta:cd,
        likesPerHour:parseFloat((ld/dtH).toFixed(2)),
        commentsPerHour:parseFloat((cd/dtH).toFixed(2)),
        likeGrowthPct:pL>0?parseFloat((ld/pL*100).toFixed(2)):null,
        commentGrowthPct:pC>0?parseFloat((cd/pC*100).toFixed(2)):null});
    }
    if(!events.length) return{...empty,trend:'flat'};
    const avgL=events.reduce((s,e)=>s+e.likesPerHour,0)/events.length;
    const avgC=events.reduce((s,e)=>s+e.commentsPerHour,0)/events.length;
    const pkL=Math.max(...events.map(e=>e.likesPerHour));
    const pkC=Math.max(...events.map(e=>e.commentsPerHour));
    const mid=Math.floor(events.length/2);
    const fA=mid?events.slice(0,mid).reduce((s,e)=>s+e.likesPerHour,0)/mid:0;
    const sA=events.slice(mid).reduce((s,e)=>s+e.likesPerHour,0)/(events.length-mid||1);
    const trend=sA>fA*1.1?'accelerating':sA<fA*0.9?'decelerating':'stable';
    return{events,avgLikesPerHour:parseFloat(avgL.toFixed(2)),avgCommentsPerHour:parseFloat(avgC.toFixed(2)),
      peakLikesPerHour:parseFloat(pkL.toFixed(2)),peakCommentsPerHour:parseFloat(pkC.toFixed(2)),trend,dataPoints:sorted.length};
  }

  // ── Viral Detection ───────────────────────────────────────
  function detectViral(postData, history, profileData) {
    const likes=normalizeNumber(postData?.likes)??0;
    const comments=normalizeNumber(postData?.comments)??0;
    const followers=normalizeNumber(profileData?.followers??postData?.followers);
    const signals=[]; let score=0;
    const engage=computeEngagement(likes,comments,followers);
    if(engage.rate!=null){
      const pts=Math.min(35,(engage.rate/VIRAL.ENGAGE_VIRAL)*35);
      score+=pts;
      if(engage.tier==='viral'||engage.tier==='high')
        signals.push({key:'engagement',label:`${engage.tier==='viral'?'🔥':'📈'} ${engage.ratePercent} engagement`,weight:parseFloat(pts.toFixed(1))});
    }
    if(likes>=VIRAL.MIN_LIKES){
      const pts=Math.min(25,Math.log10(likes/VIRAL.MIN_LIKES+1)*25);
      score+=pts;
      signals.push({key:'likes',label:`❤️ ${spmFmt(likes)} likes`,weight:parseFloat(pts.toFixed(1))});
    }
    if(history?.length>=2){
      const growth=computeGrowthRate(history);
      if(growth.peakLikesPerHour>0){
        const pts=Math.min(30,(growth.peakLikesPerHour/VIRAL.GROWTH_VIRAL)*30);
        score+=pts;
        signals.push({key:'velocity',label:`⚡ ${growth.peakLikesPerHour.toFixed(0)} likes/hr`,weight:parseFloat(pts.toFixed(1))});
      }
      if(growth.trend==='accelerating'){score+=5;signals.push({key:'trend',label:'📈 Accelerating',weight:5});}
    }
    if(likes>0&&comments>0){
      const ratio=comments/likes;
      if(ratio>=0.05){const pts=Math.min(10,ratio*100);score+=pts;signals.push({key:'discussion',label:`💬 ${(ratio*100).toFixed(1)}% comment ratio`,weight:parseFloat(pts.toFixed(1))});}
    }
    const finalScore=Math.min(100,Math.round(score));
    const isViral=finalScore>=60;
    const label=finalScore>=80?'🔥 Going Viral':finalScore>=60?'🚀 Viral Potential':finalScore>=40?'✅ Good':finalScore>=20?'📊 Average':'📉 Low';
    return{score:finalScore,isViral,label,signals,engage};
  }

  // ── Hashtag analytics ─────────────────────────────────────
  function analyzeHashtags(postData,commentList=[]) {
    const allText=[postData?.caption??'',...commentList.map(c=>c.text??'')].join(' ');
    const freq=new Map();
    extractHashtags(allText).forEach(t=>freq.set(t,(freq.get(t)??0)+1));
    const sorted=[...freq.entries()].sort((a,b)=>b[1]-a[1]).map(([tag,count])=>({tag,count}));
    return{unique:sorted.length,topTags:sorted.slice(0,10),all:sorted,caption:postData?.hashtags??[]};
  }

  function analyzeMentions(postData,commentList=[]) {
    const allText=[postData?.caption??'',...commentList.map(c=>c.text??'')].join(' ');
    const freq=new Map();
    extractMentions(allText).forEach(m=>freq.set(m,(freq.get(m)??0)+1));
    const sorted=[...freq.entries()].sort((a,b)=>b[1]-a[1]).map(([mention,count])=>({mention,count}));
    return{unique:sorted.length,top:sorted.slice(0,10),all:sorted};
  }

  // ── Full report (dashboard-ready) ────────────────────────
  function buildReport(postData, history, profileData, commentList=[]) {
    const engage   = computeEngagement(postData?.likes,postData?.comments,profileData?.followers??postData?.followers,postData?.shares);
    const growth   = computeGrowthRate(history);
    const viral    = detectViral(postData,history,profileData??{});
    const hashtags = analyzeHashtags(postData,commentList);
    const mentions = analyzeMentions(postData,commentList);
    return{
      meta:{generatedAt:Date.now(),postId:postData?.postId??'',url:postData?.url??location.href,platform:postData?.platform??SPM.PLATFORM,dataSource:postData?.source??'unknown'},
      post:{username:postData?.username??'',caption:postData?.caption??'',isVideo:postData?.isVideo??false,mediaUrl:postData?.mediaUrl??'',postedAt:postData?.ts??null},
      stats:{likes:postData?.likes??null,comments:postData?.comments??null,shares:postData?.shares??null,reach:postData?.reach??null,followers:profileData?.followers??postData?.followers??null},
      engagement:engage, growth, viral, hashtags, mentions,
      history:history.slice(-50),
    };
  }

  function historyToCsv(history) {
    const h=['Time','Platform','URL','PostID','Likes','Comments','Shares','Reach','Followers','EngageRate','ViralScore','Source'];
    const rows=history.map(h=>[h.ts?new Date(h.ts).toLocaleString():'',h.platform??'',h.url??'',h.postId??'',h.likes??'',h.comments??'',h.shares??'',h.reach??'',h.followers??'',h.engageRate??'',h.viralScore??'',h.source??'']);
    return[h,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  }

  return{computeEngagement,computeGrowthRate,detectViral,analyzeHashtags,analyzeMentions,buildReport,historyToCsv};
})();
