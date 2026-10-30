/* Role-scoped, read-only timesheet preview. */
'use strict';
(()=>{
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hrs=min=>(Math.max(0,min)/60).toFixed(2);
let page=1;const LIMIT=10;
function summarize(records,interval=0,thresholdHours=8){
 const map=new Map(),round=Math.max(0,Number(interval)||0),limit=(Number(thresholdHours)||8)*60;let excluded=0;
 for(const r of records||[]){
  const a=Date.parse(r.timeIn),b=Date.parse(r.timeOut);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>86400000){excluded++;continue;}
  const id=String(r.memberId||'').trim(),day=TIPONCore.phStamp(r.timeIn).slice(0,10);
  if(!id||!day){excluded++;continue;}
  const k=id+'|'+day,v=map.get(k)||{memberId:id,memberName:String(r.memberName||'Name unavailable'),day,sessions:0,minutes:0};
  v.minutes+=(b-a)/60000;v.sessions++;map.set(k,v);
 }
 return {rows:[...map.values()].map(r=>{const roundedMinutes=round?Math.round(r.minutes/round)*round:r.minutes;return {...r,roundedMinutes,potentialOTMinutes:Math.max(0,roundedMinutes-limit)};}).sort((a,b)=>b.day.localeCompare(a.day)||a.memberName.localeCompare(b.memberName)),excluded};
}
function sourceRows(){
 if(!state.user)return [];
 const from=$('timesheetFrom')?.value||'',to=$('timesheetTo')?.value||'',q=String($('timesheetSearch')?.value||'').trim().toLowerCase();
 const valid=!(from&&to&&to<from);
 if($('timesheetDateError'))$('timesheetDateError').hidden=valid;
 if($('timesheetExport'))$('timesheetExport').disabled=!valid;
 if(!valid)throw Error('To Date cannot be earlier than From Date.');
 const names=new Map((state.members||[]).filter(m=>m&&m.id).map(m=>[String(m.id),String(m.name||'').trim()]));
 const sessions=projectTerminalLogEvents((state.punches||[]).filter(p=>!p.deleted&&p.reviewStatus!=='rejected'));
 return sessions.filter(r=>{
  if(!isAdmin()&&!TIPONOrgCore.inScope(state.user,r))return false;
  const stamp=r.timeIn||r.timeOut;if(!stamp||!Number.isFinite(Date.parse(stamp)))return false;
  const day=TIPONCore.phStamp(stamp).slice(0,10);
  if((from&&day<from)||(to&&day>to))return false;
  const name=attendanceMemberName(r,names);
  return !q||[name,r.memberName,r.memberId,memberNumberFor(r.memberId)].join(' ').toLowerCase().includes(q);
 }).map(r=>({...r,memberName:attendanceMemberName(r,names),memberId:memberNumberFor(r.memberId)}));
}
function current(){return summarize(sourceRows(),0,8);}
function render(){
 if(!$('timesheetPreview')||!state.user)return;
 try{
  const data=current(),pages=Math.max(1,Math.ceil(data.rows.length/LIMIT));page=Math.min(pages,Math.max(1,page));const from=(page-1)*LIMIT;
  $('timesheetRows').innerHTML=data.rows.slice(from,from+LIMIT).map(r=>'<tr>'+[r.memberName,r.memberId,r.day,r.sessions,hrs(r.minutes),hrs(r.potentialOTMinutes)].map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="6">No completed shifts match the Timesheet filters.</td></tr>';
  $('timesheetPage').textContent='Page '+page+' of '+pages;$('timesheetPrev').disabled=page<=1;$('timesheetNext').disabled=page>=pages;
 }catch(e){page=1;$('timesheetRows').innerHTML='<tr><td colspan="6">'+esc(e.message||String(e))+'</td></tr>';$('timesheetPage').textContent='Page 1 of 1';$('timesheetPrev').disabled=true;$('timesheetNext').disabled=true;}
}
function exportCsv(){
 let data;try{data=current();}catch(e){showToast(e.message||String(e),'error');return;}
 if(!data.rows.length){showToast('No completed shifts available for these filters.','info');return;}
 const cell=x=>{let v=String(x??'');if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
 const grid=[['Member Name','Member ID','Date','Sessions','Elapsed Hours','Potential Overtime Hours'],...data.rows.map(r=>[r.memberName,r.memberId,r.day,r.sessions,hrs(r.minutes),hrs(r.potentialOTMinutes)])];
 const csv='\ufeff'+grid.map(row=>row.map(cell).join(',')).join('\r\n');
 downloadBlob('TIPON_Timesheet_Estimate_'+todayPH()+'.csv',new Blob([csv],{type:'text/csv;charset=utf-8'}));showToast('Timesheet CSV exported.','success');
}
function bind(){
 if(!$('timesheetPreview'))return;
 for(const id of ['timesheetSearch','timesheetFrom','timesheetTo'])$(id)?.addEventListener(id==='timesheetSearch'?'input':'change',()=>{page=1;render();});
 $('timesheetPrev')?.addEventListener('click',()=>{page=Math.max(1,page-1);render();});
 $('timesheetNext')?.addEventListener('click',()=>{page++;render();});
 $('timesheetExport')?.addEventListener('click',exportCsv);
 window.addEventListener('tipon:workspace-data-updated',render);
}
document.addEventListener('DOMContentLoaded',bind);
window.TIPONTimesheet=Object.freeze({summarize,render});
})();