/**
 * TIPON KABILANG — Member Assignment Routes, v5.5.20
 * PRIVATE Google Apps Script file: MemberLocationEdit.gs
 *
 * Install alongside existing Code.gs/OrgCore.gs. Route actions after existing
 * token authentication and under the existing tp5Lock_ document lock.
 * Does not expose API credentials, biometric templates or login secrets.
 */
function tp5LocationIds_(actor,coop,platform,value){
  tp5Must_(Array.isArray(value),'Assigned Location must be an array.','VALIDATION');
  tp5Must_(value.length<=40,'Maximum 40 assigned Work Locations.','LIMIT');
  var ids=value.map(function(id){return String(id||'').trim();});
  tp5Must_(ids.every(function(id){return id&&id.length<=120;})&&
    new Set(ids).size===ids.length,'Assigned Work Locations must be unique and valid.','VALIDATION');
  ids.forEach(function(id){
    var s=tp5Find_('sites',id);
    tp5Must_(s&&!s.deleted&&s.coop===coop&&
      TIPONOrgCore.platformKey(s.platform)===TIPONOrgCore.platformKey(platform),
      'Assigned Location must exist centrally and match the member MPC/BP.','DEPENDENCY');
    tp5Must_(TIPONOrgCore.inScope(actor,s),'Location is outside your approved scope.','FORBIDDEN');
  });
  return ids;
}
function tp5MemberOpenSession_(id){
  return TIPONOrgCore.project(tp5AllEvents_()).some(function(r){
    return String(r.memberId)===String(id)&&r.timeIn&&!r.timeOut;
  });
}
function tp5SameLocations_(a,b){
  return a.length===b.length&&a.every(function(x){return b.includes(x);});
}
function tp5OldLocations_(m){
  return Array.isArray(m.siteIds)&&m.siteIds.length?
    m.siteIds:[m.siteId].filter(Boolean);
}
function tp5MemberLocationResult_(actor,old,next,action){
  delete next._row;delete next._pendingOp;delete next.descriptors;
  tp5Put_('members',next,old);
  tp5RefreshMemberDirectory_();
  var version=tp5Bump_();
  tp5Audit_(actor,action,next.id,
    'Authorized member GPS assignment updated; AES-GCM template and attendance history retained. Rev '+next.rev);
  return tp5Reply_({member:tp5Safe_(next),catalogVersion:version});
}
/** Admin atomically edits identity, MPC/BP and optional work-location assignments. */
function tp5AdminMemberUpdateV2_(actor,q){
  tp5Admin_(actor);
  var id=TIPONOrgCore.clean(q.memberId,120),old=tp5Find_('members',id);
  tp5Must_(old&&!old.deleted,'Member was not found. Refresh Member List.','NOT_FOUND');
  tp5Must_(Number.isInteger(Number(q.baseRev))&&
    Number(q.baseRev)===Number(old.rev||0),
    'Member was changed on another device. Sync and retry.','CONFLICT');
  var c=q.changes;
  tp5Must_(c&&typeof c==='object'&&!Array.isArray(c)&&
    Object.keys(c).every(function(k){return ['name','coop','platform','siteIds'].includes(k);})&&
    Object.prototype.hasOwnProperty.call(c,'siteIds'),
    'Only approved member fields and Assigned Location can be edited.','FORBIDDEN');
  var name=TIPONOrgCore.clean(c.name,120),coop=TIPONOrgCore.clean(c.coop,80),
    platform=tp5ResolvePlatform_(c.platform);
  tp5Must_(name&&TIPONOrgCore.COOPS.includes(coop),'Enter a valid name and Cooperative.','VALIDATION');
  var siteIds=tp5LocationIds_(actor,coop,platform,c.siteIds);
  var scopeChanged=coop!==old.coop||TIPONOrgCore.platformKey(platform)!==TIPONOrgCore.platformKey(old.platform);
  var locationsChanged=!tp5SameLocations_(tp5OldLocations_(old),siteIds);
  if(!scopeChanged&&!locationsChanged&&name===old.name)
    return tp5Reply_({member:tp5Safe_(old),unchanged:true});
  tp5Must_(!tp5MemberOpenSession_(old.id),
    'Complete open Time Out before editing the member scope or Assigned Location.','OPEN_SESSION');
  var next=Object.assign({},old,{name:name,coop:coop,platform:platform,
    siteId:siteIds[0]||'',siteIds:siteIds,
    workLocationReassignmentRequired:siteIds.length===0,
    updatedAt:tp5Now_(),rev:Number(old.rev||0)+1});
  // The existing face enrollment state (including not enrolled) is untouched.
  return tp5MemberLocationResult_(actor,old,next,'ADMIN_EDIT_MEMBER_LOCATION');
}
/** User may change ONLY GPS assignment of their authorized member, no face re-enrollment. */
function tp5UserMemberLocationUpdate_(actor,q){
  tp5Must_(actor.role==='registrar','An approved User account is required.','FORBIDDEN');
  var id=TIPONOrgCore.clean(q.memberId,120),old=tp5Find_('members',id);
  tp5Must_(old&&!old.deleted,'Member was not found. Refresh Member List.','NOT_FOUND');
  tp5Must_(TIPONOrgCore.inScope(actor,old),'Member is outside your approved MPC/BP.','FORBIDDEN');
  tp5Must_(old.createdBy===actor.id||old.importPending===true||
    old.importedWithoutFace===true||old.workLocationReassignmentRequired===true,
    'Only the record creator or authorized User assigned to this member may update location.','FORBIDDEN');
  tp5Must_(Number.isInteger(Number(q.baseRev))&&
    Number(q.baseRev)===Number(old.rev||0),
    'Member changed on another device. Refresh and try again.','CONFLICT');
  var siteIds=tp5LocationIds_(actor,old.coop,old.platform,q.siteIds);
  if(tp5SameLocations_(tp5OldLocations_(old),siteIds))
    return tp5Reply_({member:tp5Safe_(old),unchanged:true});
  tp5Must_(!tp5MemberOpenSession_(old.id),
    'Complete the open Time Out before reassigning the member.','OPEN_SESSION');
  var next=Object.assign({},old,{siteId:siteIds[0]||'',siteIds:siteIds,
    workLocationReassignmentRequired:siteIds.length===0,
    updatedAt:tp5Now_(),rev:Number(old.rev||0)+1});
  return tp5MemberLocationResult_(actor,old,next,'USER_EDIT_MEMBER_LOCATION');
}


/**
 * Delete an approved User's in-scope member with a server-confirmed soft delete.
 * This intentionally DOES NOT grant Admin access or modify attendance history.
 * It purges the member's encrypted face template from the central member row.
 */
function tp5UserMemberDelete_(actor,q){
  tp5Must_(actor.role==='registrar','An approved User account is required.','FORBIDDEN');
  var id=TIPONOrgCore.clean(q.memberId,120),old=tp5Find_('members',id);
  tp5Must_(old&&!old.deleted,'Member not found. Refresh Member List.','NOT_FOUND');
  tp5Must_(TIPONOrgCore.inScope(actor,old),
    'You can delete only members in your approved Cooperative and Business Platform.','FORBIDDEN');
  tp5Must_(Number.isInteger(Number(q.baseRev))&&
    Number(q.baseRev)===Number(old.rev||0),
    'The member changed on another device. Refresh and try again.','CONFLICT');
  tp5Must_(!tp5MemberOpenSession_(old.id),
    'Complete the member open Time Out before deleting their account.','OPEN_SESSION');
  var next=Object.assign({},old,{
    deleted:true,active:false,importPending:false,importedWithoutFace:false,
    template:null,consentAt:null,faceEnrollmentStatus:'deleted',
    updatedAt:tp5Now_(),deletedAt:tp5Now_(),deletedBy:actor.id,
    rev:Number(old.rev||0)+1
  });
  delete next.descriptors;
  delete next._pendingOp;
  delete next._row;
  tp5Put_('members',next,old);
  tp5RefreshMemberDirectory_();
  var catalogVersion=tp5Bump_();
  tp5Audit_(actor,'USER_DELETE_MEMBER',next.id,
    'Authorized in-scope User soft-deleted member; biometric template removed. Attendance history retained. Revision '+next.rev);
  return tp5Reply_({member:{id:next.id,deleted:true,active:false,
    rev:next.rev},catalogVersion:catalogVersion});
}
