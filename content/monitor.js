/**
 * SPM Pro v6 · content/monitor.js
 * Pipeline: interceptor → postMessage → extract → analyse → storage → UI events
 * Fixes: uses processApiPayload (rate-limited), SpmStorage (structured), event bus
 */
'use strict';

const SpmMonitor = (() => {

  let _monitorTimer=null, _monitorActive=false, _monitorInterval=60, _alertThreshold=1;
  let _lastStats={}, _log=[], _lastUrl=location.href;
  let _interceptorInjected=false, _localHistory=[];
  const _histDedup=SpmDedup(500);

  // ── Event bus ────────────────────────────────────────────
  const _bus={};
  function _on(ev,fn){(_bus[ev]=_bus[ev]??[]).push(fn);}
  function _emit(ev,d){(_bus[ev]??[]).forEach(fn=>{try{fn(d);}catch(e){spmLog.error('EventBus',ev,e);}});}

  // ── Inject interceptor ────────────────────────────────────
  function _injectInterceptor() {
    if(_interceptorInjected) return;
    try {
      const s=document.createElement('script');
      s.src=chrome.runtime.getURL('content/interceptor.js');
      s.onload=function(){this.remove();spmLog.info('[Monitor] Interceptor injected ✓');};
      s.onerror=function(){spmLog.warn('[Monitor] Interceptor failed — DOM-only mode');this.remove();};
      (document.head??document.documentElement).appendChild(s);
      _interceptorInjected=true;
    } catch(e){spmLog.error('[Monitor] _injectInterceptor:',e);}
  }

  // ── postMessage listener ──────────────────────────────────
  function _startApiListener() {
    window.addEventListener('message', async function(ev) {
      if(ev.origin&&ev.origin!==location.origin) return;
      if(ev.data?.type!=='IG_API_RESPONSE') return;
      const payload=ev.data?.payload;
      if(!payload||typeof payload!=='object') return;

      spmLog.debug('[Monitor] postMessage received');
      try {
        // Use rate-limited processApiPayload (fix #4)
        const postData=SpmExtractor.processApiPayload(payload);
        if(!postData) return;

        const profile  =SpmExtractor.profile();
        const comments =SpmExtractor.comments(postData.postId);
        const report   =SpmAnalytics.buildReport(postData,_localHistory,profile,comments);

        const snap=_buildSnap(postData,report);
        spmBoundedPush(_localHistory,snap,SPM.MAX_HISTORY);

        // Structured storage (fix #5)
        await SpmStorage.saveSnapshot(snap);

        // Also push to background for popup history
        await _pushBg(snap);

        _emit('apiData',{postData,report});
        _emit('stats',postData);
        if(_monitorActive) _checkAlerts(postData);

        spmLog.info('[Monitor] Pipeline complete — likes:',postData.likes,'comments:',postData.comments,'viral:',report.viral.label);
      } catch(e){spmLog.error('[Monitor] Pipeline error:',e);}
    });
    spmLog.info('[Monitor] API listener active ✓');
  }

  function _buildSnap(postData,report){
    return{
      postId:postData.postId??'', platform:postData.platform??SPM.PLATFORM,
      url:postData.url??location.href, username:postData.username??'',
      likes:postData.likes??null, comments:postData.comments??null,
      shares:postData.shares??null, reach:postData.reach??null,
      followers:report.stats.followers??null,
      caption:(postData.caption??'').slice(0,200),
      hashtags:postData.hashtags??[], mentions:postData.mentions??[],
      mediaUrl:postData.mediaUrl??'', isVideo:postData.isVideo??false,
      ts:Date.now(), postedAt:postData.ts??null, source:postData.source??'api',
      engageRate:report.engagement.ratePercent??null,
      viralScore:report.viral.score??null, viralLabel:report.viral.label??null,
    };
  }

  const _pushBgDedup=SpmDedup(500);
  async function _pushBg(snap) {
    const key=(snap.postId||snap.url)+':'+snap.likes+':'+snap.comments;
    if(!_pushBgDedup.isNew(key)) return;
    const res=await spmSend({type:'PUSH_HISTORY',data:snap});
    if(!res?.ok) spmLog.warn('[Monitor] PUSH_HISTORY bg failed');
  }

  // ── SPA navigation ────────────────────────────────────────
  function _startNavWatcher() {
    const handle=spmDebounce(()=>{
      if(location.href===_lastUrl) return;
      const from=_lastUrl; _lastUrl=location.href; _lastStats={};
      SpmExtractor.resetCache(); spmClearElCache();
      spmLog.info('[Monitor] Navigate:',from.split('/').pop(),'→',_lastUrl.split('/').pop());
      _emit('navigate',{from,to:_lastUrl});
    },600);
    new MutationObserver(handle).observe(document.body,{childList:true,subtree:true});
    setInterval(()=>{if(location.href!==_lastUrl)handle();},1500);
  }

  function _startDomWatcher(cb) {
    const deb=spmDebounce(cb,1200);
    const obs=new MutationObserver(deb);
    const root=document.querySelector('article,[role="main"]')??document.body;
    obs.observe(root,{childList:true,subtree:true,characterData:true});
  }

  // ── Auto-monitor ──────────────────────────────────────────
  async function _tick() {
    try {
      const fresh=SpmExtractor.stats();
      _checkAlerts(fresh); _lastStats=fresh; _emit('tick',{fresh,prev:_lastStats});
    } catch(e){spmLog.error('[Monitor] tick:',e);}
  }

  function _checkAlerts(fresh) {
    const alerts=[];
    const chk=(k,label)=>{const n=fresh[k],o=_lastStats[k];if(n==null||o==null)return;const d=n-o;if(Math.abs(d)>=_alertThreshold)alerts.push({key:k,label,diff:d,from:o,to:n});};
    chk('likes','Likes');chk('comments','Comments');chk('shares','Shares');
    if(!alerts.length) return;
    const msg=alerts.map(a=>`${a.label}: ${a.diff>0?'+':''}${a.diff.toLocaleString()}`).join(' · ');
    const entry={ts:Date.now(),alerts,isAlert:true,msg};
    spmBoundedPush(_log,entry,SPM.MAX_LOG);
    _emit('alert',entry);
    spmSend({type:'NOTIFY',title:'📊 Stats Changed',body:msg});
  }

  // ── Public API ────────────────────────────────────────────
  function init(onContentChange) {
    _injectInterceptor();
    _startApiListener();
    _startNavWatcher();
    if(typeof onContentChange==='function') _startDomWatcher(onContentChange);
    spmLog.info('[Monitor] v6 init ✓');
  }

  function startAutoMonitor(opts={}) {
    if(opts.interval)  _monitorInterval=Math.max(10,+opts.interval);
    if(opts.threshold) _alertThreshold=Math.max(1,+opts.threshold);
    stopAutoMonitor();
    _monitorActive=true; _tick();
    _monitorTimer=setInterval(_tick,_monitorInterval*1000);
    _emit('stateChange',{active:true});
    spmLog.info('[Monitor] Auto-monitor started, interval:',_monitorInterval+'s');
  }

  function stopAutoMonitor(){
    if(_monitorTimer){clearInterval(_monitorTimer);_monitorTimer=null;}
    _monitorActive=false; _emit('stateChange',{active:false});
  }

  async function getHistory() {
    // Merge local + storage
    const stored=await SpmStorage.getAllHistory();
    return stored.length?stored:_localHistory;
  }

  function getReport(){
    const p=SpmExtractor.getLatestPost();
    if(!p) return null;
    return SpmAnalytics.buildReport(p,_localHistory,SpmExtractor.profile(),SpmExtractor.comments(p.postId));
  }

  function on(ev,fn){_on(ev,fn);}
  function isActive(){return _monitorActive;}
  function getLog(){return[..._log];}
  function clearLog(){_log=[];}
  function setLastStats(s){_lastStats=s;}
  function setInterval_(s){_monitorInterval=Math.max(10,+s||60);if(_monitorActive)startAutoMonitor();}
  function setThreshold(n){_alertThreshold=Math.max(1,+n||1);}

  return{init,startAutoMonitor,stopAutoMonitor,getHistory,getReport,
    on,isActive,getLog,clearLog,setLastStats,setInterval:setInterval_,setThreshold};
})();
