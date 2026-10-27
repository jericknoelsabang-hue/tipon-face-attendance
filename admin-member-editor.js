/* TIPON Admin Member List metadata editor.
 * Does not modify face templates, attendance, login, or User enrollment.
 * Requires an authenticated Google Apps Script adminMemberUpdate endpoint.
 */
'use strict';
(() => {
  const field=id=>document.getElementById(id);
  const key=value=>TIPONOrgCore.platformKey(value);
  let editingId=null;
  const originalRenderMembers=renderMembers;
  renderMembers=function(){
    originalRenderMembers();
    if(isAdmin())document.querySelectorAll('#memberRows [data-member-edit]').forEach(button=>{button.disabled=false;});
  };
  const originalOpenMemberForm=openMemberForm;
  openMemberForm=function(member){
    if(isAdmin()&&member){openAdminEditor(member);return;}
    return originalOpenMemberForm(member);
  };
  function locationChoices(preferred=[]){
    const officeId=field('adminMemberOffice').value,coop=field('adminMemberCoop').value,platform=field('adminMemberPlatform').value;
    const sites=state.sites.filter(s=>!s.deleted&&s.officeId===officeId&&s.coop===coop&&key(s.platform)===key(platform));
    const checked=new Set(preferred);
    field('adminMemberSites').innerHTML=sites.length
      ?sites.map(s=>'<label class="multi-select-option"><input type="checkbox" data-admin-site value="'+esc(s.id)+'" '+(checked.has(s.id)?'checked':'')+'/><span>'+esc(s.name)+'</span></label>').join('')
      :'<p class="mini-info">No matching work locations. Choose a configured satellite office.</p>';
    setText('adminMemberLocationStatus',sites.length?'Select one or more assigned work locations.':'An approved work location must be configured first.');
  }
  function officeChoices(preferredOffice='',preferredSites=[]){
    const coop=field('adminMemberCoop').value,platform=field('adminMemberPlatform').value;
    const offices=state.offices.filter(o=>!o.deleted&&o.coop===coop&&key(o.platform)===key(platform));
    field('adminMemberOffice').innerHTML='<option value="">Select approved satellite office</option>'
      +offices.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>').join('');
    if(offices.some(o=>o.id===preferredOffice))field('adminMemberOffice').value=preferredOffice;
    locationChoices(preferredSites);
  }
  function openAdminEditor(member){
    if(!isAdmin()||!member)return;
    if(member._pendingOp){showToast('This member has unsynced changes. Sync before editing.','error');return;}
    const site=state.sites.find(s=>s.id===member.siteId);
    editingId=member.id;
    field('adminMemberForm').reset();
    field('adminMemberId').value=member.id;
    field('adminMemberName').value=member.name||'';
    field('adminMemberCoop').value=member.coop||'';
    field('adminMemberPlatform').value=member.platform||site?.platform||'';
    const officeId=member.officeId||site?.officeId||'';
    const siteIds=Array.isArray(member.siteIds)&&member.siteIds.length?member.siteIds:[member.siteId].filter(Boolean);
    officeChoices(officeId,siteIds);
    setText('adminMemberFaceStatus',member.template&&member.active!==false
      ?'ENROLLED. Existing encrypted face template will remain unchanged.'
      :'NOT ENROLLED. Face enrollment must be completed by an authorized User.');
    setText('adminMemberEditStatus','Member ID, Cooperative, and Business Platform are fixed to protect approved access scopes.');
    field('adminMemberDialog').showModal();
  }
  async function saveAdminEdit(event){
    event.preventDefault();
    if(!isAdmin()||!editingId)return;
    const member=state.members.find(m=>m.id===editingId);
    if(!member||member._pendingOp){setText('adminMemberEditStatus','Member is missing or has pending changes. Sync the Member List and reopen Edit.');return;}
    const name=field('adminMemberName').value.trim(),officeId=field('adminMemberOffice').value,
      coop=field('adminMemberCoop').value,platform=field('adminMemberPlatform').value;
    const siteIds=[...document.querySelectorAll('#adminMemberSites [data-admin-site]:checked')].map(input=>input.value);
    const office=state.offices.find(o=>o.id===officeId&&!o.deleted);
    const sites=siteIds.map(id=>state.sites.find(s=>s.id===id&&!s.deleted));
    if(!name||name.length>120||!office||!siteIds.length||sites.some(s=>!s||s.officeId!==officeId||s.coop!==coop||key(s.platform)!==key(platform))){
      setText('adminMemberEditStatus','Complete the name, approved satellite office, and at least one matching work location.');
      return;
    }
    if(!navigator.onLine){setText('adminMemberEditStatus','Online connection is required to save member changes to the shared database.');return;}
    const button=field('adminMemberSave');
    button.disabled=true;setText('adminMemberEditStatus','Saving member changes to Google Sheets...');
    try{
      const reply=await TIPONAPI.call({
        action:'adminMemberUpdate',memberId:editingId,baseRev:Number(member.rev)||0,
        changes:{name,coop,platform,officeId,siteIds}
      });
      if(!reply.member||reply.member.id!==editingId)throw Error('Server did not acknowledge the member edit.');
      const latest=await getOne('members',editingId);
      if(latest?._pendingOp)throw Error('Pending local member changes must be synced before replacing this record.');
      await OrgDB.rawSave('members',{...reply.member,orgId:state.orgId});
      await loadCollections();
      field('adminMemberDialog').close();
      editingId=null;renderMembers();renderDashboard();TIPONSync.kick();
      showToast('Member details saved to the central database. Face enrollment was retained.','success');
    }catch(error){
      const message=error.code==='ACTION'||/Unknown action/i.test(error.message||'')
        ?'Admin Edit requires an updated Google Apps Script deployment. The current backend does not support saving this form.'
        :error.message||'Unable to save member details.';
      setText('adminMemberEditStatus',message);
      showToast(message,'error',8500);
    }finally{button.disabled=false;}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    field('adminMemberForm')?.addEventListener('submit',saveAdminEdit);
    field('adminMemberOffice')?.addEventListener('change',()=>locationChoices([]));
    field('adminMemberDialog')?.addEventListener('close',()=>{editingId=null;});
  });
})();
