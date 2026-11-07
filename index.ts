import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
const cors={'Access-Control-Allow-Origin':(Deno.env.get('HAAIL_SITE_ORIGIN') || 'https://omaradnan1717-stack.github.io'),'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
const base=Deno.env.get('SUPABASE_URL')!;
const db=createClient(base,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const must=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data;};
function validSubscription(s:any){
 try{const u=new URL(s.endpoint);return u.protocol==='https:' && !u.username && !u.password && !u.port && ['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com','notify.windows.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)) && typeof s.keys?.p256dh==='string' && /^[A-Za-z0-9_-]{80,100}$/.test(s.keys.p256dh) && /^[A-Za-z0-9_-]{20,30}$/.test(s.keys.auth);}catch{return false;}
}
async function send(uid:string,data:any){
 const member=must(await db.from('haail_users').select('user_id').eq('user_id',uid).maybeSingle());if(!member)return {sent:0,failed:0};
 const devices=must(await db.from('haail_push_links').select('endpoint,subscription').eq('user_id',uid));
 let sent=0,failed=0;
 await Promise.all(devices.map(async(d:any)=>{try{
  if(!validSubscription(d.subscription))throw Error('Invalid subscription');
  await webpush.sendNotification(d.subscription,JSON.stringify(data),{TTL:3600,timeout:10000});sent++;
 }catch(e){failed++;if([404,410].includes((e as any).statusCode))await db.from('haail_push_links').delete().eq('endpoint',d.endpoint);}}));return {sent,failed};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('',{headers:cors});
 if(req.method!=='POST')return response({error:'Method not allowed'},405);
 try{
  const publicKey=Deno.env.get('VAPID_PUBLIC_KEY'),privateKey=Deno.env.get('VAPID_PRIVATE_KEY'),subject=Deno.env.get('VAPID_SUBJECT');
  if(!publicKey||!privateKey||!subject)return response({error:'يلزم إعداد مفاتيح الإشعارات على الخادم'},503);
  webpush.setVapidDetails(subject,publicKey,privateKey);
  const payload=await req.json();
  const hookSecret=Deno.env.get('HAAIL_WEBHOOK_SECRET');
  if(hookSecret && req.headers.get('x-haail-webhook-secret')===hookSecret){
   if(payload.type!=='INSERT'||payload.table!=='haail_notice_events')return response({error:'Invalid event'},400);
   const event=must(await db.from('haail_notice_events').select('*').eq('id',payload.record?.id).single());
   return response(await send(event.recipient,{id:event.id,title:event.title,body:event.body}));
  }
  const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');if(!token)return response({error:'Unauthorized'},401);
  const auth=await db.auth.getUser(token);if(auth.error||!auth.data.user)return response({error:'Unauthorized'},401);
  const uid=auth.data.user.id;
  const member=must(await db.from('haail_users').select('role').eq('user_id',uid).maybeSingle());
  if(!member||!['admin','employee'].includes(member.role))return response({error:'Forbidden'},403);
  switch(payload.action){
   case 'public-key':return response({publicKey});
   case 'subscribe':{
    if(!validSubscription(payload.subscription))return response({error:'Invalid subscription'},400);
    must(await db.from('haail_push_links').upsert({endpoint:payload.subscription.endpoint,user_id:uid,subscription:payload.subscription,updated_at:new Date().toISOString()},{onConflict:'endpoint'}));return response({ok:true});
   }
   case 'unsubscribe':must(await db.from('haail_push_links').delete().eq('endpoint',payload.endpoint).eq('user_id',uid));return response({ok:true});
   case 'test':return response(await send(uid,{id:crypto.randomUUID(),title:'تجربة إشعارات هيل',body:'هذا إشعار تجربة لحسابك على هيل.'}));
   default:return response({error:'Unknown action'},400);
  }
 }catch(e){console.error('haail-notify failed',e instanceof Error?e.message:'Unknown');return response({error:'تعذر إكمال طلب الإشعارات؛ تحقق من إعداد الخدمة وسجل الخادم'},500);}
});
