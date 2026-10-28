/**
 * TIPON KABILANG — BP Directory backend extension v5.5.19
 *
 * Private deployment only: add as BPDirectory.gs to the existing Google
 * Apps Script attendance project and integrate the action routes documented
 * in backend-patch/README_BP_DIRECTORY.md. Contains no credentials or keys.
 *
 * The existing platform string remains the identifier / Business Platform
 * CODE (e.g., "AP Cons"). Its descriptive full name is metadata only.
 * This preserves old attendance, work locations, account scope, and exports.
 */
var TP5_BP_STARTER_DIRECTORY_=[
  {name:'Asiapro Construction',abbreviation:'AP Cons'},
  {name:'Asiapro Trucking System',abbreviation:'ATS'},
  {name:'Asiapro Contracting',abbreviation:'Contracting'},
  {name:'Gawa At Kalinga',abbreviation:'GAK'},
  {name:'Independent Manufactoring Group',abbreviation:'IMG'},
  {name:'Managed Services Group - North Mindanao',abbreviation:'MSG-NM'},
  {name:'Managed Services Group - Nation Wide',abbreviation:'MSG-NW'},
  {name:'Managed Services Group - South Mindanao',abbreviation:'MSG-SM'},
  {name:'Other Construction Group',abbreviation:'OCG'}
];
function tp5BPKey_(value){
  return TIPONOrgCore.platformKey(String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim());
}
function tp5BPClean_(value,max,label){
  var text=String(value==null?'':value).normalize('NFKC').replace(/\s+/g,' ').trim();
  tp5Must_(text.length>=2&&text.length<=max&&!/[\x00-\x1f\x7f<>]/.test(text),
    label+' must have 2–'+max+' safe characters.','VALIDATION');
  return text;
}
function tp5BPDefault_(code){
  return TIPONOrgCore.DEFAULT_PLATFORMS.some(function(x){return tp5BPKey_(x)===tp5BPKey_(code);});
}
function tp5BPCanonical_(code){
  var key=tp5BPKey_(code);
  return tp5PlatformNames_().find(function(x){return tp5BPKey_(x)===key;})||'';
}
function tp5BPSeedName_(code){
  var key=tp5BPKey_(code);
  var row=TP5_BP_STARTER_DIRECTORY_.find(function(x){return tp5BPKey_(x.abbreviation)===key;});
  return row?row.name:'';
}
function tp5BPRead_(){
  var rows;
  try{rows=JSON.parse(tp5Props_().getProperty('TP5_PLATFORM_RECORDS')||'[]');}
  catch(error){tp5Fail_('The Business Platform directory requires administrator review.','SCHEMA');}
  tp5Must_(Array.isArray(rows),'Invalid Business Platform directory.','SCHEMA');
  var known=tp5PlatformNames_(),result=[],seen={};
  rows.forEach(function(item){
    if(!item||typeof item!=='object')return;
    var name=String(item.displayName||item.fullName||item.name||'').trim();
    var short=String(item.code||item.abbreviation||'').trim();
    // Migrate old metadata keyed by name=code while preserving the actual
    // existing authorization codes. New records use name=display, abbr=code.
    var oldCode=known.find(function(x){return tp5BPKey_(x)===tp5BPKey_(item.name);});
    var code=known.find(function(x){return tp5BPKey_(x)===tp5BPKey_(short);});
    if(!code&&oldCode){
      code=oldCode;
      if(tp5BPKey_(name)===tp5BPKey_(code))name=tp5BPSeedName_(code)||code;
    }
    if(!code||!name||seen[tp5BPKey_(code)])return;
    seen[tp5BPKey_(code)]=true;
    result.push({name:name,abbreviation:code});
  });
  return result;
}
function tp5BPDetails_(){
  var records=tp5BPRead_(),lookup={};
  records.forEach(function(x){lookup[tp5BPKey_(x.abbreviation)]=x.name;});
  return tp5PlatformNames_().map(function(code){
    return {name:lookup[tp5BPKey_(code)]||tp5BPSeedName_(code)||code,
      abbreviation:code};
  });
}
function tp5BPCheckWrite_(rows){
  tp5Must_(rows.length<=100,'Business Platform directory limit reached.','LIMIT');
  var body=JSON.stringify(rows),count=Utilities.newBlob(body).getBytes().length;
  tp5Must_(count<=8500,'Business Platform metadata exceeded the safe storage limit.','LIMIT');
  return body;
}
function tp5BPWrite_(rows){
  tp5Props_().setProperty('TP5_PLATFORM_RECORDS',tp5BPCheckWrite_(rows));
}
function tp5BPReferences_(code){
  var key=tp5BPKey_(code);
  function same(row){
    return row&&!row.deleted&&
      tp5BPKey_(row.platform||row.businessPlatform||row.bp)===key;
  }
  return ['sites','members','users'].some(function(table){
    return tp5Read_(table).some(same);
  });
}
function tp5BPEnsureAvailable_(name,code,ignoreCode){
  var other=tp5BPDetails_().filter(function(row){
    return tp5BPKey_(row.abbreviation)!==tp5BPKey_(ignoreCode);
  });
  tp5Must_(!other.some(function(row){
    return tp5BPKey_(row.name)===tp5BPKey_(name)||
      tp5BPKey_(row.abbreviation)===tp5BPKey_(code);
  }),'Business Platform Name or code is already registered.','CONFLICT');
}
function tp5BPResponse_(extra){
  return tp5Reply_(Object.assign({
    businessPlatforms:tp5PlatformNames_(),
    businessPlatformRecords:tp5BPDetails_()
  },extra||{}));
}
function tp5BPAdd_(actor,q){
  tp5Admin_(actor);
  var name=tp5BPClean_(q.name,80,'Business Platforms Name'),
      code=tp5BPClean_(q.abbreviation,20,'Business Platform');
  tp5Must_(!tp5BPCanonical_(code),'Business Platform code already exists. Use Edit.','CONFLICT');
  tp5BPEnsureAvailable_(name,code,'');
  var existing=tp5BPRead_();
  var next=existing.concat([{name:name,abbreviation:code}]);
  tp5BPCheckWrite_(next);
  // Legacy backend stores platform identifiers in TP5_PLATFORM_NAMES.
  // Adding only the CODE keeps account/site permissions compatible.
  tp5AddPlatform_(actor,{name:code});
  var canonical=tp5BPCanonical_(code);
  tp5Must_(!!canonical,'The Business Platform code was not registered.','SERVER');
  tp5BPWrite_(next);
  tp5Bump_();tp5Audit_(actor,'BP_ADD',code,'Business Platform name and code created.');
  return tp5BPResponse_({created:true,platformName:canonical});
}
function tp5BPUpdate_(actor,q){
  tp5Admin_(actor);
  var oldCode=tp5BPCanonical_(q.originalName);
  tp5Must_(!!oldCode,'Original Business Platform was not found.','NOT_FOUND');
  var name=tp5BPClean_(q.name,80,'Business Platforms Name'),
      newCode=tp5BPClean_(q.abbreviation,20,'Business Platform');
  var changeCode=tp5BPKey_(oldCode)!==tp5BPKey_(newCode);
  if(changeCode){
    tp5Must_(!tp5BPDefault_(oldCode),'This is a default Business Platform code. Its full name can be edited, but its code cannot be changed.','FORBIDDEN');
    tp5Must_(!tp5BPReferences_(oldCode),'This Business Platform is assigned to existing members, accounts or Work Locations. Reassign them before changing its code.','CONFLICT');
  }
  tp5BPEnsureAvailable_(name,newCode,oldCode);
  var current=tp5BPRead_().filter(function(row){
    return tp5BPKey_(row.abbreviation)!==tp5BPKey_(oldCode);
  });
  var updated=current.concat([{name:name,abbreviation:changeCode?newCode:oldCode}]);
  tp5BPCheckWrite_(updated);
  if(changeCode){
    var props=tp5Props_(),saved;
    try{saved=JSON.parse(props.getProperty('TP5_PLATFORM_NAMES')||'[]');}
    catch(error){tp5Fail_('Business Platform identifiers need administrator review.','SCHEMA');}
    tp5Must_(Array.isArray(saved)&&saved.some(function(x){return tp5BPKey_(x)===tp5BPKey_(oldCode);}),
      'Only unused custom Business Platform codes can be changed.','FORBIDDEN');
    var next=TIPONOrgCore.platformNames(saved.map(function(x){
      return tp5BPKey_(x)===tp5BPKey_(oldCode)?newCode:x;
    }));
    var json=JSON.stringify(next);
    tp5Must_(Utilities.newBlob(json).getBytes().length<=8500,'Business Platform code limit reached.','LIMIT');
    props.setProperty('TP5_PLATFORM_NAMES',json);
    TP5_PLATFORM_CACHE_=null;
  }
  tp5BPWrite_(updated);
  tp5Bump_();
  tp5Audit_(actor,'BP_UPDATE',oldCode,'Updated full name for '+(changeCode?newCode:oldCode));
  return tp5BPResponse_({updated:true,platformName:changeCode?newCode:oldCode});
}
function tp5BPDelete_(actor,q){
  tp5Admin_(actor);
  var code=tp5BPCanonical_(q.name);
  tp5Must_(!!code,'Business Platform was not found.','NOT_FOUND');
  tp5Must_(!tp5BPDefault_(code),
    'Default Business Platforms cannot be deleted. Their original codes remain part of the approved organization directory.','FORBIDDEN');
  tp5Must_(!tp5BPReferences_(code),
    'Members, accounts or Work Locations still reference this platform. Reassign them before deleting.','CONFLICT');
  var props=tp5Props_(),saved;
  try{saved=JSON.parse(props.getProperty('TP5_PLATFORM_NAMES')||'[]');}
  catch(error){tp5Fail_('Business Platform identifiers need administrator review.','SCHEMA');}
  tp5Must_(Array.isArray(saved)&&saved.some(function(x){return tp5BPKey_(x)===tp5BPKey_(code);}),
    'Only custom Business Platforms without references can be deleted.','FORBIDDEN');
  var next=saved.filter(function(x){return tp5BPKey_(x)!==tp5BPKey_(code);});
  var details=tp5BPRead_().filter(function(r){return tp5BPKey_(r.abbreviation)!==tp5BPKey_(code);});
  tp5BPCheckWrite_(details);
  props.setProperty('TP5_PLATFORM_NAMES',JSON.stringify(next));
  TP5_PLATFORM_CACHE_=null;
  tp5BPWrite_(details);tp5Bump_();
  tp5Audit_(actor,'BP_DELETE',code,'Unused custom Business Platform removed; attendance history retained.');
  return tp5BPResponse_({deleted:true,platformName:code});
}
