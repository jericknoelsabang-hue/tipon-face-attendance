/* TIPON KABILANG — Attendance Analytics.
 * Review flags (Absent / Late / No Time Out / AWOL) require schedule and sync verification before any personnel action.
 */
'use strict';
window.TIPONAbsenteeism=(()=>{
 const $=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ph=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t+28800000).toISOString().slice(0,10):'';};
 const pct=(a,b)=>b?Math.round(1000*a/b)/10:0;
 const fmt=n=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:1}).format(n);
 const PAGE_SIZE=10;
 let lastRenderDataKey='',lastRenderedPage=0,lastReviewRecords=[],reviewPage=1,lastFilterKey='',lastFilters={from:'',to:'',coop:'',valid:true};

 function daysBetween(start,end){
  const a=Date.parse(String(start||'')+'T00:00:00Z'),b=Date.parse(String(end||'')+'T00:00:00Z');
  if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)return [];
  const out=[];
  for(let t=a;t<=b&&out.length<36600;t+=86400000)out.push(new Date(t).toISOString().slice(0,10));
  return out;
 }
 function compute(members=[],sites=[],events=[],schedules=[],to='',coop='',now=Date.now(),from='',platform='',site=''){
  const all=(members||[]).filter(m=>m&&!m.deleted&&(!coop||m.coop===coop)&&
   (!platform||TIPONOrgCore.platformKey(m.platform)===TIPONOrgCore.platformKey(platform))&&
   (!site||[m.siteId,...(m.siteIds||[])].map(String).includes(String(site))));
  const eligible=all.filter(m=>m.active!==false),byId=new Map(eligible.map(m=>[String(m.id),m]));
  const loc=new Map((sites||[]).map(s=>[String(s.id),s])),plans=new Map();
  const planFor=(member,day)=>{
   const key=String(member.id)+'|'+day;if(plans.has(key))return plans.get(key);
   let plan={kind:'UNSCHEDULED'};
   try{plan=TIPONOrgCore.scheduled(member,loc.get(String(member.siteId||member.siteIds?.[0]||'')),day,schedules||[]);}catch(_){}
   plans.set(key,plan);return plan;
  };
  const filteredEvents=(events||[]).filter(e=>e&&!e.deleted&&!e.reviewStatus&&byId.has(String(e.memberId))&&
   (!coop||e.coop===coop)&&(!platform||TIPONOrgCore.platformKey(e.platform)===TIPONOrgCore.platformKey(platform))&&
   (!site||String(e.siteId||'')===String(site))&&Number.isFinite(Date.parse(e.timestamp))&&Date.parse(e.timestamp)<=now);
  const historyDays=[...filteredEvents.map(e=>ph(e.timestamp)),...all.map(m=>ph(m.createdAt)),
   ...(schedules||[]).filter(s=>!s.deleted).map(s=>ph(s.date||s.day||s.createdAt))].filter(Boolean).sort();
  const today=ph(new Date(now).toISOString()),endDay=to||today,knownStart=historyDays[0]||today,startDay=from||knownStart;
  const emptySummary={eligibleMemberDays:0,presentMemberDays:0,missingMemberDays:0,leaveMemberDays:0,awolMemberDays:0,awolCount:0,hours:0,complete:0,open:0,noTimeOut:0,lateCount:0,lateMinutes:0};
  if(!daysBetween(startDay,endDay).length)return {rows:[],focus:null,registered:0,unenrolled:0,coverage:0,noInRate:0,startDay,endDay,summary:emptySummary};
  const sessions=new Map(),seen=new Set(),outOnlyDays=new Map();
  for(const e of filteredEvents){
   if(!['IN','OUT'].includes(e.type)||seen.has(String(e.id)))continue;seen.add(String(e.id));
   const memberId=String(e.memberId),key=memberId+'|'+String(e.sessionId||e.id),time=Date.parse(e.timestamp);
   const s=sessions.get(key)||{memberId,sessionId:String(e.sessionId||e.id),siteId:e.siteId||'',start:null,end:null};
   if(e.type==='IN'&&(s.start===null||time<s.start))s.start=time;
   if(e.type==='OUT'&&(s.end===null||time>s.end))s.end=time;
   sessions.set(key,s);
  }
  const byDay=new Map();
  for(const s of sessions.values()){
   if(s.start===null){const key=s.memberId+'|'+ph(new Date(s.end).toISOString());outOnlyDays.set(key,true);continue;}
   const member=byId.get(s.memberId),calendarDay=ph(new Date(s.start).toISOString());
   const previous=new Date(Date.parse(calendarDay+'T00:00:00Z')-86400000).toISOString().slice(0,10),previousPlan=planFor(member,previous);
   const day=previousPlan.kind==='REQUIRED'&&Number.isFinite(previousPlan.start)&&Number.isFinite(previousPlan.end)&&
    ph(new Date(previousPlan.end).toISOString())>previous&&s.start>=previousPlan.start-14400000&&s.start<=previousPlan.end?previous:calendarDay;
   s.day=day;s.member=member;s.validOut=s.end!==null&&s.end>s.start&&s.end-s.start<=86400000;
   if(!byDay.has(day))byDay.set(day,new Map());
   const dayMembers=byDay.get(day);if(!dayMembers.has(s.memberId))dayMembers.set(s.memberId,[]);dayMembers.get(s.memberId).push(s);
  }
  // Three consecutive scheduled workdays; ordinary rest days are skipped.
  // Approved leave/excused days reset the streak. A weekly plan needs at most
  // 21 days to encounter three required days; include 31 days of lookback.
  const lookback=new Date(Date.parse(startDay+'T00:00:00Z')-31*86400000).toISOString().slice(0,10);
  const calculationStart=knownStart>lookback?knownStart:lookback,streaks=new Map(),rows=[];
  for(const day of daysBetween(calculationStart<startDay?calculationStart:startDay,endDay)){
   const row={day,eligible:0,present:0,noIn:0,outOnly:0,leave:0,provisional:0,hours:0,complete:0,open:0,
    noTimeOut:0,lateCount:0,lateMinutes:0,missing:[],outOnlyMembers:[],awolMembers:[],openSessions:[],overdueSessions:[],lateMembers:[],plans:new Map()};
   for(const member of eligible){
    const id=String(member.id),registered=ph(member.createdAt)||knownStart;if(registered>day)continue;
    const plan=planFor(member,day),shifts=byDay.get(day)?.get(id)||[],hasIn=shifts.length>0,outOnly=outOnlyDays.has(id+'|'+day)&&!hasIn;
    row.plans.set(id,plan);
    const required=plan.kind==='REQUIRED'&&day<=today&&(Number.isFinite(plan.start)?plan.start<=now:plan.end<=now);
    if(required){row.eligible++;if(hasIn)row.present++;}
    if(['REST','LEAVE','EXCUSED'].includes(plan.kind)){row.leave++;if(plan.kind!=='REST')streaks.set(id,0);}
    if(hasIn||outOnly)streaks.set(id,0);
    else if(required&&Number.isFinite(plan.end)&&plan.end<=now){
     row.missing.push(member);row.noIn++;const streak=(streaks.get(id)||0)+1;streaks.set(id,streak);
     if(streak>=3)row.awolMembers.push(member);
    }
    if(outOnly){row.outOnlyMembers.push(member);row.outOnly++;row.noIn++;}
    if(required&&hasIn&&Number.isFinite(plan.deadline??plan.start)){
     const first=Math.min(...shifts.map(s=>s.start)),deadline=plan.deadline??plan.start;
     if(first>deadline){const minutes=Math.ceil((first-deadline)/60000);row.lateMembers.push({member,minutes,first,plan});row.lateCount++;row.lateMinutes+=minutes;}
    }
    for(const shift of shifts){
     if(shift.validOut){row.complete++;row.hours+=(shift.end-shift.start)/3600000;}
     else{
      row.open++;row.openSessions.push(shift);
      const deadline=plan.kind==='REQUIRED'&&Number.isFinite(plan.end)?plan.end:shift.start+86400000;
      if(now>=deadline){row.noTimeOut++;row.overdueSessions.push(shift);}
     }
    }
   }
   row.provisional=row.awolMembers.length;if(day>=startDay)rows.push(row);
  }
  const summary=rows.reduce((sum,row)=>{
   sum.eligibleMemberDays+=row.eligible;sum.presentMemberDays+=row.present;sum.missingMemberDays+=row.noIn;
   sum.leaveMemberDays+=row.leave;sum.awolMemberDays+=row.provisional;sum.hours+=row.hours;sum.complete+=row.complete;
   sum.open+=row.open;sum.noTimeOut+=row.noTimeOut;sum.lateCount+=row.lateCount;sum.lateMinutes+=row.lateMinutes;return sum;
  },{...emptySummary});
  summary.awolCount=new Set(rows.flatMap(r=>r.awolMembers.map(m=>String(m.id)))).size;
  const focus=rows[rows.length-1]||null,registered=all.filter(m=>!ph(m.createdAt)||ph(m.createdAt)<=endDay).length;
  return {rows,focus,registered,unenrolled:Math.max(0,registered-eligible.length),coverage:pct(summary.presentMemberDays,summary.eligibleMemberDays),
   noInRate:pct(summary.missingMemberDays,summary.eligibleMemberDays),summary,startDay,endDay};
 }
 function potentialOvertime(rows,{from='',to='',coop='',platform='',site=''}={},account=null){
  const scoped=(rows||[]).filter(row=>{
   if(!row||!row.timeIn||!Number.isFinite(Date.parse(row.timeIn)))return false;
   if(!account||(account.role!=='admin'&&!TIPONOrgCore.inScope(account,row)))return false;
   const day=ph(row.timeIn);
   return (!from||day>=from)&&(!to||day<=to)&&
    (!coop||row.coop===coop)&&
    (!platform||TIPONOrgCore.platformKey(row.platform)===TIPONOrgCore.platformKey(platform))&&
    (!site||String(row.siteId||'')===String(site));
  });
  const estimate=window.TIPONTimesheet?.summarize(scoped,0,8);
  if(!estimate)return {minutes:0,memberDays:0,excluded:0};
  return {minutes:estimate.rows.reduce((sum,row)=>sum+row.potentialOTMinutes,0),
   memberDays:estimate.rows.filter(row=>row.potentialOTMinutes>0).length,excluded:estimate.excluded};
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
  const records=[];
  const add=(member,row,flag,extra={})=>records.push({member,day:row.day,flag,plan:row.plans?.get(String(member.id))||{},syncVerified,...extra});
  for(const row of data.rows){
   const awol=new Set(row.awolMembers.map(m=>String(m.id)));
   row.outOnlyMembers.forEach(member=>add(member,row,'Missing Time In'));
   row.missing.forEach(member=>add(member,row,awol.has(String(member.id))?'AWOL':'Absent'));
   (row.lateMembers||[]).forEach(item=>add(item.member,row,'Late',{lateMinutes:item.minutes,timeIn:new Date(item.first).toISOString()}));
   (row.overdueSessions||[]).forEach(session=>add(session.member,row,'No Time Out',{sessionId:session.sessionId,timeIn:new Date(session.start).toISOString()}));
  }
  return records.sort((a,b)=>b.day.localeCompare(a.day)||String(a.member.name||'').localeCompare(String(b.member.name||''))||a.flag.localeCompare(b.flag));
 }
 function renderEmpty({from='',to='',coop='',allHistory=false}={}){
  reviewPage=1;lastReviewRecords=[];lastRenderDataKey='';lastRenderedPage=0;if($('absReviewExport'))$('absReviewExport').disabled=true;
  const period=allHistory?'All available history':from===to?'Date: '+from:'Date range: '+from+' to '+to;
  $('absPeriod').textContent=period+' · '+(coop||'All Cooperatives')+' · No recorded attendance';
  const lastSync=window.TIPONSync?.lastSuccessfulSync?.()||'';
  $('absConnection').textContent=!navigator.onLine?'Offline — records may be incomplete':
    lastSync?'Last Sync: '+lastSync:'Sync required — records may be incomplete';
  $('absKPIs').innerHTML=[
    kpi('Missing Time In','0%','0 unverified members','red'),
    kpi('Scheduled Coverage','0%','0 of 0 enrolled members','blue'),
    kpi('Validated Manhours','0.0 h','0 completed shifts','teal'),
    kpi('Potential Overtime','0.00 h','0 member-days above 8 h','teal'),
    kpi('Late Arrivals',0,'0 scheduled late arrivals','orange'),
    kpi('No Time Out',0,'No overdue sessions','orange'),
    kpi('AWOL COUNT',0,'No attendance data for the selected filter','red')
  ].join('');
  // No activity means no inferred absence, AWOL, or roster headcount.
  $('absHeadcount').innerHTML='';$('absHours').innerHTML='';
  $('absDonutNumber').textContent='0';$('absDonut').style.background='#e6edf5';
  $('absDonut').setAttribute('aria-label','No attendance records for the selected filters');
  $('absStatusLegend').innerHTML='';
  $('absReviewCount').textContent='';
  $('absReviewRows').innerHTML='<tr><td colspan="8">No attendance records for the selected filters.</td></tr>';
  $('absReviewMore').textContent='Showing 0 review records';
  $('absReviewPrev').disabled=true;$('absReviewNext').disabled=true;
  $('absReviewPage').textContent='Page 1 of 1';
 }
 function render({from='',to='',coop='',platform='',site='',valid=true,allHistory=false,noData=false}={}){
  lastFilters={from,to,coop,platform,site,valid,allHistory,noData};
  const filterKey=[from,to,coop,platform,site,valid,allHistory,noData].join('|');
  if(filterKey!==lastFilterKey){reviewPage=1;lastFilterKey=filterKey;}
  if(!valid){invalid();return;}
  if(!state.user||!['admin','registrar'].includes(state.user.role)||!$('absPanel'))return;
  if(noData&&!(state.members||[]).some(m=>!m.deleted&&m.active!==false&&(!coop||m.coop===coop)&&(m.workSchedule?.enabled||(state.sites||[]).find(s=>s.id===m.siteId)?.schedule?.enabled))){renderEmpty({from,to,coop,allHistory});return;}
  // Hash record metadata only. Large biometric payloads are not report inputs.
  const dataKey=JSON.stringify([filterKey,Math.floor(Date.now()/60000),
   (state.members||[]).map(m=>[m.id,m.memberNumber,m.name,m.coop,m.platform,m.active,m.deleted,m.createdAt,m.siteId,m.siteIds,m.workSchedule,m.rev]),
   (state.sites||[]).map(s=>[s.id,s.schedule,s.rev]),
   (state.punches||[]).map(e=>[e.id,e.memberId,e.type,e.sessionId,e.siteId,e.coop,e.platform,e.timestamp,e.deleted,e.reviewStatus]),state.schedules]);
  if(dataKey===lastRenderDataKey&&reviewPage===lastRenderedPage){
   const sync=window.TIPONSync?.lastSuccessfulSync?.()||'';
   $('absConnection').textContent=!navigator.onLine?'Offline — records may be incomplete':sync?'Last Sync: '+sync:'Sync required — records may be incomplete';return;
  }
  const data=compute(state.members,state.sites,state.punches,state.schedules,to,coop,Date.now(),from,platform,site);
  const focus=data.focus,summary=data.summary;
  if(!focus){renderEmpty({from,to,coop,allHistory});return;}
  $('absPeriod').textContent=(allHistory?'Date range: All available history ('+data.startDay+' to '+data.endDay+')':
    from===to?'Date: '+from:'Date range: '+from+' to '+to)+' · '+(coop||'All Cooperatives');
  const overtimeSessions=projectTerminalLogEvents((state.punches||[]).filter(e=>e&&!e.deleted&&e.reviewStatus!=='rejected'));
  const overtime=potentialOvertime(overtimeSessions,{from:from||data.startDay,to:to||data.endDay,coop,platform,site},state.user);
  const lastSync=window.TIPONSync?.lastSuccessfulSync?.()||'';
  const syncVerified=!!lastSync&&navigator.onLine;
  $('absConnection').textContent=!navigator.onLine?'Offline — records may be incomplete':
   syncVerified?'Last Sync: '+lastSync:'Sync required — records may be incomplete';
  const rangeSelected=!allHistory&&from&&to&&from!==to;
  const noInValue=rangeSelected?data.noInRate:pct(focus.noIn,focus.eligible);
  const coverageValue=rangeSelected?data.coverage:pct(focus.present,focus.eligible);
  const missingNote=rangeSelected?summary.missingMemberDays+' unverified member-day(s) in period':
    focus.noIn+' unverified member(s) on '+focus.day;
  const coverageNote=rangeSelected?summary.presentMemberDays+' of '+summary.eligibleMemberDays+' eligible member-days':
    focus.present+' of '+focus.eligible+' scheduled members on '+focus.day;
  $('absKPIs').innerHTML=[
   kpi('Missing Time In',fmt(noInValue)+'%',missingNote,'red'),
   kpi('Scheduled Coverage',fmt(coverageValue)+'%',coverageNote,'blue'),
   kpi('Validated Manhours',fmt(Math.round(summary.hours*10)/10)+' h',summary.complete+' completed shifts in selected period','teal'),
   kpi('Potential Overtime',new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(overtime.minutes/60)+' h',
    overtime.memberDays+' member-day(s) above 8 h; estimate only, before break adjustments','teal'),
   kpi('Late Arrivals',summary.lateCount,summary.lateMinutes+' late minute(s), after schedule grace','orange'),
   kpi('No Time Out',summary.noTimeOut,'Missing Time Out after scheduled shift end','orange'),
   kpi('AWOL COUNT',summary.awolCount,'3+ scheduled workdays absent; provisional, review required','red')
  ].join('');
  $('absHeadcount').innerHTML=chart(data.rows.slice(-60),'head');
  $('absHours').innerHTML=chart(data.rows.slice(-60),'hours');
  const percent1=pct(focus.present,focus.eligible),percent2=pct(focus.noIn,focus.eligible);
  $('absDonut').style.background=focus.eligible?'conic-gradient(#167bda 0% '+percent1+'%,#e36d64 '+percent1+'% '+(percent1+percent2)+'%,#9bafc5 '+(percent1+percent2)+'% 100%)':'#e6edf5';
  $('absDonut').setAttribute('aria-label',focus.present+' present, '+focus.noIn+' with no Time In, '+focus.leave+' approved rest or leave');
  $('absDonutNumber').textContent=focus.eligible;
  $('absStatusLegend').innerHTML=[
   ['#167bda','With Time In',focus.present],['#e36d64','Time In Unverified',focus.noIn],['#9bafc5','Rest / Leave',focus.leave]
  ].map(([color,label,count])=>'<div class="ab-legend-row"><i style="background:'+color+'"></i><span>'+escape(label)+'</span><b>'+count+'</b></div>').join('')+
   '<p class="ab-small">'+data.unenrolled+' inactive registered member(s) excluded from scheduled attendance metrics.</p>';
  const review=reviewRecords(data,syncVerified);lastReviewRecords=review;if($('absReviewExport'))$('absReviewExport').disabled=!review.length;
  const totalPages=Math.max(1,Math.ceil(review.length/PAGE_SIZE));
  reviewPage=Math.max(1,Math.min(reviewPage,totalPages));
  const offset=(reviewPage-1)*PAGE_SIZE,visible=review.slice(offset,offset+PAGE_SIZE);
  $('absReviewCount').textContent='';
  $('absReviewRows').innerHTML=visible.length?visible.map(item=>
   '<tr><td>'+escape(item.member.memberNumber||item.member.id)+'</td><td>'+escape(item.member.name)+'</td><td>'+escape(item.member.coop)+'</td><td>'+escape(item.day)+'</td><td>'+escape(item.plan.kind==='REQUIRED'&&Number.isFinite(item.plan.start)&&Number.isFinite(item.plan.end)?TIPONCore.phStamp(new Date(item.plan.start).toISOString()).slice(-8)+' – '+TIPONCore.phStamp(new Date(item.plan.end).toISOString()).slice(-8):'—')+'</td><td>'+escape(item.timeIn?TIPONCore.phStamp(item.timeIn).slice(-8):'—')+'</td><td>'+escape(item.lateMinutes||'—')+'</td><td><span class="ab-flag">'+escape(item.flag)+'</span></td></tr>'
  ).join(''):'<tr><td colspan="8">No attendance discrepancies in the available records.</td></tr>';
  $('absReviewMore').textContent='Showing '+(review.length?offset+1:0)+'–'+Math.min(offset+PAGE_SIZE,review.length)+' of '+review.length+' review records';
  $('absReviewPrev').disabled=reviewPage<=1;$('absReviewNext').disabled=reviewPage>=totalPages;
  $('absReviewPage').textContent='Page '+reviewPage+' of '+totalPages;lastRenderDataKey=dataKey;lastRenderedPage=reviewPage;
 }
 function invalid(){
  lastRenderDataKey='';lastRenderedPage=0;lastReviewRecords=[];if($('absReviewExport'))$('absReviewExport').disabled=true;
  if($('absKPIs'))$('absKPIs').innerHTML='<p class="ab-empty">Select a valid date range before viewing attendance analytics.</p>';
  if($('absReviewRows'))$('absReviewRows').innerHTML='<tr><td colspan="8">Select a valid date range.</td></tr>';
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
 function reviewCsv(records){
  const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,v=>"'"+v).replace(/"/g,'""')+'"';
  const header=['Member ID','Member Name','Cooperative','Work Date','Scheduled Start','Scheduled End','Time In','Late Minutes','Review Flag','Verification'];
  const rows=(records||[]).map(item=>[item.member.memberNumber||item.member.id,item.member.name,item.member.coop,item.day,
   Number.isFinite(item.plan.start)?TIPONCore.phStamp(new Date(item.plan.start).toISOString()):'',
   Number.isFinite(item.plan.end)?TIPONCore.phStamp(new Date(item.plan.end).toISOString()):'',
   item.timeIn?TIPONCore.phStamp(item.timeIn):'',item.lateMinutes||'',item.flag,'Provisional - human review required']);
  return [header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
 }
 function exportReview(){
  if(!lastReviewRecords.length)return;
  const url=URL.createObjectURL(new Blob(['\ufeff'+reviewCsv(lastReviewRecords)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download='TIPON_Attendance_Review.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function bind(){
  const exportButton=$('absReviewExport');if(exportButton&&!exportButton.dataset.bound){exportButton.dataset.bound='1';exportButton.addEventListener('click',exportReview);}
  const sync=$('absSyncNow');if(sync&&!sync.dataset.bound){sync.dataset.bound='1';sync.addEventListener('click',syncNow);}
  const previous=$('absReviewPrev'),next=$('absReviewNext');
  if(previous&&!previous.dataset.bound){previous.dataset.bound='1';previous.addEventListener('click',()=>{reviewPage=Math.max(1,reviewPage-1);render(lastFilters);});}
  if(next&&!next.dataset.bound){next.dataset.bound='1';next.addEventListener('click',()=>{reviewPage++;render(lastFilters);});}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
 return {compute,reviewRecords,reviewCsv,potentialOvertime,render,invalid};
})();
