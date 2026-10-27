/* Organization integration layer. Extends, rather than replaces, the v4.1 layout,
 * face matcher, selectable-camera capture and five-column XLSX writer.
 */
'use strict';
window.OrgDB=(()=>{
  const rawSave=saveOne,rawDelete=deleteOne;
  const entities=['offices','sites','members','schedules'];
  async function saveEntity(type,input){
    const auth=TIPONAuth.current(),u=state.user;
    if(!u||!canEdit()||!auth||auth.offlineUntil<Date.now())throw Error('A current approved enrollment/admin account is required.');
    if(type==='schedules'&&!isAdmin())throw Error('Only the administrator can change attendance schedules.');
    const old=await getOne(type,input.id);if(old?.orgId&&old.orgId!==state.orgId)throw Error('Record belongs to a different organization.');
    if(old&&u.role==='registrar'&&old.createdBy!==u.id)throw Error('Only the creator or administrator can edit this record.');
    let opId=uuid();let existingOp;
    if(old?._pendingOp){existingOp=await getOne('outbox',old._pendingOp);if(existingOp?.everSent)throw Error('This record is waiting for server acknowledgement. Sync before editing it again.');opId=old._pendingOp;}
    const value={...old,...input,orgId:state.orgId,createdBy:old?.createdBy||u.id,updatedAt:new Date().toISOString(),rev:Number(old?.rev)||0};
    if(type==='sites'){
      value.platform=!value.id.startsWith('office-')&&$('siteDialog')?.open?$('sitePlatform').value.trim():(value.platform||'');
      if(!value.id.startsWith('office-')&&$('siteDialog')?.open)value.schedule=OrgUI.readSiteSchedule();
    }
    if(type==='members'){
      const site=state.sites.find(s=>s.id===value.siteId)||await getOne('sites',value.siteId);value.platform=site?.platform||value.platform||'';
    }
    if(type!=='schedules'){
      if(!value.platform)throw Error('Business platform is required.');
      if(!TIPONOrgCore.inScope(u,value))throw Error('Use your approved cooperative and business platform.');
    }
    if(value.deleted&&!(isAdmin()||type==='members'&&u.role==='registrar'&&old?.createdBy===u.id))throw Error('Only the administrator or the member record creator can delete this record.');
    const wire={...value};delete wire._pendingOp;delete wire._row;
    if(type==='members'){
      if(!Array.isArray(value.descriptors)||value.descriptors.length<3)throw Error('Three facial samples are required.');
      wire.template=await TIPONAuth.seal(value.descriptors,auth.faceKey,'member:'+value.id);delete wire.descriptors;value.template=wire.template;
    }
    const operation={id:opId,type,value:wire,baseRev:Number(old?.rev)||0,orgId:state.orgId,ownerId:u.id,createdAt:existingOp?.createdAt||new Date().toISOString(),everSent:false};
    value._pendingOp=opId;
    await new Promise((resolve,reject)=>{const tx=db.transaction([type,'outbox'],'readwrite');const persisted={...value};if(type==='members')delete persisted.descriptors;tx.objectStore(type).put(persisted);tx.objectStore('outbox').put(operation);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    TIPONSync.kick();return value;
  }
  saveOne=async function(type,value){return entities.includes(type)?saveEntity(type,value):rawSave(type,value);};
  deleteOne=async function(type,id){if(entities.includes(type)){const old=await getOne(type,id),ownerMayDelete=type==='members'&&state.user?.role==='registrar'&&old?.createdBy===state.user.id;if(!isAdmin()&&!ownerMayDelete)throw Error('Only the administrator or the member record creator can delete this record.');if(old){const value=type==='members'?state.members.find(m=>m.id===id)||old:old;return saveEntity(type,{...value,deleted:true,active:false});}return;}return rawDelete(type,id);};
  return {rawSave,rawDelete,saveEntity};
})();
canEdit=()=>state.user?.role==='registrar'&&TIPONAuth.current()?.offlineUntil>Date.now();
isAdmin=()=>state.user?.role==='admin';
roleName=role=>({admin:'Administrator',registrar:'User',kiosk:'Physical Kiosk'}[role]||'Signed out');
loadCollections=async function(){
  const [allMembers,allSites,allPunches,schedules]=await Promise.all(['members','sites','punches','schedules'].map(getAll));
  const u=state.user,belongs=x=>x.orgId===state.orgId||(!x.orgId&&u?.role==='admin');
  state.sites=allSites.filter(x=>!x.deleted&&belongs(x)&&(u?.role==='admin'||u?.role==='kiosk'||u&&TIPONOrgCore.inScope(u,x)));
  // Physical kiosks identify members across the organization; assigned-office GPS is verified before recording.
  state.members=allMembers.filter(x=>!x.deleted&&belongs(x)&&(u?.role==='admin'||u?.role==='kiosk'||u&&TIPONOrgCore.inScope(u,x)));
  for(const m of state.members){if(m.template&&!m.descriptors){try{m.descriptors=await TIPONAuth.unseal(m.template,TIPONAuth.current().faceKey,'member:'+m.id);}catch{m.descriptors=[];m.templateError='Face template could not be decrypted; re-enroll after review.';}}}
  state.punches=allPunches.filter(x=>belongs(x)&&(u?.role==='admin'||u&&TIPONOrgCore.inScope(u,{...x,platform:x.platform||allSites.find(s=>s.id===x.siteId)?.platform}))).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
  state.schedules=schedules.filter(x=>belongs(x)&&!x.deleted);state.users=[];
};
loadOfficeDirectory=async function(){
  const local=await getAll('offices'),legacy=await getOne('meta','officeCatalogueV4');
  const values=new Map(TIPON_OFFICE_DATA.entries.map(x=>[x.id,{...x,origin:'Official-source reference'}]));
  for(const v of legacy?.entries||[])values.set(v.id,v);
  for(const v of local)if(!v.orgId||v.orgId===state.orgId)values.set(v.id,v);
  const u=state.user;state.offices=[...values.values()].filter(x=>!x.deleted&&(!u||u.role==='admin'||u.role==='registrar'&&x.coop===u.coop||u.role==='kiosk'&&state.sites.some(s=>s.officeId===x.id)));
};
enterApp=async function(){
  const bound=await getOne('meta','tp5-boundOrganization');
  if(bound&&bound.orgId!==state.orgId)throw Error('This browser profile already belongs to another organization. Use a separate browser profile; do not overwrite its data.');
  if(!bound)await OrgDB.rawSave('meta',{id:'tp5-boundOrganization',orgId:state.orgId});
  $('appShell').hidden=false;$('mobileNav').hidden=state.user?.role==='kiosk';
  setText('sidebarUserName',state.user.name);setText('sidebarUserRole',roleName(state.user.role));setText('avatarLetter',initial(state.user.name));setText('greetingName',state.user.name.split(' ')[0]);
  await loadCollections();await loadOfficeDirectory();await TIPONPlatforms.load();fillCoopSelect('memberCoop');
  const savedPage=await getOne('meta','tp5-last-page:'+state.user.id),defaultPage=isAdmin()?'dashboard':TIPONOrgCore.canUseTerminal(state.user)?'scanner':'members';
  const startPage=savedPage?.page&&TIPONOrgCore.allowed(state.user,savedPage.page)&&(savedPage.page!=='scanner'||hasTerminalSession())?savedPage.page:defaultPage;
  applyRoles();await showPage(startPage);refreshClock();await checkOfflineReady();
  if(isAdmin()&&state.user.defaultPassword)showToast('Change the initial administrator password in Settings before organization rollout.','info',10000);
};
applyRoles=function(){
  const u=state.user,kioskOnly=u?.role==='kiosk';
  document.body.classList.toggle('kiosk-mode',kioskOnly);
  if($('mobileNav'))$('mobileNav').hidden=kioskOnly;
  document.querySelectorAll('[data-page]').forEach(e=>e.hidden=!TIPONOrgCore.allowed(u,e.dataset.page));
  document.querySelectorAll('[data-jump]').forEach(e=>e.hidden=!TIPONOrgCore.allowed(u,e.dataset.jump));
  document.querySelectorAll('[data-admin-only]').forEach(e=>e.hidden=!isAdmin());
  document.querySelectorAll('[data-enrollment-only]').forEach(e=>e.hidden=!canEdit());
  document.querySelectorAll('[data-no-kiosk]').forEach(e=>e.hidden=u?.role==='kiosk');
  document.querySelectorAll('.nav-label').forEach(e=>{e.hidden=kioskOnly;});
  const terminalAllowed=hasTerminalSession();
  document.body.dataset.terminalAccess=terminalAllowed?'allowed':'denied';
  document.querySelectorAll('[data-page="scanner"],[data-jump="scanner"]').forEach(e=>{e.hidden=!terminalAllowed;e.setAttribute('aria-hidden',String(!terminalAllowed));e.toggleAttribute('disabled',!terminalAllowed);});
  document.querySelectorAll('#topStartScan,#dashScanButton').forEach(e=>{const hide=!terminalAllowed||kioskOnly;e.hidden=hide;e.setAttribute('aria-hidden',String(hide));e.toggleAttribute('disabled',hide);});
  if($('page-scanner'))$('page-scanner').setAttribute('aria-hidden',String(!terminalAllowed||state.page!=='scanner'));
  if(!terminalAllowed){
    if(state.scanning||state.scanStream)stopScanner().catch(console.warn);
    if(state.page==='scanner'){
      if($('page-scanner'))$('page-scanner').hidden=true;
      // An expired lease cannot open Members; avoid an endless redirect loop.
      const safePage=isAdmin()?'dashboard':canEdit()?'members':'settings';
      state.page=safePage;
      if(u)queueMicrotask(()=>showPage(safePage));
    }
  }
  $('logoutMobile').hidden=false;
  if($('kioskFullscreen'))$('kioskFullscreen').hidden=!TIPONOrgCore.canUseTerminal(u);if($('kioskExit'))$('kioskExit').hidden=u?.role!=='kiosk';
  if(window.TIPONPlatforms)TIPONPlatforms.render();
  ['importBackup','exportBackup'].forEach(id=>{if($(id))$(id).hidden=!isAdmin();});
};
const originalShowPage=showPage;
Object.assign(pageNames,{accounts:'Accounts & devices',reports:'Reports & schedules'});
showPage=async function(page){
  if(!TIPONOrgCore.allowed(state.user,page)||(page==='scanner'&&!hasTerminalSession())){showToast('Your account does not have permission for that screen.','error');return;}
  await originalShowPage(page);applyRoles();
  if(state.user)await OrgDB.rawSave('meta',{id:'tp5-last-page:'+state.user.id,page});
  if(page==='accounts')await OrgUI.renderAccounts();if(page==='reports')OrgUI.renderReports();if(page==='settings')OrgUI.renderSettings();if(page==='scanner')TIPONCamera.render();if(page==='terminalLogs')renderTerminalLogs();
};
const originalOpenMember=openMemberForm,originalOpenSite=openSiteForm;
openMemberForm=function(member){if(!canEdit())return;originalOpenMember(member);if(state.user.role==='registrar'){$('memberCoop').value=state.user.coop;$('memberCoop').disabled=true;fillMemberSites(member?.siteIds||member?.siteId);}else $('memberCoop').disabled=false;};
openSiteForm=function(site){if(!canEdit())return;originalOpenSite(site);TIPONPlatforms.fill('sitePlatform',site?.platform||(state.user.role==='registrar'?state.user.platform:''));
  $('siteCoop').disabled=state.user.role==='registrar';$('sitePlatform').disabled=state.user.role==='registrar';if(state.user.role==='registrar'){$('siteCoop').value=state.user.coop;fillSiteOffices(site?.officeId);}
  fillSiteOffices(site?.officeId);const plan=site?.schedule||{};$('siteScheduleEnabled').checked=!!plan.enabled;$('siteShiftStart').value=plan.start||'06:00';$('siteShiftEnd').value=plan.end||'15:00';$('siteGrace').value=plan.grace||0;
  document.querySelectorAll('[name="siteWorkDay"]').forEach(x=>x.checked=(plan.days||[1,2,3,4,5,6]).includes(Number(x.value)));
};
const oldRenderMembers=renderMembers,oldRenderSites=renderSites;
renderMembers=function(){oldRenderMembers();document.querySelectorAll('[data-member-delete]').forEach(x=>{const m=state.members.find(v=>v.id===x.dataset.memberDelete);x.hidden=!isAdmin()&&!(state.user?.role==='registrar'&&m?.createdBy===state.user?.id);});document.querySelectorAll('[data-member-edit]').forEach(x=>{const m=state.members.find(v=>v.id===x.dataset.memberEdit);x.disabled=!isAdmin()&&m?.createdBy!==state.user?.id;});};
renderSites=function(){oldRenderSites();document.querySelectorAll('[data-site-delete]').forEach(x=>x.hidden=!isAdmin());document.querySelectorAll('[data-site-edit]').forEach(x=>{const s=state.sites.find(v=>v.id===x.dataset.siteEdit);x.disabled=!isAdmin()&&s?.createdBy!==state.user?.id;});};
filteredAttendanceRows=function(){
  if(!isAdmin())throw Error('Only the administrator can export attendance.');
  return TIPONCore.filterRows(TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)),$('recordFrom').value,$('recordTo').value,$('recordSite').value);
};
const originalDashboard=renderDashboard;
renderDashboard=function(){
  if(!isAdmin())return;originalDashboard();OrgUI.renderMpc();
};
window.OrgUI=(()=>{
  let editingSchedule=null;
  function readSiteSchedule(){return {enabled:$('siteScheduleEnabled').checked,days:[...document.querySelectorAll('[name="siteWorkDay"]:checked')].map(x=>Number(x.value)),start:$('siteShiftStart').value,end:$('siteShiftEnd').value,grace:Number($('siteGrace').value)||0};}
  function csv(name,headers,rows){const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};downloadBlob(name,new Blob(['\ufeff'+[headers,...rows].map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));}
  function dashboardFilter(){return {coop:$('dashboardCoop').value,platform:$('dashboardPlatform').value};}
  function filteredMembers(){const f=dashboardFilter(),sites=new Map(state.sites.map(x=>[x.id,x]));return state.members.filter(m=>(!f.coop||m.coop===f.coop)&&(!f.platform||TIPONOrgCore.platformKey(m.platform||sites.get(m.siteId)?.platform)===TIPONOrgCore.platformKey(f.platform)));}
  function renderDashboardPlatformFilter(){
    const el=$('dashboardPlatform'),value=el.value;
    const names=TIPONOrgCore.platformNames([...(TIPONPlatforms?.names()||[]),...state.members.map(m=>m.platform),...state.punches.map(e=>e.platform),value]);
    const html='<option value="">All business platforms</option>'+names.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
    if(el.innerHTML!==html)el.innerHTML=html;el.value=value;
  }
  function renderMpc(){
    if(!isAdmin())return;
    if(!$('dashboardDay').value)$('dashboardDay').value=todayPH();renderDashboardPlatformFilter();
    const day=$('dashboardDay').value,f=dashboardFilter(),members=filteredMembers();
    renderOverview(day,f.coop,f.platform);
    const result=TIPONOrgCore.dashboard(members,state.sites,state.punches.filter(p=>!p.reviewStatus),day,state.schedules||[]);
    $('mpcRows').innerHTML=result.groups.map(r=>'<tr>'+[r.coop,r.enrolled,r.scheduled,r.present,r.clockedIn,r.late,r.missing,r.absent,r.rest+r.leave,r.unscheduled].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="10">No enrolled members for this MPC / BP selection.</td></tr>';
    const filter=$('presenceFilter').value;
    $('presenceRows').innerHTML=result.details.filter(r=>!filter||r.status.includes(filter)).map(r=>`<tr><td>${esc(r.memberId)}</td><td>${esc(r.name)}</td><td>${esc(r.coop)}</td><td>${esc(r.platform)}</td><td>${esc(r.site)}</td><td><span class="badge ${r.status==='PRESENT'?'green':r.status.includes('ABSENT')?'amber':'gray'}">${esc(r.status)}${r.late?' / LATE':''}</span></td></tr>`).join('')||'<tr><td colspan="6">No members for this selection.</td></tr>';
    const devices=state.devices||[],stale=devices.filter(d=>!d.disabled&&Date.now()-Date.parse(d.lastSeen)>300000).length;
    setText('absenceCaution',`Absence is provisional and needs a schedule. ${stale} registered device(s) last seen over 5 minutes ago. Offline punches are not visible centrally until uploaded. No schedule = Unscheduled, not Absent. Member-status filter applies only to the individual list.`);
    const legacy=state.members.some(m=>!m.orgId)||state.sites.some(s=>!s.orgId)||state.punches.some(p=>!p.orgId);$('legacyNotice').hidden=!legacy;
  }
  function renderOverview(day,coop,platform){
    const data=TIPONOrgCore.overview(state.members,state.punches,day,TIPONOrgCore.COOPS,{coop,platform,sites:state.sites,platforms:TIPONPlatforms.names()});
    const today=day===todayPH();
    // Top KPIs always span all MPCs and BPs, regardless of the two dropdowns.
    setText('metricMembers',data.overall.members);setText('metricPresent',data.overall.present);setText('metricPunches',data.overall.entries);
    setText('metricSites',state.sites.filter(s=>!s.deleted).length);
    setText('metricPresentLabel',today?'Present today':'Present on selected day');
    setText('metricEntriesHint',(today?"Today's":"Selected day's")+' time in & out / all MPCs & BPs');
    setText('overallScopeNote','OVERALL / all MPCs and business platforms / '+day+' / MPC and BP filters affect only the breakdown below.');
    setText('selectedScopeLabel',(coop||'All MPCs')+' / '+(platform||'All business platforms'));
    setText('filteredMembers',data.filtered.members);setText('filteredPresent',data.filtered.present);setText('filteredEntries',data.filtered.entries);
    setText('filteredPending',data.filtered.pending?data.filtered.pending+' local event(s) waiting to sync':'Based on records available on this device.');
    setText('mpcOverviewTitle','MPC overview / '+day);
    $('mpcOverviewCards').innerHTML=data.groups.map(g=>`<article class="mpc-overview-card" data-mpc="${esc(g.coop)}"><div class="mpc-card-name"><span class="mpc-card-dot"></span><h4>${esc(g.coop)}</h4></div><div class="mpc-card-metrics"><div><strong>${g.members}</strong><span>Members</span></div><div><strong>${g.present}</strong><span>${today?'Present today':'Present'}</span></div><div><strong>${g.entries}</strong><span>Attendance entries</span></div></div>${g.pending?`<small class="mpc-pending">${g.pending} local event(s) waiting to sync</small>`:'<small class="mpc-synced">Based on available records</small>'}</article>`).join('')||'<p>No MPC matches this selection.</p>';
    $('bpOverviewRows').innerHTML=data.bpGroups.map(g=>`<tr data-bp="${esc(g.platform)}"><td>${esc(g.platform)}</td><td>${g.members}</td><td>${g.present}</td><td>${g.entries}</td></tr>`).join('')||'<tr><td colspan="4">No business platforms for this selection.</td></tr>';
    setText('bpOverviewScope',(coop||'All MPCs')+' / '+day+' / '+(platform||'All business platforms'));
    setText('mpcOverviewNote','Members = active enrolled members. Present = unique members with a Time In on the Philippine calendar date. Entries = individual Time In + Time Out events; IN and OUT count as two. Overall totals stay visible. Offline-device punches appear centrally only after upload.');
  }
  function renderReports(){
    if(!isAdmin())return;const from=$('reportFrom').value,to=$('reportTo').value,coop=$('reportCoop').value;
    const rows=TIPONCore.filterRows(TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)),from,to,'').filter(r=>!coop||r.coop===coop);
    const summary=TIPONOrgCore.periodSummary(rows);
    $('summaryRows').innerHTML=summary.map(r=>`<tr><td>${esc(r.memberId)}</td><td>${esc(r.name)}</td><td>${esc(r.coop)}</td><td>${r.sessions}</td><td>${r.complete}</td><td>${r.hours.toFixed(2)}</td><td>${r.open}</td></tr>`).join('')||'<tr><td colspan="7">No sessions for this period.</td></tr>';
    const schedules=state.schedules||[];$('scheduleRows').innerHTML=schedules.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.memberId)}</td><td>${esc(r.status)}</td><td>${esc(r.start||'')}</td><td>${esc(r.end||'')}</td><td>${esc(r.note||'')}</td></tr>`).join('')||'<tr><td colspan="6">Use a site schedule or add a member/date override for leave, rest or a specific shift.</td></tr>';
    $('scheduleMember').innerHTML=state.members.map(m=>`<option value="${esc(m.id)}">${esc(m.id)} - ${esc(m.name)}</option>`).join('');
  }
  async function renderAccounts(){
    if(!isAdmin())return;
    try{const r=await TIPONAPI.call({action:'accounts'});state.accounts=r.accounts;state.devices=r.devices;state.reviews=r.reviews;await OrgDB.rawSave('meta',{id:'tp5-accountSnapshot',orgId:state.orgId,accounts:r.accounts,devices:r.devices,reviews:r.reviews});}
    catch(e){const saved=await getOne('meta','tp5-accountSnapshot');if(saved?.orgId===state.orgId){state.accounts=saved.accounts;state.devices=saved.devices;state.reviews=saved.reviews;}showToast('Account changes need internet. '+e.message,'info');}
    $('accountRows').innerHTML=(state.accounts||[]).filter(u=>!u.deleted).map(u=>`<tr><td><b>${esc(u.name)}</b><small>${esc(u.username)}</small><small>${esc(u.email)}</small></td><td>${esc(u.position)}<small>${esc(u.office)}</small><small>${u.officeLat!=null&&u.officeLng!=null?esc(Number(u.officeLat).toFixed(6)+', '+Number(u.officeLng).toFixed(6)):''}</small></td><td>${esc(u.coop)}<small>${esc(u.platform)}</small></td><td>${esc(roleName(u.role))}</td><td><span class="badge ${u.status==='active'?'green':'amber'}">${esc(u.status)}</span></td><td>${u.role==='admin'?'Sole administrator':`<button class="tiny-button" data-account-status="active" data-account-id="${esc(u.id)}">Approve / enable</button> <button class="tiny-button" data-account-status="disabled" data-account-id="${esc(u.id)}">Disable</button> <button class="tiny-button delete" data-account-delete="${esc(u.id)}">Delete</button>`}</td></tr>`).join('');
    $('deviceRows').innerHTML=(state.devices||[]).map(d=>`<tr><td>${esc(d.id.slice(0,12))}</td><td>${esc(d.userName)}<small>${esc(d.role)}</small></td><td>${esc(displayStamp(d.lastSeen))}</td><td>${d.disabled?'Disabled':Date.now()-Date.parse(d.lastSeen)>300000?'Stale / possibly offline':'Recently connected'}</td><td><button class="tiny-button" data-device-id="${esc(d.id)}" data-device-disabled="${!d.disabled}">${d.disabled?'Enable':'Disable'}</button></td></tr>`).join('');
    $('reviewRows').innerHTML=(state.reviews||[]).map(r=>`<tr><td>${esc(r.event?.memberId)}</td><td>${esc(r.event?.type)}</td><td>${esc(r.event?.timestamp)}</td><td>${esc(r.code)}</td><td>${esc(r.error)}</td><td>${esc(r.resolution||'Needs administrator review')}</td></tr>`).join('')||'<tr><td colspan="6">No server-side review records.</td></tr>';
  }
  function renderSettings(){
    if(!state.user)return;
    setText('signedInAs',`${state.user.name} | ${roleName(state.user.role)}`);
    setText('offlineAccountStatus','Offline account/kiosk lease valid until '+displayStamp(TIPONAuth.current().offlineUntil)+'. Revocation is checked when online; keep devices secured.');

    TIPONSync.render();renderQueue();
  }
  async function renderQueue(){
    const queue=(await getAll('outbox')).filter(o=>o.orgId===state.orgId&&(isAdmin()||o.ownerId===state.user?.id));
    $('entityQueueRows').innerHTML=queue.map(o=>`<tr><td>${esc(o.type)}</td><td>${esc(o.value.name||o.value.id)}</td><td>${esc(o.error||'Waiting to upload')}</td><td>${o.everSent?'Sent; awaiting acknowledgement':'Not sent yet'}</td></tr>`).join('')||'<tr><td colspan="4">No pending directory edits for this account.</td></tr>';
  }
  async function backup(){
    if(!isAdmin())return;const pass=prompt('Password for this encrypted device backup (at least 8 characters). Keep it separately from the backup.');if(pass===null)return;if(pass.length<8){showToast('Use at least 8 characters.','error');return;}
    const data={version:5,orgId:state.orgId,createdAt:new Date().toISOString()};for(const t of ['members','sites','offices','punches','schedules','outbox'])data[t]=await getAll(t);
    const file=await encryptBackup(pass,data);downloadBlob('TIPON_Device_Backup_'+todayPH()+'.json',new Blob([JSON.stringify(file)],{type:'application/json'}));showToast('Encrypted backup saved. Account passwords and server keys were not exported.','success');
  }
  async function restore(event){
    const file=event.target.files?.[0];event.target.value='';if(!file||!isAdmin())return;
    try{if(file.size>50000000)throw Error('Backup exceeds 50 MB.');const pass=prompt('Enter the backup password.');if(pass===null)return;const data=await decryptBackup(pass,JSON.parse(await file.text()));
      if(data.orgId&&data.orgId!==state.orgId)throw Error('Backup belongs to another organization.');
      if(!await confirmAction('Merge device backup?','Existing record IDs are retained. Accounts, credentials and server settings will not be restored. Restored records may need migration/sync.'))return;
      for(const type of ['members','sites','offices','punches','schedules','outbox'])for(const item of data[type]||[]){if(!item.id||await getOne(type,item.id))continue;const clean={...item};await OrgDB.rawSave(type,clean);}
      await loadCollections();await loadOfficeDirectory();showToast('Backup merged without overwriting existing IDs. Review before syncing.','success');
    }catch(e){toastError(e,'Restore');}
  }
  async function migrateLegacy(){
    if(!isAdmin())return;const bp=$('migrationPlatform').value.trim();
    if(!bp){showToast('Enter the approved business platform for the local legacy data.','error');return;}
    if(!$('migrationConfirm').checked){showToast('Confirm the biometric sync notice and the reused worksite GPS coordinates first.','error');return;}
    if(!await confirmAction('Migrate local v4 records?', 'This uploads old attendance plus encrypted numeric face templates after sync. Existing worksite coordinates will be retained; generated office entries use those worksite coordinates, NOT a guessed head-office address. Review every migrated office.'))return;
    try{
      const oldSites=(await getAll('sites')).filter(x=>!x.orgId&&!x.deleted);
      for(const s of oldSites){
        const office={id:'migrated-office-'+s.id,name:s.satelliteOffice||s.name,coop:s.coop,platform:bp,address:s.address||s.name,lat:s.lat,lng:s.lng,radius:s.radius,userConfirmed:true,source:'Legacy worksite point; verify actual office address',type:'Migrated worksite office point'};
        await saveOne('offices',office);await saveOne('sites',{...s,officeId:office.id,satelliteOffice:office.name,platform:bp,schedule:{enabled:false}});
      }
      await loadCollections();await loadOfficeDirectory();
      for(const m of (await getAll('members')).filter(x=>!x.orgId&&!x.deleted))await saveOne('members',m);
      for(const p of (await getAll('punches')).filter(x=>!x.orgId))await OrgDB.rawSave('punches',{...p,orgId:state.orgId,siteRev:0,cloudAck:false,deviceId:p.deviceId||state.deviceId});
      await loadCollections();renderDashboard();showToast('Legacy data queued. Confirm migrated offices, then keep this app open until acknowledged.','success',10000);TIPONSync.kick();
    }catch(e){toastError(e,'Migration paused; completed local steps were retained');}
  }
  function bind(){
    ['registerCoop','dashboardCoop','reportCoop'].forEach(id=>fillCoopSelect(id,['dashboardCoop','reportCoop'].includes(id)));
    ['dashboardDay','dashboardCoop','dashboardPlatform','presenceFilter'].forEach(id=>attach(id,'change',renderMpc));attach('dashboardRefresh','click',()=>TIPONSync.kick());attach('dashboardResetFilters','click',()=>{$('dashboardCoop').value='';$('dashboardPlatform').value='';$('presenceFilter').value='';renderMpc();});
    ['reportFrom','reportTo','reportCoop'].forEach(id=>attach(id,'change',renderReports));
    attach('sitePlatform','change',()=>fillSiteOffices());
    attach('importOffices','click',()=>$('officeCsvFile').click());attach('officeCsvFile','change',importOfficeCSV);
    attach('officeCsvTemplate','click',()=>downloadBlob('TIPON_Office_Masterlist_Template.csv',new Blob(['\uFEFF'+window.TIPON_OFFICE_CSV_HEADERS.join(',')+'\r\n'],{type:'text/csv;charset=utf-8'})));
    attach('refreshAccounts','click',renderAccounts);
    attach('accountRows','click',async e=>{
      const del=e.target.closest('[data-account-delete]');
      if(del){
        const u=state.accounts.find(x=>x.id===del.dataset.accountDelete);
        if(!u||!await confirmAction('Delete account?',`${u.name} will no longer be able to sign in. The audit history remains.`))return;
        try{await TIPONAPI.call({action:'accountDelete',userId:u.id});await renderAccounts();}catch(err){toastError(err,'Delete account');}
        return;
      }
      const b=e.target.closest('[data-account-id]');if(!b)return;
      const u=state.accounts.find(x=>x.id===b.dataset.accountId);
      if(!u||!await confirmAction('Update account approval?',`${u.name}: ${b.dataset.accountStatus}. Type: ${roleName(u.role)}.`))return;
      try{await TIPONAPI.call({action:'accountUpdate',userId:u.id,status:b.dataset.accountStatus});await renderAccounts();}catch(err){toastError(err,'Account update');}
    });
    attach('deviceRows','click',async e=>{const b=e.target.closest('[data-device-id]');if(!b)return;if(!await confirmAction('Update device?', 'Online API access changes immediately. An already offline terminal cannot receive revocation until it reconnects.'))return;try{await TIPONAPI.call({action:'deviceUpdate',targetDeviceId:b.dataset.deviceId,disabled:b.dataset.deviceDisabled==='true'});await renderAccounts();}catch(err){toastError(err,'Device update');}});
    attach('addSchedule','click',()=>{if(!isAdmin())return;renderReports();$('scheduleForm').reset();$('scheduleDate').value=todayPH();$('scheduleDialog').showModal();});
    attach('scheduleForm','submit',async e=>{e.preventDefault();try{const r={id:'schedule-'+$('scheduleMember').value+'-'+$('scheduleDate').value,memberId:$('scheduleMember').value,date:$('scheduleDate').value,status:$('scheduleStatus').value,start:$('scheduleStart').value,end:$('scheduleEnd').value,grace:Number($('scheduleGrace').value)||0,note:$('scheduleNote').value.trim(),enabled:true};await saveOne('schedules',r);await loadCollections();$('scheduleDialog').close();renderReports();}catch(err){toastError(err,'Schedule');}});
    attach('exportPeriodSummary','click',()=>{if(!isAdmin())return;const rows=TIPONCore.filterRows(TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)),$('reportFrom').value,$('reportTo').value,'').filter(r=>!$('reportCoop').value||r.coop===$('reportCoop').value);csv('TIPON_Period_Summary.csv',['MemberId','Name','Cooperative','Sessions','Completed','Hours','Open sessions'],TIPONOrgCore.periodSummary(rows).map(r=>[r.memberId,r.name,r.coop,r.sessions,r.complete,r.hours.toFixed(2),r.open]));});
    attach('exportPresence','click',()=>{if(!isAdmin())return;const d=TIPONOrgCore.dashboard(filteredMembers(),state.sites,state.punches.filter(p=>!p.reviewStatus),$('dashboardDay').value,state.schedules||[]).details.filter(r=>!$('presenceFilter').value||r.status.includes($('presenceFilter').value));csv('TIPON_Daily_Status.csv',['Date','MemberId','Name','Cooperative','Business platform','Site','Status','Late'],d.map(r=>[$('dashboardDay').value,r.memberId,r.name,r.coop,r.platform,r.site,r.status,r.late?'Yes':'No']));});
    attach('migrateLegacy','click',migrateLegacy);
  }
  saveEncryptedBackup=backup;restoreEncryptedBackup=restore;
  return {bind,readSiteSchedule,renderMpc,renderOverview,renderReports,renderAccounts,renderSettings,renderQueue,csv};
})();
function fillCoopSelect(id,allowAll=false){const el=$(id);if(!el)return;const old=el.value,options=TIPONOrgCore.COOPS;el.innerHTML=(allowAll?'<option value="">All cooperatives</option>':'<option value="">Select cooperative</option>')+options.map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');if(options.includes(old))el.value=old;}
window.TIPON_OFFICE_CSV_HEADERS=Object.freeze(['Cooperative','Business platform','Office','Address','Latitude','Longitude','Radius','Approval reference']);
function parseOfficeCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}
 if(quoted)throw Error('CSV contains an unclosed quote.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
/* Approved office CSV import writes the same durable, scoped queue as the form. */
async function importOfficeCSV(event){
 const file=event.target.files?.[0];event.target.value='';if(!file||!isAdmin())return;
 const headers=window.TIPON_OFFICE_CSV_HEADERS;
 try{if(file.size>1000000)throw Error('Office CSV limit is 1 MB.');const rows=parseOfficeCSV((await file.text()).replace(/^\uFEFF/,''));if(JSON.stringify(rows[0])!==JSON.stringify(headers))throw Error('Use the v5 office template with eight columns.');if(rows.length<2||rows.length>501)throw Error('Import 1 to 500 offices at a time.');
  const keys=new Set(),items=rows.slice(1).map((r,i)=>{if(r.length!==8)throw Error('Wrong field count on row '+(i+2));const [coop,platform,name,address,a,b,c,source]=r.map(x=>x.trim()),lat=Number(a),lng=Number(b),radius=Number(c);if(!TIPONOrgCore.COOPS.includes(coop)||!platform||!name||!address||!source||!a||!b||!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lng)||Math.abs(lng)>180||radius<20||radius>2000)throw Error('Invalid office / actual GPS / approval reference on row '+(i+2));const key=coop+'|'+platform+'|'+name.toLowerCase();if(keys.has(key))throw Error('Duplicate office: '+name);keys.add(key);const old=state.offices.find(o=>o.coop===coop&&o.platform===platform&&o.name.toLowerCase()===name.toLowerCase());return {id:old?.id||uuid(),coop,platform,name,address,lat,lng,radius,source,userConfirmed:true,type:'Approved organization office',confirmedAt:new Date().toISOString()};});
  if(!await confirmAction('Import approved office coordinates?',items.length+' offices will be saved and queued. Existing worksites and historical attendance are not changed.'))return;
  for(const row of items)await saveOne('offices',row);await loadOfficeDirectory();renderOfficeDirectory();showToast(items.length+' offices queued. Add matching work locations before member enrollment.','success');
 }catch(e){toastError(e,'Office import paused; completed rows retained');}
};

const originalFillSiteOffices=fillSiteOffices;
fillSiteOffices=function(preferred){
 const coop=$('siteCoop').value,platform=$('sitePlatform')?.value.trim();
 const rows=state.offices.filter(o=>o.coop===coop&&(!o.orgId||o.orgId===state.orgId)&&(!platform||!o.platform||TIPONOrgCore.platformKey(o.platform)===TIPONOrgCore.platformKey(platform)));
 $('siteOffice').innerHTML='<option value="">Select approved satellite office</option>'+rows.map(o=>`<option value="${esc(o.id)}">${esc(o.name)} / ${esc(o.platform)}</option>`).join('');
 if(rows.some(o=>o.id===preferred))$('siteOffice').value=preferred;
 setText('siteOfficeHint','Select an office from the approved reference list. Add missing offices using the approved masterlist import.');
};

window.addEventListener('DOMContentLoaded',()=>{
 if(typeof enterApp==='function'&&typeof TIPONAuth!=='undefined')window.TIPONWorkspaceEnter=()=>enterApp();
},{once:true});
