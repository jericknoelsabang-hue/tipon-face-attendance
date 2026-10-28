/* TIPON 5.5.20 — Admin member metadata and optional Assigned Location.
 * Work Location mutations require server acknowledgement, never local-only.
 */
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
    ).join(''):'<p class="mini-info">No centrally confirmed Work Locations for this MPC/BP. You can leave this member unassigned.</p>';
  setText('adminMemberSiteHelp',state.sites.some(s=>s._pendingOp&&s.coop===coop&&key(s.platform)===key(platform))
    ?'Some Work Locations are awaiting central confirmation and cannot yet be assigned.'
    :'Work Location is optional. Attendance requires an enrolled face and an approved location.');
  updateSummary();
 }
 function updateSummary(){
  const count=selected().length;
  setText('adminMemberSiteSummary',count?count+' Assigned Location'+(count===1?'':'s')+' selected':'No Assigned Location (Optional)');
 }
 function openAdmin(member){
  if(member._pendingOp){showToast('Sync pending member changes before editing.','error');return;}
  current=member.id;$('adminMemberForm').reset();
  $('adminMemberId').value=member.id;$('adminMemberName').value=member.name||'';
  const coop=$('adminMemberCoop'),platform=$('adminMemberPlatform');
  coop.innerHTML='<option value="">Select cooperative</option>'+
    [...new Set([...TIPONOrgCore.COOPS,member.coop])].filter(Boolean).map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
  coop.value=member.coop;
  platform.innerHTML='<option value="">Select business platform</option>'+
    TIPONOrgCore.platformNames([...TIPONPlatforms.names(),member.platform]).map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
  platform.value=member.platform;choices(ids(member));
  $('adminMemberSitePicker').open=false;
  setText('adminMemberFaceStatus',member.template&&member.active!==false
    ?'ENROLLED — existing encrypted face template will be preserved.'
    :'NOT ENROLLED — location assignment can be saved independently; face enrollment is completed by an authorized User.');
  setText('adminMemberEditStatus','');$('adminMemberDialog').showModal();
 }
 async function save(event){
  event.preventDefault();if(!isAdmin()||!current)return;
  const member=state.members.find(x=>x.id===current);
  if(!member||member._pendingOp){setText('adminMemberEditStatus','Sync changes first, then reopen Edit.');return;}
  const name=$('adminMemberName').value.trim(),coop=$('adminMemberCoop').value,platform=$('adminMemberPlatform').value,siteIds=selected();
  if(!name||name.length>120||!TIPONOrgCore.COOPS.includes(coop)||!TIPONPlatforms.names().some(x=>key(x)===key(platform))){
   setText('adminMemberEditStatus','Enter a valid Full Name, Cooperative and Business Platform.');return;
  }
  if(siteIds.length>40||siteIds.some(id=>{
   const s=state.sites.find(x=>x.id===id&&!x.deleted&&!x._pendingOp);
   return !s||s.coop!==coop||key(s.platform)!==key(platform);
  })){setText('adminMemberEditStatus','Select only approved, centrally confirmed locations matching the MPC/BP.');return;}
  if(!navigator.onLine){setText('adminMemberEditStatus','Connect to the internet to save centrally.');return;}
  const scopeChanged=coop!==member.coop||key(platform)!==key(member.platform);
  const locationChanged=!same(ids(member),siteIds),nameChanged=name!==member.name;
  if(!scopeChanged&&!locationChanged&&!nameChanged){$('adminMemberDialog').close();return;}
  if(scopeChanged||locationChanged){
   const confirmed=await confirmAction('Confirm Member Assignment',
     'Update the assigned location for '+member.name+'? An open Time In must be completed first. Facial biometrics and attendance history will remain intact.');
   if(!confirmed)return;
  }
  const button=$('adminMemberSave');button.disabled=true;
  setText('adminMemberEditStatus','Saving to TIPON central database...');
  try{
   // New endpoint is mandatory for explicit location edits; old server
   // only permits name/coop/platform and must never discard the siteIds.
   const extended=locationChanged||(scopeChanged&&siteIds.length>0);
   const reply=await TIPONAPI.call({action:extended?'adminMemberUpdateV2':'adminMemberUpdate',
    memberId:member.id,baseRev:Number(member.rev)||0,
    changes:extended?{name,coop,platform,siteIds}:{name,coop,platform}});
   if(!reply.member||reply.member.id!==member.id)throw Error('Central server did not confirm the member edit.');
   if(extended&&(!same(ids(reply.member),siteIds)||reply.member.coop!==coop||key(reply.member.platform)!==key(platform))){
    throw Error('Central assignment mismatch. No local changes applied.');
   }
   const old=await getOne('members',member.id);
   if(old?._pendingOp)throw Error('A local member edit appeared during the server update; sync before retrying.');
   const updated={...old,...reply.member,orgId:state.orgId};
   delete updated._pendingOp;
   await OrgDB.rawSave('members',updated);
   await loadCollections();$('adminMemberDialog').close();renderMembers();renderDashboard();
   TIPONSync.kick();showToast('Member details and Assigned Location saved centrally.','success',7000);
  }catch(error){
   const message=error.code==='ACTION'||/unknown action|unsupported action|not implemented/i.test(error.message||'')
    ?'Assigned Location editing requires the new private Apps Script backend. No assignment was changed.'
    :error.message||'Member edit not confirmed.';
   setText('adminMemberEditStatus',message);showToast(message,'error',8500);
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