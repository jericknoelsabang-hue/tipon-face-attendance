/* TIPON role and directory rules - shared, deterministic rules. No network or secrets. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TIPONOrgCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const VERSION='5.2.0', PROTOCOL='tipon-org-v5', PBKDF2_ITERATIONS=600000;
  const COOPS=['Asiapro','Gawa at Kalinga','Kaakbay sa Kinabukasan','Kadayawan','Kaamulan','Tnalak','Victory','Worklife'];
  const DEFAULT_PLATFORMS=['IMG','MSG-SM','MSG-NM','MSG-NW','OCG','Contracting','AP Cons'];
  const EXPORT_HEADERS=['MemberId','Date','Time In','Time Out','Date Time Out'];
  // The payroll extract stays at five columns. Only the central report adds context.
  const REPORT_HEADERS=[...EXPORT_HEADERS,'Office','MPC','BP'];
  const clean=(v,n=160)=>String(v==null?'':v).trim().slice(0,n);
  const userKey=v=>clean(v,80).normalize('NFKC').toLowerCase();
  function must(ok,message,code='VALIDATION'){if(!ok){const e=new Error(message);e.code=code;throw e;}}
  function profile(p){
    must(p&&typeof p==='object','Profile is required.');
    const v={username:clean(p.username,80),name:clean(p.name,120),position:clean(p.position,100),email:clean(p.email,200),coop:clean(p.coop,80),platform:clean(p.platform,100),office:clean(p.office,120),accountType:clean(p.accountType||'user',20),officeLat:Number(p.officeLat),officeLng:Number(p.officeLng)};
    must(v.username.length>=3&&!/[\x00-\x1f\x7f]/.test(v.username),'Username needs at least 3 readable characters.');
    must(v.name&&v.position&&v.office&&v.platform,'Complete full name, position, business platform and office.');
    must(['user','kiosk'].includes(v.accountType),'Choose User or Physical Kiosk.');
    must(Number.isFinite(v.officeLat)&&Math.abs(v.officeLat)<=90&&Number.isFinite(v.officeLng)&&Math.abs(v.officeLng)<=180,'Capture valid office latitude and longitude.');
    must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email),'Enter a valid email address.');
    must(COOPS.includes(v.coop),'Choose a listed cooperative.');return v;
  }
  function canUseTerminal(u){return !!u&&['registrar','kiosk'].includes(u.role)&&(!u.status||u.status==='active');}
  function allowed(u,page){
    if(!u)return false;
    if(page==='scanner')return canUseTerminal(u);
    const pages={admin:['dashboard','records','accounts','reports','settings'],registrar:['scanner','members','sites','settings'],kiosk:['scanner']};
    return (pages[u.role]||[]).includes(page);
  }
  function platformKey(v){return clean(v,100).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();}
  function platformNames(values){const seen=new Map();for(const v of values||[]){const name=clean(v,100).replace(/\s+/g,' '),key=platformKey(name);if(key&&!seen.has(key))seen.set(key,name);}return [...seen.values()].sort((a,b)=>a.localeCompare(b));}
  // Calendar-day overview is intentionally separate from schedule-based absence.
  // One member with repeated IN punches counts once as Present; IN+OUT = 2 entries.
  function overview(members,events,day,coops=COOPS,options={}){
    const memberMap=new Map((members||[]).map(m=>[String(m.id),m]));
    const siteMap=new Map((options.sites||[]).map(s=>[String(s.id),s]));
    const coopFilter=clean(options.coop,80),bpFilter=platformKey(options.platform);
    const catalog=platformNames([...(options.platforms||[]),...(members||[]).map(m=>m.platform),...(events||[]).map(e=>e.platform),...(options.sites||[]).map(s=>s.platform)]);
    const canonical=new Map(catalog.map(p=>[platformKey(p),p]));
    const names=r=>{const member=memberMap.get(String(r.memberId||r.id))||{},site=siteMap.get(String(r.siteId||member.siteId))||{};
      const bp=clean(r.platform||site.platform||member.platform,100);
      return {coop:clean(r.coop||site.coop||member.coop,80)||'Unassigned',platform:canonical.get(platformKey(bp))||bp||'Unassigned'};};
    const empty=()=>({members:0,present:0,entries:0,pending:0,_members:new Set(),_present:new Set()});
    const overall=empty(),filtered=empty(),groups=new Map(),bps=new Map();
    const group=coop=>{if(!groups.has(coop))groups.set(coop,{coop,...empty()});return groups.get(coop);};
    const business=platform=>{const key=platformKey(platform);if(!bps.has(key))bps.set(key,{platform,...empty()});return bps.get(key);};
    const matches=n=>(!coopFilter||n.coop===coopFilter)&&(!bpFilter||platformKey(n.platform)===bpFilter);
    coops.filter(c=>!coopFilter||c===coopFilter).forEach(group);
    catalog.filter(p=>!bpFilter||platformKey(p)===bpFilter).forEach(business);
    for(const m of members||[]){
      if(!m||!m.id||m.active===false||m.deleted)continue;
      const n=names(m),id=String(m.id);overall._members.add(id);
      if(matches(n)){filtered._members.add(id);group(n.coop)._members.add(id);business(n.platform)._members.add(id);}
    }
    const seen=new Set(),count=(g,e)=>{g.entries++;if(!e.cloudAck)g.pending++;if(e.type==='IN')g._present.add(String(e.memberId));};
    for(const e of events||[]){
      if(!e||!e.id||!e.memberId||seen.has(e.id)||e.reviewStatus||!['IN','OUT'].includes(e.type)||!Number.isFinite(Date.parse(e.timestamp)))continue;
      seen.add(e.id);if(phDay(e.timestamp)!==day)continue;
      const n=names(e);count(overall,e);
      if(matches(n)){count(filtered,e);count(group(n.coop),e);count(business(n.platform),e);}
    }
    const finish=g=>{const {_members,_present,...rest}=g;return {...rest,members:_members.size,present:_present.size};};
    return {day,overall:finish(overall),filtered:finish(filtered),groups:[...groups.values()].map(finish),bpGroups:[...bps.values()].map(finish).sort((a,b)=>a.platform.localeCompare(b.platform))};
  }
  function inScope(u,r){if(u.role==='admin')return true;if(u.role==='kiosk'){const ids=u.siteIds||[];if(ids.length)return ids.includes(r.siteId||r.id);const office=clean(r.satelliteOffice||r.office,120);return r.coop===u.coop&&(!u.platform||platformKey(r.platform)===platformKey(u.platform))&&(!u.office||office===u.office);}return r.coop===u.coop&&(!u.platform||platformKey(r.platform)===platformKey(u.platform));}
  function distance(a,b,c,d){const rad=Math.PI/180,h=Math.sin((c-a)*rad/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));}
  function gps(site,event){
    const {lat,lng,accuracy}=event;
    must(Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180,'Invalid GPS coordinates.','GPS');
    must(Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=Math.min(80,Math.max(30,site.radius)),'GPS fix is too inaccurate.','GPS');
    const meters=distance(site.lat,site.lng,lat,lng);
    must(meters<=site.radius,'Outside the approved worksite radius.','GEOFENCE');return meters;
  }
  function phDay(value){return new Date(Date.parse(value)+28800000).toISOString().slice(0,10);}
  function stamp(day,time){return Date.parse(day+'T'+time+':00+08:00');}
  function project(events){
    const m=new Map(),seen=new Set();
    [...events].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||String(a.id).localeCompare(String(b.id))).forEach(e=>{
      if(seen.has(e.id)||e.reviewStatus==='rejected')return;seen.add(e.id);
      const key=e.sessionId||e.id;const r=m.get(key)||{key,memberId:String(e.memberId),memberName:e.memberName||'',coop:e.coop||'',platform:e.platform||'',officeId:e.officeId||'',siteId:e.siteId||'',location:e.siteName||e.location||'',satelliteOffice:e.satelliteOffice||'',timeIn:'',timeOut:'',eventIds:[]};
      must(r.memberId===String(e.memberId),'Session contains conflicting member IDs.','SESSION');
      const col=e.type==='IN'?'timeIn':'timeOut';must(!r[col],'Duplicate direction within a session.','SESSION');r[col]=e.timestamp;r.eventIds.push(e.id);m.set(key,r);
    });
    return [...m.values()].sort((a,b)=>Date.parse(a.timeIn||a.timeOut)-Date.parse(b.timeIn||b.timeOut));
  }
  function scheduled(member,site,day,overrides){
    const over=(overrides||[]).find(x=>x.memberId===member.id&&x.date===day&&!x.deleted);
    if(over&&['REST','LEAVE','EXCUSED'].includes(over.status))return {kind:over.status};
    const plan=over?.status==='REQUIRED'?over:site?.schedule;
    if(!plan||!plan.enabled&&over?.status!=='REQUIRED')return {kind:'UNSCHEDULED'};
    const weekday=new Date(day+'T00:00:00Z').getUTCDay();
    if(!over&&!(plan.days||[]).includes(weekday))return {kind:'REST'};
    if(!/^\d\d:\d\d$/.test(plan.start||'')||!/^\d\d:\d\d$/.test(plan.end||''))return {kind:'UNSCHEDULED'};
    const start=stamp(day,plan.start);let end=stamp(day,plan.end);if(end<=start)end+=86400000;
    return {kind:'REQUIRED',start,end,deadline:start+Math.max(0,Number(plan.grace)||0)*60000};
  }
  function dashboard(members,sites,events,day,overrides=[],now=Date.now()){
    const rows=project(events),bySite=new Map(sites.map(x=>[x.id,x])),groups=new Map(),details=[];
    for(const member of members.filter(m=>m.active!==false&&!m.deleted)){
      const site=bySite.get(member.siteId),plan=scheduled(member,site,day,overrides);
      const shifts=rows.filter(r=>r.memberId===member.id&&r.timeIn&&(plan.kind==='REQUIRED'?(Date.parse(r.timeIn)>=plan.start-14400000&&Date.parse(r.timeIn)<=plan.end):phDay(r.timeIn)===day));
      const present=shifts.length>0, first=present?Math.min(...shifts.map(r=>Date.parse(r.timeIn))):null;
      let status=present?'PRESENT':plan.kind;
      if(!present&&plan.kind==='REQUIRED')status=now<plan.start?'UPCOMING':now<=plan.deadline?'EXPECTED':now<plan.end?'NO TIME IN':'ABSENT (PROVISIONAL)';
      const late=present&&plan.kind==='REQUIRED'&&first>plan.deadline;
      const clockedIn=rows.some(r=>r.memberId===member.id&&r.timeIn&&!r.timeOut);
      const d={memberId:member.id,name:member.name,coop:member.coop,platform:site?.platform||member.platform||'',office:site?.satelliteOffice||'',site:site?.name||'',status,late,clockedIn,firstIn:first?new Date(first).toISOString():''};details.push(d);
      const key=member.coop||'Unassigned';const g=groups.get(key)||{coop:key,enrolled:0,scheduled:0,present:0,late:0,clockedIn:0,missing:0,absent:0,leave:0,rest:0,unscheduled:0};
      g.enrolled++;if(plan.kind==='REQUIRED')g.scheduled++;if(present)g.present++;if(late)g.late++;if(clockedIn)g.clockedIn++;if(status==='NO TIME IN')g.missing++;if(status==='ABSENT (PROVISIONAL)')g.absent++;if(['LEAVE','EXCUSED'].includes(status))g.leave++;if(status==='REST')g.rest++;if(status==='UNSCHEDULED')g.unscheduled++;groups.set(key,g);
    }
    return {groups:[...groups.values()].sort((a,b)=>a.coop.localeCompare(b.coop)),details,rows};
  }
  function periodSummary(rows){const m=new Map();for(const r of rows){const k=r.memberId,s=m.get(k)||{memberId:k,name:r.memberName||'',coop:r.coop||'',sessions:0,complete:0,hours:0,open:0};s.sessions++;if(r.timeIn&&r.timeOut){s.complete++;s.hours+=(Date.parse(r.timeOut)-Date.parse(r.timeIn))/3600000;}else s.open++;m.set(k,s);}return [...m.values()];}
  function sheetRow(r){const f=t=>{if(!t)return null;const ms=Date.parse(t)+28800000,d=new Date(ms);return {date:Math.floor(ms/86400000)+25569,time:(d.getUTCHours()*3600+d.getUTCMinutes()*60+d.getUTCSeconds())/86400};};const a=f(r.timeIn),b=f(r.timeOut);return [String(r.memberId),a?a.date:'',a?a.time:'',b?b.time:'',b?b.date:''];}
  function reportRow(row){return [...sheetRow(row),String(row.satelliteOffice||''),String(row.coop||''),String(row.platform||'')];}
  return {VERSION,PROTOCOL,PBKDF2_ITERATIONS,COOPS,DEFAULT_PLATFORMS,EXPORT_HEADERS,REPORT_HEADERS,clean,userKey,must,profile,allowed,canUseTerminal,inScope,platformKey,platformNames,overview,distance,gps,phDay,project,scheduled,dashboard,periodSummary,sheetRow,reportRow};
});
