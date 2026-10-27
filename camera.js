/* TIPON camera preferences. Device-local only; never sent to the server. */
'use strict';
window.TIPONCamera=(()=>{
  let preferences={scan:'environment',enroll:'environment'},devices=[],actual={},switching=false;
  const ids={scan:'scanCameraChoice',enroll:'enrollCameraChoice'};
  const friendly=value=>value==='user'?'Front camera':value==='environment'?'Back camera':'Selected camera';
  const supported=value=>value==='user'||value==='environment'||(typeof value==='string'&&value.startsWith('device:')&&value.length>7);
  async function init(){
    const stored=await getOne('meta','tp51-camera-preferences');
    for(const context of ['scan','enroll'])if(supported(stored?.[context]))preferences[context]=stored[context];
    try{devices=(await navigator.mediaDevices?.enumerateDevices?.()||[]).filter(d=>d.kind==='videoinput'&&d.deviceId);}catch{}
    render();
  }
  function label(context){return actual[context]?.label||friendly(preferences[context]);}
  function render(){
    for(const context of ['scan','enroll']){
      const select=$(ids[context]);if(!select)continue;
      const options=[{value:'environment',label:'Back camera'},{value:'user',label:'Front camera'},...devices.map((d,i)=>({value:'device:'+d.deviceId,label:d.label||'Camera '+(i+1)}))];
      if(!options.some(o=>o.value===preferences[context]))options.push({value:preferences[context],label:'Previously selected camera'});
      const html=options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
      if(select.innerHTML!==html)select.innerHTML=html;
      select.value=preferences[context];select.disabled=switching;
    }
  }
  async function setChoice(context,value){
    if(!['scan','enroll'].includes(context)||!supported(value))throw Error('Choose front, back or a listed camera.');
    preferences[context]=value;delete actual[context];render();
    await OrgDB.rawSave('meta',{id:'tp51-camera-preferences',...preferences});
  }
  async function open(context){
    if(!['scan','enroll'].includes(context))throw Error('Unknown camera operation.');
    if(context==='enroll'&&!canEdit())throw Error('An authorized enrollment account is required.');
    if(context==='scan'&&!hasTerminalSession())throw Error('Use an approved user account for the Face Terminal. Administrator enrollment remains available.');
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access requires HTTPS or localhost.');
    try{devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);render();}catch{}
    const choice=preferences[context]||'environment';
    const base={width:{ideal:640},height:{ideal:480},frameRate:{ideal:15,max:30}};
    const exact=choice.startsWith('device:')?{deviceId:{exact:choice.slice(7)}}:{facingMode:{exact:choice}};
    let stream,fallback=false;
    try{
      try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...base,...exact}});}
      catch(error){
        if(!['OverconstrainedError','NotFoundError'].includes(error.name))throw error;
        // Desktop/USB cameras often have no facingMode. Show the real result;
        // never claim that a front camera is the back camera.
        fallback=true;stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...base,...(!choice.startsWith('device:')?{facingMode:{ideal:choice}}:{})}});
      }
      if(context==='scan'&&!hasTerminalSession())throw Error('The attendance session changed. Sign in as an approved user and try again.');
      const track=stream.getVideoTracks()[0];if(!track)throw Error('No video camera is available.');
      const facing=track.getSettings?.().facingMode;
      const name=facing==='user'?'Front camera':facing==='environment'?'Back camera':track.label||'Device camera';
      actual[context]={facing,label:name};
      const video=$(context==='scan'?'scanVideo':'enrollVideo');if(video)video.classList.toggle('front-camera-preview',facing==='user');
      setText(context==='scan'?'scanCameraInfo':'enrollCameraInfo',(fallback?'Requested camera unavailable; using ':'Using ')+name+(context==='enroll'?'. Three automatic samples.':'.'));
      if(fallback)showToast('Requested camera was unavailable. Using '+name+'. You can choose another listed camera.','info',6500);
      try{devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);}catch{}
      render();return stream;
    }catch(error){
      stream?.getTracks().forEach(t=>t.stop());
      const message=error.name==='NotAllowedError'?'Allow camera permission for this website in your browser settings.':error.name==='NotReadableError'?'Camera is busy. Close the other camera app or browser tab and retry.':error.name==='NotFoundError'?'No camera found. Connect a camera or use a phone/tablet.':error.message;
      throw Error(message);
    }
  }
  async function change(context,value){
    if(switching)return;
    if(context==='scan'&&state.scanBusy){render();showToast('Finish the current camera/GPS check before changing camera.','info');return;}
    switching=true;render();
    try{
      const running=context==='scan'?state.scanning:state.enrollActive;
      if(context==='scan')await stopScanner();else if(running)await stopEnrollment(true);
      await setChoice(context,value);
      if(running){if(context==='scan')await startScanner();else await beginEnrollment();}
    }catch(e){toastError(e,'Camera selection');}finally{switching=false;render();}
  }
  function bind(){
    document.addEventListener('fullscreenchange',()=>document.body.classList.toggle('terminal-fullscreen',!!document.fullscreenElement));
    attach('scanCameraChoice','change',e=>change('scan',e.target.value));
    attach('enrollCameraChoice','change',e=>change('enroll',e.target.value));
    attach('kioskExit','click',()=>TIPONAuth.signOut());
    attach('kioskFullscreen','click',async()=>{
      try{if(document.fullscreenElement){await document.exitFullscreen();return;}
        if(!document.documentElement.requestFullscreen)throw Error('Full screen is not available in this browser. The kiosk still works in the normal window.');
        await document.documentElement.requestFullscreen();
      }catch(e){showToast(e.message,'info');}
    });
  }
  return {init,bind,open,setChoice,render,label,change};
})();
