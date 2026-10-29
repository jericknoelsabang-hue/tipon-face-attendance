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
  assert.ok(data.rows[3].openSessions.some(session=>session.member.id==='M1'));
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
  assert.match(html,/liveness-guard\.js\?v=5543/);
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
  assert.doesNotMatch(app.slice(app.indexOf('function editAttendanceFromLog('),app.indexOf('function openAttendanceReview(')),/prompt\(/);
});
test('Published assets share one release version and pagination controls cannot overflow',()=>{
  const html=source('index.html'),sw=source('sw.js'),release=JSON.parse(source('release.json'));
  assert.equal(release.version,'5.5.43');
  assert.match(sw,/const VERSION='5\.5\.43';/);
  assert.match(sw,/tipon-face-shell-v5\.5\.43-github-only/);
  assert.match(html,/core\.js\?v=5543/);
  assert.match(html,/app\.js\?v=5543/);
  assert.match(html,/liveness-guard\.js\?v=5543/);
  assert.match(source('app.js'),/const MATCH_LIMIT=\.60;/);
  assert.match(html,/id="captureEnrollmentSample"/);
  assert.match(html,/id="memberSiteSummary"[^>]+aria-required="true"/);
  assert.doesNotMatch(html,/Assigned Work Location <span class="field-optional">\(Optional\)/);
  assert.doesNotMatch(source('app.js'),/prompt\(['"]Reason for deleting this attendance session/);
  assert.ok(html.includes('style.css?v=5543'));
  assert.ok(html.includes('polish.css?v=5543'));
  assert.match(source('polish.css'),/\.admin-list-pager-actions/);
  assert.ok(source('polish.css').includes('#adminMemberDialog input'));
  const reviewStart=html.indexOf('<div class="ab-review-heading">'),reviewEnd=html.indexOf('</section>',reviewStart),review=html.slice(reviewStart,reviewEnd);
  assert.equal(review.includes('<th>Action</th>'),false);
  assert.equal(review.includes('<th>Date</th>'),true);
  assert.match(review,/id="absReviewPrev"/);
  assert.match(review,/id="absReviewNext"/);
  assert.match(source('app.js'),/const SCAN_DELAY_MS=650;/);
  assert.doesNotMatch(source('app.js'),/disabled title="Complete Time Out before deleting this session\."/);
  assert.match(source('app.js'),/changes\.timeOut=attendanceInputStamp\(outDate,outTime\)/);
});
test('Member dropdown includes all known Business Platforms and remains editable for Users',()=>{
  const controls={memberPlatform:{value:'AP Cons',innerHTML:'',disabled:false},sitePlatform:{value:'AP Cons',innerHTML:'',disabled:false}};
  const ctx={TIPONOrgCore:Org,state:{user:{...actor,platform:'AP Cons'},platforms:['CUSTOM'],sites:[],members:[]},$:id=>controls[id],esc:x=>x,console};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source('platforms.js'),ctx);
  ctx.TIPONPlatforms.fill('memberPlatform','AP Cons');assert.equal(controls.memberPlatform.disabled,false);
  for(const code of ['ATS','IMG','MSG-SM','CUSTOM','OCG'])assert.ok(controls.memberPlatform.innerHTML.includes('value="'+code+'"'));
  ctx.TIPONPlatforms.fill('sitePlatform','AP Cons');assert.equal(controls.sitePlatform.disabled,true);
});
test('Editable Member ID preserves the internal record/template key and rejects duplicates',()=>{
  const {ctx,members}=backend();members.push({id:'other',memberNumber:'BUSINESS-2'});
  const result=ctx.tp5TransferUpdate_(actor,{memberId:'TEST-1',baseRev:2,changes:{name:'Synthetic Member',memberNumber:'BUSINESS-1',coop:'Asiapro',platform:'IMG',siteIds:['site-1']}});
  assert.equal(result.member.id,'TEST-1');assert.equal(result.member.memberNumber,'BUSINESS-1');assert.equal(result.member.template,members[0].template);
  assert.throws(()=>ctx.tp5TransferUpdate_(actor,{memberId:'TEST-1',baseRev:2,changes:{name:'Synthetic Member',memberNumber:'business-2',coop:'Asiapro',platform:'IMG',siteIds:['site-1']}}),/already registered/);
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
  assert.ok(app.includes("const action=isAdmin()?'adminMemberUpdateV2':'memberTransferUpdateV2'"));
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
  for(let i=0;i<3;i++){ctx.state.enrollReadyDescriptor=Array(128).fill(.1+i*.01);ctx.state.enrollReadyAt=Date.now();ctx.state.enrollLiveness={passed:true};await capture();}
  assert.equal(ctx.state.pendingDescriptors.length,3);assert.equal(ctx.state.enrollmentProof.memberId,'STABLE-KEY');assert.equal(saves,1);
});
