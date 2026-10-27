/* Administrator edits member identity only; User controls GPS assignment and biometric enrollment. */
'use strict';
(()=>{
 const field=id=>document.getElementById(id);
 let editingId=null;
 const oldRender=renderMembers;
 renderMembers=function(){oldRender();if(isAdmin())document.querySelectorAll('#memberRows [data-member-edit]').forEach(button=>button.disabled=false);};
 const oldOpen=openMemberForm;
 openMemberForm=function(member){if(isAdmin()&&member){openAdmin(member);return;}return oldOpen(member);};
 function openAdmin(member){
  if(!isAdmin()||!member)return;
  if(member._pendingOp){showToast('Sync pending changes before editing.','error');return;}
  editingId=member.id;field('adminMemberForm').reset();
  field('adminMemberId').value=member.id;field('adminMemberName').value=member.name||'';
  field('adminMemberCoop').value=member.coop||'';field('adminMemberPlatform').value=member.platform||'';
  setText('adminMemberFaceStatus',member.active!==false&&member.template?'ENROLLED - face template preserved.':'NOT ENROLLED - User must choose location and enroll the face.');
  setText('adminMemberEditStatus','Edit full name only. User controls work location and face enrollment.');
  field('adminMemberDialog').showModal();
 }
 async function saveEdit(event){
  event.preventDefault();if(!isAdmin()||!editingId)return;
  const member=state.members.find(m=>m.id===editingId),name=field('adminMemberName').value.trim();
  if(!member||member._pendingOp){setText('adminMemberEditStatus','Sync pending changes and reopen Edit.');return;}
  if(!name||name.length>120){setText('adminMemberEditStatus','Full name is required (max 120 characters).');return;}
  if(!navigator.onLine){setText('adminMemberEditStatus','Online connection required to save.');return;}
  const button=field('adminMemberSave');button.disabled=true;setText('adminMemberEditStatus','Saving member name...');
  try{
   const reply=await TIPONAPI.call({action:'adminMemberUpdate',memberId:editingId,baseRev:Number(member.rev)||0,
    changes:{name,coop:member.coop,platform:member.platform}});
   if(!reply.member||reply.member.id!==editingId)throw Error('Server did not confirm member edit.');
   const old=await getOne('members',editingId);
   if(old?._pendingOp)throw Error('Pending local changes must finish syncing.');
   await OrgDB.rawSave('members',{...old,...reply.member,orgId:state.orgId});
   await loadCollections();field('adminMemberDialog').close();editingId=null;
   renderMembers();renderDashboard();TIPONSync.kick();
   showToast('Member name saved. Face and work-location assignment preserved.','success');
  }catch(error){
   const message=error.code==='ACTION'||/Unknown action/i.test(error.message||'')
    ?'Deploy matching Google Apps Script backend first.':error.message||'Unable to save member.';
   setText('adminMemberEditStatus',message);showToast(message,'error',8500);
  }finally{button.disabled=false;}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  field('adminMemberForm')?.addEventListener('submit',saveEdit);
  field('adminMemberDialog')?.addEventListener('close',()=>editingId=null);
 });
})();
