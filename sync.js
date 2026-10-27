/* TIPON Organization JSON API + durable, explicit-ack synchronization. */
'use strict';
window.TIPONAPI=(()=>{
  async function raw(payload){
    if(!navigator.onLine)throw Object.assign(Error('Network unavailable. Local data is retained; keep the app open when internet returns.'),{code:'NETWORK'});
    let body;
    try{body=await TIPONGitHubBridge.request({protocol:TIPONOrgCore.PROTOCOL,deviceId:state.deviceId,...payload});}
    catch(e){throw Object.assign(Error(e.message||'Google Apps Script connection failed. Local records remain saved.'),{code:e.code||'NETWORK'});}
    if(!body.ok)throw Object.assign(Error(body.error||'Server rejected the request.'),{code:body.code||'SERVER'});
    if(body.protocol!==TIPONOrgCore.PROTOCOL)throw Object.assign(Error('App and server versions do not match.'),{code:'PROTOCOL'});
    return body;
  }
  async function call(payload){const token=await TIPONAuth.ensureOnline();return raw({...payload,token});}
  return {raw,call};
})();
window.TIPONSync=(()=>{
  let busy=false,timer=null,attempt=0,message='Sign in to enable organization sync.',lastSync='',stopped=true;
  function render(){
    const s=TIPONAuth.current();const pending=state.punches.filter(p=>p.orgId===state.orgId&&!p.cloudAck&&!p.reviewStatus).length;
    const review=state.punches.filter(p=>p.reviewStatus).length;
    setText('syncConnectionState',s?(busy?'Syncing organization data...':navigator.onLine?'Account connected; automatic retry enabled':'Offline: using this device\'s saved data'):'Sign in required');
    setText('syncQueueState',pending+' local attendance events pending'+(review?' | '+review+' require review':''));
    setText('syncLastState',message+(lastSync?' | Last successful sync: '+lastSync:''));setText('recordSyncState',message);
    if($('syncNow'))$('syncNow').disabled=busy||!s;if($('syncRecordsNow'))$('syncRecordsNow').disabled=busy||!s;
    setText('orgSyncStamp',lastSync?'Last received: '+lastSync:'No central snapshot received yet.');
  }
  function start(){stopped=false;kick();}
  function stop(){stopped=true;clearTimeout(timer);}
  function schedule(){clearTimeout(timer);if(stopped)return;timer=setTimeout(run,Math.min(300000,20000*2**attempt)+Math.floor(Math.random()*3000));}
  function kick(){clearTimeout(timer);if(!stopped)timer=setTimeout(run,500+Math.floor(Math.random()*1500));render();}
  async function markOps(reply){
    const all=await getAll('outbox');
    for(const id of reply.ackOps||[]){const item=all.find(x=>x.id===id);if(!item)continue;const receipt=(reply.receipts||[]).find(x=>x.type===item.type&&x.id===item.value.id);
      await new Promise((resolve,reject)=>{const tx=db.transaction([item.type,'outbox'],'readwrite'),store=tx.objectStore(item.type),r=store.get(item.value.id);r.onsuccess=()=>{const current=r.result;if(current&&current._pendingOp===id){current.rev=receipt?.rev||item.baseRev+1;delete current._pendingOp;store.put(current);}tx.objectStore('outbox').delete(id);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    }
    for(const issue of reply.operationErrors||[]){const item=all.find(x=>x.id===issue.id);if(item){item.error=issue.error;item.errorCode=issue.code;await OrgDB.rawSave('outbox',item);}}
  }
  const wire=p=>p.uploadPayload||{id:p.id,deviceId:p.deviceId,sessionId:p.sessionId,memberId:String(p.memberId),siteId:p.siteId,siteRev:p.siteRev||0,type:p.type,timestamp:p.timestamp,lat:p.lat,lng:p.lng,accuracy:p.accuracy,faceDistance:p.faceDistance};
  async function flush(){
    const actor=state.user;
    const outbox=(await getAll('outbox')).filter(o=>o.orgId===state.orgId&&o.ownerId===actor.id&&(!o.errorCode||['DEPENDENCY','BUSY','SERVER','NETWORK'].includes(o.errorCode))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    const weights={sites:0,members:1,schedules:2};outbox.sort((a,b)=>weights[a.type]-weights[b.type]||a.createdAt.localeCompare(b.createdAt));
    const operations=actor.role==='kiosk'?[]:outbox.slice(0,5);
    const events=state.punches.filter(p=>p.orgId===state.orgId&&!p.cloudAck&&!p.reviewStatus&&p.deviceId===state.deviceId).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(0,20);
    if(!operations.length&&!events.length)return;
    for(const op of operations){op.everSent=true;await OrgDB.rawSave('outbox',op);}
    for(const p of events){if(!p.uploadPayload){p.uploadPayload=wire(p);await OrgDB.rawSave('punches',p);}}
    const reply=await TIPONAPI.call({action:'submit',operations:operations.map(o=>({id:o.id,type:o.type,value:o.value,baseRev:o.baseRev})),events:events.map(wire)});
    await markOps(reply);
    const sent=new Set(events.map(p=>p.id));
    if((reply.ackIds||[]).some(id=>!sent.has(id)))throw Error('Unexpected attendance acknowledgement. Nothing else was marked synced.');
    for(const id of reply.ackIds||[]){const p=await getOne('punches',id);if(p){p.cloudAck=true;delete p.syncError;delete p.reviewStatus;await OrgDB.rawSave('punches',p);}}
    for(const r of reply.rejected||[]){const p=await getOne('punches',r.id);if(p){p.syncError=r.error;if(!['DEPENDENCY','SERVER','BUSY'].includes(r.code))p.reviewStatus=r.code;await OrgDB.rawSave('punches',p);}}
    const errs=(reply.operationErrors||[]).concat(reply.rejected||[]);if(errs.length)message='Some records remain local: '+errs[0].error;
  }
  async function pullCatalog(version){
    const cfgId='tp5-catalog:'+state.orgId+':'+state.user.id+':'+state.user.role+':v5.2-scope:'+String(state.user.version||1)+':'+(state.user.siteIds||[]).join(',');
    const known=await getOne('meta',cfgId),localMembers=await getAll('members');
    const scoped=localMembers.filter(m=>m.orgId===state.orgId&&TIPONOrgCore.inScope(state.user,m));
    const faceCount=scoped.filter(m=>!m.deleted&&m.active!==false&&m.template).length;
    // Re-download if the cached catalog is incomplete or its local records were
    // deleted independently. Do not accept version equality alone as evidence.
    if(known?.version===version&&Number.isInteger(known.memberCount)&&
       known.memberCount===scoped.length&&
       faceCount>=Number(known.enrolledCount||0))return;
    let cursor=0,startVersion=null,pages=0,memberCount=0,enrolledCount=0;
    do{
      const response=await TIPONAPI.call({action:'catalog',cursor});if(startVersion===null)startVersion=response.catalogVersion;
      if(response.catalogVersion!==startVersion)throw Error('Directory changed during download. Retrying a consistent snapshot.');
      if(response.businessPlatforms?.length)await TIPONPlatforms.accept(response.businessPlatforms);
      for(const type of ['sites','members','schedules'])for(const entity of response[type]||[]){
        if(type==='members'){
          memberCount++;
          if(!entity.deleted&&entity.active!==false&&entity.template)enrolledCount++;
        }
        const old=await getOne(type,entity.id);if(old?._pendingOp)continue;
        const value={...entity,orgId:state.orgId};
        if(type==='members'&&entity.template){await TIPONAuth.unseal(entity.template,TIPONAuth.current().faceKey,'member:'+entity.id);delete value.descriptors;}
        await OrgDB.rawSave(type,value);
      }
      cursor=response.nextCursor;pages++;setText('syncLastState','Downloading approved directory: '+Math.min(pages*50,response.total)+' / '+response.total+' members.');
      if(stopped||document.hidden)throw Error('Directory download paused. Keep the app open to finish.');
    }while(cursor!==null&&pages<500);
    if(cursor!==null)throw Error('Directory is too large for one download; contact the system owner.');
    await OrgDB.rawSave('meta',{id:cfgId,version:startVersion,memberCount,enrolledCount,complete:true});
  }
  function cursorId(){return 'tp5-events:'+state.orgId+':'+state.user.id+':'+state.user.role+':v5.2-scope:'+String(state.user.version||1)+':'+(state.user.siteIds||[]).join(',');}
  async function pull(){
    const id=cursorId();let saved=await getOne('meta',id),cursor=saved?.cursor||0;
    for(let pages=0;pages<8;pages++){
      const r=await TIPONAPI.call({action:'poll',cursor});
      for(const event of r.events||[]){const old=await getOne('punches',event.id);await OrgDB.rawSave('punches',{...old,...event,orgId:state.orgId,cloudAck:true});}
      cursor=r.cursor;await OrgDB.rawSave('meta',{id,cursor,orgId:state.orgId});
      state.devices=r.devices||state.devices||[];await OrgDB.rawSave('meta',{id:'tp5-deviceSnapshot',devices:state.devices,orgId:state.orgId});
      await pullCatalog(r.catalogVersion);
      if(!r.more||document.hidden||stopped)break;
    }
  }
  async function run(){
    if(stopped||busy||!state.user||document.hidden){schedule();return;}
    if(!navigator.onLine){message='Offline: saved locally. Automatic sync resumes when internet is available and this app is open.';render();schedule();return;}
    busy=true;message='Connecting to organization database...';render();
    try{
      await TIPONAuth.ensureOnline();await loadCollections();await flush();await pull();await loadCollections();
      lastSync=TIPONCore.phStamp(new Date().toISOString());const waiting=(await getAll('outbox')).filter(o=>o.orgId===state.orgId&&o.error).length+state.punches.filter(p=>p.reviewStatus).length;message=waiting?'Central data updated; '+waiting+' record(s) still need review. See Settings / Accounts.':'Central data updated; records are acknowledged, not assumed sent.';attempt=0;
      if(state.page==='dashboard')renderDashboard();if(state.page==='records')renderRecords();if(state.page==='members')renderMembers();if(state.page==='accounts'&&isAdmin())await OrgUI.renderAccounts();if(state.page==='sites')renderSites();if(state.page==='scanner'){renderTerminal();renderTerminalLogs();const ready=state.members.filter(m=>m.active!==false&&!m.deleted&&m.descriptors?.length>=3).length;if(ready)updateScanResult('Member directory ready',ready+' enrolled face template(s) loaded on this terminal. Face matches are checked against assigned office GPS.','success');}TIPONPlatforms.render();
    }catch(e){message=e.message;attempt=Math.min(attempt+1,4);if(['AUTH','ACCOUNT','DEVICE_DISABLED'].includes(e.code))message+=' Sign out and sign in online.';}
    finally{busy=false;render();schedule();}
  }
  async function init(){
    attach('syncNow','click',kick);attach('syncRecordsNow','click',kick);
    window.addEventListener('online',kick);window.addEventListener('offline',render);document.addEventListener('visibilitychange',()=>{if(!document.hidden)kick();});render();
  }
  return {init,start,stop,kick,render,run,isBusy:()=>busy};
})();
