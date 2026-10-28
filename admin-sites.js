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
        '<td><b>'+esc(site.name||'—')+'</b>'+(site._pendingOp?
          '<small class="mini-info" style="display:block;color:'+(site.syncIssue?'#ba7520':'#58749b')+'" title="'+esc(site.syncIssue||'Automatic sync will retry')+'">'+
          (site.syncIssue?'Needs Review':'Syncing…')+'</small>':'')+'</td>'+
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
  async function deleteSite(site){
    if(!available()||!site)return;
    if(state.members.some(m=>!m.deleted&&(m.siteId===site.id||Array.isArray(m.siteIds)&&m.siteIds.includes(site.id)))){
      showToast('This site is assigned to members. Reassign those members before deleting it.','error',8000);return;
    }
    const ok=await confirmAction('Delete work location?',
      'Remove '+site.name+' from the central directory? This may affect registered kiosks assigned to its GPS location. Attendance history will be retained.');
    if(!ok)return;
    try{
      await deleteOne('sites',site.id);
      await loadCollections();render();
      const result=await TIPONSync.submitPendingNow();
      if(!result?.ok)throw Error(result?.error||'Work Location deletion is not yet confirmed.');
      await loadCollections();render();
      showToast('Work Location deletion submitted and synchronized.','success');
    }catch(error){toastError(error,'Deletion not confirmed; check Settings > Pending changes');}
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
