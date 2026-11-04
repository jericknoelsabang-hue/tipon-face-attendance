/* Safe shell updater. No IndexedDB, storage reset, authentication or member APIs. */
'use strict';
(()=>{
 const el=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 function status(message,level=''){el('status').textContent=message;el('status').className='status '+level;}
 async function releaseOf(worker){
  if(!worker)return null;
  return new Promise(resolve=>{
   const channel=new MessageChannel();let done=false;
   const finish=value=>{if(done)return;done=true;clearTimeout(timer);channel.port1.close();resolve(value);};
   const timer=setTimeout(()=>finish(null),650);
   channel.port1.onmessage=event=>finish(typeof event.data?.version==='string'?event.data.version:null);
   try{worker.postMessage({type:'TIPON_RELEASE'},[channel.port2]);}catch{finish(null);}
  });
 }
 async function run(){
  el('apply').disabled=true;
  try{
   if(!window.isSecureContext||!('serviceWorker' in navigator))throw Error('Open the HTTPS attendance website in Chrome, Edge or Safari. Do not open this file from Downloads.');
   if(!navigator.onLine)throw Error('Connect to the internet first. Saved offline attendance is unchanged.');
   status('Checking the version published on this website...');
   const control=new AbortController(),timeout=setTimeout(()=>control.abort(),12000);let response;
   try{response=await fetch('./release.json?check='+Date.now(),{cache:'no-store',signal:control.signal});}finally{clearTimeout(timeout);}
   if(!response.ok)throw Error('The update is not published here yet (HTTP '+response.status+'). Commit the new docs/ files and confirm GitHub Pages finished publishing.');
   let release;try{release=await response.json();}catch{throw Error('release.json is not the expected file. Check the GitHub docs/ folder and GitHub Pages deployment.');}
   if(release.app!=='TIPON Face Attendance'||typeof release.version!=='string')throw Error('Unexpected release information. No data was changed.');
   el('published').textContent=release.version;
   const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
   await registration.update();
   status('Loading published application files. Do not clear app data.');
   const deadline=Date.now()+25000;let active=null;
   while(Date.now()<deadline){
    if(registration.waiting)registration.waiting.postMessage({type:'TIPON_APPLY_UPDATE'});
    active=await releaseOf(registration.active);
    el('activeVersion').textContent=active||'Previous version / updating';
    if(active===release.version&&registration.active?.state==='activated')break;
    await sleep(250);
   }
   if(active!==release.version)throw Error('Published '+release.version+' but the offline app did not activate it. Close all other TIPON windows, reopen this page and retry. Keep saved app data.');
   status('Update '+active+' is active. Click Open attendance app, then sign in. Admin remains approval/management only; User has Face Terminal; Physical Kiosk opens Face Terminal only. Front/Back camera selection is retained.','success');
   el('openApp').href='./?updated='+encodeURIComponent(active);
  }catch(error){status(error.name==='AbortError'?'The version check timed out. Check the internet and retry. Saved records are unchanged.':error.message,'error');}
  finally{el('apply').disabled=false;}
 }
 el('apply').addEventListener('click',run);
})();
