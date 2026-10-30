/* TIPON Read-only Timesheet Preview. Does not modify recorded attendance. */
'use strict';
(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const hrs=min=>(Math.max(0,min)/60).toFixed(2);
 let page=1;const LIMIT=10;
 function summarize(records,interval=0,thresholdHours=8){
  const map=new Map(),round=Math.max(0,Number(interval)||0),limit=(Number(thresholdHours)||8)*60;
  let excluded=0;
  for(const r of records||[]){
   const a=Date.parse(r.timeIn),b=Date.parse(r.timeOut);
   if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>24*3600000){excluded++;continue;}
   const id=String(r.memberId||'').trim(),day=TIPONCore.phStamp(r.timeIn).slice(0,10);
   if(!id||!day){excluded++;continue;}
   const k=id+'|'+day,v=map.get(k)||{memberId:id,memberName:String(r.memberName||'Name unavailable'),day,sessions:0,minutes:0};
   v.minutes+=(b-a)/60000;v.sessions++;map.set(k,v);
  }
  return {rows:[...map.values()].map(r=>{
   const roundedMinutes=round?Math.round(r.minutes/round)*round:r.minutes;
   return {...r,roundedMinutes,potentialOTMinutes:Math.max(0,roundedMinutes-limit)};
  }).sort((a,b)=>b.day.localeCompare(a.day)||a.memberName.localeCompare(b.memberName)),excluded};
 }
 function current(){return summarize(filteredTerminalLogRows(),$('timesheetRound')?.value||0,$('timesheetOT')?.value||8);}
 function render(){
  if(!$('timesheetPreview')?.open)return;
  try{
   const data=current(),pages=Math.max(1,Math.ceil(data.rows.length/LIMIT));
   page=Math.min(pages,Math.max(1,page));const from=(page-1)*LIMIT;
   $('timesheetRows').innerHTML=data.rows.slice(from,from+LIMIT).map(r=>'<tr>'+
    [r.memberName,r.memberId,r.day,r.sessions,hrs(r.minutes),hrs(r.roundedMinutes),hrs(r.potentialOTMinutes)]
     .map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')||
     '<tr><td colspan="7">No completed shifts match the Attendance Logs filters.</td></tr>';
   $('timesheetPage').textContent='Page '+page+' of '+pages;
   $('timesheetPrev').disabled=page<=1;$('timesheetNext').disabled=page>=pages;
   $('timesheetTotal').textContent=data.rows.length+' member-day(s); '+data.excluded+' incomplete or invalid shift(s) excluded';
  }catch(e){$('timesheetRows').innerHTML='<tr><td colspan="7">'+esc(e.message||String(e))+'</td></tr>';}
 }
 function exportCsv(){
  let data;try{data=current();}catch(e){showToast(e.message||String(e),'error');return;}
  if(!data.rows.length){showToast('No completed shifts available.','info');return;}
  const cell=x=>{let v=String(x??'');if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
  const grid=[['Member Name','Member ID','Date','Sessions','Elapsed Hours','Rounded Hours','Potential Overtime Hours'],
    ...data.rows.map(r=>[r.memberName,r.memberId,r.day,r.sessions,hrs(r.minutes),hrs(r.roundedMinutes),hrs(r.potentialOTMinutes)])];
  const csv='\ufeff'+grid.map(row=>row.map(cell).join(',')).join('\r\n');
  downloadBlob('TIPON_Timesheet_Estimate_'+todayPH()+'.csv',new Blob([csv],{type:'text/csv;charset=utf-8'}));
  showToast('Read-only timesheet estimate exported. It is not payroll-approved.','success');
 }
 function bind(){
  if(!$('timesheetPreview'))return;
  $('timesheetPreview').addEventListener('toggle',()=>{page=1;render();});
  for(const id of ['timesheetRound','timesheetOT'])$(id)?.addEventListener('change',()=>{page=1;render();});
  $('timesheetPrev')?.addEventListener('click',()=>{page=Math.max(1,page-1);render();});
  $('timesheetNext')?.addEventListener('click',()=>{page++;render();});
  $('timesheetExport')?.addEventListener('click',exportCsv);
  for(const id of ['terminalLogFrom','terminalLogTo','terminalLogCoop','terminalLogPlatform','terminalLogSite','terminalLogSearch'])
   $(id)?.addEventListener('change',()=>{page=1;queueMicrotask(render);});
  window.addEventListener('tipon:workspace-data-updated',render);
 }
 document.addEventListener('DOMContentLoaded',bind);
 window.TIPONTimesheet=Object.freeze({summarize,render});
})();