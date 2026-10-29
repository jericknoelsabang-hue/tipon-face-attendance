/* TIPON Face Attendance: interactive camera liveness challenge.
 * Blocks a stationary printed face from triggering a punch.
 * This is NOT certified Presentation Attack Detection: replay/injection may bypass it.
 */
'use strict';
(()=>{
  const VOICES=Object.freeze({
    in:'Time In',out:'Time Out',face:'Face Not Recognized',location:'Not In Assigned Location'
  });
  function yaw(face){
    const p=face?.landmarks?.positions;
    if(!Array.isArray(p)||p.length<46||!p[30]||!p[36]||!p[45])return null;
    const width=Math.hypot(p[45].x-p[36].x,p[45].y-p[36].y);
    return width>8?(p[30].x-(p[36].x+p[45].x)/2)/width:null;
  }
  function duplicateFaceNotice(conflict){
    const member=conflict?.member||conflict;
    const name=String(member?.name||'another member');
    const id=String(member?.id||'unknown');
    return 'This face is already enrolled to '+name+' (ID '+id+'). Cancel and open that member record. Duplicate enrollment is blocked.';
  }
  function challenge(){
    const random=crypto.getRandomValues(new Uint8Array(1))[0];
    return {order:random%2?['turn','blink']:['blink','turn'],step:0,
      started:Date.now(),stepStarted:Date.now(),
      openRatio:0,openFrames:0,closed:false,closedAt:0,
      baseYaw:null,yawFrames:0,passed:false};
  }
  function prompt(s){
    return s.order[s.step]==='blink'?
      'Close both eyes for one second, then open.':
      'Turn your head slightly left or right.';
  }
  function speakOnce(phrase,kind='error',reason=''){
    const now=Date.now();
    if(state.lastTerminalVoice===phrase&&now-(state.lastTerminalVoiceAt||0)<2500)return false;
    state.lastTerminalVoice=phrase;state.lastTerminalVoiceAt=now;
    return speakTerminal(phrase,kind,reason||phrase);
  }
  function advance(s,face,now=Date.now()){
    if(s.passed)return {ok:true,prompt:'Live Face Verified'};
    if(now-s.started>45000)return {ok:false,expired:true,prompt:'Live verification timed out.'};
    let success=false;
    if(s.order[s.step]==='blink'){
      const ratio=blinkRatio(face);
      if(!Number.isFinite(ratio)||ratio<0||ratio>.60)return {ok:false,prompt:'Keep your eyes clearly visible.'};
      if(!s.closed){
        if(ratio>=.09){s.openRatio=Math.max(s.openRatio*.98,ratio);s.openFrames++;}
        if(s.openFrames<2)return {ok:false,prompt:'Look straight at the camera.'};
        if(ratio<Math.max(.06,s.openRatio*.78)){s.closed=true;s.closedAt=now;}
        return {ok:false,prompt:'Close both eyes for one second, then open.'};
      }
      if(now-s.closedAt>6000){s.closed=false;return {ok:false,prompt:'Blink again slowly.'};}
      if(now-s.closedAt>=80&&ratio>Math.max(.09,s.openRatio*.82))success=true;
      else return {ok:false,prompt:'Open your eyes to complete the blink.'};
    }else{
      const offset=yaw(face);
      if(!Number.isFinite(offset))return {ok:false,prompt:'Keep one face inside the frame.'};
      if(s.baseYaw===null){s.baseYaw=offset;s.yawFrames=1;return {ok:false,prompt:'Look straight at the camera.'};}
      if(s.yawFrames<2){
        s.baseYaw=(s.baseYaw+offset)/2;s.yawFrames++;
        return {ok:false,prompt:'Turn your head slightly left or right.'};
      }
      if(Math.abs(offset-s.baseYaw)>=.10&&now-s.stepStarted>=200)success=true;
      else return {ok:false,prompt:'Turn your head slightly left or right.'};
    }
    if(success){
      s.step++;s.openRatio=0;s.openFrames=0;s.closed=false;s.closedAt=0;
      s.baseYaw=null;s.yawFrames=0;s.stepStarted=now;
      if(s.step===s.order.length){s.passed=true;return {ok:true,prompt:'Live Face Verified'};}
      return {ok:false,prompt:prompt(s)};
    }
    return {ok:false,prompt:prompt(s)};
  }
  // Only the four agreed kiosk phrases are sent to text-to-speech.
  const rawSpeak=speakTerminal;
  speakTerminal=function(text,kind='success',reason=''){
    const input=String(text||'');
    let phrase='';
    if(/^Time\s+in\b/i.test(input)&&/recorded|^Time In$/i.test(input))phrase=VOICES.in;
    else if(/^Time\s+out\b/i.test(input)&&/recorded|^Time Out$/i.test(input))phrase=VOICES.out;
    else if(/^Face Not Recognized\b/i.test(input))phrase=VOICES.face;
    else if(/^Not In Assigned Location\b/i.test(input)||
      /^Attendance NOT recorded\b/i.test(input)&&
      /assigned work location|nearest assigned|same assigned|150 m|outside approved location/i.test(input))
      phrase=VOICES.location;
    if(!phrase)return false;
    return rawSpeak(phrase,kind,reason||phrase);
  };
  const loadModels=loadFaceModels;
  loadFaceModels=async function(){
    if(!navigator.onLine&&!(await checkOfflineReady()))
      throw Error('Offline AI files are missing. Download the Offline AI Package while connected.');
    return loadModels();
  };
  const baseStart=startScanner;
  startScanner=async function(...args){state.scanLiveness=null;return baseStart(...args);};
  const baseStop=stopScanner;
  stopScanner=async function(...args){state.scanLiveness=null;return baseStop(...args);};
  // A face match is never sufficient: require a fresh, randomly ordered
  // blink/pose challenge before writing Time In or Time Out.
  scanTick=async function(){
    if(!state.scanning)return;
    if(!hasTerminalSession()){
      await stopScanner();
      updateScanResult('Sign In Required','Use an approved terminal account.','error');
      return;
    }
    const run=state.scanRun;
    try{
      const video=$('scanVideo');
      if(video.readyState>=2&&!state.scanBusy){
        const faces=await detectFaces(video);
        if(!state.scanning||state.scanRun!==run)return;
        if(faces.length===0){
          state.scanCandidate=null;state.scanCandidateCount=0;state.scanLiveness=null;
          state.scanAbsentCount++;
          if(state.scanAbsentCount>=3){state.scanArmed=true;state.lastRecognized=null;}
          setText('cameraBottomTag','Position one live face in the frame.');
        }else if(faces.length!==1){
          state.scanCandidate=null;state.scanCandidateCount=0;state.scanLiveness=null;state.scanAbsentCount=0;
          updateScanResult('One Face Required','Only one person may be visible.','error');
        }else{
          state.scanAbsentCount=0;
          const found=nearestMember(faces[0].descriptor);
          const identified=found.best&&found.best.distance<=MATCH_LIMIT&&
            !(found.second&&found.second.distance-found.best.distance<AMBIGUITY_GAP);
          if(!identified){
            state.scanCandidate=null;state.scanCandidateCount=0;state.scanLiveness=null;
            if(found.best){
              updateScanResult('Face Not Recognized','Please try again.','error');
              speakOnce('Face Not Recognized','error','face');
            }else updateScanResult('No Enrolled Faces','Refresh the Member List.','error');
            setText('cameraBottomTag','Face Not Recognized');
          }else{
            const member=found.best.member;
            if(!state.scanArmed&&state.lastRecognized!==member.id)state.scanArmed=true;
            if(!state.scanArmed){
              setText('cameraBottomTag','Move away before the next scan.');
            }else{
              if(state.scanCandidate===member.id)state.scanCandidateCount++;
              else {state.scanCandidate=member.id;state.scanCandidateCount=1;state.scanLiveness=null;}
              if(state.scanCandidateCount>=2){
                state.scanLiveness ||= challenge();
                const live=advance(state.scanLiveness,faces[0]);
                if(live.expired){
                  state.scanLiveness=challenge();
                  updateScanResult('Live Check Timed Out','Follow the new instructions.','error');
                }else if(live.ok){
                  state.scanArmed=false;state.lastRecognized=member.id;
                  state.scanCandidate=null;state.scanCandidateCount=0;state.scanLiveness=null;
                  playTerminalSound('face');
                  state.livenessProof={memberId:member.id,scanRun:state.scanRun,at:Date.now()};
                  await recordRecognizedFace(member,found.best.distance);
                }else{
                  updateScanResult(member.name+' · Live Face Check',live.prompt);
                  setText('cameraBottomTag',live.prompt);
                }
              }else setText('cameraBottomTag','Verifying face identity...');
            }
          }
        }
      }
    }catch(error){
      console.error('Live face verification',error);
      updateScanResult('Camera Error','Please try again.','error');
    }finally{
      if(state.scanning&&state.scanRun===run)state.scanTimer=setTimeout(scanTick,120);
    }
  };
  // Enrollment uses the same random two-step challenge.
  const originalBeginEnrollment=beginEnrollment;
  beginEnrollment=async function(...args){
    state.enrollLiveness=challenge();
    state.enrollFaceMissing=0;
    state.enrollReadyDescriptor=null;
    state.enrollConflictMemberId='';
    const capture=$('captureEnrollmentSample');
    if(capture){capture.disabled=true;capture.textContent='Capture Sample 1';}
    return originalBeginEnrollment(...args);
  };
  async function captureEnrollmentSample(){
    const button=$('captureEnrollmentSample');
    if(!button||!state.enrollActive||!state.enrollReadyDescriptor||!state.enrollLiveness?.passed||state.enrollConflictMemberId)return;
    if(!state.enrollReadyAt||Date.now()-state.enrollReadyAt>2000){button.disabled=true;state.enrollReadyDescriptor=null;setText('enrollStatus','Wait for a fresh live camera frame, then capture.');return;}
    const memberId=enrollmentMemberKey(),descriptor=state.enrollReadyDescriptor.slice();
    const conflict=findEnrolledFaceConflict([descriptor],memberId);
    if(conflict){
      state.enrollConflictMemberId=conflict.member.id;state.enrollReadyDescriptor=null;button.disabled=true;
      $('retryEnrollment').hidden=true;setText('enrollStatus',duplicateFaceNotice(conflict));return;
    }
    const first=state.enrollCollected[0],previous=state.enrollCollected.at(-1);
    if(first&&euclidean(first,descriptor)>.50){
      state.enrollCollected=[];state.enrollReadyDescriptor=null;state.enrollLiveness=challenge();button.disabled=true;
      setText('enrollCount','0 / 3 samples');$('enrollProgress').style.width='0%';
      setText('enrollStatus','Different face detected. Repeat the live check.');return;
    }
    if(previous&&euclidean(previous,descriptor)<.023){
      state.enrollReadyDescriptor=null;state.enrollLiveness=challenge();button.disabled=true;
      setText('enrollStatus','Move your head slightly, complete the live check, then capture again.');return;
    }
    state.enrollCollected.push(descriptor);state.enrollReadyDescriptor=null;button.disabled=true;
    setText('enrollCount',state.enrollCollected.length+' / 3 samples');
    $('enrollProgress').style.width=(state.enrollCollected.length/3*100)+'%';
    if(state.enrollCollected.length<3){
      state.enrollLiveness=challenge();button.textContent='Capture Sample '+(state.enrollCollected.length+1)+' of 3';
      setText('enrollStatus','Sample captured. Complete the next live check, then capture again.');return;
    }
    const finalConflict=findEnrolledFaceConflict(state.enrollCollected,memberId);
    if(finalConflict){
      state.enrollCollected=[];state.enrollConflictMemberId=finalConflict.member.id;
      state.enrollLiveness=challenge();setText('enrollCount','0 / 3 samples');$('enrollProgress').style.width='0%';
      $('retryEnrollment').hidden=true;setText('enrollStatus',duplicateFaceNotice(finalConflict));return;
    }
    state.pendingDescriptors=state.enrollCollected.map(vector=>vector.slice());
    state.faceReplacementPending=!!state.editMember?.template;
    state.enrollmentProof={memberId:memberId,at:Date.now()};
    setText('enrollFaceLabel','Verified · Three Live Samples Ready');
    setText('enrollStatus','Three samples captured. Save the member record.');
    playTerminalSound('success');showToast('Three face samples captured. Save the member record.','success');
    const autoSave=!!state.editMember;
    await finishEnrollment(false);
    if(autoSave)await saveMemberForm({preventDefault(){}});
  }
  enrollTick=async function(){
    if(!state.enrollActive)return;
    const run=state.enrollRun;
    try{
      const video=$('enrollVideo'),button=$('captureEnrollmentSample');
      if(state.enrollConflictMemberId){
        const conflict=state.members.find(m=>String(m.id)===String(state.enrollConflictMemberId));
        if(button)button.disabled=true;$('retryEnrollment').hidden=true;
        setText('enrollStatus',duplicateFaceNotice(conflict||{id:state.enrollConflictMemberId,name:'another member'}));
      }else if(video.readyState>=2){
        const faces=await detectFaces(video);
        if(!state.enrollActive||state.enrollRun!==run)return;
        if(faces.length!==1){
          state.enrollFaceMissing=(state.enrollFaceMissing||0)+1;state.enrollReadyDescriptor=null;
          if(button)button.disabled=true;
          if(faces.length>1||state.enrollFaceMissing>=3)state.enrollLiveness=challenge();
          setText('enrollStatus',faces.length?'One face at a time.':'Position one face in the frame.');
        }else{
          state.enrollFaceMissing=0;
          const descriptor=Array.from(faces[0].descriptor),memberId=enrollmentMemberKey();
          const conflict=findEnrolledFaceConflict([descriptor],memberId);
          if(conflict){
            state.enrollConflictMemberId=conflict.member.id;state.enrollReadyDescriptor=null;
            if(button)button.disabled=true;$('retryEnrollment').hidden=true;
            setText('enrollStatus',duplicateFaceNotice(conflict));
          }else if(state.enrollReadyDescriptor){
            if(euclidean(state.enrollReadyDescriptor,descriptor)>.50){
              state.enrollReadyDescriptor=null;state.enrollLiveness=challenge();if(button)button.disabled=true;
              setText('enrollStatus','Face changed. Repeat the live check.');
            }else{
              state.enrollReadyDescriptor=descriptor;state.enrollReadyAt=Date.now();
              if(button){button.disabled=false;button.textContent='Capture Sample '+(state.enrollCollected.length+1)+' of 3';}
              setText('enrollStatus','Live check passed. Click Capture Sample.');
            }
          }else{
            state.enrollLiveness ||= challenge();
            const live=advance(state.enrollLiveness,faces[0]);
            if(live.expired){
              state.enrollLiveness=challenge();if(button)button.disabled=true;
              setText('enrollStatus','Live check timed out. Follow the new instructions.');
            }else if(!live.ok){
              if(button)button.disabled=true;setText('enrollStatus',live.prompt);
            }else{
              state.enrollReadyDescriptor=descriptor;state.enrollReadyAt=Date.now();
              if(button){button.disabled=false;button.textContent='Capture Sample '+(state.enrollCollected.length+1)+' of 3';}
              setText('enrollStatus','Live check passed. Click Capture Sample.');
            }
          }
        }
      }
    }catch(error){
      console.error('Face enrollment challenge',error);
      setText('enrollStatus','Enrollment error. Check camera permission and try again.');
      $('retryEnrollment').hidden=false;
    }
    if(state.enrollActive&&state.enrollRun===run)state.enrollTimer=setTimeout(enrollTick,120);
  };
  const captureButton=$('captureEnrollmentSample');
  if(captureButton&&!captureButton.dataset.bound){
    captureButton.dataset.bound='1';captureButton.addEventListener('click',captureEnrollmentSample);
  }
  window.TIPONLiveness={version:'5.5.40',challenge,advance};
})();
