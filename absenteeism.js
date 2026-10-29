/* TIPON KABILANG — Absenteeism / Attendance Analytics.
 * No Time In is a review flag, not a confirmed absence or AWOL classification.
 */
'use strict';
window.TIPONAbsenteeism=(()=>{
 const $=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ph=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t+28800000).toISOString().slice(0,10):'';};
 const pct=(a,b)=>b?Math.round(1000*a/b)/10:0;
 const dates=last=>{const end=Date.parse(last+'T00:00:00Z');return Number.isFinite(end)?Array.from({length:14},(_,i)=>new Date(end-(13-i)*86400000).toISOString().slice(0,10)):[];};
 function compute(members=[],sites=[],events=[],schedules=[],to='',coop='',now=Date.now(),from=''){
  const eligible=(members||[]).filter(m=>m&&!m.deleted&&m.active!==false&&(m.template||m.descriptors?.length>=3)&&(!coop||m.coop===coop));
  const all=(members||[]).filter(m=>m&&!m.deleted&&(!coop||m.coop===coop));
  const ids=new Set(eligible.map(m=>String(m.id))),loc=new Map((sites||[]).map(s=>[String(s.id),s]));
  const ins=new Map(),outs=new Map(),sessions=new Map();
  for(const e of events||[]){
   if(!e||e.deleted||e.reviewStatus||!e.timestamp||!ids.has(String(e.memberId))||!['IN','OUT'].includes(e.type))continue;
   const time=Date.parse(e.timestamp),day=ph(e.timestamp);if(!day||!Number.isFinite(time))continue;
   if(e.type==='IN'){if(!ins.has(day))ins.set(day,new Set());ins.get(day).add(String(e.memberId));}
    if(e.type==='OUT'){if(!outs.has(day))outs.set(day,new Set());outs.get(day).add(String(e.memberId));}
   const key=String(e.memberId)+':'+String(e.sessionId||e.id||'');
   const s=sessions.get(key)||{id:String(e.memberId),start:null,end:null};
   if(e.type==='IN'&&(s.start===null||time<s.start))s.start=time;
   if(e.type==='OUT'&&(s.end===null||time>s.end))s.end=time;
   sessions.set(key,s);
  }
  const shifts=new Map();
  for(const s of sessions.values()){
   if(s.start===null)continue;const day=ph(new Date(s.start).toISOString());
   const n=shifts.get(day)||{hours:0,complete:0,open:0};
   if(s.end!==null&&s.end>=s.start&&s.end-s.start<=86400000){n.hours+=(s.end-s.start)/3600000;n.complete++;}
   else if(s.end===null)n.open++;
   shifts.set(day,n);
  }
  const rows=dates(to).filter(day=>!from||day>=from).map(day=>{
   const roster=eligible.filter(m=>!ph(m.createdAt)||ph(m.createdAt)<=day);
   const presentSet=ins.get(day)||new Set(),present=roster.filter(m=>presentSet.has(String(m.id))).length;
   const missing=[],outOnly=[],leave=[];let provisional=0;
   for(const m of roster){
    if(presentSet.has(String(m.id)))continue;
    if(outs.get(day)?.has(String(m.id))){outOnly.push(m);continue;}
    let sched={kind:'UNSCHEDULED'};
    try{sched=TIPONOrgCore.scheduled(m,loc.get(String(m.siteId||m.siteIds?.[0]||'')),day,schedules||[]);}catch(_){}
    if(['REST','LEAVE','EXCUSED'].includes(sched.kind)){leave.push(m);continue;}
    missing.push(m);
    if(sched.kind==='REQUIRED'&&Number.isFinite(sched.end)&&now>sched.end)provisional++;
   }
   const t=shifts.get(day)||{hours:0,complete:0,open:0};
   return {day,eligible:roster.length,present,noIn:missing.length,outOnly:outOnly.length,leave:leave.length,provisional,hours:t.hours,complete:t.complete,open:t.open,missing,outOnlyMembers:outOnly};
  });
  const focus=rows[rows.length-1]||null;
  const registered=all.filter(m=>!ph(m.createdAt)||ph(m.createdAt)<=to).length;
  return {rows,focus,registered,unenrolled:Math.max(0,registered-(focus?.eligible||0)),
   coverage:pct(focus?.present||0,focus?.eligible||0),noInRate:pct(focus?.noIn||0,focus?.eligible||0)};
 }
 const fmt=n=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:1}).format(n);
 function kpi(label,n,note,kind){
  return '<article class="ab-kpi ab-'+kind+'"><small>'+escape(label)+'</small><strong>'+escape(n)+'</strong><span>'+escape(note)+'</span></article>';
 }
 function chart(rows,kind){
  const w=720,h=230,left=35,right=12,top=12,bottom=39,ph=h-top-bottom,pw=w-left-right;
  const max=Math.max(2,...rows.map(x=>kind==='head'?x.eligible:x.hours));
  const ceiling=kind==='head'?Math.ceil(max):Math.ceil(max/2)*2;
  let svg='<svg class="ab-plot" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+(kind==='head'?'Daily enrolled headcount and recorded Time Ins':'Validated working hours by day')+'">';
  for(let j=0;j<=4;j++){const y=top+ph*j/4;svg+='<path d="M'+left+' '+y+'H'+(w-right)+'" stroke="#e3ebf5"/><text class="ab-axis" x="'+(left-7)+'" y="'+(y+4)+'" text-anchor="end">'+Math.round((ceiling*(4-j)/4)*10)/10+'</text>';}
  const step=pw/Math.max(1,rows.length);
  rows.forEach((r,i)=>{
   const x=left+(i+.5)*step,day=r.day.slice(5).replace('-','/');
   if(kind==='head'){
    const e=ph*r.eligible/ceiling,a=ph*r.present/ceiling,z=Math.min(13,step*.28);
    svg+='<rect x="'+(x-z-2)+'" y="'+(top+ph-e)+'" width="'+z+'" height="'+e+'" rx="2.5" fill="#b5cce8"/>';
    svg+='<rect x="'+(x+2)+'" y="'+(top+ph-a)+'" width="'+z+'" height="'+a+'" rx="2.5" fill="#147cdb"/>';
   }else{
    const value=ph*r.hours/ceiling,z=Math.min(25,step*.65);
    svg+='<rect x="'+(x-z/2)+'" y="'+(top+ph-value)+'" width="'+z+'" height="'+value+'" rx="4" fill="#28a1ae"/>';
   }
   if(i%2===0||rows.length<=8)svg+='<text class="ab-axis" x="'+x+'" y="'+(h-12)+'" text-anchor="middle">'+day+'</text>';
  });
  return svg+'</svg>';
 }
 function render({from='',to='',coop='',valid=true}={}){
  if(!valid){invalid();return;}
  if(!state.user||!['admin','registrar'].includes(state.user.role)||!$('absPanel'))return;
  const d=compute(state.members,state.sites,state.punches,state.schedules,to,coop,Date.now(),from);
  const a=d.focus;if(!a)return;
  $('absPeriod').textContent='Date: '+a.day+' · '+(coop||'All Cooperatives');
  const lastSync=window.TIPONSync?.lastSuccessfulSync?.()||'';
  const syncVerified=!!lastSync&&navigator.onLine;
  $('absConnection').textContent=!navigator.onLine?'Offline — records may be incomplete':
   syncVerified?'Last Sync: '+lastSync:'Sync required — records may be incomplete';
  $('absKPIs').innerHTML=[
   kpi('Missing Time In',fmt(d.noInRate)+'%',a.noIn+' unverified record(s)','red'),
   kpi('Headcount Coverage',fmt(d.coverage)+'%',a.present+' of '+a.eligible+' enrolled members','blue'),
   kpi('Validated Manhours',fmt(Math.round(a.hours*10)/10)+' h',a.complete+' completed shifts','teal'),
   kpi('Open Time Ins',a.open,'Missing a paired Time Out','orange'),
   kpi('AWOL COUNT',a.provisional,'Schedule-based; verify before action','red')
  ].join('');
  $('absHeadcount').innerHTML=chart(d.rows,'head');
  $('absHours').innerHTML=chart(d.rows,'hours');
  const percent1=pct(a.present,a.eligible),percent2=pct(a.noIn,a.eligible);
  $('absDonut').style.background=a.eligible?'conic-gradient(#167bda 0% '+percent1+'%,#e36d64 '+percent1+'% '+(percent1+percent2)+'%,#9bafc5 '+(percent1+percent2)+'% 100%)':'#e6edf5';
  $('absDonut').setAttribute('aria-label',a.present+' present, '+a.noIn+' with no Time In, '+a.leave+' approved rest or leave');
  $('absDonutNumber').textContent=a.eligible;
  $('absStatusLegend').innerHTML=[
   ['#167bda','With Time In',a.present],['#e36d64','Time In Unverified',a.noIn],['#9bafc5','Rest / Leave',a.leave]
  ].map(([color,label,count])=>'<div class="ab-legend-row"><i style="background:'+color+'"></i><span>'+escape(label)+'</span><b>'+count+'</b></div>').join('')+
   '<p class="ab-small">'+d.unenrolled+' registered member(s) not yet eligible for face attendance.</p>';
  const review=[...a.outOnlyMembers.map(m=>({member:m,flag:'Time Out Found — Check Sync'})),
   ...a.missing.map(m=>({member:m,flag:syncVerified?'Time In Not Verified':'Sync Required'}))];
  $('absReviewCount').textContent=review.length+' to review';
  $('absReviewRows').innerHTML=review.length?review.slice(0,8).map(({member:m,flag})=>
   '<tr><td>'+escape(m.id)+'</td><td>'+escape(m.name)+'</td><td>'+escape(m.coop)+'</td><td><span class="ab-flag">'+escape(flag)+'</span></td><td><button type="button" class="tiny-button" data-review-member="'+escape(m.id)+'" data-review-day="'+escape(a.day)+'">Review</button></td></tr>'
  ).join(''):'<tr><td colspan="5">No attendance discrepancies in the available records.</td></tr>';
  $('absReviewMore').textContent=review.length>8?'Showing 8 of '+review.length+'.':'';
 }
 function invalid(){if($('absKPIs'))$('absKPIs').innerHTML='<p class="ab-empty">Select a valid date range before viewing attendance analytics.</p>';}
 async function syncNow(){
  const btn=$('absSyncNow');if(!btn||btn.disabled)return;
  if(!navigator.onLine){showToast('Internet is required to refresh organization attendance.','error');return;}
  btn.disabled=true;btn.textContent='Syncing...';
  try{const r=await TIPONSync.submitPendingNow();if(!r?.ok)throw Error(r?.error||'Sync failed.');
   await loadCollections();renderDashboard();if(r.pending)showToast('Absenteeism refreshed, but '+r.pending+' record(s) still require synchronization review.','info',9000);else showToast('Absenteeism refreshed from the organization.','success');
  }catch(e){showToast('Sync was not completed: '+(e.message||e),'error',9000);}
  finally{btn.disabled=false;btn.textContent='Sync Now';}
 }
 function bind(){
  const el=$('absSyncNow');if(el&&!el.dataset.bound){el.dataset.bound='1';el.addEventListener('click',syncNow);}
  const rows=$('absReviewRows');if(rows&&!rows.dataset.bound){rows.dataset.bound='1';rows.addEventListener('click',event=>{
   const button=event.target.closest('[data-review-member]');if(!button)return;
   const search=$('terminalLogSearch');if(search)search.value=button.dataset.reviewMember||'';
   if($('terminalLogFrom'))$('terminalLogFrom').value=button.dataset.reviewDay||'';
   if($('terminalLogTo'))$('terminalLogTo').value=button.dataset.reviewDay||'';
   showPage('terminalLogs');renderTerminalLogs();
  });}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
 return {compute,render,invalid};
})();