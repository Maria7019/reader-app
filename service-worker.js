'use strict';
const CACHE='inkly-shell-v1';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.svg','./icon-512.svg','./supabase-config.js','./security-core.js','./indexeddb-store.js','./vault-runtime.js','./vault-ui.js','./auth-session-store.js','./auth-rest.js','./cloud-sync.js','./auth-ui.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  // Never intercept or cache Supabase auth, database, or encrypted sync traffic.
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy))}
      return response;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  if(request.destination==='script'||request.destination==='style'||request.destination==='image'||request.destination==='font'||/\\.(?:js|svg|webmanifest)$/.test(url.pathname)){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}
      return response;
    }).catch(()=>caches.match(request)));
  }
});
