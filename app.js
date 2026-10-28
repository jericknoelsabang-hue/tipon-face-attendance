/* TIPON Face Attendance — Offline-first pilot PWA.
 * This is an independent app, not the original chatgpt.site deployment.
 * Local face matching with encrypted template synchronization in v5; NOT tamper-proof payroll security.
 */
'use strict';
const $ = (id) => document.getElementById(id);
const FACE_SCRIPT = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const MODEL_ROOT = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
const MODEL_FILES = [
  'tiny_face_detector_model-weights_manifest.json','tiny_face_detector_model-shard1',
  'face_landmark_68_tiny_model-weights_manifest.json','face_landmark_68_tiny_model-shard1',
  'face_recognition_model-weights_manifest.json','face_recognition_model-shard1','face_recognition_model-shard2'
];
const OFFLINE_ASSETS = [FACE_SCRIPT, ...MODEL_FILES.map((f)=>`${MODEL_ROOT}/${f}`)];
const REMOTE_CACHE = 'tipon-face-remote-v1';
const DB_NAME='tipon-face-local-v1';
const DB_STORE=['users','members','sites','punches','meta','outbox','offices','schedules'];
const MATCH_LIMIT=.60;
const AMBIGUITY_GAP=.035;
const SCAN_DELAY_MS=650;
const COOLDOWN_MS=90000;
const GPS_MIN_RADIUS=20;
const GPS_MAX_ACCURACY=80;
const PH_TIMEZONE='Asia/Manila';
let db;
const state={ user:null, page:'dashboard', members:[], sites:[], users:[], punches:[], facePromise:null, modelReady:false,
  scanStream:null, scanTimer:null, scanMode:'in', scanning:false, scanBusy:false, scanCandidate:null,
  scanCandidateCount:0, scanArmed:true, scanAbsentCount:0, lastRecognized:null, lastGPS:null,
  enrollStream:null, enrollTimer:null, enrollActive:false, gpsWatchId:null, pendingDescriptors:[], editMember:null, editSite:null,
  installPrompt:null, offlineReady:false, confirmResolver:null, deviceId:null, offices:[] };

function uuid(){return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function esc(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function roleName(role){return {admin:'Administrator',supervisor:'Member Supervisor',processor:'Processor'}[role]||'Staff';}
function initial(name){return String(name??'?').trim().slice(0,1).toUpperCase()||'?';}
function pad(v){return String(v).padStart(2,'0');}
function todayPH(value=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:PH_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function displayTime(value){return new Date(value).toLocaleTimeString('en-PH',{timeZone:PH_TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:true});}
function displayDate(value){return new Date(value).toLocaleDateString('en-PH',{timeZone:PH_TIMEZONE,month:'short',day:'numeric',year:'numeric'});}
function displayStamp(value){return `${displayDate(value)} · ${displayTime(value)}`;}
function distanceM(a,b,c,d){const R=6371000,rad=Math.PI/180,dl=(c-a)*rad,dn=(d-b)*rad,h=Math.sin(dl/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));}
function canEdit(){return state.user?.role==='registrar'&&window.TIPONAuth?.current()?.offlineUntil>Date.now();}
function isAdmin(){return state.user?.role==='admin';}
// A screen role alone is insufficient: the current authenticated lease must
// match the displayed account. Enrollment uses canEdit(), not this guard.
function hasTerminalSession(){
 const session=window.TIPONAuth?.current(),u=state.user;
 return !!session&&TIPONOrgCore.canUseTerminal(u)&&
   session.account?.id===u.id&&session.account?.role===u.role&&
   session.orgId===state.orgId&&Number(session.offlineUntil)>Date.now();
}
function prettyMeter(m){return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(2)} km`;}
function safeFilename(v){return String(v).replace(/[^A-Za-z0-9_-]/g,'_');}
function setText(id,text){if($(id))$(id).textContent=text;}
function showToast(message,level='info',ms=5200){const e=document.createElement('div');e.className=`toast ${level}`;e.textContent=message;while($('toastStack').children.length>=3)$('toastStack').firstElementChild.remove();$('toastStack').append(e);setTimeout(()=>e.remove(),ms);}
function toastError(err,prefix='Error'){console.error(prefix,err);showToast(`${prefix}: ${err?.message||String(err)}`,'error',8500);}
function downloadBlob(name,blob){const a=document.createElement('a');const u=URL.createObjectURL(blob);a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),15000);}
function pageIcon(name){return `<svg class="icon"><use href="#i-${name}"/></svg>`;}
function attach(id,event,fn){const el=$(id);if(el)el.addEventListener(event,fn);}

function openDB(){return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB_NAME,2);
  r.onupgradeneeded=()=>{const d=r.result;for(const name of DB_STORE)if(!d.objectStoreNames.contains(name)){const store=d.createObjectStore(name,{keyPath:'id'});if(name==='punches')store.createIndex('timestamp','timestamp');}};
  r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close every other TIPON tab/app window on this device, then reopen. Do not clear stored data.'));
});}
function getAll(store){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const request=tx.objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function getOne(store,key){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const request=tx.objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function saveOne(store,data){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(data);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function deleteOne(store,key){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function replaceDB(data){return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readwrite');for(const store of DB_STORE){const object=tx.objectStore(store);object.clear();for(const item of data[store]||[])object.put(item);}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
async function loadCollections(){const [members,sites,punches,users]=await Promise.all(['members','sites','punches','users'].map(getAll));Object.assign(state,{members,sites,punches:punches.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)),users});}

function b64(bytes){let output='';for(let i=0;i<bytes.length;i+=16384)output+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(output);}
function fromB64(s){return Uint8Array.from(atob(s),(c)=>c.charCodeAt(0));}
async function deriveBytes(password,salt,iterations=190000,bits=256){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,bits));
}




async function enterApp(options={}){
  if(typeof TIPONWorkspaceEnter!=='function')throw Error('Workspace module is unavailable. Reload the app files.');
  return TIPONWorkspaceEnter(options);
}
function applyRoles(){document.querySelectorAll('[data-roles]').forEach(el=>el.hidden=true);}
function refreshClock(){const now=new Date();setText('liveDateTime',now.toLocaleString('en-PH',{timeZone:PH_TIMEZONE,weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));setText('bigDate',now.toLocaleDateString('en-PH',{timeZone:PH_TIMEZONE,weekday:'long',month:'short',day:'numeric',year:'numeric'}));const connected=navigator.onLine;setText('connectionText',connected?'Online / local storage':'Offline / local storage');setText('headerOnlineText',connected?'Network online':state.offlineReady?'Offline ready':'Offline / setup needed');$('onlineDot').className=`status-dot ${connected?'success':'offline'}`;$('headerOnlineDot').className=`status-dot ${connected?'success':'offline'}`;}

const pageNames={dashboard:'Dashboard',scanner:'Face Terminal',terminalLogs:'Attendance Logs',members:'Member List',sites:'Work Locations',records:'Attendance Logs',settings:'Settings & Offline',adminSites:'Work Locations List'};

function validateAttendanceDateRange(fromId,toId,errorId,actionId=''){
 const fromField=$(fromId),toField=$(toId),error=$(errorId);
 if(!fromField||!toField)return true;
 const invalid=!!(fromField.value&&toField.value&&toField.value<fromField.value);
 toField.min=fromField.value||'';
 fromField.setAttribute('aria-invalid',String(invalid));
 toField.setAttribute('aria-invalid',String(invalid));
 if(error){error.hidden=!invalid;error.textContent=invalid?'To Date cannot be earlier than From Date. Select a valid date range to apply filters.':'';}
 if(actionId&&$(actionId))$(actionId).disabled=invalid;
 return !invalid;
}

async function showPage(page){
  if(!pageNames[page])return;
  if((page==='members'&&!canEdit()&&!isAdmin())||(page==='sites'&&!canEdit())||(page==='adminSites'&&!isAdmin()))return;
  
  if(state.page==='scanner'&&page!=='scanner')await stopScanner();
  state.page=page;
  document.querySelectorAll('.page').forEach(section=>section.hidden=section.id!==`page-${page}`);
  document.querySelectorAll('[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  setText('crumbTitle',pageNames[page]);window.scrollTo({top:0,behavior:'instant'});
  if(page==='adminSites'){window.TIPONAdminSites?.render();}if(page==='dashboard')renderDashboard();if(page==='scanner'){renderTerminal();if(!state.scanning)startScanner();}if(page==='terminalLogs')renderTerminalLogs();if(page==='members')renderMembers();if(page==='sites'){renderSites();if(typeof renderOfficeDirectory==='function')renderOfficeDirectory();}if(page==='records')renderRecords();if(page==='settings')await checkOfflineReady();
}
function renderDashboard(){const today=todayPH();const todayPunches=state.punches.filter(e=>e.day===today&&!e.reviewStatus);const present=new Set(todayPunches.filter(e=>e.type==='IN').map(e=>e.memberId));
 setText('metricMembers',state.members.length);setText('metricPresent',present.size);setText('metricPunches',todayPunches.length);setText('metricSites',state.sites.length);
 $('recentList').innerHTML=state.punches.length?state.punches.slice(0,5).map(e=>`<div class="recent-item"><div class="initial-avatar">${esc(initial(e.memberName))}</div><div class="desc"><b>${esc(e.memberName)}</b><small>${esc(e.siteName)}</small></div><div><time>${esc(displayTime(e.timestamp))}</time><span class="badge ${e.type==='IN'?'green':'amber'}">TIME ${e.type}</span></div></div>`).join(''):`<div class="empty-state">${pageIcon('clock')}No attendance recorded yet.</div>`;
 const ready=[['Work locations',state.sites.length>0,`${state.sites.length} configured`],['Member facial enrollment',state.members.some(m=>m.active!==false&&!m.deleted&&m.descriptors?.length>=3),`${state.members.filter(m=>m.active!==false&&!m.deleted&&m.descriptors?.length>=3).length} enrolled`],['Offline AI resources',state.offlineReady,state.offlineReady?'Downloaded':'Setup required'],['Attendance stored locally',true,'Device-local database']];
 $('readinessList').innerHTML=ready.map(([label,ok,sub])=>`<div class="readiness-row"><span class="readiness-icon ${ok?'':'warn'}">${pageIcon(ok?'check':'alert')}</span><div class="desc"><b>${esc(label)}</b><small>${esc(sub)}</small></div></div>`).join('');
}
function renderTerminal(){const d=state.lastGPS;
  setText('currentLat',d?d.latitude.toFixed(6):'—');setText('currentLng',d?d.longitude.toFixed(6):'—');setText('currentAccuracy',d?`${Math.round(d.accuracy)} m`:'—');setText('currentGpsTime',d?displayTime(d.timestamp):'—');setText('gpsStatusBadge',d?'GPS received':'Not checked');
  $('gpsStatusBadge').className=`badge ${d?'green':'gray'}`;
  setText('scannerModelState',state.modelReady?'AI: Loaded':'AI: Not loaded');
  $('terminalRecent').innerHTML=state.punches.length?state.punches.slice(0,4).map(e=>`<div class="mini-feed-item"><div class="initial-avatar">${esc(initial(e.memberName))}</div><div class="desc"><b>${esc(e.memberName)} <span class="badge ${e.type==='IN'?'green':'amber'}">${e.type}</span></b><small>${esc(displayStamp(e.timestamp))} · ${esc(e.siteName)}</small></div></div>`).join(''):`<div class="empty-state">No check-ins yet</div>`;
}
function updateScanResult(title,detail,kind='neutral'){const el=$('scanResult');if(!el)return;el.className=`scan-message ${kind}`;el.innerHTML=`${pageIcon(kind==='success'?'check':kind==='error'?'alert':'scan')}<div><b>${esc(title)}</b><p>${esc(detail)}</p></div>`;if(kind==='error'&&state.page==='scanner')speakTerminal(title+'. '+detail,'error',title);}

let terminalAudio=null;
function unlockTerminalAudio(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;terminalAudio||=new C();if(terminalAudio.state==='suspended')terminalAudio.resume().catch(()=>{});}catch{}}
document.addEventListener('pointerdown',unlockTerminalAudio,{once:true});document.addEventListener('keydown',unlockTerminalAudio,{once:true});
function playTerminalSound(kind='face'){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;terminalAudio||=new C();if(terminalAudio.state==='suspended')terminalAudio.resume().catch(()=>{});const tones=kind==='success'?[880,1174.66]:kind==='error'?[440,329.63]:[659.25];tones.forEach((hz,i)=>{const t=terminalAudio.currentTime+i*.12,o=terminalAudio.createOscillator(),g=terminalAudio.createGain();o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.14,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+.12);o.connect(g);g.connect(terminalAudio.destination);o.start(t);o.stop(t+.13);});}catch{}}

// Speak attendance confirmations and errors using the device/browser voice.
// Continuous face-scan failures are throttled so they do not repeat each frame.
const terminalSpeechHistory=new Map();
let lastTerminalErrorAt=0;
function speakTerminal(text,kind='success',reason=''){
 try{
  if(state.page!=='scanner'||!window.speechSynthesis||typeof window.SpeechSynthesisUtterance!=='function')return false;
  const message=String(text||'').replace(/[\x00-\x1f\x7f]+/g,' ').trim().slice(0,220);
  if(!message)return false;
  const now=Date.now(),key=(kind==='error'?'error:':'success:')+String(reason||message).slice(0,110);
  const lastSame=terminalSpeechHistory.get(key)||0;
  if(kind==='error'&&(now-lastSame<25000||now-lastTerminalErrorAt<9000))return false;
  if(kind!=='error'&&now-lastSame<5000)return false;
  terminalSpeechHistory.set(key,now);if(kind==='error')lastTerminalErrorAt=now;
  if(terminalSpeechHistory.size>40){
   for(const [k,t] of terminalSpeechHistory)if(now-t>60000)terminalSpeechHistory.delete(k);
  }
  const spoken=new window.SpeechSynthesisUtterance(message);
  spoken.lang='en-PH';spoken.rate=0.95;spoken.pitch=1;spoken.volume=1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(spoken);
  return true;
 }catch(error){console.warn('Terminal speech unavailable',error);return false;}
}

// Member registry and assigned GPS work locations.
function siteForMember(member){return state.sites.find(s=>s.id===member.siteId)||state.sites.find(s=>member.siteIds?.includes(s.id));}
function sitesForMember(member){const ids=[...(member.siteIds||[]),member.siteId].filter((v,i,x)=>v&&x.indexOf(v)===i);return ids.map(id=>state.sites.find(s=>s.id===id)).filter(Boolean);}
function fillMemberFilter(id,values,placeholder){
 const el=$(id);if(!el)return;const old=el.value,unique=[...new Set(values.filter(Boolean))].sort((x,y)=>String(x).localeCompare(String(y)));
 el.innerHTML='<option value="">'+esc(placeholder)+'</option>'+unique.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
 if(unique.includes(old))el.value=old;
}
function memberEnrollerLabel(member){if(member.importedWithoutFace&&!(member.descriptors?.length>=3))return 'Not enrolled';
 const account=[state.user,...(state.users||[])].find(u=>u&&u.id===(member.createdBy||member.enrolledBy));
 return member.enrolledByUsername||account?.username||account?.name||'Not recorded';
}
function renderMembers(){
 // Defensive recheck: the User registry is limited to their own MPC and BP.
 const q=$('memberSearch').value.trim().toLowerCase(),face=$('memberFilterFace')?.value||'';
 const data=state.members.filter(m=>{
  if(m.deleted||(!isAdmin()&&!TIPONOrgCore.inScope(state.user,m)))return false;
  const enrolled=m.active!==false&&!!(m.template||m.descriptors?.length>=3);
  return (!q||[m.id,m.name,m.coop].join(' ').toLowerCase().includes(q))&&(!face||(face==='enrolled')===enrolled);
 }).sort((x,y)=>(x.name||'').localeCompare(y.name||''));
 setText('memberCountLabel',data.length+' member'+(data.length===1?'':'s'));
 $('memberRows').innerHTML=data.length?data.map(m=>{
  const sites=sitesForMember(m),enrolled=m.active!==false&&!!(m.template||m.descriptors?.length>=3),names=sites.map(s=>s.name).join(', ');
  return '<tr><td><div class="row-inline"><div class="initial-avatar">'+esc(initial(m.name))+'</div><div><b>'+esc(m.name)+'</b><small>ID: '+esc(m.id)+'</small></div></div></td>'+
   '<td>'+esc(m.coop)+'</td><td>'+esc(m.platform||sites[0]?.platform||'—')+'</td>'+
   '<td><b>'+esc(names||'Pending User assignment')+'</b><small>'+(sites.length?'GPS verification at assigned work location':'User selects location during face enrollment')+'</small></td>'+
   '<td>'+esc(memberEnrollerLabel(m))+'</td><td><span class="badge '+(enrolled?'green':'red')+'">'+(enrolled?'ENROLLED':'NOT ENROLLED')+'</span></td>'+
   '<td><button class="tiny-button" data-member-edit="'+esc(m.id)+'">Edit</button> <button class="tiny-button delete" data-member-delete="'+esc(m.id)+'">Delete</button></td></tr>';
 }).join(''):'<tr><td colspan="7"><div class="empty-state">'+pageIcon('users')+'No matching members found.</div></td></tr>';
}

let lastUserAddressSearch=0;
async function findUserSiteAddress(){
 if(!canEdit()||!$('siteDialog')?.open)return;
 const address=$('siteAddress').value.trim();
 if(address.length<3){showToast('Enter a specific address or landmark.','info');$('siteAddress').focus();return;}
 if(!navigator.onLine){showToast('Connect to the internet for address search, or select current GPS.','error');return;}
 if(Date.now()-lastUserAddressSearch<1100){showToast('Wait a moment before searching again.','info');return;}
 lastUserAddressSearch=Date.now();
 const button=$('adminSitePlaceFind');button.disabled=true;
 try{
  const endpoint='https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q='+encodeURIComponent(address);
  const response=await fetch(endpoint,{method:'GET',headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('Map service returned HTTP '+response.status+'.');
  const results=await response.json();
  if(!Array.isArray(results)||!results.length)throw Error('Location not found. Specify a city or landmark, or use device GPS.');
  const lat=Number(results[0].lat),lng=Number(results[0].lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))throw Error('Map service returned invalid coordinates.');
  $('siteLat').value=lat.toFixed(7);$('siteLng').value=lng.toFixed(7);
  updateSiteMap();
  showToast('Address located. Latitude, Longitude and Map Preview are updated.','success');
 }catch(error){toastError(error,'Find on Map');}
 finally{button.disabled=false;}
}

function fillMemberSites(preferred){
 const coop=$('memberCoop').value,ids=(Array.isArray(preferred)?preferred:[preferred]).filter(Boolean),platform=$('memberPlatform')?.value||state.user?.platform||'';
 const sites=state.sites.filter(s=>!s.deleted&&s.coop===coop&&(!platform||TIPONOrgCore.platformKey(s.platform)===TIPONOrgCore.platformKey(platform)));
 $('memberSite').innerHTML=sites.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' ('+esc(s.radius)+' m)</option>').join('');
 for(const option of $('memberSite').options)option.selected=ids.includes(option.value);
 $('memberSiteChoices').innerHTML=sites.map(s=>'<label class="multi-select-option"><input type="checkbox" data-member-site-option="'+esc(s.id)+'" '+(ids.includes(s.id)?'checked':'')+'/><span>'+esc(s.name)+' <small>'+esc(s.radius||150)+' m GPS</small></span></label>').join('');
 updateMemberSite();
}
function updateMemberSite(){
 const sites=[...$('memberSite').selectedOptions].map(o=>state.sites.find(s=>s.id===o.value)).filter(Boolean);
 setText('memberSiteSummary',sites.length?sites.length+' Location'+(sites.length===1?'':'s')+' Selected':'No Location Selected');
 setText('assignedSiteDetails',state.editMember&&!state.editMember.template?
   'This member is NOT ENROLLED. Face Enrollment and Work Location can be saved together using the existing server. Location-only saving requires an updated central backend.':
   sites.length?sites.map(s=>s.name+' · '+Number(s.lat).toFixed(6)+', '+Number(s.lng).toFixed(6)+' ('+(s.radius||150)+' m GPS)').join(' | '):
   'You can assign a Work Location now or later. Time In requires an enrolled face and a confirmed GPS Work Location.');
}
function parseMemberIdentity(full){
 const name=String(full||'').trim().replace(/\s+/g,' ');
 if(!name)return {last:'',first:'',middle:''};
 let last='',first='';
 if(name.includes(',')){const index=name.indexOf(',');last=name.slice(0,index).trim();first=name.slice(index+1).trim();}
 else {const parts=name.split(' ');last=parts.length>1?parts.pop():'';first=parts.join(' ')||name;}
 let middle='';
 const match=first.match(/\s+([\p{L}])\.?$/u);
 if(match){middle=match[1];first=first.slice(0,match.index).trim();}
 return {last,first,middle};
}
function memberNameFromFields(){
 const last=String($('memberLastName')?.value||'').trim().replace(/\s+/g,' ');
 const first=String($('memberFirstName')?.value||'').trim().replace(/\s+/g,' ');
 const middle=String($('memberMiddleInitial')?.value||'').trim().replace(/[.\s]/g,'');
 if(!last||!first||(middle&&!/^[\p{L}]$/u.test(middle)))return '';
 const seed=state.memberNameSeed;
 if(state.editMember&&seed&&seed.last===last&&seed.first===first&&seed.middle===middle)
  return state.editMember.name;
 return last.toLocaleUpperCase('en-PH')+', '+first.toLocaleUpperCase('en-PH')+
   (middle?' '+middle.toLocaleUpperCase('en-PH')+'.':'');
}
function openMemberForm(member){
 if(!canEdit())return;
 state.editMember=member||null;
 state.faceReplacementPending=false;state.enrollmentProof=null;state.livenessProof=null;
 state.memberNameSeed=parseMemberIdentity(member?.name);
 state.pendingDescriptors=member?.descriptors?.map(a=>[...a])||[];
 state.consentAcknowledgedAt=member?.consentAt||null;
 $('memberForm').reset();
 TIPONPlatforms.fill('memberPlatform',member?.platform||state.user?.platform||'');
 $('memberPlatform').disabled=state.user?.role==='registrar';
 const identityLocked=!!member&&(member.workLocationReassignmentRequired===true||
  ((member.importPending===true||member.importedWithoutFace===true)&&!member.template));
 for(const id of ['memberLastName','memberFirstName','memberMiddleInitial'])$(id).readOnly=identityLocked;
 $('memberLastName').value=state.memberNameSeed.last;
 $('memberFirstName').value=state.memberNameSeed.first;
 $('memberMiddleInitial').value=state.memberNameSeed.middle;
 $('memberCoop').disabled=identityLocked;
 setText('memberFormTitle',identityLocked?'Assign Work Location / Enroll Face':member?'Edit Member':'Add Member');
 $('memberId').disabled=!!member;
 if(member){$('memberId').value=member.id;$('memberName').value=member.name;$('memberCoop').value=member.coop;}
 fillMemberSites(member?.siteIds||member?.siteId);
 const enrolled=!!member&&member.active!==false&&!!(member.template||state.pendingDescriptors.length>=3);
 const mayReplace=!enrolled||member.createdBy===state.user?.id||member.workLocationReassignmentRequired===true;
 setText('enrollFaceLabel',enrolled?(mayReplace?'Enrolled · Face can be replaced.':'Enrolled · Original enrollment account required.'):'Not Enrolled · Complete Face Verification.');
 $('enrollFaceButton').disabled=!mayReplace||!!member?._pendingOp;
 $('enrollFaceButton').textContent=enrolled?'Re-enroll Face':'Enroll Face';
 $('memberDialog').showModal();
}

/**
 * Compatibility with the existing TIPON v5 API for ENROLLED members.
 * Adding another approved site without removing an old site is safe even
 * when the private memberLocationUpdate route has not been deployed.
 *
 * Use the original encrypted AES-GCM template as-is. No face re-enrollment,
 * no biometric data in messages, and no optimistic local update.
 */
async function addExistingEnrolledMemberLocations(old,siteIds){
 const stored=await getOne('members',old.id);
 if(!stored||stored.deleted||stored._pendingOp)throw Object.assign(
   Error('Member has an unconfirmed change. Refresh Member List before editing.'),{code:'CONFLICT'});
 if(Number(stored.rev||0)!==Number(old.rev||0))throw Object.assign(
   Error('This member changed on another device. Refresh Member List and retry.'),{code:'CONFLICT'});
 if(!stored.template||stored.template.alg!=='AES-GCM'||!stored.template.iv||
    typeof stored.template.data!=='string'||!stored.consentAt)
   throw Object.assign(Error('Face enrollment and consent must be complete before saving with the existing server.'),{code:'ENROLLMENT_REQUIRED'});
 if(stored.createdBy!==state.user?.id&&!stored.workLocationReassignmentRequired)
   throw Object.assign(Error('This enrolled member is managed by another account. Ask the original enrollment User or an Administrator to authorize reassignment.'),{code:'FORBIDDEN'});
 const beforeIds=Array.isArray(stored.siteIds)&&stored.siteIds.length?
   stored.siteIds:[stored.siteId].filter(Boolean);
 if(beforeIds.some(id=>!siteIds.includes(id))||!siteIds.length)
   throw Object.assign(Error('Removing or replacing a Work Location requires central server assignment support.'),{code:'BACKEND_REQUIRED'});
 const wire={...stored,siteId:siteIds[0],siteIds:[...siteIds],
   updatedAt:new Date().toISOString()};
 // Send only the existing encrypted face template, never the decrypted vector.
 for(const key of ['descriptors','_row','_pendingOp','syncIssue','templateError'])
   delete wire[key];
 const opId=uuid(),baseRev=Number(stored.rev)||0;
 const response=await TIPONAPI.call({action:'submit',
   operations:[{id:opId,type:'members',value:wire,baseRev}],events:[]});
 const failure=(response.operationErrors||[]).find(item=>item.id===opId);
 if(failure)throw Object.assign(Error(failure.error||'The central organization rejected the assignment.'),
   {code:failure.code||'SERVER'});
 if(!Array.isArray(response.ackOps)||!response.ackOps.includes(opId))
   throw Error('The central organization did not acknowledge this member update. Refresh before retrying.');
 const receipt=(response.receipts||[]).find(x=>x.type==='members'&&x.id===old.id);
 if(!receipt||Number(receipt.rev)!==baseRev+1)
   throw Error('An incomplete server receipt was received. Refresh the member directory to verify the assignment.');
 const latest=await getOne('members',old.id);
 if(latest?._pendingOp)throw Error('A concurrent edit was detected after central confirmation. Refresh Member List.');
 const record={...latest,...wire,orgId:state.orgId,rev:Number(receipt.rev)};
 delete record._pendingOp;delete record.syncIssue;delete record.descriptors;
 await OrgDB.rawSave('members',record);
 return record;
}

async function saveMemberForm(e){
 e.preventDefault();if(!canEdit())return;
 const id=$('memberId').value.trim(),name=memberNameFromFields(),
   coop=$('memberCoop').value,platform=$('memberPlatform').value.trim(),
   siteIds=[...$('memberSite').selectedOptions].map(o=>o.value),
   sites=siteIds.map(id=>state.sites.find(x=>x.id===id&&!x.deleted));
 if(!id||!name||!platform||!TIPONOrgCore.inScope(state.user,{coop,platform})){
   showToast('Enter Member ID, Last Name, First Name, Cooperative and Business Platform.','error');return;
 }
 if(siteIds.length>40||sites.some(s=>!s||s.coop!==coop||
   TIPONOrgCore.platformKey(s.platform)!==TIPONOrgCore.platformKey(platform))){
   showToast('Choose only approved Work Locations matching your Cooperative and Business Platform.','error');return;
 }
 if(sites.some(s=>s._pendingOp)){
   showToast('A selected Work Location is still awaiting central confirmation. Refresh Work Locations and retry, or leave the location unassigned for now.','info',8500);return;
 }
 if(!state.editMember&&state.members.some(m=>m.id.toLowerCase()===id.toLowerCase())){
   showToast('Member ID is already registered.','error');return;
 }
 const old=state.editMember;
 const oldIds=old?(Array.isArray(old.siteIds)&&old.siteIds.length?old.siteIds:[old.siteId].filter(Boolean)):[];
 const sameSites=old&&oldIds.length===siteIds.length&&oldIds.every(site=>siteIds.includes(site));
 // Editing GPS assignment must not force another facial enrollment.
 // A member without an enrolled face remains NOT ENROLLED until later.
 const locationOnly=!!old&&!state.pendingDescriptors?.length&&!old.template||
   !!old&&!!old.template&&name===old.name&&coop===old.coop&&
     TIPONOrgCore.platformKey(platform)===TIPONOrgCore.platformKey(old.platform);
 if(locationOnly&&!state.faceReplacementPending){
   if(name!==old.name||coop!==old.coop||
     TIPONOrgCore.platformKey(platform)!==TIPONOrgCore.platformKey(old.platform)){
     showToast('Only the Assigned Work Location can be changed here. Ask an Administrator to edit identity or MPC/BP.','info');return;
   }
   if(sameSites){$('memberDialog').close();showToast('No Assigned Work Location changes to save.','info');return;}
   if(!navigator.onLine){showToast('Internet access is required to update an existing member assignment.','error');return;}
   const open=state.punches.some(p=>p.memberId===id&&p.type==='IN'&&
     !state.punches.some(q=>q.sessionId===p.sessionId&&q.type==='OUT'));
   if(open){showToast('Complete Time Out before changing the assigned GPS location.','error');return;}
   const submit=$('memberForm').querySelector('[type="submit"]');
   const fullFace=!!old.template&&old.active!==false;
   // Old Apps Script requires a face template for member writes. It can
   // enroll an imported member and assign a location in one approved save,
   // but it cannot store a NOT ENROLLED member's location by itself.
   // Do not prevent NOT ENROLLED location-only updates when the private
   // Member Location backend has been installed. If it is unavailable,
   // show an actionable alternative after the server responds.

   const addingOnly=fullFace&&siteIds.length>0&&oldIds.every(site=>siteIds.includes(site));
   if(!addingOnly){
     try{
       const available=await window.TIPONMemberLocationSupport.check();
       if(!available){
         const explanation=!fullFace?
           'This organization is still using an older backend. Assigned Location without Face Enrollment requires the Member Location backend update. You can enroll the face and assign its location together now, or ask the Administrator to activate location-only editing. No changes were made.':
           'Removing or replacing a Work Location requires the Member Location backend update. Existing assignments were not changed.';
         setText('assignedSiteDetails',explanation);
         showToast('The central server needs the Member Location upgrade before this edit can be saved. No data changed.','info',8500);
         return;
       }
     }catch(error){
       showToast('Could not check the central Member Location service: '+String(error.message||error)+'. No data changed.','error',9000);
       return;
     }
   }
   if(submit)submit.disabled=true;
   try{
     if(addingOnly){
       // The existing authenticated submit route supports adding a site to
       // an ENROLLED member without changing their current approved sites.
       // It returns an explicit operation receipt before we change local data.
       await addExistingEnrolledMemberLocations(old,siteIds);
     }else{
       // Remove/replace or NOT ENROLLED location-only writes require the
       // new private, server-authorized endpoint with open-session checks.
       const response=await TIPONAPI.call({action:'memberLocationUpdate',
         memberId:id,baseRev:Number(old.rev)||0,siteIds});
       const confirmed=response.member;
       const savedIds=Array.isArray(confirmed?.siteIds)&&confirmed.siteIds.length?
         confirmed.siteIds:[confirmed?.siteId].filter(Boolean);
       if(!confirmed||confirmed.id!==id||savedIds.length!==siteIds.length||
          !savedIds.every(x=>siteIds.includes(x)))
         throw Error('Central organization did not acknowledge this assignment. Refresh before retrying.');
       const local=await getOne('members',id);
       if(local?._pendingOp)throw Error('Existing member change is pending sync. Retry after it completes.');
       const record={...local,...confirmed,orgId:state.orgId};
       delete record._pendingOp;
       await OrgDB.rawSave('members',record);
     }
     await loadCollections();$('memberDialog').close();
     renderMembers();renderDashboard();TIPONSync.kick();
     showToast('Assigned Work Location saved and confirmed centrally. Face enrollment is unchanged.','success',7500);
   }catch(error){
     const unsupported=error.code==='ACTION'||/unknown action|unsupported action|not implemented/i.test(error.message||'');
     const message=unsupported?
       (!fullFace?'Location-only saving is not enabled on the organization server yet. Select Enroll Face, complete 3 samples, and Save Member to assign the location now; or ask the Administrator to deploy the Member Location update. No assignment was saved.':
        'Removing or replacing a Work Location requires the TIPON Member Location backend update. Ask your Administrator to deploy it. No assignment was saved.') :
       error.code==='TIMEOUT'?
       'Server response timed out. Refresh the Member List to verify the latest central assignment before trying again.':
       String(error.message||'Could not confirm the Work Location update.');
     setText('assignedSiteDetails',message);
     showToast(message,unsupported?'info':'error',9000);
   }finally{if(submit)submit.disabled=false;}
   return;
 }
 // Fail closed when the live-face module was not loaded or verified.
 const liveProof=state.enrollmentProof;
 if(!liveProof||liveProof.memberId!==id||!Number.isFinite(liveProof.at)||
    liveProof.at>Date.now()||Date.now()-liveProof.at>20*60*1000){
   showToast('Complete live blink and head-turn verification before saving Face Enrollment.','error');
   return;
 }
 // New facial enrollment can be completed without a GPS assignment.
 // The private backend must accept an empty siteIds array; a member with no
 // assigned location cannot use Time In or Time Out.
 if(!state.pendingDescriptors?.length||state.pendingDescriptors.length<3){
   showToast('Complete Face Enrollment before creating a new enrolled member.','error');return;
 }
 const latest=await getAll('members');
 const all=[...new Map([...latest,...state.members].filter(Boolean).map(m=>[String(m.id),m])).values()];
 if(findEnrolledFaceConflict(state.pendingDescriptors,id,all)){
   state.pendingDescriptors=[];setText('enrollFaceLabel','Duplicate face enrollment blocked.');
   showToast('This face is registered under a different Member ID. Enrollment blocked.','error',8500);return;
 }
 if(!state.consentAcknowledgedAt&&!old?.consentAt){
   showToast('Complete the biometric consent and live Face Enrollment first.','error');return;
 }
 const last=state.punches.find(p=>p.memberId===id);
 if(last?.type==='IN'&&oldIds.some(x=>!siteIds.includes(x))){
   showToast('Complete Time Out before removing an assigned Work Location.','error');return;
 }
 const record={id,name,coop,platform,siteId:siteIds[0]||'',siteIds,
   descriptors:state.pendingDescriptors,
   consentAt:state.faceReplacementPending?new Date(state.consentAcknowledgedAt||Date.now()).toISOString():(old?.consentAt||new Date(state.consentAcknowledgedAt||Date.now()).toISOString()),
   enrolledBy:state.faceReplacementPending?state.user.id:(old?.enrolledBy||state.user.id),
   enrolledByUsername:state.faceReplacementPending?state.user.username:(old?.enrolledByUsername||state.user.username||''),
   createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
 try{
   if(!siteIds.length){
     // Fail closed: the previous private Apps Script backend still required
     // one Work Location. Without a server capability check, an offline-only
     // save would become an indefinitely rejected record.
     if(!navigator.onLine)throw Error('Connect to the internet before enrolling a member without a Work Location.');
     const feature=await TIPONAPI.raw({action:'memberLocationCapabilities'});
     if(feature?.allowUnassignedFace!==true)throw Error('Private Apps Script must be updated before face enrollment without a Work Location is supported.');
   }
   // Save with an outbox receipt, then immediately attempt central sync.
   // Never claim a central save until the matching outbox operation is ACKed.
   await saveOne('members',record);
   await loadCollections();$('memberDialog').close();
   let syncOutcome={ok:false,error:'Offline: automatic synchronization resumes when connected.'};
   if(navigator.onLine){
     try{syncOutcome=await TIPONSync.submitPendingNow();}
     catch(syncError){syncOutcome={ok:false,error:String(syncError?.message||syncError)};}
   }
   await loadCollections();
   const persisted=await getOne('members',record.id);
   const confirmed=!!syncOutcome?.ok&&!persisted?._pendingOp&&
     persisted?.orgId===state.orgId;
   renderMembers();renderDashboard();
   if(confirmed){
     showToast(name+' enrolled and confirmed in the central organization.'+
       (siteIds.length?'':' Assign a GPS Work Location before attendance.'),'success',8000);
   }else{
     showToast(name+' was saved on this device but is NOT YET confirmed in the central organization. '+
       'Automatic sync will retry. Check Settings & Offline for details.','info',10000);
   }
 }catch(error){
   const message=error.code==='ACTION'||/unknown action|unsupported action|not implemented/i.test(error.message||'')
     ?'Face enrollment without an Assigned Work Location requires the updated private Apps Script. No enrollment was saved.'
     :String(error.message||'Unable to save member.');
   showToast(message,'error',8500);
 }
}
async function handleMemberTableClick(event){
 const edit=event.target.closest('[data-member-edit]'),
   del=event.target.closest('[data-member-delete]');
 if(edit){
  const member=state.members.find(x=>x.id===edit.dataset.memberEdit&&!x.deleted);
  if(member)openMemberForm(member);
  return;
 }
 if(!del)return;
 const member=state.members.find(x=>x.id===del.dataset.memberDelete&&!x.deleted);
 if(!member)return;
 const admin=isAdmin(),userAuthorized=canEdit()&&TIPONOrgCore.inScope(state.user,member);
 if(!admin&&!userAuthorized){
  showToast('Only an Administrator or authorized User in this MPC/BP can delete this member.','error');
  return;
 }
 if(!navigator.onLine){
  showToast('Connect to the internet before deleting. No member records were changed.','error');
  return;
 }
 const stored=await getOne('members',member.id);
 if(stored?._pendingOp||member._pendingOp){
  showToast('This member has an unconfirmed edit. Complete central sync before deleting.','error');
  return;
 }
 const yes=await confirmAction('Delete Member',
  'Remove '+member.name+' from the central TIPON Members directory and all authorized devices? '+
  'Any stored facial template will be removed, while the existing attendance history will be retained. '+
  'Members with open Time In sessions cannot be deleted.');
 if(!yes)return;
 del.disabled=true;
 try{
  // Admin keeps the existing fully deployed endpoint. A User must have the
  // new server-authorized memberUserDelete endpoint. Never use local deleteOne
  // or an Admin token to bypass the private backend role permission.
  const reply=await TIPONAPI.call({
   action:admin?'adminMemberDelete':'memberUserDelete',
   memberId:member.id,baseRev:Number(member.rev)||0
  });
  if(!reply.member||!reply.member.deleted||reply.member.id!==member.id||
     reply.member.active!==false){
   throw Error('The central server did not confirm Member deletion. No local deletion was applied.');
  }
  const latest=await getOne('members',member.id);
  if(latest?._pendingOp)throw Error('A concurrent edit appeared before deletion. Sync and try again.');
  const tombstone={...latest,...member,...reply.member,orgId:state.orgId,
    deleted:true,active:false,template:null,consentAt:null,faceEnrollmentStatus:'deleted'};
  delete tombstone.descriptors;delete tombstone._pendingOp;
  await OrgDB.rawSave('members',tombstone);
  await loadCollections();renderMembers();renderDashboard();
  TIPONSync.kick();
  showToast('Member deleted centrally. Attendance history remains available in existing logs.','success',7500);
 }catch(error){
  const message=error.code==='ACTION'||
   /unknown action|unsupported action|not implemented/i.test(String(error.message||''))?
   (admin?'Admin deletion requires the current private Apps Script backend. Nothing was deleted.':
    'User Delete requires the private Apps Script memberUserDelete route. Nothing was deleted.'):
   String(error.message||'Central deletion failed. No local deletion was applied.');
  showToast(message,'error',9000);
 }finally{del.disabled=false;}
}
function renderSites(){
 $('siteCards').innerHTML=state.sites.length?state.sites.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.coop)}</td><td>${esc(s.platform||'—')}</td><td><div class="site-actions"><button class="tiny-button" data-site-edit="${esc(s.id)}">Edit</button><button class="tiny-button delete" data-site-delete="${esc(s.id)}">Delete</button></div></td></tr>`).join(''):`<tr><td colspan="4"><div class="empty-state">${pageIcon('pin')}No Work Locations are available for your approved Cooperative / Business Platform. Select “Add Work Location” to register an authorized GPS site.</div></td></tr>`;
}
function openSiteForm(site){
 state.editSite=site||null;$('siteForm').reset();setText('siteFormTitle',site?'Edit Work Location':'Add Work Location');$('siteRadius').value='150';
 if(site){$('siteName').value=site.name;$('siteCoop').value=site.coop;$('siteAddress').value=site.address||'';$('siteLat').value=site.lat;$('siteLng').value=site.lng;$('siteRadius').value=150;}
 updateSiteMap();$('siteDialog').showModal();
}
function updateSiteMap(){
 const latInput=$('siteLat').value.trim(),lngInput=$('siteLng').value.trim();
 const lat=Number(latInput),lng=Number(lngInput);
 const valid=!!latInput&&!!lngInput&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
 const adminPicker=isAdmin()&&$('siteDialog')?.open;
 if(!valid){
  $('siteOpenMap').hidden=!adminPicker;
  setText('mapCoordLabel',adminPicker?'Choose the exact location on the map or enter coordinates.':'Enter coordinates or use current GPS.');
  if(adminPicker){$('siteMapFrame').hidden=true;window.TIPONAdminSites?.syncFromInputs();}
  else{$('siteMapFrame').hidden=true;$('mapOffline').hidden=false;}
  return;
 }
 setText('mapCoordLabel',lat.toFixed(7)+', '+lng.toFixed(7)+' · '+($('siteRadius').value||150)+' m radius');
 $('siteOpenMap').href='https://www.openstreetmap.org/?mlat='+lat+'&mlon='+lng+'#map=16/'+lat+'/'+lng;
 $('siteOpenMap').hidden=false;
 if(adminPicker){
  if($('siteMapPreview').classList.contains('map-fallback')){
   const box=[lng-.015,lat-.010,lng+.015,lat+.010].join(',');
   const target='https://www.openstreetmap.org/export/embed.html?bbox='+encodeURIComponent(box)+'&layer=mapnik&marker='+lat+'%2C'+lng;
   if($('siteMapFrame').src!==target)$('siteMapFrame').src=target;
   $('siteMapFrame').hidden=false;$('mapOffline').hidden=true;
  }else{
   $('siteMapFrame').hidden=true;
   window.TIPONAdminSites?.syncFromInputs();
  }
  return;
 }
 const zoomLat=.010,zoomLng=.015,box=[lng-zoomLng,lat-zoomLat,lng+zoomLng,lat+zoomLat].join(',');
 if(navigator.onLine){
  const src='https://www.openstreetmap.org/export/embed.html?bbox='+encodeURIComponent(box)+'&layer=mapnik&marker='+lat+'%2C'+lng;
  if($('siteMapFrame').src!==src)$('siteMapFrame').src=src;
  $('siteMapFrame').hidden=false;$('mapOffline').hidden=true;
 }else{$('siteMapFrame').hidden=true;$('mapOffline').hidden=false;}
}
async function saveSiteForm(e){
 e.preventDefault();
 if(!canEdit()&&!isAdmin())return;
 const admin=isAdmin(),previous=state.editSite;
 const name=$('siteName').value.trim(),address=$('siteAddress').value.trim();
 const latText=$('siteLat').value.trim(),lngText=$('siteLng').value.trim();
 const lat=Number(latText),lng=Number(lngText),radius=Number($('siteRadius').value);
 if(!name||!latText||!lngText||!Number.isFinite(lat)||!Number.isFinite(lng)||
    Math.abs(lat)>90||Math.abs(lng)>180||!Number.isFinite(radius)||radius<GPS_MIN_RADIUS||radius>2000){
  showToast('Enter a Work Location Name and select valid GPS coordinates.','error');return;
 }
 let pairs;
 try{pairs=window.TIPONSiteScopes?.pairs(previous)||[{coop:$('siteCoop').value,platform:$('sitePlatform').value.trim()}];}
 catch(error){showToast(error.message,'error',8500);return;}
 const validPlatforms=new Set(TIPONOrgCore.platformNames(TIPONPlatforms.names()).map(TIPONOrgCore.platformKey));
 const valid=pairs.length&&pairs.every(p=>TIPONOrgCore.COOPS.includes(p.coop)&&validPlatforms.has(TIPONOrgCore.platformKey(p.platform))&&TIPONOrgCore.inScope(state.user,p));
 if(!valid){showToast('Select approved Cooperatives and Business Platforms.','error');return;}
 if(admin&&!navigator.onLine){showToast('Connect to the internet to centrally register Work Locations.','error');return;}
 const gpsChanged=!!previous&&(Number(previous.lat)!==lat||Number(previous.lng)!==lng||Number(previous.radius)!==radius);
 if(previous&&gpsChanged){
  const open=TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)).filter(p=>p.siteId===previous.id&&p.timeIn&&!p.timeOut);
  if(open.length){showToast('Complete Time Out before changing the existing location geofence.','error',9000);return;}
 }
 const normalized=value=>String(value||'').trim().normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
 const samePair=(site,p)=>site.coop===p.coop&&TIPONOrgCore.platformKey(site.platform)===TIPONOrgCore.platformKey(p.platform);
 // Existing site retains its MPC/BP ID and history. Other selected pairs
 // receive independent site IDs because the central schema is scoped to one pair.
 const proposals=[],seenIds=new Set(),existingInSync=[];
 for(const pair of pairs){
  const current=previous&&samePair(previous,pair)?previous:null;
  const duplicate=state.sites.find(s=>s.id!==current?.id&&!s.deleted&&samePair(s,pair)&&normalized(s.name)===normalized(name));
  if(duplicate){
   const identical=Math.abs(Number(duplicate.lat)-lat)<.0000001&&Math.abs(Number(duplicate.lng)-lng)<.0000001&&
     Number(duplicate.radius||150)===radius&&normalized(duplicate.address)===normalized(address);
   if(!identical){showToast('A Work Location named "'+name+'" already exists for '+pair.coop+' / '+pair.platform+'. Edit it instead of creating a duplicate.','error',9500);return;}
   if(duplicate._pendingOp)existingInSync.push(duplicate.id);
   continue;
  }
  const site={id:current?.id||uuid(),name,coop:pair.coop,platform:pair.platform,address,
    lat,lng,radius,createdAt:current?.createdAt||new Date().toISOString()};
  if(current&&current.name===name&&normalized(current.address)===normalized(address)&&!gpsChanged)continue;
  proposals.push(site);seenIds.add(site.id);
 }
 if(!proposals.length&&!existingInSync.length){
  $('siteDialog').close();showToast('The selected Work Locations already exist with these details.','info');return;
 }
 // Validate every intended pair before writes; do not stage a partial invalid group.
 const submit=$('siteForm').querySelector('[type="submit"],.dialog-actions .btn.primary');
 if(submit)submit.disabled=true;
 const staged=[],allIds=[...existingInSync];let syncResult=null;
 try{
  for(const site of proposals){
   await saveOne('sites',site);
   staged.push(site.id);allIds.push(site.id);
  }
  await loadCollections();
  if(!admin){
   $('siteDialog').close();renderSites();TIPONSync.kick();
   showToast('Work Location saved on this device. Automatic central synchronization is enabled.','success',6500);
   return;
  }
  // Sending more than one scoped site may require several server batches.
  // Verify each ID after every pass; a generic "sync ok" is never proof.
  let outstanding=allIds.slice();
  for(let attempt=0;attempt<Math.ceil(allIds.length/3)+2&&outstanding.length;attempt++){
   syncResult=await TIPONSync.submitPendingNow();
   outstanding=(await Promise.all(allIds.map(async id=>{
     const site=await getOne('sites',id);
     return site?._pendingOp?id:null;
   }))).filter(Boolean);
   if(!syncResult?.ok)break;
  }
  await loadCollections();
  $('siteDialog').close();renderSites();window.TIPONAdminSites?.render();renderDashboard();
  const confirmed=allIds.length-outstanding.length;
  if(!outstanding.length){
   showToast(confirmed+' Work Location'+(confirmed===1?'':'s')+' confirmed in the central database.','success',7000);
  }else{
   const failed=await Promise.all(outstanding.map(async id=>{
     const site=await getOne('sites',id);return site?._pendingOp?await getOne('outbox',site._pendingOp):null;
   }));
   const needsReview=failed.some(op=>op?.errorCode==='NEEDS_REVIEW'||op?.errorCode==='FORBIDDEN'||op?.errorCode==='CONFLICT');
   const info=needsReview?'Some records need authorized review.': 'Automatic sync remains active for unconfirmed records.';
   // Compact and non-alarming; never paste unrelated server rejection text
   // (for example, an invalid Admin member edit) into the Work Location toast.
   showToast(confirmed+' of '+allIds.length+' Work Locations centrally confirmed. '+info,'info',9000);
  }
 }catch(error){
  await loadCollections().catch(()=>{});
  renderSites();if(admin)window.TIPONAdminSites?.render();
  const count=staged.length;
  if(count)showToast(count+' Work Location change'+(count===1?' was':'s were')+' stored locally; central confirmation is not complete. Open Settings & Offline for sync details.','info',9500);
  else toastError(error,'Could not save Work Location');
 }finally{if(submit)submit.disabled=false;}
}
async function handleSiteCardsClick(e){const edit=e.target.closest('[data-site-edit]');const del=e.target.closest('[data-site-delete]');if(edit){const site=state.sites.find(s=>s.id===edit.dataset.siteEdit);if(site)openSiteForm(site);}
 if(del){const site=state.sites.find(s=>s.id===del.dataset.siteDelete);if(!site)return;if(state.members.some(m=>m.siteId===site.id||(m.siteIds||[]).includes(site.id))){showToast('Reassign or delete enrolled members before deleting their site.','error');return;}const ok=await confirmAction('Delete work location',`Delete ${site.name}? This change will sync to your organization.`);if(ok){await deleteOne('sites',site.id);await loadCollections();renderSites();showToast('Location removed.','success');}}}



function confirmAction(title,body){
 return new Promise(resolve=>{
  state.confirmResolver=resolve;
  setText('confirmTitle',title);
  setText('confirmBody',body);
  const confirmButton=$('confirmYes');
  // All Confirm actions use the approved green theme. Destructive actions
  // still require this explicit confirmation and retain their warning text.
  confirmButton.classList.add('confirm-success');
  confirmButton.classList.remove('danger-button');
  $('confirmDialog').showModal();
 });
}
function resolveConfirm(answer){if($('confirmDialog').open)$('confirmDialog').close();const r=state.confirmResolver;state.confirmResolver=null;if(r)r(answer);}

// GPS reading on demand. Attendance *always* obtains a fresh reading at punch time.
function readGPS(){return new Promise((resolve,reject)=>{
 if(!navigator.geolocation)return reject(Error('This phone/browser has no geolocation capability.'));
 navigator.geolocation.getCurrentPosition(pos=>{const gps={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy,timestamp:pos.timestamp};state.lastGPS=gps;if(state.page==='scanner')renderTerminal();resolve(gps);},(error)=>{
 const reason={1:'GPS permission denied. Allow location access in browser settings.',2:'Current location unavailable. Try outdoors.',3:'GPS timed out; move to an open area and try again.'}[error.code]||error.message||'GPS failed';reject(Error(reason));
 },{enableHighAccuracy:true,timeout:18000,maximumAge:0});
 });}
function startGPSWatch(){if(!navigator.geolocation){setText('gpsStatusBadge','GPS unavailable');return;}if(state.gpsWatchId!==null)return;state.gpsWatchId=navigator.geolocation.watchPosition(pos=>{state.lastGPS={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy,timestamp:pos.timestamp};if(state.page==='scanner')renderTerminal();},err=>{const reason={1:'Allow location access for automatic kiosk verification.',2:'Current location unavailable; move to an open area.',3:'GPS timed out; retry or use Refresh GPS reading.'}[err.code]||'GPS reading unavailable.';setText('gpsStatusBadge','GPS waiting');setText('cameraBottomTag',reason);},{enableHighAccuracy:true,timeout:18000,maximumAge:5000});readGPS().catch(err=>setText('cameraBottomTag',err.message));}
function stopGPSWatch(){if(state.gpsWatchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(state.gpsWatchId);state.gpsWatchId=null;}}

async function useGpsForSite(){if(isAdmin()){showToast('Administrators select the official site coordinates on the map, not from their current GPS.','info');return;}try{setText('mapCoordLabel','Locating your device…');const gps=await readGPS();$('siteLat').value=gps.latitude.toFixed(7);$('siteLng').value=gps.longitude.toFixed(7);updateSiteMap();showToast(`GPS acquired, accuracy ±${Math.round(gps.accuracy)} m.`,'success');}catch(err){toastError(err,'GPS not available');}}

// Worksite coordinates are captured from device GPS; address geocoding has been removed.
// Time logs and Excel export.
function filteredAttendanceRows(){
 if(!validateAttendanceDateRange('recordFrom','recordTo','recordDateError','exportExcel'))throw Error('To Date cannot be earlier than From Date.');
 const data=TIPONCore.rows(state.punches,state.deviceId);
 return TIPONCore.filterRows(data,$('recordFrom').value,$('recordTo').value,$('recordSite').value);
}
function renderRecords(){
 validateAttendanceDateRange('recordFrom','recordTo','recordDateError','exportExcel');
 if(isAdmin()){
  const page=$('page-records');
  [...page.children].forEach(el=>{if(el.id!=='terminalLogPanel')el.hidden=true;});
  page.appendChild($('terminalLogPanel'));renderTerminalLogs();return;
 }
 const old=$('recordSite').value;
 const sites=new Map(state.sites.map(s=>[s.id,s.name]));for(const p of state.punches)if(p.siteId&&!sites.has(p.siteId))sites.set(p.siteId,p.siteName);
 $('recordSite').innerHTML='<option value="">All locations</option>'+[...sites].map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
 if(sites.has(old))$('recordSite').value=old;
 try{const data=filteredAttendanceRows();const values=TIPONExport.table(data).slice(1);
 setText('recordCountLabel',`${data.length} paired attendance rows`);
 $('recordRows').innerHTML=values.length?values.map(row=>'<tr>'+row.map(v=>`<td>${esc(v)}</td>`).join('')+'</tr>').join(''):'<tr><td colspan="5"><div class="empty-state">No attendance records for this selection.</div></td></tr>';
 }catch(err){setText('recordCountLabel',err.message);$('recordRows').innerHTML='';}
 if(window.TIPONSync)TIPONSync.render();
}
function fillLogFilter(id,values,placeholder){
 const el=$(id);if(!el)return;const old=el.value,unique=[...new Set(values.filter(Boolean))].sort((x,y)=>String(x).localeCompare(String(y)));
 el.innerHTML='<option value="">'+esc(placeholder)+'</option>'+unique.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
 if(unique.includes(old))el.value=old;
}
function filteredTerminalLogRows(){
 const from=$('terminalLogFrom').value,to=$('terminalLogTo').value,
  siteId=$('terminalLogSite').value,admin=isAdmin();
 const coop=admin?$('terminalLogCoop').value:'',platform=admin?$('terminalLogPlatform').value:'';
 if(!validateAttendanceDateRange('terminalLogFrom','terminalLogTo','terminalLogDateError','terminalLogExport'))throw Error('To Date cannot be earlier than From Date.');
 return TIPONOrgCore.project(state.punches.filter(p=>!p.deleted&&p.reviewStatus!=='rejected')).filter(r=>{
  const stamp=r.timeIn||r.timeOut,day=TIPONCore.phStamp(stamp).slice(0,10);
  // A hidden filter must never expand data beyond the authenticated User MPC/BP
  // or a Physical Kiosk's GPS-approved site list.
  const allowed=admin||TIPONOrgCore.inScope(state.user,r);
  return allowed&&(!from||day>=from)&&(!to||day<=to)&&
   (!coop||r.coop===coop)&&(!platform||TIPONOrgCore.platformKey(r.platform)===TIPONOrgCore.platformKey(platform))&&
   (!siteId||r.siteId===siteId);
 });
}
function canCorrectAttendance(){const u=state.user,a=window.TIPONAuth?.current();return !!u&&!!a&&a.account?.id===u.id&&a.orgId===state.orgId&&a.offlineUntil>Date.now()&&(isAdmin()||(u.role==='registrar'&&['supervisor','member supervisor'].includes(String(u.position||'').trim().toLowerCase())));}
function attendanceMemberName(row,memberNames){
 const current=String(memberNames.get(String(row.memberId))||'').trim();
 const historical=String(row.memberName||'').trim();
 return current||historical||'Name unavailable';
}
function attendanceSyncLabel(row){
 const ids=new Set(row.eventIds||[]);
 const events=state.punches.filter(p=>ids.has(p.id));
 if(events.some(p=>p.reviewStatus))return 'Needs Review';
 if(events.some(p=>!p.cloudAck))return 'Pending Sync';
 return 'Synced';
}
function renderTerminalLogs(){
 if(!$('terminalLogRows'))return;
 if(state.page==='terminalLogs')$('page-terminalLogs').appendChild($('terminalLogPanel'));
 const sites=[...state.sites],events=state.punches;
 if(isAdmin()){
  fillLogFilter('terminalLogCoop',[...state.members.map(m=>m.coop),...events.map(p=>p.coop)],'All cooperatives');
  fillLogFilter('terminalLogPlatform',[...state.members.map(m=>m.platform),...sites.map(x=>x.platform),...events.map(p=>p.platform)],'All business platforms');
 }else{
  $('terminalLogCoop').value='';$('terminalLogPlatform').value='';
 }
 const selector=$('terminalLogSite'),selected=selector.value;
 const sitesById=new Map([...sites.map(x=>[x.id,x.name]),...events.filter(p=>p.siteId).map(p=>[p.siteId,p.siteName])]);
 selector.innerHTML='<option value="">All work locations</option>'+
  [...sitesById].map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name||id)+'</option>').join('');
 if(sitesById.has(selected))selector.value=selected;
 try{
  const rows=filteredTerminalLogRows();
  const memberNames=new Map((state.members||[]).filter(m=>m&&m.id).map(m=>[String(m.id),String(m.name||'').trim()]));
  $('terminalLogRows').innerHTML=rows.length?rows.map(row=>{
   const location=row.location||sitesById.get(row.siteId)||'—';
   const stamp=row.timeIn||row.timeOut;
   const data=[
    attendanceMemberName(row,memberNames),
    row.memberId,
    stamp?TIPONCore.phStamp(stamp).slice(0,10):'—',
    row.timeIn?TIPONCore.phStamp(row.timeIn).slice(-8):'—',
    row.timeOut?TIPONCore.phStamp(row.timeOut).slice(-8):'—',
    row.timeOut?TIPONCore.phStamp(row.timeOut).slice(0,10):'—',
    row.coop||'—',row.platform||'—',location,attendanceSyncLabel(row)
   ];
   return '<tr>'+data.map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>';
  }).join(''):'<tr><td colspan="10">No attendance records match these filters or your approved account scope.</td></tr>';
 }catch(err){
  setText('terminalLogCount',err.message);
  $('terminalLogRows').innerHTML='<tr><td colspan="10">'+esc(err.message)+'</td></tr>';
 }
}
async function exportTerminalLogs(){
 const btn=$('terminalLogExport');try{
  const rows=filteredTerminalLogRows().filter(row=>(row.eventIds||[]).every(id=>{
      const event=state.punches.find(p=>p.id===id);
      return event&&!event.reviewStatus;
    }));
    if(!rows.length){showToast('No valid attendance records to export. Review rejected events first.','error');return;}
  btn.disabled=true;await new Promise(resolve=>setTimeout(resolve,0));
  const bytes=TIPONExport.xlsx(rows);downloadBlob('TIPON_Attendance_'+todayPH()+'.xlsx',new Blob([bytes],{type:TIPONExport.MIME}));
  showToast('Exported '+rows.length+' attendance session(s).','success');
 }catch(err){toastError(err,'Attendance export');}finally{btn.disabled=false;}
}
async function editAttendanceFromLog(e){const b=e.target.closest('[data-attendance-edit]');if(!b||!canCorrectAttendance())return;const row=TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)).find(x=>x.key===b.dataset.attendanceEdit);if(!row)return;const events=state.punches.filter(p=>row.eventIds.includes(p.id));if(events.some(p=>p.cloudAck||p._pendingOp||p.uploadPayload))return showToast('Synced or queued attendance is read-only. Use the approved server correction process.','error',8500);const reason=prompt('Correction reason (required):');if(!reason?.trim())return;const nextIn=prompt('Time In (local YYYY-MM-DDTHH:MM)',b.dataset.in),nextOut=prompt('Time Out (local YYYY-MM-DDTHH:MM)',b.dataset.out),valid=x=>!x||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x);if(nextIn===null||nextOut===null)return;if(!nextIn)return showToast('Time In is required.','error');if(!valid(nextIn)||!valid(nextOut))return showToast('Use YYYY-MM-DDTHH:MM format.','error');const iso=x=>x?new Date(x+':00+08:00').toISOString():'';const ti=iso(nextIn),to=iso(nextOut);if(ti&&to&&Date.parse(to)<Date.parse(ti))return showToast('Time Out must be after Time In.','error');if(!await confirmAction('Save attendance correction?',row.memberName+' · '+reason.trim()+' · This updates local unsynced punches and saves correction details.'))return;for(const p of events){const stamp=p.type==='IN'?ti:to;if(!stamp){await deleteOne('punches',p.id);continue;}p.timestamp=stamp;p.day=todayPH(new Date(stamp));delete p.uploadPayload;p.correctionReason=reason.trim();p.correctedAt=new Date().toISOString();p.correctedBy=state.user.username||state.user.id;await saveOne('punches',p);}await loadCollections();renderTerminalLogs();renderDashboard();TIPONSync.kick();showToast('Unsynced attendance correction saved.','success');}
function loadScript(url,check){if(check())return Promise.resolve();return new Promise((resolve,reject)=>{const old=document.querySelector(`script[data-remote="${url}"]`);if(old)old.remove();const el=document.createElement('script');el.src=url;el.crossOrigin='anonymous';el.dataset.remote=url;el.onload=()=>resolve();el.onerror=()=>reject(Error(`Could not load ${url.split('/').pop()}. Download offline resources while connected.`));document.body.appendChild(el);});}
async function exportExcel(){
 let data;try{if(!validateAttendanceDateRange('recordFrom','recordTo','recordDateError','exportExcel'))throw Error('To Date cannot be earlier than From Date.');data=filteredAttendanceRows();}catch(err){toastError(err,'Export');return;}
 if(!data.length){showToast('No attendance records to export.','error');return;}
 const button=$('exportExcel');button.disabled=true;
 try{
  // Yield once so the disabled button paints before creating the workbook.
  await new Promise(resolve=>setTimeout(resolve,0));
  const bytes=TIPONExport.xlsx(data);
  downloadBlob(`TIPON_Attendance_${todayPH()}.xlsx`,new Blob([bytes],{type:TIPONExport.MIME}));
  showToast(`Exported ${data.length} rows: MemberId, Date, Time In, Time Out, Date Time Out. Unsynced local records are included.`,'success',7000);
 }catch(err){toastError(err,'Excel export failed');}finally{button.disabled=false;}
}
async function loadFaceModels(){
 if(state.modelReady)return;
 if(state.facePromise)return state.facePromise;
 state.facePromise=(async()=>{
   setText('scannerModelState','AI: Loading…');
   await loadScript(FACE_SCRIPT,()=>!!window.faceapi);
   if(!window.faceapi)throw Error('Face recognition library unavailable.');
   await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_ROOT),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_ROOT),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_ROOT)
   ]);
   state.modelReady=true;setText('scannerModelState','AI: Ready');
 })();
 try{await state.facePromise;}catch(e){state.facePromise=null;setText('scannerModelState','AI: Setup required');throw e;}
}
async function getCameraStream(context='scan'){return TIPONCamera.open(context);}
function optionsFace(){return new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.45});}
async function detectFaces(video){return await faceapi.detectAllFaces(video,optionsFace()).withFaceLandmarks(true).withFaceDescriptors();}
function euclidean(a,b){let sum=0;for(let i=0;i<a.length;i++)sum+=(a[i]-b[i])**2;return Math.sqrt(sum);}
function nearestMember(descriptor){const matches=state.members.filter(m=>m.active!==false&&!m.deleted&&m.descriptors?.length>=3).map(m=>({member:m,distance:Math.min(...m.descriptors.map(arr=>euclidean(arr,descriptor)))})).sort((a,b)=>a.distance-b.distance);return {best:matches[0],second:matches[1]};}

/* Duplicate checks for enrollment use available synced templates; attendance matching is unchanged. */
const ENROLLMENT_DUPLICATE_FACE_DISTANCE=0.45;
function findEnrolledFaceConflict(samples,excludeId='',catalog=state.members){
 const vectors=(Array.isArray(samples?.[0])?samples:[samples]).filter(v=>v&&v.length===128);
 if(!vectors.length)return null;
 let match=null;
 for(const member of catalog||[]){
  if(!member||member.deleted||String(member.id||'').toLowerCase()===String(excludeId||'').toLowerCase())continue;
  if(!Array.isArray(member.descriptors))continue;
  for(const reference of member.descriptors){
   if(!reference||reference.length!==128)continue;
   for(const sample of vectors){
    const distance=euclidean(reference,sample);
    if(Number.isFinite(distance)&&distance<ENROLLMENT_DUPLICATE_FACE_DISTANCE&&(!match||distance<match.distance)){
     match={member,distance};
    }
   }
  }
 }
 return match;
}

async function startScanner(){if(!hasTerminalSession()){showToast('Face Terminal is available to approved user accounts and authorized kiosks, not the administrator screen.','error');return;}if(state.scanning||state.scanBusy)return;const run=(state.scanRun||0)+1;state.scanRun=run;const enrolled=state.members.filter(m=>m.active!==false&&!m.deleted&&m.descriptors?.length>=3).length;
 startGPSWatch();state.scanBusy=true;$('startCamera').disabled=true;updateScanResult('Preparing camera…','Loading available cameras and automatic GPS verification.','neutral');
 try{
   await loadFaceModels();if(!hasTerminalSession()||state.scanRun!==run||state.page!=='scanner'||document.hidden)return;const stream=await getCameraStream();if(!hasTerminalSession()||state.scanRun!==run||state.page!=='scanner'||document.hidden){stream.getTracks().forEach(t=>t.stop());return;}state.scanStream=stream;
   const v=$('scanVideo');v.srcObject=stream;await v.play();
   if(!hasTerminalSession()||state.scanRun!==run||state.page!=='scanner'||document.hidden){
     stream.getTracks().forEach(t=>t.stop());if(v.srcObject===stream){v.pause();v.srcObject=null;}if(state.scanStream===stream)state.scanStream=null;return;
   }
   $('cameraIdle').hidden=true;$('startCamera').hidden=true;$('stopCamera').hidden=false;
   state.scanning=true;state.scanArmed=true;state.scanCandidate=null;state.scanCandidateCount=0;state.scanAbsentCount=0;
   setText('cameraTopTag',TIPONCamera.label('scan').toUpperCase()+' SCANNING');setText('cameraBottomTag','Scanning automatically — no capture button');
   updateScanResult(enrolled?'Scanning for member':'No enrolled faces',enrolled?'Position one face in the frame. Eligible members are checked against their assigned GPS worksite.':'Camera is live. Enroll member face templates to enable attendance.','neutral');
   scanTick();
 }catch(err){toastError(err,'Scanner unavailable');updateScanResult('Scanner unavailable',err.message,'error');await stopScanner();}
 finally{state.scanBusy=false;$('startCamera').disabled=false;}
}
async function stopScanner(){state.scanRun=(state.scanRun||0)+1;state.scanning=false;stopGPSWatch();if(state.scanTimer){clearTimeout(state.scanTimer);state.scanTimer=null;}const v=$('scanVideo');v.pause();v.srcObject=null;if(state.scanStream){state.scanStream.getTracks().forEach(t=>t.stop());state.scanStream=null;}
 $('cameraIdle').hidden=false;$('startCamera').hidden=state.user?.role==='kiosk';$('stopCamera').hidden=true;setText('cameraTopTag','AWAITING CAMERA');setText('cameraBottomTag','Camera will start automatically when the kiosk opens');
}
async function scanTick(){if(!state.scanning)return;if(!hasTerminalSession()){await stopScanner();updateScanResult('Sign in required','Face Terminal is only for a current approved user or kiosk session.','error');return;}const run=state.scanRun;
 try{
  const video=$('scanVideo');if(video.readyState>=2&&!state.scanBusy){
   const faces=await detectFaces(video);
   if(!state.scanning||state.scanRun!==run)return;
   if(faces.length===0){state.scanCandidate=null;state.scanCandidateCount=0;state.scanAbsentCount++;if(state.scanAbsentCount>=3){state.scanArmed=true;state.lastRecognized=null;}setText('cameraBottomTag','Looking for one face…');}
   else if(faces.length!==1){state.scanCandidate=null;state.scanCandidateCount=0;state.scanAbsentCount=0;updateScanResult('Multiple faces detected','Only one member may appear in the frame at a time.','error');setText('cameraBottomTag','Only one face is allowed');}
   else{
    state.scanAbsentCount=0;const found=nearestMember(faces[0].descriptor);
    if(!found.best||found.best.distance>MATCH_LIMIT||(found.second&&found.second.distance-found.best.distance<AMBIGUITY_GAP)){
      state.scanCandidate=null;state.scanCandidateCount=0;
      const closest=found.best?('Closest registered face: '+found.best.member.name+' (distance '+found.best.distance.toFixed(2)+'; limit '+MATCH_LIMIT.toFixed(2)+').'):'No active enrolled face templates are available on this kiosk.';
      const reason=!found.best?'No enrolled faces':found.best.distance>MATCH_LIMIT?'Face detected, but match confidence is low.':'Face detected, but the closest registered matches are too similar.';
      updateScanResult(reason,closest+' Office GPS is checked after a registered face is identified.','error');
      setText('cameraBottomTag',found.best?('Face detected · closest match '+found.best.member.name+' · '+found.best.distance.toFixed(2)):'Face detected · no enrolled members');
    }else{
      const member=found.best.member;
      if(!state.scanArmed&&state.lastRecognized!==member.id){state.scanArmed=true;}
      if(!state.scanArmed){setText('cameraBottomTag','Scan checked. Move out of frame before trying again.');}
      else {
        if(state.scanCandidate===member.id)state.scanCandidateCount++;else {state.scanCandidate=member.id;state.scanCandidateCount=1;}
        setText('cameraBottomTag',`Face detected: ${member.name}. Checking office GPS…`);
        if(state.scanCandidateCount>=2){state.scanArmed=false;state.lastRecognized=member.id;state.scanCandidate=null;state.scanCandidateCount=0;playTerminalSound('face');await recordRecognizedFace(member,found.best.distance);}
      }
    }
   }
  }
 }catch(e){console.error('Face recognition tick',e);playTerminalSound('error');updateScanResult('Camera processing issue',e.message,'error');}
 finally{if(state.scanning&&state.scanRun===run)state.scanTimer=setTimeout(scanTick,SCAN_DELAY_MS);}
}
async function recordRecognizedFace(member,faceDistance){
 const proof=state.livenessProof;
 state.livenessProof=null;
 if(!proof||proof.memberId!==member.id||proof.scanRun!==state.scanRun||
    !Number.isFinite(proof.at)||Date.now()-proof.at>10000||proof.at>Date.now()){
   updateScanResult('Live Verification Required','Follow the blink and head-turn instructions.','error');
   return;
 }
 if(member.active===false||member.deleted){playTerminalSound('error');speakTerminal('Attendance error. This member is inactive.','error','inactive');showToast('This member is inactive.','error');return;}
 if(!hasTerminalSession()){speakTerminal('Attendance error. Sign in or authorize this kiosk again.','error','session');showToast('Sign in or authorize this kiosk again.','error');return;}
 if(state.scanBusy)return;state.scanBusy=true;const mode=state.scanMode,run=state.scanRun,actorId=state.user.id;
 document.querySelectorAll('.mode-option').forEach(b=>b.disabled=true);
 try{
  await loadCollections();member=state.members.find(m=>m.id===member.id)||member;
  const tx=TIPONCore.transition(state.punches,member.id,mode,Date.now(),COOLDOWN_MS);
  let assignedSites=sitesForMember(member);
  if(!assignedSites.length)throw Error('This member has no assigned work location.');
  if(tx.type==='OUT'){
   if(!assignedSites.some(s=>s.id===tx.last.siteId))throw Error('Time Out must be recorded at the same assigned work location as Time In.');
   assignedSites=assignedSites.filter(s=>s.id===tx.last.siteId);
  }
  assignedSites=assignedSites.filter(site=>TIPONOrgCore.inScope(state.user,site));
  if(!assignedSites.length)throw Error('No assigned work location is available to this attendance account.');
  updateScanResult('Face recognized',`${member.name} · ${member.id}. Checking current GPS against assigned work location(s)…`);
  const gps=await readGPS();
  if(!state.scanning||state.scanRun!==run||state.user?.id!==actorId||!hasTerminalSession()||document.hidden)throw Error('Scanner or session changed before GPS verification completed. Retry with the current camera.');
  if(!Number.isFinite(gps.accuracy)||gps.accuracy<0||Math.abs(Date.now()-gps.timestamp)>30000)throw Error('GPS fix is missing, stale, or invalid. Retry outdoors.');
  if(gps.accuracy>GPS_MAX_ACCURACY)throw Error(`GPS accuracy ${Math.round(gps.accuracy)} m is too poor. Required: ${GPS_MAX_ACCURACY} m or better.`);
  const candidates=assignedSites.map(site=>({site,distance:distanceM(site.lat,site.lng,gps.latitude,gps.longitude)})).sort((x,y)=>x.distance-y.distance);
  const match=candidates.find(x=>x.distance<=150);
  if(!match){const closest=candidates[0];throw Error(`Face recognized: ${member.name}. Nearest assigned work location is ${Math.round(closest.distance)} m away; maximum allowed is 150 m.`);}
  const {site,distance}=match,stamp=new Date();
  const punch={id:uuid(),orgId:state.orgId,siteRev:site.rev||0,deviceId:state.deviceId,timestamp:stamp.toISOString(),day:todayPH(stamp),type:tx.type,
    memberId:member.id,memberName:member.name,coop:member.coop,platform:site.platform,recordedById:state.user.id,siteId:site.id,siteName:site.name,
    siteLat:site.lat,siteLng:site.lng,radius:150,lat:gps.latitude,lng:gps.longitude,
    accuracy:gps.accuracy,distance,faceDistance,performedBy:state.user.username||state.user.name};
  await commitPunch(punch,mode);TIPONAuth?.touchActivity?.();await loadCollections();renderTerminal();renderTerminalLogs();renderDashboard();
  updateScanResult(`TIME ${punch.type} saved`,`${member.name} | ${member.id} | ${site.name} | ${displayTime(stamp)}. Saved on this phone.`,'success');
  playTerminalSound('success');speakTerminal('Time '+(punch.type==='IN'?'in':'out')+' recorded for '+member.name+'.','success','punch:'+punch.id);showToast(`${member.name}: TIME ${punch.type} recorded.`,'success');
  if(navigator.vibrate){try{navigator.vibrate(80);}catch{}}
  if(window.TIPONSync)TIPONSync.kick();
 }catch(err){playTerminalSound('error');updateScanResult('Attendance NOT recorded',err.message,'error');showToast(err.message,'error',6500);}
 finally{state.scanBusy=false;document.querySelectorAll('.mode-option').forEach(b=>b.disabled=false);}
}
function commitPunch(punch,mode){return new Promise((resolve,reject)=>{
 const tx=db.transaction('punches','readwrite'),store=tx.objectStore('punches');let problem;
 const req=store.getAll();req.onsuccess=()=>{try{
   const previous=TIPONCore.normalize(req.result.filter(p=>(p.orgId===state.orgId||!p.orgId)&&!p.reviewStatus),state.deviceId);const action=TIPONCore.transition(previous,punch.memberId,mode,Date.parse(punch.timestamp),COOLDOWN_MS);
   const attendanceDay=action.type==='OUT'?todayPH(new Date(action.last.timestamp)):todayPH(new Date(punch.timestamp));
   if(previous.some(p=>String(p.memberId)===String(punch.memberId)&&p.siteId===punch.siteId&&p.type===action.type&&todayPH(new Date(p.timestamp))===attendanceDay))throw Error('Time '+action.type+' already recorded for this member at this location today.');
   punch.sessionId=action.type==='IN'?punch.id:action.last.sessionId;
   if(action.type==='OUT'){punch.siteName=action.last.siteName;}
   store.add(punch);
 }catch(err){problem=err;tx.abort();}};
 tx.oncomplete=resolve;tx.onabort=()=>reject(problem||tx.error||Error('Attendance transaction aborted.'));tx.onerror=()=>reject(tx.error);
});}
function eyeAspectRatio(points,indices){
 const p=indices.map(i=>points[i]);if(p.some(x=>!x))return null;
 const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),width=d(p[0],p[3]);return width?((d(p[1],p[5])+d(p[2],p[4]))/(2*width)):null;
}
function blinkRatio(face){
 const p=face?.landmarks?.positions;if(!Array.isArray(p)||p.length<48)return null;
 const l=eyeAspectRatio(p,[36,37,38,39,40,41]),r=eyeAspectRatio(p,[42,43,44,45,46,47]);
 return l==null||r==null?null:(l+r)/2;
}
// The previous fixed .17/.22 rule often missed normal (<300ms) blinks on
// slower computers. Calibrate per face and sample quickly without removing the
// live blink requirement. This is a basic liveness check, not spoof-proof.
function advanceEnrollmentBlink(ratio,now=Date.now()){
 if(!Number.isFinite(ratio)||ratio<0.045||ratio>0.60)
  return 'Eye landmarks unclear. Move closer and face the camera in good lighting.';
 const sample=state.enrollBlinkOpen||0;
 if(!state.enrollBlinkClosed){
  if(ratio>=0.10&&ratio<=0.50){
   state.enrollBlinkOpen=Math.max(sample*0.995,ratio);
   state.enrollBlinkBaselineFrames=(state.enrollBlinkBaselineFrames||0)+1;
  }
  if((state.enrollBlinkBaselineFrames||0)<2)
   return 'Keep both eyes open and centered briefly to calibrate blink detection.';
  const baseline=state.enrollBlinkOpen;
  if(ratio<Math.max(0.07,baseline*0.80)&&ratio<baseline*0.85){
   state.enrollBlinkClosed=true;state.enrollBlinkClosedAt=now;
   return 'Closed eyes detected. Open your eyes to confirm the live blink.';
  }
  return 'Face detected. Close BOTH eyes for one second, then open them.';
 }
 const elapsed=now-(state.enrollBlinkClosedAt||now);
 if(elapsed>4500){
  state.enrollBlinkClosed=false;
  return 'Blink timed out. Keep your face centered and blink slowly again.';
 }
 const open=state.enrollBlinkOpen||0.23;
 if(elapsed>80&&ratio>Math.max(0.10,open*0.84)){
  state.enrollBlinkSeen=true;
  return 'Live blink verified. Turn slightly left and right for three face samples.';
 }
 return 'Keep opening your eyes until the live blink check is confirmed.';
}
async function beginEnrollment(){
 if(!canEdit())return;
 const existing=state.editMember;
 if(existing?.active!==false&&existing?.descriptors?.length>=3){
  if(existing.createdBy!==state.user?.id&&!existing.workLocationReassignmentRequired){showToast('Only the approved enrollment User can replace this face.','error');return;}
 }
 const fullName=memberNameFromFields();
  if(!fullName||!$('memberId').value.trim()){showToast('Enter Member ID, Last Name and First Name first.','error');return;}
  $('memberName').value=fullName;
 // Clicking Enroll face is the explicit acknowledgement shown beside the approved biometric privacy notice.
 state.consentAcknowledgedAt=new Date().toISOString();
 if($('memberDialog').open)$('memberDialog').close();if(!$('enrollDialog').open)$('enrollDialog').showModal();state.enrollActive=true;state.enrollCollected=[];state.enrollBlinkClosed=false;state.enrollBlinkSeen=false;state.enrollBlinkOpen=0;state.enrollBlinkBaselineFrames=0;state.enrollBlinkClosedAt=0;
 const run=(state.enrollRun||0)+1;state.enrollRun=run;TIPONCamera.render();
 setText('enrollCount','0 / 3 samples');setText('enrollStatus','Preparing live detection. Face the camera, keep both eyes open briefly, then blink slowly (close for one second and reopen).');$('enrollProgress').style.width='0%';$('retryEnrollment').hidden=true;
 try{await loadFaceModels();if(!state.enrollActive||state.enrollRun!==run)return;
  const stream=await getCameraStream('enroll');if(!state.enrollActive||state.enrollRun!==run||document.hidden){stream.getTracks().forEach(t=>t.stop());return;}state.enrollStream=stream;const v=$('enrollVideo');v.srcObject=stream;await v.play();enrollTick();
 }catch(err){setText('enrollStatus',err.message);$('retryEnrollment').hidden=false;toastError(err,'Enrollment camera');}
}
async function enrollTick(){if(!state.enrollActive)return;const run=state.enrollRun;
 try{
  const v=$('enrollVideo');if(v.readyState>=2){const faces=await detectFaces(v);
   if(!state.enrollActive||state.enrollRun!==run)return;
   if(faces.length!==1){setText('enrollStatus',faces.length?'Only one face may be in view.':'Center one face inside the frame.');}
   else{
     const descriptor=Array.from(faces[0].descriptor);
     if(findEnrolledFaceConflict([descriptor],$('memberId').value.trim())){
       setText('enrollStatus','Face is already enrolled under another Member ID. Enrollment blocked.');
       showToast('This face cannot be enrolled under another name.','error',8000);
       $('retryEnrollment').hidden=false;await stopEnrollment(true);return;
     }
     const ratio=blinkRatio(faces[0]);
     if(!state.enrollBlinkSeen){
       setText('enrollStatus',advanceEnrollmentBlink(ratio));
     }else{
       // Every frame was already checked for collisions before the blink test.
       const previous=state.enrollCollected.at(-1);
       if(previous&&euclidean(previous,descriptor)<.023){
         setText('enrollStatus',state.enrollCollected.length===1?'Turn slightly left for a distinct sample.':'Turn slightly right for a distinct sample.');
       }else{
         state.enrollCollected.push(descriptor);playTerminalSound('success');setText('enrollCount',`${state.enrollCollected.length} / 3 samples`);
         setText('enrollStatus',state.enrollCollected.length===1?'Sample 1 saved. Turn slightly right.':state.enrollCollected.length===2?'Sample 2 saved. Look toward the camera again.':'3 samples collected.');
         $('enrollProgress').style.width=`${state.enrollCollected.length/3*100}%`;
         if(state.enrollCollected.length===3){
           if(findEnrolledFaceConflict(state.enrollCollected,$('memberId').value.trim())){
             setText('enrollStatus','Duplicate face detected. Enrollment blocked.');
             $('retryEnrollment').hidden=false;await stopEnrollment(true);return;
           }
           state.pendingDescriptors=state.enrollCollected;state.faceReplacementPending=!!state.editMember?.template;setText('enrollFaceLabel','Verified · 3 Live Samples Ready to Save');
           playTerminalSound('success');showToast('Live face enrollment complete. Save the member record next.','success');await finishEnrollment(false);return;
         }
       }
     }
   }
  }
 }catch(err){setText('enrollStatus',`Recognition error: ${err.message}`);$('retryEnrollment').hidden=false;}
 if(state.enrollActive&&state.enrollRun===run)state.enrollTimer=setTimeout(enrollTick,state.enrollBlinkSeen?220:90);
}
async function stopEnrollment(keepOpen=false){state.enrollRun=(state.enrollRun||0)+1;state.enrollActive=false;if(state.enrollTimer){clearTimeout(state.enrollTimer);state.enrollTimer=null;}const v=$('enrollVideo');v.pause();v.srcObject=null;if(state.enrollStream){state.enrollStream.getTracks().forEach(x=>x.stop());state.enrollStream=null;}if(!keepOpen&&$('enrollDialog').open)$('enrollDialog').close();}
async function finishEnrollment(cancel){await stopEnrollment();if(cancel)showToast('Face enrollment canceled. Previous samples, if any, were retained.');if(!$('memberDialog').open)$('memberDialog').showModal();}

// Offline pack: assets are fetched once from pinned public CDNs and cached by SW.
let workerUpdateNoticeBound=false;
async function registerWorker(){
 if(!('serviceWorker' in navigator))return;
 try{
  const wasControlled=!!navigator.serviceWorker.controller;
  if(!workerUpdateNoticeBound){
   workerUpdateNoticeBound=true;
   navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(wasControlled){setText('appUpdateStatus','New app files are ready. Finish current work, then use Check published app update.');showToast('App files updated. Finish current work, then reopen the app. Local records are retained.','info',9000);}
   });
  }
  const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
  if(navigator.onLine)await registration.update();
 }catch(err){console.warn('Service worker registration failed:',err.message);}
}
async function openAppUpdater(){
 if(state.scanBusy||state.enrollActive||window.TIPONSync?.isBusy())return showToast('Finish the active scan, enrollment or upload, then check for updates.','info');
 if(document.querySelector('dialog[open]'))return showToast('Save or close the open form before updating.','info');
 if(!navigator.onLine)return showToast('Connect to the internet to check published app files.','info');
 if(!await confirmAction('Check app update?','This stops the camera and reloads app files. Saved attendance, members and pending uploads are retained. You may need to sign in again.'))return;
 await stopScanner();location.assign('./update.html');
}
async function checkOfflineReady(){
 let ok=false,count=0;
 try{if('caches' in window){const store=await caches.open(REMOTE_CACHE);for(const asset of OFFLINE_ASSETS){if(await store.match(asset))count++;}ok=count===OFFLINE_ASSETS.length;}}
 catch(err){console.warn(err);}
 state.offlineReady=ok;
 setText('offlinePackageStatus',ok?`Offline face AI ready (Excel export is built in): ${count}/${OFFLINE_ASSETS.length} files stored on device.`:`Offline resources ${count}/${OFFLINE_ASSETS.length} files downloaded. Internet required to complete first setup.`);
 $('offlineBar').style.width=`${Math.round(count/OFFLINE_ASSETS.length*100)}%`;
 if($('downloadOffline'))$('downloadOffline').textContent=ok?'Re-download / refresh offline package':'Download offline resources';
 if(state.user&&state.page==='dashboard')renderDashboard();return ok;
}
async function installOfflinePack(){
 if(!('caches' in window)){showToast('Service worker/cache storage is unavailable on this browser.','error');return;}
 if(!navigator.onLine){showToast('Connect to the internet for the first offline AI download.','error');return;}
 const btn=$('downloadOffline');btn.disabled=true;const store=await caches.open(REMOTE_CACHE);let done=0;
 try{
  for(const asset of OFFLINE_ASSETS){
   setText('offlinePackageStatus',`Downloading required AI files… ${done}/${OFFLINE_ASSETS.length}`);
   const res=await fetch(asset,{mode:'cors',cache:'reload'});
   if(!res.ok)throw Error(`Cannot download ${asset.split('/').pop()} (${res.status}).`);
   await store.put(asset,res.clone());done++;
   $('offlineBar').style.width=`${done/OFFLINE_ASSETS.length*100}%`;
  }
  const ready=await checkOfflineReady();if(!ready)throw Error('Offline cache verification was incomplete.');
   // Ask the browser to keep encrypted member/attendance data and cached AI
   // through ordinary storage cleanup. Not guaranteed by every browser.
   if(navigator.storage?.persist){
     try{await navigator.storage.persist();}catch(error){console.warn('Persistent storage not granted',error);}
   }
  showToast('Offline face recognition resources cached. Excel export is built in.','success',6500);
 }catch(err){toastError(err,'Offline setup failed');setText('offlinePackageStatus',`${done}/${OFFLINE_ASSETS.length} assets downloaded. Retry while online.`);}
 finally{btn.disabled=false;}
}
async function encryptBackup(passphrase,data){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=260000;const raw=await deriveBytes(passphrase,salt,iterations);const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt']);const bytes=new TextEncoder().encode(JSON.stringify(data));const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes));return {format:'tipon-face-backup',version:1,algorithm:'AES-256-GCM+PBKDF2',salt:b64(salt),iv:b64(iv),iterations,payload:b64(encrypted)};}
async function decryptBackup(passphrase,data){if(data.format!=='tipon-face-backup'||data.version!==1)throw Error('Unsupported backup file.');const keyBytes=await deriveBytes(passphrase,fromB64(data.salt),data.iterations);const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(data.iv)},key,fromB64(data.payload));return JSON.parse(new TextDecoder().decode(plaintext));}
async function saveEncryptedBackup(){if(!isAdmin())return;const pass=prompt('Create a strong passphrase (12+ characters) for the encrypted backup. Do not forget it: the file cannot be restored without it.');if(pass===null)return;if(pass.length<12){showToast('Use a backup passphrase with at least 12 characters.','error');return;}
 const confirm=prompt('Type your backup passphrase again to confirm:');if(pass!==confirm){showToast('Backup passphrases did not match.','error');return;}
 try{const stores=Object.fromEntries(await Promise.all(DB_STORE.map(async name=>[name,await getAll(name)])));stores.users=[];stores.meta=stores.meta.filter(x=>!['googleSheetsSyncV4'].includes(x.id));const encrypted=await encryptBackup(pass,{createdAt:new Date().toISOString(),stores});downloadBlob(`TIPON_Face_Backup_${todayPH()}.json`,new Blob([JSON.stringify(encrypted)],{type:'application/json'}));showToast('Encrypted backup saved. Store it securely.','success');}catch(err){toastError(err,'Backup failed');}
}
async function restoreEncryptedBackup(event){if(!isAdmin())return;if(window.TIPONSync?.isBusy()){showToast('Wait for the current sync attempt to finish before restoring a backup.','error');event.target.value='';return;}const file=event.target.files?.[0];event.target.value='';if(!file)return;const pass=prompt('Enter the passphrase for the encrypted TIPON backup:');if(pass===null)return;
 try{
   const encrypted=JSON.parse(await file.text());const parsed=await decryptBackup(pass,encrypted);
   if(!parsed.stores||!Array.isArray(parsed.stores.members)||!Array.isArray(parsed.stores.sites)||!Array.isArray(parsed.stores.punches))throw Error('Backup contains invalid or incomplete data.');
   const okay=await confirmAction('Replace device data?',`RESTORE WILL OVERWRITE all local enrolled faces, sites, and attendance on this device. Restore from ${file.name}?`);if(!okay)return;
   await stopScanner();if(window.TIPONSync)TIPONSync.disconnect();parsed.stores.users=[];parsed.stores.meta=(parsed.stores.meta||[]).filter(x=>x.id!=='googleSheetsSyncV4');await replaceDB(parsed.stores);await initializeLocal();await enterApp();if(window.TIPONSync)await TIPONSync.init();showToast('Backup restored. Google Sheets must be reconnected in Settings.','success',9500);
 }catch(err){toastError(err,'Backup restore failed');}
}

let directoryRefreshBusy=false;
async function refreshDirectoryView(kind){
 if(directoryRefreshBusy)return;
 if(!navigator.onLine){showToast('Offline: saved records are still available. Connect to the internet to refresh from Google Sheets.','info');return;}
 directoryRefreshBusy=true;
 const button=$(kind==='members'?'memberRefresh':'terminalLogRefresh');
 if(button)button.disabled=true;
 try{
  const sync=await TIPONSync.run();
  if(!sync?.ok)throw Error(sync?.error||'Central synchronization has not completed. Try Refresh again.');
  await loadCollections();
  if(kind==='members')renderMembers();
  else renderTerminalLogs();
  if(sync.pending)showToast('Latest central records loaded. '+sync.pending+' record(s) still need synchronization or review.','info',6500);
  else showToast('Latest central '+(kind==='members'?'member directory':'attendance logs')+' loaded.','success');
 }catch(error){toastError(error,'Refresh failed');}
 finally{directoryRefreshBusy=false;if(button)button.disabled=false;}
}
function bindEvents(){
 document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',()=>showPage(el.dataset.page)));
 document.querySelectorAll('[data-jump]').forEach(el=>el.addEventListener('click',()=>showPage(el.dataset.jump)));
 attach('topStartScan','click',()=>showPage('scanner'));
 attach('memberSearch','input',renderMembers);
 attach('memberRefresh','click',()=>refreshDirectoryView('members'));
 attach('terminalLogRefresh','click',()=>refreshDirectoryView('logs'));
 attach('memberFilterFace','change',renderMembers);
 attach('memberResetFilters','click',()=>{
  $('memberSearch').value='';
  $('memberFilterFace').value='';
  renderMembers();
 });
 ['terminalLogFrom','terminalLogTo','terminalLogCoop','terminalLogPlatform','terminalLogSite'].forEach(id=>attach(id,'change',renderTerminalLogs));attach('terminalLogReset','click',()=>{['terminalLogFrom','terminalLogTo','terminalLogCoop','terminalLogPlatform','terminalLogSite'].forEach(id=>$(id).value='');renderTerminalLogs();});
 attach('terminalLogExport','click',exportTerminalLogs);attach('terminalLogSync','click',()=>TIPONSync.kick());
 attach('kioskFullscreen','click',async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();return;}if(!document.documentElement.requestFullscreen)throw Error('Full screen is unavailable in this browser.');await document.documentElement.requestFullscreen();}catch(e){showToast(e.message,'error');}});
 document.addEventListener('fullscreenchange',()=>document.body.classList.toggle('terminal-fullscreen',!!document.fullscreenElement&&state.page==='scanner'));
 attach('addMember','click',()=>openMemberForm(null));attach('memberRows','click',handleMemberTableClick);
 attach('memberForm','submit',saveMemberForm);
 attach('memberCoop','change',()=>fillMemberSites());attach('memberPlatform','change',()=>fillMemberSites());attach('memberSiteChoices','change',e=>{const cb=e.target.closest('[data-member-site-option]');if(!cb)return;const option=[...$('memberSite').options].find(o=>o.value===cb.dataset.memberSiteOption);if(option)option.selected=cb.checked;updateMemberSite();});
 attach('enrollFaceButton','click',beginEnrollment);
 attach('adminSitePlaceFind','click',findUserSiteAddress);
 attach('siteAddress','keydown',event=>{if(event.key==='Enter'&&canEdit()&&$('siteDialog')?.open){event.preventDefault();void findUserSiteAddress();}});
  attach('retryEnrollment','click',async()=>{await stopEnrollment(true);if($('enrollDialog').open)$('enrollDialog').close();if(!$('memberDialog').open)$('memberDialog').showModal();await beginEnrollment();});
 attach('enrollDialog','cancel',(e)=>{e.preventDefault();finishEnrollment(true);});
 attach('addSite','click',()=>openSiteForm(null));attach('siteCards','click',handleSiteCardsClick);
 attach('siteForm','submit',saveSiteForm);attach('siteUseGps','click',useGpsForSite);
 ['siteLat','siteLng','siteRadius'].forEach(id=>attach(id,'change',updateSiteMap));
 document.querySelectorAll('.close-dialog').forEach(btn=>btn.addEventListener('click',()=>{const dialog=btn.closest('dialog');if(dialog.id==='enrollDialog')finishEnrollment(true);else dialog.close();}));
 attach('confirmCancel','click',()=>resolveConfirm(false));attach('confirmYes','click',()=>resolveConfirm(true));
 attach('confirmDialog','cancel',e=>{e.preventDefault();resolveConfirm(false);});
 attach('startCamera','click',startScanner);attach('stopCamera','click',stopScanner);
 document.querySelectorAll('.mode-option').forEach(btn=>btn.addEventListener('click',()=>{if(state.scanBusy||!['in','out'].includes(btn.dataset.mode))return;state.scanMode=btn.dataset.mode;document.querySelectorAll('.mode-option').forEach(el=>(el.classList.toggle('active',el===btn),el.setAttribute('aria-pressed',String(el===btn))));showToast(`Attendance mode: ${btn.textContent}`);}));
 attach('refreshGps','click',async()=>{try{await readGPS();showToast('Current GPS location refreshed.','success');}catch(err){toastError(err,'GPS check failed');}});
 ['recordFrom','recordTo','recordSite'].forEach(id=>attach(id,'change',renderRecords));
 attach('clearRecordFilters','click',()=>{$('recordFrom').value='';$('recordTo').value='';$('recordSite').value='';renderRecords();});
 attach('exportExcel','click',exportExcel);
 attach('downloadOffline','click',installOfflinePack);attach('verifyOffline','click',async()=>{const ready=await checkOfflineReady();showToast(ready?'All offline AI assets are ready.':'Some offline AI assets are missing. Complete the download while online.',ready?'success':'error');});
 attach('installApp','click',async()=>{if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;}else showToast('To install: Android Chrome → menu → Install app; iPhone Safari → Share → Add to Home Screen.','info',7500);});
 attach('exportBackup','click',saveEncryptedBackup);attach('importBackup','click',()=>{$('importBackupFile').click();});attach('importBackupFile','change',restoreEncryptedBackup);
 window.addEventListener('online',refreshClock);window.addEventListener('offline',refreshClock);
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.scanning)stopScanner();if(document.hidden&&state.enrollActive)finishEnrollment(true);});
}

async function boot(){
 bindEvents();OrgUI.bind();TIPONCamera.bind();TIPONPlatforms.bind();window.TIPONAdminSites?.bind();attach('refreshAppFiles','click',openAppUpdater);registerWorker().catch(console.warn);setInterval(refreshClock,30000);refreshClock();
 if(!window.isSecureContext||!('indexedDB' in window)||!window.crypto?.subtle){$('bootAlert').hidden=false;setText('bootAlert','Open the app using HTTPS (or localhost). Camera, GPS and offline account access need a secure browser.');return;}
 try{db=await openDB();await initializeLocal();await TIPONCamera.init();await TIPONSync.init();await TIPONAuth.init();}
 catch(err){$('bootAlert').hidden=false;setText('bootAlert',`Startup failed: ${err.message}`);console.error(err);}
}
async function initializeLocal(){
 let identity=await getOne('meta','deviceIdentity');if(!identity){identity={id:'deviceIdentity',value:uuid()};await OrgDB.rawSave('meta',identity);}state.deviceId=identity.value;
 const punches=await getAll('punches');
 const normalized=TIPONCore.normalize(punches,state.deviceId);
 for(const p of normalized){const old=punches.find(x=>x.id===p.id);if(!old.deviceId||!old.sessionId)await OrgDB.rawSave('punches',p);}
}
window.addEventListener('DOMContentLoaded',boot);

window.TIPONWorkspaceEnter=(options={})=>enterApp(options);
