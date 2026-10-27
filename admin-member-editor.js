/* TIPON Administrator member metadata editor.
 * MPC/BP may be reassigned by Admin; GPS locations and encrypted face
 * biometrics remain governed by the server and authorized User enrollment.
 */
'use strict';
(()=>{
 const field=id=>document.getElementById(id);
 let editingId=null;
 const oldRender=renderMembers;
 renderMembers=function(){
  oldRender();
  if(isAdmin())document.querySelectorAll('#memberRows [data-member-edit]').forEach(b=>b.disabled=false);
 };
 const oldOpen=openMemberForm;
 openMemberForm=function(member){
  if(isAdmin()&&member){openAdmin(member);return;}
  return oldOpen(member);
 };
 function fillScopeOptions(member){
  const cooperative=field('adminMemberCoop'),platform=field('adminMemberPlatform');
  const coops=[...TIPONOrgCore.COOPS];
  if(member.coop&&!coops.includes(member.coop))coops.push(member.coop);
  cooperative.innerHTML='<option value="">Select cooperative</option>'+
    coops.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
  cooperative.value=member.coop||'';
  const platforms=TIPONOrgCore.platformNames([...(TIPONPlatforms.names()||[]),member.platform||'']);
  platform.innerHTML='<option value="">Select business platform</option>'+
    platforms.map(p=>'<option value="'+esc(p)+'">'+esc(p)+'</option>').join('');
  platform.value=member.platform||'';
 }
 function openAdmin(member){
  if(!isAdmin()||!member)return;
  if(member._pendingOp){
   showToast('Sync pending member changes before editing.','error');return;
  }
  editingId=member.id;
  field('adminMemberForm').reset();
  field('adminMemberId').value=member.id;
  field('adminMemberName').value=member.name||'';
  fillScopeOptions(member);
  setText('adminMemberFaceStatus',
   member.active!==false&&member.template
    ?'ENROLLED — encrypted face template remains unchanged.'
    :'NOT ENROLLED — a User must select a work location and enroll the face.');
  setText('adminMemberEditStatus',
   'You may edit Full name, Cooperative and Business Platform. Changing MPC/BP removes old work-location assignments so a User can assign locations in the new scope. Attendance history is retained.');
  field('adminMemberDialog').showModal();
 }
 async function saveEdit(event){
  event.preventDefault();
  if(!isAdmin()||!editingId)return;
  const member=state.members.find(m=>m.id===editingId);
  if(!member||member._pendingOp){
   setText('adminMemberEditStatus','Sync pending changes, then reopen Edit.');return;
  }
  const name=field('adminMemberName').value.trim(),
    coop=field('adminMemberCoop').value,
    platform=field('adminMemberPlatform').value;
  if(!name||name.length>120||!TIPONOrgCore.COOPS.includes(coop)||
     !platform||!TIPONPlatforms.names().some(p=>TIPONOrgCore.platformKey(p)===TIPONOrgCore.platformKey(platform))){
   setText('adminMemberEditStatus','Enter a full name and select a valid Cooperative and Business Platform.');return;
  }
  if(!navigator.onLine){
   setText('adminMemberEditStatus','Online connection is required to save a central member update.');return;
  }
  const scopeChanged=coop!==member.coop||
    TIPONOrgCore.platformKey(platform)!==TIPONOrgCore.platformKey(member.platform);
  if(scopeChanged&&(member.siteId||member.siteIds?.length)){
   const yes=await confirmAction('Change member MPC/BP?',
    'Current GPS work-location assignments will be removed. The member cannot record attendance until an authorized User assigns a location in the new scope. Open Time In sessions must be completed first. Existing biometric and attendance records remain intact.');
   if(!yes)return;
  }
  const button=field('adminMemberSave');
  button.disabled=true;
  setText('adminMemberEditStatus','Saving to TIPON central database...');
  try{
   const reply=await TIPONAPI.call({
    action:'adminMemberUpdate',memberId:editingId,baseRev:Number(member.rev)||0,
    changes:{name,coop,platform}
   });
   if(!reply.member||reply.member.id!==editingId)
    throw Error('Server did not confirm member update.');
   const old=await getOne('members',editingId);
   if(old?._pendingOp)throw Error('Local changes are pending sync. Retry after syncing.');
   await OrgDB.rawSave('members',{...old,...reply.member,orgId:state.orgId});
   await loadCollections();
   field('adminMemberDialog').close();
   editingId=null;
   renderMembers();renderDashboard();
   TIPONSync.kick();
   showToast(scopeChanged
    ?'Member MPC/BP updated. Authorized User must reassign GPS work location.'
    :'Member details updated. Existing biometric and attendance history retained.','success',7000);
  }catch(error){
   const message=error.code==='ACTION'||/Unknown action/i.test(error.message||'')
    ?'Deploy matching TIPON Apps Script backend v5.5.8. Changes were not saved.'
    :error.message||'Unable to save member.';
   setText('adminMemberEditStatus',message);
   showToast(message,'error',8500);
  }finally{button.disabled=false;}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  field('adminMemberForm')?.addEventListener('submit',saveEdit);
  field('adminMemberDialog')?.addEventListener('close',()=>editingId=null);
 });
})();
