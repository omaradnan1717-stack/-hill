'use strict';
(() => {
  let pending=false, activeUser=null, pollBusy=false, generation=0;
  const allowed=()=>session?.user?.id && ['admin','employee'].includes(profile?.role);
  // Removed sections stay archived in the saved data and backups.
  const beforeGo=go;
  go=function(t){if(['suppliers','advances'].includes(t))return;return beforeGo(t);};
  const beforeParties=parties;
  parties=function(type){if(['supplier','advance'].includes(type))return '';return beforeParties(type);};
  async function request(action,extra={}) {
    if(!allowed())throw Error('سجّل الدخول أولاً');
    return api('/functions/v1/haail-notify',{action,...extra});
  }
  function keyBytes(s){const v=s.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(v+'='.repeat((4-v.length%4)%4)),c=>c.charCodeAt(0));}
  function status(s){const el=document.getElementById('haailNotifyStatus');if(el)el.textContent=s;}
  async function enable(){
    if(pending)return;
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return alert('بالآيفون: أضف البرنامج للشاشة الرئيسية وافتحه من الأيقونة، ثم فعّل الإشعارات.');
    const uid=session.user.id;pending=true;
    try{
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw Error('اسمح بالإشعارات من إعدادات الجهاز ثم أعد المحاولة');
      const {publicKey}=await request('public-key');
      if(!publicKey)throw Error('خدمة الإرسال غير مفعلة بعد');
      await navigator.serviceWorker.register('./haail-sw.js',{scope:'./'});
      const reg=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('تعذر تشغيل خدمة الإشعارات')),20000))]);
      let sub=await reg.pushManager.getSubscription();
      if(sub && Array.from(new Uint8Array(sub.options.applicationServerKey||[])).join()!==Array.from(keyBytes(publicKey)).join()){await sub.unsubscribe();sub=null;}
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
      if(session?.user?.id!==uid)throw Error('تغيّر الحساب، أعد التفعيل');
      await request('subscribe',{subscription:sub.toJSON()});
      status('تم ربط هذا الجهاز بحسابك. اضغط تجربة إشعار للتأكد من الوصول.');
    }catch(e){status('تعذر التفعيل: '+e.message);}finally{pending=false;}
  }
  async function disable(){
    try{const reg=await navigator.serviceWorker?.getRegistration('./');const sub=await reg?.pushManager.getSubscription();if(sub){await request('unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}status('تم إيقاف إشعارات هذا الجهاز');}catch(e){status(e.message);}
  }
  function mount(){
    const uid=allowed()?session.user.id:null;
    if(uid!==activeUser){activeUser=uid;generation++;}
    if(!uid){document.getElementById('haailNotifyPanel')?.remove();return;}
    if(document.getElementById('haailNotifyPanel'))return;
    const panel=document.createElement('section');panel.id='haailNotifyPanel';panel.className='panel no-print';
    panel.innerHTML='<h2>🔔 الإشعارات بين الإدارة والموظف</h2><div class="actions"><button data-notify-enable>تفعيل على هذا الجهاز</button><button data-notify-test>تجربة إشعار</button><button class="light" data-notify-disable>إيقاف على هذا الجهاز</button><button class="light" data-notify-refresh>تحديث السجل</button></div><p id="haailNotifyStatus" role="status">فعّل الإشعارات مرة من حسابك على كل جهاز.</p><div id="haailNotifyInbox"></div>';
    app.after(panel);poll();
  }
  async function poll(){
    if(!allowed()||pollBusy||document.hidden)return;
    const uid=session.user.id,g= generation;pollBusy=true;
    try{
      const rows=await api('/rest/v1/haail_notice_events?select=id,title,body,created_at&order=created_at.desc,id.desc&limit=30');
      if(uid!==session?.user?.id||g!==generation)return;
      const el=document.getElementById('haailNotifyInbox');if(!el)return;
      el.innerHTML=rows.length?rows.map(r=>`<p><b>${esc(r.title)}</b><br>${esc(r.body)}<br><small>${esc(new Date(r.created_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'}))}</small></p>`).join(''):'<p class="muted">لا توجد إشعارات جديدة بعد التحديث.</p>';
    }catch(e){status('سجل الإشعارات غير متاح: '+e.message+' — يلزم تشغيل تحديث الإشعارات في قاعدة البيانات.');}finally{pollBusy=false;}
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-notify-enable],[data-notify-test],[data-notify-disable],[data-notify-refresh]');if(!b||!allowed())return;
    if(b.hasAttribute('data-notify-enable'))return enable();
    if(b.hasAttribute('data-notify-disable'))return disable();
    if(b.hasAttribute('data-notify-refresh'))return poll();
    b.disabled=true;try{const r=await request('test');status(r.sent>0?'أُرسل إشعار تجربة لهذا الحساب؛ تأكد من ظهوره بالجهاز.':'لم يصل الإرسال لأي جهاز. أعد التفعيل.');}catch(e){status('تعذر إرسال التجربة: '+e.message);}finally{b.disabled=false;}
  });
  const beforeLogout=logout;
  logout=function(){generation++;activeUser=null;document.getElementById('haailNotifyPanel')?.remove();return beforeLogout();};
  new MutationObserver(mount).observe(nav,{childList:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){mount();poll();}});
  setInterval(poll,10000);mount();
})();
