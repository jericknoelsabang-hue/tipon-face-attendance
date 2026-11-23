/* TIPON 5.5.141 GitHub Pages shell. Application/AI caches only; server bridge posts are never intercepted. */
'use strict';
const VERSION='5.5.141';
const SHELL='tipon-face-shell-v5.5.141-github-only',AI='tipon-face-remote-v1';
const FILES=['./polish.css','./coop-logos.svg','./','./index.html','./config.js','./liveness-guard.js','./timesheet-preview.js','./style.css','./organization.css','./gas-bridge.js','./core.js','./org-core.js','./exporter.js','./app.js','./auth.js','./sync.js','./organization.js','./absenteeism.js','./absenteeism.css','./admin-member-editor.js','./member-location-capability.js','./admin-sites.js','./site-scope.js','./paygroups.js','./paygroups.css','./camera.js','./platforms.js','./logo.png','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(SHELL);
  // Atomic precache: a missing file fails installation, keeping the old worker usable.
  await cache.addAll(FILES.map(path=>new Request(new URL(path,self.location.href),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Never change IndexedDB, localStorage, account keys or offline AI cache here.
  await Promise.all((await caches.keys()).filter(k=>k.startsWith('tipon-face-shell-')&&k!==SHELL).map(k=>caches.delete(k)));
  await self.clients.claim();
  // Open tabs pick up the new app on their next reload.
})()));
self.addEventListener('message',event=>{
  if(!event.source||new URL(event.source.url).origin!==self.location.origin)return;
  if(event.data?.type==='TIPON_RELEASE')event.ports[0]?.postMessage({version:VERSION,shell:SHELL});
  if(event.data?.type==='TIPON_APPLY_UPDATE')event.waitUntil(self.skipWaiting());
});
self.addEventListener('sync',event=>{
  if(event.tag!=='tipon-attendance-sync')return;
  event.waitUntil((async()=>{
    // Tokens stay in the active page's memory; wake an open app to upload.
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients)client.postMessage({type:'TIPON_SYNC_REQUEST'});
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET')return;
  // The public Apps Script endpoint is needed even when restoring a cached offline
  // session. Network-first keeps configuration current; the shell is the fallback.
  if(url.origin===self.location.origin&&/\/config\.js$/.test(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(SHELL);
      try{
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2500);
        let response;
        try{response=await fetch(request,{cache:'no-store',signal:controller.signal});}
        finally{clearTimeout(timeout);}
        if(response.ok){await cache.put(request,response.clone());return response;}
        return (await cache.match(request,{ignoreSearch:true}))||response;
      }catch{
        return (await cache.match(request,{ignoreSearch:true}))||
          new Response('Offline configuration unavailable.',{status:503,headers:{'Content-Type':'text/plain'}});
      }
    })());
    return;
  }
  if(url.origin===self.location.origin&&/\/(?:sw\.js|release\.json|update\.html|update\.js)$/.test(url.pathname))return;
  if(url.origin!==self.location.origin){
    if(url.origin==='https://cdn.jsdelivr.net'&&(url.pathname.startsWith('/npm/face-api.js@0.22.2/')||url.pathname.startsWith('/gh/justadudewhohacks/face-api.js@0.22.2/weights/'))){
      event.respondWith((async()=>{const cache=await caches.open(AI),hit=await cache.match(request);if(hit)return hit;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;})());
    }
    return;
  }
  if(url.pathname.includes('/vendor/')){
    event.respondWith((async()=>{const cache=await caches.open(AI),hit=await cache.match(request);if(hit)return hit;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;})());return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(SHELL);
    if (/\.(?:js|css|png)$/.test(url.pathname) && /^\?v=\d+$/.test(url.search)) {
      const versionedAsset = await cache.match(request);
      if (versionedAsset) return versionedAsset;
    }
    const hit = await cache.match(request, {ignoreSearch:true});
    try{const response=await fetch(request);if(response.ok){await cache.put(request,response.clone());return response;}if(hit)return hit;return response;}catch{if(hit)return hit;return new Response('Offline: open the installed TIPON home screen.',{status:503,headers:{'Content-Type':'text/plain'}});}
  })());
});
