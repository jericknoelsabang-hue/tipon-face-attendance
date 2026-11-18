/** TIPON KABILANG — Paygroup and Operation Code directory backend.
 * Add to the existing private Apps Script project. Never deploy as a new web app.
 * Add the route snippets in README_PAYGROUP.md after the existing tp5Auth_ call.
 */
function tp5PGKey_(v){return String(v||'').replace(/\s+/g,' ').trim().toLowerCase();}
function tp5PGRead_(){
  var raw=tp5Props_().getProperty('TP5_PAYGROUP_DIRECTORY')||'[]',rows;
  try{rows=JSON.parse(raw);}catch(e){tp5Fail_('Paygroup directory needs administrator review.','SCHEMA');}
  tp5Must_(Array.isArray(rows),'Invalid Paygroup directory.','SCHEMA');
  return rows.filter(function(x){return x&&typeof x==='object'&&!x.deleted;});
}
function tp5PGWrite_(rows){
  var json=JSON.stringify(rows);
  tp5Must_(Utilities.newBlob(json).getBytes().length<=8500,'Paygroup directory limit reached.','LIMIT');
  tp5Props_().setProperty('TP5_PAYGROUP_DIRECTORY',json);
}
function tp5PGValidate_(q){
  var p=q.paygroup||{},id=TIPONOrgCore.clean(p.id,120),coop=TIPONOrgCore.clean(p.coop,80),
    platform=tp5ResolvePlatform_(p.platform),name=TIPONOrgCore.clean(p.name,80);
  tp5Must_(id&&TIPONOrgCore.COOPS.includes(coop)&&name.length>=2,'Paygroup ID, Cooperative and name are required.','VALIDATION');
  tp5Must_((TIPONOrgCore.COOP_PLATFORMS[coop]||[]).some(function(x){return tp5PGKey_(x)===tp5PGKey_(platform);})||
    (typeof tp5BPAllowedCoop_==='function'&&tp5BPAllowedCoop_(coop,platform)),
    'Business Platform is not assigned to the selected Cooperative.','VALIDATION');
  var codes=Array.isArray(p.operationCodes)?p.operationCodes.map(function(x){return TIPONOrgCore.clean(x,60);}):[],seen={};
  tp5Must_(codes.length<=30&&codes.every(function(x){var k=tp5PGKey_(x);if(!k||seen[k])return false;seen[k]=true;return true;}),
    'Operation Codes must be unique, non-empty values (maximum 30).','VALIDATION');
  return {id:id,coop:coop,platform:platform,name:name,operationCodes:codes,updatedAt:tp5Now_(),rev:Number(p.rev)||0};
}
function tp5PGCatalog_(actor){
  var sites=tp5Read_('sites').filter(function(s){return !s.deleted;});
  var rows=tp5PGRead_().map(function(pg){var copy=Object.assign({},pg);copy.siteIds=sites.filter(function(site){
    return (site.paygroupIds||[]).map(String).indexOf(String(pg.id))>=0;
  }).map(function(site){return site.id;});return copy;});
  return rows.filter(function(pg){return actor.role==='admin'||
    (actor.role==='registrar'&&actor.coop===pg.coop&&tp5PGKey_(actor.platform)===tp5PGKey_(pg.platform))||
    (actor.role==='kiosk'&&(actor.siteIds||[]).some(function(id){return pg.siteIds.indexOf(String(id))>=0;}));});
}
function tp5PGList_(actor){return tp5Reply_({paygroups:tp5PGCatalog_(actor),paygroupDirectorySupported:true});}
function tp5SamePaygroupIds_(a,b){
  a=Array.isArray(a)?a.map(String).sort():[];b=Array.isArray(b)?b.map(String).sort():[];
  return a.length===b.length&&a.every(function(id,i){return id===b[i];});
}
function tp5PaygroupIds_(value,scope){
  var ids=Array.isArray(value)?value:[],coop=scope&&scope.coop,platform=scope&&scope.platform,siteIds=scope&&scope.siteIds||[];
  tp5Must_(ids.length<=40,'Maximum 40 assigned Paygroups.','VALIDATION');
  var available={},groups=tp5PGRead_().filter(function(pg){return pg.coop===coop&&tp5PGKey_(pg.platform)===tp5PGKey_(platform);});
  groups.forEach(function(pg){available[String(pg.id)]=true;});
  var unique=[],seen={};
  ids.forEach(function(value){var id=TIPONOrgCore.clean(value,120);tp5Must_(id&&!seen[id],'Paygroup assignments must be unique.','VALIDATION');seen[id]=true;tp5Must_(available[id],'Paygroup must match the member Cooperative and Business Platform.','DEPENDENCY');unique.push(id);});
  if(unique.length){
    var assigned={},allowUnassigned=scope&&scope.allowUnassigned===true;
    var sites=tp5Read_('sites').filter(function(site){
      if(site.deleted)return false;
      if(siteIds.length)return siteIds.map(String).indexOf(String(site.id))>=0;
      return allowUnassigned&&site.coop===coop&&tp5PGKey_(site.platform)===tp5PGKey_(platform);
    });
    sites.forEach(function(site){(site.paygroupIds||[]).forEach(function(id){assigned[String(id)]=true;});});
    unique.forEach(function(id){tp5Must_(assigned[id]===true,'Paygroup must be assigned to at least one matching Work Location.','DEPENDENCY');});
  }
  return unique;
}
function tp5SitePaygroupIds_(value,scope){
  var ids=Array.isArray(value)?value:[],coop=scope&&scope.coop,platform=scope&&scope.platform,available={},seen={};
  tp5Must_(ids.length<=40,'Maximum 40 Paygroups per Work Location.','VALIDATION');
  tp5PGRead_().filter(function(pg){return pg.coop===coop&&tp5PGKey_(pg.platform)===tp5PGKey_(platform);}).forEach(function(pg){available[String(pg.id)]=true;});
  return ids.map(function(value){var id=TIPONOrgCore.clean(value,120);tp5Must_(id&&!seen[id]&&available[id],'Choose only Paygroups matching this Work Location Cooperative and Business Platform.','DEPENDENCY');seen[id]=true;return id;});
}
function tp5ValidateTimeInPaygroup_(member,site,event){
  var id=TIPONOrgCore.clean(event.paygroupId,120),code=TIPONOrgCore.clean(event.operationCode,60),pg=null;
  if(!id){tp5Must_(!(member.paygroupIds||[]).length,'Select an assigned Paygroup before Time In.','VALIDATION');tp5Must_(!code,'An Operation Code requires a Paygroup.','VALIDATION');return {paygroupId:'',paygroup:'',operationCode:''};}
  pg=tp5PGRead_().filter(function(x){return String(x.id)===id;})[0];
  tp5Must_(!!pg&&member.coop===pg.coop&&tp5PGKey_(member.platform)===tp5PGKey_(pg.platform),'Paygroup is outside the member Cooperative / Business Platform.','FORBIDDEN');
  tp5Must_((member.paygroupIds||[]).map(String).indexOf(id)>=0&&(site.paygroupIds||[]).map(String).indexOf(id)>=0,
    'Paygroup is not assigned to this member and Work Location.','DEPENDENCY');
  var codes=pg.operationCodes||[];
  if(codes.length)tp5Must_(codes.map(tp5PGKey_).indexOf(tp5PGKey_(code))>=0,'Select a valid Operation Code for this Paygroup.','VALIDATION');
  else tp5Must_(!code,'This Paygroup does not use an Operation Code.','VALIDATION');
  return {paygroupId:id,paygroup:pg.name,operationCode:code};
}
function tp5InheritTimeOutPaygroup_(event,pendingEvents){
  tp5Must_(event&&event.type==='OUT'&&event.memberId,'A valid Time Out event is required.','VALIDATION');
  var allEvents=tp5AllEvents_().concat(Array.isArray(pendingEvents)?pendingEvents:[]);
  var rows=allEvents.filter(function(row){
    return row&&row.type==='IN'&&String(row.memberId)===String(event.memberId);
  });
  var source=null,sessionId=String(event.sessionId||'');
  if(sessionId){
    source=rows.filter(function(row){
      return String(row.sessionId||row.id)===sessionId||String(row.id)===sessionId;
    })[0]||null;
  }
  if(!source){
    // Cross-device Time Out may arrive without a local sessionId. Resolve only
    // when the server can identify exactly one still-open Time In for the member.
    var open=rows.filter(function(candidate){
      var key=String(candidate.sessionId||candidate.id);
      return !allEvents.some(function(row){
        return row&&row.type==='OUT'&&String(row.memberId)===String(event.memberId)&&
          String(row.sessionId||row.id)===key;
      });
    }).sort(function(a,b){return Date.parse(b.timestamp)-Date.parse(a.timestamp);});
    tp5Must_(open.length===1,'The original Time In session could not be uniquely identified. Refresh attendance and retry Time Out.','SESSION');
    source=open[0];
    event.sessionId=String(source.sessionId||source.id);
  }
  tp5Must_(!!source,'Original Time In session is unavailable. Cannot validate Time Out Paygroup.','SESSION');
  event.paygroupId=source.paygroupId||'';
  event.paygroup=source.paygroup||'';
  event.operationCode=source.operationCode||'';
  return event;
}
function tp5ApplyAttendancePaygroup_(event,member,site,pendingEvents){
  tp5Must_(event&&member,'Attendance event and verified member are required.','VALIDATION');
  if(event.type==='IN'){
    var selected=tp5ValidateTimeInPaygroup_(member,site,event);
    event.paygroupId=selected.paygroupId;
    event.paygroup=selected.paygroup;
    event.operationCode=selected.operationCode;
  }else if(event.type==='OUT'){
    tp5InheritTimeOutPaygroup_(event,pendingEvents);
  }else{
    tp5Must_(false,'Attendance type must be IN or OUT.','VALIDATION');
  }
  return event;
}

function tp5PGAdd_(actor,q){
  tp5Admin_(actor);var p=tp5PGValidate_(q);
  var rows=tp5PGRead_();
  tp5Must_(!rows.some(function(x){return tp5PGKey_(x.id)===tp5PGKey_(p.id)||
    (x.coop===p.coop&&tp5PGKey_(x.platform)===tp5PGKey_(p.platform)&&tp5PGKey_(x.name)===tp5PGKey_(p.name));}),
    'Paygroup ID or name already exists in this Cooperative / Business Platform.','CONFLICT');
  rows.push(p);tp5PGWrite_(rows);tp5Bump_();tp5Audit_(actor,'PAYGROUP_ADD',p.id,'Paygroup created.');return tp5PGList_(actor);
}
function tp5PGUpdate_(actor,q){
  tp5Admin_(actor);var p=tp5PGValidate_(q),rows=tp5PGRead_(),old=rows.find(function(x){return String(x.id)===p.id;});
  tp5Must_(!!old,'Paygroup not found. Refresh and retry.','NOT_FOUND');
  tp5Must_(old.coop===p.coop&&tp5PGKey_(old.platform)===tp5PGKey_(p.platform),
    'Cooperative and Business Platform cannot be changed after assignments exist.','CONFLICT');
  tp5Must_(!rows.some(function(x){return String(x.id)!==p.id&&x.coop===p.coop&&tp5PGKey_(x.platform)===tp5PGKey_(p.platform)&&tp5PGKey_(x.name)===tp5PGKey_(p.name);}),
    'Another Paygroup already uses this name in the selected Cooperative / Business Platform.','CONFLICT');
  p.rev=Number(old.rev||0)+1;
  rows=rows.map(function(x){return String(x.id)===p.id?p:x;});
  tp5PGWrite_(rows);tp5Bump_();tp5Audit_(actor,'PAYGROUP_UPDATE',p.id,'Paygroup and operation codes updated.');return tp5PGList_(actor);
}
function tp5PGDelete_(actor,q){
  tp5Admin_(actor);var id=TIPONOrgCore.clean(q.id,120),rows=tp5PGRead_(),old=rows.find(function(x){return String(x.id)===id;});
  tp5Must_(!!old,'Paygroup not found.','NOT_FOUND');
  var used=['sites','members'].some(function(table){return tp5Read_(table).some(function(row){
    return !row.deleted&&(row.paygroupIds||[]).map(String).indexOf(id)>=0;
  });});
  tp5Must_(!used,'Reassign Work Locations and members before deleting this Paygroup.','DEPENDENCY');
  tp5PGWrite_(rows.filter(function(x){return String(x.id)!==id;}));tp5Bump_();
  tp5Audit_(actor,'PAYGROUP_DELETE',id,'Unused Paygroup deleted.');return tp5PGList_(actor);
}
