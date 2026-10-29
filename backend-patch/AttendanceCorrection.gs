/**
 * TIPON KABILANG — Attendance correction helpers, v5.5.40
 * PRIVATE Google Apps Script file. Add to the existing attendance project only
 * after confirming the live Code.gs does not already define these functions.
 * Never publish Script Properties, credentials, face data or the private /exec URL.
 */

/** Project malformed legacy sessions without allowing duplicate punches to hide all logs.
 * Keep the earliest IN and latest OUT for summaries; raw ledger events are never removed.
 */
function tp5ProjectAttendanceSafe_(events){
  var sessions=new Map(),seenIds=new Set();
  (events||[]).forEach(function(event){
    if(!event||event.deleted||event.reviewStatus==='rejected'||seenIds.has(String(event.id)))return;
    seenIds.add(String(event.id));
    var key=String(event.sessionId||event.id),current=sessions.get(key);
    if(!current){sessions.set(key,[event]);return;}
    var sameDirection=current.find(function(item){return item.type===event.type;});
    if(!sameDirection){current.push(event);return;}
    var previous=Date.parse(sameDirection.timestamp),next=Date.parse(event.timestamp);
    if(event.type==='IN'?next<previous:next>previous){
      current[current.indexOf(sameDirection)]=event;
    }
  });
  return TIPONOrgCore.project(Array.from(sessions.values()).reduce(function(all,items){return all.concat(items);},[]));
}

/** Apply the audited correction overlay to events returned by the existing ledger.
 * In Code.gs, change the final "return rows;" inside tp5EventWindow_ to:
 *     return tp5ApplyAttendanceCorrections_(rows);
 * This preserves raw events and synchronizes the corrected view to every device.
 */
function tp5ApplyAttendanceCorrections_(rows){
  var corrections=tp5Read_('operations').filter(function(x){return x&&x.kind==='attendanceCorrection';});
  if(!corrections.length)return rows;
  var bySession=new Map(corrections.map(function(x){return [String(x.sessionId),x];}));
  var needsVirtualOut=corrections.some(function(c){return !c.deleted&&c.createdOut&&c.timeOut;});
  var rawOutSessions=new Set();
  if(needsVirtualOut){
    tp5AllEvents_().forEach(function(event){
      if(event&&!event.deleted&&event.type==='OUT')rawOutSessions.add(String(event.sessionId||event.id));
    });
  }
  var result=rows.map(function(event){
    var key=String(event.sessionId||event.id),correction=bySession.get(key);
    if(!correction)return event;
    var value=Object.assign({},event,{
      correctionRev:Number(correction.rev)||0,
      correctedAt:correction.updatedAt||'',
      correctedBy:correction.actorId||'',
      correctionReason:correction.reason||''
    });
    if(correction.deleted){value.deleted=true;return value;}
    if(event.type==='IN'&&correction.timeIn){
      value.timestamp=correction.timeIn;value.day=TIPONOrgCore.phDay(correction.timeIn);
    }
    if(event.type==='OUT'&&correction.timeOut){
      value.timestamp=correction.timeOut;value.day=TIPONOrgCore.phDay(correction.timeOut);
    }
    return value;
  });
  corrections.forEach(function(correction){
    var sessionId=String(correction.sessionId||'');
    if(correction.deleted||!correction.createdOut||!correction.timeOut||rawOutSessions.has(sessionId))return;
    var syntheticId='attendance-correction-out:'+sessionId;
    if(result.some(function(event){return String(event.id)===syntheticId;}))return;
    var source=rows.find(function(event){
      return event&&!event.deleted&&event.type==='IN'&&String(event.sessionId||event.id)===sessionId;
    })||{
      id:syntheticId,sessionId:sessionId,memberId:correction.memberId||'',
      memberName:correction.memberName||'',coop:correction.coop||'',platform:correction.platform||'',
      siteId:correction.siteId||'',siteName:correction.siteName||'',orgId:correction.orgId||'',
      recordedById:correction.actorId||'',performedBy:correction.performedBy||'',cloudAck:true
    };
    result.push(Object.assign({},source,{
      id:syntheticId,sessionId:sessionId,type:'OUT',
      timestamp:correction.timeOut,day:TIPONOrgCore.phDay(correction.timeOut),
      correctionRev:Number(correction.rev)||0,correctedAt:correction.updatedAt||'',
      correctedBy:correction.actorId||'',correctionReason:correction.reason||'',
      source:'attendance-correction',cloudAck:true,requiresSessionResolution:false,deleted:false
    }));
  });
  return result;
}

/** Rebuild only the affected report session; do not erase the raw event ledger. */
function tp5RebuildAttendanceProjection_(sessionId){
  var active=tp5ApplyAttendanceCorrections_(tp5AllEvents_()).filter(function(e){return !e.deleted;});
  var row=tp5ProjectAttendanceSafe_(active).find(function(r){return String(r.key)===String(sessionId);});
  if(row){tp5WriteProjection_(row);SpreadsheetApp.flush();return;}
  var old=tp5Find_('sessions',sessionId);
  if(old&&old._row){
    var report=tp5ReportSheet_();
    report.getRange(old._row,1,1,TIPONOrgCore.REPORT_HEADERS.length).clearContent();
    tp5Put_('sessions',Object.assign({},old,{deleted:true,updatedAt:tp5Now_()}),old);
  }
  SpreadsheetApp.flush();
}

/** Server-authoritative attendance edit/delete with revision and audit checks. */
function tp5AttendanceCorrect_(actor,q){
  tp5Must_(actor.role==='admin'||actor.role==='registrar',
    'Only an Administrator or approved User can correct attendance.','FORBIDDEN');
  var sessionId=TIPONOrgCore.clean(q.sessionId,120);
  tp5Must_(sessionId,'Attendance session is required.','VALIDATION');
  var rawEvents=tp5AllEvents_(),all=tp5ApplyAttendanceCorrections_(rawEvents),events=all.filter(function(e){
    return !e.deleted&&String(e.sessionId||e.id)===sessionId;
  });
  var row=tp5ProjectAttendanceSafe_(events)[0];
  tp5Must_(row,'Attendance session was not found. Refresh the logs.','NOT_FOUND');
  tp5Must_(actor.role==='admin'||TIPONOrgCore.inScope(actor,row),
    'Attendance is outside your approved Cooperative/Business Platform.','FORBIDDEN');
  var correctionId='attendance-correction:'+sessionId;
  var old=tp5Find_('operations',correctionId),base=Number(old&&old.rev||0);
  tp5Must_(Number(q.baseRev||0)===base,
    'Attendance was corrected on another device. Refresh and retry.','CONFLICT');
  var reason=TIPONOrgCore.clean(q.reason,400);
  tp5Must_(reason.length>=5,'Enter a correction reason of at least five characters.','VALIDATION');
  var deleted=q.delete===true,now=Date.now(),timeIn=row.timeIn||'',timeOut=row.timeOut||'';
  if(deleted){
    tp5Must_(timeIn,'Attendance session has no Time In to delete.','VALIDATION');
  }else{
    var c=q.changes||{};
    tp5Must_(c&&typeof c==='object'&&!Array.isArray(c)&&
      Object.keys(c).every(function(k){return ['timeIn','timeOut'].includes(k);}),
      'Only Time In and Time Out can be corrected.','FORBIDDEN');
    if(Object.prototype.hasOwnProperty.call(c,'timeIn'))timeIn=String(c.timeIn||'');
    if(Object.prototype.hasOwnProperty.call(c,'timeOut')){
      timeOut=String(c.timeOut||'');
      tp5Must_(timeOut||!row.timeOut,'Time Out cannot be cleared from a completed session.','VALIDATION');
    }
    tp5Must_(timeIn,'Time In is required.','VALIDATION');
    var start=Date.parse(timeIn),end=timeOut?Date.parse(timeOut):null;
    tp5Must_(Number.isFinite(start)&&start>=Date.UTC(2020,0,1)&&start<=now+300000,
      'Invalid Time In.','CLOCK');
    if(timeOut){
      tp5Must_(Number.isFinite(end)&&end>start&&end<=now+300000,
        'Time Out must be after Time In and not in the future.','CLOCK');
      tp5Must_(end-start>=90000,
        'Time Out must be at least 90 seconds after Time In.','COOLDOWN');
    }
    var others=tp5ProjectAttendanceSafe_(all.filter(function(e){
      return !e.deleted&&String(e.memberId)===String(row.memberId);
    })).filter(function(r){return String(r.key)!==sessionId;});
    others.forEach(function(other){
      var otherStart=Date.parse(other.timeIn||other.timeOut),
        otherEnd=other.timeOut?Date.parse(other.timeOut):Infinity;
      tp5Must_(end!==null?end<=otherStart||start>=otherEnd:start>=otherEnd,
        'The correction overlaps another attendance session.','OVERLAP');
    });
  }
  var hasRawOut=rawEvents.some(function(e){return !e.deleted&&e.type==='OUT'&&String(e.sessionId||e.id)===sessionId;});
  var createdOut=!deleted&&!!timeOut&&!hasRawOut;
  var next={id:correctionId,kind:'attendanceCorrection',sessionId:sessionId,
    memberId:row.memberId,memberName:row.memberName||'',coop:row.coop||'',platform:row.platform||'',
    siteId:row.siteId||'',siteName:row.location||row.siteName||'',orgId:row.orgId||'',
    deleted:deleted,timeIn:timeIn,timeOut:timeOut,createdOut:createdOut,
    reason:reason,actorId:actor.id,performedBy:actor.username||actor.name||'',updatedAt:tp5Now_(),rev:base+1};
  tp5Put_('operations',next,old);
  var eventVersion=Number(tp5Props_().getProperty('TP5_EVENT_VERSION')||0)+1;
  tp5Props_().setProperty('TP5_EVENT_VERSION',String(eventVersion));tp5Bump_();
  tp5Audit_(actor,deleted?'ATTENDANCE_DELETE':'ATTENDANCE_EDIT',sessionId,reason+'; revision '+next.rev);
  tp5RebuildAttendanceProjection_(sessionId);
  return tp5Reply_({correction:{sessionId:sessionId,deleted:deleted,createdOut:createdOut,
    timeIn:timeIn,timeOut:timeOut,actorId:next.actorId,rev:next.rev,updatedAt:next.updatedAt},eventVersion:eventVersion});
}
