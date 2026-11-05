/* TIPON Face Attendance: enrollment and optional liveness diagnostics.
 * Enrollment is three automatic detected face frames, without blink verification.
 * This is NOT presentation attack detection; a photograph could be spoofed.
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
  function makeChallenge(order){
    return {order:order.slice(),step:0,started:Date.now(),stepStarted:Date.now(),
      openRatio:0,openFrames:0,closed:false,closedAt:0,
      baseYaw:null,yawFrames:0,passed:false};
  }
  // Legacy blink challenge helpers remain for diagnostics only, not enrollment.
  function challenge(){return makeChallenge(['blink']);}
  function blinkChallenge(){return makeChallenge(['blink']);}
  function prompt(s){
    return s.order[s.step]==='blink'?
      'Blink once: close both eyes briefly, then open.':
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
        return {ok:false,prompt:'Blink once: close both eyes briefly, then open.'};
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
  // Attendance scanning continues in app.js; enrollment intentionally has no
  // blink/head-turn gate. A trained User's explicit Enroll Face action and the
  // consent record authorize this local three-frame biometric enrollment.
  const ENROLL_SAMPLE_INTERVAL_MS=320;
  const originalBeginEnrollment=beginEnrollment;
  beginEnrollment=async function(...args){
    state.enrollFaceMissing=0;
    state.enrollConflictMemberId='';
    state.enrollCaptureBusy=false;
    state.enrollLastCapturedAt=0;
    state.enrollCollected=[];
    const status=$('captureEnrollmentSample');
    if(status){status.disabled=true;status.hidden=true;}
    return originalBeginEnrollment(...args);
  };
  async function autoCaptureEnrollmentSample(descriptor,run){
    if(!state.enrollActive||state.enrollRun!==run||state.enrollCaptureBusy||
       state.enrollConflictMemberId||!Array.isArray(descriptor)||
       descriptor.length!==128||descriptor.some(value=>!Number.isFinite(value)))return false;
    const now=Date.now();
    if(state.enrollCollected.length&&now-(state.enrollLastCapturedAt||0)<ENROLL_SAMPLE_INTERVAL_MS)return false;
    state.enrollCaptureBusy=true;
    try{
      // Check every accepted sample against other enrolled members; do not
      // repeat expensive matching on frames that are not used as samples.
      const memberId=enrollmentMemberKey();
      const conflict=findEnrolledFaceConflict([descriptor],memberId);
      if(conflict){
        state.enrollConflictMemberId=String(conflict.member?.id||'unknown');
        setText('enrollStatus',duplicateFaceNotice(conflict));
        if($('retryEnrollment'))$('retryEnrollment').hidden=false;
        return false;
      }
      const first=state.enrollCollected[0];
      if(first&&euclidean(first,descriptor)>.50){
        // A new face entered mid-enrollment; never combine two identities.
        state.enrollCollected=[];state.enrollLastCapturedAt=0;
        setText('enrollCount','0 / 3 samples');
        $('enrollProgress').style.width='0%';
        setText('enrollStatus','Different face detected. Keep only the same member in the frame. Restarting automatic capture.');
        return false;
      }
      if(!state.enrollActive||state.enrollRun!==run)return false;
      state.enrollCollected.push(descriptor.slice());
      state.enrollLastCapturedAt=now;
      const count=state.enrollCollected.length;
      setText('enrollCount',count+' / 3 samples');
      $('enrollProgress').style.width=count/3*100+'%';
      if(count<3){
        setText('enrollStatus','Sample '+count+' of 3 captured. Keep your face centered; next sample is automatic.');
        return true;
      }
      const finalConflict=findEnrolledFaceConflict(state.enrollCollected,memberId);
      if(finalConflict){
        state.enrollCollected=[];state.enrollConflictMemberId=String(finalConflict.member?.id||'unknown');
        setText('enrollCount','0 / 3 samples');$('enrollProgress').style.width='0%';
        setText('enrollStatus',duplicateFaceNotice(finalConflict));
        if($('retryEnrollment'))$('retryEnrollment').hidden=false;
        return false;
      }
      state.pendingDescriptors=state.enrollCollected.map(vector=>vector.slice());
      state.faceReplacementPending=!!state.editMember?.template;
      state.enrollmentProof={memberId,at:Date.now()};
      setText('enrollFaceLabel','Verified · 3 Face Samples Ready');
      setText('enrollStatus','Three face samples captured automatically. Save the member record.');
      playTerminalSound('success');
      showToast('Three face samples captured. Save the member record.','success');
      const autoSave=!!state.editMember;
      await finishEnrollment(false);
      if(autoSave)await saveMemberForm({preventDefault(){}});
      return true;
    }finally{
      state.enrollCaptureBusy=false;
    }
  }
  enrollTick=async function(){
    if(!state.enrollActive)return;
    const run=state.enrollRun;
    try{
      const video=$('enrollVideo');
      if(video?.readyState>=2&&!state.enrollCaptureBusy&&!state.enrollConflictMemberId){
        const faces=await detectFaces(video);
        if(!state.enrollActive||state.enrollRun!==run)return;
        if(faces.length!==1){
          state.enrollFaceMissing=(state.enrollFaceMissing||0)+1;
          setText('enrollStatus',faces.length?
            'Only one face may be visible for enrollment.':
            'Position one face clearly in the frame; capture starts automatically.');
        }else{
          state.enrollFaceMissing=0;
          const descriptor=Array.from(faces[0].descriptor||[]);
          if(descriptor.length!==128||descriptor.some(value=>!Number.isFinite(value))){
            setText('enrollStatus','Face data is unclear. Face the camera in better lighting.');
          }else{
            await autoCaptureEnrollmentSample(descriptor,run);
          }
        }
      }
    }catch(error){
      console.error('Face enrollment auto capture',error);
      setText('enrollStatus','Automatic face capture error: '+String(error.message||error));
      if($('retryEnrollment'))$('retryEnrollment').hidden=false;
    }
    if(state.enrollActive&&state.enrollRun===run)
      state.enrollTimer=setTimeout(enrollTick,80);
  };
  window.TIPONLiveness={version:'5.5.97',challenge,blinkChallenge,advance};
})();
