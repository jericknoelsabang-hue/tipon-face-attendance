/* TIPON 5.5.32 — Admin member edits and schedules use the shared central/offline queue. */
'use strict';
(()=>{
 const $=id=>document.getElementById(id),key=x=>TIPONOrgCore.platformKey(x||'');
function normalizeAdminWorkSchedule(value){const days=Array.isArray(value?.days)?[...new Set(value.days.map(Number).filter(d=>Number.isInteger(d)&&d>=0&&d<=6))].sort((a,b)=>a-b):[];return {enabled:value?.enabled!==false,days,start:String(value?.start||''),end:String(value?.end||''),grace:Number(value?.grace)||0};}
function fillAdminWorkSchedule(value){const x=normalizeAdminWorkSchedule(value);const root=$('adminMemberWorkDays');if(root)root.innerHTML=[['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6],['Sun',0]].map(([label,day])=>'<label class="work-day-option"><input type="checkbox" data-admin-work-day="'+day+'"'+(x.days.includes(day)?' checked':'')+'/><span>'+label+'</span></label>').join('');if($('adminMemberWorkStart'))$('adminMemberWorkStart').value=x.start;if($('adminMemberWorkEnd'))$('adminMemberWorkEnd').value=x.end;}
function readAdminWorkSchedule(){return {enabled:true,days:[...document.querySelectorAll('#adminMemberWorkDays [data-admin-work-day]:checked')].map(el=>Number(el.dataset.adminWorkDay)).sort((a,b)=>a-b),start:$('adminMemberWorkStart')?.value||'',end:$('adminMemberWorkEnd')?.value||'',grace:0};}

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
  const all=state.sites.filter(s=>!s.deleted);
  const valid=s=>!s._pendingOp&&s.coop===coop&&key(s.platform)===key(platform);
  const compatible=all.filter(valid),p=new Set(previous.map(String));
  $('adminMemberSiteChoices').innerHTML=all.length?all.sort((a,b)=>a.name.localeCompare(b.name)).map(s=>{
    const allowed=valid(s),checked=allowed&&p.has(String(s.id));
    return '<label class="multi-select-option'+(allowed?'':' location-unavailable')+'"><input type="checkbox" data-admin-member-site="'+esc(s.id)+'"'+(checked?' checked':'')+(!allowed?' disabled':'')+'/><span>'+esc(s.name)+'<small>'+esc(s.coop||'No cooperative')+' · '+esc(s.platform||'No BP')+(allowed?' · '+esc((s.radius||150)+' m GPS'):' · Select matching Cooperative/BP first')+'</small></span></label>';
  }).join(''):'<p class="mini-info">No Work Locations are registered.</p>';
  setText('adminMemberSiteHelp',state.sites.some(s=>s._pendingOp&&s.coop===coop&&key(s.platform)===key(platform))
    ?'Some matching Work Locations are awaiting central confirmation and cannot yet be assigned.'
    :'All registered Work Locations are listed. Only locations matching the selected Cooperative and Business Platform can be assigned.');
  updateSummary();
 }
 function updateSummary(){
  const count=selected().length;
  setText('adminMemberSiteSummary',count?count+' Assigned Location'+(count===1?'':'s')+' selected':'Select Assigned Location');
 }
 async function openAdmin(member){
  if(!member)return;
  if(member._pendingOp){showToast('This member has a pending change. Sync or review it before editing.','error');return;}
  current={id:member.id,rev:Number(member.rev)||0,orgId:state.orgId,accountId:state.user.id};$('adminMemberForm').reset();
  $('adminMemberId').value=member.memberNumber||member.id;$('adminMemberName').value=member.name||'';
  const coop=$('adminMemberCoop'),platform=$('adminMemberPlatform');
  coop.innerHTML='<option value="">Select cooperative</option>'+
    [...new Set([...TIPONOrgCore.COOPS,member.coop])].filter(Boolean).map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  coop.value=member.coop;
  TIPONPlatforms.fillScoped('adminMemberCoop','adminMemberPlatform',member.platform);
  fillAdminWorkSchedule(member.workSchedule);choices(ids(member));
  $('adminMemberSitePicker').open=false;
  setText('adminMemberFaceStatus',member.template&&member.active!==false
    ?'ENROLLED — face template and attendance history are preserved.'
    :'NOT ENROLLED — assign a location and have an authorized User enroll the face.');
  setText('adminMemberEditStatus','');
  const help=$('adminMemberBackendGuide');if(help)help.hidden=true;
  $('adminMemberDialog').showModal();
  if(navigator.onLine)TIPONSync.kick();
 }
 async function save(event){
  event.preventDefault();if(!isAdmin()||!current)return;
  const member=state.members.find(x=>x.id===current?.id);
  if(!member||member._pendingOp){setText('adminMemberEditStatus','Sync pending member changes before editing.');return;}
  if(!current||current.orgId!==state.orgId||current.accountId!==state.user?.id||Number(member.rev||0)!==current.rev){
   setText('adminMemberEditStatus','This member changed while the form was open. Close and reopen Edit to use the latest record.');return;
  }
  const memberNumber=$('adminMemberId').value.trim(),name=$('adminMemberName').value.trim(),coop=$('adminMemberCoop').value,
    platform=$('adminMemberPlatform').value,siteIds=selected(),workSchedule=readAdminWorkSchedule();
  if(!name||name.length>120||!TIPONOrgCore.COOPS.includes(coop)||
     !TIPONPlatforms.optionsForCoop(coop).some(v=>key(v)===key(platform))){
   setText('adminMemberEditStatus','Enter a valid Full Name, Cooperative and Business Platform.');return;
  }
  if(!workSchedule.days.length||!workSchedule.start||!workSchedule.end||workSchedule.start===workSchedule.end){setText('adminMemberEditStatus','Select at least one work day and valid start/end times.');return;}
  if(!siteIds.length){setText('adminMemberEditStatus','Select at least one Assigned Location.');return;}
  if(siteIds.length>40||siteIds.some(id=>{
   const site=state.sites.find(x=>x.id===id&&!x.deleted&&!x._pendingOp);
   return !site||site.coop!==coop||key(site.platform)!==key(platform);
  })){setText('adminMemberEditStatus','Choose synced locations matching the selected Cooperative and Business Platform.');return;}
  const scopeChanged=coop!==member.coop||key(platform)!==key(member.platform);
  const locationChanged=!same(ids(member),siteIds),nameChanged=name!==member.name;
  const scheduleChanged=JSON.stringify(workSchedule)!==JSON.stringify(normalizeAdminWorkSchedule(member.workSchedule));
  if(memberNumber===(member.memberNumber||member.id)&&!scopeChanged&&!locationChanged&&!nameChanged&&!scheduleChanged){$('adminMemberDialog').close();return;}
  if(scopeChanged||locationChanged){
   if(!await confirmAction('Confirm Member Assignment','Update '+member.name+'? Complete open Time Out first. Existing face data and attendance history remain unchanged.'))return;
  }
  const button=$('adminMemberSave');button.disabled=true;setText('adminMemberEditStatus','Saving member changes...');
  try{
   const result=await window.TIPONMemberMetadataSave(member,{name,coop,platform,siteIds,memberNumber,workSchedule});
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
  $('adminMemberCoop')?.addEventListener('change',()=>{TIPONPlatforms.fillScoped('adminMemberCoop','adminMemberPlatform','');choices([]);});
  $('adminMemberPlatform')?.addEventListener('change',()=>choices(selected()));
  $('adminMemberSiteChoices')?.addEventListener('change',updateSummary);
 });
})();