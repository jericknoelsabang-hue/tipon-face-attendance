/* TIPON 5.5.23 GitHub Pages shell. Application/AI caches only; server bridge posts are never intercepted. */
'use strict';
const VERSION='5.5.23';
const SHELL='tipon-face-shell-v5.5.23-github-only',AI='tipon-face-remote-v1';
const FILES=['./','./index.html','./style.css','./organization.css','./gas-bridge.js','./core.js','./org-core.js','./exporter.js','./app.js','./auth.js','./sync.js','./organization.js','./absenteeism.js','./absenteeism.css','./admin-member-editor.js','./admin-sites.js','./site-scope.js','./camera.js','./platforms.js','./login-workers.webp','./tipon-login-reference-hd.webp','./logo.png','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./manifest.webmanifest'];
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
})()));
self.addEventListener('message',event=>{
  if(!event.source||new URL(event.source.url).origin!==self.location.origin)return;
  if(event.data?.type==='TIPON_RELEASE')event.ports[0]?.postMessage({version:VERSION,shell:SHELL});
  if(event.data?.type==='TIPON_APPLY_UPDATE')event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET')return;
  if(url.origin===self.location.origin&&/\/config\.js$/.test(url.pathname))return;
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
    const cache=await caches.open(SHELL),hit=await cache.match(request,{ignoreSearch:true});if(hit)return hit;
    try{return await fetch(request);}catch{return new Response('Offline: open the installed TIPON home screen.',{status:503,headers:{'Content-Type':'text/plain'}});}
  })());
});
