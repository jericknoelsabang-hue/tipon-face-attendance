/* TIPON KABILANG — Attendance Analytics.
 * Missing Time In is a review flag, not a confirmed absence or AWOL classification.
 */
'use strict';
window.TIPONAbsenteeism=(()=>{
 const $=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ph=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t+28800000).toISOString().slice(0,10):'';};
 const pct=(a,b)=>b?Math.round(1000*a/b)/10:0;
 const fmt=n=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:1}).format(n);
 const PAGE_SIZE=10;
 let reviewPage=1,lastFilterKey='',lastFilters={from:'',to:'',coop:'',valid:true};

 function daysBetween(start,end){
  const a=Date.parse(String(start||'')+'T00:00:00Z'),b=Date.parse(String(end||'')+'T00:00:00Z');
  if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)return [];
  const out=[];
  for(let t=a;t<=b&&out.length<36600;t+=86400000)out.push(new Date(t).toISOString().slice(0,10));
  return out;
 }
 function compute(members=[],sites=[],events=[],schedules=[],to='',coop='',now=Date.now(),from=''){
  const eligible=(members||[]).filter(m=>m&&!m.deleted&&m.active!==false&&(m.template||m.descriptors?.length>=3)&&(!coop||m.coop===coop));
  const all=(members||[]).filter(m=>m&&!m.deleted&&(!coop||m.coop===coop));
  const ids=new Set(eligible.map(m=>String(m.id))),byId=new Map(eligible.map(m=>[String(m.id),m]));
  const loc=new Map((sites||[]).map(s=>[String(s.id),s]));
  const historyDays=[
   ...(events||[]).filter(e=>e&&!e.deleted&&e.timestamp).map(e=>ph(e.timestamp)),
   ...all.filter(m=>m.createdAt).map(m=>ph(m.createdAt)),
   ...(schedules||[]).map(s=>ph(s.date||s.day||s.createdAt))
  ].filter(Boolean);
  const today=ph(new Date(now).toISOString()),endDay=to||today;
  const startDay=from||(historyDays.length?historyDays.sort()[0]:endDay);
  const days=daysBetween(startDay,endDay);
  if(!days.length)return {rows:[],focus:null,registered:0,unenrolled:0,coverage:0,noInRate:0,startDay,endDay,
   summary:{eligibleMemberDays:0,presentMemberDays:0,missingMemberDays:0,leaveMemberDays:0,awolMemberDays:0,
    awolCount:0,hours:0,complete:0,open:0}};

  const ins=new Map(),outs=new Map(),sessions=new Map();
  for(const e of events||[]){
   if(!e||e.deleted||e.reviewStatus||!e.timestamp||!ids.has(String(e.memberId))||!['IN','OUT'].includes(e.type))continue;
   const time=Date.parse(e.timestamp),day=ph(e.timestamp);
   if(!day||!Number.isFinite(time))continue;
   if(e.type==='IN'){if(!ins.has(day))ins.set(day,new Set());ins.get(day).add(String(e.memberId));}
   if(e.type==='OUT'){if(!outs.has(day))outs.set(day,new Set());outs.get(day).add(String(e.memberId));}
   const sessionId=String(e.sessionId||e.id||''),key=String(e.memberId)+':'+sessionId;
   const session=sessions.get(key)||{memberId:String(e.memberId),sessionId:sessionId,siteId:e.siteId||'',start:null,end:null};
   if(e.type==='IN'&&(session.start===null||time<session.start)){session.start=time;session.siteId=e.siteId||session.siteId;}
   if(e.type==='OUT'&&(session.end===null||time>session.end))session.end=time;
   sessions.set(key,session);
  }
  const shifts=new Map();
  for(const session of sessions.values()){
   if(session.start===null)continue;
   const day=ph(new Date(session.start).toISOString());
   const tally=shifts.get(day)||{hours:0,complete:0,open:0};
   if(session.end!==null&&session.end>=session.start&&session.end-session.start<=86400000){tally.hours+=(session.end-session.start)/3600000;tally.complete++;}
   else if(session.end===null)tally.open++;
   shifts.set(day,tally);
  }
  const rows=days.map(day=>{
   const roster=eligible.filter(m=>!ph(m.createdAt)||ph(m.createdAt)<=day);
   const presentSet=ins.get(day)||new Set();
   const present=roster.filter(m=>presentSet.has(String(m.id))).length;
   const missing=[],outOnly=[],leave=[],awolMembers=[];
   for(const member of roster){
    if(presentSet.has(String(member.id)))continue;
    if(outs.get(day)?.has(String(member.id))){outOnly.push(member);continue;}
    let schedule={kind:'UNSCHEDULED'};
    try{schedule=TIPONOrgCore.scheduled(member,loc.get(String(member.siteId||member.siteIds?.[0]||'')),day,schedules||[]);}catch(_){}
    if(['REST','LEAVE','EXCUSED'].includes(schedule.kind)){leave.push(member);continue;}
    missing.push(member);
    if(schedule.kind==='REQUIRED'&&Number.isFinite(schedule.end)&&now>schedule.end)awolMembers.push(member);
   }
   const tally=shifts.get(day)||{hours:0,complete:0,open:0};
   const openSessions=day===endDay?[...sessions.values()].filter(session=>session.start!==null&&session.end===null&&
    ph(new Date(session.start).toISOString())<=day).map(session=>({...session,member:byId.get(session.memberId)})).filter(session=>session.member):[];
   return {day,eligible:roster.length,present,noIn:missing.length,outOnly:outOnly.length,leave:leave.length,
    provisional:awolMembers.length,hours:tally.hours,complete:tally.complete,open:openSessions.length,
    missing,outOnlyMembers:outOnly,awolMembers,openSessions};
  });
  const focus=rows[rows.length-1]||null;
  const registered=all.filter(m=>!ph(m.createdAt)||ph(m.createdAt)<=endDay).length;
  const sum=rows.reduce((a,row)=>({
   eligibleMemberDays:a.eligibleMemberDays+row.eligible,
   presentMemberDays:a.presentMemberDays+row.present,
   missingMemberDays:a.missingMemberDays+row.noIn,
   leaveMemberDays:a.leaveMemberDays+row.leave,
   awolMemberDays:a.awolMemberDays+row.provisional,
   hours:a.hours+row.hours,complete:a.complete+row.complete
  }),{eligibleMemberDays:0,presentMemberDays:0,missingMemberDays:0,leaveMemberDays:0,awolMemberDays:0,hours:0,complete:0});
  const awolIds=new Set(rows.flatMap(row=>row.awolMembers.map(m=>String(m.id))));
  const open=[...sessions.values()].filter(session=>session.start!==null&&session.end===null&&
   ph(new Date(session.start).toISOString())<=endDay);
  const summary={...sum,awolCount:awolIds.size,open:open.length};
  return {rows,focus,registered,unenrolled:Math.max(0,registered-(focus?.eligible||0)),
   coverage:pct(sum.presentMemberDays,sum.eligibleMemberDays),noInRate:pct(sum.missingMemberDays,sum.eligibleMemberDays),
   summary,startDay,endDay};
 }
 function kpi(label,value,note,kind){
  return '<article class="ab-kpi ab-'+kind+'"><small>'+escape(label)+'</small><strong>'+escape(value)+'</strong><span>'+escape(note)+'</span></article>';
 }
 function chart(rows,kind){
  const w=720,h=230,left=35,right=12,top=12,bottom=39,plotHeight=h-top-bottom,pw=w-left-right;
  const max=Math.max(2,...rows.map(x=>kind==='head'?x.eligible:x.hours));
  const ceiling=kind==='head'?Math.ceil(max):Math.ceil(max/2)*2;
  let svg='<svg class="ab-plot" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+(kind==='head'?'Daily enrolled headcount and recorded Time Ins':'Validated working hours by day')+'">';
  for(let j=0;j<=4;j++){
   const y=top+plotHeight*j/4;
   svg+='<path d="M'+left+' '+y+'H'+(w-right)+'" stroke="#e3ebf5"/><text class="ab-axis" x="'+(left-7)+'" y="'+(y+4)+'" text-anchor="end">'+Math.round((ceiling*(4-j)/4)*10)/10+'</text>';
  }
  const step=pw/Math.max(1,rows.length),labelEvery=Math.max(1,Math.ceil(rows.length/12));
  rows.forEach((row,i)=>{
   const x=left+(i+.5)*step,day=row.day.slice(5).replace('-','/');
   if(kind==='head'){
    const eligibleHeight=plotHeight*row.eligible/ceiling,presentHeight=plotHeight*row.present/ceiling,z=Math.min(13,step*.28);
    svg+='<rect x="'+(x-z-2)+'" y="'+(top+plotHeight-eligibleHeight)+'" width="'+z+'" height="'+eligibleHeight+'" rx="2.5" fill="#b5cce8"/>';
    svg+='<rect x="'+(x+2)+'" y="'+(top+plotHeight-presentHeight)+'" width="'+z+'" height="'+presentHeight+'" rx="2.5" fill="#147cdb"/>';
   }else{
    const value=plotHeight*row.hours/ceiling,z=Math.min(25,step*.65);
    svg+='<rect x="'+(x-z/2)+'" y="'+(top+plotHeight-value)+'" width="'+z+'" height="'+value+'" rx="4" fill="#28a1ae"/>';
   }
   if(i%labelEvery===0||i===rows.length-1)svg+='<text class="ab-axis" x="'+x+'" y="'+(h-12)+'" text-anchor="middle">'+day+'</text>';
  });
  return svg+'</svg>';
 }
 function reviewRecords(data,syncVerified){
  const records=new Map();
  const add=(member,day,flag,sessionId='')=>{
   if(!member)return;
   const key=[String(member.id),day,flag,sessionId].join('|');
   if(!records.has(key))records.set(key,{member,day,flag});
  };
  for(const row of data.rows){
   const awol=new Set(row.awolMembers.map(m=>String(m.id)));
   row.outOnlyMembers.forEach(member=>add(member,row.day,'Time Out Found — Check Sync'));
   row.missing.forEach(member=>add(member,row.day,awol.has(String(member.id))?'AWOL — Verify Schedule':'Time In Not Verified'));
   row.openSessions.forEach(session=>add(session.member,ph(new Date(session.start).toISOString()),'Open Time In',session.sessionId));
  }
  return [...records.values()].sort((a,b)=>b.day.localeCompare(a.day)||
   String(a.member.name||'').localeCompare(String(b.member.name||''))||a.flag.localeCompare(b.flag));
 }
 function render({from='',to='',coop='',valid=true}={}){
  lastFilters={from,to,coop,valid};
  const filterKey=[from,to,coop,valid].join('|');
  if(filterKey!==lastFilterKey){reviewPage=1;lastFilterKey=filterKey;}
  if(!valid){invalid();return;}
  if(!state.user||!['admin','registrar'].includes(state.user.role)||!$('absPanel'))return;
  const data=compute(state.members,state.sites,state.punches,state.schedules,to,coop,Date.now(),from);
  const focus=data.focus,summary=data.summary;
  if(!focus){
   $('absPeriod').textContent='No attendance dates are available for the selected filters.';
   $('absKPIs').innerHTML='<p class="ab-empty">No attendance records match this date range.</p>';
   $('absHeadcount').innerHTML=chart([],'head');$('absHours').innerHTML=chart([],'hours');
   $('absDonutNumber').textContent='0';$('absDonut').style.background='#e6edf5';$('absStatusLegend').innerHTML='';
   $('absReviewCount').textContent='0 to review';
   $('absReviewRows').innerHTML='<tr><td colspan="5">No attendance discrepancies in the available records.</td></tr>';
   $('absReviewMore').textContent='Showing 0 review records';
   $('absReviewPrev').disabled=true;$('absReviewNext').disabled=true;$('absReviewPage').textContent='Page 1 of 1';
   return;
  }
  $('absPeriod').textContent=(!from&&!to?'Date range: All available history ('+data.startDay+' to '+data.endDay+')':
   'Date range: '+(from||data.startDay)+' to '+(to||data.endDay))+' · '+(coop||'All Cooperatives');
  const lastSync=window.TIPONSync?.lastSuccessfulSync?.()||'';
  const syncVerified=!!lastSync&&navigator.onLine;
  $('absConnection').textContent=!navigator.onLine?'Offline — records may be incomplete':
   syncVerified?'Last Sync: '+lastSync:'Sync required — records may be incomplete';
  $('absKPIs').innerHTML=[
   kpi('Missing Time In',fmt(data.noInRate)+'%',summary.missingMemberDays+' unverified member-day(s)','red'),
   kpi('Headcount Coverage',fmt(data.coverage)+'%',summary.presentMemberDays+' of '+summary.eligibleMemberDays+' eligible member-days','blue'),
   kpi('Validated Manhours',fmt(Math.round(summary.hours*10)/10)+' h',summary.complete+' completed shifts in selected period','teal'),
   kpi('Open Time Ins',summary.open,'Current open sessions in selected period','orange'),
   kpi('AWOL COUNT',summary.awolCount,'Schedule-based; verify before action','red')
  ].join('');
  $('absHeadcount').innerHTML=chart(data.rows,'head');
  $('absHours').innerHTML=chart(data.rows,'hours');
  const percent1=pct(focus.present,focus.eligible),percent2=pct(focus.noIn,focus.eligible);
  $('absDonut').style.background=focus.eligible?'conic-gradient(#167bda 0% '+percent1+'%,#e36d64 '+percent1+'% '+(percent1+percent2)+'%,#9bafc5 '+(percent1+percent2)+'% 100%)':'#e6edf5';
  $('absDonut').setAttribute('aria-label',focus.present+' present, '+focus.noIn+' with no Time In, '+focus.leave+' approved rest or leave');
  $('absDonutNumber').textContent=focus.eligible;
  $('absStatusLegend').innerHTML=[
   ['#167bda','With Time In',focus.present],['#e36d64','Time In Unverified',focus.noIn],['#9bafc5','Rest / Leave',focus.leave]
  ].map(([color,label,count])=>'<div class="ab-legend-row"><i style="background:'+color+'"></i><span>'+escape(label)+'</span><b>'+count+'</b></div>').join('')+
   '<p class="ab-small">'+data.unenrolled+' registered member(s) not yet eligible for face attendance.</p>';
  const review=reviewRecords(data,syncVerified),totalPages=Math.max(1,Math.ceil(review.length/PAGE_SIZE));
  reviewPage=Math.max(1,Math.min(reviewPage,totalPages));
  const offset=(reviewPage-1)*PAGE_SIZE,visible=review.slice(offset,offset+PAGE_SIZE);
  $('absReviewCount').textContent=review.length+' to review';
  $('absReviewRows').innerHTML=visible.length?visible.map(item=>
   '<tr><td>'+escape(item.member.memberNumber||item.member.id)+'</td><td>'+escape(item.member.name)+'</td><td>'+escape(item.member.coop)+'</td><td>'+escape(item.day)+'</td><td><span class="ab-flag">'+escape(item.flag)+'</span></td></tr>'
  ).join(''):'<tr><td colspan="5">No attendance discrepancies in the available records.</td></tr>';
  $('absReviewMore').textContent='Showing '+(review.length?offset+1:0)+'–'+Math.min(offset+PAGE_SIZE,review.length)+' of '+review.length+' review records';
  $('absReviewPrev').disabled=reviewPage<=1;$('absReviewNext').disabled=reviewPage>=totalPages;
  $('absReviewPage').textContent='Page '+reviewPage+' of '+totalPages;
 }
 function invalid(){
  if($('absKPIs'))$('absKPIs').innerHTML='<p class="ab-empty">Select a valid date range before viewing attendance analytics.</p>';
  if($('absReviewRows'))$('absReviewRows').innerHTML='<tr><td colspan="5">Select a valid date range.</td></tr>';
  if($('absReviewMore'))$('absReviewMore').textContent='Showing 0 review records';
  if($('absReviewPrev'))$('absReviewPrev').disabled=true;if($('absReviewNext'))$('absReviewNext').disabled=true;
 }
 async function syncNow(){
  const btn=$('absSyncNow');if(!btn||btn.disabled)return;
  if(!navigator.onLine){showToast('Internet is required to refresh organization attendance.','error');return;}
  btn.disabled=true;btn.textContent='Syncing...';
  try{const result=await TIPONSync.submitPendingNow();if(!result?.ok)throw Error(result?.error||'Sync failed.');
   await loadCollections();renderDashboard();
   if(result.pending)showToast('Absenteeism refreshed, but '+result.pending+' record(s) still require synchronization review.','info',9000);
   else showToast('Absenteeism refreshed from the organization.','success');
  }catch(error){showToast('Sync was not completed: '+(error.message||error),'error',9000);}
  finally{btn.disabled=false;btn.textContent='Sync Now';}
 }
 function bind(){
  const sync=$('absSyncNow');if(sync&&!sync.dataset.bound){sync.dataset.bound='1';sync.addEventListener('click',syncNow);}
  const previous=$('absReviewPrev'),next=$('absReviewNext');
  if(previous&&!previous.dataset.bound){previous.dataset.bound='1';previous.addEventListener('click',()=>{reviewPage=Math.max(1,reviewPage-1);render(lastFilters);});}
  if(next&&!next.dataset.bound){next.dataset.bound='1';next.addEventListener('click',()=>{reviewPage++;render(lastFilters);});}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
 return {compute,render,invalid};
})();
