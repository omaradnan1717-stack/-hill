'use strict';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
  let d={};try{d=e.data?.json()||{};}catch(_){d={body:'تم تسجيل حركة جديدة في هيل'};}
  e.waitUntil(self.registration.showNotification(d.title||'مطعم هيل',{body:d.body||'حركة جديدة',tag:d.id||'haail-activity',lang:'ar',dir:'rtl',data:{url:new URL('./',self.registration.scope).href}}));
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil((async()=>{const url=new URL('./',self.registration.scope).href;for(const c of await self.clients.matchAll({type:'window',includeUncontrolled:true})){if(c.url.startsWith(url)&&'focus' in c)return c.focus();}return self.clients.openWindow(url);})());});
