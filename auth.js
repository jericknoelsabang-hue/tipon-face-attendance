/* TIPON v5 account login and password-encrypted offline access.
 * A device must sign in online once. New registrations require online approval.
 * Offline account revocation cannot be instantaneous; lease: 7 days.
 */
'use strict';
window.TIPONAuth=(()=>{
  let session=null,signing=false,registrationGpsAccuracy=null;
  const INACTIVITY_MS=90*1000;
  let idleSignoutRunning=false,lastActivityPersist=0,activityPersistTimer=null;
  function inactivityExceeded(value,now=Date.now()){
    const last=Number(value?.lastActivityAt||0);
    return !last||!Number.isFinite(last)||last>now+300000||now-last>=INACTIVITY_MS;
  }
  function persistRecentActivity(){
    if(activityPersistTimer||!session)return;
    activityPersistTimer=setTimeout(async()=>{
      activityPersistTimer=null;
      if(session)await persistSession(session);
    },1800);
  }
  function touchActivity(event){
    if(!session||idleSignoutRunning)return;
    if(event?.isTrusted===false)return;
    const now=Date.now();
    if(inactivityExceeded(session,now)){void checkIdleSession();return;}
    session.lastActivityAt=now;
    if(now-lastActivityPersist>=7000){lastActivityPersist=now;persistRecentActivity();}
  }
  async function checkIdleSession(){
    if(!session||idleSignoutRunning||!inactivityExceeded(session))return false;
    idleSignoutRunning=true;
    try{await signOut('idle');return true;}
    finally{idleSignoutRunning=false;}
  }
  const enc=new TextEncoder(),dec=new TextDecoder();
  const hex=a=>Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');
  const unhex=s=>new Uint8Array(s.match(/.{2}/g).map(v=>parseInt(v,16)));
  const randomSalt=()=>hex(crypto.getRandomValues(new Uint8Array(16)));
  async function proof(password,salt){return hex(await deriveBytes(password,unhex(salt),TIPONOrgCore.PBKDF2_ITERATIONS));}
  async function aesKey(raw){return crypto.subtle.importKey('raw',unhex(raw),{name:'AES-GCM'},false,['encrypt','decrypt']);}
  async function seal(value,keyHex,aad=''){
    const key=await aesKey(keyHex),iv=crypto.getRandomValues(new Uint8Array(12));
    const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,enc.encode(JSON.stringify(value)));
    return {alg:'AES-GCM',iv:b64(iv),data:b64(new Uint8Array(bytes))};
  }
  async function unseal(data,keyHex,aad=''){
    const key=await aesKey(keyHex),bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(data.iv),additionalData:enc.encode(aad)},key,fromB64(data.data));return JSON.parse(dec.decode(bytes));
  }
  async function vaultKey(proofHex){const bytes=await crypto.subtle.digest('SHA-256',enc.encode('TIPON-offline-vault-v5|'+proofHex));return hex(new Uint8Array(bytes));}
  const vaultId=user=>'tp5-auth:'+TIPONOrgCore.userKey(user);
  async function remember(s,salt){
    const id=vaultId(s.account.username),value={account:s.account,orgId:s.orgId,faceKey:s.faceKey,offlineUntil:s.offlineUntil,verifiedAt:Date.now()};
    await saveOne('users',{id,username:s.account.username,salt,iterations:TIPONOrgCore.PBKDF2_ITERATIONS,vault:await seal(value,await vaultKey(s.proof),id)});
  }
  const SESSION_KEY_ID='tp5-persist-session-key-v1',SESSION_DATA_ID='tp5-persist-session-v1';
  async function persistSession(value=session){
    if(!value)return;
    try{
      let record=await getOne('meta',SESSION_KEY_ID),key=record?.key;
      if(!key){key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await saveOne('meta',{id:SESSION_KEY_ID,key});}
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(value)));
      await saveOne('meta',{id:SESSION_DATA_ID,iv:b64(iv),data:b64(new Uint8Array(encrypted))});
    }catch(error){console.warn('Could not persist the signed-in session on this device.',error);}
  }
  async function clearPersistedSession(){try{await deleteOne('meta',SESSION_DATA_ID);}catch(error){console.warn('Could not clear saved session.',error);}}
  async function restoreSession(){
    try{
      const [saved,keyRecord]=await Promise.all([getOne('meta',SESSION_DATA_ID),getOne('meta',SESSION_KEY_ID)]);
      if(!saved||!keyRecord?.key)return null;
      const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(saved.iv)},keyRecord.key,fromB64(saved.data));
      const value=JSON.parse(dec.decode(bytes));
      if(!value.account?.id||!value.orgId||!Number.isFinite(Number(value.offlineUntil))||Number(value.offlineUntil)<Date.now()||Date.now()<Number(value.verifiedAt||0)-300000||inactivityExceeded(value)){await clearPersistedSession();return null;}
      return value;
    }catch(error){console.warn('Saved session could not be restored.',error);await clearPersistedSession();return null;}
  }
  async function signedIn(value,{freshLogin=false}={}){
    // Restored sessions have already passed the persisted inactivity check.
    // Freshly authenticated interaction begins a new 90-second activity window.
    session={...value,lastActivityAt:Date.now()};
    lastActivityPersist=Date.now();
    state.user=session.account;state.orgId=session.orgId;
    const kioskOnly=value.account?.role==='kiosk';
    document.body.classList.toggle('kiosk-mode',kioskOnly);
    await persistSession(session);$('loginPage').hidden=true;try{await enterApp({freshLogin});TIPONSync.start();}catch(e){session=null;state.user=null;await clearPersistedSession();document.body.dataset.terminalAccess='denied';document.body.classList.remove('kiosk-mode');$('appShell').hidden=true;$('mobileNav').hidden=true;$('loginPage').hidden=false;throw e;}
  }
  function status(text,bad=false){setText('loginStatus',text);$('loginStatus').classList.toggle('danger',bad);}
  async function login(event){
    event?.preventDefault();if(signing)return;signing=true;$('loginSubmit').disabled=true;status('Checking account...');
    const username=$('loginUsername').value.trim(),password=$('loginPassword').value;
    try{
      const cached=await getOne('users',vaultId(username));let current;
      if(navigator.onLine){
        try{
          const challenge=await TIPONAPI.raw({action:'challenge',username});
          const derived=await proof(password,challenge.salt);
          const reply=await TIPONAPI.raw({action:'login',username,proof:derived});
          current={...reply,proof:derived,salt:challenge.salt,onlineVerified:true};await remember(current,challenge.salt);
        }catch(err){
          if(!['NETWORK','TIMEOUT','GATEWAY_OFFLINE'].includes(err.code)||!cached)throw err;
        }
      }
      if(!current){
        if(!cached)throw Error('First sign-in on this device needs internet and an approved account.');
        const derived=await proof(password,cached.salt);let restored;
        try{restored=await unseal(cached.vault,await vaultKey(derived),cached.id);}catch{throw Error('Incorrect username or password for this offline account.');}
        if(restored.offlineUntil<Date.now())throw Error('Offline access expired. Connect and sign in online again.');
        if(Date.now()<restored.verifiedAt-300000)throw Error('Device clock moved backwards. Correct the clock before signing in.');
        current={...restored,proof:derived,salt:cached.salt,token:null,onlineVerified:false};
      }
      $('loginPassword').value='';await signedIn(current,{freshLogin:true});status('');
    }catch(err){status(err.message,true);}finally{signing=false;$('loginSubmit').disabled=false;}
  }
  async function register(event){
    event.preventDefault();if(!navigator.onLine){showToast('Registration requires internet. Approved users can work offline after first sign-in.','error');return;}
    const button=$('registerSubmit');button.disabled=true;
    try{
      const password=$('registerPassword').value,accountType=$('registerAccountType').value;
      if(password.length<8||password.length>128)throw Error('Use 8 to 128 password characters. No special-character or uppercase rule.');
      const profile=TIPONOrgCore.profile({username:$('registerUsername').value,name:$('registerName').value,position:$('registerPosition').value,email:$('registerEmail').value,coop:$('registerCoop').value,platform:$('registerPlatform').value,office:$('registerOffice').value,accountType,officeLat:$('registerOfficeLat').value,officeLng:$('registerOfficeLng').value,gpsAccuracy:registrationGpsAccuracy});
      const salt=randomSalt(),derived=await proof(password,salt);
      const reply=await TIPONAPI.raw({action:'register',profile,salt,proof:derived});
      $('registerPassword').value='';$('registrationDialog').close();status(reply.message);showToast(reply.message,'success',8000);
    }catch(err){setText('registrationStatus',err.message);showToast(err.message,'error');}finally{button.disabled=false;}
  }
  async function ensureOnline(){
    if(!session)throw Object.assign(Error('Sign in to continue.'),{code:'AUTH'});
    if(session.offlineUntil<Date.now())throw Object.assign(Error('Offline lease expired. Sign in online again.'),{code:'AUTH'});
    if(session.token&&(!session.expiresAt||session.expiresAt>Date.now()+30000))return session.token;
    if(!session.proof)throw Object.assign(Error('Online sign-in is required.'),{code:'AUTH'});
    const reply=await TIPONAPI.raw({action:'login',username:session.account.username,proof:session.proof});
    session={...session,...reply,onlineVerified:true};state.user=session.account;state.orgId=session.orgId;applyRoles();await remember(session,session.salt);await persistSession(session);return session.token;
  }
  async function signOut(reason='manual'){
    if(!session)return;
    const old=session;TIPONSync.stop();
    if(activityPersistTimer){clearTimeout(activityPersistTimer);activityPersistTimer=null;}
    await stopScanner();await stopEnrollment();
    session=null;await clearPersistedSession();state.user=null;document.body.dataset.terminalAccess='denied';state.platforms=[];state.members=[];state.sites=[];state.punches=[];state.accounts=[];state.devices=[];state.reviews=[];state.schedules=[];
    ['recordRows','mpcOverviewCards','mpcRows','presenceRows','summaryRows','accountRows','deviceRows','reviewRows','memberRows','siteCards'].forEach(id=>{if($(id))$(id).innerHTML='';});
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    $('appShell').hidden=true;$('mobileNav').hidden=true;$('loginPage').hidden=false;document.body.classList.remove('kiosk-mode');
    $('loginPassword').value='';
    status(reason==='idle'
      ?'Signed out automatically after 90 seconds of inactivity. Local attendance and pending uploads were retained.'
      :'Signed out. Local records and pending uploads were retained.');
    // Best-effort server revocation. No unencrypted session token is left in browser storage.
    if(old?.token&&navigator.onLine)TIPONAPI.raw({action:'logout',token:old.token}).catch(()=>{});
  }
  async function changePassword(event){
    event.preventDefault();const button=$('changePasswordSubmit');button.disabled=true;
    try{const next=$('newPassword').value;if(next.length<8||next.length>128)throw Error('Use 8 to 128 characters. No composition rules.');
      const challenge=await TIPONAPI.raw({action:'challenge',username:session.account.username});
      const currentProof=await proof($('currentPassword').value,challenge.salt),salt=randomSalt(),derived=await proof(next,salt);
      await TIPONAPI.call({action:'password',currentProof,proof:derived,salt});
      await deleteOne('users',vaultId(session.account.username));$('currentPassword').value='';$('newPassword').value='';await signOut();status('Password changed. Sign in with the new password.');
    }catch(err){showToast(err.message,'error');}finally{button.disabled=false;}
  }
  function updateRegistrationFields(){
    const kiosk=$('registerAccountType').value==='kiosk';
    document.querySelectorAll('[data-registration-user-only]').forEach(section=>{
      section.hidden=kiosk;
      section.querySelectorAll('input,select,textarea').forEach(input=>{input.required=!kiosk;input.disabled=kiosk;});
    });
    // The kiosk has its own GPS authorization; it must not inherit User MPC/BP values.
    if(kiosk){$('registerCoop').value='';$('registerPlatform').value='';}
    document.querySelectorAll('[data-registration-kiosk-only]').forEach(el=>{el.hidden=!kiosk;el.querySelectorAll('input').forEach(input=>input.required=kiosk);});
    setText('registrationStatus',kiosk?'Physical Kiosk needs accurate GPS at a configured work location.':'User registration requires only approved account details.');
  }
  async function init(){
    $('appShell').hidden=true;$('mobileNav').hidden=true;$('loginPage').hidden=true;
    attach('loginForm','submit',login);attach('openRegistration','click',()=>{$('registrationForm').reset();registrationGpsAccuracy=null;updateRegistrationFields();TIPONPlatforms.render();setText('registrationStatus','');$('registrationDialog').showModal();TIPONPlatforms.refresh().catch(()=>{});});
    attach('registrationForm','submit',register);attach('registerAccountType','change',updateRegistrationFields);updateRegistrationFields();attach('registerUseGps','click',()=>{if(!navigator.geolocation){setText('registrationStatus','GPS is not available on this device.');return;}setText('registrationStatus','Getting current kiosk GPS...');navigator.geolocation.getCurrentPosition(p=>{$('registerOfficeLat').value=p.coords.latitude.toFixed(7);$('registerOfficeLng').value=p.coords.longitude.toFixed(7);registrationGpsAccuracy=p.coords.accuracy;setText('registrationStatus','Kiosk GPS captured. Accuracy '+Math.round(p.coords.accuracy)+' m.');},e=>setText('registrationStatus',e.message),{enableHighAccuracy:true,timeout:15000,maximumAge:0});});attach('logoutButton','click',signOut);attach('logoutMobile','click',signOut);attach('changePasswordForm','submit',changePassword);
    attach('showPassword','click',()=>{$('loginPassword').type=$('loginPassword').type==='password'?'text':'password';});
    attach('authDiagnostics','click',async()=>{status('Checking organization connection...');try{const r=await TIPONAPI.raw({action:'health'});status('Connected to TIPON Face');}catch(e){status(e.message,true);}});
    const restored=await restoreSession();if(restored){try{await signedIn(restored,{freshLogin:false});status('');return;}catch(error){console.warn('Could not resume the saved session.',error);}}
    $('appShell').hidden=true;$('mobileNav').hidden=true;$('loginPage').hidden=false;
  }
  const originalInit=init;init=async function(){
    await originalInit();
    // Only actual user interactions extend the login session.
    // Camera frames, synchronization, and background refreshes do not extend it.
    for(const type of ['pointerdown','keydown','touchstart','wheel','scroll']){
      document.addEventListener(type,touchActivity,{capture:true,passive:true});
    }
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){
        if(session)void persistSession(session);
      }else void checkIdleSession();
    });
    window.addEventListener('focus',()=>{void checkIdleSession();});
    setInterval(()=>{
      if(!session)return;
      if(session.offlineUntil<Date.now()){
        void signOut('expired').then(()=>status('Access lease expired. Sign in online again.',true));
        return;
      }
      void checkIdleSession();
    },2000);
  };
  return {init,login,signOut,ensureOnline,current:()=>session,seal,unseal,randomSalt,proof,touchActivity,checkIdleSession,inactivityExceeded};
})();
