const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Core=require('../core.js'),Org=require('../org-core.js');
const source=name=>fs.readFileSync(require('node:path').join(__dirname,'..',name),'utf8');
const actor={id:'user-1',role:'registrar',coop:'Asiapro',platform:'IMG',username:'test-user'};
const event=(id,type,timestamp)=>({id,sessionId:'session-1',memberId:'TEST-1',memberName:'Synthetic Member',coop:'Asiapro',platform:'IMG',siteId:'site-1',type,timestamp,orgId:'org-1',cloudAck:true});
test('User Dashboard is denied; terminal and logs are allowed',()=>{
  assert.equal(Org.allowed(actor,'dashboard'),false);
  assert.equal(Org.allowed(actor,'scanner'),true);
  assert.equal(Org.allowed(actor,'terminalLogs'),true);
  assert.equal(Org.canUseTerminal({...actor,status:'disabled'}),false);
});
test('Time In/Out pairs across devices; duplicate and early punches are blocked',()=>{
  const input=event('in','IN','2026-10-28T23:00:00Z');
  const output={...event('out','OUT','2026-10-29T08:00:00Z'),deviceId:'other-device'};
  const row=Org.project([input,output])[0];
  assert.equal(row.timeIn,input.timestamp);assert.equal(row.timeOut,output.timestamp);
  assert.throws(()=>Core.transition([input],'TEST-1','in',Date.parse(output.timestamp)),/Already timed in/);
  assert.throws(()=>Core.transition([input],'TEST-1','out',Date.parse(input.timestamp)+1000),/90 seconds/);
  assert.equal(Core.transition([input],'TEST-1','out',Date.parse(output.timestamp)).type,'OUT');
  assert.equal(Org.project([{...input,deleted:true},{...output,deleted:true}]).length,0);
});
test('Backend correction normalizer removes duplicate directions before strict projection',()=>{
  const patch=source('backend-patch/AttendanceCorrection.gs');
  const start=patch.indexOf('function tp5ProjectAttendanceSafe_('),end=patch.indexOf('/** Apply the audited correction overlay',start);
  assert.ok(start>=0&&end>start);
  const ctx={TIPONOrgCore:{project(events){
    const keys=new Set();for(const item of events){const key=item.sessionId+'|'+item.type;assert.equal(keys.has(key),false);keys.add(key);}
    return events;
  }},Date,Map,Array,String,Number};
  vm.createContext(ctx);vm.runInContext(patch.slice(start,end),ctx);
  const events=[event('a','IN','2026-10-29T00:00:00Z'),event('b','IN','2026-10-29T00:01:00Z'),event('c','OUT','2026-10-29T08:00:00Z')];
  const projected=ctx.tp5ProjectAttendanceSafe_(events);
  assert.equal(projected.length,2);assert.equal(projected[0].id,'a');assert.equal(projected[1].id,'c');
});
test('Duplicate directions in one legacy session remain projectable for correction',()=>{
  const first={...event('in-first','IN','2026-10-29T00:00:00Z')};
  const duplicate={...event('in-duplicate','IN','2026-10-29T00:01:00Z')};
  const out1={...event('out-first','OUT','2026-10-29T08:00:00Z')};
  const out2={...event('out-duplicate','OUT','2026-10-29T08:05:00Z')};
  const row=Org.project([first,duplicate,out1,out2])[0];
  assert.equal(Date.parse(row.timeIn),Date.parse(first.timestamp));
  assert.equal(Date.parse(row.timeOut),Date.parse(out2.timestamp));
  assert.equal(row.eventIds.length,4);
});
test('Previous-day Time Out automatically starts the new Philippine day with Time In',()=>{
  const yesterdayOut=event('out-yesterday','OUT','2026-10-28T08:41:00Z');
  const now=Date.parse('2026-10-29T05:51:00Z');
  const tx=Core.transition([yesterdayOut],'TEST-1','out',now);
  assert.equal(tx.type,'IN');
  assert.equal(tx.mode,'in');
  assert.equal(tx.dateSwitched,true);
  assert.equal(tx.previousDay,'2026-10-28');
  assert.equal(tx.currentDay,'2026-10-29');
});
test('Same-day duplicate Time Out remains blocked after date-aware mode resolution',()=>{
  const todayOut=event('out-today','OUT','2026-10-29T05:30:00Z');
  assert.throws(()=>Core.transition([todayOut],'TEST-1','out',Date.parse('2026-10-29T05:51:00Z')),/Already timed out today/);
});
test('Multiple attendance sessions are allowed until eight completed duty hours',()=>{
  const day='2026-10-29',firstIn={...event('in-1','IN','2026-10-29T00:00:00Z'),sessionId:'session-1'},
    firstOut={...event('out-1','OUT','2026-10-29T04:00:00Z'),sessionId:'session-1'},
    secondIn={...event('in-2','IN','2026-10-29T05:00:00Z'),sessionId:'session-2'},
    secondOut={...event('out-2','OUT','2026-10-29T09:00:00Z'),sessionId:'session-2'},
    punches=[firstIn,firstOut,secondIn,secondOut];
  assert.equal(Core.workedDurationForDay(punches,'TEST-1',day),8*60*60*1000);
  assert.throws(()=>Core.transition(punches,'TEST-1','in',Date.parse('2026-10-29T09:02:00Z')),/8-hour duty limit/);
  assert.equal(Core.transition([firstIn,firstOut],'TEST-1','in',Date.parse('2026-10-29T04:02:00Z')).type,'IN');
});
test('Open sessions from other devices prevent duplicate Time In and choose one Time Out session',()=>{
  const first={...event('in-device-a','IN','2026-10-29T00:00:00Z'),sessionId:'session-a',deviceId:'device-a'},
    second={...event('in-device-b','IN','2026-10-29T00:01:00Z'),sessionId:'session-b',deviceId:'device-b'};
  assert.throws(()=>Core.transition([first,second],'TEST-1','in',Date.parse('2026-10-29T00:05:00Z')),/Already timed in/);
  assert.equal(Core.transition([first,second],'TEST-1','out',Date.parse('2026-10-29T02:00:00Z')).last.sessionId,'session-b');
});
test('Open overnight Time In from the previous Philippine date can still be closed with Time Out',()=>{
  const overnightIn=event('in-overnight','IN','2026-10-28T23:00:00Z');
  const tx=Core.transition([overnightIn],'TEST-1','out',Date.parse('2026-10-29T08:00:00Z'));
  assert.equal(tx.type,'OUT');
  assert.equal(tx.mode,'out');
  assert.equal(tx.dateSwitched,false);
});
test('Open-session attendance correction synchronizes a synthetic Time Out event',async()=>{
  const input={...event('open-in','IN','2026-10-28T01:00:00Z'),sessionId:'session-1'};
  const punches=[input];
  const outbox=[{id:'open-correction',type:'attendanceCorrections',orgId:'org-1',ownerId:actor.id,baseRev:0,value:{
    sessionId:'session-1',eventIds:['open-in'],reason:'Correct open shift',
    changes:{timeIn:'2026-10-28T01:00:00Z',timeOut:'2026-10-28T08:00:00Z'},
    original:{timeIn:input.timestamp,timeOut:''}
  }}];
  const tables={punches,outbox};
  const ctx={console,setTimeout,clearTimeout,Date,Map,Set,navigator:{onLine:true},
    state:{user:actor,orgId:'org-1',deviceId:'device',punches},$:()=>null,setText:()=>{},TIPONOrgCore:Org,
    TIPONAuth:{ensureOnline:async()=> 'token'},
    TIPONGitHubBridge:{request:async()=>({ok:true,protocol:Org.PROTOCOL,correction:{
      sessionId:'session-1',timeIn:'2026-10-28T01:00:00Z',timeOut:'2026-10-28T08:00:00Z',createdOut:true,rev:1
    }})},
    getAll:async name=>{assert.ok(tables[name],name);return tables[name];},
    getOne:async(name,id)=>{assert.ok(tables[name],'Invalid store '+name);return tables[name].find(x=>x.id===id);},
    OrgDB:{rawSave:async(name,item)=>{const i=tables[name].findIndex(x=>x.id===item.id);if(i>=0)tables[name][i]=item;else tables[name].push(item);},
      rawDelete:async(name,id)=>{const i=tables[name].findIndex(x=>x.id===id);if(i>=0)tables[name].splice(i,1);}}
  };
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(source('sync.js').replace('return {init,start,stop,kick','return {__flush:flush,init,start,stop,kick'),ctx);
  await ctx.TIPONSync.__flush();
  assert.equal(outbox.length,0);
  const output=punches.find(p=>p.type==='OUT');
  assert.ok(output);
  assert.equal(output.id,'attendance-correction-out:session-1');
  assert.equal(output.timestamp,'2026-10-28T08:00:00Z');
  assert.equal(output.cloudAck,true);
});
test('Synced attendance correction reads the punches store and reaches the server',async()=>{
  const punches=[event('in','IN','2026-10-28T23:00:00Z'),event('out','OUT','2026-10-29T08:00:00Z')];
  const outbox=[{id:'operation',type:'attendanceCorrections',orgId:'org-1',ownerId:actor.id,baseRev:0,value:{sessionId:'session-1',eventIds:['in','out'],reason:'Correct test clock',changes:{timeIn:'2026-10-28T23:05:00Z'}}}];
  const tables={punches,outbox};const calls=[];
  const ctx={console,setTimeout,clearTimeout,Date,Map,Set,navigator:{onLine:true},state:{user:actor,orgId:'org-1',deviceId:'device',punches},$:()=>null,setText:()=>{},TIPONOrgCore:Org,TIPONAuth:{ensureOnline:async()=> 'token'},TIPONGitHubBridge:{request:async payload=>{
    calls.push(payload);return {ok:true,protocol:Org.PROTOCOL,correction:{sessionId:'session-1',timeIn:'2026-10-28T23:05:00Z',timeOut:'2026-10-29T08:00:00Z',rev:1}};
  }},getAll:async name=>{assert.ok(tables[name],name);return tables[name];},getOne:async(name,id)=>{assert.ok(tables[name],'Invalid store '+name);return tables[name].find(x=>x.id===id);},OrgDB:{rawSave:async(name,item)=>{const i=tables[name].findIndex(x=>x.id===item.id);if(i>=0)tables[name][i]=item;else tables[name].push(item);},rawDelete:async(name,id)=>{const i=tables[name].findIndex(x=>x.id===id);if(i>=0)tables[name].splice(i,1);}}};
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(source('sync.js').replace('return {init,start,stop,kick','return {__flush:flush,init,start,stop,kick'),ctx);
  await ctx.TIPONSync.__flush();
  assert.equal(calls.length,1);assert.equal(calls[0].action,'attendanceCorrect');assert.equal(outbox.length,0);
  assert.equal(punches[0].timestamp,'2026-10-28T23:05:00Z');assert.equal(punches[0].correctionRev,1);
});
function backend(){
  const members=[{id:'TEST-1',name:'Synthetic Member',coop:'Asiapro',platform:'IMG',rev:2,template:{alg:'AES-GCM',iv:'existing',data:'encrypted'},active:true,siteIds:['site-1']}];
  const sites=[{id:'site-1',coop:'Asiapro',platform:'IMG'},{id:'site-2',coop:'Worklife',platform:'OCG'}];
  const writes=[],audits=[];
  const ctx={Date,Map,Set,Number,TIPONOrgCore:Org,tp5Must_:(ok,message,code)=>{if(!ok)throw Object.assign(Error(message),{code});},tp5Find_:(type,id)=>(type==='members'?members:sites).find(x=>x.id===id),tp5Read_:type=>type==='sites'?sites:members,tp5ResolvePlatform_:x=>x,tp5SameLocations_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),tp5OldLocations_:x=>x.siteIds,tp5MemberOpenSession_:()=>false,tp5Now_:()=>new Date().toISOString(),tp5Safe_:x=>x,tp5Reply_:x=>x,tp5Put_:(...args)=>writes.push(args),tp5Bump_:()=>3,tp5RefreshMemberDirectory_:()=>{},tp5Audit_:(...args)=>audits.push(args),tp5MemberLocationResult_:(actor,old,next,action)=>{writes.push(next);audits.push(action);return {member:next};},tp5LocationIds_:(actor,coop,platform,ids)=>{assert.ok(ids.length);return ids;},tp5Admin_:actor=>{if(actor.role!=='admin')throw Object.assign(Error('Administrator required.'),{code:'FORBIDDEN'});},tp5AllEvents_:()=>[]};
  vm.createContext(ctx);vm.runInContext(source('backend-patch/MemberFaceTransfer.gs'),ctx);vm.runInContext(source('backend-patch/MemberLocationEdit.gs'),ctx);return {ctx,members,writes,audits};
}
function attendanceCorrectionBackend(rawEvents){
  const operations=[],audits=[],projections=[],properties=new Map();
  const ctx={Date,Map,Set,Number,TIPONOrgCore:Org,SpreadsheetApp:{flush:()=>{}},
    tp5Must_:(ok,message,code)=>{if(!ok)throw Object.assign(Error(message),{code});},
    tp5Read_:type=>type==='operations'?operations:[],
    tp5Find_:(type,id)=>type==='operations'?operations.find(x=>x.id===id)||null:null,
    tp5AllEvents_:()=>rawEvents,
    tp5Now_:()=>new Date().toISOString(),
    tp5Put_:(type,value)=>{if(type==='operations'){const i=operations.findIndex(x=>x.id===value.id);if(i>=0)operations[i]=value;else operations.push(value);}},
    tp5Props_:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value)}),
    tp5Bump_:()=>{},tp5Audit_:(...args)=>audits.push(args),
    tp5WriteProjection_:row=>projections.push(row),
    tp5ReportSheet_:()=>({getRange:()=>({clearContent:()=>{}})}),
    tp5Reply_:value=>value
  };
  vm.createContext(ctx);vm.runInContext(source('backend-patch/AttendanceCorrection.gs'),ctx);
  return {ctx,operations,audits,projections,rawEvents};
}
test('Attendance correction can add a missing Time Out and synchronizes the corrected session view',()=>{
  const input={...event('open-in','IN','2026-10-28T01:00:00Z'),sessionId:'session-1'};
  const fixture=attendanceCorrectionBackend([input]);
  const reply=fixture.ctx.tp5AttendanceCorrect_(actor,{sessionId:'session-1',baseRev:0,
    changes:{timeIn:'2026-10-28T01:00:00Z',timeOut:'2026-10-28T08:00:00Z'},delete:false,reason:'Fix open shift'});
  assert.equal(reply.correction.createdOut,true);
  const corrected=fixture.ctx.tp5ApplyAttendanceCorrections_(fixture.rawEvents);
  assert.equal(corrected.length,2);
  assert.equal(corrected[1].id,'attendance-correction-out:session-1');
  assert.equal(corrected[1].type,'OUT');
  assert.equal(Org.project(corrected.filter(e=>!e.deleted))[0].timeOut,'2026-10-28T08:00:00Z');
  assert.ok(fixture.projections.length);
});
test('Attendance correction can delete an open session without erasing the raw event',()=>{
  const input={...event('open-in','IN','2026-10-28T01:00:00Z'),sessionId:'session-1'};
  const fixture=attendanceCorrectionBackend([input]);
  const reply=fixture.ctx.tp5AttendanceCorrect_(actor,{sessionId:'session-1',baseRev:0,changes:{},delete:true,reason:'Remove bad punch'});
  assert.equal(reply.correction.deleted,true);
  assert.equal(fixture.rawEvents.length,1);
  assert.equal(fixture.ctx.tp5ApplyAttendanceCorrections_(fixture.rawEvents).filter(e=>!e.deleted).length,0);
});
test('Absenteeism with blank filters includes all history and flags open sessions and scheduled AWOL',()=>{
  const members=[
    {id:'M1',name:'Open Member',coop:'Asiapro',active:true,template:{},createdAt:'2026-10-26T00:00:00Z',siteId:'site-1'},
    {id:'M2',name:'Scheduled Member',coop:'Asiapro',active:true,template:{},createdAt:'2026-10-27T00:00:00Z',siteId:'site-1',requiresSchedule:true}
  ];
  const sites=[{id:'site-1',name:'Test Location',coop:'Asiapro',platform:'IMG'}];
  const events=[
    {...event('in-1','IN','2026-10-26T01:00:00Z'),memberId:'M1',sessionId:'s1'},
    {...event('out-1','OUT','2026-10-26T08:00:00Z'),memberId:'M1',sessionId:'s1'},
    {...event('in-open','IN','2026-10-28T01:00:00Z'),memberId:'M1',sessionId:'s2'}
  ];
  const ctx={Date,Map,Set,Number,Math,Intl,state:{user:{role:'admin'}},console,
    TIPONOrgCore:{scheduled:(member,site,day)=>member.requiresSchedule?{kind:'REQUIRED',end:Date.parse(day+'T00:00:00Z')}:{kind:'UNSCHEDULED'}},
    document:{readyState:'complete',getElementById:()=>null}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source('absenteeism.js'),ctx);
  const data=ctx.TIPONAbsenteeism.compute(members,sites,events,[],'','',Date.parse('2026-10-29T12:00:00Z'),'');
  assert.equal(JSON.stringify(data.rows.map(row=>row.day)),JSON.stringify(['2026-10-26','2026-10-27','2026-10-28','2026-10-29']));
  assert.equal(data.summary.open,1);
  assert.equal(data.summary.awolCount,1);
  assert.ok(data.rows[2].openSessions.some(session=>session.member.id==='M1'));
  assert.equal(data.rows[3].openSessions.length,0);
  assert.ok(data.rows[3].awolMembers.some(member=>member.id==='M2'));
});
test('User transfers an in-scope member to valid selected Cooperative/BP without changing face data',()=>{
  const {ctx,members}=backend();const old=members[0];
  const r=ctx.tp5TransferUpdate_(actor,{memberId:old.id,baseRev:2,changes:{name:old.name,coop:'Worklife',platform:'OCG',siteIds:['site-2']}});
  assert.equal(r.member.coop,'Worklife');assert.equal(r.member.rev,3);assert.equal(r.member.template,old.template);
  assert.throws(()=>ctx.tp5TransferUpdate_({...actor,coop:'Worklife'},{memberId:old.id,baseRev:2,changes:{}}),/outside your approved scope/);
  assert.throws(()=>ctx.tp5TransferUpdate_(actor,{memberId:old.id,baseRev:1,changes:{}}),/Member changed/);
  assert.throws(()=>ctx.tp5TransferUpdate_(actor,{memberId:old.id,baseRev:2,changes:{name:old.name,coop:'Worklife',platform:'OCG',siteIds:[]}}),/Assigned Work Locations/);
});
test('Legacy member transfer route saves an existing member work schedule without changing face data',()=>{
  const {ctx,members}=backend(),old=members[0];
  const workSchedule={enabled:true,days:[1,2,3,4,5],start:'07:00',end:'16:00',grace:5};
  const r=ctx.tp5TransferUpdate_(actor,{memberId:old.id,baseRev:2,changes:{name:old.name,memberNumber:old.id,coop:'Asiapro',platform:'IMG',siteIds:['site-1'],workSchedule}});
  assert.deepEqual(JSON.parse(JSON.stringify(r.member.workSchedule)),workSchedule);
  assert.equal(r.member.template,old.template);
});
test('Existing-member face update validates role, revision, consent, encrypted template and audit',()=>{
  const {ctx,members,writes,audits}=backend();const old=members[0];
  const q={memberId:old.id,baseRev:2,changes:{name:old.name,coop:old.coop,platform:old.platform,siteIds:['site-1'],template:{alg:'AES-GCM',iv:'iv',data:'new-encrypted'},consentAt:new Date().toISOString()}};
  assert.throws(()=>ctx.tp5MemberFaceUpdate_({...actor,role:'kiosk'},q),/enrollment User/);
  assert.throws(()=>ctx.tp5MemberFaceUpdate_(actor,{...q,baseRev:1}),/Member changed/);
  assert.throws(()=>ctx.tp5MemberFaceUpdate_(actor,{...q,changes:{...q.changes,consentAt:'invalid'}}),/consent/);
  const result=ctx.tp5MemberFaceUpdate_(actor,q);assert.equal(result.member.faceEnrollmentStatus,'enrolled');assert.equal(result.member.enrolledBy,actor.id);assert.equal(writes.length,1);assert.equal(audits.length,1);
});
test('No duplicate Edit or Full Screen handlers; three-capture control and required picker exist',()=>{
  const app=source('app.js'),html=source('index.html');
  assert.equal((app.match(/(?:async )?function editAttendanceFromLog\(/g)||[]).length,1);
  assert.equal((app.match(/attach\('kioskFullscreen','click'/g)||[]).length,0);
  assert.match(html,/id="memberSiteSummary"[^>]+aria-required="true"/);
  assert.match(html,/id="captureEnrollmentSample"/);
  assert.match(app,/if\(!siteIds.length\)/);
});
test('Fully closed eyes advance the blink challenge; a stationary face cannot pass',()=>{
  const ctx={console,Date,Math,Number,Array,crypto:{getRandomValues:a=>{a[0]=0;return a;}},state:{},navigator:{onLine:true},$:()=>null,speakTerminal:()=>{},loadFaceModels:async()=>{},startScanner:async()=>{},stopScanner:async()=>{},beginEnrollment:async()=>{},scanTick:()=>{},enrollTick:()=>{},blinkRatio:f=>f.ratio};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source('liveness-guard.js'),ctx);
  const face=(ratio,yaw=0)=>{const positions=Array.from({length:68},()=>({x:0,y:0}));positions[36]={x:0,y:0};positions[45]={x:100,y:0};positions[30]={x:50+yaw*100,y:20};return {ratio,landmarks:{positions}};};
  const c=ctx.TIPONLiveness.challenge(),t=c.started;
  ctx.TIPONLiveness.advance(c,face(.25),t+100);ctx.TIPONLiveness.advance(c,face(.25),t+250);
  ctx.TIPONLiveness.advance(c,face(.02),t+450);assert.equal(c.closed,true);
  ctx.TIPONLiveness.advance(c,face(.25),t+750);assert.equal(c.step,1);
  ctx.TIPONLiveness.advance(c,face(.25),t+900);ctx.TIPONLiveness.advance(c,face(.25),t+1050);
  assert.equal(ctx.TIPONLiveness.advance(c,face(.25,.16),t+1300).ok,true);
  const staticFace=ctx.TIPONLiveness.challenge();for(let i=1;i<=20;i++)ctx.TIPONLiveness.advance(staticFace,face(.25),staticFace.started+i*150);
  assert.equal(staticFace.passed,false);
});
test('Attendance capture restores Oct 28 9 AM flow; enrollment liveness stays separate',()=>{
  const app=source('app.js'),liveness=source('liveness-guard.js'),html=source('index.html');
  assert.match(app,/const SCAN_DELAY_MS=650;/);
  const start=app.indexOf('async function scanTick(){'),end=app.indexOf('function canQueueUnresolvedTimeOut(');
  assert.ok(start>=0&&end>start);
  const scanner=app.slice(start,end);
  assert.match(scanner,/if\(state\.scanCandidateCount>=2\)/);
  assert.match(scanner,/await recordRecognizedFace\(member,found\.best\.distance\)/);
  assert.doesNotMatch(scanner,/blinkChallenge|livenessProof/);
  assert.doesNotMatch(liveness,/scanTick=async function\(\)/);
  assert.match(liveness,/state\.enrollLiveness=challenge\(\)/);
  const record=app.slice(app.indexOf('async function recordRecognizedFace('),app.indexOf('async function recordRecognizedFace(')+500);
  assert.doesNotMatch(record,/Live Verification Required|const proof/);
  assert.match(html,/liveness-guard\.js\?v=\d+/);
});
test('Attendance reuses a recent accurate GPS watch fix without waiting for another position',async()=>{
  const app=source('app.js'),start=app.indexOf('function usableAttendanceGPS('),end=app.indexOf('function startGPSWatch(){',start);
  assert.ok(start>=0&&end>start);
  const cached={latitude:14.575347,longitude:121.063125,accuracy:68,timestamp:Date.now()-5000};
  let calls=0;
  const ctx={Date,Promise,Error,Number,Math,GPS_MAX_ACCURACY:80,state:{lastGPS:cached,page:'scanner'},
    navigator:{geolocation:{getCurrentPosition(){calls++;}}},renderTerminal:()=>{}};
  vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
  const gps=await ctx.readGPS();
  assert.equal(gps.latitude,cached.latitude);assert.equal(gps.longitude,cached.longitude);
  assert.equal(gps.accuracy,68);assert.equal(calls,0);
});
test('Attendance GPS refresh waits at most eight seconds and falls back to a recent accurate watch fix',async()=>{
  const app=source('app.js'),start=app.indexOf('function usableAttendanceGPS('),end=app.indexOf('function startGPSWatch(){',start);
  const cached={latitude:14.575347,longitude:121.063125,accuracy:68,timestamp:Date.now()-27000};
  let options;
  const ctx={Date,Promise,Error,Number,Math,GPS_MAX_ACCURACY:80,state:{lastGPS:cached,page:'scanner'},
    navigator:{geolocation:{getCurrentPosition:(success,failure,opts)=>{options=opts;failure({code:3});}}},renderTerminal:()=>{}};
  vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
  const gps=await ctx.readGPS();
  assert.equal(options.timeout,8000);assert.equal(options.maximumAge,5000);
  assert.equal(gps.latitude,cached.latitude);assert.equal(gps.accuracy,68);
});
test('Attendance GPS refuses an expired fallback when fresh location acquisition times out',async()=>{
  const app=source('app.js'),start=app.indexOf('function usableAttendanceGPS('),end=app.indexOf('function startGPSWatch(){',start);
  const cached={latitude:14.575347,longitude:121.063125,accuracy:68,timestamp:Date.now()-60000};
  const ctx={Date,Promise,Error,Number,Math,GPS_MAX_ACCURACY:80,state:{lastGPS:cached,page:'scanner'},
    navigator:{geolocation:{getCurrentPosition:(success,failure)=>failure({code:3})}},renderTerminal:()=>{}};
  vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
  await assert.rejects(ctx.readGPS(),/GPS timed out/);
});
test('Attendance editor validates real dates and preserves Philippine time and overnight dates',()=>{
  const app=source('app.js'),code=app.slice(app.indexOf('function attendanceInputStamp('),app.indexOf('async function submitAttendanceEdit('));
  const ctx={TIPONCore:Core,Date,Number,Error};vm.createContext(ctx);vm.runInContext(code,ctx);
  assert.equal(ctx.attendanceInputStamp('2026-10-29','06:15:23'),'2026-10-28T22:15:23.000Z');
  assert.throws(()=>ctx.attendanceInputStamp('2026-02-31','06:15'),/calendar date/);
  assert.throws(()=>ctx.attendanceInputStamp('2026-10-29','25:15'),/calendar date/);
  assert.equal(Date.parse(ctx.attendanceInputStamp('2026-10-30','06:00'))-Date.parse(ctx.attendanceInputStamp('2026-10-29','22:00')),8*3600000);
  assert.doesNotMatch(app.slice(app.indexOf('async function saveAttendanceCorrection('),app.indexOf('async function exportTerminalLogs(')),/prompt\(/);
  assert.doesNotMatch(app,/This session already has a pending correction/);
  assert.match(app,/String\(item\.value\?\.sessionId\)===sessionId/);
  assert.doesNotMatch(app,/function openAttendanceReview|function retryAttendanceReview/);
  assert.doesNotMatch(source('index.html'),/attendanceReviewDialog|data-attendance-review/);
});
test('Published assets share one release version and pagination controls cannot overflow',()=>{
  const html=source('index.html'),sw=source('sw.js'),release=JSON.parse(source('release.json'));
  assert.match(release.version,/^\d+\.\d+\.\d+$/);
  const [major,minor,patch]=release.version.split('.'),assetVersion=major+minor+patch;
  assert.match(sw,new RegExp(`const VERSION='${release.version.replaceAll('.','\\.')}'`));
  assert.match(sw,new RegExp(`tipon-face-shell-v${release.version.replaceAll('.','\\.')}\\-github-only`));
  assert.match(html,new RegExp(`core\\.js\\?v=${assetVersion}`));
  assert.match(html,new RegExp(`app\\.js\\?v=${assetVersion}`));
  assert.match(html,new RegExp(`liveness-guard\\.js\\?v=${assetVersion}`));
  assert.match(source('app.js'),/const MATCH_LIMIT=\.47;/);
  assert.match(html,/id="captureEnrollmentSample"/);
  assert.match(html,/id="memberSiteSummary"[^>]+aria-required="true"/);
  assert.doesNotMatch(html,/Assigned Work Location <span class="field-optional">\(Optional\)/);
  assert.doesNotMatch(source('app.js'),/prompt\(['"]Reason for deleting this attendance session/);
  assert.ok(html.includes(`style.css?v=${assetVersion}`));
  assert.ok(html.includes(`polish.css?v=${assetVersion}`));
  assert.match(source('polish.css'),/\.admin-list-pager-actions/);
  assert.ok(source('polish.css').includes('#adminMemberDialog input'));
  const reviewStart=html.indexOf('<div class="ab-review-heading">'),reviewEnd=html.indexOf('</section>',reviewStart),review=html.slice(reviewStart,reviewEnd);
  assert.equal(review.includes('<th>Action</th>'),false);
  assert.equal(review.includes('<th>Date</th>'),true);
  assert.match(review,/id="absReviewPrev"/);
  assert.match(review,/id="absReviewNext"/);
  assert.match(source('app.js'),/const SCAN_DELAY_MS=650;/);
  assert.match(sw,/clients\.matchAll\(\{type:'window',includeUncontrolled:true\}\)/);
  assert.match(sw,/client\.navigate\(client\.url\)/);
  assert.match(sw,/url\.pathname\.endsWith\('\/update\.html'\)/);
  assert.doesNotMatch(source('app.js'),/disabled title="Complete Time Out before deleting this session\."/);
  assert.match(source('app.js'),/changes\.timeOut=attendanceInputStamp\(outDate,outTime\)/);
});
test('Member dropdown includes all known Business Platforms and remains editable for Users',()=>{
  const controls={memberCoop:{value:'Asiapro'},siteCoop:{value:'Asiapro'},memberPlatform:{value:'AP Cons',innerHTML:'',disabled:false},sitePlatform:{value:'AP Cons',innerHTML:'',disabled:false}};
  const ctx={TIPONOrgCore:Org,state:{user:{...actor,platform:'AP Cons'},platforms:['CUSTOM'],sites:[],members:[]},$:id=>controls[id],esc:x=>x,console};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source('platforms.js'),ctx);
  ctx.TIPONPlatforms.fill('memberPlatform','AP Cons');assert.equal(controls.memberPlatform.disabled,false);
  for(const code of ['ATS','IMG','AP Cons','MSG-NW'])assert.ok(controls.memberPlatform.innerHTML.includes('value="'+code+'"'));
  for(const code of ['GAK','MSG-SM','MSG-NM','OCG','CUSTOM'])assert.ok(!controls.memberPlatform.innerHTML.includes('value="'+code+'"'));
  ctx.TIPONPlatforms.fill('sitePlatform','AP Cons');assert.equal(controls.sitePlatform.disabled,true);
});
test('New enrollment opens with Cooperative/BP placeholders and schedule fields appear for Add and Edit',()=>{
  const app=source('app.js'),org=source('organization.js'),html=source('index.html');
  assert.ok(app.includes("$('memberCoop').value=member?.coop||'';"));
  assert.ok(app.includes("TIPONPlatforms.fillScoped('memberCoop','memberPlatform',member?.platform||'');"));
  assert.ok(org.includes("$('memberCoop').value=member?.coop||'';"));
  assert.ok(org.includes("TIPONPlatforms.fillScoped('memberCoop','memberPlatform',member?.platform||'');"));
  for(const id of ['memberWorkDays','memberWorkStart','memberWorkEnd','adminMemberWorkDays','adminMemberWorkStart','adminMemberWorkEnd'])assert.ok(html.includes('id="'+id+'"'));
  assert.match(app,/workSchedule=readMemberWorkSchedule\(\)/);
  assert.match(source('admin-member-editor.js'),/workSchedule=readAdminWorkSchedule\(\)/);
});
test('Editable Member ID preserves the internal record/template key and rejects duplicates',()=>{
  const {ctx,members}=backend();members.push({id:'other',memberNumber:'BUSINESS-2'});
  const result=ctx.tp5TransferUpdate_(actor,{memberId:'TEST-1',baseRev:2,changes:{name:'Synthetic Member',memberNumber:'BUSINESS-1',coop:'Asiapro',platform:'IMG',siteIds:['site-1']}});
  assert.equal(result.member.id,'TEST-1');assert.equal(result.member.memberNumber,'BUSINESS-1');assert.equal(result.member.template,members[0].template);
  assert.throws(()=>ctx.tp5TransferUpdate_(actor,{memberId:'TEST-1',baseRev:2,changes:{name:'Synthetic Member',memberNumber:'business-2',coop:'Asiapro',platform:'IMG',siteIds:['site-1']}}),/already registered/);
});

test('Member Work Schedule validator normalizes days and persists Google Sheets columns',()=>{
 const {ctx,members}=backend();
 const schedule=ctx.tp5MemberWorkScheduleV2_({enabled:true,days:[5,1,3],start:'07:00',end:'16:00',grace:5},null);
 assert.deepEqual(JSON.parse(JSON.stringify(schedule)),{enabled:true,days:[1,3,5],start:'07:00',end:'16:00',grace:5});
 const row={...members[0],workSchedule:schedule};
 ctx.tp5ApplyMemberScheduleColumnsV2_(row,schedule);
 assert.equal(row.workDays,'1,3,5');assert.equal(row.workStart,'07:00');assert.equal(row.workEnd,'16:00');
 assert.equal(row.workGrace,5);assert.equal(row.workScheduleText,'1,3,5 07:00-16:00');
 assert.throws(()=>ctx.tp5MemberWorkScheduleV2_({days:[8],start:'07:00',end:'16:00'},null),/valid work days/);
 assert.throws(()=>ctx.tp5MemberWorkScheduleV2_({days:[1],start:'29:99',end:'16:00'},null),/valid Work Schedule/);
});
test('Member ID can be changed by Admin and User without changing the internal member key',()=>{
  const {ctx,members}=backend(),old=members[0];
  const userResult=ctx.tp5UserMemberTransferUpdateV2_(actor,{memberId:old.id,baseRev:2,changes:{memberNumber:'BUSINESS-1',name:old.name,coop:'Worklife',platform:'OCG',siteIds:['site-2']}});
  assert.equal(userResult.member.id,'TEST-1');assert.equal(userResult.member.memberNumber,'BUSINESS-1');assert.equal(userResult.member.template,old.template);
  const {ctx:adminCtx,members:adminMembers}=backend();
  const adminResult=adminCtx.tp5AdminMemberUpdateV2_({id:'admin-1',role:'admin',username:'admin'},{memberId:'TEST-1',baseRev:2,changes:{memberNumber:'ADMIN-1',name:adminMembers[0].name,coop:'Asiapro',platform:'IMG',siteIds:['site-1']}});
  assert.equal(adminResult.member.id,'TEST-1');assert.equal(adminResult.member.memberNumber,'ADMIN-1');
});
test('Face re-enrollment validates and persists a unique Member ID with the new encrypted template',()=>{
  const {ctx,members}=backend();members.push({id:'other',memberNumber:'BUSINESS-2'});
  assert.throws(()=>ctx.tp5UserMemberTransferUpdateV2_(actor,{memberId:'TEST-1',baseRev:2,changes:{memberNumber:'business-2',name:members[0].name,coop:'Asiapro',platform:'IMG',siteIds:['site-1']}}),/already registered/);
  const {ctx:faceCtx,members:faceMembers}=backend(),old=faceMembers[0],template={alg:'AES-GCM',iv:'new-iv-123456789',data:'new-encrypted-template'};
  const result=faceCtx.tp5UserMemberFaceUpdateV2_(actor,{memberId:old.id,baseRev:2,changes:{memberNumber:'FACE-1',name:old.name,coop:old.coop,platform:old.platform,siteIds:['site-1'],template,consentAt:new Date().toISOString()}});
  assert.equal(result.member.memberNumber,'FACE-1');assert.equal(result.member.id,'TEST-1');assert.equal(result.member.template.data,template.data);assert.equal(result.member.enrolledBy,actor.id);
});
test('Admin/User edit routing and transient Time Out fallback are guarded',()=>{
  const app=source('app.js'),sync=source('sync.js');
  assert.ok(app.includes("const action=scheduleOnly?'memberWorkScheduleUpdateV2':isAdmin()?'adminMemberUpdateV2':'memberTransferUpdateV2'"));
  assert.ok(sync.includes("actor.role==='admin'?'adminMemberUpdateV2':'memberTransferUpdateV2'"));
  assert.ok(sync.includes('delete routeChanges.enrolledBy'));
  assert.ok(!app.includes('if(!refreshed?.readOk)throw Error('));
  const start=app.indexOf('function canQueueUnresolvedTimeOut('),end=app.indexOf('async function recordRecognizedFace(');
  assert.ok(start>=0&&end>start);
  const ctx={String};vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
  assert.equal(ctx.canQueueUnresolvedTimeOut('out',true,false,false,Error('No Time In on this device')),true);
  assert.equal(ctx.canQueueUnresolvedTimeOut('out',false,false,false,Error('Already timed out')),false);
  assert.equal(ctx.canQueueUnresolvedTimeOut('out',true,true,false,Error('No Time In on this device')),false);
  assert.equal(ctx.canQueueUnresolvedTimeOut('out',true,false,true,Error('No Time In on this device')),true);
  assert.equal(ctx.canQueueUnresolvedTimeOut('out',true,false,false,Error('Unauthorized')),false);
});

test('Three manual re-enrollment captures trigger one immediate save with a fresh proof',async()=>{
  let capture,saves=0;const button={dataset:{},addEventListener:(name,fn)=>capture=fn},nodes={captureEnrollmentSample:button,enrollProgress:{style:{}},retryEnrollment:{}};
  const ctx={console,Date,Math,Number,Array,crypto:{getRandomValues:a=>{a[0]=0;return a;}},state:{enrollActive:true,enrollCollected:[],editMember:{id:'STABLE-KEY',template:{}}},navigator:{onLine:true},$:id=>nodes[id],speakTerminal:()=>{},loadFaceModels:async()=>{},startScanner:async()=>{},stopScanner:async()=>{},beginEnrollment:async()=>{},scanTick:()=>{},enrollTick:()=>{},blinkRatio:f=>f.ratio,enrollmentMemberKey:()=>'STABLE-KEY',findEnrolledFaceConflict:()=>false,euclidean:(a,b)=>Math.sqrt(a.reduce((n,x,i)=>n+(x-b[i])**2,0)),setText:()=>{},playTerminalSound:()=>{},showToast:()=>{},finishEnrollment:async()=>{},saveMemberForm:async()=>{saves++;}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source('liveness-guard.js'),ctx);
  for(let i=0;i<3;i++){ctx.state.enrollReadyDescriptor=Array(128).fill(.1);ctx.state.enrollReadyAt=Date.now();ctx.state.enrollLiveness={passed:true};await capture();}
  assert.equal(ctx.state.pendingDescriptors.length,3);assert.equal(ctx.state.enrollmentProof.memberId,'STABLE-KEY');assert.equal(saves,1);
});

test('Unified Attendance Logs nav and read-only timesheet estimates retain safe behavior',()=>{
 const html=source('index.html'),sync=source('sync.js'),org=source('organization.js');
 assert.equal((html.match(/data-page="records"/g)||[]).length,0);
 assert.equal((html.match(/data-page="terminalLogs"/g)||[]).length,2);
 assert.doesNotMatch(html,/id="terminalLogRecover"/);
 assert.equal(Org.allowed({role:'admin'},'terminalLogs'),true);
 assert.equal(Org.canUseTerminal({role:'admin'}),false);
 assert.doesNotMatch(html,/data-page="terminalLogs" data-terminal-only/);
 assert.doesNotMatch(html,/<th>Sync Status<\/th>/);
 assert.match(html,/id="timesheetFrom"/);
 assert.match(html,/id="timesheetTo"/);
 assert.match(html,/id="timesheetSearch"/);
 assert.doesNotMatch(html,/id="timesheetRound"/);
 assert.doesNotMatch(html,/id="timesheetOT"/);
 assert.doesNotMatch(source('auth.js'),/await showPage\('dashboard'\)/);
 assert.match(html,/<th>Work Location<\/th><th>Actions<\/th>/);
 assert.match(org,/if\(page==='records'\)page='terminalLogs'/);
 assert.match(sync,/async function recoverAttendance\(\)/);
 const segment=sync.slice(sync.indexOf('async function recoverAttendance()'),sync.indexOf('return {init,start,stop,kick',sync.indexOf('async function recoverAttendance()')));
 assert.match(segment,/cursor:0/);
 assert.doesNotMatch(segment,/rawDelete|objectStore\([^)]*\)\.clear|replaceDB/);
 const ctx={window:{addEventListener(){}},document:{addEventListener(){}},
  TIPONCore:{phStamp(value){return new Date(Date.parse(value)+28800000).toISOString().slice(0,19).replace('T',' ');}},
  Date,Map,Math,Number,String,Object,Array};
 vm.createContext(ctx);
 vm.runInContext(source('timesheet-preview.js'),ctx);
 const rows=[
  {memberId:'TEST-1',memberName:'Synthetic Member',timeIn:'2026-10-29T00:00:00Z',timeOut:'2026-10-29T05:00:00Z'},
  {memberId:'TEST-1',memberName:'Synthetic Member',timeIn:'2026-10-29T06:00:00Z',timeOut:'2026-10-29T10:15:00Z'},
  {memberId:'TEST-2',memberName:'Other Member',timeIn:'2026-10-29T10:00:00Z',timeOut:''}
 ];
 const result=ctx.window.TIPONTimesheet.summarize(rows,15,8);
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].minutes,555);
 assert.equal(result.rows[0].roundedMinutes,555);
 assert.equal(result.rows[0].potentialOTMinutes,75);
 assert.equal(result.excluded,1);
 assert.doesNotMatch(source('timesheet-preview.js'),/rawSave|saveOne|replaceDB|deleteOne/);
});

test('Admin and User Attendance Logs sort newest-to-oldest before pagination, respecting Manila dates and scope',()=>{
 const app=source('app.js'),start=app.indexOf('function projectTerminalLogEvents('),
  end=app.indexOf('function canCorrectAttendance(',start);
 assert.ok(start>=0&&end>start,'shared Attendance Logs projection and sorting are available');
 const stamps=[
  '2026-10-28T00:00:00Z','2026-10-28T12:00:00Z','2026-10-28T15:59:00Z',
  '2026-10-28T16:00:00Z','2026-10-29T00:00:00Z','2026-10-29T04:00:00Z',
  '2026-10-29T12:00:00Z','2026-10-29T15:59:00Z','2026-10-29T16:00:00Z',
  '2026-10-29T16:05:00Z','2026-10-29T19:00:00Z','2026-10-30T01:00:00Z',
  '2026-10-30T03:00:00Z'
 ];
 const mk=(key,timestamp,coop='Asiapro',platform='IMG',type='IN')=>({
  id:key+'-'+type.toLowerCase(),sessionId:key,memberId:key,memberName:'Member '+key,
  coop,platform,siteId:'site-1',siteName:'Site 1',type,timestamp,orgId:'org-1'
 });
 const punches=[
  ...stamps.map((timestamp,i)=>mk('p'+i,timestamp)),
  mk('orphan','2026-10-31T12:00:00Z','Asiapro','IMG','OUT'),
  mk('other','2026-11-01T00:00:00Z','Worklife','OCG')
 ];
 const ctx={Date,Map,Set,Math,Number,String,TIPONCore:Core,TIPONOrgCore:Org,
  state:{punches,user:{role:'admin'}},admin:true,
  filters:{from:'',to:'',coop:'',platform:'',site:''},
  readSharedAttendanceFilters:()=>ctx.filters,isAdmin:()=>ctx.admin,
  validateAttendanceDateRange:()=>true,$:()=>({value:''}),
  memberNumberFor:id=>String(id)};
 vm.createContext(ctx);
 vm.runInContext(app.slice(start,end)+'\nthis.getLogRows=filteredTerminalLogRows;',ctx);
 const rows=()=>Array.from(ctx.getLogRows());
 const stamp=r=>Date.parse(r.timeIn||r.timeOut);
 const datesDescending=data=>data.every((row,i)=>!i||stamp(data[i-1])>=stamp(row));
 const adminRows=rows();
 assert.equal(adminRows.length,stamps.length+2);
 assert.equal(adminRows[0].key,'other','admin gets newest cross-cooperative record');
 assert.equal(adminRows[1].key,'orphan','OUT-only record uses its Time Out timestamp');
 assert.equal(adminRows.at(-1).key,'p0','oldest record belongs on the last page');
 assert.ok(datesDescending(adminRows),'all Admin rows are chronological newest-first');
 assert.ok(stamp(adminRows[9])>=stamp(adminRows[10]),'sorting occurs before ten-row pagination');
 ctx.state.user=actor;ctx.admin=false;
 const userRows=rows();
 assert.equal(userRows.length,stamps.length+1,'User sees only assigned MPC/BP');
 assert.equal(userRows[0].key,'orphan');
 assert.equal(userRows.at(-1).key,'p0');
 assert.ok(!userRows.some(r=>r.key==='other'));
 assert.ok(datesDescending(userRows),'User rows use the same newest-first order');
 assert.ok(userRows.findIndex(r=>r.key==='p8')<userRows.findIndex(r=>r.key==='p7'),
  'Manila 00:00 record comes before previous-day 23:59');
 assert.ok(userRows.findIndex(r=>r.key==='p9')<userRows.findIndex(r=>r.key==='p8'),
  'newer time comes first within the same local date');
 assert.ok(stamp(userRows[9])>=stamp(userRows[10]),'first User page holds newer records');
 ctx.filters={from:'2026-10-30',to:'2026-10-30',coop:'',platform:'',site:''};
 const limited=rows();
 assert.ok(limited.length>1);
 assert.ok(limited.every(r=>Core.phStamp(r.timeIn||r.timeOut).slice(0,10)==='2026-10-30'));
 assert.ok(datesDescending(limited),'date filtering retains newest-first ordering');
 ctx.state.user={role:'admin'};ctx.admin=true;
 ctx.filters={from:'',to:'',coop:'Worklife',platform:'OCG',site:''};
 assert.deepEqual(Array.from(rows(),r=>r.key),['other'],'Admin filters preserve scoped sorting');
 const render=app.slice(app.indexOf('function renderTerminalLogs('),app.indexOf('function attendanceRowByKey('));
 assert.match(render,/const filteredRows=filteredTerminalLogRows\(\),pageSize=10;/);
 assert.match(render,/rows=filteredRows\.slice\(offset,offset\+pageSize\)/);
 const exportCode=app.slice(app.indexOf('async function exportTerminalLogs('),app.indexOf('async function loadScript(',app.indexOf('async function exportTerminalLogs(')));
 assert.match(exportCode,/filteredTerminalLogRows\(\)/,'Excel export retains the same order');
});

test('Timesheet page counter and moved overtime dashboard KPI honor role and date filters',()=>{
 const html=source('index.html'),ts=source('timesheet-preview.js'),abs=source('absenteeism.js');
 assert.match(html,/id="timesheetPageCount"/);
 assert.match(ts,/Showing .*timesheet records/);
 assert.doesNotMatch(html,/<th>Potential Overtime \(8h\)<\/th>/);
 assert.doesNotMatch(ts,/Potential Overtime Hours/);
 assert.match(abs,/kpi\('Potential Overtime'/);
 assert.match(source('organization.js'),/platform:''/);
 const ctx={Date,Map,Set,Number,Math,Intl,console,document:{readyState:'complete',getElementById:()=>null,addEventListener(){}},
  TIPONCore:Core,TIPONOrgCore:Org};
 ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(ts,ctx);vm.runInContext(abs,ctx);
 const records=[
  {memberId:'M1',memberName:'First',coop:'Asiapro',platform:'IMG',siteId:'site-1',timeIn:'2026-10-29T00:00:00Z',timeOut:'2026-10-29T05:00:00Z'},
  {memberId:'M1',memberName:'First',coop:'Asiapro',platform:'IMG',siteId:'site-1',timeIn:'2026-10-29T06:00:00Z',timeOut:'2026-10-29T10:30:00Z'},
  {memberId:'M2',memberName:'Other',coop:'Worklife',platform:'OCG',siteId:'site-2',timeIn:'2026-10-29T00:00:00Z',timeOut:'2026-10-29T09:00:00Z'},
  {memberId:'M3',memberName:'Open',coop:'Asiapro',platform:'IMG',siteId:'site-1',timeIn:'2026-10-29T01:00:00Z',timeOut:''}
 ];
 const admin={role:'admin'};
 const all=ctx.TIPONAbsenteeism.potentialOvertime(records,{from:'2026-10-29',to:'2026-10-29'},admin);
 assert.equal(all.minutes,150);assert.equal(all.memberDays,2);assert.equal(all.excluded,1);
 const user={role:'registrar',coop:'Asiapro',platform:'IMG'};
 const scoped=ctx.TIPONAbsenteeism.potentialOvertime(records,{from:'2026-10-29',to:'2026-10-29'},user);
 assert.equal(scoped.minutes,90);assert.equal(scoped.memberDays,1);
 assert.equal(ctx.TIPONAbsenteeism.potentialOvertime(records,{from:'2026-10-28',to:'2026-10-28'},admin).minutes,0);
 assert.equal(ctx.TIPONAbsenteeism.potentialOvertime(records,{site:'site-2'},admin).minutes,60);
});

test('Absenteeism dashboard removes BP while retaining all eight MPC options',()=>{
 const html=source('index.html'),app=source('app.js'),org=source('organization.js');
 assert.match(html,/id="dashboardCoop"/);
 assert.doesNotMatch(html,/id="dashboardPlatform"/);
 assert.doesNotMatch(html,/id="dashboardSite"/);
 assert.match(app,/if\(source==='dashboard'\)\{sharedAttendanceFilters.platform='';sharedAttendanceFilters.site='';\}/);
 assert.match(app,/fillCoopSelect\('dashboardCoop',true\)/);
 assert.doesNotMatch(app,/fillLogFilter\('dashboardCoop',\[\.\.\.state.members/);
 assert.match(app,/fillLogFilter\('terminalLogPlatform'/);
 assert.doesNotMatch(org,/renderDashboardPlatformFilter/);
 assert.equal(Org.COOPS.length,8);
 const from=org.indexOf('function fillCoopSelect('),to=org.indexOf('function parseMemberCSV(',from);
 assert.ok(from>0&&to>from);
 const el={value:'',innerHTML:''};
 const ctx={TIPONOrgCore:Org,$:()=>el,esc:v=>v};
 vm.runInNewContext(org.slice(from,to)+';fillCoopSelect("dashboardCoop",true);',ctx);
 for(const coop of Org.COOPS)assert.ok(el.innerHTML.includes('<option value="'+coop+'">'+coop+'</option>'),coop);
 assert.ok(el.innerHTML.includes('<option value="">All cooperatives</option>'));
});

test('Mobile workspace restores the pre-regression bottom navigation and content layout',()=>{
 const css=source('style.css'),html=source('index.html');
 assert.match(css,/@media\(max-width:740px\)\{[^\n]*\.app-shell\{display:block\}\.sidebar\{display:none\}/);
 assert.match(css,/@media\(max-width:740px\)\{[^\n]*\.mobile-nav\{position:fixed/);
 assert.doesNotMatch(css,/@media\(max-width:740px\)\{\.sidebar\{display:flex/);
 assert.match(html,/<main id="pageHost">/);
 for(const id of ['page-terminalLogs','page-members','page-scanner'])assert.ok(html.includes('id="'+id+'"'));
});
test('Dashboard hides only its Work Location filter while Logs location remains',()=>{
 const html=source('index.html'),app=source('app.js'),org=source('organization.js');
 assert.doesNotMatch(html,/id="dashboardSite"/);
 assert.match(html,/id="terminalLogSite"/);
 assert.match(html,/id="dashboardCoop"/);
 assert.doesNotMatch(app,/dashboardSite/);
 assert.doesNotMatch(org,/dashboardSite/);
 assert.match(app,/sharedAttendanceFilters.site=''/);
 assert.match(org,/platform:'',site:'',valid:true/);
 assert.match(app,/\['terminalLogFrom','terminalLogTo','terminalLogCoop','terminalLogPlatform','terminalLogSite'\]/);
});


test('Sync warning counts only this account/device and distinguishes review from retry',()=>{
 const ctx={state:{orgId:'org-1',deviceId:'local',user:actor,punches:[]},navigator:{onLine:true},
  console,Date,Map,Set,Number,String,Math};
 ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(source('sync.js').replace('return {init,start,stop,kick',
  'return {__queueSummary:queueSummary,init,start,stop,kick'),ctx);
 const outbox=[
  {id:'local-retry',orgId:'org-1',ownerId:actor.id,errorCode:'TIMEOUT',error:'Lost response'},
  {id:'local-review',orgId:'org-1',ownerId:actor.id,errorCode:'NEEDS_REVIEW',error:'Review an invalid change'},
  {id:'foreign',orgId:'org-1',ownerId:'somebody-else',errorCode:'NEEDS_REVIEW'},
  {id:'other-org',orgId:'other-org',ownerId:actor.id,errorCode:'NEEDS_REVIEW'}
 ];
 const punches=[
  {...event('p1','IN','2026-10-29T01:00:00Z'),deviceId:'local',cloudAck:false,syncError:'Timeout'},
  {...event('p2','OUT','2026-10-29T02:00:00Z'),deviceId:'local',cloudAck:false,reviewStatus:'INVALID',syncError:'Review event'},
  {...event('remote','IN','2026-10-29T01:00:00Z'),deviceId:'another-device',cloudAck:false,reviewStatus:'INVALID'},
  {...event('acked','IN','2026-10-29T01:00:00Z'),deviceId:'local',cloudAck:true}
 ];
 const details=ctx.TIPONSync.__queueSummary(outbox,punches,'org-1',actor.id,'local');
 assert.equal(details.queued,2);
 assert.equal(details.needsReview,2);
 assert.equal(details.total,4);
 assert.equal(details.retrying,2);
 assert.match(details.firstProblem,/invalid change/);
 const otherAccount=ctx.TIPONSync.__queueSummary(outbox,punches,'org-1','somebody-else','unknown-device');
 assert.equal(otherAccount.total,1);
});
test('Transport timeout on an attendance edit retains the durable operation and optimistic local data',async()=>{
 const changeTime='2026-10-29T00:05:00Z';
 const punched={...event('in','IN','2026-10-29T00:00:00Z'),
  timestamp:changeTime,pendingCorrection:'pending',cloudAck:true,deviceId:'local'};
 const punches=[punched],outbox=[{id:'queued-correction',type:'attendanceCorrections',orgId:'org-1',
  ownerId:actor.id,baseRev:0,value:{sessionId:'session-1',eventIds:['in'],reason:'Correct shift clock',
  changes:{timeIn:changeTime},original:{timeIn:'2026-10-29T00:00:00Z',timeOut:''}}}];
 const tables={punches,outbox};
 const ctx={console,Date,Map,Set,Number,Math,setTimeout,clearTimeout,
  navigator:{onLine:true},state:{user:actor,orgId:'org-1',deviceId:'local',punches},$:()=>null,setText:()=>{},
  TIPONOrgCore:Org,TIPONAuth:{ensureOnline:async()=> 'test-token'},
  TIPONGitHubBridge:{request:async()=>{throw Object.assign(Error('Connection timed out'),{code:'TIMEOUT'});}},
  getAll:async name=>tables[name],getOne:async(name,id)=>tables[name]?.find(x=>x.id===id),
  OrgDB:{rawSave:async(name,item)=>{const items=tables[name],i=items.findIndex(x=>x.id===item.id);if(i>=0)items[i]=item;else items.push(item);},
    rawDelete:async(name,id)=>{const items=tables[name],i=items.findIndex(x=>x.id===id);if(i>=0)items.splice(i,1);}}
 };
 ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(source('sync.js').replace('return {init,start,stop,kick','return {__flush:flush,init,start,stop,kick'),ctx);
 await ctx.TIPONSync.__flush();
 assert.equal(outbox.length,1);
 assert.equal(outbox[0].errorCode,'TIMEOUT');
 assert.equal(outbox[0].everSent,true);
 assert.equal(outbox[0].retryCount,1);
 assert.equal(punches[0].timestamp,changeTime);
 assert.equal(punches[0].pendingCorrection,'pending');
 assert.equal(punches[0].deleted,undefined);
});
test('Lost attendance-correction acknowledgment is cleared only when the server-verified revision and timestamps match',async()=>{
 const changeTime='2026-10-29T00:05:00Z',originalTime='2026-10-29T00:00:00Z';
 const op={id:'ack-lost',type:'attendanceCorrections',everSent:true,orgId:'org-1',ownerId:actor.id,
  baseRev:0,value:{sessionId:'session-1',eventIds:['in'],reason:'Correct time-in',
   changes:{timeIn:changeTime},original:{timeIn:originalTime,timeOut:''}}};
 const punched={...event('in','IN',changeTime),deviceId:'other',correctionRev:1,pendingCorrection:'pending'};
 const punches=[punched],outbox=[op],tables={punches,outbox},calls=[];
 const ctx={console,Date,Map,Set,Number,Math,navigator:{onLine:true},state:{user:actor,orgId:'org-1',deviceId:'local',punches},
  $:()=>null,setText:()=>{},TIPONOrgCore:Org,TIPONAuth:{ensureOnline:async()=> 'test-token'},
  TIPONGitHubBridge:{request:async payload=>{calls.push(payload);throw Error('No resend expected');}},
  getAll:async name=>tables[name],getOne:async(name,id)=>tables[name]?.find(x=>x.id===id),
  OrgDB:{rawSave:async(name,item)=>{const items=tables[name],i=items.findIndex(x=>x.id===item.id);if(i>=0)items[i]=item;else items.push(item);},
    rawDelete:async(name,id)=>{const items=tables[name],i=items.findIndex(x=>x.id===id);if(i>=0)items.splice(i,1);}}
 };
 ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(source('sync.js').replace('return {init,start,stop,kick',
  'return {__flush:flush,__correctionAcknowledged:correctionAcknowledged,init,start,stop,kick'),ctx);
 assert.equal(ctx.TIPONSync.__correctionAcknowledged(op,[{...punched,cloudAck:false}],null),false);
 assert.equal(ctx.TIPONSync.__correctionAcknowledged(op,[{...punched,correctionRev:0}],null),false);
 assert.equal(ctx.TIPONSync.__correctionAcknowledged(op,[{...punched,timestamp:'2026-10-29T00:01:00Z'}],null),false);
 assert.equal(ctx.TIPONSync.__correctionAcknowledged(op,[punched],null),true);
 await ctx.TIPONSync.__flush();
 assert.equal(outbox.length,0);
 assert.equal(punches[0].timestamp,changeTime);
 assert.equal(punches[0].pendingCorrection,undefined);
 assert.equal(calls.length,0);
});
test('Manual Attendance Logs sync has deduplicated status, automatic queue retry and awaits in-flight work',()=>{
 const app=source('app.js'),sync=source('sync.js');
 assert.match(app,/function showDirectorySyncNotice\(/);
 assert.match(app,/const sync=await TIPONSync.submitPendingNow\(\)/);
 assert.match(app,/local change\(s\) are saved and queued for automatic retry/);
 assert.doesNotMatch(app,/record\(s\) still need synchronization or have sync errors/);
 assert.match(sync,/async function submitPendingNow\(operationId='?'\)/);
 assert.match(sync,/const preceding=activeRun/);
 assert.match(sync,/function correctionAcknowledged\(/);
});


test('MPC Breakdown reconciles Member List with normalized Attendance Logs and counts incomplete shifts',()=>{
 const orgSource=source('organization.js'),begin=orgSource.indexOf('  function buildMpcBreakdown('),
   end=orgSource.indexOf('  function renderMpc(){',begin);
 assert.ok(begin>=0&&end>begin,'MPC Breakdown pure counting helper exists');
 const context={Date,Map,Set,String,Number,TIPONCore:Core};
 vm.createContext(context);
 vm.runInContext(orgSource.slice(begin,end)+'\nthis.countBreakdown=buildMpcBreakdown;',context);
 const run=context.countBreakdown;
 const members=Array.from({length:7},(_,i)=>({id:'m'+(i+1),memberNumber:'00'+(i+1),
   name:'Synthetic Member '+(i+1),coop:'Asiapro',active:true,deleted:false}));
 const events=[];
 for(const [i,m] of members.slice(0,6).entries()){
   events.push({...event('in'+i,'IN','2026-10-29T00:00:00Z'),memberId:m.id,sessionId:'s'+i});
   events.push({...event('out'+i,'OUT','2026-10-29T08:00:00Z'),memberId:m.id,sessionId:'s'+i});
 }
 events.push({...event('open','IN','2026-10-29T01:00:00Z'),memberId:'m7',sessionId:'open'});
 const normalized=Org.project(events),all=run(members,normalized,Org.COOPS,'2026-10-29','2026-10-29');
 const asi=all.find(row=>row.coop==='Asiapro');
 assert.equal(all.length,8);
 assert.equal(asi.members,7);
 assert.equal(asi.complete,6);
 assert.equal(asi.missing,1);
 assert.equal(asi.members,asi.complete+asi.missing);
 assert.equal(all.find(row=>row.coop==='Worklife').members,0);
 const selected=run(members,normalized,Org.COOPS,'2026-10-29','2026-10-29','Asiapro');
 assert.equal(selected.length,1);
 const before=run(members,normalized,Org.COOPS,'2026-10-28','2026-10-28','Asiapro')[0];
 assert.equal(before.complete,0);assert.equal(before.missing,7);
 const duplicates=run(members,[...normalized,normalized[0]],Org.COOPS,'2026-10-29','2026-10-29');
 assert.equal(duplicates.find(row=>row.coop==='Asiapro').complete,6);
 const invalid=run(members,[...normalized,{memberId:'m7',timeIn:'2026-10-29T01:00:00Z',
  timeOut:'2026-10-29T08:00:00Z',projectionIssue:'Conflicting session'}],Org.COOPS,'2026-10-29','2026-10-29');
 assert.equal(invalid.find(row=>row.coop==='Asiapro').missing,1);
 const transferred=members.map(m=>m.id==='m1'?{...m,coop:'Worklife'}:m);
 const moved=run(transferred,normalized,Org.COOPS,'2026-10-29','2026-10-29');
 assert.equal(moved.find(row=>row.coop==='Worklife').members,1);
 assert.equal(moved.find(row=>row.coop==='Worklife').complete,1);
 assert.equal(moved.find(row=>row.coop==='Asiapro').members,6);
 const softDeleted=members.map(m=>m.id==='m7'?{...m,deleted:true}:m);
 assert.equal(run(softDeleted,normalized,Org.COOPS,'2026-10-29','2026-10-29').find(row=>row.coop==='Asiapro').members,6);
 const inactive=members.map(m=>m.id==='m7'?{...m,active:false}:m);
 assert.equal(run(inactive,normalized,Org.COOPS,'2026-10-29','2026-10-29').find(row=>row.coop==='Asiapro').members,7);
 const alias=run([{...members[0],id:'uuid-1',memberNumber:'001'}],
  [{memberId:'001',timeIn:'2026-10-29T00:00:00Z',timeOut:'2026-10-29T08:00:00Z'}],Org.COOPS,'2026-10-29','2026-10-29');
 assert.equal(alias.find(row=>row.coop==='Asiapro').complete,1);
 const overnight=run(members,[{memberId:'m1',timeIn:'2026-10-29T15:00:00Z',
  timeOut:'2026-10-29T22:00:00Z'}],Org.COOPS,'2026-10-29','2026-10-29');
 assert.equal(overnight.find(row=>row.coop==='Asiapro').complete,1);
 const nextDay=run(members,[{memberId:'m1',timeIn:'2026-10-29T15:00:00Z',
  timeOut:'2026-10-29T22:00:00Z'}],Org.COOPS,'2026-10-30','2026-10-30');
 assert.equal(nextDay.find(row=>row.coop==='Asiapro').complete,0);
});
test('MPC Breakdown refresh uses same member and attendance data without changing other dashboards',()=>{
 const org=source('organization.js'),app=source('app.js'),sync=source('sync.js'),html=source('index.html');
 assert.match(org,/buildMpcBreakdown\(reportMembers,logRows,coops,summaryFrom,summaryTo,f\.coop\)/);
 assert.match(org,/projectTerminalLogEvents\(state\.punches\.filter\(p=>p&&!p\.deleted&&!p\.reviewStatus&&p\.timestamp\)\)/);
 assert.match(org,/\$\('dashboardSummary'\)\.innerHTML=/);
 assert.match(org,/renderMpc\(\);/);
 assert.match(sync,/if\(state\.page==='dashboard'\)renderDashboard\(\)/);
 assert.match(app,/await loadCollections\(\);renderMembers\(\);renderDashboard\(\)/);
 assert.doesNotMatch(html,/id="dashboardSite"/);
 assert.doesNotMatch(html,/id="dashboardPlatform"/);
});


test('Attendance three summary cards aggregate the exact MPC Breakdown rows, including an open shift',()=>{
 const org=source('organization.js');
 const start=org.indexOf('  function buildMpcBreakdown('),end=org.indexOf('  function renderMpc(){',start);
 assert.ok(start>=0&&end>start);
 const ctx={Map,Set,Date,String,Number,TIPONCore:Core};
 vm.createContext(ctx);
 vm.runInContext(org.slice(start,end)+'\nthis.build=buildMpcBreakdown;this.summary=summarizeMpcBreakdown;',ctx);
 const registered=Array.from({length:7},(_,i)=>({id:'m'+i,memberNumber:'M'+i,coop:'Asiapro',active:true}));
 const sessions=registered.slice(0,6).map(m=>({memberId:m.id,timeIn:'2026-10-29T00:00:00Z',timeOut:'2026-10-29T08:00:00Z'}));
 sessions.push({memberId:'m6',timeIn:'2026-10-29T01:00:00Z',timeOut:''});
 const ranked=ctx.build(registered,sessions,Org.COOPS,'2026-10-29','2026-10-29');
 const summary=ctx.summary(ranked);
 assert.equal(summary.members,7);
 assert.equal(summary.complete,6);
 assert.equal(summary.missing,1);
 assert.equal(summary.members,summary.complete+summary.missing);
 assert.equal(ctx.summary(ctx.build(registered,sessions,Org.COOPS,'2026-10-29','2026-10-29','Asiapro')).missing,1);
 assert.equal(ctx.summary(ctx.build(registered,sessions,Org.COOPS,'2026-10-28','2026-10-28')).missing,7);
 const mixed=[...registered,{id:'worklife-member',coop:'Worklife',active:true}];
 const mixedRows=[...sessions,{memberId:'worklife-member',timeIn:'2026-10-29T00:00:00Z',timeOut:'2026-10-29T08:00:00Z'}];
 const all=ctx.build(mixed,mixedRows,Org.COOPS,'2026-10-29','2026-10-29');
 const full=ctx.summary(all);
 assert.equal(full.members,8);
 assert.equal(full.complete,7);
 assert.equal(full.missing,1);
 assert.equal(full.members,all.reduce((total,row)=>total+row.members,0));
 assert.equal(full.complete,all.reduce((total,row)=>total+row.complete,0));
 assert.equal(full.missing,all.reduce((total,row)=>total+row.missing,0));
 const renderer=org.slice(end,org.indexOf('  function renderReports(){',end));
 assert.match(renderer,/const ranked=hasAttendance\?/);
 assert.match(renderer,/buildMpcBreakdown\(reportMembers,logRows,coops,summaryFrom,summaryTo,f\.coop\)/);
 assert.match(renderer,/const total=summarizeMpcBreakdown\(ranked\)/);
 assert.match(renderer,/'Registered \/ enrolled',total.members/);
 assert.match(renderer,/'With In and Out',total.complete/);
 assert.match(renderer,/'No Time In \/ Out',total.missing/);
 assert.doesNotMatch(renderer,/const total=tally\(/);
});


test('October 30 snapshot fixes historic 7/6/1 versus current-day 7/5/2 mismatch',()=>{
 const orgSource=source('organization.js'),begin=orgSource.indexOf('  function buildMpcBreakdown('),
  end=orgSource.indexOf('  function renderMpc(){',begin);
 const ctx={Date,Map,Set,String,Number,TIPONCore:Core};
 vm.createContext(ctx);
 vm.runInContext(orgSource.slice(begin,end)+'\nthis.group=buildMpcBreakdown;this.total=summarizeMpcBreakdown;',ctx);
 const members=Array.from({length:7},(_,i)=>({id:'member-'+i,coop:'Asiapro',active:true,memberNumber:'test-'+i}));
 const events=[];
 // Six members completed an older day; only five completed the snapshot day.
 for(let i=0;i<6;i++){
  events.push({...event('older-in-'+i,'IN','2026-10-28T00:00:00Z'),memberId:members[i].id,sessionId:'old-'+i});
  events.push({...event('older-out-'+i,'OUT','2026-10-28T00:05:00Z'),memberId:members[i].id,sessionId:'old-'+i});
 }
 for(let i=0;i<5;i++){
  events.push({...event('today-in-'+i,'IN','2026-10-30T00:00:00Z'),memberId:members[i].id,sessionId:'today-'+i});
  events.push({...event('today-out-'+i,'OUT','2026-10-30T00:05:00Z'),memberId:members[i].id,sessionId:'today-'+i});
 }
 const rows=Org.project(events);
 const historical=ctx.total(ctx.group(members,rows,Org.COOPS,'2026-10-28','2026-10-30'));
 assert.equal(historical.members,7);assert.equal(historical.complete,6);assert.equal(historical.missing,1);
 const snapshot=ctx.total(ctx.group(members,rows,Org.COOPS,'2026-10-30','2026-10-30'));
 assert.equal(snapshot.members,7);
 assert.equal(snapshot.complete,5);
 assert.equal(snapshot.missing,2);
 const reference=Org.COOPS.map(coop=>ctx.group(members,rows,[coop],'2026-10-30','2026-10-30',coop)[0]);
 assert.equal(reference.reduce((sum,row)=>sum+row.complete,0),5);
 const render=orgSource.slice(end,orgSource.indexOf('  function renderReports(){',end));
 assert.match(render,/const snapshotDay=to,f=dashboardFilter\(\)/);
 assert.match(render,/const summaryFrom=windowRange.selected\?from:snapshotDay/);
 assert.match(render,/buildMpcBreakdown\(reportMembers,logRows,coops,summaryFrom,summaryTo,f\.coop\)/);
 assert.match(render,/Snapshot: /);
 assert.match(source('index.html'),/selected date filter/);
});
test('Absenteeism snapshot figures and Attendance Review distinguish daily members from historic member-days',()=>{
 const abs=source('absenteeism.js');
 assert.match(abs,/const noInValue=rangeSelected\?data.noInRate:pct\(focus.noIn,focus.eligible\)/);
 assert.match(abs,/const coverageValue=rangeSelected\?data.coverage:pct\(focus.present,focus.eligible\)/);
 assert.match(abs,/\$\('absReviewCount'\)\.textContent=''/);
 assert.doesNotMatch(abs,/review.length\+' to review in period/);
 // With five Time Ins and two missing, snapshot KPIs are 71.4%/28.6%.
 const percent=(numerator,denominator)=>denominator?Math.round(1000*numerator/denominator)/10:0;
 assert.equal(percent(5,7),71.4);
 assert.equal(percent(2,7),28.6);
 const sourceOrg=source('organization.js');
 assert.match(sourceOrg,/const snapshotDay=to/);
 assert.doesNotMatch(sourceOrg,/const total=tally\(members\)/);
});


test('Dashboard header uses exact day for one date, inclusive range for both, and shared data gate',()=>{
 const org=source('organization.js'),start=org.indexOf('  function buildMpcBreakdown('),
   end=org.indexOf('  function renderMpc(){',start);
 assert.ok(start>=0&&end>start);
 const c={Date,Map,Set,String,Number,TIPONCore:Core};vm.createContext(c);
 vm.runInContext(org.slice(start,end)+'\nthis.dateWindow=dashboardDateWindow;this.hasData=dashboardHasAttendance;',c);
 const history=['2026-10-28','2026-10-29','2026-10-30'],today='2026-10-30';
 const fromOnly=c.dateWindow('2026-10-14','',today,history);
 assert.deepEqual(JSON.parse(JSON.stringify(fromOnly)),{from:'2026-10-14',to:'2026-10-14',selected:true});
 const toOnly=c.dateWindow('','2026-10-14',today,history);
 assert.deepEqual(JSON.parse(JSON.stringify(toOnly)),{from:'2026-10-14',to:'2026-10-14',selected:true});
 const range=c.dateWindow('2026-10-28','2026-10-30',today,history);
 assert.deepEqual(JSON.parse(JSON.stringify(range)),{from:'2026-10-28',to:'2026-10-30',selected:true});
 const blank=c.dateWindow('','',today,history);
 assert.deepEqual(JSON.parse(JSON.stringify(blank)),{from:'2026-10-28',to:'2026-10-30',selected:false});
 const members=[{id:'member1',memberNumber:'001',coop:'Asiapro'}];
 const session=[{memberId:'member1',timeIn:'2026-10-29T00:00:00Z',timeOut:'2026-10-29T08:00:00Z'}];
 assert.equal(c.hasData(session,members,'2026-10-14','2026-10-14'),false);
 assert.equal(c.hasData(session,members,'2026-10-28','2026-10-30'),true);
 assert.equal(c.hasData(session,members,'2026-10-30','2026-10-30'),false);
 assert.equal(c.hasData(session,members,'2026-10-29','2026-10-29'),true);
 assert.equal(c.hasData(session,[{id:'different'}],'2026-10-29','2026-10-29'),false);
 assert.equal(c.hasData([{...session[0],projectionIssue:'Corrupt session'}],members,'2026-10-29','2026-10-29'),false);
});
test('Empty date/MPC filters zero all Absenteeism KPIs, charts, donut and review without fabricating absence',()=>{
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{style:{},textContent:'',innerHTML:'',
  disabled:false,setAttribute(){},hidden:false});return elements.get(id);};
 const c={Date,Map,Set,Number,Math,Intl,console,navigator:{onLine:true},
   state:{user:{role:'admin'}},
   document:{readyState:'loading',addEventListener(){},getElementById:element}};
 c.window=c;c.TIPONSync={lastSuccessfulSync:()=>''};vm.createContext(c);
 vm.runInContext(source('absenteeism.js'),c);
 c.TIPONAbsenteeism.render({from:'2026-10-14',to:'2026-10-14',coop:'Asiapro',allHistory:false,noData:true});
 assert.match(element('absKPIs').innerHTML,/Missing Time In/);
 assert.match(element('absKPIs').innerHTML,/0\.00 h/);
 assert.match(element('absKPIs').innerHTML,/Headcount Coverage/);
 assert.equal(element('absDonutNumber').textContent,'0');
 assert.equal(element('absHeadcount').innerHTML,'');
 assert.equal(element('absHours').innerHTML,'');
 assert.match(element('absPeriod').textContent,/2026-10-14/);
 assert.match(element('absReviewRows').innerHTML,/No attendance records for the selected filters/);
 assert.equal(element('absReviewMore').textContent,'Showing 0 review records');
 assert.equal(element('absReviewCount').textContent,'');
 assert.equal(element('absReviewPrev').disabled,true);
 assert.equal(element('absReviewNext').disabled,true);
 const org=source('organization.js');
 assert.match(org,/const ranked=hasAttendance\?/);
 assert.match(org,/\{coop,members:0,complete:0,missing:0\}/);
 assert.match(source('index.html'),/id="absReviewCount" hidden/);
});
test('Review flags: Absent without IN, Open Time In without OUT, AWOL after 3 consecutive no-time days',()=>{
 const people=[
  {id:'absent',name:'Missing',coop:'Asiapro',template:{},active:true,createdAt:'2026-10-27T00:00:00Z'},
  {id:'open',name:'Open',coop:'Asiapro',template:{},active:true,createdAt:'2026-10-27T00:00:00Z'},
  {id:'paired',name:'Present',coop:'Asiapro',template:{},active:true,createdAt:'2026-10-27T00:00:00Z'}
 ];
 const events=[
  {...event('early-open','IN','2026-10-27T01:00:00Z'),memberId:'open',sessionId:'early'},
  {...event('early-out','OUT','2026-10-27T08:00:00Z'),memberId:'open',sessionId:'early'},
  {...event('current-open','IN','2026-10-29T01:00:00Z'),memberId:'open',sessionId:'current-open'},
  {...event('paired-in','IN','2026-10-29T01:00:00Z'),memberId:'paired',sessionId:'paired'},
  {...event('paired-out','OUT','2026-10-29T08:00:00Z'),memberId:'paired',sessionId:'paired'}
 ];
 const c={Date,Map,Set,Number,Math,Intl,state:{user:{role:'admin'}},
  TIPONOrgCore:{scheduled:()=>({kind:'UNSCHEDULED'}),platformKey:Org.platformKey},
  document:{readyState:'loading',addEventListener(){},getElementById:()=>null}};
 c.window=c;vm.createContext(c);vm.runInContext(source('absenteeism.js'),c);
 const data=c.TIPONAbsenteeism.compute(people,[],events,[],'2026-10-29','Asiapro',
  Date.parse('2026-10-29T12:00:00Z'),'2026-10-27');
 const rows=c.TIPONAbsenteeism.reviewRecords(data,false);
 assert.equal(rows.find(x=>x.member.id==='absent'&&x.day==='2026-10-29').flag,'AWOL');
 assert.equal(rows.find(x=>x.member.id==='absent'&&x.day==='2026-10-27').flag,'Absent');
 assert.equal(rows.find(x=>x.member.id==='open'&&x.day==='2026-10-29').flag,'Open Time In');
 assert.ok(!rows.some(x=>x.member.id==='paired'&&x.day==='2026-10-29'));
 assert.equal(data.summary.awolCount,1);
 assert.equal(data.summary.open,1);
 assert.equal(data.rows[2].openSessions.length,1);
 assert.equal(data.rows[2].noIn,1);
 const noTimeOutOnly=[...events,{...event('out-alone','OUT','2026-10-29T10:00:00Z'),memberId:'absent',sessionId:'orphan'}];
 const extraData=c.TIPONAbsenteeism.compute(people,[],noTimeOutOnly,[],'2026-10-29','Asiapro',
  Date.parse('2026-10-29T12:00:00Z'),'2026-10-27');
 const extra=c.TIPONAbsenteeism.reviewRecords(extraData,false);
 assert.equal(extra.find(x=>x.member.id==='absent'&&x.day==='2026-10-29').flag,'Absent');
 assert.equal(extraData.summary.awolCount,0);
 c.TIPONOrgCore.scheduled=(member,site,day)=>member.id==='absent'&&day==='2026-10-28'?{kind:'LEAVE'}:{kind:'UNSCHEDULED'};
 const excused=c.TIPONAbsenteeism.compute(people,[],events,[],'2026-10-29','Asiapro',
  Date.parse('2026-10-29T12:00:00Z'),'2026-10-27');
 assert.equal(c.TIPONAbsenteeism.reviewRecords(excused,false).find(x=>x.member.id==='absent'&&x.day==='2026-10-29').flag,'Absent');
});
test('One dashboard filter controls all reports; no independent render overwrites the shared filter',()=>{
 const app=source('app.js'),org=source('organization.js'),abs=source('absenteeism.js'),html=source('index.html');
 assert.match(org,/const windowRange=dashboardDateWindow\(selectedFrom,selectedTo,today,historyDays\)/);
 assert.match(org,/window\.TIPONAbsenteeism\?\.render\(\{from,to,coop:f\.coop,platform:'',site:'',valid:true,allHistory:!windowRange.selected,noData:!hasAttendance\}\)/);
 assert.match(org,/buildMpcBreakdown\(reportMembers,logRows,coops,summaryFrom,summaryTo,f\.coop\)/);
 assert.doesNotMatch(app,/if\(window.TIPONAbsenteeism\)TIPONAbsenteeism.render/);
 assert.match(abs,/const rangeSelected=!allHistory&&from&&to&&from!==to/);
 assert.doesNotMatch(abs,/const snapshotReview/);
 assert.match(html,/id="dashboardFrom"/);
 assert.match(html,/id="dashboardTo"/);
 assert.match(html,/id="dashboardCoop"/);
 assert.doesNotMatch(html,/id="dashboardPlatform"/);
 assert.doesNotMatch(html,/id="dashboardSite"/);
});


test('Admin attendance correction is not blocked by forbidden raw-punch upload',async()=>{
 const admin={...actor,id:'admin-1',role:'admin'},now='2026-10-28T01:00:00Z';
 const input={...event('in','IN',now),deviceId:'approved-kiosk',cloudAck:true};
 const legacy={...event('old-local','OUT','2026-10-28T06:00:00Z'),sessionId:'unrelated-session',
   deviceId:'shared-browser',cloudAck:false};
 const punches=[input,legacy],outbox=[{id:'admin-fix',type:'attendanceCorrections',orgId:'org-1',ownerId:admin.id,baseRev:0,
  value:{sessionId:'session-1',eventIds:['in'],reason:'Restore missing Time Out',
   changes:{timeIn:now,timeOut:'2026-10-28T08:00:00Z'},original:{timeIn:now,timeOut:''}}}];
 const tables={outbox,punches},calls=[];
 const context={console,Date,Map,Set,Math,Number,setTimeout,clearTimeout,
  navigator:{onLine:true},state:{user:admin,orgId:'org-1',deviceId:'shared-browser',punches},
  $:()=>null,setText:()=>{},TIPONOrgCore:Org,TIPONAuth:{ensureOnline:async()=> 'admin-token'},
  TIPONGitHubBridge:{request:async payload=>{
   calls.push(payload);
   if(payload.action==='submit')throw Object.assign(Error('Only approved User or Physical Kiosk accounts can upload attendance.'),{code:'FORBIDDEN'});
   assert.equal(payload.action,'attendanceCorrect');
   return {ok:true,protocol:Org.PROTOCOL,correction:{sessionId:'session-1',timeIn:now,
    timeOut:'2026-10-28T08:00:00Z',createdOut:true,rev:1}};
  }},
  getAll:async type=>tables[type],getOne:async(type,id)=>tables[type]?.find(x=>x.id===id),
  OrgDB:{rawSave:async(type,entity)=>{const a=tables[type],i=a.findIndex(x=>x.id===entity.id);
    if(i<0)a.push(entity);else a[i]=entity;},
   rawDelete:async(type,id)=>{const a=tables[type],i=a.findIndex(x=>x.id===id);if(i>=0)a.splice(i,1);}}
 };
 context.window=context;vm.createContext(context);
 vm.runInContext(source('sync.js').replace('return {init,start,stop,kick','return {__flush:flush,init,start,stop,kick'),context);
 await context.TIPONSync.__flush();
 assert.deepEqual(calls.map(x=>x.action),['attendanceCorrect']);
 assert.equal(outbox.length,0);
 assert.equal(punches.find(p=>p.id==='old-local').cloudAck,false,'never delete or secretly upload unrelated pending events');
 const synthetic=punches.find(p=>p.id==='attendance-correction-out:session-1');
 assert.equal(synthetic?.timestamp,'2026-10-28T08:00:00Z');
 assert.equal(synthetic.cloudAck,true);
});
test('User correction is submitted before a rejected unrelated raw attendance event',async()=>{
 const now='2026-10-28T01:00:00Z',input={...event('in','IN',now),deviceId:'registered',cloudAck:true};
 const other={...event('pending-out','OUT','2026-10-28T05:00:00Z'),sessionId:'other-session',deviceId:'registered',cloudAck:false};
 const punches=[input,other],outbox=[{id:'user-fix',type:'attendanceCorrections',orgId:'org-1',ownerId:actor.id,baseRev:0,
  value:{sessionId:'session-1',eventIds:['in'],reason:'Add missing Time Out',
   changes:{timeIn:now,timeOut:'2026-10-28T08:00:00Z'},original:{timeIn:now,timeOut:''}}}];
 const tables={punches,outbox},calls=[];
 const context={console,Date,Map,Set,Math,Number,setTimeout,clearTimeout,
  navigator:{onLine:true},state:{user:actor,orgId:'org-1',deviceId:'registered',punches},
  $:()=>null,setText:()=>{},TIPONOrgCore:Org,TIPONAuth:{ensureOnline:async()=> 'user-token'},
  TIPONGitHubBridge:{request:async payload=>{
   calls.push(payload);
   if(payload.action==='submit')throw Object.assign(Error('A queued punch was rejected'),{code:'FORBIDDEN'});
   assert.equal(payload.action,'attendanceCorrect');
   return {ok:true,protocol:Org.PROTOCOL,correction:{sessionId:'session-1',timeIn:now,
    timeOut:'2026-10-28T08:00:00Z',createdOut:true,rev:1}};
  }},
  getAll:async type=>tables[type],getOne:async(type,id)=>tables[type]?.find(x=>x.id===id),
  OrgDB:{rawSave:async(type,entity)=>{const a=tables[type],i=a.findIndex(x=>x.id===entity.id);
    if(i<0)a.push(entity);else a[i]=entity;},
   rawDelete:async(type,id)=>{const a=tables[type],i=a.findIndex(x=>x.id===id);if(i>=0)a.splice(i,1);}}
 };
 context.window=context;vm.createContext(context);
 vm.runInContext(source('sync.js').replace('return {init,start,stop,kick','return {__flush:flush,init,start,stop,kick'),context);
 await assert.rejects(context.TIPONSync.__flush(),/queued punch was rejected/i);
 assert.deepEqual(calls.map(x=>x.action),['attendanceCorrect','submit']);
 assert.equal(outbox.length,0,'successful correction must not be rolled back by an unrelated failed punch');
 assert.equal(punches.find(p=>p.id==='pending-out').cloudAck,false);
 assert.equal(punches.find(p=>p.id==='attendance-correction-out:session-1').cloudAck,true);
});
test('Edit Attendance remains responsive while server sync runs and never claims an unacknowledged save',()=>{
 const app=source('app.js'),sync=source('sync.js'),html=source('index.html');
 const save=app.slice(app.indexOf('async function saveAttendanceCorrection('),app.indexOf('function editAttendanceFromLog('));
 assert.match(save,/await loadCollections\(\);renderTerminalLogs\(\);renderDashboard\(\)/);
 assert.match(save,/void TIPONSync\.submitPendingNow\(\)\.then\(async\(result\)=>/);
 assert.doesNotMatch(save,/const result=await TIPONSync\.submitPendingNow\(\)/);
 assert.match(save,/if\(!pending\)/);
 assert.match(save,/else if\(pending\.errorCode==='NEEDS_REVIEW'\)/);
 assert.match(save,/Correction saved on this device|Attendance edit saved locally/);
 assert.match(sync,/const mayUploadPunches=actor.role==='registrar'\|\|actor.role==='kiosk'/);
 const correction=sync.indexOf("await sendSpecial(special.filter(op=>op.type==='attendanceCorrections'));");
 const punch=sync.indexOf('if(events.length)await send([],events);');
 const unrelated=sync.indexOf("await sendSpecial(special.filter(op=>op.type!=='attendanceCorrections'));");
 assert.ok(correction>=0&&punch>correction&&unrelated>punch);
 assert.match(app,/function canCorrectAttendance\(\)/);
 assert.match(app,/isAdmin\(\)\|\|u.role==='registrar'/);
 assert.match(app,/if\(outDate&&outTime\)changes\.timeOut=attendanceInputStamp\(outDate,outTime\)/);
 assert.match(html,/id="attendanceEditDateOut"/);
 assert.match(html,/id="attendanceEditTimeOut"/);
});
test('Attendance Review uses correctly worded status flags without changing underlying policy',()=>{
 const report=source('absenteeism.js'),html=source('index.html');
 assert.match(report,/row\.outOnlyMembers\.forEach\(member=>add\(member,row\.day,'Absent'\)\)/);
 assert.match(report,/\?'AWOL':'Absent'/);
 assert.match(report,/,'Open Time In',session\.sessionId\)/);
 assert.doesNotMatch(report,/flag,'ABSENT'/);
 assert.match(html,/Absent: no Time In recorded/);
 assert.match(html,/Open Time In: Time In recorded, but no valid Time Out/);
});


test('Each sample challenge completes with exactly one blink and no head turn',()=>{
 const ctx={Date,Math,Number,Array,state:{},navigator:{onLine:true},$:()=>null,speakTerminal(){},loadFaceModels(){},startScanner(){},stopScanner(){},beginEnrollment(){},enrollTick(){},blinkRatio:f=>f.ratio};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source('liveness-guard.js'),ctx);
 for(let sample=0;sample<3;sample++){
  const c=ctx.TIPONLiveness.challenge(),t=c.started;
  assert.deepEqual(Array.from(c.order),['blink']);
  for(let i=0;i<8;i++)assert.equal(ctx.TIPONLiveness.advance(c,{ratio:.25},t+i*100).ok,false);
  assert.equal(ctx.TIPONLiveness.advance(c,{ratio:.02},t+900).ok,false);
  assert.equal(ctx.TIPONLiveness.advance(c,{ratio:.25},t+1050).ok,true);
 }
});
test('Work Location Business Platforms are filtered by selected cooperative',()=>{
 const nodes={siteCoop:{value:'Asiapro'},sitePlatform:{value:'IMG'},siteCoopChoices:{querySelectorAll:()=>[]},sitePlatformChoices:{querySelectorAll:()=>[]}};
 const mapping={Asiapro:['IMG','AP Cons','Contracting','MSG-NW','ATS'],'Gawa at Kalinga':['GAK']};
 const ctx={window:{TIPONCoopPlatforms:mapping},TIPONOrgCore:{COOPS:Object.keys(mapping)},document:{readyState:'loading',addEventListener(){},querySelectorAll(){return[]},getElementById:id=>nodes[id]},isAdmin:()=>true,esc:s=>String(s)};
 vm.createContext(ctx);vm.runInContext(source('site-scope.js'),ctx);
 const pairs=ctx.window.TIPONSiteScopes.pairs(null);
 assert.deepEqual(JSON.parse(JSON.stringify(pairs)),[{coop:'Asiapro',platform:'IMG'}]);
 nodes.sitePlatform.value='GAK';assert.throws(()=>ctx.window.TIPONSiteScopes.pairs(null),/not assigned/);
});
test('Server acknowledgment clears all member pending flags',async()=>{
 const sync=source('sync.js'),start=sync.indexOf('  async function markOps('),end=sync.indexOf('  const wire=',start);
 let record={id:'member',rev:0,_pendingOp:'op',pendingEdit:true,pendingFaceUpdate:true,syncIssue:'old'},removed;
 const op={id:'op',type:'members',value:{id:'member'},baseRev:0};
 const ctx={getAll:async()=>[op],db:{transaction(){const tx={objectStore:type=>type==='outbox'?{delete:id=>removed=id}:{get(){const request={};queueMicrotask(()=>{request.result=record;request.onsuccess();tx.oncomplete();});return request;},put:value=>record=value}};return tx;}}};
 vm.createContext(ctx);vm.runInContext(sync.slice(start,end),ctx);
 await ctx.markOps({ackOps:['op'],receipts:[{type:'members',id:'member',rev:1}]});
 assert.equal(removed,'op');assert.equal(record.rev,1);
 for(const key of ['_pendingOp','pendingEdit','pendingFaceUpdate','syncIssue'])assert.equal(key in record,false);
});

test('Login hero is text-only and prominently placed below Federation branding',()=>{
 const html=source('index.html'),sw=source('sw.js');
 const hero=html.slice(html.indexOf('<aside class="login-story"'),html.indexOf('</aside>'));
 assert.doesNotMatch(hero,/<img[^>]*login-team-art/);
 assert.doesNotMatch(html,/<link[^>]*rel="preload"[^>]*login-workers/);
 assert.ok(hero.includes('TIPON KABILANG / COOPERATIVE ATTENDANCE'));
 assert.ok(hero.includes('Kabilang Ka.<br/><em>Mahalaga Ka.</em>'));
 assert.ok(hero.includes('Bawat isa, mahalaga.'));
 assert.ok(html.includes('text-only landing visual, immediately under Federation logo'));
 assert.match(html,/grid-template-rows:auto minmax\(min-content,1fr\) auto/);
 assert.match(html,/align-self:center;justify-self:stretch/);
 assert.match(html,/width:100%;max-width:100%;margin:0;/);
 assert.match(html,/text-align:left;transform:none/);
 assert.match(html,/\.login-story \.story-bottom\{margin-top:0\}/);
 assert.match(html,/\.login-accent-rule\{width:120px;height:7px\}/);
 assert.ok(!sw.includes("'./login-workers.webp'"));
});
test('Work Location creation writes an atomic site and outbox record for offline synchronization',()=>{
 const app=source('app.js'),start=app.indexOf('async function saveSiteForm('),end=app.indexOf('async function queueWorkLocationDelete',start);
 assert.ok(start>=0&&end>start);
 const body=app.slice(start,end);
 assert.doesNotMatch(body,/Connect to the internet to centrally register Work Locations/);
 assert.match(body,/db\.transaction\(\['sites','outbox'\],'readwrite'\)/);
 assert.match(body,/type:'sites'/);
 assert.match(body,/ownerId:state\.user\.id/);
 assert.match(body,/if\(!navigator\.onLine\)/);
 assert.match(body,/TIPONSync\.submitPendingNow/);
});
test('Offline readiness verifies the cached app shell, IndexedDB stores and active Service Worker',()=>{
 const app=source('app.js'),html=source('index.html'),sw=source('sw.js');
 assert.match(app,/async function checkOfflineFoundation\(\)/);
 assert.match(app,/DB_STORE\.every\(name=>db\.objectStoreNames\.contains\(name\)\)/);
 assert.match(html,/id="offlineFoundationStatus"/);
 assert.ok(!app.includes("'./login-workers.webp'"));
 assert.ok(!sw.includes("'./login-workers.webp'"));
});
test('Server acknowledgment clears Work Location pending flags',async()=>{
 const sync=source('sync.js'),start=sync.indexOf('  async function markOps('),end=sync.indexOf('  const wire=',start);
 let record={id:'site',rev:0,orgId:'org-1',_pendingOp:'site-op',pendingEdit:true,syncIssue:'old'},removed;
 const op={id:'site-op',type:'sites',value:{id:'site'},baseRev:0};
 const ctx={getAll:async()=>[op],db:{transaction(){const tx={objectStore:type=>type==='outbox'?{delete:id=>removed=id}:{get(){const request={};queueMicrotask(()=>{request.result=record;request.onsuccess();tx.oncomplete();});return request;},put:value=>record=value}};return tx;}}};
 vm.createContext(ctx);vm.runInContext(sync.slice(start,end),ctx);
 await ctx.markOps({ackOps:['site-op'],receipts:[{type:'sites',id:'site',rev:1}]});
 assert.equal(removed,'site-op');assert.equal(record.rev,1);
 for(const key of ['_pendingOp','pendingEdit','syncIssue'])assert.equal(key in record,false);
});
test('Offline Business Platform additions sync idempotently against the central directory',async()=>{
 const admin={...actor,role:'admin'};
 const outbox=[{id:'bp-op',type:'platformChanges',orgId:'org-1',ownerId:admin.id,createdAt:'2026-11-03T00:00:00.000Z',
  value:{action:'add',name:'Test Platform',code:'TP',abbreviation:'TP'},everSent:false}];
 let codes=['AP Cons'],details=[{name:'Asiapro Construction',code:'AP Cons'}];
 const calls=[],synced=[];
 const ctx={console,setTimeout,clearTimeout,Date,Map,Set,navigator:{onLine:true},
  state:{user:admin,orgId:'org-1',deviceId:'device-1',punches:[]},
  $:()=>null,setText:()=>{},TIPONOrgCore:Org,
  TIPONAuth:{current:()=>admin,ensureOnline:async()=>'token'},
  TIPONGitHubBridge:{request:async payload=>{
    if(payload.action==='platforms')return {ok:true,protocol:Org.PROTOCOL,businessPlatforms:[...codes],businessPlatformRecords:[...details]};
    calls.push(payload);
    if(payload.action==='platformAdd'){codes.push(payload.abbreviation);details.push({name:payload.name,code:payload.abbreviation});}
    return {ok:true,protocol:Org.PROTOCOL};
  }},
  TIPONPlatforms:{
   accept:async(nextCodes,nextDetails)=>{codes=nextCodes;details=nextDetails;},
   records:()=>details.map(item=>({code:item.code,name:item.name})),
   markSynced:code=>synced.push(code),setPendingStatus:()=>{}
  },
  getAll:async name=>name==='outbox'?outbox:[],
  getOne:async(name,id)=>outbox.find(item=>item.id===id),
  OrgDB:{rawDelete:async(name,id)=>{const i=outbox.findIndex(item=>item.id===id);if(i>=0)outbox.splice(i,1);},
   rawSave:async(name,value)=>{const i=outbox.findIndex(item=>item.id===value.id);if(i>=0)outbox[i]=value;}}
 };
 ctx.window=ctx;vm.createContext(ctx);
 const script=source('sync.js').replace('return {init,start,stop,kick','return {__flush:flush,init,start,stop,kick');
 vm.runInContext(script,ctx);
 await ctx.TIPONSync.__flush();
 assert.equal(calls.length,1);assert.equal(calls[0].action,'platformAdd');
 assert.equal(outbox.length,0);assert.deepEqual(synced,['TP']);
});

test('Work Location fields align and Address is a required input',()=>{
 const html=source('index.html'),app=source('app.js');
 const start=html.indexOf('<dialog class="form-dialog" id="siteDialog"'),end=html.indexOf('<dialog class="form-dialog" id="memberDialog"');
 const site=html.slice(start,end);
 assert.match(site,/<input id="siteName"[^>]*required/);
 assert.match(site,/<select id="siteCoop" required/);
 assert.match(site,/<select id="sitePlatform" required/);
 assert.match(site,/Address \/ Site Description <i class="required-star">\*<\/i>/);
 assert.match(site,/<input id="siteAddress" required aria-required="true"/);
 assert.match(html,/#siteDialog \.dialog-body>\.form-row\.three \.field-caption\{display:block!important;margin:0!important;height:18px/);
 assert.match(html,/#siteDialog \.dialog-body>\.form-row\.three select\{display:block;width:100%;height:50px;min-height:50px;margin:0\}/);
 const save=app.slice(app.indexOf('async function saveSiteForm('),app.indexOf('async function saveSiteForm(')+3200);
 assert.match(save,/if\(!address\)\{showToast\('Address \/ Site Description is required/);
});
test('Business Platform modal requires cooperative and backend persists new custom BP MPC association',()=>{
 const html=source('index.html'),front=source('platforms.js'),sync=source('sync.js'),backend=source('backend-patch/BPDirectory.gs');
 const form=html.slice(html.indexOf('<dialog class="form-dialog platform-dialog"'),html.indexOf('</form></dialog>',html.indexOf('<dialog class="form-dialog platform-dialog"')));
 assert.match(form,/<select id="newPlatformCooperative" required>/);
 assert.match(form,/<option value="">Select cooperative<\/option>/);
 assert.match(front,/coopSelect\.innerHTML='<option value="">Select cooperative<\/option>'\+TIPONOrgCore\.COOPS/);
 assert.doesNotMatch(front,/This Business Platform is not assigned to the selected Cooperative in the approved mapping/);
 assert.match(front,/info\.businessPlatformCooperativeSupported!==true/);
 assert.match(sync,/abbreviation:code,coop:value\.coop/);
 const mpc=Org.COOPS,coop=mpc[0],other=mpc.find(x=>x!==coop);
 const props=new Map(),codes=Org.DEFAULT_PLATFORMS.slice();
 const ctx={Date,Math,Number,Map,Set,Array,Object,String,JSON,
  Utilities:{newBlob:value=>({getBytes:()=>new TextEncoder().encode(value)})},
  TIPONOrgCore:Org,
  tp5Must_:(ok,message,code)=>{if(!ok)throw Object.assign(Error(message),{code});},
  tp5Props_:()=>({getProperty:key=>props.get(key)||'',setProperty:(key,value)=>props.set(key,value)}),
  tp5PlatformNames_:()=>codes.slice(),
  tp5AddPlatform_:(actor,details)=>codes.push(details.name),
  tp5Read_:()=>[],tp5Admin_:actor=>{if(actor.role!=='admin')throw Error('Admin required');},
  tp5Reply_:response=>response,tp5Bump_:()=>1,tp5Audit_:()=>{}
 };
 vm.createContext(ctx);vm.runInContext(backend,ctx);
 const registered=ctx.tp5BPAdd_({role:'admin'},{name:'Synthetic Test Business Platform',abbreviation:'SYNTH-BP',coop});
 assert.equal(registered.businessPlatformCooperativeSupported,true);
 const row=registered.businessPlatformRecords.find(x=>x.abbreviation==='SYNTH-BP');
 assert.equal(row.coop,coop);
 assert.equal(row.coops.length,1);
 assert.equal(row.coops[0],coop);
 assert.equal(ctx.tp5BPAllowedCoop_(coop,'SYNTH-BP'),true);
 assert.equal(ctx.tp5BPAllowedCoop_(other,'SYNTH-BP'),false);
 assert.ok(props.has('TP5_PLATFORM_RECORDS'));
 assert.throws(()=>ctx.tp5BPAdd_({role:'admin'},{name:'No Cooperative',abbreviation:'NO-COOP',coop:''}),/approved Cooperative/);
 assert.throws(()=>ctx.tp5BPAdd_({role:'registrar'},{name:'Wrong Role',abbreviation:'USER-BP',coop}),/Admin required/);
 assert.throws(()=>ctx.tp5BPAdd_({role:'admin'},{name:'Duplicate',abbreviation:'SYNTH-BP',coop}),/already exists/);
});

test('Business Platforms table has four matching column headers with compact, aligned Action buttons',()=>{
 const html=source('index.html'),platforms=source('platforms.js');
 const section=html.slice(html.indexOf('<section class="panel table-panel bp-directory-panel"'),html.indexOf('<tbody id="adminBPRows"'));
 assert.ok(section.length>0,'Business Platforms directory markup is present');
 assert.match(section,/<table class="bp-directory-table"/);
 const headers=[...section.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(match=>match[1]);
 assert.deepEqual(headers,['Business Platforms Name','Business Platform','Cooperatives','Action']);
 const widths=[...section.matchAll(/<col style="width:(\d+)%"/g)].map(match=>Number(match[1]));
 assert.deepEqual(widths,[34,17,27,22]);
 assert.equal(widths.reduce((a,b)=>a+b,0),100);
 assert.match(html,/<tbody id="adminBPRows"><tr><td colspan="4">/);
 assert.match(html,/\.bp-directory-table\{width:100%;min-width:780px;table-layout:fixed;/);
 assert.doesNotMatch(html,/#page-adminSites \.bp-directory-panel table td:nth-child\(3\)\{width:180px\}/);
 const renderer=platforms.slice(platforms.indexOf('function renderDirectory()'),platforms.indexOf('function render(){'));
 assert.match(renderer,/<td><b>'\+esc\(x\.coops\?\.join\(', '\)\|\|x\.coop\|\|'—'\)/);
 assert.match(renderer,/<td><div class="bp-row-actions">/);
 assert.match(renderer,/data-bp-edit/);
 assert.match(renderer,/data-bp-delete/);
 assert.match(renderer,/'<tr><td colspan="4">/);
});

test('Admin and User schedule-only backend edits are scoped, validated and preserve biometric attendance data',()=>{
 const backend=source('backend-patch/MemberLocationEdit.gs'),app=source('app.js'),
   sync=source('sync.js'),docs=source('backend-patch/README_MEMBER_LOCATION.md');
 assert.match(backend,/function tp5MemberWorkScheduleUpdateV2_\(actor,q\)/);
 assert.match(backend,/actor\.role==='admin'\|\|actor\.role==='registrar'/);
 assert.match(backend,/TIPONOrgCore\.inScope\(actor,old\)/);
 assert.match(backend,/tp5MemberWorkScheduleV2_\(q\.workSchedule,old\.workSchedule\)/);
 assert.match(backend,/tp5ApplyMemberScheduleColumnsV2_\(next,schedule\)/);
 assert.match(backend,/MEMBER_UPDATE_WEEKLY_SCHEDULE/);
 assert.match(app,/scheduleOnly\?'memberWorkScheduleUpdateV2'/);
 assert.match(app,/mode:scheduleOnly\?'weeklySchedule':'memberEdit'/);
 assert.match(sync,/op\.value\?\.mode==='weeklySchedule'/);
 assert.match(sync,/if\(scheduleOnly\)throw Object\.assign/);
 assert.match(sync,/workSchedule:original\.workSchedule\|\|null/);
 assert.match(docs,/if\(action==='memberWorkScheduleUpdateV2'\)return tp5Lock_/);
 const template={alg:'AES-GCM',iv:'dummy-iv-only-for-synthetic-test',data:'encrypted-placeholder'},
   attendance=[{id:'historical-event',type:'IN',timestamp:'2026-10-28T00:00:00Z'}];
 let member={id:'m-1',memberNumber:'M1',name:'Synthetic Worker',coop:'Asiapro',
   platform:'IMG',siteId:'site-1',siteIds:['site-1'],template,rev:3,active:true};
 const audits=[],ctx={Date,Math,Number,Map,Set,Array,Object,String,
  TIPONOrgCore:Org,
  tp5Must_:(ok,message,code)=>{if(!ok)throw Object.assign(Error(message),{code});},
  tp5Find_:(type,id)=>type==='members'&&member.id===id?member:null,
  tp5Safe_:value=>({...value}),
  tp5Now_:()=> '2026-11-04T08:00:00Z',
  tp5Put_:(table,value)=>{assert.equal(table,'members');member=value;},
  tp5RefreshMemberDirectory_:()=>{},
  tp5Bump_:()=>42,
  tp5Audit_:(actor,action,id,message)=>audits.push({actor,action,id,message}),
  tp5Reply_:value=>value
 };
 vm.createContext(ctx);vm.runInContext(backend,ctx);
 const admin={id:'admin-1',role:'admin'},user={...actor,id:'user-1'},
  week={enabled:true,days:[1,2,3,4,5],start:'08:00',end:'18:30',grace:0};
 const saved=ctx.tp5MemberWorkScheduleUpdateV2_(admin,{memberId:'m-1',baseRev:3,workSchedule:week});
 assert.equal(saved.member.rev,4);
 assert.equal(member.workDays,'1,2,3,4,5');assert.equal(member.workStart,'08:00');
 assert.equal(member.workEnd,'18:30');assert.equal(member.workGrace,0);
 assert.equal(member.template,template);assert.deepEqual(member.siteIds,['site-1']);
 assert.equal(attendance.length,1);
 assert.equal(audits[0].action,'MEMBER_UPDATE_WEEKLY_SCHEDULE');
 const weekUser={enabled:true,days:[1,3,5,6],start:'07:00',end:'15:30',grace:15};
 const updated=ctx.tp5MemberWorkScheduleUpdateV2_(user,{memberId:'m-1',baseRev:4,workSchedule:weekUser});
 assert.equal(updated.member.rev,5);
 assert.equal(member.workDays,'1,3,5,6');assert.equal(member.workGrace,15);
 assert.equal(member.template,template);
 assert.throws(()=>ctx.tp5MemberWorkScheduleUpdateV2_({id:'user-2',role:'registrar',coop:'Worklife',platform:'OCG'},{
  memberId:'m-1',baseRev:5,workSchedule:week
 }),/your MPC\/BP/);
 assert.throws(()=>ctx.tp5MemberWorkScheduleUpdateV2_({role:'kiosk'},{
  memberId:'m-1',baseRev:5,workSchedule:week
 }),/approved Administrator or User/);
 assert.throws(()=>ctx.tp5MemberWorkScheduleUpdateV2_(user,{memberId:'m-1',baseRev:4,workSchedule:week}),/changed on another device/);
 assert.throws(()=>ctx.tp5MemberWorkScheduleUpdateV2_(admin,{memberId:'m-1',baseRev:5,workSchedule:{
  enabled:true,days:[],start:'08:00',end:'18:00'
 }}),/one or more valid work days/);
 const unchanged=ctx.tp5MemberWorkScheduleUpdateV2_(user,{memberId:'m-1',baseRev:5,workSchedule:weekUser});
 assert.equal(unchanged.unchanged,true);
 assert.equal(member.rev,5);
 assert.equal(audits.length,2);
});

test('Member weekly schedule overrides work-location schedule and determines scheduled days',()=>{
  const site={id:'site-1',schedule:{enabled:true,days:[1,2,3,4,5],start:'08:00',end:'17:00'}};
  const member={id:'M1',workSchedule:{enabled:true,days:[2,4],start:'07:30',end:'16:30'}};
  const tuesday=Org.scheduled(member,site,'2026-11-03',[]);
  assert.equal(tuesday.kind,'REQUIRED');assert.equal(new Date(tuesday.start).toISOString(),'2026-11-02T23:30:00.000Z');
  assert.equal(Org.scheduled(member,site,'2026-11-04',[]).kind,'REST');
  assert.equal(Org.scheduled(member,site,'2026-11-05',[]).kind,'REQUIRED');
});
test('Admin-created new member records remain eligible for immediate sync',()=>{
  const sync=source('sync.js'),app=source('app.js');
  assert.match(sync,/Number\(x\.baseRev\)>0/);
  assert.match(sync,/Number\(op\.baseRev\)===0&&!op\.value\?\.deleted&&op\.value\?\.template\?\.alg==='AES-GCM'/);
  assert.match(app,/submitPendingNow\(opId\)/);
  assert.match(sync,/priorityOperationId&&eligible\.find/);
});
test('Every cooperative-scoped Business Platform picker uses the cooperative mapping',()=>{
  const platforms=source('platforms.js'),org=source('org-core.js'),html=source('index.html');
  assert.match(platforms,/function fillScoped\(coopId,platformId,preferred\)/);
  assert.match(platforms,/function optionsForCoop\(coop\)/);
  for(const code of ['memberCoop','registerCoop','adminAccountCoop','adminMemberCoop','terminalLogCoop'])assert.ok(html.includes('id=\"'+code+'\"'));
  assert.match(platforms,/<b>'\+esc\(x\.coops\?\.join\('/);
  assert.ok(org.includes('"Tnalak":["MSG-SM"]'));
});

test('Member transfer and Admin edit save the validated weekly schedule centrally',()=>{
  const workSchedule={enabled:true,days:[1,3,5],start:'07:00',end:'16:00',grace:5};
  const {ctx,members}=backend(),user=ctx.tp5UserMemberTransferUpdateV2_(actor,{memberId:'TEST-1',baseRev:2,changes:{name:members[0].name,memberNumber:'TEST-1',coop:'Worklife',platform:'OCG',siteIds:['site-2'],workSchedule}});
  assert.deepEqual(JSON.parse(JSON.stringify(user.member.workSchedule)),workSchedule);
  assert.equal(user.member.workDays,'1,3,5');assert.equal(user.member.workStart,'07:00');assert.equal(user.member.workEnd,'16:00');assert.equal(user.member.workGrace,5);
  const {ctx:adminCtx,members:adminMembers}=backend(),admin=adminCtx.tp5AdminMemberUpdateV2_({id:'admin-1',role:'admin',username:'admin'},{memberId:'TEST-1',baseRev:2,changes:{name:adminMembers[0].name,memberNumber:'TEST-1',coop:'Asiapro',platform:'IMG',siteIds:['site-1'],workSchedule}});
  assert.deepEqual(JSON.parse(JSON.stringify(admin.member.workSchedule)),workSchedule);
  assert.equal(admin.member.workDays,'1,3,5');assert.equal(admin.member.workStart,'07:00');assert.equal(admin.member.workEnd,'16:00');assert.equal(admin.member.workGrace,5);
  assert.throws(()=>adminCtx.tp5AdminMemberUpdateV2_({id:'admin-1',role:'admin'},{memberId:'TEST-1',baseRev:2,changes:{name:adminMembers[0].name,coop:'Asiapro',platform:'IMG',siteIds:['site-1'],workSchedule:{enabled:true,days:[8],start:'07:00',end:'16:00'}}}),/valid work days/);
});
