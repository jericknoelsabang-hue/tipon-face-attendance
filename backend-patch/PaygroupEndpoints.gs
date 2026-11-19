/** TIPON KABILANG — Paygroup endpoint handlers for the existing v5 JSON-table backend.
 * Use when Code.gs already defines tp5ValidatePaygroup_, tp5AttendancePaygroup_,
 * tp5PaygroupIds_ and upgradeTIPONPaygroups(). Do NOT install Paygroups.gs beside
 * that newer implementation; it defines overlapping helpers.
 * Add the four router branches documented in README_PAYGROUP.md to Code.gs.
 */
function tp5PGList_(actor){
  var sites=tp5Read_('sites').filter(function(site){return !site.deleted&&TIPONOrgCore.inScope(actor,site);});
  var groups=tp5Read_('paygroups').filter(function(pg){
    if(pg.deleted)return false;
    if(actor.role==='admin')return true;
    if(actor.role==='kiosk')return sites.some(function(site){
      return site.coop===pg.coop&&TIPONOrgCore.platformKey(site.platform)===TIPONOrgCore.platformKey(pg.platform)&&
        (site.paygroupIds||[]).map(String).indexOf(String(pg.id))>=0;
    });
    return TIPONOrgCore.inScope(actor,pg);
  }).map(function(pg){
    var copy=tp5Safe_(pg);
    copy.siteIds=sites.filter(function(site){return (site.paygroupIds||[]).map(String).indexOf(String(pg.id))>=0;})
      .map(function(site){return site.id;});
    return copy;
  });
  return tp5Reply_({paygroups:groups,paygroupDirectorySupported:true});
}
function tp5PGAdd_(actor,q){
  tp5Must_(actor&&(actor.role==='admin'||actor.role==='registrar'),
    'Only an Administrator or approved User can add a Paygroup.','FORBIDDEN');
  tp5Must_(q.paygroup&&typeof q.paygroup==='object'&&!Array.isArray(q.paygroup),
    'Paygroup details are required.','VALIDATION');
  var record=tp5ValidatePaygroup_(actor,Object.assign({},q.paygroup),null),now=tp5Now_();
  record.createdBy=actor.id;record.createdAt=now;record.updatedAt=now;record.rev=1;record.deleted=false;
  tp5Put_('paygroups',record);tp5RefreshPaygroupDirectory_();var version=tp5Bump_();
  tp5Audit_(actor,'PAYGROUP_ADD',record.id,'Paygroup created.');
  return tp5Reply_({paygroups:tp5PGList_(actor).paygroups,paygroupDirectorySupported:true,catalogVersion:version});
}
function tp5PGUpdate_(actor,q){
  tp5Must_(actor&&(actor.role==='admin'||actor.role==='registrar'),'Only an Administrator or approved User can edit a Paygroup.','FORBIDDEN');
  tp5Must_(q.paygroup&&typeof q.paygroup==='object'&&!Array.isArray(q.paygroup),
    'Paygroup details are required.','VALIDATION');
  var old=tp5Find_('paygroups',q.paygroup.id);
  tp5Must_(old&&!old.deleted,'Paygroup not found. Refresh and retry.','NOT_FOUND');
  var record=tp5ValidatePaygroup_(actor,Object.assign({},q.paygroup),old);
  record.createdBy=old.createdBy||actor.id;record.createdAt=old.createdAt||tp5Now_();
  record.updatedAt=tp5Now_();record.rev=Number(old.rev||0)+1;record.deleted=false;
  tp5Put_('paygroups',record,old);tp5RefreshPaygroupDirectory_();var version=tp5Bump_();
  tp5Audit_(actor,'PAYGROUP_UPDATE',record.id,'Paygroup and Operation Codes updated.');
  return tp5Reply_({paygroups:tp5PGList_(actor).paygroups,paygroupDirectorySupported:true,catalogVersion:version});
}
function tp5PGDelete_(actor,q){
  tp5Must_(actor&&(actor.role==='admin'||actor.role==='registrar'),
    'Only an Administrator or approved User can delete a Paygroup.','FORBIDDEN');
  var id=TIPONOrgCore.clean(q.id,120),old=tp5Find_('paygroups',id);
  tp5Must_(old&&!old.deleted,'Paygroup not found. Refresh and retry.','NOT_FOUND');
  if(actor.role==='registrar')tp5Must_(TIPONOrgCore.inScope(actor,old),
    'Delete Paygroups only in your approved Cooperative and Business Platform.','FORBIDDEN');
  var sites=tp5Read_('sites'),members=tp5Read_('members');
  var assignedToSite=sites.some(function(site){return !site.deleted&&(site.paygroupIds||[]).map(String).indexOf(String(id))>=0;});
  var assignedToMember=members.some(function(member){return !member.deleted&&(member.paygroupIds||[]).map(String).indexOf(String(id))>=0;});
  tp5Must_(!assignedToSite&&!assignedToMember,
    'This Paygroup is assigned to a Work Location or member. Remove those assignments before deleting it.','IN_USE');
  var record=tp5ValidatePaygroup_(actor,Object.assign({},old,{deleted:true}),old);
  record.createdBy=old.createdBy||actor.id;record.createdAt=old.createdAt||tp5Now_();
  record.updatedAt=tp5Now_();record.rev=Number(old.rev||0)+1;record.deleted=true;
  tp5Put_('paygroups',record,old);tp5RefreshPaygroupDirectory_();var version=tp5Bump_();
  tp5Audit_(actor,'PAYGROUP_DELETE',record.id,'Unused Paygroup soft-deleted.');
  return tp5Reply_({paygroups:tp5PGList_(actor).paygroups,paygroupDirectorySupported:true,catalogVersion:version});
}
