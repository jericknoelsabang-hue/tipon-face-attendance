/**
 * TIPON KABILANG — BP Directory backend extension (Apps Script).
 *
 * Install this file as BPDirectory.gs in the EXISTING private Google Apps Script
 * project attached to TIPON Organization Attendance. Do NOT deploy it on
 * GitHub Pages. The calling Code.gs must explicitly route the actions (see
 * backend-patch/README_BP_DIRECTORY.md).
 *
 * Uses existing tp5* helpers and Administrator tokens. No credentials or
 * secrets in this file. Existing MPC, BP, member and attendance data is retained.
 */
function tp5BPKey_(s){
  return TIPONOrgCore.platformKey(String(s||'').normalize('NFKC').trim().replace(/\s+/g,' '));
}
function tp5BPClean_(value,limit,label){
  var s=String(value==null?'':value).normalize('NFKC').trim().replace(/\s+/g,' ');
  tp5Must_(s.length>=2&&s.length<=limit&&!/[\x00-\x1f\x7f<>]/.test(s),
    label+' must contain 2–'+limit+' characters without control characters.','VALIDATION');
  return s;
}
function tp5BPRead_(){
  var s=tp5Props_().getProperty('TP5_PLATFORM_RECORDS')||'[]',data;
  try{data=JSON.parse(s);}catch(e){tp5Fail_('BP abbreviation directory requires administrator review.','SCHEMA');}
  tp5Must_(Array.isArray(data),'Invalid BP abbreviation directory.','SCHEMA');
  return data.filter(function(r){return r&&typeof r.name==='string'&&typeof r.abbreviation==='string';})
    .map(function(r){return {name:r.name,abbreviation:r.abbreviation};});
}
function tp5BPDetails_(){
  var map={};tp5BPRead_().forEach(function(r){map[tp5BPKey_(r.name)]=r.abbreviation;});
  return tp5PlatformNames_().map(function(name){return {name:name,abbreviation:map[tp5BPKey_(name)]||''};});
}
function tp5BPWrite_(items){
  var json=JSON.stringify(items);
  tp5Must_(items.length<=100&&Utilities.newBlob(json).getBytes().length<=8500,
    'BP directory limit reached; contact system administrator.','LIMIT');
  tp5Props_().setProperty('TP5_PLATFORM_RECORDS',json);
}
function tp5BPAbbreviation_(value){
  if(value===undefined||value===null||String(value).trim()==='')return '';
  return tp5BPClean_(value,20,'BP Abbreviation');
}
function tp5BPAssertUnique_(items,name,abbreviation){
  if(!abbreviation)return;
  var key=tp5BPKey_(abbreviation),current=tp5BPKey_(name);
  tp5Must_(!items.some(function(r){
    return tp5BPKey_(r.name)!==current&&tp5BPKey_(r.abbreviation)===key;
  }),'Another Business Platform already uses this abbreviation.','CONFLICT');
}
function tp5BPReferences_(name){
  var key=tp5BPKey_(name),same=function(r){
    return r&&!r.deleted&&tp5BPKey_(r.platform||r.businessPlatform||r.bp)===key;
  };
  return ['sites','members','users'].some(function(table){
    return tp5Read_(table).some(same);
  });
}
function tp5BPDefault_(name){
  var key=tp5BPKey_(name);
  return TIPONOrgCore.DEFAULT_PLATFORMS.some(function(p){return tp5BPKey_(p)===key;});
}
function tp5BPCanonical_(name){
  var key=tp5BPKey_(name);
  return tp5PlatformNames_().find(function(p){return tp5BPKey_(p)===key;})||'';
}
function tp5BPResult_(extra){
  return tp5Reply_(Object.assign({
    businessPlatforms:tp5PlatformNames_(),
    businessPlatformRecords:tp5BPDetails_()
  },extra||{}));
}
function tp5BPAdd_(actor,q){
  tp5Admin_(actor);
  var name=tp5BPClean_(q.name,80,'BP Name');
  var abbreviation=tp5BPAbbreviation_(q.abbreviation);
  var records=tp5BPRead_();
  tp5BPAssertUnique_(records,name,abbreviation);
  var existed=!!tp5BPCanonical_(name);
  // Reuse the original validated name-add handler. It retains legacy clients.
  if(!existed)tp5AddPlatform_(actor,{name:name});
  var canonical=tp5BPCanonical_(name),key=tp5BPKey_(canonical);
  tp5Must_(!!canonical,'The central BP Name was not added.','SERVER');
  if(abbreviation){
    var current=records.find(function(r){return tp5BPKey_(r.name)===key;});
    if(!current||current.abbreviation!==abbreviation){
      records=records.filter(function(r){return tp5BPKey_(r.name)!==key;});
      records.push({name:canonical,abbreviation:abbreviation});
      tp5BPWrite_(records);
      tp5Bump_();tp5Audit_(actor,'BP_ABBREVIATION',canonical,'Admin registered the BP abbreviation.');
    }
  }
  return tp5BPResult_({platformName:canonical,created:!existed});
}
function tp5BPUpdate_(actor,q){
  tp5Admin_(actor);
  var original=tp5BPCanonical_(q.originalName);
  tp5Must_(!!original,'Original Business Platform was not found.','NOT_FOUND');
  var name=tp5BPClean_(q.name,80,'BP Name'),abbr=tp5BPClean_(q.abbreviation,20,'BP Abbreviation');
  var originalKey=tp5BPKey_(original),updatedKey=tp5BPKey_(name);
  var collision=tp5PlatformNames_().some(function(p){
    return tp5BPKey_(p)===updatedKey&&tp5BPKey_(p)!==originalKey;
  });
  tp5Must_(!collision,'Another Business Platform already has this name.','CONFLICT');
  var rename=updatedKey!==originalKey;
  if(rename){
    tp5Must_(!tp5BPDefault_(original),'A default platform cannot be renamed.','FORBIDDEN');
    tp5Must_(!tp5BPReferences_(original),'Reassign members, locations and accounts before renaming this BP.','CONFLICT');
  }
  var records=tp5BPRead_();
  tp5BPAssertUnique_(records,name,abbr);
  if(rename){
    var props=tp5Props_(),stored;
    try{stored=JSON.parse(props.getProperty('TP5_PLATFORM_NAMES')||'[]');}
    catch(e){tp5Fail_('Central BP label directory needs review.','SCHEMA');}
    tp5Must_(Array.isArray(stored)&&stored.some(function(p){return tp5BPKey_(p)===originalKey;}),
      'Only custom Business Platforms can be renamed.','FORBIDDEN');
    stored=TIPONOrgCore.platformNames(stored.map(function(p){return tp5BPKey_(p)===originalKey?name:p;}));
    var json=JSON.stringify(stored);
    tp5Must_(Utilities.newBlob(json).getBytes().length<=8500,'BP directory limit reached.','LIMIT');
    props.setProperty('TP5_PLATFORM_NAMES',json);TP5_PLATFORM_CACHE_=null;
  }
  records=records.filter(function(r){return tp5BPKey_(r.name)!==originalKey;});
  records.push({name:name,abbreviation:abbr});
  tp5BPWrite_(records);tp5Bump_();
  tp5Audit_(actor,'UPDATE_PLATFORM',original,'Updated to '+name+' / '+abbr+'. Existing approved access is not widened.');
  return tp5BPResult_({platformName:name,updated:true});
}
function tp5BPDelete_(actor,q){
  tp5Admin_(actor);
  var name=tp5BPCanonical_(q.name);
  tp5Must_(!!name,'Business Platform not found.','NOT_FOUND');
  tp5Must_(!tp5BPDefault_(name),'Default Business Platforms cannot be deleted.','FORBIDDEN');
  tp5Must_(!tp5BPReferences_(name),'This BP is used by active members, accounts or Work Locations. Reassign them first.','CONFLICT');
  var key=tp5BPKey_(name),props=tp5Props_(),stored;
  try{stored=JSON.parse(props.getProperty('TP5_PLATFORM_NAMES')||'[]');}
  catch(e){tp5Fail_('BP label directory needs review.','SCHEMA');}
  tp5Must_(Array.isArray(stored)&&stored.some(function(p){return tp5BPKey_(p)===key;}),
    'Only custom Business Platforms can be deleted.','FORBIDDEN');
  stored=stored.filter(function(p){return tp5BPKey_(p)!==key;});
  props.setProperty('TP5_PLATFORM_NAMES',JSON.stringify(stored));TP5_PLATFORM_CACHE_=null;
  tp5BPWrite_(tp5BPRead_().filter(function(r){return tp5BPKey_(r.name)!==key;}));
  tp5Bump_();tp5Audit_(actor,'DELETE_PLATFORM',name,'Removed unassigned custom Business Platform.');
  return tp5BPResult_({deleted:true,platformName:name});
}
