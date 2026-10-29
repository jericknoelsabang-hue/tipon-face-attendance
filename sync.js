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
  let busy=false,timer=null,attempt=0,message='Sign in to enable organization sync.',lastSync='',stopped=true,activeRun=null,siteFastRetry=0;
  // Pause a single Work Location while an Administrator resolves a stale outbox
  // operation against an authoritative central snapshot. Other locations and
  // attendance events continue to synchronize normally.
  let recoveredCompatibleOperations=false;
  const suspendedSiteIds=new Set();
  function pauseSite(id){
    const key=String(id||'');if(!key)throw Error('Work Location ID is required.');
    suspendedSiteIds.add(key);
    let released=false;
    return ()=>{if(released)return;released=true;suspendedSiteIds.delete(key);};
  }
  async function waitUntilIdle(){
    const running=activeRun;
    if(running){try{await running;}catch(_){/* Next read checks server state. */}}
  }
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
  function schedule(){clearTimeout(timer);if(stopped)return;
    const localEventsQueued=state.punches.some(p=>p.orgId===state.orgId&&!p.cloudAck&&!p.reviewStatus&&p.deviceId===state.deviceId);
     const base=localEventsQueued?7000:state.user?.role==='admin'?15000:5000;
    const seconds=siteFastRetry>0&&siteFastRetry<=3&&attempt===0?4200:Math.min(300000,base*2**attempt)+Math.floor(Math.random()*3000);
    timer=setTimeout(run,seconds);
  }
  function kick(){clearTimeout(timer);if(!stopped)timer=setTimeout(run,100);render();}
  async function markOps(reply){
    const all=await getAll('outbox');
    for(const id of reply.ackOps||[]){const item=all.find(x=>x.id===id);if(!item)continue;const receipt=(reply.receipts||[]).find(x=>x.type===item.type&&x.id===item.value.id);
      await new Promise((resolve,reject)=>{const tx=db.transaction([item.type,'outbox'],'readwrite'),store=tx.objectStore(item.type),r=store.get(item.value.id);r.onsuccess=()=>{const current=r.result;if(current&&current._pendingOp===id){current.rev=receipt?.rev||item.baseRev+1;delete current._pendingOp;delete current.syncIssue;store.put(current);}tx.objectStore('outbox').delete(id);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    }
    for(const issue of reply.operationErrors||[]){
      const item=all.find(x=>x.id===issue.id);
      if(!item)continue;
      item.error=issue.error;
      const code=String(issue.code||'SERVER').toUpperCase();
      item.errorCode=['ACTION','FORBIDDEN','AUTHZ','PERMISSION','CONFLICT','NOT_FOUND','VALIDATION'].includes(code)||
        /only an approved user|permission denied|not authorized|revision conflict/i.test(String(issue.error||''))
        ?'NEEDS_REVIEW':code;
      await OrgDB.rawSave('outbox',item);
      if(item.type==='sites'){
        const site=await getOne('sites',item.value.id);
        if(site?._pendingOp===item.id){site.syncIssue=String(issue.error||'Awaiting server acknowledgement').slice(0,180);await OrgDB.rawSave('sites',site);}
      }
    }
  }
  const wire=p=>p.uploadPayload||{id:p.id,deviceId:p.deviceId,sessionId:p.sessionId,memberId:String(p.memberId),siteId:p.siteId,siteRev:p.siteRev||0,type:p.type,timestamp:p.timestamp,lat:p.lat,lng:p.lng,accuracy:p.accuracy,faceDistance:p.faceDistance};
  // Recover Admin member deletions queued by older app versions. Earlier
  // submit() rules rejected these operations after hiding the record locally.
  // Never infer deletions merely from missing local members: require an actual
  // queued deleted:true operation created by the currently signed-in Admin.
  async function reconcileLegacyAdminDeletes(){
    if(state.user?.role!=='admin')return 0;
    const pending=(await getAll('outbox'))
      .filter(o=>o.orgId===state.orgId&&o.ownerId===state.user.id&&
        o.type==='members'&&o.value?.deleted===true&&
        o.errorCode!=='NEEDS_REVIEW')
      .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')))
      .slice(0,5);
    let completed=0;
    for(const op of pending){
      try{
        const reply=await TIPONAPI.call({action:'adminMemberDelete',
          memberId:op.value.id,baseRev:Number(op.baseRev)||0});
        if(!reply.member?.deleted||reply.member.id!==op.value.id){
          throw Error('Server did not acknowledge the previously queued member deletion.');
        }
        const current=await getOne('members',op.value.id);
        if(current&&current._pendingOp===op.id){
          const tombstone={...current,...reply.member,orgId:state.orgId,deleted:true,active:false,
            template:null,faceEnrollmentStatus:'deleted'};
          delete tombstone.descriptors;delete tombstone._pendingOp;
          await OrgDB.rawSave('members',tombstone);
        }
        await OrgDB.rawDelete('outbox',op.id);
        completed++;
      }catch(error){
        // A revision conflict needs explicit review. Do not silently delete a
        // member that somebody may have updated after the old confirmation.
        const code=String(error.code||'SERVER');
        op.error='Legacy member deletion: '+(error.message||'Server error')+
          (code==='ACTION'?' Deploy backend v5.5.8 to finish this deletion.':'');
        op.errorCode=['CONFLICT','FORBIDDEN','NOT_FOUND'].includes(code)?'NEEDS_REVIEW':code;
        await OrgDB.rawSave('outbox',op);
        if(code==='AUTH'||code==='DEVICE_DISABLED')throw error;
        if(code==='ACTION'||code==='NETWORK'||code==='TIMEOUT')break;
      }
    }
    if(completed)message=completed+' previously queued member deletion(s) confirmed by the central database.';
    return completed;
  }
  async function flush(){
    const actor=state.user;
    const outbox=(await getAll('outbox')).filter(op=>op.orgId===state.orgId&&op.ownerId===actor.id)
      .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
    if(actor.role==='admin'){
      for(const op of outbox.filter(x=>x.type==='members'&&!x.value?.deleted&&x.errorCode!=='NEEDS_REVIEW')){
        op.error='Legacy member edit needs review. Use the current Member List editor.';
        op.errorCode='NEEDS_REVIEW';await OrgDB.rawSave('outbox',op);
      }
    }
    const specialTypes=['memberEdits','memberFaceUpdates','memberDeletes','attendanceCorrections','siteDeletes'];
    const eligible=outbox.filter(op=>
      !['NEEDS_REVIEW','CONFLICT','FORBIDDEN','NOT_FOUND'].includes(op.errorCode)&&
      !specialTypes.includes(op.type)&&!(actor.role==='admin'&&op.type==='members')&&
      !(op.type==='sites'&&suspendedSiteIds.has(String(op.value?.id||''))));
    const siteQueue=eligible.filter(op=>op.type==='sites');
    const operations=actor.role==='kiosk'?[]:(siteQueue.length?siteQueue.slice(0,3):eligible.slice(0,5));
    const events=state.punches.filter(p=>
      p.orgId===state.orgId&&!p.cloudAck&&!p.reviewStatus&&p.deviceId===state.deviceId)
      .sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(0,8);
    const special=outbox.filter(op=>specialTypes.includes(op.type)&&
      !['NEEDS_REVIEW','CONFLICT','FORBIDDEN','NOT_FOUND'].includes(op.errorCode));
    if(!operations.length&&!events.length&&!special.length)return;
    const reportError=async(op,error)=>{
      const latest=await getOne('outbox',op.id);if(!latest)return;
      latest.error=String(error.message||error).slice(0,400);
      const code=String(error.code||'SERVER').toUpperCase();
      latest.errorCode=['ACTION','FORBIDDEN','AUTHZ','PERMISSION','CONFLICT','NOT_FOUND','VALIDATION','OVERLAP','OPEN_SESSION'].includes(code)||
        /only an approved user|permission denied|not authorized|revision conflict/i.test(latest.error)?'NEEDS_REVIEW':code;
      await OrgDB.rawSave('outbox',latest);
      if(op.type==='sites'){
        const site=await getOne('sites',op.value.id);
        if(site?._pendingOp===op.id){site.syncIssue=latest.error;await OrgDB.rawSave('sites',site);}
      }
    };
    const send=async(ops,punches,allowSplit=true)=>{
      for(const op of ops){op.everSent=true;await OrgDB.rawSave('outbox',op);}
      for(const p of punches){if(!p.uploadPayload){p.uploadPayload=wire(p);await OrgDB.rawSave('punches',p);}}
      let reply;
      try{
        reply=await TIPONAPI.call({action:'submit',
          operations:ops.map(op=>({id:op.id,type:op.type,value:op.value,baseRev:op.baseRev})),
          events:punches.map(wire)});
      }catch(error){
        if(allowSplit&&ops.length>1&&ops.every(op=>op.type==='sites')&&!punches.length&&
          !['AUTH','ACCOUNT','DEVICE_DISABLED'].includes(String(error.code||''))){
          let confirmed=0;
          for(const op of ops){try{await send([op],[],false);confirmed++;}catch(e){await reportError(op,e);}}
          message=confirmed?confirmed+' Work Location(s) accepted; other locations need review or retry.':'Work Location sync failed. Check Sync Status.';
          return;
        }
        for(const op of ops)await reportError(op,error);
        throw error;
      }
      await markOps(reply);
      const sent=new Set(punches.map(p=>p.id));
      if((reply.ackIds||[]).some(id=>!sent.has(id)))throw Error('Unexpected attendance acknowledgement.');
      for(const id of reply.ackIds||[]){
        const p=await getOne('punches',id);
        if(p){p.cloudAck=true;delete p.syncError;delete p.reviewStatus;await OrgDB.rawSave('punches',p);}
      }
      for(const rejected of reply.rejected||[]){
        const p=await getOne('punches',rejected.id);
        if(p){p.syncError=rejected.error;if(!['DEPENDENCY','SERVER','BUSY'].includes(rejected.code))p.reviewStatus=rejected.code;await OrgDB.rawSave('punches',p);}
      }
      const errors=(reply.operationErrors||[]).concat(reply.rejected||[]);
      if(errors.length)message='Some records need review: '+String(errors[0].error||'Rejected').slice(0,180);
    };
    const failSpecial=async(op,error)=>{
      const latest=await getOne('outbox',op.id);if(!latest)return;
      latest.error=String(error.message||error).slice(0,400);
      latest.errorCode=['ACTION','CONFLICT','FORBIDDEN','NOT_FOUND','VALIDATION','OPEN_SESSION','OVERLAP'].includes(String(error.code||'').toUpperCase())?'NEEDS_REVIEW':String(error.code||'SERVER').toUpperCase();
      await OrgDB.rawSave('outbox',latest);
      if(op.type==='attendanceCorrections'){
        for(const eventId of op.value.eventIds||[]){
          const p=await getOne('punches',eventId);if(!p)continue;
          const original=op.value.original||{};
          if(op.value.delete)p.deleted=false;
          else if(p.type==='IN'&&original.timeIn)p.timestamp=original.timeIn;
          else if(p.type==='OUT'&&original.timeOut)p.timestamp=original.timeOut;
          p.pendingCorrection='review';p.syncError=latest.error;await OrgDB.rawSave('punches',p);
        }
      }else if(op.type==='memberEdits'){
        const id=op.value.memberId,current=await getOne('members',id),original=op.value.original;
        if(current&&original){
          Object.assign(current,{memberNumber:original.memberNumber||current.memberNumber||current.id,name:original.name,coop:original.coop,platform:original.platform,siteId:original.siteIds?.[0]||'',siteIds:original.siteIds||[]});
          delete current._pendingOp;delete current.pendingEdit;current.syncIssue=latest.error;await OrgDB.rawSave('members',current);
        }
      }else if(op.type==='memberFaceUpdates'){
        const current=await getOne('members',op.value.memberId),original=op.value.original;
        if(current&&original){
          Object.assign(current,{memberNumber:original.memberNumber||current.memberNumber||current.id,name:original.name,coop:original.coop,platform:original.platform,
            siteId:original.siteId||original.siteIds?.[0]||'',siteIds:original.siteIds||[],
            template:original.template||null,consentAt:original.consentAt||null,
            enrolledBy:original.enrolledBy||'',enrolledByUsername:original.enrolledByUsername||'',
            active:original.active!==false,faceEnrollmentStatus:original.faceEnrollmentStatus||'not-enrolled'});
          current.descriptors=[];delete current._pendingOp;delete current.pendingEdit;
          current.pendingFaceUpdate='review';current.syncIssue=latest.error;
          await OrgDB.rawSave('members',current);
        }
      }else if(op.type==='memberDeletes'){
        const current=await getOne('members',op.value.memberId);
        if(current){current.deleted=false;current.active=op.value.wasActive!==false;delete current._pendingOp;current.pendingDelete='review';current.syncIssue=latest.error;await OrgDB.rawSave('members',current);}
      }else if(op.type==='siteDeletes'){
        const original=op.value.original,current=await getOne('sites',op.value.siteId);
        if(current){
          if(original)Object.assign(current,original);
          current.deleted=false;delete current._pendingOp;
          current.pendingDelete='review';current.syncIssue=latest.error;
          await OrgDB.rawSave('sites',current);
        }
      }
    };
    if(events.length)await send([],events);
    for(const op of special){
      try{
        if(op.type==='memberEdits'||op.type==='memberFaceUpdates'){
          const memberId=String(op.value.memberId),baseRev=Number(op.baseRev)||0;
          let reply,usedGenericSubmit=false;
          const action=op.type==='memberFaceUpdates'?'memberFaceUpdateV2':
            actor.role==='admin'?'adminMemberUpdateV2':'memberTransferUpdateV2';
          const routeChanges={...(op.value.changes||{})};
          if(op.type==='memberFaceUpdates'){
            delete routeChanges.enrolledBy;
            delete routeChanges.enrolledByUsername;
          }
          try{
            reply=await TIPONAPI.call({action,memberId,baseRev,changes:routeChanges});
          }catch(error){
            const unsupported=['ACTION','UNKNOWN_ACTION','NOT_IMPLEMENTED'].includes(String(error?.code||'').toUpperCase())||
              /unknown action|unsupported action|not implemented|is not defined/i.test(String(error?.message||''));
            if(!unsupported)throw error;
            // Compatibility path for deployments that still expose the original
            // authenticated submit API but not the newer specialized action.
            const current=await getOne('members',memberId);
            if(!current||current.deleted)throw Object.assign(Error('Member no longer exists. Refresh the Member List.'),{code:'NOT_FOUND'});
            if(current._pendingOp&&current._pendingOp!==op.id)throw Object.assign(Error('A concurrent member update is pending.'),{code:'CONFLICT'});
            const changes=op.value.changes||{};
            const wire={...current,...changes,id:memberId,memberNumber:changes.memberNumber||current.memberNumber||current.id,
              siteIds:Array.isArray(changes.siteIds)?changes.siteIds:(current.siteIds||[current.siteId].filter(Boolean)),
              siteId:(Array.isArray(changes.siteIds)?changes.siteIds[0]:current.siteId)||'',orgId:state.orgId,rev:baseRev};
            for(const field of ['descriptors','_row','_pendingOp','pendingEdit','syncIssue','syncError','templateError','pendingFaceUpdate','pendingDelete'])delete wire[field];
            const fallback=await TIPONAPI.call({action:'submit',operations:[{id:op.id,type:'members',value:wire,baseRev}],events:[]});
            const operationError=(fallback.operationErrors||[]).find(item=>String(item.id)===String(op.id));
            if(operationError)throw Object.assign(Error(operationError.error||'The organization rejected the member update.'),{code:operationError.code||'SERVER'});
            if(!(fallback.ackOps||[]).includes(op.id))throw Error('The organization did not acknowledge the member update. No central change was assumed.');
            const receipt=(fallback.receipts||[]).find(item=>item.type==='members'&&String(item.id)===memberId);
            if(!receipt||Number(receipt.rev)!==baseRev+1)throw Error('The organization returned an incomplete member update receipt.');
            reply={member:{...wire,rev:Number(receipt.rev)}};
            usedGenericSubmit=true;
          }
          if(!reply.member||String(reply.member.id)!==memberId)throw Error('Server did not confirm member changes.');
          const changes=op.value.changes||{};
          const expectedNumber=String(changes.memberNumber||op.value.original?.memberNumber||memberId).trim();
          const expectedName=String(changes.name??op.value.original?.name??reply.member.name).trim();
          const expectedCoop=String(changes.coop??op.value.original?.coop??reply.member.coop);
          const expectedPlatform=String(changes.platform??op.value.original?.platform??reply.member.platform);
          const expectedSites=(Array.isArray(changes.siteIds)?changes.siteIds:op.value.original?.siteIds||[]).map(String);
          const returnedSites=(Array.isArray(reply.member.siteIds)&&reply.member.siteIds.length?reply.member.siteIds:[reply.member.siteId].filter(Boolean)).map(String);
          if(String(reply.member.memberNumber||reply.member.id).trim()!==expectedNumber||
             String(reply.member.name||'').trim()!==expectedName||String(reply.member.coop||'')!==expectedCoop||
             TIPONOrgCore.platformKey(reply.member.platform)!==TIPONOrgCore.platformKey(expectedPlatform)||
             returnedSites.length!==expectedSites.length||!returnedSites.every(id=>expectedSites.includes(id)))
            throw Error('The central organization did not confirm all member fields. Refresh the Member List before retrying.');
          if(op.type==='memberFaceUpdates'&&(!reply.member.template||reply.member.template.alg!=='AES-GCM'||
             reply.member.template.data!==changes.template?.data||reply.member.template.iv!==changes.template?.iv||
             reply.member.faceEnrollmentStatus!=='enrolled'))
            throw Error('The organization did not confirm the encrypted face enrollment.');
          const current=await getOne('members',memberId);
          if(current?._pendingOp&&current._pendingOp!==op.id)
            throw Object.assign(Error('A concurrent member update is pending.'),{code:'CONFLICT'});
          const updated={...current,...reply.member,orgId:state.orgId};
          delete updated._pendingOp;delete updated.pendingEdit;delete updated.pendingFaceUpdate;delete updated.templateError;delete updated.syncIssue;
          await OrgDB.rawSave('members',updated);await OrgDB.rawDelete('outbox',op.id);
          if(usedGenericSubmit)message='Member update confirmed through the compatible organization submit API.';
        }else if(op.type==='memberDeletes'){
          const action=actor.role==='admin'?'adminMemberDelete':'memberUserDelete';
          const reply=await TIPONAPI.call({action,memberId:op.value.memberId,baseRev:Number(op.baseRev)||0});
          if(!reply.member?.deleted||String(reply.member.id)!==String(op.value.memberId))throw Error('Server did not confirm member deletion.');
          const current=await getOne('members',op.value.memberId);
          if(current){const deleted={...current,...reply.member,orgId:state.orgId,deleted:true,active:false,template:null,faceEnrollmentStatus:'deleted'};delete deleted.descriptors;delete deleted._pendingOp;delete deleted.pendingDelete;await OrgDB.rawSave('members',deleted);}
          await OrgDB.rawDelete('outbox',op.id);
        }else if(op.type==='siteDeletes'){
          const site=op.value.site;
          const reply=await TIPONAPI.call({action:'submit',operations:[{id:op.id,type:'sites',value:site,baseRev:Number(op.baseRev)||0}],events:[]});
          if(!(reply.ackOps||[]).includes(op.id))throw Error('Server did not confirm Work Location deletion.');
          const receipt=(reply.receipts||[]).find(x=>x.type==='sites'&&x.id===op.value.siteId);
          const current=await getOne('sites',op.value.siteId);
          if(current){const deleted={...current,deleted:true,rev:Number(receipt?.rev)||Number(current.rev||0)+1};delete deleted._pendingOp;delete deleted.pendingDelete;delete deleted.syncIssue;await OrgDB.rawSave('sites',deleted);}
          await OrgDB.rawDelete('outbox',op.id);
        }else if(op.type==='attendanceCorrections'){
          const ids=op.value.eventIds||[],eventsForCorrection=await Promise.all(ids.map(id=>getOne('punches',id)));
          if(!eventsForCorrection.length||eventsForCorrection.some(p=>!p||!p.cloudAck||p.requiresSessionResolution))continue;
          const reply=await TIPONAPI.call({action:'attendanceCorrect',sessionId:op.value.sessionId,
            baseRev:Number(op.baseRev)||0,changes:op.value.changes||{},delete:!!op.value.delete,reason:op.value.reason});
          const correction=reply.correction;
          if(!correction||String(correction.sessionId)!==String(op.value.sessionId))throw Error('Server did not confirm attendance correction.');
          for(const eventId of ids){
            const p=await getOne('punches',eventId);if(!p)continue;
            if(correction.deleted)p.deleted=true;
            else{
              if(p.type==='IN'&&correction.timeIn)p.timestamp=correction.timeIn;
              if(p.type==='OUT'&&correction.timeOut)p.timestamp=correction.timeOut;
              p.deleted=false;
            }
            p.correctionRev=Number(correction.rev)||0;delete p.pendingCorrection;delete p.syncError;delete p.reviewStatus;
            await OrgDB.rawSave('punches',p);
          }
          await OrgDB.rawDelete('outbox',op.id);
        }
      }catch(error){await failSpecial(op,error);}
    }
    if(operations.length)await send(operations,[]);
  }
  async function pullCatalog(version){
    const cfgId='tp5-catalog:'+state.orgId+':'+state.user.id+':'+state.user.role+':v5.5.17-scope:'+String(state.user.version||1)+':'+(state.user.siteIds||[]).join(',');
    const known=await getOne('meta',cfgId),localMembers=await getAll('members');
    const scoped=localMembers.filter(m=>m.orgId===state.orgId&&TIPONOrgCore.inScope(state.user,m));
    const faceCount=scoped.filter(m=>!m.deleted&&m.active!==false&&m.template).length;
    // Re-download if the cached catalog is incomplete or its local records were
    // deleted independently. Do not accept version equality alone as evidence.
    const pendingSites=(await getAll('outbox')).some(op=>op.orgId===state.orgId&&op.ownerId===state.user.id&&op.type==='sites'&&!['NEEDS_REVIEW','FORBIDDEN','CONFLICT'].includes(op.errorCode));
    if(!pendingSites&&known?.version===version&&Number.isInteger(known.memberCount)&&
       known.memberCount===scoped.length&&
       faceCount>=Number(known.enrolledCount||0))return;
    let cursor=0,startVersion=null,pages=0,memberCount=0,enrolledCount=0;
    const seen={members:new Set(),sites:new Set()};
    do{
      const response=await TIPONAPI.call({action:'catalog',cursor});if(startVersion===null)startVersion=response.catalogVersion;
      if(response.catalogVersion!==startVersion)throw Error('Directory changed during download. Retrying a consistent snapshot.');
      if(response.businessPlatforms?.length)await TIPONPlatforms.accept(response.businessPlatforms,
        response.businessPlatformRecords||response.businessPlatformDetails||response.platformRecords||null);
      for(const type of ['sites','members','schedules'])for(const entity of response[type]||[]){
        if(type==='members'||type==='sites')seen[type].add(entity.id);
        if(type==='members'){
          memberCount++;
          if(!entity.deleted&&entity.active!==false&&entity.template)enrolledCount++;
        }
        const old=await getOne(type,entity.id);
        if(old?._pendingOp){
          // A previous submit may have reached the server but its browser
          // acknowledgement was lost. Verify an exact remote site match,
          // including revision, before clearing that local pending flag.
          if(type==='sites'){
            const op=await getOne('outbox',old._pendingOp);
            const same=(a,b)=>String(a??'').trim().normalize('NFKC')===String(b??'').trim().normalize('NFKC');
            const fields=['name','coop','platform','address'];
            const sameFields=fields.every(k=>same(entity[k],op?.value?.[k]));
            const sameCoords=['lat','lng'].every(k=>Math.abs(Number(entity[k])-Number(op?.value?.[k]))<.0000001);
            const sameRadius=Number(entity.radius||150)===Number(op?.value?.radius||150);
            if(op?.everSent&&Number(entity.rev)>Number(op.baseRev||0)&&sameFields&&sameCoords&&sameRadius){
              await OrgDB.rawSave('sites',{...entity,orgId:state.orgId});
              await OrgDB.rawDelete('outbox',op.id);
            }
          }
          continue;
        }
        const value={...entity,orgId:state.orgId};
        if(type==='members'&&entity.template){await TIPONAuth.unseal(entity.template,TIPONAuth.current().faceKey,'member:'+entity.id);delete value.descriptors;}
        await OrgDB.rawSave(type,value);
      }
      cursor=response.nextCursor;pages++;setText('syncLastState','Downloading approved directory: '+Math.min(pages*50,response.total)+' / '+response.total+' members.');
      if(stopped||document.hidden)throw Error('Directory download paused. Keep the app open to finish.');
    }while(cursor!==null&&pages<500);
    if(cursor!==null)throw Error('Directory is too large for one download; contact the system owner.');
    // A full successful server snapshot is authoritative. Purge locally cached
    // records that were deleted or moved outside this account's new MPC/BP/GPS
    // scope, except unsynced local operations. Never modify attendance punches.
    for(const type of ['members','sites']){
      const local=await getAll(type);
      for(const item of local){
        if(item.orgId===state.orgId&&!item._pendingOp&&!seen[type].has(item.id))
          await OrgDB.rawDelete(type,item.id);
      }
    }
    await OrgDB.rawSave('meta',{id:cfgId,version:startVersion,memberCount,enrolledCount,complete:true});
  }
  function cursorId(){return 'tp5-events:'+state.orgId+':'+state.user.id+':'+state.user.role+':v5.5.36-ledger-recovery:'+String(state.user.version||1)+':'+(state.user.siteIds||[]).join(',');}
  async function pull(){
    const id=cursorId();let saved=await getOne('meta',id),cursor=saved?.cursor||0,eventVersion=saved?.eventVersion;
    // A legacy cursor has no correction version. Re-read the ledger once to
    // reconcile edits/deletions made on another device.
    if(eventVersion===undefined&&cursor>0)cursor=0;
    for(let pages=0;pages<8;pages++){
      const r=await TIPONAPI.call({action:'poll',cursor}),remoteVersion=Number(r.eventVersion||0);
      if(eventVersion!==undefined&&Number(eventVersion)!==remoteVersion&&cursor!==0){
        cursor=0;eventVersion=remoteVersion;
        await OrgDB.rawSave('meta',{id,cursor,eventVersion,orgId:state.orgId});
        continue;
      }
      eventVersion=remoteVersion;
      for(const event of r.events||[]){
        const old=await getOne('punches',event.id),merged={...old,...event,orgId:state.orgId,cloudAck:true};
        if(event.sessionId&&event.type==='OUT')delete merged.requiresSessionResolution;
        delete merged.reviewStatus;delete merged.syncError;
        if(event.correctionRev!==undefined)delete merged.pendingCorrection;
        await OrgDB.rawSave('punches',merged);
      }
      cursor=r.cursor;await OrgDB.rawSave('meta',{id,cursor,eventVersion,orgId:state.orgId});
      state.devices=r.devices||state.devices||[];await OrgDB.rawSave('meta',{id:'tp5-deviceSnapshot',devices:state.devices,orgId:state.orgId});
      await pullCatalog(r.catalogVersion);
      if(!r.more||document.hidden||stopped)break;
    }
  }
  async function runCycle(){
    if(stopped||busy||!state.user||document.hidden){schedule();return {ok:false,error:'The app is busy, signed out, or in a hidden browser tab.'};}
    if(!navigator.onLine){message='Offline: saved locally. Automatic sync resumes when internet is available and this app is open.';render();schedule();return {ok:false,error:message};}
    busy=true;message='Connecting to organization database...';render();
    let result={ok:false,error:'Synchronization did not complete.'};
    try{
      await TIPONAuth.ensureOnline();
      if(!recoveredCompatibleOperations){
       try{
        const caps=await TIPONAPI.raw({action:'memberLocationCapabilities'});
        if(caps.memberFaceUpdate&&caps.memberTransferUpdate){
         const oldOps=await getAll('outbox');
         for(const op of oldOps.filter(o=>o.orgId===state.orgId&&o.ownerId===state.user.id&&['memberFaceUpdates','memberEdits'].includes(o.type)&&/unknown action|unsupported action|not implemented/i.test(o.error||''))){delete op.error;delete op.errorCode;op.everSent=false;await OrgDB.rawSave('outbox',op);}
         recoveredCompatibleOperations=true;
        }
       }catch(error){console.warn('Backend capability check:',error.message);}
      }
       await loadCollections();
       let uploadFailure=null;
       try{await reconcileLegacyAdminDeletes();await flush();}
       catch(error){
         // A rejected site/member operation must not prevent polling already
         // accepted attendance from other authorized devices. Preserve the error.
         if(['AUTH','ACCOUNT','DEVICE_DISABLED'].includes(String(error?.code||'')))throw error;
         uploadFailure=error;
       }
       await pull();await loadCollections();
       if(uploadFailure)console.warn('Upload needs review; central attendance read succeeded:',uploadFailure);
      lastSync=TIPONCore.phStamp(new Date().toISOString());
      const unsent=state.punches.filter(p=>p.orgId===state.orgId&&!p.cloudAck&&!p.reviewStatus&&p.deviceId===state.deviceId).length;
      const waiting=(await getAll('outbox')).filter(o=>o.orgId===state.orgId&&o.error).length+
        state.punches.filter(p=>p.reviewStatus).length+unsent;
       message=uploadFailure?'Central attendance received; an upload failed: '+String(uploadFailure.message||uploadFailure).slice(0,180):
         waiting?'Central data updated; '+waiting+' record(s) still need review. See Settings / Accounts.':
         'Central attendance updated.';attempt=uploadFailure?Math.min(attempt+1,4):0;
      result={ok:!uploadFailure,pending:waiting,error:uploadFailure?String(uploadFailure.message||uploadFailure):undefined,readOk:true};
      const remainingSites=(await getAll('outbox')).filter(op=>op.orgId===state.orgId&&
        op.ownerId===state.user?.id&&op.type==='sites'&&
        !['NEEDS_REVIEW','FORBIDDEN','CONFLICT'].includes(op.errorCode));
      siteFastRetry=remainingSites.length?siteFastRetry+1:0;
      if(state.page==='terminalLogs')renderTerminalLogs();if(state.page==='dashboard')renderDashboard();if(state.page==='records')renderRecords();if(state.page==='members')renderMembers();if(state.page==='adminSites')window.TIPONAdminSites?.render();if(state.page==='accounts'&&isAdmin())await OrgUI.renderAccounts();if(state.page==='sites')renderSites();if(state.page==='scanner'){renderTerminal();renderTerminalLogs();const ready=state.members.filter(m=>m.active!==false&&!m.deleted&&m.descriptors?.length>=3).length;if(ready)updateScanResult('Member directory ready',ready+' enrolled face template(s) loaded on this terminal. Face matches are checked against assigned office GPS.','success');}TIPONPlatforms.render();
    }catch(e){siteFastRetry=0;message=e.message;attempt=Math.min(attempt+1,4);if(['AUTH','ACCOUNT','DEVICE_DISABLED'].includes(e.code))message+=' Sign out and sign in online.';result={ok:false,error:message,code:e.code||'SYNC'};
    finally{busy=false;render();schedule();}
    return result;
  }
  // A concurrent timer/manual caller receives the same pending cycle.
  function run(){
    if(activeRun)return activeRun;
    const job=runCycle();activeRun=job;
    const clear=()=>{if(activeRun===job)activeRun=null;};
    job.then(clear,clear);
    return job;
  }
  // An Admin edit can be queued during an existing poll. Finish that poll,
  // then explicitly submit the NEW operation rather than returning BUSY.
  async function submitPendingNow(){
    const preceding=activeRun;
    if(preceding){try{await preceding;}catch(_){}}
    return run();
  }
  async function init(){
    attach('syncNow','click',kick);attach('syncRecordsNow','click',kick);
    window.addEventListener('online',kick);window.addEventListener('offline',render);document.addEventListener('visibilitychange',()=>{if(!document.hidden)kick();});render();
  }
  return {init,start,stop,kick,render,run,submitPendingNow,pauseSite,waitUntilIdle,isBusy:()=>busy,lastSuccessfulSync:()=>lastSync};
})();
