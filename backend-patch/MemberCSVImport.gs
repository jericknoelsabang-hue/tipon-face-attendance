/** Member CSV import with required weekly schedule. Private Apps Script helper.
 * Code.gs routes adminMemberImportWithSchedule here under its existing lock.
 * Add after authentication:
 * if(action==='adminMemberImportWithSchedule')return tp5Lock_(function(){actor=tp5Auth_(q);return tp5ImportMembersWithSchedule_(actor,q.rows);});
 * The health reply advertises memberImportWorkSchedule=true only when this
 * handler and the MemberMetadata.gs schedule validation/column helpers exist.
 * Preserve the legacy adminMemberImport route for older clients.
 */
function tp5ImportMembersWithSchedule_(actor,rows){
  tp5Admin_(actor);
  tp5Must_(Array.isArray(rows)&&rows.length>=1&&rows.length<=40,'Import 1 to 40 members per batch.','LIMIT');
  var registered=tp5Read_('members'),batchIds=new Set(),skipped=0;
  var validated=rows.map(function(raw){
    tp5Must_(raw&&typeof raw==='object'&&!Array.isArray(raw),'Invalid member import row.','VALIDATION');
    var id=TIPONOrgCore.clean(raw.id,120),name=TIPONOrgCore.clean(raw.name,120),
      coop=TIPONOrgCore.clean(raw.coop,80),platform=tp5ResolvePlatform_(raw.platform);
    tp5Must_(id&&name&&name.length<=120&&TIPONOrgCore.COOPS.includes(coop),
      'Member ID, full name, cooperative and business platform are required.','VALIDATION');
    tp5Must_(raw.workSchedule&&typeof raw.workSchedule==='object','Weekly Work Schedule is required for each imported member.','VALIDATION');
    var schedule=tp5MemberWorkScheduleV2_(raw.workSchedule,null);
    tp5Must_(!batchIds.has(id.toLowerCase()),'Duplicate Member ID in this upload batch: '+id,'DUPLICATE');
    batchIds.add(id.toLowerCase());
    var same=registered.find(function(m){return String(m.id).toLowerCase()===id.toLowerCase()&&!m.deleted;});
    if(same){
      tp5Must_(same.id===id&&same.name===name&&same.coop===coop&&
        TIPONOrgCore.platformKey(same.platform)===TIPONOrgCore.platformKey(platform)&&
        tp5SameMemberScheduleV2_(same.workSchedule,schedule),
        'Existing Member ID has different details or Weekly Work Schedule. Use Edit instead.','CONFLICT');
      skipped++;return null;
    }
    var entry={id:id,name:name,coop:coop,platform:platform,siteId:'',siteIds:[],active:false,
      importPending:true,importedWithoutFace:true,faceEnrollmentStatus:'pending',template:null,consentAt:null,
      createdBy:actor.id,createdAt:tp5Now_(),rev:1};
    tp5ApplyMemberScheduleColumnsV2_(entry,schedule);
    return entry;
  }).filter(function(item){return item!==null;});
  validated.forEach(function(entry){tp5Put_('members',entry);});
  if(validated.length){tp5Bump_();tp5RefreshMemberDirectory_();}
  tp5Audit_(actor,'IMPORT_MEMBERS','',String(validated.length)+' staged with Weekly Work Schedule; '+String(skipped)+' previously existed.');
  return tp5Reply_({added:validated.length,skipped:skipped,memberImportWorkSchedule:true});
}
function verifyTIPONMemberCSVScheduleSupport(){
  var ready=typeof tp5MemberWorkScheduleV2_==='function'&&typeof tp5SameMemberScheduleV2_==='function'&&typeof tp5ApplyMemberScheduleColumnsV2_==='function';
  var result={memberImportWorkSchedule:ready,columns:['Member ID','Full name','Cooperative','Business platform','Work Days','Work Start','Work End']};
  console.log(JSON.stringify(result));return result;
}
