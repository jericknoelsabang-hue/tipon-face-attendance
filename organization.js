/* Organization integration layer. Extends, rather than replaces, the v4.1 layout,
 * face matcher, selectable-camera capture and five-column XLSX writer.
 */
'use strict';
window.OrgDB=(()=>{
  const rawSave=saveOne,rawDelete=deleteOne;
  const entities=['sites','members','schedules'];
  async function saveEntity(type,input){
    const auth=TIPONAuth.current(),u=state.user;
    if(!u||!(canEdit()||isAdmin())||!auth||auth.offlineUntil<Date.now())throw Error('A current approved enrollment/admin account is required.');
    if(type==='schedules'&&!isAdmin())throw Error('Only the administrator can change attendance schedules.');
    const old=await getOne(type,input.id);if(old?.orgId&&old.orgId!==state.orgId)throw Error('Record belongs to a different organization.');
    if(old&&u.role==='registrar'&&old.createdBy!==u.id&&!((type==='sites'||type==='members'&&(old.importedWithoutFace===true||old.importPending===true&&!old.template))&&TIPONOrgCore.inScope(u,old)))throw Error('Only the creator or administrator can edit this record.');
    let opId=uuid();let existingOp;
    if(old?._pendingOp){existingOp=await getOne('outbox',old._pendingOp);if(existingOp?.everSent)throw Error('This record is waiting for server acknowledgement. Sync before editing it again.');opId=old._pendingOp;}
    const value={...old,...input,orgId:state.orgId,createdBy:old?.createdBy||u.id,updatedAt:new Date().toISOString(),rev:Number(old?.rev)||0};
    if(type==='sites'){
      value.platform=$('siteDialog')?.open?$('sitePlatform').value.trim():(value.platform||'');
      if($('siteDialog')?.open)value.schedule=OrgUI.readSiteSchedule();
    }
    if(type==='members'){
      const site=value.siteId?(state.sites.find(s=>s.id===value.siteId)||await getOne('sites',value.siteId)):null;value.platform=site?.platform||value.platform||'';
    }
    if(type!=='schedules'){
      if(!value.platform)throw Error('Business platform is required.');
      if(!TIPONOrgCore.inScope(u,value))throw Error('Use your approved cooperative and business platform.');
    }
    if(value.deleted&&!(isAdmin()||u.role==='registrar'&&(type==='members'&&old?.createdBy===u.id||type==='sites'&&old&&TIPONOrgCore.inScope(u,old))))throw Error('Only the administrator or record creator can delete this record.');
    if(type==='members'||type==='sites'){delete value.officeId;delete value.satelliteOffice;}
    const wire={...value};delete wire._pendingOp;delete wire._row;
    if(type==='members'){
      const hasFace=Array.isArray(value.descriptors)&&value.descriptors.length>=3;
      if(!hasFace&&!(isAdmin()&&value.importedWithoutFace===true&&!old?.template))throw Error('Three facial samples are required.');
      if(hasFace){
        wire.template=await TIPONAuth.seal(value.descriptors,auth.faceKey,'member:'+value.id);
        value.template=wire.template;
        wire.active=value.active=true;
        wire.importPending=value.importPending=false;
        wire.importedWithoutFace=value.importedWithoutFace=false;
        wire.faceEnrollmentStatus=value.faceEnrollmentStatus='enrolled';
        if(old&&!old.template&&(old.importPending===true||old.importedWithoutFace===true)){
          wire.createdBy=value.createdBy=u.id;
        }
      }else{
        // Uploaded members remain inactive until the authorized User completes face enrollment.
        wire.active=value.active=false;
        wire.importPending=value.importPending=true;
        wire.importedWithoutFace=value.importedWithoutFace=true;
        wire.faceEnrollmentStatus=value.faceEnrollmentStatus='pending';
        delete wire.template;delete value.template;
      }
      delete wire.descriptors;
    }
    const operation={id:opId,type,value:wire,baseRev:Number(old?.rev)||0,orgId:state.orgId,ownerId:u.id,createdAt:existingOp?.createdAt||new Date().toISOString(),everSent:false};
    value._pendingOp=opId;
    await new Promise((resolve,reject)=>{const tx=db.transaction([type,'outbox'],'readwrite');const persisted={...value};if(type==='members')delete persisted.descriptors;tx.objectStore(type).put(persisted);tx.objectStore('outbox').put(operation);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    TIPONSync.kick();return value;
  }
  saveOne=async function(type,value){return entities.includes(type)?saveEntity(type,value):rawSave(type,value);};
  deleteOne=async function(type,id){if(entities.includes(type)){const old=await getOne(type,id),ownerMayDelete=state.user?.role==='registrar'&&(type==='members'&&old?.createdBy===state.user.id||type==='sites'&&old&&TIPONOrgCore.inScope(state.user,old));if(!isAdmin()&&!ownerMayDelete)throw Error('Only the administrator or record creator can delete this record.');if(old){const value=type==='members'?state.members.find(m=>m.id===id)||old:old;return saveEntity(type,{...value,deleted:true,active:false});}return;}return rawDelete(type,id);};
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
enterApp=async function(){
  const bound=await getOne('meta','tp5-boundOrganization');
  if(bound&&bound.orgId!==state.orgId)throw Error('This browser profile already belongs to another organization. Use a separate browser profile; do not overwrite its data.');
  if(!bound)await OrgDB.rawSave('meta',{id:'tp5-boundOrganization',orgId:state.orgId});
  $('appShell').hidden=false;$('mobileNav').hidden=state.user?.role==='kiosk';
  setText('sidebarUserName',state.user.name);setText('sidebarUserRole',roleName(state.user.role));setText('avatarLetter',initial(state.user.name));setText('greetingName',state.user.name.split(' ')[0]);
  await loadCollections();await TIPONPlatforms.load();fillCoopSelect('memberCoop');
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
Object.assign(pageNames,{accounts:'Accounts & devices',members:'Member list'});
function refreshWorkspaceViews(){
 if(!state.user)return;
 if(state.page==='terminalLogs'||state.page==='records')renderTerminalLogs();
 if(state.page==='members')renderMembers();
 if(state.page==='sites')renderSites();
}
window.addEventListener('tipon:workspace-data-updated',refreshWorkspaceViews);
showPage=async function(page){
  if(!TIPONOrgCore.allowed(state.user,page)||(page==='scanner'&&!hasTerminalSession())){showToast('Your account does not have permission for that screen.','error');return;}
  await originalShowPage(page);applyRoles();
  if(state.user)await OrgDB.rawSave('meta',{id:'tp5-last-page:'+state.user.id,page});
  if(page==='accounts')await OrgUI.renderAccounts();if(page==='settings')OrgUI.renderSettings();if(page==='scanner')TIPONCamera.render();if(page==='terminalLogs')renderTerminalLogs();
};
const originalOpenMember=openMemberForm,originalOpenSite=openSiteForm;
openMemberForm=function(member){if(!canEdit())return;originalOpenMember(member);if(state.user.role==='registrar'){$('memberCoop').value=state.user.coop;$('memberCoop').disabled=true;fillMemberSites(member?.siteIds||member?.siteId);}else $('memberCoop').disabled=false;};
openSiteForm=function(site){if(!canEdit())return;originalOpenSite(site);TIPONPlatforms.fill('sitePlatform',site?.platform||(state.user.role==='registrar'?state.user.platform:''));
  $('siteCoop').disabled=state.user.role==='registrar';$('sitePlatform').disabled=state.user.role==='registrar';if(state.user.role==='registrar')$('siteCoop').value=state.user.coop;
  const plan=site?.schedule||{};$('siteScheduleEnabled').checked=!!plan.enabled;$('siteShiftStart').value=plan.start||'06:00';$('siteShiftEnd').value=plan.end||'15:00';$('siteGrace').value=plan.grace||0;
  document.querySelectorAll('[name="siteWorkDay"]').forEach(x=>x.checked=(plan.days||[1,2,3,4,5,6]).includes(Number(x.value)));
};
const oldRenderMembers=renderMembers,oldRenderSites=renderSites;
renderMembers=function(){oldRenderMembers();document.querySelectorAll('[data-member-delete]').forEach(x=>{const m=state.members.find(v=>v.id===x.dataset.memberDelete);x.hidden=!isAdmin()&&!(state.user?.role==='registrar'&&m?.createdBy===state.user?.id);});document.querySelectorAll('[data-member-edit]').forEach(x=>{const m=state.members.find(v=>v.id===x.dataset.memberEdit);x.disabled=!canEdit()||!(m?.createdBy===state.user?.id||(m?.importedWithoutFace===true||m?.importPending===true&&!m?.template)&&TIPONOrgCore.inScope(state.user,m));});};
renderSites=function(){oldRenderSites();document.querySelectorAll('[data-site-delete],[data-site-edit]').forEach(x=>{const site=state.sites.find(v=>v.id===(x.dataset.siteDelete||x.dataset.siteEdit));x.hidden=false;x.disabled=!(site&&canEdit()&&TIPONOrgCore.inScope(state.user,site));});};
filteredAttendanceRows=function(){
  if(!isAdmin())throw Error('Only the administrator can export attendance.');
  return TIPONCore.filterRows(TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)),$('recordFrom').value,$('recordTo').value,$('recordSite').value);
};
const originalDashboard=renderDashboard;
renderDashboard=function(){
  if(!isAdmin())return;OrgUI.renderMpc();
};
window.OrgUI=(()=>{
  let editingSchedule=null;
  function readSiteSchedule(){return {enabled:$('siteScheduleEnabled').checked,days:[...document.querySelectorAll('[name="siteWorkDay"]:checked')].map(x=>Number(x.value)),start:$('siteShiftStart').value,end:$('siteShiftEnd').value,grace:Number($('siteGrace').value)||0};}
  function csv(name,headers,rows){const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};downloadBlob(name,new Blob(['\ufeff'+[headers,...rows].map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));}
  function dashboardFilter(){return {coop:$('dashboardCoop').value,platform:''};}
  function filteredMembers(){const f=dashboardFilter(),sites=new Map(state.sites.map(x=>[x.id,x]));return state.members.filter(m=>(!f.coop||m.coop===f.coop)&&(!f.platform||TIPONOrgCore.platformKey(m.platform||sites.get(m.siteId)?.platform)===TIPONOrgCore.platformKey(f.platform)));}
  function renderDashboardPlatformFilter(){
    const el=$('dashboardPlatform');if(!el)return;const value=el.value;
    const names=TIPONOrgCore.platformNames([...(TIPONPlatforms?.names()||[]),...state.members.map(m=>m.platform),...state.punches.map(e=>e.platform),value]);
    const html='<option value="">All business platforms</option>'+names.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
    if(el.innerHTML!==html)el.innerHTML=html;el.value=value;
  }
  function renderMpc(){
    if(!isAdmin())return;
    if(!$('dashboardDay').value)$('dashboardDay').value=todayPH();
    renderDashboardPlatformFilter();
    const day=$('dashboardDay').value, f=dashboardFilter();
    const all=state.members.filter(m=>!m.deleted&&m.active!==false);
    const coops=[...new Set([...TIPONOrgCore.COOPS,...all.map(m=>m.coop).filter(Boolean)])];
    $('coopDashboardCards').innerHTML=coops.map(coop=>'<article class="coop-summary" data-coop="'+esc(coop)+'"><span class="coop-monogram" aria-hidden="true">'+esc(coop.split(' ').map(w=>w[0]).join('').slice(0,3))+'</span><h3>'+esc(coop)+'</h3><strong>'+all.filter(m=>m.coop===coop).length+'</strong><small>Registered members</small></article>').join('');
    const members=filteredMembers().filter(m=>!m.deleted&&m.active!==false);
    const events=state.punches.filter(p=>!p.reviewStatus&&!p.deleted&&TIPONCore.phStamp(p.timestamp).slice(0,10)===day);
    const tally=items=>{
      let timedIn=0,timedOut=0,complete=0,missing=0;
      for(const m of items){
        const punches=events.filter(p=>String(p.memberId)===String(m.id)&&(!p.coop||p.coop===m.coop));
        const i=punches.some(p=>p.type==='IN'),out=punches.some(p=>p.type==='OUT');
        if(i)timedIn++;if(out)timedOut++;if(i&&out)complete++;if(!i&&!out)missing++;
      }
      return {members:items.length,timedIn,timedOut,complete,missing};
    };
    const total=tally(members);
    $('dashboardSummary').innerHTML=[['Registered / enrolled',total.members],['With In and Out',total.complete],['No Time In / Out',total.missing]].map(([label,n])=>'<article class="kpi-card"><span>'+label+'</span><strong>'+n+'</strong><small>'+esc(day)+'</small></article>').join('');
    const ranked=coops.filter(c=>!f.coop||c===f.coop).map(coop=>({coop,...tally(members.filter(m=>m.coop===coop))})).sort((a,b)=>a.missing-b.missing||a.coop.localeCompare(b.coop));
    $('dashboardRanking').innerHTML=ranked.map((r,i)=>{const rate=r.members?100*r.missing/r.members:0;return '<tr><td>'+(i+1)+'</td><td><b>'+esc(r.coop)+'</b></td><td>'+r.members+'</td><td>'+r.complete+'</td><td>'+r.missing+'</td><td><div class="attendance-rate"><span style="width:'+rate+'%"></span></div><small>'+(r.members?rate.toFixed(1)+'%':'No members')+'</small></td></tr>';}).join('');
    const legacy=state.members.some(m=>!m.orgId)||state.sites.some(s=>!s.orgId)||state.punches.some(p=>!p.orgId);
    if($('legacyNotice'))$('legacyNotice').hidden=!legacy;
  }
  function renderReports(){
    if(!$('reportFrom'))return;
    if(!isAdmin())return;const from=$('reportFrom').value,to=$('reportTo').value,coop=$('reportCoop').value;
    const rows=TIPONCore.filterRows(TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)),from,to,'').filter(r=>!coop||r.coop===coop);
    const summary=TIPONOrgCore.periodSummary(rows);
    $('summaryRows').innerHTML=summary.map(r=>`<tr><td>${esc(r.memberId)}</td><td>${esc(r.name)}</td><td>${esc(r.coop)}</td><td>${r.sessions}</td><td>${r.complete}</td><td>${r.hours.toFixed(2)}</td><td>${r.open}</td></tr>`).join('')||'<tr><td colspan="7">No sessions for this period.</td></tr>';
    const schedules=state.schedules||[];$('scheduleRows').innerHTML=schedules.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.memberId)}</td><td>${esc(r.status)}</td><td>${esc(r.start||'')}</td><td>${esc(r.end||'')}</td><td>${esc(r.note||'')}</td></tr>`).join('')||'<tr><td colspan="6">Use a site schedule or add a member/date override for leave, rest or a specific shift.</td></tr>';
    $('scheduleMember').innerHTML=state.members.map(m=>`<option value="${esc(m.id)}">${esc(m.id)} - ${esc(m.name)}</option>`).join('');
  }
  // Pending registrations are separate from previously approved accounts.
  const APPROVED_PAGE_SIZE=10;
  let approvedAccountPage=1;
  function accountScope(u){
    return '<b>'+esc(u.coop||'Not assigned')+'</b><small>'+esc(u.platform||'No business platform')+'</small>';
  }
  function accountIdentity(u){
    return '<b>'+esc(u.name||u.username||'Unnamed account')+'</b>';
  }
  function accountStatusBadge(u){
    const status=String(u.status||'unknown').toLowerCase();
    return '<span class="badge '+(status==='active'?'green':'amber')+'">'+esc(status)+'</span>';
  }
  function pendingAccounts(){
    return (state.accounts||[]).filter(u=>u&&!u.deleted&&u.role!=='admin'&&
      ['pending','pending_approval','awaiting_approval','requested'].includes(String(u.status||'').toLowerCase()));
  }
  function approvedAccounts(){
    return (state.accounts||[]).filter(u=>u&&!u.deleted&&u.role!=='admin'&&
      ['active','disabled'].includes(String(u.status||'').toLowerCase()));
  }
  function renderApprovedAccountTable(){
    if(!isAdmin())return;
    const query=String($('registeredDeviceSearch')?.value||'').trim().toLowerCase();
    const all=approvedAccounts().sort((a,b)=>String(a.name||a.username||'').localeCompare(String(b.name||b.username||'')));
    const matched=all.filter(u=>!query||[u.name,u.username,u.position,u.coop,u.platform,roleName(u.role),u.status]
      .some(value=>String(value||'').toLowerCase().includes(query)));
    const pages=Math.max(1,Math.ceil(matched.length/APPROVED_PAGE_SIZE));
    approvedAccountPage=Math.max(1,Math.min(approvedAccountPage,pages));
    const first=(approvedAccountPage-1)*APPROVED_PAGE_SIZE;
    const pageRows=matched.slice(first,first+APPROVED_PAGE_SIZE);
    $('deviceRows').innerHTML=pageRows.map(u=>{
      const enabled=u.status==='active',nextStatus=enabled?'disabled':'active';
      return '<tr><td>'+accountIdentity(u)+'</td><td>'+esc(u.username||'')+'</td><td>'+
        esc(u.position||(u.role==='kiosk'?'Physical Kiosk':'Not specified'))+'</td><td>'+
        accountScope(u)+'</td><td>'+esc(roleName(u.role))+'</td><td>'+accountStatusBadge(u)+'</td>'+
        '<td><div class="account-row-actions">'+
        '<button class="tiny-button" data-approved-account-id="'+esc(u.id)+'" data-approved-status="'+nextStatus+'">'+
        (enabled?'Disable':'Enable')+'</button>'+
        '<button class="tiny-button delete" data-approved-delete="'+esc(u.id)+'">Delete</button>'+
        '</div></td></tr>';
    }).join('')||'<tr><td colspan="7"><div class="empty-state">No approved accounts match your search.</div></td></tr>';
    setText('registeredDeviceCount',matched.length?
      'Showing '+(first+1)+'–'+(first+pageRows.length)+' of '+matched.length+' approved accounts':
      '0 approved accounts');
    setText('registeredDevicePage','Page '+approvedAccountPage+' of '+pages);
    $('registeredDevicePrev').disabled=approvedAccountPage<=1;
    $('registeredDeviceNext').disabled=approvedAccountPage>=pages;
  }
  async function renderAccounts(){
    if(!isAdmin())return;
    try{
      const r=await TIPONAPI.call({action:'accounts'});
      state.accounts=Array.isArray(r.accounts)?r.accounts:[];
      state.devices=Array.isArray(r.devices)?r.devices:[];
      state.reviews=Array.isArray(r.reviews)?r.reviews:[];
      await OrgDB.rawSave('meta',{id:'tp5-accountSnapshot',orgId:state.orgId,
        accounts:state.accounts,devices:state.devices,reviews:state.reviews});
    }catch(e){
      const saved=await getOne('meta','tp5-accountSnapshot');
      if(saved?.orgId===state.orgId){
        state.accounts=Array.isArray(saved.accounts)?saved.accounts:[];
        state.devices=Array.isArray(saved.devices)?saved.devices:[];
        state.reviews=Array.isArray(saved.reviews)?saved.reviews:[];
      }
      showToast('Account changes need internet. '+e.message,'info');
    }
    $('accountRows').innerHTML=pendingAccounts().map(u=>'<tr><td>'+accountIdentity(u)+'</td><td>'+esc(u.username||'')+'</td>'+
      '<td>'+esc(u.position||(u.role==='kiosk'?'Physical Kiosk':'Not specified'))+'</td>'+
      '<td>'+accountScope(u)+'</td><td>'+esc(roleName(u.role))+'</td>'+
      '<td>'+accountStatusBadge(u)+'</td><td><div class="account-row-actions">'+
      '<button class="tiny-button" data-account-status="active" data-account-id="'+esc(u.id)+'">Approve</button>'+
      '<button class="tiny-button delete" data-account-delete="'+esc(u.id)+'">Delete</button>'+
      '</div></td></tr>').join('')||
      '<tr><td colspan="7"><div class="empty-state">No registrations awaiting administrator approval.</div></td></tr>';
    renderApprovedAccountTable();
  }
  let accountActionBusy=false;
  async function performAccountAction(userId,desiredStatus,deleteAccount=false){
    if(!isAdmin()||accountActionBusy)return;
    const user=(state.accounts||[]).find(u=>String(u.id)===String(userId));
    if(!user||user.role==='admin'||user.deleted)return;
    const status=String(user.status||'').toLowerCase();
    if(!deleteAccount){
      if(desiredStatus==='active'&&!['pending','pending_approval','awaiting_approval','requested','disabled'].includes(status))return;
      if(desiredStatus==='disabled'&&status!=='active')return;
    }
    const name=user.name||user.username||'Account';
    const title=deleteAccount?'Delete account?':desiredStatus==='disabled'?'Disable account?':
      status==='disabled'?'Enable account?':'Approve account?';
    const detail=deleteAccount?
      name+' will no longer be able to sign in. Audit history is retained.':
      name+': change status from '+status+' to '+desiredStatus+'. Type: '+roleName(user.role)+'.';
    if(!await confirmAction(title,detail))return;
    accountActionBusy=true;
    try{
      if(deleteAccount)await TIPONAPI.call({action:'accountDelete',userId:user.id});
      else await TIPONAPI.call({action:'accountUpdate',userId:user.id,status:desiredStatus});
      await renderAccounts();
      showToast(deleteAccount?'Account deleted.':desiredStatus==='disabled'?'Account disabled.':
        status==='disabled'?'Account enabled.':'Account approved.','success');
    }catch(err){toastError(err,deleteAccount?'Delete account':'Account update');}
    finally{accountActionBusy=false;}
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
      await loadCollections();showToast('Backup merged without overwriting existing IDs. Review before syncing.','success');
    }catch(e){toastError(e,'Restore');}
  }
  async function migrateLegacy(){if(isAdmin())showToast('Legacy records remain saved; coordinate a reviewed migration of GPS work locations.','info',9000);}
  function bind(){
    bindRegistryUploads();
    ['registerCoop','dashboardCoop','reportCoop'].forEach(id=>fillCoopSelect(id,['dashboardCoop','reportCoop'].includes(id)));
    ['dashboardDay','dashboardCoop','presenceFilter'].forEach(id=>attach(id,'change',renderMpc));attach('dashboardRefresh','click',()=>TIPONSync.kick());attach('dashboardResetFilters','click',()=>{$('dashboardCoop').value='';$('presenceFilter').value='';renderMpc();});
    ['reportFrom','reportTo','reportCoop'].forEach(id=>attach(id,'change',renderReports));
    attach('refreshAccounts','click',renderAccounts);
    attach('accountRows','click',async e=>{
      const del=e.target.closest('[data-account-delete]');
      if(del){await performAccountAction(del.dataset.accountDelete,null,true);return;}
      const approve=e.target.closest('[data-account-id]');
      if(approve)await performAccountAction(approve.dataset.accountId,'active');
    });
    attach('deviceRows','click',async e=>{
      const del=e.target.closest('[data-approved-delete]');
      if(del){await performAccountAction(del.dataset.approvedDelete,null,true);return;}
      const change=e.target.closest('[data-approved-account-id]');
      if(change)await performAccountAction(change.dataset.approvedAccountId,change.dataset.approvedStatus);
    });
    attach('registeredDeviceSearch','input',()=>{approvedAccountPage=1;renderApprovedAccountTable();});
    attach('registeredDevicePrev','click',()=>{if(approvedAccountPage>1){approvedAccountPage--;renderApprovedAccountTable();}});
    attach('registeredDeviceNext','click',()=>{approvedAccountPage++;renderApprovedAccountTable();});
    attach('addSchedule','click',()=>{if(!isAdmin())return;renderReports();$('scheduleForm').reset();$('scheduleDate').value=todayPH();$('scheduleDialog').showModal();});
    attach('scheduleForm','submit',async e=>{e.preventDefault();try{const r={id:'schedule-'+$('scheduleMember').value+'-'+$('scheduleDate').value,memberId:$('scheduleMember').value,date:$('scheduleDate').value,status:$('scheduleStatus').value,start:$('scheduleStart').value,end:$('scheduleEnd').value,grace:Number($('scheduleGrace').value)||0,note:$('scheduleNote').value.trim(),enabled:true};await saveOne('schedules',r);await loadCollections();$('scheduleDialog').close();renderReports();}catch(err){toastError(err,'Schedule');}});
    attach('exportPeriodSummary','click',()=>{if(!isAdmin())return;const rows=TIPONCore.filterRows(TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)),$('reportFrom').value,$('reportTo').value,'').filter(r=>!$('reportCoop').value||r.coop===$('reportCoop').value);csv('TIPON_Period_Summary.csv',['MemberId','Name','Cooperative','Sessions','Completed','Hours','Open sessions'],TIPONOrgCore.periodSummary(rows).map(r=>[r.memberId,r.name,r.coop,r.sessions,r.complete,r.hours.toFixed(2),r.open]));});
    attach('exportPresence','click',()=>{if(!isAdmin())return;const d=TIPONOrgCore.dashboard(filteredMembers(),state.sites,state.punches.filter(p=>!p.reviewStatus),$('dashboardDay').value,state.schedules||[]).details.filter(r=>!$('presenceFilter').value||r.status.includes($('presenceFilter').value));csv('TIPON_Daily_Status.csv',['Date','MemberId','Name','Cooperative','Business platform','Site','Status','Late'],d.map(r=>[$('dashboardDay').value,r.memberId,r.name,r.coop,r.platform,r.site,r.status,r.late?'Yes':'No']));});
    attach('migrateLegacy','click',migrateLegacy);
  }
  saveEncryptedBackup=backup;restoreEncryptedBackup=restore;
  return {bind,readSiteSchedule,renderMpc,renderReports,renderAccounts,renderSettings,renderQueue,csv};
})();
function fillCoopSelect(id,allowAll=false){const el=$(id);if(!el)return;const old=el.value,options=TIPONOrgCore.COOPS;el.innerHTML=(allowAll?'<option value="">All cooperatives</option>':'<option value="">Select cooperative</option>')+options.map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');if(options.includes(old))el.value=old;}
function parseMemberCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(ch===','&&!quoted){row.push(cell);cell='';}
  else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=ch;
 }
 if(quoted)throw Error('CSV has an unclosed quote.');
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
window.addEventListener('DOMContentLoaded',()=>{
 if(typeof enterApp==='function'&&typeof TIPONAuth!=='undefined')window.TIPONWorkspaceEnter=()=>enterApp();
},{once:true});

/* Registry CSV uploads: validate the complete file before enqueueing rows. */
const TIPON_MEMBER_CSV_HEADERS=['Member ID','Full name','Cooperative','Business platform'];
function prepareMemberImport(rows,existing){
 if(JSON.stringify(rows[0])!==JSON.stringify(TIPON_MEMBER_CSV_HEADERS))throw Error('Download the latest four-column member template from Member List.');
 if(rows.length<2||rows.length>501)throw Error('Upload 1–500 members per file.');
 const ids=new Set(existing.filter(m=>!m.deleted).map(m=>String(m.id).trim().toLowerCase()));
 return rows.slice(1).map((r,i)=>{
  const row=i+2;if(r.length!==4)throw Error('Row '+row+' must contain Member ID, Full name, Cooperative, Business platform only.');
  const [id,name,coop,platform]=r.map(v=>String(v||'').trim());
  if(!id||!name||!platform||id.length>80||name.length>120||!TIPONOrgCore.COOPS.includes(coop))throw Error('Row '+row+': invalid member ID/name/cooperative/platform.');
  if(ids.has(id.toLowerCase()))throw Error('Row '+row+': duplicate Member ID '+id+'. Use Edit.');
  ids.add(id.toLowerCase());return {id,name,coop,platform};
 });
}
async function importMemberCSV(event){
 const file=event.target.files?.[0];event.target.value='';if(!file||!isAdmin())return;
 const button=$('uploadMemberButton');button.disabled=true;let total=0;
 try{
  if(!navigator.onLine)throw Error('Connect to the internet to import members to the shared database.');
  if(file.size>1000000)throw Error('CSV limit is 1 MB.');
  // Preflight the live Apps Script receiver before sending any member data.
  // GitHub Pages can be newer than the deployed Apps Script Web App.
  setText('memberUploadStatus','Checking live Apps Script backend compatibility...');
  const health=await TIPONAPI.raw({action:'health'});
  const backendVersion=String(health.version||'unknown');
  if(!/^5\.5\./.test(backendVersion)){
   throw Error('Apps Script backend '+backendVersion+' is outdated. Four-column uploads require the matching v5.5 Code.gs AND OrgCore.gs deployment. No members were uploaded.');
  }
  const members=prepareMemberImport(parseMemberCSV((await file.text()).replace(/^\uFEFF/,'')),await getAll('members'));
  const response=await TIPONAPI.raw({action:'platforms'});
  const listed=(Array.isArray(response.businessPlatforms)?response.businessPlatforms:[]).map(p=>String(p).trim()).filter(Boolean);
  const known=new Set(listed.map(p=>TIPONOrgCore.platformKey(p)));
  for(let i=0;i<members.length;i++){
   const platform=members[i].platform;
   if(!known.has(TIPONOrgCore.platformKey(platform))){
    throw Error('CSV row '+(i+2)+': Business Platform "'+platform+'" is not registered in the live backend. Choose a listed platform in the CSV or have the Admin add it first. No members were uploaded.');
   }
  }
  if(!await confirmAction('Upload '+members.length+' members?', 'Members are registered without a work location or face template. An authorized User assigns the location during enrollment.'))return;
  for(let n=0;n<members.length;n+=20){
   const result=await TIPONAPI.call({action:'adminMemberImport',rows:members.slice(n,n+20)});
   if(typeof result.added!=='number')throw Error('Server did not acknowledge member import.');
   total+=result.added;setText('memberUploadStatus',total+' members accepted by the central database. Syncing...');
  }
  await TIPONSync.run();TIPONSync.kick();await loadCollections();renderMembers();renderDashboard();
  setText('memberUploadStatus',total+' uploaded. NOT ENROLLED; the User assigns a work location.');
  showToast(total+' members uploaded.','success');
 }catch(error){
  const message=/Unknown action|office required|work location not found/i.test(error.message||'')
   ?'Deploy the matching updated Apps Script Code.gs and OrgCore.gs to enable four-column imports.':error.message;
  setText('memberUploadStatus',(total?total+' previously accepted. ':'No members uploaded. ')+message);showToast(message,'error',9000);
 }finally{button.disabled=false;}
}
function bindRegistryUploads(){
 const download=(name,headers)=>downloadBlob(name,new Blob(['\uFEFF'+headers.join(',')+'\r\n'],{type:'text/csv;charset=utf-8'}));
 attach('uploadMemberTemplate','click',()=>download('TIPON_Member_Upload_Template.csv',TIPON_MEMBER_CSV_HEADERS));
 attach('uploadMemberButton','click',()=>$('uploadMemberFile').click());
 attach('uploadMemberFile','change',importMemberCSV);
}
