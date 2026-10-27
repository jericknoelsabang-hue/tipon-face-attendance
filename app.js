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




async function enterApp(){
  if(typeof TIPONWorkspaceEnter!=='function')throw Error('Workspace module is unavailable. Reload the app files.');
  return TIPONWorkspaceEnter();
}
function applyRoles(){document.querySelectorAll('[data-roles]').forEach(el=>el.hidden=true);}
function refreshClock(){const now=new Date();setText('liveDateTime',now.toLocaleString('en-PH',{timeZone:PH_TIMEZONE,weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));setText('bigDate',now.toLocaleDateString('en-PH',{timeZone:PH_TIMEZONE,weekday:'long',month:'short',day:'numeric',year:'numeric'}));const connected=navigator.onLine;setText('connectionText',connected?'Online / local storage':'Offline / local storage');setText('headerOnlineText',connected?'Network online':state.offlineReady?'Offline ready':'Offline / setup needed');$('onlineDot').className=`status-dot ${connected?'success':'offline'}`;$('headerOnlineDot').className=`status-dot ${connected?'success':'offline'}`;}

const pageNames={dashboard:'Dashboard',scanner:'Face terminal',terminalLogs:'Attendance logs',members:'Member registry',sites:'Work locations',records:'Attendance logs',settings:'Settings & offline'};
async function showPage(page){
  if(!pageNames[page])return;
  if(['members','sites'].includes(page)&&!canEdit())return;
  
  if(state.page==='scanner'&&page!=='scanner')await stopScanner();
  state.page=page;
  document.querySelectorAll('.page').forEach(section=>section.hidden=section.id!==`page-${page}`);
  document.querySelectorAll('[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  setText('crumbTitle',pageNames[page]);window.scrollTo({top:0,behavior:'instant'});
  if(page==='dashboard')renderDashboard();if(page==='scanner'){renderTerminal();if(!state.scanning)startScanner();}if(page==='terminalLogs')renderTerminalLogs();if(page==='members')renderMembers();if(page==='sites'){renderSites();if(typeof renderOfficeDirectory==='function')renderOfficeDirectory();}if(page==='records')renderRecords();if(page==='settings')await checkOfflineReady();
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
function updateScanResult(title,detail,kind='neutral'){const el=$('scanResult');if(!el)return;el.className=`scan-message ${kind}`;el.innerHTML=`${pageIcon(kind==='success'?'check':kind==='error'?'alert':'scan')}<div><b>${esc(title)}</b><p>${esc(detail)}</p></div>`;}

let terminalAudio=null;
function unlockTerminalAudio(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;terminalAudio||=new C();if(terminalAudio.state==='suspended')terminalAudio.resume().catch(()=>{});}catch{}}
document.addEventListener('pointerdown',unlockTerminalAudio,{once:true});document.addEventListener('keydown',unlockTerminalAudio,{once:true});
function playTerminalSound(kind='face'){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;terminalAudio||=new C();if(terminalAudio.state==='suspended')terminalAudio.resume().catch(()=>{});const tones=kind==='success'?[880,1174.66]:kind==='error'?[440,329.63]:[659.25];tones.forEach((hz,i)=>{const t=terminalAudio.currentTime+i*.12,o=terminalAudio.createOscillator(),g=terminalAudio.createGain();o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.14,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+.12);o.connect(g);g.connect(terminalAudio.destination);o.start(t);o.stop(t+.13);});}catch{}}

// Member registry and assigned GPS work locations.
function siteForMember(member){return state.sites.find(s=>s.id===member.siteId)||state.sites.find(s=>member.siteIds?.includes(s.id));}
function sitesForMember(member){const ids=[...(member.siteIds||[]),member.siteId].filter((v,i,x)=>v&&x.indexOf(v)===i);return ids.map(id=>state.sites.find(s=>s.id===id)).filter(Boolean);}
function fillMemberFilter(id,values,placeholder){
 const el=$(id);if(!el)return;const old=el.value,unique=[...new Set(values.filter(Boolean))].sort((x,y)=>String(x).localeCompare(String(y)));
 el.innerHTML='<option value="">'+esc(placeholder)+'</option>'+unique.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
 if(unique.includes(old))el.value=old;
}
function memberEnrollerLabel(member){
 const account=[state.user,...(state.users||[])].find(u=>u&&u.id===(member.createdBy||member.enrolledBy));
 return member.enrolledByUsername||account?.username||account?.name||'Not recorded';
}
function renderMembers(){
 fillMemberFilter('memberFilterCoop',TIPONOrgCore.COOPS,'All cooperatives');
 fillMemberFilter('memberFilterPlatform',[...TIPONPlatforms.names(),...state.sites.map(s=>s.platform),...state.members.map(m=>m.platform)],'All business platforms');
 fillMemberFilter('memberFilterOffice',[...state.offices.map(o=>o.name),...state.sites.map(s=>s.satelliteOffice)],'All offices');
 const q=$('memberSearch').value.trim().toLowerCase(),coop=$('memberFilterCoop')?.value||'',platform=$('memberFilterPlatform')?.value||'',office=$('memberFilterOffice')?.value||'';
 const data=state.members.filter(m=>{
  const sites=sitesForMember(m),name=m.name||'',memberPlatform=m.platform||sites[0]?.platform||'',memberOffices=sites.map(s=>s.satelliteOffice||state.offices.find(o=>o.id===s.officeId)?.name||'');
  return (!q||`${m.id} ${name} ${m.coop}`.toLowerCase().includes(q))&&(!coop||m.coop===coop)&&(!platform||TIPONOrgCore.platformKey(memberPlatform)===TIPONOrgCore.platformKey(platform))&&(!office||memberOffices.includes(office));
 }).sort((x,y)=>(x.name||'').localeCompare(y.name||''));
 setText('memberCountLabel',`${data.length} member${data.length===1?'':'s'}`);
 $('memberRows').innerHTML=data.length?data.map(m=>{const sites=sitesForMember(m),site=sites[0],names=sites.map(x=>x.name).join(', ');return `<tr><td><div class="row-inline"><div class="initial-avatar">${esc(initial(m.name))}</div><div><b>${esc(m.name)}</b><small>ID: ${esc(m.id)}</small></div></div></td><td>${esc(m.coop)}</td><td>${esc(m.platform||site?.platform||'—')}</td><td><b>${esc(names||'Not assigned')}</b><small>${esc(sites.map(x=>x.satelliteOffice||'Office not yet assigned').filter((v,i,x)=>x.indexOf(v)===i).join(', '))}</small><small>${site?'150 m GPS check':'Site missing'}</small></td><td>${esc(memberEnrollerLabel(m))}</td><td><span class="badge ${m.descriptors?.length>=3?'green':'red'}">${m.descriptors?.length>=3?'ENROLLED':'NOT ENROLLED'}</span></td><td><button class="tiny-button" data-member-edit="${esc(m.id)}">Edit</button> <button class="tiny-button delete" data-member-delete="${esc(m.id)}">Delete</button></td></tr>`}).join(''):`<tr><td colspan="7"><div class="empty-state">${pageIcon('users')}No members found. Enroll members to begin recognizing faces.</div></td></tr>`;
}
function fillMemberSites(preferred,keepOffice=false){
 const coop=$('memberCoop').value,preferredIds=(Array.isArray(preferred)?preferred:[preferred]).filter(Boolean),firstSite=state.sites.find(s=>preferredIds.includes(s.id)),previous=keepOffice?$('memberOffice').value:'';
 const offices=state.offices.filter(o=>o.coop===coop);
 $('memberOffice').innerHTML='<option value="">Select satellite office</option>'+offices.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
 const selected=firstSite?.officeId||previous;if(offices.some(o=>o.id===selected))$('memberOffice').value=selected;
 const officeId=$('memberOffice').value,options=state.sites.filter(s=>s.coop===coop&&(!officeId||s.officeId===officeId));
 $('memberSite').innerHTML=options.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} (${s.radius} m)</option>`).join('');
 for(const option of $('memberSite').options)option.selected=preferredIds.includes(option.value);
 $('memberSiteChoices').innerHTML=options.map(s=>`<label class="multi-select-option"><input type="checkbox" data-member-site-option="${esc(s.id)}" ${preferredIds.includes(s.id)?'checked':''}/><span>${esc(s.name)} <small>150 m GPS</small></span></label>`).join('')||'<span class="mini-info">No work locations for this office yet.</span>';
 updateMemberSite();
}
function updateMemberSite(){
 const ids=[...$('memberSite').selectedOptions].map(o=>o.value),sites=ids.map(id=>state.sites.find(s=>s.id===id)).filter(Boolean);
 if(sites[0])$('memberOffice').value=sites[0].officeId||'';
 setText('memberSiteSummary',sites.length?sites.length+' work location(s) selected':'Select one or more work locations');
 setText('assignedSiteDetails',sites.length?sites.map(site=>`${site.name} - ${site.lat.toFixed(6)}, ${site.lng.toFixed(6)} (150 m)`).join(' · '):'Select one or more assigned work locations.');
}
function openMemberForm(member){if(!canEdit())return;if(!state.sites.length){showToast('Create a work location before enrolling a member.','error');showPage('sites');return;}
 state.editMember=member||null;state.pendingDescriptors=member?.descriptors?.map(a=>[...a])||[];state.consentAcknowledgedAt=member?.consentAt||null;
 $('memberForm').reset();setText('memberFormTitle',member?'Edit member':'Enroll new member');$('memberId').disabled=!!member;
 if(member){$('memberId').value=member.id;$('memberName').value=member.name;$('memberCoop').value=member.coop;}
 fillMemberSites(member?.siteIds||member?.siteId);setText('enrollFaceLabel',state.pendingDescriptors.length>=3?'ENROLLED · select Enroll face to replace':'Not enrolled · select Enroll face');$('memberDialog').showModal();
}
async function saveMemberForm(e){e.preventDefault();if(!canEdit())return;
 const id=$('memberId').value.trim(),name=$('memberName').value.trim(),coop=$('memberCoop').value,siteIds=[...$('memberSite').selectedOptions].map(o=>o.value),sites=siteIds.map(id=>state.sites.find(x=>x.id===id)).filter(Boolean),site=sites[0];
 if(!id||!name||!siteIds.length||sites.length!==siteIds.length||sites.some(s=>s.coop!==coop||!s.officeId||s.officeId!==$('memberOffice').value)){showToast('Select the cooperative, satellite office and one or more matching work locations.','error');return;}
 if(!state.editMember&&state.members.some(m=>m.id.toLowerCase()===id.toLowerCase())){showToast('Member ID is already registered.','error');return;}
 if(!state.pendingDescriptors.length||state.pendingDescriptors.length<3){showToast('Complete face enrollment before saving.','error');return;}
 if(!state.consentAcknowledgedAt&&!state.editMember?.consentAt){showToast('Click Enroll face after the member reviews the biometric notice.','error');return;}
 const last=state.punches.find(p=>p.memberId===id);
 if(last?.type==='IN'&&(state.editMember?.siteIds||[state.editMember?.siteId]).some(x=>!siteIds.includes(x))){showToast('Complete Time Out before removing an assigned work location.','error');return;}
 const record={id,name,coop,siteId:siteIds[0],siteIds,satelliteOffice:site.satelliteOffice||'',descriptors:state.pendingDescriptors,consentAt:state.editMember?.consentAt||new Date(state.consentAcknowledgedAt||Date.now()).toISOString(),enrolledBy:state.editMember?.enrolledBy||state.deviceId,enrolledByUsername:state.editMember?state.editMember.enrolledByUsername||'':state.user.username||'',createdAt:state.editMember?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
 try{await saveOne('members',record);await loadCollections();$('memberDialog').close();renderMembers();renderDashboard();showToast(`${name} enrolled successfully.`,'success');}catch(err){toastError(err,'Unable to save member');}
}
async function handleMemberTableClick(e){const edit=e.target.closest('[data-member-edit]');const del=e.target.closest('[data-member-delete]');if(edit){const m=state.members.find(x=>x.id===edit.dataset.memberEdit);if(m)openMemberForm(m);}
 if(del){const m=state.members.find(x=>x.id===del.dataset.memberDelete);if(!m)return;const ok=await confirmAction('Delete member',`Remove ${m.name}'s face template and registry entry on this device? Previous attendance logs are retained.`);if(ok){await deleteOne('members',m.id);await loadCollections();renderMembers();showToast('Member deleted.','success');}}}
function renderSites(){
 $('siteCards').innerHTML=state.sites.length?state.sites.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.coop)}</td><td>${esc(s.platform||'—')}</td><td><div class="site-actions"><button class="tiny-button" data-site-edit="${esc(s.id)}">Edit</button><button class="tiny-button delete" data-site-delete="${esc(s.id)}">Delete</button></div></td></tr>`).join(''):`<tr><td colspan="4"><div class="empty-state">${pageIcon('pin')}No work locations yet. Select “Add work location” to create your first geofence.</div></td></tr>`;
}
function openSiteForm(site){
 state.editSite=site||null;$('siteForm').reset();setText('siteFormTitle',site?'Edit work location':'Add work location');$('siteRadius').value='150';
 if(site){$('siteName').value=site.name;$('siteCoop').value=site.coop;$('siteAddress').value=site.address||'';$('siteLat').value=site.lat;$('siteLng').value=site.lng;$('siteRadius').value=150;}
 fillSiteOffices(site?.officeId);updateSiteMap();$('siteDialog').showModal();
}
function updateSiteMap(){const lat=Number($('siteLat').value),lng=Number($('siteLng').value);const hasLat=$('siteLat').value.trim()!==''&&Number.isFinite(lat)&&Math.abs(lat)<=90,hasLng=$('siteLng').value.trim()!==''&&Number.isFinite(lng)&&Math.abs(lng)<=180;const valid=hasLat&&hasLng;
 if(!valid){$('siteMapFrame').hidden=true;$('mapOffline').hidden=false;$('siteOpenMap').hidden=true;setText('mapCoordLabel','Enter coordinates or use current GPS.');return;}
 setText('mapCoordLabel',`${lat.toFixed(6)}, ${lng.toFixed(6)} · ${$('siteRadius').value||150} m radius`);
 const zoomLat=.010,zoomLng=.015,box=[lng-zoomLng,lat-zoomLat,lng+zoomLng,lat+zoomLat].join(',');
 $('siteOpenMap').href=`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;$('siteOpenMap').hidden=false;
 if(navigator.onLine){const src=`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(box)}&layer=mapnik&marker=${lat}%2C${lng}`;if($('siteMapFrame').src!==src)$('siteMapFrame').src=src;$('siteMapFrame').hidden=false;$('mapOffline').hidden=true;}
 else{$('siteMapFrame').hidden=true;$('mapOffline').hidden=false;}
}
async function saveSiteForm(e){
 e.preventDefault();const lat=Number($('siteLat').value),lng=Number($('siteLng').value),radius=Number($('siteRadius').value);
 if(!$('siteLat').value.trim()||!$('siteLng').value.trim()||!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(radius)||Math.abs(lat)>90||Math.abs(lng)>180||radius<GPS_MIN_RADIUS||radius>2000){showToast('Invalid GPS coordinates or radius.','error');return;}
 const office=state.offices.find(o=>o.id===$('siteOffice').value&&o.coop===$('siteCoop').value);
 if(!office){showToast('Select a satellite office for this cooperative. Add missing offices from an approved masterlist.','error');return;}
 if(state.editSite && state.members.filter(m=>m.siteId===state.editSite.id).some(m=>state.punches.find(p=>p.memberId===m.id)?.type==='IN')){showToast('Complete open Time Out records before changing this worksite.','error');return;}
 const site={id:state.editSite?.id||uuid(),name:$('siteName').value.trim(),coop:$('siteCoop').value,officeId:office.id,satelliteOffice:office.name,address:$('siteAddress').value.trim(),lat,lng,radius,createdAt:state.editSite?.createdAt||new Date().toISOString()};
 if(!site.name){showToast('Location name is required.','error');return;}
 try{await saveOne('sites',site);await loadCollections();$('siteDialog').close();renderSites();renderDashboard();showToast('Work location saved.','success');}catch(err){toastError(err,'Cannot save location');}
}
async function handleSiteCardsClick(e){const edit=e.target.closest('[data-site-edit]');const del=e.target.closest('[data-site-delete]');if(edit){const site=state.sites.find(s=>s.id===edit.dataset.siteEdit);if(site)openSiteForm(site);}
 if(del){const site=state.sites.find(s=>s.id===del.dataset.siteDelete);if(!site)return;if(state.members.some(m=>m.siteId===site.id||(m.siteIds||[]).includes(site.id))){showToast('Reassign or delete enrolled members before deleting their site.','error');return;}const ok=await confirmAction('Delete work location',`Delete ${site.name}? This change will sync to your organization.`);if(ok){await deleteOne('sites',site.id);await loadCollections();renderSites();showToast('Location removed.','success');}}}



function confirmAction(title,body){return new Promise(resolve=>{state.confirmResolver=resolve;setText('confirmTitle',title);setText('confirmBody',body);$('confirmDialog').showModal();});}
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

async function useGpsForSite(){try{setText('mapCoordLabel','Locating your device…');const gps=await readGPS();$('siteLat').value=gps.latitude.toFixed(7);$('siteLng').value=gps.longitude.toFixed(7);updateSiteMap();showToast(`GPS acquired, accuracy ±${Math.round(gps.accuracy)} m.`,'success');}catch(err){toastError(err,'GPS not available');}}

// Worksite coordinates are captured from device GPS; address geocoding has been removed.
// Time logs and Excel export.
function filteredAttendanceRows(){
 const data=TIPONCore.rows(state.punches,state.deviceId);
 return TIPONCore.filterRows(data,$('recordFrom').value,$('recordTo').value,$('recordSite').value);
}
function renderRecords(){
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
 const from=$('terminalLogFrom').value,to=$('terminalLogTo').value,coop=$('terminalLogCoop').value,platform=$('terminalLogPlatform').value,siteId=$('terminalLogSite').value;
 if(from&&to&&from>to)throw Error('From date must not be after To date.');
 return TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)).filter(r=>{
  const stamp=r.timeIn||r.timeOut,day=TIPONCore.phStamp(stamp).slice(0,10);
  return (!from||day>=from)&&(!to||day<=to)&&(!coop||r.coop===coop)&&(!platform||TIPONOrgCore.platformKey(r.platform)===TIPONOrgCore.platformKey(platform))&&(!siteId||r.siteId===siteId);
 });
}
function canCorrectAttendance(){const u=state.user,a=window.TIPONAuth?.current();return !!u&&!!a&&a.account?.id===u.id&&a.orgId===state.orgId&&a.offlineUntil>Date.now()&&(isAdmin()||(u.role==='registrar'&&['supervisor','member supervisor'].includes(String(u.position||'').trim().toLowerCase())));}
function attendanceAccountLabel(row){const ids=row.eventIds||[],uuidPattern=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;const names=state.punches.filter(p=>ids.includes(p.id)).map(p=>{const id=p.recordedById;const known=[state.user,...(state.users||[])].find(u=>u&&u.id===id);const value=p.recordedByUsername||known?.username||p.performedBy;return value&&!uuidPattern.test(String(value))?String(value):'Username unavailable';});return [...new Set(names)].join(' / ')||'—';}
function renderTerminalLogs(){
 if(!$('terminalLogRows'))return;
 if(state.page==='terminalLogs')$('page-terminalLogs').appendChild($('terminalLogPanel'));
 const adminActions=isAdmin();$('terminalLogActionHeader').hidden=!adminActions;
 const sites=[...state.sites],events=state.punches;
 fillLogFilter('terminalLogCoop',[...state.members.map(m=>m.coop),...events.map(p=>p.coop)],'All cooperatives');
 fillLogFilter('terminalLogPlatform',[...state.members.map(m=>m.platform),...sites.map(s=>s.platform),...events.map(p=>p.platform)],'All business platforms');
 fillLogFilter('terminalLogSite',[...sites.map(s=>s.id+'|'+s.name),...events.map(p=>(p.siteId||'')+'|'+(p.siteName||''))].map(x=>x.split('|')[0]+'|'+x.split('|').slice(1).join('|')),'All work locations');
 const siteSelect=$('terminalLogSite'),old=siteSelect.value;
 const siteMap=new Map([...sites.map(s=>[s.id,s.name]),...events.filter(p=>p.siteId).map(p=>[p.siteId,p.siteName])]);
 siteSelect.innerHTML='<option value="">All work locations</option>'+[...siteMap].map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');
 if(siteMap.has(old))siteSelect.value=old;
 try{
  const rows=filteredTerminalLogRows(),table=TIPONExport.table(rows);
  setText('terminalLogCount',rows.length+' attendance session(s)');
  $('terminalLogRows').innerHTML=rows.length?rows.map(row=>'<tr><td>'+esc(row.memberId)+'</td><td>'+esc(TIPONCore.phStamp(row.timeIn||row.timeOut).slice(0,10))+'</td><td>'+esc(TIPONCore.phStamp(row.timeIn).slice(-8))+'</td><td>'+esc(TIPONCore.phStamp(row.timeOut).slice(-8))+'</td><td>'+esc(TIPONCore.phStamp(row.timeOut).slice(0,10))+'</td><td>'+esc(attendanceAccountLabel(row))+'</td>'+(adminActions?'<td><button class="tiny-button" data-attendance-edit="'+esc(row.key)+'" data-in="'+esc(TIPONCore.phStamp(row.timeIn).slice(0,16).replace(' ','T'))+'" data-out="'+esc(TIPONCore.phStamp(row.timeOut).slice(0,16).replace(' ','T'))+'"'+(canCorrectAttendance()?'':' disabled')+'>Edit</button></td>':'')+'</tr>').join(''):'<tr><td colspan="'+(adminActions?7:6)+'">No attendance records match these filters.</td></tr>';
 }catch(err){setText('terminalLogCount',err.message);$('terminalLogRows').innerHTML='<tr><td colspan="8">'+esc(err.message)+'</td></tr>';}
}
async function exportTerminalLogs(){
 const btn=$('terminalLogExport');try{
  const rows=filteredTerminalLogRows();if(!rows.length){showToast('No attendance records to export.','error');return;}
  btn.disabled=true;await new Promise(resolve=>setTimeout(resolve,0));
  const bytes=TIPONExport.xlsx(rows);downloadBlob('TIPON_Attendance_'+todayPH()+'.xlsx',new Blob([bytes],{type:TIPONExport.MIME}));
  showToast('Exported '+rows.length+' attendance session(s).','success');
 }catch(err){toastError(err,'Attendance export');}finally{btn.disabled=false;}
}
async function editAttendanceFromLog(e){const b=e.target.closest('[data-attendance-edit]');if(!b||!canCorrectAttendance())return;const row=TIPONOrgCore.project(state.punches.filter(p=>!p.reviewStatus)).find(x=>x.key===b.dataset.attendanceEdit);if(!row)return;const events=state.punches.filter(p=>row.eventIds.includes(p.id));if(events.some(p=>p.cloudAck||p._pendingOp||p.uploadPayload))return showToast('Synced or queued attendance is read-only. Use the approved server correction process.','error',8500);const reason=prompt('Correction reason (required):');if(!reason?.trim())return;const nextIn=prompt('Time In (local YYYY-MM-DDTHH:MM)',b.dataset.in),nextOut=prompt('Time Out (local YYYY-MM-DDTHH:MM)',b.dataset.out),valid=x=>!x||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x);if(nextIn===null||nextOut===null)return;if(!nextIn)return showToast('Time In is required.','error');if(!valid(nextIn)||!valid(nextOut))return showToast('Use YYYY-MM-DDTHH:MM format.','error');const iso=x=>x?new Date(x+':00+08:00').toISOString():'';const ti=iso(nextIn),to=iso(nextOut);if(ti&&to&&Date.parse(to)<Date.parse(ti))return showToast('Time Out must be after Time In.','error');if(!await confirmAction('Save attendance correction?',row.memberName+' · '+reason.trim()+' · This updates local unsynced punches and saves correction details.'))return;for(const p of events){const stamp=p.type==='IN'?ti:to;if(!stamp){await deleteOne('punches',p.id);continue;}p.timestamp=stamp;p.day=todayPH(new Date(stamp));delete p.uploadPayload;p.correctionReason=reason.trim();p.correctedAt=new Date().toISOString();p.correctedBy=state.user.username||state.user.id;await saveOne('punches',p);}await loadCollections();renderTerminalLogs();renderDashboard();TIPONSync.kick();showToast('Unsynced attendance correction saved.','success');}
function loadScript(url,check){if(check())return Promise.resolve();return new Promise((resolve,reject)=>{const old=document.querySelector(`script[data-remote="${url}"]`);if(old)old.remove();const el=document.createElement('script');el.src=url;el.crossOrigin='anonymous';el.dataset.remote=url;el.onload=()=>resolve();el.onerror=()=>reject(Error(`Could not load ${url.split('/').pop()}. Download offline resources while connected.`));document.body.appendChild(el);});}
async function exportExcel(){
 let data;try{data=filteredAttendanceRows();}catch(err){toastError(err,'Export');return;}
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
 if(member.active===false||member.deleted){playTerminalSound('error');showToast('This member is inactive.','error');return;}
 if(!hasTerminalSession()){showToast('Sign in or authorize this kiosk again.','error');return;}
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
  assignedSites=assignedSites.filter(site=>site.satelliteOffice&&(state.user.role==='kiosk'||TIPONOrgCore.inScope(state.user,site)));
  if(!assignedSites.length)throw Error('No assigned office is available to this attendance account.');
  updateScanResult('Face recognized',`${member.name} · ${member.id}. Checking current GPS against assigned office(s)…`);
  const gps=await readGPS();
  if(!state.scanning||state.scanRun!==run||state.user?.id!==actorId||!hasTerminalSession()||document.hidden)throw Error('Scanner or session changed before GPS verification completed. Retry with the current camera.');
  if(!Number.isFinite(gps.accuracy)||gps.accuracy<0||Math.abs(Date.now()-gps.timestamp)>30000)throw Error('GPS fix is missing, stale, or invalid. Retry outdoors.');
  if(gps.accuracy>GPS_MAX_ACCURACY)throw Error(`GPS accuracy ${Math.round(gps.accuracy)} m is too poor. Required: ${GPS_MAX_ACCURACY} m or better.`);
  const candidates=assignedSites.map(site=>({site,distance:distanceM(site.lat,site.lng,gps.latitude,gps.longitude)})).sort((x,y)=>x.distance-y.distance);
  const match=candidates.find(x=>x.distance<=150);
  if(!match){const closest=candidates[0];throw Error(`Face recognized: ${member.name}. Nearest assigned office is ${Math.round(closest.distance)} m away; maximum allowed is 150 m.`);}
  const {site,distance}=match,stamp=new Date();
  const punch={id:uuid(),orgId:state.orgId,siteRev:site.rev||0,deviceId:state.deviceId,timestamp:stamp.toISOString(),day:todayPH(stamp),type:tx.type,
    memberId:member.id,memberName:member.name,coop:member.coop,platform:site.platform,recordedById:state.user.id,siteId:site.id,siteName:site.name,satelliteOffice:site.satelliteOffice,
    officeId:site.officeId,siteLat:site.lat,siteLng:site.lng,radius:150,lat:gps.latitude,lng:gps.longitude,
    accuracy:gps.accuracy,distance,faceDistance,performedBy:state.user.username||state.user.name};
  await commitPunch(punch,mode);await loadCollections();renderTerminal();renderTerminalLogs();renderDashboard();
  updateScanResult(`TIME ${punch.type} saved`,`${member.name} | ${member.id} | ${site.satelliteOffice} | ${displayTime(stamp)}. Saved on this phone.`,'success');
  playTerminalSound('success');showToast(`${member.name}: TIME ${punch.type} recorded.`,'success');
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
   if(action.type==='OUT'){punch.siteName=action.last.siteName;punch.satelliteOffice=action.last.satelliteOffice||'';}
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
async function beginEnrollment(){
 if(!canEdit())return;
 if(!$('memberName').value.trim()||!$('memberId').value.trim()){showToast('Enter member ID and full name before enrolling the face.','error');return;}
 // Clicking Enroll face is the explicit acknowledgement shown beside the approved biometric privacy notice.
 state.consentAcknowledgedAt=state.editMember?.consentAt||new Date().toISOString();
 if($('memberDialog').open)$('memberDialog').close();if(!$('enrollDialog').open)$('enrollDialog').showModal();state.enrollActive=true;state.enrollCollected=[];state.enrollBlinkClosed=false;state.enrollBlinkSeen=false;
 const run=(state.enrollRun||0)+1;state.enrollRun=run;TIPONCamera.render();
 setText('enrollCount','0 / 3 samples');setText('enrollStatus','Preparing camera and live blink check…');$('enrollProgress').style.width='0%';$('retryEnrollment').hidden=true;
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
     const ratio=blinkRatio(faces[0]);
     if(!state.enrollBlinkSeen){
       if(ratio==null){setText('enrollStatus','Keep one face centered so the live blink check can read both eyes.');}
       else if(ratio<.17){state.enrollBlinkClosed=true;setText('enrollStatus','Blink detected. Open your eyes to complete the live check.');}
       else if(state.enrollBlinkClosed&&ratio>.22){state.enrollBlinkSeen=true;setText('enrollStatus','Live check passed. Turn slightly left for sample 1.');}
       else setText('enrollStatus','Blink once to verify a live face before enrollment.');
     }else{
       const descriptor=Array.from(faces[0].descriptor),match=nearestMember(descriptor);
       if(match.best&&match.best.member.id!==state.editMember?.id&&match.best.distance<.40){
         setText('enrollStatus',`Face may already belong to ${match.best.member.name}. Enrollment blocked.`);$('retryEnrollment').hidden=false;await stopEnrollment(true);return;
       }
       const previous=state.enrollCollected.at(-1);
       if(previous&&euclidean(previous,descriptor)<.035){
         setText('enrollStatus',state.enrollCollected.length===1?'Turn slightly left for a distinct sample.':'Turn slightly right for a distinct sample.');
       }else{
         state.enrollCollected.push(descriptor);playTerminalSound('success');setText('enrollCount',`${state.enrollCollected.length} / 3 samples`);
         setText('enrollStatus',state.enrollCollected.length===1?'Sample 1 saved. Turn slightly right.':state.enrollCollected.length===2?'Sample 2 saved. Look toward the camera again.':'3 samples collected.');
         $('enrollProgress').style.width=`${state.enrollCollected.length/3*100}%`;
         if(state.enrollCollected.length===3){
           state.pendingDescriptors=state.enrollCollected;setText('enrollFaceLabel','ENROLLED · 3 live samples ready to save');
           playTerminalSound('success');showToast('Live face enrollment complete. Save the member record next.','success');await finishEnrollment(false);return;
         }
       }
     }
   }
  }
 }catch(err){setText('enrollStatus',`Recognition error: ${err.message}`);$('retryEnrollment').hidden=false;}
 if(state.enrollActive&&state.enrollRun===run)state.enrollTimer=setTimeout(enrollTick,500);
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

function bindEvents(){
 document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',()=>showPage(el.dataset.page)));
 document.querySelectorAll('[data-jump]').forEach(el=>el.addEventListener('click',()=>showPage(el.dataset.jump)));
 attach('topStartScan','click',()=>showPage('scanner'));
 attach('memberSearch','input',renderMembers);
 ['memberFilterCoop','memberFilterPlatform','memberFilterOffice'].forEach(id=>attach(id,'change',renderMembers));
 ['terminalLogFrom','terminalLogTo','terminalLogCoop','terminalLogPlatform','terminalLogSite'].forEach(id=>attach(id,'change',renderTerminalLogs));attach('terminalLogRows','click',editAttendanceFromLog);
 attach('terminalLogExport','click',exportTerminalLogs);attach('terminalLogSync','click',()=>TIPONSync.kick());
 attach('kioskFullscreen','click',async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();return;}if(!document.documentElement.requestFullscreen)throw Error('Full screen is unavailable in this browser.');await document.documentElement.requestFullscreen();}catch(e){showToast(e.message,'error');}});
 document.addEventListener('fullscreenchange',()=>document.body.classList.toggle('terminal-fullscreen',!!document.fullscreenElement&&state.page==='scanner'));
 attach('addMember','click',()=>openMemberForm(null));attach('memberRows','click',handleMemberTableClick);
 attach('memberForm','submit',saveMemberForm);
 attach('memberCoop','change',()=>fillMemberSites());attach('memberOffice','change',()=>fillMemberSites(undefined,true));attach('memberSiteChoices','change',e=>{const cb=e.target.closest('[data-member-site-option]');if(!cb)return;const option=[...$('memberSite').options].find(o=>o.value===cb.dataset.memberSiteOption);if(option)option.selected=cb.checked;updateMemberSite();});
 attach('enrollFaceButton','click',beginEnrollment);
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
 bindEvents();bindOfficeEvents();OrgUI.bind();TIPONCamera.bind();TIPONPlatforms.bind();attach('refreshAppFiles','click',openAppUpdater);registerWorker().catch(console.warn);setInterval(refreshClock,30000);refreshClock();
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

window.TIPONWorkspaceEnter=()=>enterApp();
