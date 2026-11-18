/** TIPON KABILANG — Paygroup and Operation Code directory backend.
 * Add to the existing private Apps Script project. Never deploy as a new web app.
 * Add the route snippets in README_PAYGROUP.md after the existing tp5Auth_ call.
 */
function tp5PGKey_(v){return String(v||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();}
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
  var codes=Array.isArray(p.operationCodes)?p.operationCodes.map(function(x){return TIPONOrgCore.clean(x,60);}):[];
  tp5Must_(codes.length<=30&&codes.every(function(x){return x.length>=1;})&&
    new Set(codes.map(tp5PGKey_)).size===codes.length,'Operation Codes must be unique, non-empty values (maximum 30).','VALIDATION');
  return {id:id,coop:coop,platform:platform,name:name,operationCodes:codes,updatedAt:tp5Now_(),rev:Number(p.rev)||0};
}
function tp5PGList_(actor){
  var rows=tp5PGRead_().filter(function(pg){return actor.role==='admin'||
    (actor.coop===pg.coop&&tp5PGKey_(actor.platform)===tp5PGKey_(pg.platform));});
  return tp5Reply_({paygroups:rows,paygroupDirectorySupported:true});
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
