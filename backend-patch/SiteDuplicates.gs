/** Private Work Location cleanup. Retires duplicates, preserving historical events. */
function tp5SameWorkLocation_(a,b){
  var normalized=function(v){return String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();};
  return !!a&&!!b&&!a.deleted&&!b.deleted&&normalized(a.name)&&normalized(a.name)===normalized(b.name)&&
    a.coop===b.coop&&TIPONOrgCore.platformKey(a.platform)===TIPONOrgCore.platformKey(b.platform)&&
    [a.lat,a.lng,b.lat,b.lng].every(function(v){return v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v));})&&
    Number(a.radius||150)===Number(b.radius||150)&&
    TIPONOrgCore.distance(Number(a.lat),Number(a.lng),Number(b.lat),Number(b.lng))<=50;
}
function tp5AssertUniqueWorkLocation_(record){
  var normalized=function(v){return String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();};
  tp5Must_(!tp5Read_('sites').some(function(site){return !site.deleted&&String(site.id)!==String(record.id)&&
    site.coop===record.coop&&TIPONOrgCore.platformKey(site.platform)===TIPONOrgCore.platformKey(record.platform)&&
    normalized(site.name)===normalized(record.name);}),
    'This Work Location already exists for the selected Cooperative and Business Platform. Edit the existing record.','DUPLICATE');
}
function tp5MergeDuplicateWorkLocations_(actor,preview){
  tp5Admin_(actor);
  var sites=tp5Read_('sites').filter(function(s){return !s.deleted;}),members=tp5Read_('members'),
    users=tp5Read_('users'),tokens=tp5Read_('tokens');
  var sessions=TIPONOrgCore.project(tp5ApplyAttendanceCorrections_(tp5AllEvents_())),used=new Set(),groups=[];
  function ids(row){return (Array.isArray(row.siteIds)?row.siteIds:[row.siteId]).filter(Boolean).map(String);}
  function kioskReference(siteId){return users.some(function(u){return !u.deleted&&u.role==='kiosk'&&ids(u).includes(siteId);})||
    tokens.some(function(t){return !t.revoked&&ids(t).includes(siteId);});}
  function references(siteId){return members.filter(function(m){return !m.deleted&&ids(m).includes(siteId);}).length;}
  sites.sort(function(a,b){return Number(kioskReference(String(b.id)))-Number(kioskReference(String(a.id)))||references(String(b.id))-references(String(a.id))||String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id));});
  for(var i=0;i<sites.length;i++){
    var primary=sites[i];if(used.has(String(primary.id)))continue;
    var duplicates=sites.filter(function(s){return String(s.id)!==String(primary.id)&&!used.has(String(s.id))&&tp5SameWorkLocation_(primary,s);});
    if(!duplicates.length)continue;
    used.add(String(primary.id));duplicates.forEach(function(s){used.add(String(s.id));});
    groups.push({primary:primary,duplicates:duplicates});
  }
  var summary={preview:!!preview,merged:0,reassigned:0,groups:groups.length,blocked:[]},changed=false;
  try{
    groups.forEach(function(group){
      var retired=new Set(group.duplicates.map(function(s){return String(s.id);}));
      var affected=members.filter(function(m){return !m.deleted&&ids(m).some(function(id){return retired.has(id);});});
      var memberIds=new Set(affected.map(function(m){return String(m.id);}));
      if(group.duplicates.some(function(s){return kioskReference(String(s.id));})||sessions.some(function(s){return s.timeIn&&!s.timeOut&&(retired.has(String(s.siteId))||memberIds.has(String(s.memberId)));})){
        summary.blocked.push({name:group.primary.name,reason:'An active kiosk assignment or open attendance session requires review.'});return;
      }
      if(preview)return;
      affected.forEach(function(old){
        var next=Object.assign({},old,{siteId:retired.has(String(old.siteId))?group.primary.id:old.siteId,
          siteIds:Array.from(new Set(ids(old).map(function(id){return retired.has(id)?String(group.primary.id):id;}))),
          updatedAt:tp5Now_(),rev:Number(old.rev||0)+1});
        tp5Put_('members',next,old);changed=true;Object.assign(old,next);summary.reassigned++;
      });
      group.duplicates.forEach(function(old){
        tp5Put_('sites',Object.assign({},old,{deleted:true,active:false,mergedIntoSiteId:group.primary.id,
          updatedAt:tp5Now_(),rev:Number(old.rev||0)+1}),old);
        changed=true;old.deleted=true;summary.merged++;
        tp5Audit_(actor,'MERGE_DUPLICATE_SITE',old.id,'Retired duplicate into '+group.primary.id+'; historical attendance retained.');
      });
    });
  }finally{if(changed){tp5Bump_();tp5RefreshMemberDirectory_();SpreadsheetApp.flush();}}
  return summary;
}
/** Owner-only editor entry point; no web route or new access permission. */
function previewTIPONDuplicateWorkLocations(){
  var result=tp5MergeDuplicateWorkLocations_({id:'project-owner',role:'admin'},true);console.log(JSON.stringify(result));return result;
}
function mergeTIPONDuplicateWorkLocations(){
  return tp5Lock_(function(){var result=tp5MergeDuplicateWorkLocations_({id:'project-owner',role:'admin'},false);console.log(JSON.stringify(result));return result;});
}
/** Resolve a retired duplicate for already queued offline attendance only.
 * Keep the original site ID and geofence in the immutable ledger/digest.
 */
function tp5AttendanceSite_(sites,id){
  var original=(sites||[]).find(function(s){return String(s.id)===String(id);});
  if(!original)return null;if(!original.deleted)return original;
  if(!original.mergedIntoSiteId)return null;
  var primary=sites.find(function(s){return !s.deleted&&String(s.id)===String(original.mergedIntoSiteId);});
  var alias=Object.assign({},original,{deleted:false});
  if(!primary||!tp5SameWorkLocation_(alias,primary))return null;
  alias._canonicalSiteId=primary.id;return alias;
}
