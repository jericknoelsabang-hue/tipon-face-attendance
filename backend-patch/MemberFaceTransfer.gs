/** TIPON v5.5.36: authenticated routes missing from the v5.5.25 receiver.
 * Dispatch these actions AFTER tp5Auth_ and execute writes under tp5Lock_.
 * Metadata transfers preserve encrypted templates and historical attendance.
 */
function tp5TransferLocations_(actor,q){
  tp5Must_(actor.role==='registrar','An approved User is required.','FORBIDDEN');
  var old=tp5Find_('members',TIPONOrgCore.clean(q.memberId,120));
  tp5Must_(old&&!old.deleted&&TIPONOrgCore.inScope(actor,old),'Member is outside your approved scope.','FORBIDDEN');
  var sites=tp5Read_('sites').filter(function(s){return !s.deleted;}).map(function(s){
    return {id:s.id,name:s.name,coop:s.coop,platform:s.platform,lat:s.lat,lng:s.lng,radius:s.radius,rev:s.rev};
  });
  return tp5Reply_({sites:sites});
}
function tp5TransferUpdate_(actor,q){
  tp5Must_(actor.role==='admin'||actor.role==='registrar','An approved User is required.','FORBIDDEN');
  var old=tp5Find_('members',TIPONOrgCore.clean(q.memberId,120));
  tp5Must_(old&&!old.deleted&&TIPONOrgCore.inScope(actor,old),'Member is outside your approved scope.','FORBIDDEN');
  tp5Must_(Number.isInteger(Number(q.baseRev))&&Number(q.baseRev)===Number(old.rev||0),'Member changed. Refresh and reopen Edit.','CONFLICT');
  var c=q.changes;
  tp5Must_(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).every(function(k){return ['name','memberNumber','coop','platform','siteIds'].includes(k);}), 'Only identity and assignment fields may be edited.','VALIDATION');
  var memberNumber=tp5EditableMemberNumber_(old,c.memberNumber),name=TIPONOrgCore.clean(c.name,120),coop=TIPONOrgCore.clean(c.coop,80),platform=tp5ResolvePlatform_(c.platform);
  tp5Must_(name&&TIPONOrgCore.COOPS.includes(coop),'Name and Cooperative are required.','VALIDATION');
  // Permission comes from the ORIGINAL member scope. The target must be an
  // existing central location, without granting access to target members.
  var ids=c.siteIds;
  tp5Must_(Array.isArray(ids)&&ids.length>=1&&ids.length<=40&&new Set(ids).size===ids.length,'Select unique Assigned Work Locations (1–40).','VALIDATION');
  ids.forEach(function(id){
    var site=typeof id==='string'&&tp5Find_('sites',id);
    tp5Must_(site&&!site.deleted&&site.coop===coop&&TIPONOrgCore.platformKey(site.platform)===TIPONOrgCore.platformKey(platform),'Assigned locations must match the selected Cooperative and Business Platform.','DEPENDENCY');
  });
  if(memberNumber===(old.memberNumber||old.id)&&name===old.name&&coop===old.coop&&TIPONOrgCore.platformKey(platform)===TIPONOrgCore.platformKey(old.platform)&&tp5SameLocations_(tp5OldLocations_(old),ids))return tp5Reply_({member:tp5Safe_(old),unchanged:true});
  tp5Must_(!tp5MemberOpenSession_(old.id),'Complete Time Out before editing member assignments.','OPEN_SESSION');
  var next=Object.assign({},old,{name:name,memberNumber:memberNumber,coop:coop,platform:platform,siteIds:ids,siteId:ids[0],workLocationReassignmentRequired:false,updatedAt:tp5Now_(),rev:Number(old.rev||0)+1});
  return tp5MemberLocationResult_(actor,old,next,'USER_MEMBER_TRANSFER');
}
function tp5MemberFaceUpdate_(actor,q){
  tp5Must_(actor.role==='registrar','An approved enrollment User is required.','FORBIDDEN');
  var old=tp5Find_('members',TIPONOrgCore.clean(q.memberId,120));
  tp5Must_(old&&!old.deleted&&TIPONOrgCore.inScope(actor,old),'Member is outside your approved scope.','FORBIDDEN');
  tp5Must_(Number.isInteger(Number(q.baseRev))&&Number(q.baseRev)===Number(old.rev||0),'Member changed. Refresh and re-enroll.','CONFLICT');
  var c=q.changes;
  tp5Must_(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).every(function(k){return ['name','memberNumber','coop','platform','siteIds','template','consentAt','enrolledBy','enrolledByUsername'].includes(k);}), 'Unsupported face enrollment fields.','VALIDATION');
  var name=TIPONOrgCore.clean(c.name,120),coop=TIPONOrgCore.clean(c.coop,80),platform=tp5ResolvePlatform_(c.platform);
  tp5Must_(name&&TIPONOrgCore.COOPS.includes(coop),'Enter a valid name and Cooperative.','VALIDATION');
  var memberNumber=tp5EditableMemberNumber_(old,c.memberNumber),ids=c.siteIds,template=c.template;
  tp5Must_(Array.isArray(ids)&&ids.length>=1&&ids.length<=40&&new Set(ids).size===ids.length,'Select unique Assigned Work Locations (1–40).','VALIDATION');
  ids.forEach(function(id){var site=typeof id==='string'&&tp5Find_('sites',id);tp5Must_(site&&!site.deleted&&site.coop===coop&&TIPONOrgCore.platformKey(site.platform)===TIPONOrgCore.platformKey(platform),'Assigned locations must match the selected Cooperative and Business Platform.','DEPENDENCY');});
  tp5Must_(template&&template.alg==='AES-GCM'&&typeof template.data==='string'&&template.data.length>0&&template.data.length<18000&&typeof template.iv==='string'&&template.iv.length>0,'An encrypted AES-GCM face template is required.','VALIDATION');
  var consent=Date.parse(c.consentAt);
  tp5Must_(Number.isFinite(consent)&&consent<=Date.now()+300000,'Valid biometric consent is required.','VALIDATION');
  tp5Must_(!tp5MemberOpenSession_(old.id),'Complete Time Out before replacing the facial template.','OPEN_SESSION');
  var next=Object.assign({},old,{name:name,coop:coop,platform:platform,memberNumber:memberNumber,siteIds:ids,siteId:ids[0],template:template,consentAt:c.consentAt,enrolledBy:actor.id,enrolledByUsername:actor.username||'',active:true,importPending:false,importedWithoutFace:false,workLocationReassignmentRequired:false,faceEnrollmentStatus:'enrolled',updatedAt:tp5Now_(),rev:Number(old.rev||0)+1});
  delete next._row;delete next._pendingOp;delete next.descriptors;
  tp5Put_('members',next,old);tp5RefreshMemberDirectory_();var version=tp5Bump_();
  tp5Audit_(actor,'MEMBER_FACE_UPDATE',next.id,'Encrypted template updated with consent; revision '+next.rev);
  return tp5Reply_({member:tp5Safe_(next),catalogVersion:version});
}

/** Editable business ID; encrypted templates and history keep their stable key. */
function tp5EditableMemberNumber_(old,value){
  var number=TIPONOrgCore.clean(value===undefined?(old.memberNumber||old.id):value,45);
  tp5Must_(number&&!/[\x00-\x1f]/.test(number),'Enter a valid Member ID.','VALIDATION');
  tp5Must_(!tp5Read_('members').some(function(m){return !m.deleted&&String(m.id)!==String(old.id)&&String(m.memberNumber||m.id).toLowerCase()===number.toLowerCase();}),'Member ID is already registered.','DUPLICATE');
  return number;
}
