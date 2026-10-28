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
  function memberUsesSite(siteId){
    return state.members.some(member=>!member.deleted&&
      (member.siteId===siteId||Array.isArray(member.siteIds)&&member.siteIds.includes(siteId)));
  }
  function deleteErrorText(error){
    const code=String(error?.code||'').toUpperCase(),detail=String(error?.message||error||'Unknown error');
    if(code==='CONFLICT'||/record changed|revision conflict/i.test(detail))
      return 'The Work Location changed on another device. Refresh the list, then try again.';
    if(code==='DEPENDENCY'||/reassign members|assigned to members|open Time Out|open time in/i.test(detail))
      return 'Cannot delete this Work Location while members or open attendance sessions depend on it. Reassign members and complete Time Out first.';
    if(code==='TIMEOUT'||/did not respond|timed out/i.test(detail))
      return 'The server reply timed out. No local deletion was made. Refresh Work Locations to check whether the server processed it before retrying.';
    if(code==='NETWORK'||code==='SETUP'||!navigator.onLine)
      return 'The central server is unavailable. No deletion was made. Connect to the internet and try again.';
    if(code==='FORBIDDEN'||code==='AUTH'||code==='AUTHZ')
      return 'Your session or account is not authorized to delete this Work Location. Sign in again with an approved Administrator account.';
    return detail;
  }
  /**
   * The older deleteOne('sites') marks a site locally as deleted before the
   * outbox gets an ACK; repeating it while _pendingOp.everSent is true fails.
   * For Admin deletion use the already-deployed, authenticated submit API
   * directly, and update the local cache ONLY after the exact operation ACK.
   */
  async function deleteSite(site){
    if(!available()||!site||deletingSites.has(site.id))return;
    deletingSites.add(site.id);
    try{
      if(!navigator.onLine){
        showToast('Internet connection is required to delete Work Locations centrally. No records were changed.','error',7500);
        return;
      }
      let current=await getOne('sites',site.id);
      if(!current||current.deleted){
        await loadCollections();render();
        showToast('This Work Location is no longer in the active directory.','info',6500);
        return;
      }
      // Resolve previously queued edits before creating another revision.
      if(current._pendingOp){
        const queued=await getOne('outbox',current._pendingOp);
        if(queued&&queued.ownerId!==state.user?.id){
          showToast('This Work Location has a pending edit owned by another account. Its owner must synchronize that edit first.','info',8500);
          return;
        }
        const syncResult=await TIPONSync.submitPendingNow();
        current=await getOne('sites',site.id);
        if(!current||current.deleted&&!current._pendingOp){
          await loadCollections();render();
          showToast('The previously queued Work Location deletion is now reflected in the directory.','success',7500);
          return;
        }
        if(current._pendingOp){
          const pending=await getOne('outbox',current._pendingOp);
          const reason=pending?.error||current.syncIssue||syncResult?.error;
          showToast(reason?
            'Cannot delete while a prior Work Location change is unconfirmed: '+String(reason).slice(0,190)+'. Resolve it in Settings & Offline.':
            'The previous Work Location change is still awaiting central confirmation. Sync it before deleting.','info',10000);
          return;
        }
        if(!syncResult?.ok){
          showToast('Could not verify the latest Work Location record. Refresh and try again.','info',8500);
          return;
        }
      }
      if(memberUsesSite(site.id)){
        showToast('This Work Location is assigned to members. Reassign those members before deleting it.','error',8500);
        return;
      }
      const ok=await confirmAction('Delete Work Location?',
        'Permanently remove '+current.name+' from the active organization directory? Existing attendance history is retained. This cannot proceed while members or open attendance sessions depend on the location.');
      if(!ok)return;
      // Reread the exact record and revision AFTER confirmation to prevent
      // using a stale selection or overwriting a concurrent local edit.
      current=await getOne('sites',site.id);
      if(!current||current.deleted||current._pendingOp)
        throw Object.assign(Error('This location changed while the confirmation was open. Refresh before deleting.'),{code:'CONFLICT'});
      if(memberUsesSite(site.id))
        throw Object.assign(Error('The site is still assigned to members.'),{code:'DEPENDENCY'});
      const opId=uuid(),baseRev=Number(current.rev)||0;
      const wire={...current,deleted:true,active:false,updatedAt:new Date().toISOString()};
      for(const key of ['_row','_pendingOp','syncIssue','descriptors','templateError'])
        delete wire[key];
      // No optimistic tombstone; the server checks active dependents,
      // admin authorization and base revision, then writes its audit log.
      const response=await TIPONAPI.call({action:'submit',
        operations:[{id:opId,type:'sites',value:wire,baseRev}],events:[]});
      const failure=(response.operationErrors||[]).find(x=>x.id===opId);
      if(failure)throw Object.assign(Error(failure.error||'Central deletion rejected.'),{code:failure.code||'SERVER'});
      if(!Array.isArray(response.ackOps)||!response.ackOps.includes(opId))
        throw Error('The central server did not acknowledge this deletion. Refresh to verify the latest state.');
      const receipt=(response.receipts||[]).find(x=>x.type==='sites'&&x.id===site.id);
      if(!receipt||Number(receipt.rev)!==baseRev+1)
        throw Error('The deletion receipt was incomplete. Refresh Work Locations before trying again.');
      const latest=await getOne('sites',site.id);
      if(latest?._pendingOp)
        throw Error('A concurrent pending edit appeared after server confirmation. Refresh Work Locations to reconcile it.');
      const tombstone={...latest,...wire,rev:Number(receipt.rev),deleted:true,active:false,orgId:state.orgId};
      delete tombstone._pendingOp;delete tombstone.syncIssue;
      await OrgDB.rawSave('sites',tombstone);
      await loadCollections();render();
      TIPONSync.kick();
      showToast('Work Location deleted and confirmed by the central organization. Attendance history was retained.','success',7500);
    }catch(error){
      const detail=deleteErrorText(error);
      showToast(detail,'error',9000);
      // A timeout may have occurred after a successful server write; refresh
      // the authoritative catalog rather than submitting another delete.
      if(error?.code==='TIMEOUT'||error?.code==='CONFLICT')TIPONSync.kick();
    }finally{
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
