'use strict';
(() => {
  const bucket='haail-invoices', pendingKey=()=> 'haail_receipt_pending_'+session.user.id;
  const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','application/pdf':'pdf'};
  let sending=false, generation=0;
  async function storage(path,options={}) {
    const r=await fetch(cfg.url+'/storage/v1/'+path,{...options,headers:{apikey:cfg.key,Authorization:'Bearer '+session.access_token,...options.headers}});
    const result=await r.json().catch(()=>({}));if(!r.ok)throw Error(result.message||result.error||'تعذر رفع أو فتح الوصل');return result;
  }
  const oldDaily=sharedDaily;
  sharedDaily=async function(){
    await oldDaily.apply(this,arguments);
    const form=document.getElementById('cloudSpend');if(!form||form.querySelector('[name=payment_kind]'))return;
    const ps=profile.role==='admin'?db.parties.filter(p=>p.type==='debt'):await api('/rest/v1/rpc/haail_accounts',{});
    form.insertAdjacentHTML('afterbegin',`<div><label>طريقة الشراء</label><select name="payment_kind"><option value="cash">نقدي — خصم من المصروف اليومي</option><option value="credit">آجل — ترحيل إلى مكتب الديون</option></select></div><div id="receiptPartyBox" hidden><label>مكتب الديون</label><select name="receipt_party"><option value="">اختر المكتب</option>${ps.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>`);
    form.insertAdjacentHTML('beforeend','<div><label><input name="attach_receipt" type="checkbox" style="width:auto"> إرفاق وصل (اختياري للمصروف النقدي)</label></div><div data-receipt-upload hidden><label>الوصل من الاستوديو أو الملفات (حتى 10 MB)</label><input name="receipt_file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif"></div><div data-receipt-upload hidden><label>تصوير الوصل بالكاميرا</label><input name="receipt_camera" type="file" accept="image/*" capture="environment"></div><p class="muted">تگدر تحفظ المصروف النقدي بدون وصل؛ فعّل إرفاق وصل إذا متوفر. الشراء الآجل يحتاج وصلاً ويُرحّل لدين المكتب دون خصم نقدي.</p>');
    const update=()=>{const credit=form.elements.payment_kind.value==='credit';document.getElementById('receiptPartyBox').hidden=!credit;form.elements.receipt_party.required=credit;const attach=form.elements.attach_receipt;attach.disabled=credit;form.querySelectorAll('[data-receipt-upload]').forEach(el=>el.hidden=!(credit||attach.checked));if(!credit&&!attach.checked){form.elements.receipt_file.value='';form.elements.receipt_camera.value='';}form.querySelector('button[type=submit],button:not([type])').textContent=credit?'حفظ الآجل وترحيله للمكتب':'حفظ وخصم المبلغ';};
    form.elements.payment_kind.onchange=update;form.elements.attach_receipt.onchange=update;update();
    for(const name of ['receipt_file','receipt_camera'])form.elements[name].onchange=()=>{form.elements[name==='receipt_file'?'receipt_camera':'receipt_file'].value='';};
    await mountList();
  };
  const oldEmployee=employee;
  employee=async function(){await oldEmployee.apply(this,arguments);await mountList();};
  async function mountList(){
    if(!document.getElementById('receiptListPanel'))app.insertAdjacentHTML('beforeend','<section id="receiptListPanel" class="panel"><h2>وصولات النقدي والآجل</h2><button type="button" data-receipt-refresh>تحديث الوصولات</button><div id="receiptPending"></div><div id="receiptList"></div></section>');
    const pending=sessionStorage.getItem(pendingKey());
    document.getElementById('receiptPending').innerHTML=pending?'<p class="notice">يوجد وصل بانتظار تأكيد الحفظ. اضغط للتحقق وإكمال نفس العملية بدون تكرار.</p><button type="button" data-receipt-resume>تأكيد الوصل المعلّق</button>':'';
    await loadList();
  }
  async function loadList(){
    const token=++generation,el=document.getElementById('receiptList');if(!el)return;
    el.textContent='جارٍ تحميل الوصولات…';
    try{
      const rows=await api('/rest/v1/haail_daily_receipts?select=*&order=receipt_date.desc,created_at.desc');
      if(token!==generation||!el.isConnected)return;
      el.innerHTML=rows.map(r=>`<article class="panel" style="border:1px solid #dce9e6;margin-top:12px"><b>${r.payment_kind==='credit'?'آجل — تم ترحيله إلى '+esc(r.party_name):'نقدي — تم خصمه من المصروف اليومي'}</b><p>${datefmt(r.receipt_date)} — ${fmt(r.amount)}</p><p>${esc(r.item)} — ${esc(r.details)}</p><button type="button" data-receipt-open="${esc(r.object_path)}">فتح الوصل</button></article>`).join('')||'<p>لا توجد وصولات بعد.</p>';
    }catch(e){if(el.isConnected)el.textContent='تعذر عرض الوصولات: '+e.message;}
  }
  async function commitPending(){
    const text=sessionStorage.getItem(pendingKey());if(!text)return;
    const body=JSON.parse(text);
    await api('/rest/v1/rpc/haail_receipt_record',body);
    sessionStorage.removeItem(pendingKey());
  }
  const oldRecord=recordFund;
  recordFund=async function(event,operation){
    const form=event.target;
    if(operation!=='spend'||!form.elements.payment_kind)return oldRecord.apply(this,arguments);
    event.preventDefault();if(sending)return;
    if(sessionStorage.getItem(pendingKey()))return alert('أكمل تأكيد الوصل المعلّق من أسفل الصفحة أولاً.');
    const file=form.elements.receipt_file.files[0]||form.elements.receipt_camera.files[0],f=new FormData(form),kind=f.get('payment_kind');
    if(kind==='cash'&&!file)return oldRecord.apply(this,arguments);
    if(!file)return alert('أرفق صورة الوصل للشراء الآجل');
    const mime=file.type.toLowerCase()||(/\.heic$/i.test(file.name)?'image/heic':/\.heif$/i.test(file.name)?'image/heif':'');
    if(!types[mime]||file.size<1||file.size>10485760)return alert('اختر صورة أو PDF بحجم لا يتجاوز 10 MB');
    const amount=Number(f.get('amount')),date=f.get('expense_date')||haailToday();
    if(!Number.isSafeInteger(amount)||amount<1||amount>Number.MAX_SAFE_INTEGER||!String(f.get('item')||'').trim()||!String(f.get('details')||'').trim())return alert('تحقق من المبلغ والمادة والتفاصيل');
    if(kind==='credit'&&!f.get('receipt_party'))return alert('اختر مكتب الديون');
    if(!confirm((kind==='credit'?'ترحيل آجل للمكتب: ':'خصم نقدي: ')+fmt(amount)+'؟'))return;
    sending=true;busy(true);let committed=false;
    try{
      const request_id=crypto.randomUUID(),path=session.user.id+'/'+request_id+'.'+types[mime];
      // Storage may leave an unlinked object on failure; no accounting entry is created until RPC commits.
      await storage('object/'+bucket+'/'+path,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:file});
      const body={request_id,receipt_date:date,payment_kind:kind,party_id:kind==='credit'?f.get('receipt_party'):null,amount,item:f.get('item'),details:f.get('details'),object_path:path,original_name:file.name,mime_type:mime,size_bytes:file.size};
      sessionStorage.setItem(pendingKey(),JSON.stringify(body));
      await commitPending();committed=true;
      if(profile.role==='admin')await refreshAdmin();
      form.reset();if(form.elements.expense_date)form.elements.expense_date.value=haailToday();form.elements.payment_kind.dispatchEvent(new Event('change'));
      await refreshFund();await mountList();
      alert(kind==='credit'?'تم حفظ الوصل وترحيل الآجل لحساب المكتب بدون خصم نقدي':'تم حفظ الوصل وخصم المصروف النقدي');
    }catch(e){alert((committed?'العملية محفوظة؛ حدّث العرض. ':'لم يتم تأكيد الحفظ؛ استخدم تأكيد الوصل المعلّق إن ظهر. ')+e.message);await mountList();}
    finally{sending=false;busy(false);}
  };
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-receipt-refresh],[data-receipt-resume],[data-receipt-open]');if(!button)return;
    if(button.hasAttribute('data-receipt-refresh'))return loadList();
    if(button.hasAttribute('data-receipt-resume')){
      if(sending)return;sending=true;busy(true);
      try{await commitPending();if(profile.role==='admin')await refreshAdmin();await refreshFund();await mountList();alert('تم تأكيد الحفظ بدون تكرار');}catch(e){alert('لم يُؤكد الحفظ: '+e.message);}finally{sending=false;busy(false);}return;
    }
    const win=window.open('','_blank');
    if(!win)return alert('اسمح بفتح النافذة لعرض الوصل');
    try{win.opener=null;const r=await storage('object/sign/'+bucket+'/'+button.dataset.receiptOpen,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});win.location.href=cfg.url+'/storage/v1'+r.signedURL;}catch(e){win.close();alert(e.message);}
  });
})();
