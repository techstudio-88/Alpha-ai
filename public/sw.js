const CACHE="alpha-ai-v3";
const APP_SHELL=["/","/manifest.webmanifest"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  // Never serve cached Supabase rows, API status, or signed private media as live results.
  if(event.request.method!=="GET"||url.origin!==self.location.origin||
    !(APP_SHELL.includes(url.pathname)||url.pathname.startsWith("/_next/static/")))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)))}
    return response;
  }).catch(async()=>await caches.match(event.request)||Response.error()));
});
