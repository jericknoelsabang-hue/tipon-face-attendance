/* TIPON v5.5.9 — Admin cross-MPC work location list and map coordinate picker.
 * This UI adds no direct database writes: it reuses authorized OrgDB actions.
 * Leaflet and OpenStreetMap are loaded only when an Administrator opens the map.
 */
'use strict';
window.TIPONAdminSites=(()=>{
  const PH_CENTER=[12.8797,121.7740],PH_ZOOM=6;
  const CDN_BASE='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
  let map=null,marker=null,loader=null,lastSearch=0,refreshing=false;
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
  function render(){
    if(!available())return;
    const query=(field('adminSiteSearch')?.value||'').trim().toLowerCase();
    const data=state.sites.filter(site=>!site.deleted)
      .filter(site=>!query||[site.id,site.name,site.coop,site.platform,site.address]
        .join(' ').toLowerCase().includes(query))
      .sort((a,b)=>String(a.coop||'').localeCompare(String(b.coop||''))||
        String(a.name||'').localeCompare(String(b.name||'')));
    setText('adminSiteCount',data.length+' work location'+(data.length===1?'':'s'));
    field('adminSiteRows').innerHTML=data.length?data.map(site=>{
      const lat=Number(site.lat),lng=Number(site.lng);
      const coords=Number.isFinite(lat)&&Number.isFinite(lng)
        ?lat.toFixed(6)+', '+lng.toFixed(6):'Not configured';
      return '<tr>'+
        '<td><b>'+esc(site.name||'—')+'</b></td>'+
        '<td>'+esc(site.coop||'—')+'</td><td>'+esc(site.platform||'—')+'</td>'+
        '<td>'+esc(site.address||'—')+'</td><td><small>'+esc(coords)+'</small></td>'+
        '<td><div class="site-actions">'+
        '<button type="button" class="tiny-button" data-admin-site-edit="'+esc(site.id)+'">Edit</button> '+
        '<button type="button" class="tiny-button delete" data-admin-site-delete="'+esc(site.id)+'">Delete</button>'+
        '</div></td></tr>';
    }).join(''):'<tr><td colspan="6"><div class="empty-state">No matching work locations. Select Add work location to register a new GPS site.</div></td></tr>';
  }
  async function refresh(){
    if(!available()||refreshing)return;
    if(!navigator.onLine){showToast('Connect to the internet to refresh work locations from Google Sheets.','error');return;}
    refreshing=true;const btn=field('adminSitesRefresh');btn.disabled=true;
    try{
      await TIPONSync.run();
      await loadCollections();
      render();
      showToast('Work locations refreshed from the central directory.','success');
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
      await TIPONSync.run();
      await loadCollections();render();
      showToast('Work location deletion submitted and synchronized.','success');
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
    if(!available()||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))||Math.abs(lat)>90||Math.abs(lng)>180)return;
    field('siteLat').value=Number(lat).toFixed(7);
    field('siteLng').value=Number(lng).toFixed(7);
    setPin(Number(lat),Number(lng),{zoom});
    updateSiteMap();
    setText('adminSiteMapHint','GPS selected: '+Number(lat).toFixed(7)+', '+Number(lng).toFixed(7)+'. Verify the location and radius before saving.');
    setText('fullMapCoordinates',Number(lat).toFixed(7)+', '+Number(lng).toFixed(7));
  }
  function syncFromInputs(){
    if(!available()||!field('siteDialog')?.open)return;
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
  async function findPlace(){
    if(!available()||!field('siteDialog')?.open)return;
    const q=field('siteAddress').value.trim();
    if(q.length<3){setText('adminSiteMapHint','Enter a complete address or recognizable landmark in Address / Site Description, then select Find on Map.');field('siteAddress').focus();return;}
    if(!navigator.onLine){setText('adminSiteMapHint','Internet is needed to search the address. Exact GPS coordinates can still be entered manually.');return;}
    if(Date.now()-lastSearch<1200){setText('adminSiteMapHint','Search requests are limited. Try again shortly.');return;}
    lastSearch=Date.now();const button=field('adminSitePlaceFind');button.disabled=true;
    setText('adminSiteMapHint','Searching for the address: '+q+'…');
    try{
      const response=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q='+encodeURIComponent(q),
       {method:'GET',headers:{Accept:'application/json'}});
      if(!response.ok)throw Error('Location search unavailable (HTTP '+response.status+').');
      const hits=await response.json();
      if(!Array.isArray(hits)||!hits.length)throw Error('No matching Philippine location was found. Zoom and choose a point manually.');
      const {lat,lon,display_name}=hits[0];
      setCoordinates(Number(lat),Number(lon),true);
      if(!map)await openMap();
      setText('adminSiteMapHint','Found '+String(display_name).slice(0,180)+'. Latitude and Longitude are filled. Check the map preview, adjust if necessary, and Save Location.');
      showToast('Address located. GPS coordinates have been filled.','success');
    }catch(error){setText('adminSiteMapHint',error.message);showToast(error.message,'error');}
    finally{button.disabled=false;}
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
    attach('adminSiteSearch','input',render);
    attach('adminSitesRefresh','click',refresh);
    attach('adminSiteRows','click',async event=>{
      if(!available())return;
      const edit=event.target.closest('[data-admin-site-edit]');
      const del=event.target.closest('[data-admin-site-delete]');
      if(edit){const site=state.sites.find(s=>s.id===edit.dataset.adminSiteEdit);if(site)openSiteForm(site);return;}
      if(del){const site=state.sites.find(s=>s.id===del.dataset.adminSiteDelete);if(site)await deleteSite(site);}
    });
    attach('adminSitePlaceFind','click',findPlace);
     attach('siteMapPreview','click',event=>{
       if(!available()||!field('siteDialog')?.open||field('siteFullMapDialog')?.open)return;
       if(event.target.closest('button,a,input,select'))return;
       void openFullMap();
     });
    attach('siteAddress','keydown',e=>{if(e.key==='Enter'&&available()){e.preventDefault();void findPlace();}});
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
