/**
 * Private member metadata routes for the existing TIPON Apps Script project.
 * Install INSTEAD OF MemberLocationEdit.gs; both define shared helper names.
 * Supports record details, schedules, assignments and scoped soft deletion.
 * No biometric enrollment or recognition implementation is included.
 */
function tp5LocationIds_(actor,coop,platform,value){
  tp5Must_(Array.isArray(value)&&value.length>=1,'Select at least one Assigned Work Location.','VALIDATION');
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

function tp5EditableMemberNumberV2_(old,value){
  var number=TIPONOrgCore.clean(value===undefined?(old.memberNumber||old.id):value,45);
  tp5Must_(number&&!number.split('').some(function(ch){return ch.charCodeAt(0)<32;}),'Enter a valid Member ID.','VALIDATION');
  var canonical=number.normalize('NFKC').toLowerCase();
  tp5Must_(!tp5Read_('members').some(function(m){
    var current=String(m.memberNumber||m.id).normalize('NFKC').toLowerCase();
    return !m.deleted&&String(m.id)!==String(old.id)&&current===canonical;
  }),'Member ID is already registered.','DUPLICATE');
  return number;
}

function tp5TransferLocationIds_(coop,platform,value){
  tp5Must_(Array.isArray(value)&&value.length>=1&&value.length<=40,
    'Select at least one Assigned Work Location (maximum 40).','VALIDATION');
  var ids=value.map(function(id){return String(id||'').trim();});
  tp5Must_(ids.every(function(id){return id&&id.length<=120;})&&new Set(ids).size===ids.length,
    'Assigned Work Locations must be unique and valid.','VALIDATION');
  ids.forEach(function(id){
    var site=tp5Find_('sites',id);
    tp5Must_(site&&!site.deleted&&site.coop===coop&&
      TIPONOrgCore.platformKey(site.platform)===TIPONOrgCore.platformKey(platform),
      'Assigned Work Location must be an active central location matching the selected Cooperative and Business Platform.','DEPENDENCY');
  });
  return ids;
}

function tp5MemberWorkScheduleV2_(value,oldValue){
  if(value===undefined)return oldValue||null;
  tp5Must_(value&&typeof value==='object'&&!Array.isArray(value),'Work Schedule is required.','VALIDATION');
  var days=Array.isArray(value.days)?value.days.map(Number):[];
  tp5Must_(days.length>=1&&days.length<=7&&days.every(function(day){
    return Number.isInteger(day)&&day>=0&&day<=6;
  })&&new Set(days).size===days.length,
    'Select one or more valid work days.','VALIDATION');
  days.sort(function(a,b){return a-b;});
  var start=String(value.start||''),end=String(value.end||'');
  var validTime=function(time){return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);};
  tp5Must_(validTime(start)&&validTime(end)&&start!==end,
    'Enter valid Work Schedule start and end times.','VALIDATION');
  var grace=value.grace===undefined||value.grace===null||value.grace===''?0:Number(value.grace);
  tp5Must_(Number.isInteger(grace)&&grace>=0&&grace<=240,
    'Schedule grace must be between 0 and 240 minutes.','VALIDATION');
  return {enabled:true,days:days,start:start,end:end,grace:grace};
}

function tp5SameMemberScheduleV2_(a,b){
  return JSON.stringify(a||null)===JSON.stringify(b||null);
}

function tp5ApplyMemberScheduleColumnsV2_(member,schedule){
  var s=schedule||member.workSchedule||null;
  if(!s){
    member.workSchedule=null;member.workDays='';member.workStart='';
    member.workEnd='';member.workGrace=0;member.workScheduleText='';
    return member;
  }
  var days=Array.isArray(s.days)?s.days.map(Number):[];
  member.workSchedule={enabled:s.enabled!==false,days:days,start:String(s.start||''),
    end:String(s.end||''),grace:Number(s.grace)||0};
  member.workDays=days.join(',');
  member.workStart=String(s.start||'');
  member.workEnd=String(s.end||'');
  member.workGrace=Number(s.grace)||0;
  member.workScheduleText=member.workDays&&member.workStart&&member.workEnd
    ?member.workDays+' '+member.workStart+'-'+member.workEnd:'';
  return member;
}

function tp5MemberWorkScheduleUpdateV2_(actor,q){
  tp5Must_(actor&&(actor.role==='admin'||actor.role==='registrar'),
    'An approved Administrator or User account is required.','FORBIDDEN');
  var id=TIPONOrgCore.clean(q.memberId,120),old=tp5Find_('members',id);
  tp5Must_(old&&!old.deleted,'Member not found. Refresh Member List.','NOT_FOUND');
  if(actor.role==='registrar')tp5Must_(TIPONOrgCore.inScope(actor,old),
    'Weekly Work Schedule can only be edited for members in your MPC/BP.','FORBIDDEN');
  tp5Must_(Number.isInteger(Number(q.baseRev))&&Number(q.baseRev)===Number(old.rev||0),
    'Member changed on another device. Sync and reopen Edit.','CONFLICT');
  tp5Must_(Object.prototype.hasOwnProperty.call(q,'workSchedule'),
    'Weekly Work Schedule details are required.','VALIDATION');
  var schedule=tp5MemberWorkScheduleV2_(q.workSchedule,old.workSchedule);
  if(tp5SameMemberScheduleV2_(old.workSchedule,schedule))
    return tp5Reply_({member:tp5Safe_(old),unchanged:true});
  var next=Object.assign({},old,{
    workSchedule:schedule,updatedAt:tp5Now_(),rev:Number(old.rev||0)+1
  });
  tp5ApplyMemberScheduleColumnsV2_(next,schedule);
  return tp5MemberLocationResult_(actor,old,next,'MEMBER_UPDATE_WEEKLY_SCHEDULE');
}

function tp5UserMemberTransferLocations_(actor,q){
  tp5Must_(actor.role==='registrar','An approved User account is required.','FORBIDDEN');
  var id=TIPONOrgCore.clean(q.memberId,120),member=tp5Find_('members',id);
  tp5Must_(member&&!member.deleted,'Member was not found. Refresh Member List.','NOT_FOUND');
  tp5Must_(TIPONOrgCore.inScope(actor,member),'Member is outside your approved scope.','FORBIDDEN');
  var sites=tp5Read_('sites').filter(function(site){return site&&!site.deleted;}).map(function(site){
    return {id:site.id,name:site.name,coop:site.coop,platform:site.platform,
      address:site.address||'',lat:Number(site.lat),lng:Number(site.lng),
      radius:Number(site.radius)||150,rev:Number(site.rev)||0};
  });
  return tp5Reply_({sites:sites,catalogVersion:Number(tp5Props_().getProperty('TP5_CATALOG_VERSION')||0)});
}

function tp5UserMemberTransferUpdateV2_(actor,q){
  tp5Must_(actor.role==='registrar','An approved User account is required.','FORBIDDEN');
  var id=TIPONOrgCore.clean(q.memberId,120),old=tp5Find_('members',id);
  tp5Must_(old&&!old.deleted,'Member was not found. Refresh Member List.','NOT_FOUND');
  tp5Must_(TIPONOrgCore.inScope(actor,old),'Only a member currently in your approved scope can be transferred.','FORBIDDEN');
  tp5Must_(Number.isInteger(Number(q.baseRev))&&Number(q.baseRev)===Number(old.rev||0),
    'Member was changed on another device. Sync and reopen Edit.','CONFLICT');
  var c=q.changes;
  tp5Must_(c&&typeof c==='object'&&!Array.isArray(c)&&
    Object.keys(c).every(function(k){return ['name','memberNumber','coop','platform','siteIds','workSchedule'].includes(k);})&&
    Object.prototype.hasOwnProperty.call(c,'siteIds'),
    'Only Member ID, Full Name, Cooperative, Business Platform, Work Schedule and Assigned Work Location can be edited.','FORBIDDEN');
  var memberNumber=tp5EditableMemberNumberV2_(old,c.memberNumber),name=TIPONOrgCore.clean(c.name,120),coop=TIPONOrgCore.clean(c.coop,80),platform=tp5ResolvePlatform_(c.platform);
  tp5Must_(name&&TIPONOrgCore.COOPS.includes(coop),'Enter a valid Full Name and Cooperative.','VALIDATION');
  var siteIds=tp5TransferLocationIds_(coop,platform,c.siteIds);
  var workSchedule=tp5MemberWorkScheduleV2_(c.workSchedule,old.workSchedule);
  var changed=memberNumber!==(old.memberNumber||old.id)||name!==old.name||coop!==old.coop||
    TIPONOrgCore.platformKey(platform)!==TIPONOrgCore.platformKey(old.platform)||
    !tp5SameLocations_(tp5OldLocations_(old),siteIds)||
    !tp5SameMemberScheduleV2_(old.workSchedule,workSchedule);
  if(!changed)return tp5Reply_({member:tp5Safe_(old),unchanged:true});
  var assignmentChanged=coop!==old.coop||TIPONOrgCore.platformKey(platform)!==TIPONOrgCore.platformKey(old.platform)||
    !tp5SameLocations_(tp5OldLocations_(old),siteIds);
  tp5Must_(!assignmentChanged||!tp5MemberOpenSession_(old.id),
    'Complete Time Out before transferring this member.','OPEN_SESSION');
  var next=Object.assign({},old,{memberNumber:memberNumber,name:name,coop:coop,platform:platform,siteId:siteIds[0],siteIds:siteIds,
    workSchedule:workSchedule,workLocationReassignmentRequired:false,updatedAt:tp5Now_(),rev:Number(old.rev||0)+1});
  tp5ApplyMemberScheduleColumnsV2_(next,workSchedule);
  return tp5MemberLocationResult_(actor,old,next,'USER_TRANSFER_MEMBER_SCOPE');
}

function tp5MemberOpenSession_(id){
  return TIPONOrgCore.project(tp5ApplyAttendanceCorrections_(tp5AllEvents_())).some(function(r){
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
    'Authorized member metadata update; attendance history retained. Rev '+next.rev);
  return tp5Reply_({member:tp5Safe_(next),catalogVersion:version});
}

function tp5AdminMemberUpdateV2_(actor,q){
  tp5Admin_(actor);
  var id=TIPONOrgCore.clean(q.memberId,120),old=tp5Find_('members',id);
  tp5Must_(old&&!old.deleted,'Member was not found. Refresh Member List.','NOT_FOUND');
  tp5Must_(Number.isInteger(Number(q.baseRev))&&
    Number(q.baseRev)===Number(old.rev||0),
    'Member was changed on another device. Sync and retry.','CONFLICT');
  var c=q.changes;
  tp5Must_(c&&typeof c==='object'&&!Array.isArray(c)&&
    Object.keys(c).every(function(k){return ['name','memberNumber','coop','platform','siteIds','workSchedule'].includes(k);})&&
    Object.prototype.hasOwnProperty.call(c,'siteIds'),
    'Only Member ID, identity, Cooperative, Business Platform, Work Schedule and Assigned Location can be edited.','FORBIDDEN');
  var memberNumber=tp5EditableMemberNumberV2_(old,c.memberNumber),name=TIPONOrgCore.clean(c.name,120),coop=TIPONOrgCore.clean(c.coop,80),
    platform=tp5ResolvePlatform_(c.platform);
  tp5Must_(name&&TIPONOrgCore.COOPS.includes(coop),'Enter a valid name and Cooperative.','VALIDATION');
  var siteIds=tp5LocationIds_(actor,coop,platform,c.siteIds);
  var workSchedule=tp5MemberWorkScheduleV2_(c.workSchedule,old.workSchedule);
  var scopeChanged=coop!==old.coop||TIPONOrgCore.platformKey(platform)!==TIPONOrgCore.platformKey(old.platform);
  var locationsChanged=!tp5SameLocations_(tp5OldLocations_(old),siteIds);
  if(!scopeChanged&&!locationsChanged&&name===old.name&&memberNumber===(old.memberNumber||old.id)&&
     tp5SameMemberScheduleV2_(old.workSchedule,workSchedule))
    return tp5Reply_({member:tp5Safe_(old),unchanged:true});
  tp5Must_(!(scopeChanged||locationsChanged)||!tp5MemberOpenSession_(old.id),
    'Complete open Time Out before editing the member scope or Assigned Location.','OPEN_SESSION');
  var next=Object.assign({},old,{memberNumber:memberNumber,name:name,coop:coop,platform:platform,
    siteId:siteIds[0]||'',siteIds:siteIds,workSchedule:workSchedule,
    workLocationReassignmentRequired:siteIds.length===0,
    updatedAt:tp5Now_(),rev:Number(old.rev||0)+1});
  tp5ApplyMemberScheduleColumnsV2_(next,workSchedule);
  // The existing face enrollment state (including not enrolled) is untouched.
  return tp5MemberLocationResult_(actor,old,next,'ADMIN_EDIT_MEMBER_LOCATION');
}

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
