const CACHE='kakeibo-v2-3';
const DEXIE='https://unpkg.com/dexie@3.2.4/dist/dexie.js';
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(['./','./index.html','./app.js','./config.js','./manifest.webmanifest']);
  try{const response=await fetch(DEXIE,{mode:'no-cors'});await cache.put(DEXIE,response);}catch(e){console.warn('Dexie offline cache unavailable',e);}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin&&url.href!==DEXIE)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{const response=await fetch(event.request);if(response.ok||response.type==='opaque')await cache.put(event.request,response.clone());return response;}
    catch(e){const cached=await cache.match(event.request);if(cached)return cached;throw e;}
  })());
});
