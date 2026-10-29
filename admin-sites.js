/* TIPON v5.5.9 — Admin cross-MPC work location list and map coordinate picker.
 * This UI adds no direct database writes: it reuses authorized OrgDB actions.
 * Leaflet and OpenStreetMap are loaded only when an Administrator opens the map.
 */
'use strict';
window.TIPONAdminSites=(()=>{
  const PH_CENTER=[12.8797,121.7740],PH_ZOOM=6;
  const CDN_BASE='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
  let map=null,marker=null,loader=null,lastSearch=0,refreshing=false,suggestTimer=null,suggestSeq=0;
  const field=id=>document.getElementById(id);
  function available(){return isAdmin()&&state.user?.role==='admin';}
  function selectedCoordinates(){
    const latitudeText=field('siteLat')?.value.trim()||'';
    const longitudeText=field('siteLng')?.value.trim()||'';
    if(!latitudeText||!longitudeText)return null;
    const lat=Number(latitudeText),lng=Number(longitudeText);
    return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180
      ?{lat,lng}:null;
  }
  const PAGE_SIZE=10;
  let sitePage=1;
  function render(){
    if(!available())return;
    const query=(field('adminSiteSearch')?.value||'').trim().toLowerCase();
    const data=state.sites.filter(site=>!site.deleted)
      .filter(site=>!query||[site.id,site.name,site.coop,site.platform,site.address]
        .join(' ').toLowerCase().includes(query))
      .sort((a,b)=>String(a.coop||'').localeCompare(String(b.coop||''))||
        String(a.name||'').localeCompare(String(b.name||'')));
    const total=data.length,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
    sitePage=Math.max(1,Math.min(sitePage,pages));
    const first=(sitePage-1)*PAGE_SIZE;
    const page=data.slice(first,first+PAGE_SIZE);
    setText('adminSiteCount',total+' work location'+(total===1?'':'s'));
    setText('adminSitePageCount',total?'Showing '+(first+1)+'–'+(first+page.length)+' of '+total+' work locations':'0 work locations');
    setText('adminSitePage','Page '+sitePage+' of '+pages);
    field('adminSitePrev').disabled=sitePage<=1;
    field('adminSiteNext').disabled=sitePage>=pages;
    field('adminSiteRows').innerHTML=page.length?page.map(site=>{
      const lat=Number(site.lat),lng=Number(site.lng);
      const coords=Number.isFinite(lat)&&Number.isFinite(lng)
        ?lat.toFixed(6)+', '+lng.toFixed(6):'Not configured';
      return '<tr>'+
        '<td><b'+(site._pendingOp?
          ' title="Central confirmation is pending. Open Settings & Offline for sync diagnostics."':'')+
          '>'+esc(site.name||'—')+'</b></td>'+
        '<td>'+esc(site.coop||'—')+'</td><td>'+esc(site.platform||'—')+'</td>'+
        '<td>'+esc(site.address||'—')+'</td><td><small>'+esc(coords)+'</small></td>'+
        '<td><div class="site-actions">'+
        '<button type="button" class="tiny-button" data-admin-site-edit="'+esc(site.id)+'">Edit</button> '+
        '<button type="button" class="tiny-button delete" data-admin-site-delete="'+esc(site.id)+'">Delete</button>'+
        '</div></td></tr>';
    }).join(''):'<tr><td colspan="6"><div class="empty-state">'+
      (query?'No Work Locations match your search.':'No Work Locations are registered yet.')+
      '</div></td></tr>';
    // The Business Platforms table shares this Admin page, not the Sites data store.
    TIPONPlatforms.renderDirectory?.();
  }
  async function refresh(){
    if(!available()||refreshing)return;
    if(!navigator.onLine){showToast('Connect to the internet to refresh work locations from Google Sheets.','error');return;}
    refreshing=true;const btn=field('adminSitesRefresh');btn.disabled=true;
    try{
      const result=await TIPONSync.submitPendingNow();
      if(!result?.ok)throw Error(result?.error||'Organization synchronization did not complete.');
      await loadCollections();
      render();
      showToast('Work Locations refreshed from the central directory.','success');
    }catch(error){toastError(error,'Could not refresh work locations');}
    finally{refreshing=false;btn.disabled=false;}
  }
  const deletingSites=new Set();
  const assignedMembers=(members,siteId)=>(members||[]).some(member=>!member.deleted&&
    (String(member.siteId||'')===String(siteId)||
      Array.isArray(member.siteIds)&&member.siteIds.some(x=>String(x)===String(siteId))));

  function describeSiteError(error){
    const code=String(error?.code||'').toUpperCase();
    const message=String(error?.message||error||'The central server did not confirm this request.');
    if(code==='DEPENDENCY'||code==='OPEN_SESSION'||/reassign members|complete time out|open time in/i.test(message))
      return 'This Work Location is assigned to a member or has an open attendance session. Reassign members and complete Time Out before deleting.';
    if(code==='CONFLICT'||/record changed|revision conflict/i.test(message))
      return 'This location changed on the server. Refresh Work Locations and retry. No local deletion was made.';
    if(code==='AUTH')return 'The Administrator session expired or was revoked. Sign in again, then retry. No deletion was applied.';
    if(code==='FORBIDDEN')return 'The active server account is not authorized to delete Work Locations as an Administrator. No deletion was applied.';
    if(code==='ACCOUNT'||code==='DEVICE_DISABLED')return 'This account or device is disabled or not approved. No deletion was applied.';
    if(code==='NETWORK'||!navigator.onLine)
      return 'Internet connection to the organization is unavailable. Your Work Locations have not been deleted.';
    if(code==='TIMEOUT'||/timeout|did not respond/i.test(message))
      return 'The server response timed out. The app will check the authoritative directory before another deletion is attempted.';
    return message;
  }

  /**
   * Admin catalog includes ALL authorized sites on cursor zero, and members in
   * pages of 50. Check all pages so inactive/imported members also count as
   * dependents; the older backend checked only enrolled members.
   */
  async function centralSiteSnapshot(siteId){
    let cursor=0,version=null,remote=null,dependents=0,pages=0;
    do{
      const reply=await TIPONAPI.call({action:'catalog',cursor});
      if(!Array.isArray(reply.sites)||!Array.isArray(reply.members))
        throw Error('Central directory returned an incomplete catalog. Deletion was not attempted.');
      if(version===null)version=reply.catalogVersion;
      if(reply.catalogVersion!==version)
        throw Object.assign(Error('The central member directory changed during verification. Refresh and try again.'),{code:'CONFLICT'});
      if(cursor===0)remote=reply.sites.find(x=>x.id===siteId)||null;
      dependents+=(reply.members||[]).filter(m=>!m.deleted&&
        (m.siteId===siteId||Array.isArray(m.siteIds)&&m.siteIds.includes(siteId))).length;
      cursor=reply.nextCursor;
      pages++;
      if(cursor!==null&&(pages>=100||!Number.isFinite(Number(cursor))))
        throw Error('The central member directory is too large to verify safely in this operation.');
    }while(cursor!==null);
    return {remote,dependents,version};
  }

  /**
   * Commit the confirmed tombstone and remove only THIS site operation from
   * IndexedDB in one atomic transaction. Never purge a different User's edits.
   */
  async function finishSiteDeletion(site,server,oldOp){
    const record={...site,...server,orgId:state.orgId,deleted:true,active:false};
    delete record._pendingOp;delete record.syncIssue;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(['sites','outbox'],'readwrite');
      tx.objectStore('sites').put(record);
      if(oldOp&&oldOp.type==='sites'&&oldOp.value?.id===site.id&&oldOp.ownerId===state.user?.id)
        tx.objectStore('outbox').delete(oldOp.id);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||Error('Could not update the local directory.'));
      tx.onabort=()=>reject(tx.error||Error('Local deletion transaction was aborted.'));
    });
    await loadCollections();
    render();
    TIPONSync.kick();
  }

  async function deleteSite(site){
    if(!available()||!site||deletingSites.has(site.id))return;
    deletingSites.add(site.id);
    let releasePause=null;
    try{
      if(assignedMembers(state.members,site.id))
        throw Object.assign(Error('This Work Location still has assigned members. Reassign them before deletion.'),{code:'DEPENDENCY'});

      const approve=await confirmAction('Delete Work Location?',
        'Delete '+String(site.name||'this Work Location')+'? The organization will verify dependencies and retain attendance history.');
      if(!approve)return;

      if(!navigator.onLine){
        const local=await getOne('sites',site.id);
        if(!local||local.deleted)return;
        if(local._pendingOp)throw Error('Sync the existing Work Location edit before deleting it.');
        const opId=uuid(),original={...local};
        const value={...local,id:site.id,deleted:true,active:false,updatedAt:new Date().toISOString()};
        for(const fieldName of ['_row','_pendingOp','syncIssue','descriptors','templateError','pendingDelete'])delete value[fieldName];
        const op={id:opId,type:'siteDeletes',value:{siteId:site.id,site:value,original},baseRev:Number(local.rev)||0,
          orgId:state.orgId,ownerId:state.user.id,createdAt:new Date().toISOString(),everSent:false};
        const pending={...local,deleted:true,active:false,pendingDelete:true,_pendingOp:opId};
        await new Promise((resolve,reject)=>{const tx=db.transaction(['sites','outbox'],'readwrite');tx.objectStore('sites').put(pending);tx.objectStore('outbox').put(op);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
        await loadCollections();render();TIPONSync.kick();
        showToast('Deletion queued locally. The organization will verify assignments when online.','info',8500);
        return;
      }

      // Pausing this site's outbox is essential: unrelated rejected member
      // changes must not block deletion or cause a second in-flight create.
      releasePause=TIPONSync.pauseSite(site.id);
      await TIPONSync.waitUntilIdle();

      const local=await getOne('sites',site.id);
      if(local?.orgId&&local.orgId!==state.orgId)
        throw Object.assign(Error('This Work Location belongs to a different organization. It was not changed.'),{code:'ORG'});
      if(!local||local.deleted&&!local._pendingOp){
        await loadCollections();render();
        showToast('This Work Location is already removed from the local directory.','info',6500);
        return;
      }
      const oldOp=local._pendingOp?await getOne('outbox',local._pendingOp):null;
      if(local._pendingOp&&(!oldOp||oldOp.type!=='sites'||oldOp.value?.id!==site.id))
        throw Error('This Work Location has an inconsistent pending edit. No deletion was attempted. Use Settings & Offline to review the queued record.');
      if(oldOp&&oldOp.ownerId!==state.user?.id)
        throw Error('A different account owns a pending change to this Work Location. That account must synchronize or review its draft before deletion.');

      await TIPONAuth.ensureOnline();
      const snapshot=await centralSiteSnapshot(site.id);
      if(snapshot.dependents||assignedMembers(state.members,site.id))
        throw Object.assign(Error('This Work Location still has assigned members. Reassign members first.'),{code:'DEPENDENCY'});
      if(snapshot.remote?.deleted){
        // The deletion already reached the server on an earlier request.
        await finishSiteDeletion(local,snapshot.remote,oldOp);
        showToast('Work Location deletion confirmed in the central directory.','success',7000);
        return;
      }

      // If a local create was never accepted, a deleted:true tombstone with
      // baseRev 0 makes the server reject any delayed create for the same ID.
      // Otherwise, delete the authoritative server revision (not stale local).
      const authoritative=snapshot.remote||local;
      const baseRev=snapshot.remote?Number(snapshot.remote.rev)||0:0;
      const opId=uuid();
      const value={...authoritative,id:site.id,deleted:true,active:false,updatedAt:new Date().toISOString()};
      for(const fieldName of ['_row','_pendingOp','syncIssue','descriptors','templateError'])
        delete value[fieldName];

      let reply;
      try{
        reply=await TIPONAPI.call({action:'submit',
          operations:[{id:opId,type:'sites',baseRev,value}],events:[]});
      }catch(error){
        // The server may have applied the write while the acknowledgement
        // was lost. Verify by lastOpId rather than assuming success.
        if(['TIMEOUT','NETWORK'].includes(String(error.code||''))){
          const check=await centralSiteSnapshot(site.id);
          if(check.remote?.deleted&&check.remote.lastOpId===opId){
            await finishSiteDeletion(local,check.remote,oldOp);
            showToast('Work Location deletion verified centrally after a delayed server reply.','success',8000);
            return;
          }
        }
        throw error;
      }
      const rejected=(reply.operationErrors||[]).find(x=>x.id===opId);
      if(rejected)throw Object.assign(Error(rejected.error||'Server rejected the Work Location deletion.'),{code:rejected.code||'SERVER'});
      const acknowledged=Array.isArray(reply.ackOps)&&reply.ackOps.includes(opId);
      const receipt=(reply.receipts||[]).find(x=>x.type==='sites'&&x.id===site.id);
      if(!acknowledged||!receipt||Number(receipt.rev)!==baseRev+1){
        const check=await centralSiteSnapshot(site.id);
        if(!check.remote?.deleted||check.remote.lastOpId!==opId)
          throw Error('The server did not provide a matching deletion receipt. No local deletion was made. Refresh Work Locations before retrying.');
        await finishSiteDeletion(local,check.remote,oldOp);
      }else{
        await finishSiteDeletion(local,{...value,rev:Number(receipt.rev),lastOpId:opId},oldOp);
      }
      showToast('Work Location deleted centrally. Unconfirmed edits for this location were reconciled; attendance history is retained.','success',8000);
    }catch(error){
      showToast(describeSiteError(error),'error',9500);
    }finally{
      if(releasePause)releasePause();
      deletingSites.delete(site.id);
    }
  }
  async function loadLeaflet(){
    if(window.L?.map)return window.L;
    if(loader)return loader;
    if(!navigator.onLine)throw Error('Internet required to load the interactive map. You can still enter exact coordinates.');
    loader=new Promise((resolve,reject)=>{
      if(!document.querySelector('link[data-tipon-leaflet]')){
        const link=document.createElement('link');link.rel='stylesheet';
        link.href=CDN_BASE+'leaflet.css';link.dataset.tiponLeaflet='1';
        document.head.appendChild(link);
      }
      const script=document.createElement('script');
      script.src=CDN_BASE+'leaflet.js';script.async=true;
      script.crossOrigin='anonymous';
      script.onload=()=>window.L?.map?resolve(window.L):reject(Error('Leaflet map library was not available.'));
      script.onerror=()=>reject(Error('Map library could not be loaded. Check your internet access.'));
      document.head.appendChild(script);
    }).catch(error=>{loader=null;throw error;});
    return loader;
  }
  function setPin(lat,lng,{zoom=false}={}){
    if(!map||!window.L)return;
    if(!marker){
      marker=window.L.marker([lat,lng],{draggable:true,autoPan:true}).addTo(map);
      marker.on('dragend',()=>{const p=marker.getLatLng();setCoordinates(p.lat,p.lng,false);});
    }else marker.setLatLng([lat,lng]);
    if(zoom)map.setView([lat,lng],Math.max(map.getZoom(),15));
  }
  function setCoordinates(lat,lng,zoom=false){
    if(!(available()||canEdit())||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))||Math.abs(lat)>90||Math.abs(lng)>180)return;
    field('siteLat').value=Number(lat).toFixed(7);
    field('siteLng').value=Number(lng).toFixed(7);
    setPin(Number(lat),Number(lng),{zoom});
    updateSiteMap();
    setText('adminSiteMapHint','GPS selected: '+Number(lat).toFixed(7)+', '+Number(lng).toFixed(7)+'. Verify the location and radius before saving.');
    setText('fullMapCoordinates',Number(lat).toFixed(7)+', '+Number(lng).toFixed(7));
  }
  function syncFromInputs(){
    if(!(available()||canEdit())||!field('siteDialog')?.open)return;
    const point=selectedCoordinates();
    if(point)setPin(point.lat,point.lng);
  }
  async function openMap(){
    if(!available()||!field('siteDialog')?.open)return;
    field('siteDialog').classList.add('admin-location-dialog');
    field('siteUseGps').hidden=true;
    field('adminSiteMapTools').hidden=false;
    field('adminMapCanvas').hidden=false;
    field('siteMapPreview').classList.add('admin-picker');
    if(!field('siteMapPreview').classList.contains('map-fallback')){
      field('mapOffline').hidden=true;field('siteMapFrame').hidden=true;
    }
    setText('adminSiteMapHint','Click the map to select a GPS point or drag its pin. Map searching requires internet; coordinates can also be entered manually.');
    try{
      const L=await loadLeaflet();
      field('siteMapPreview').classList.remove('map-fallback');
      if(!available()||!field('siteDialog')?.open)return;
      if(!map){
        map=L.map('adminMapCanvas',{zoomControl:true,scrollWheelZoom:false});
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
          attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
          maxZoom:19
        }).addTo(map);
        map.on('click',event=>setCoordinates(event.latlng.lat,event.latlng.lng,false));
      }
      const point=selectedCoordinates();
      if(point){map.setView([point.lat,point.lng],15);setPin(point.lat,point.lng);}
      else {map.setView(PH_CENTER,PH_ZOOM);if(marker){map.removeLayer(marker);marker=null;}}
      requestAnimationFrame(()=>map.invalidateSize());
    }catch(error){
      // Never silently use the Admin's actual location as a fallback.
      setText('adminSiteMapHint',error.message+' Enter latitude and longitude manually instead.');
      field('adminMapCanvas').hidden=true;
      field('siteMapPreview').classList.add('map-fallback');
      const hasPoint=!!selectedCoordinates();
      field('mapOffline').hidden=hasPoint;
      if(hasPoint)updateSiteMap();
    }
  }
  // Photon supports autocomplete; the public Nominatim instance explicitly
  // prohibits client-side autocomplete. Throttle and cache Photon requests.
  const PHOTON_ENDPOINT='https://photon.komoot.io/api/';
  const placeCache=new Map();
  let placeController=null;
  const canSearchPlaces=()=>!!field('siteDialog')?.open&&(available()||canEdit());
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function describePlace(p){
    const street=[p.housenumber,p.street].filter(Boolean).join(' ');
    const fields=[p.name,street,p.district,p.city,p.county,p.state,p.country];
    const seen=new Set();
    return fields.filter(x=>{const k=String(x||'').trim().toLowerCase();if(!k||seen.has(k))return false;seen.add(k);return true;}).join(', ');
  }
  async function queryPlaces(query,limit=5,signal){
    const key=query.trim().toLowerCase(),found=placeCache.get(key);
    if(found&&Date.now()-found.time<240000)return found.items.slice(0,limit);
    const delay=Math.max(0,1300-(Date.now()-lastSearch));
    if(delay)await pause(delay);
    if(signal?.aborted)return [];
    const url=PHOTON_ENDPOINT+'?q='+encodeURIComponent(query.trim())+'&countrycode=PH&limit='+Math.max(1,Math.min(5,limit))+'&lang=en';
    lastSearch=Date.now();
    const response=await fetch(url,{method:'GET',signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('Address suggestions are temporarily unavailable (HTTP '+response.status+').');
    const data=await response.json(),unique=new Set(),items=[];
    for(const feature of data.features||[]){
      const coords=feature.geometry?.coordinates||[],lat=Number(coords[1]),lon=Number(coords[0]);
      const label=describePlace(feature.properties||{});
      if(!label||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<4||lat>22||lon<116||lon>128)continue;
      const id=lat.toFixed(5)+'|'+lon.toFixed(5)+'|'+label.toLowerCase();
      if(unique.has(id))continue;unique.add(id);
      items.push({lat,lon,display_name:label});
    }
    placeCache.set(key,{time:Date.now(),items});
    if(placeCache.size>40)placeCache.delete(placeCache.keys().next().value);
    return items.slice(0,limit);
  }
  function closeSuggestions(){
    const box=field('siteAddressSuggestions');
    if(box){box.hidden=true;box.replaceChildren();}
  }
  function pickPlace(item){
    const address=field('siteAddress');
    if(address)address.value=item.display_name;
    closeSuggestions();
    setCoordinates(Number(item.lat),Number(item.lon),true);
    if(available()&&!map)void openMap();
    setText('adminSiteMapHint','Address selected. Verify the map pin and GPS coordinates before saving.');
  }
  function showSuggestions(items){
    const box=field('siteAddressSuggestions');if(!box)return;
    box.replaceChildren();
    for(const item of items){
      const button=document.createElement('button');
      button.type='button';button.className='site-address-suggestion';button.setAttribute('role','option');
      button.textContent=String(item.display_name||'').slice(0,220);
      button.addEventListener('click',()=>pickPlace(item));
      box.append(button);
    }
    box.hidden=!items.length;
  }
  function suggestPlaces(){
    clearTimeout(suggestTimer);placeController?.abort();placeController=null;
    const query=field('siteAddress')?.value.trim()||'',seq=++suggestSeq;
    if(!canSearchPlaces()||query.length<3||!navigator.onLine){closeSuggestions();return;}
    suggestTimer=setTimeout(async()=>{
      if(seq!==suggestSeq||!canSearchPlaces())return;
      const controller=new AbortController();placeController=controller;
      try{
        const hits=await queryPlaces(query,5,controller.signal);
        if(seq!==suggestSeq||controller.signal.aborted)return;
        showSuggestions(hits);
      }catch(error){
        if(seq===suggestSeq&&error?.name!=='AbortError')closeSuggestions();
      }
    },650);
  }
  async function findPlace(){
    if(!canSearchPlaces())return;
    const q=field('siteAddress')?.value.trim()||'';
    if(q.length<3){setText('adminSiteMapHint','Enter at least three characters in Address / Site Description.');field('siteAddress')?.focus();return;}
    if(!navigator.onLine){setText('adminSiteMapHint','Connect to the internet to search an address, or enter GPS coordinates manually.');return;}
    clearTimeout(suggestTimer);placeController?.abort();placeController=null;
    const seq=++suggestSeq,button=field('adminSitePlaceFind');if(button)button.disabled=true;
    setText('adminSiteMapHint','Searching for '+q+'...');
    try{
      const hits=await queryPlaces(q,5);
      if(seq!==suggestSeq)return;
      if(!hits.length){setText('adminSiteMapHint','No exact place found. Add the city or barangay to your search, or choose a pin manually.');return;}
      pickPlace(hits[0]);
      if(available()&&!map)await openMap();
      showToast('Location found. Latitude and Longitude have been filled.','success',5000);
    }catch(error){
      setText('adminSiteMapHint','Address service unavailable. Select a point on the map or enter GPS coordinates.');
      showToast('Address search is unavailable. You can still select a GPS point manually.','info');
    }finally{if(button)button.disabled=false;}
  }
  function restoreMapCanvas(){
    const canvas=field('adminMapCanvas'),preview=field('siteMapPreview');
    if(!canvas||!preview)return;
    if(canvas.parentElement!==preview)preview.insertBefore(canvas,preview.firstChild);
    if(map)requestAnimationFrame(()=>map.invalidateSize());
  }
  function closeFullMap(){
    const overlay=field('siteFullMapDialog');
    if(overlay?.open)overlay.close();
    restoreMapCanvas();
  }
  async function openFullMap(event){
    if(!available()||!field('siteDialog')?.open)return;
    event?.preventDefault();
    try{
      await openMap();
      if(!map)throw Error('The interactive map is unavailable. Verify internet access or enter coordinates manually.');
      const overlay=field('siteFullMapDialog');
      const canvas=field('adminMapCanvas');
      if(!overlay||!canvas)throw Error('The full-map panel is unavailable. Reload the latest app files.');
      field('siteFullMapMount').appendChild(canvas);
      const point=selectedCoordinates();
      setText('fullMapCoordinates',point?point.lat.toFixed(7)+', '+point.lng.toFixed(7):'Click the map to select a GPS point.');
      overlay.showModal();
      requestAnimationFrame(()=>map.invalidateSize());
    }catch(error){showToast(error.message,'error');restoreMapCanvas();}
  }
  function bind(){
    attach('adminSiteAdd','click',()=>{if(available())openSiteForm(null);});
    attach('adminSiteSearch','input',()=>{sitePage=1;render();});
    attach('adminSitePrev','click',()=>{if(sitePage>1){sitePage--;render();}});
    attach('adminSiteNext','click',()=>{sitePage++;render();});
    attach('adminSitesRefresh','click',refresh);
    attach('adminSiteRows','click',async event=>{
      if(!available())return;
      const edit=event.target.closest('[data-admin-site-edit]');
      const del=event.target.closest('[data-admin-site-delete]');
      if(edit){const site=state.sites.find(s=>s.id===edit.dataset.adminSiteEdit);if(site)openSiteForm(site);return;}
      if(del){const site=state.sites.find(s=>s.id===del.dataset.adminSiteDelete);if(site)await deleteSite(site);}
    });
    attach('adminSitePlaceFind','click',findPlace);
    attach('siteAddress','input',suggestPlaces);
    attach('siteAddress','blur',()=>setTimeout(closeSuggestions,180));
    attach('siteAddressSuggestions','mousedown',event=>event.preventDefault());
     attach('siteMapPreview','click',event=>{
       if(!available()||!field('siteDialog')?.open||field('siteFullMapDialog')?.open)return;
       if(event.target.closest('button,a,input,select'))return;
       void openFullMap();
     });
    attach('siteAddress','keydown',e=>{if(e.key==='Enter'&&available()){e.preventDefault();const first=field('siteAddressSuggestions')?.querySelector('button');if(first)first.click();else void findPlace();}if(e.key==='Escape')closeSuggestions();});
    attach('siteLat','change',syncFromInputs);attach('siteLng','change',syncFromInputs);
    attach('siteOpenMap','click',event=>{
       if(!available())return;
       if(field('siteMapPreview')?.classList.contains('map-fallback'))return;
       event.preventDefault();void openFullMap(event);
     });
    attach('closeFullMap','click',closeFullMap);
    attach('useSelectedMapLocation','click',()=>{
      if(!selectedCoordinates()){showToast('Select a location by clicking the map first.','info');return;}
      closeFullMap();
    });
    attach('siteFullMapDialog','cancel',event=>{event.preventDefault();closeFullMap();});
    attach('siteDialog','close',closeFullMap);
  }
  return {bind,render,openMap,openFullMap,closeFullMap,selectedCoordinates,syncFromInputs,refresh};
})();
