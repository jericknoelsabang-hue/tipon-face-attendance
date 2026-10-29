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
  const ctx={Date,Map,Set,Number,TIPONOrgCore:Org,tp5Must_:(ok,message,code)=>{if(!ok)throw Object.assign(Error(message),{code});},tp5Find_:(type,id)=>(type==='members'?members:sites).find(x=>x.id===id),tp5Read_:type=>type==='sites'?sites:members,tp5ResolvePlatform_:x=>x,tp5SameLocations_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),tp5OldLocations_:x=>x.siteIds,tp5MemberOpenSession_:()=>false,tp5Now_:()=>new Date().toISOString(),tp5Safe_:x=>x,tp5Reply_:x=>x,tp5Put_:(...args)=>writes.push(args),tp5Bump_:()=>3,tp5RefreshMemberDirectory_:()=>{},tp5Audit_:(...args)=>audits.push(args),tp5MemberLocationResult_:(actor,old,next,action)=>{writes.push(next);audits.push(action);return {member:next};},tp5LocationIds_:(actor,coop,platform,ids)=>{assert.ok(ids.length);return ids;}};
  vm.createContext(ctx);vm.runInContext(source('backend-patch/MemberFaceTransfer.gs'),ctx);return {ctx,members,writes,audits};
}
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
  assert.equal((app.match(/async function editAttendanceFromLog\(/g)||[]).length,1);
  assert.equal((app.match(/attach\('kioskFullscreen','click'/g)||[]).length,0);
  assert.match(html,/id="memberSiteSummary"[^>]+aria-required="true"/);
  assert.match(html,/id="captureEnrollmentSample"/);
  assert.match(app,/if\(!siteIds.length\)/);
});
