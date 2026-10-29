/* TIPON 5.5.32 — Admin member edits use the shared central/offline queue. */
'use strict';
(()=>{
 const $=id=>document.getElementById(id),key=x=>TIPONOrgCore.platformKey(x||'');
 const ids=m=>[...new Set((Array.isArray(m?.siteIds)&&m.siteIds.length?m.siteIds:[m?.siteId]).filter(Boolean).map(String))];
 let current=null;
 const beforeRender=renderMembers;
 renderMembers=function(){
  beforeRender();
  if(isAdmin())document.querySelectorAll('#memberRows [data-member-edit]').forEach(x=>x.disabled=false);
 };
 const beforeOpen=openMemberForm;
 openMemberForm=function(member){return isAdmin()&&member?openAdmin(member):beforeOpen(member);};
 function selected(){return [...$('adminMemberSiteChoices').querySelectorAll('input[data-admin-member-site]:checked')].map(x=>x.dataset.adminMemberSite);}
 const same=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
 function choices(previous=[]){
  const coop=$('adminMemberCoop').value,platform=$('adminMemberPlatform').value;
  const valid=state.sites.filter(s=>!s.deleted&&!s._pendingOp&&s.coop===coop&&key(s.platform)===key(platform));
  const p=new Set(previous.map(String));
  $('adminMemberSiteChoices').innerHTML=valid.length?valid
    .sort((a,b)=>a.name.localeCompare(b.name)).map(s=>
     '<label class="multi-select-option"><input type="checkbox" data-admin-member-site="'+esc(s.id)+'"'+(p.has(String(s.id))?' checked':'')+'/><span>'+esc(s.name)+'<small>'+esc((s.radius||150)+' m GPS')+'</small></span></label>'
    ).join(''):'<p class="mini-info">No synced Work Locations for this Cooperative/BP. Add or sync a location before saving.</p>';
  setText('adminMemberSiteHelp',state.sites.some(s=>s._pendingOp&&s.coop===coop&&key(s.platform)===key(platform))
    ?'Some Work Locations are awaiting central confirmation and cannot yet be assigned.'
    :'Select at least one Assigned Location. Attendance requires an enrolled face and a valid GPS location.');
  updateSummary();
 }
 function updateSummary(){
  const count=selected().length;
  setText('adminMemberSiteSummary',count?count+' Assigned Location'+(count===1?'':'s')+' selected':'Select Assigned Location');
 }
 async function openAdmin(member){
  if(!member)return;
  if(navigator.onLine){
   try{
    const result=await TIPONSync.submitPendingNow();
    if(result?.readOk){await loadCollections();member=state.members.find(x=>x.id===member.id)||member;}
   }catch(error){console.warn('Member refresh before edit:',error.message||error);}
  }
  if(member._pendingOp){showToast('This member has a pending change. Sync or review it before editing.','error');return;}
  current=member.id;$('adminMemberForm').reset();
  $('adminMemberId').value=member.memberNumber||member.id;$('adminMemberName').value=member.name||'';
  const coop=$('adminMemberCoop'),platform=$('adminMemberPlatform');
  coop.innerHTML='<option value="">Select cooperative</option>'+
    [...new Set([...TIPONOrgCore.COOPS,member.coop])].filter(Boolean).map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  coop.value=member.coop;
  platform.innerHTML='<option value="">Select business platform</option>'+
    TIPONOrgCore.platformNames([...TIPONPlatforms.names(),member.platform]).map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  platform.value=member.platform;choices(ids(member));
  $('adminMemberSitePicker').open=false;
  setText('adminMemberFaceStatus',member.template&&member.active!==false
    ?'ENROLLED — face template and attendance history are preserved.'
    :'NOT ENROLLED — assign a location and have an authorized User enroll the face.');
  setText('adminMemberEditStatus','');
  const help=$('adminMemberBackendGuide');if(help)help.hidden=true;
  $('adminMemberDialog').showModal();
 }
 async function save(event){
  event.preventDefault();if(!isAdmin()||!current)return;
  const member=state.members.find(x=>x.id===current);
  if(!member||member._pendingOp){setText('adminMemberEditStatus','Sync pending member changes before editing.');return;}
  const memberNumber=$('adminMemberId').value.trim(),name=$('adminMemberName').value.trim(),coop=$('adminMemberCoop').value,
    platform=$('adminMemberPlatform').value,siteIds=selected();
  if(!name||name.length>120||!TIPONOrgCore.COOPS.includes(coop)||
     !TIPONPlatforms.names().some(v=>key(v)===key(platform))){
   setText('adminMemberEditStatus','Enter a valid Full Name, Cooperative and Business Platform.');return;
  }
  if(!siteIds.length){setText('adminMemberEditStatus','Select at least one Assigned Location.');return;}
  if(siteIds.length>40||siteIds.some(id=>{
   const site=state.sites.find(x=>x.id===id&&!x.deleted&&!x._pendingOp);
   return !site||site.coop!==coop||key(site.platform)!==key(platform);
  })){setText('adminMemberEditStatus','Choose synced locations matching the selected Cooperative and Business Platform.');return;}
  const scopeChanged=coop!==member.coop||key(platform)!==key(member.platform);
  const locationChanged=!same(ids(member),siteIds),nameChanged=name!==member.name;
  if(memberNumber===(member.memberNumber||member.id)&&!scopeChanged&&!locationChanged&&!nameChanged){$('adminMemberDialog').close();return;}
  if(scopeChanged||locationChanged){
   if(!await confirmAction('Confirm Member Assignment','Update '+member.name+'? Complete open Time Out first. Existing face data and attendance history remain unchanged.'))return;
  }
  const button=$('adminMemberSave');button.disabled=true;setText('adminMemberEditStatus','Saving member changes...');
  try{
   const result=await window.TIPONMemberMetadataSave(member,{name,coop,platform,siteIds,memberNumber});
   await loadCollections();$('adminMemberDialog').close();renderMembers();renderDashboard();
   showToast(result.pending?'Changes saved locally. Pending Sync.':'Member changes synchronized.','success',7000);
  }catch(error){
   setText('adminMemberEditStatus',error.message||'Member edit failed.');
   showToast(error.message||'Member edit failed.','error',8500);
  }finally{button.disabled=false;}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  $('adminMemberForm')?.addEventListener('submit',save);
  $('adminMemberDialog')?.addEventListener('close',()=>current=null);
  $('adminMemberCoop')?.addEventListener('change',()=>choices(selected()));
  $('adminMemberPlatform')?.addEventListener('change',()=>choices(selected()));
  $('adminMemberSiteChoices')?.addEventListener('change',updateSummary);
 });
})();