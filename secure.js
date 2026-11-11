'use strict';
let cfg=window.HAAIL_CONFIG||JSON.parse(localStorage.getItem('haail_cloud_config')||'null'), session=JSON.parse(sessionStorage.getItem('haail_session')||'null'), profile=null, revision=0, committed=null, materials=[],accounts=[];
const app=document.getElementById('app'),nav=document.getElementById('nav');
function busy(on){let el=document.getElementById('busy');if(on&&!el){el=document.createElement('div');el.id='busy';el.textContent='جارٍ الحفظ…';el.style='position:fixed;inset:0;background:#ffffffdd;z-index:10000;display:grid;place-items:center';document.body.append(el)}if(!on)el?.remove()}
async function api(path,body,method){const r=await fetch(cfg.url+path,{method:method||(body?'POST':'GET'),headers:{apikey:cfg.key,Authorization:'Bearer '+(session?.access_token||cfg.key),'Content-Type':'application/json',...(path.startsWith('/rest/v1/') ? {Prefer:'return=representation'} : {})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json().catch(()=>null);if(!r.ok)throw Error(v?.message||v?.error_description||'تعذر الاتصال');return v}
function gate(){nav.innerHTML='';app.innerHTML=`<section class="panel"><h2>دخول الإدارة والموظفين</h2><p>الحفظ مشترك والصلاحيات تُطبّق بقاعدة البيانات.</p><form id="login"><div><label>اسم المستخدم</label><input name="username" autocomplete="username" autocapitalize="none" dir="ltr" pattern="[a-zA-Z][a-zA-Z0-9_.-]{2,31}" required></div><div><label>كلمة المرور</label><input name="password" type="password" autocomplete="current-password" required></div><button>دخول</button></form><details ${cfg?'class="hidden"':''} style="margin-top:20px"><summary>إعداد الربط أول مرة</summary><p>أدخل رابط مشروع Supabase والمفتاح العام publishable أو anon فقط. لا تدخل مفتاح service_role.</p><form id="config"><div><label>رابط المشروع</label><input name="url" type="url" value="${esc(cfg?.url||'')}" required></div><div><label>المفتاح العام</label><input name="key" value="${esc(cfg?.key||'')}" required></div><button>حفظ الربط</button></form></details><p class="notice">اربط مشروع Supabase الجديد الخاص بمطعم هيل. راجع تعليمات التفعيل المرفقة.</p></section>`;
document.getElementById('config').onsubmit=e=>{e.preventDefault();let f=new FormData(e.target),url=f.get('url').replace(/\/$/,'');if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))return alert('أدخل رابط مشروع Supabase الصحيح');const key=f.get('key').trim();try{const payload=JSON.parse(atob(key.split('.')[1]));if(payload.role==='service_role')return alert('هذا مفتاح سري! استخدم المفتاح العام فقط')}catch(_){}if(key.startsWith('sb_secret_'))return alert('استخدم المفتاح العام فقط');cfg={url,key};localStorage.setItem('haail_cloud_config',JSON.stringify(cfg));alert('تم حفظ الربط')};
document.getElementById('login').onsubmit=async e=>{e.preventDefault();if(!cfg)return alert('أكمل إعداد الربط أولاً');busy(true);try{const f=new FormData(e.target);session=await api('/functions/v1/haail-auth',{action:'login',username:f.get('username'),password:f.get('password')});sessionStorage.setItem('haail_session',JSON.stringify(session));await boot()}catch(x){alert(x.message)}finally{busy(false)}}}
async function boot(){if(!cfg||!session)return gate();try{if(session.refresh_token){session=await api('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});sessionStorage.setItem('haail_session',JSON.stringify(session))}const rows=await api('/rest/v1/haail_users?user_id=eq.'+encodeURIComponent(session.user.id)+'&select=*');profile=rows[0];if(!profile){
  if(await api('/rest/v1/rpc/haail_cashier_access',{})){
    profile={role:'cashier'};
    nav.innerHTML='<button onclick="logout()">خروج</button>';
    cashierPage();
    return;
  }
  throw Error('حسابك غير مخوّل؛ يضيفك المدير من إدارة المستخدمين');}materials=await api('/rest/v1/haail_materials?select=*&order=name');if(profile.role==='admin'){await refreshAdmin();render()}else await employee()}catch(x){session=null;sessionStorage.removeItem('haail_session');gate();alert(x.message)}}
async function refreshAdmin(){const [s]=await api('/rest/v1/haail_state?id=eq.1&select=*');db=s.data;revision=s.revision;committed=structuredClone(db)}
function logout(){session=null;profile=null;sessionStorage.removeItem('haail_session');closeStatement();gate()}
const renderLocal=render;
render=function(){if(profile?.role!=='admin')return;renderLocal();nav.insertAdjacentHTML('beforeend','<button onclick="management()">الإعدادات — المواد والحسابات والسجل</button><button onclick="reloadCloud()">تحديث</button><button onclick="logout()">خروج</button>')};
async function reloadCloud(){busy(true);try{await refreshAdmin();render()}catch(x){alert(x.message)}finally{busy(false)}}
save=function(){if(profile?.role!=='admin'){alert('غير مخوّل');return false}const next=structuredClone(db);busy(true);api('/rest/v1/rpc/haail_save',{body:next,expected:revision}).then(r=>{revision=r;committed=next;render()}).catch(async x=>{db=structuredClone(committed);alert('لم يُحفظ التغيير: '+x.message+' — سيتم تحديث البيانات؛ أعد إدخال التغيير.');try{await refreshAdmin()}catch(_){}render()}).finally(()=>busy(false));return true};
async function employee(){accounts=await api('/rest/v1/rpc/haail_accounts',{});nav.innerHTML='<button onclick="employee().catch(x=>alert(x.message))">تحديث الحسابات</button><button onclick="logout()">خروج</button>';app.innerHTML=`<section class="panel"><h2>أهلاً ${esc(profile.name)}</h2><p>صلاحيتك: تسجيل سحب مواد وتسديد مبالغ فقط. لا يمكن تعديل العمليات أو حذفها.</p><form id="movement"><div><label>الحساب</label><select name="party" required>${accounts.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — المتبقي ${fmt(p.balance)}</option>`).join('')}</select></div><div><label>العملية</label><select name="operation" id="operation"><option value="withdraw">سحب مواد</option><option value="pay">تسديد مبلغ</option></select></div><div id="materialBox"><label>المادة والسعر الثابت</label><select name="material">${materials.filter(m=>m.active).map(m=>`<option value="${m.id}">${esc(m.name)} — ${fmt(m.price)}</option>`).join('')}</select></div><div id="quantityBox"><label>الكمية</label><input name="quantity" type="number" min="1" max="100000" step="1" value="1"></div><div id="paymentBox" class="hidden"><label>مبلغ التسديد</label><input name="payment" type="number" min="1" step="1"></div><button>مراجعة وتسجيل</button></form><p class="muted">التاريخ والوقت واسم الموظف تُسجّل تلقائياً. الأسعار يحددها المدير.</p></section>`;
const form=document.getElementById('movement');document.getElementById('operation').onchange=e=>{const pay=e.target.value==='pay';['materialBox','quantityBox'].forEach(k=>document.getElementById(k).classList.toggle('hidden',pay));document.getElementById('paymentBox').classList.toggle('hidden',!pay)};
form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),op=f.get('operation'),qty=Number(f.get('quantity')),pay=Number(f.get('payment')),mat=materials.find(m=>m.id===f.get('material')),account=accounts.find(p=>p.id===f.get('party'));if(!account)return alert('اختر حساباً');if(op==='withdraw'&&(!mat||!Number.isSafeInteger(qty)||qty<1))return alert('اختر المادة والكمية');if(op==='pay'&&(!Number.isSafeInteger(pay)||pay<1||pay>account.balance))return alert('مبلغ التسديد غير صحيح أو أكبر من الرصيد');if(!confirm(account.name+'\n'+(op==='pay'?'تسديد '+fmt(pay):mat.name+' × '+qty+' = '+fmt(mat.price*qty))+'\nتأكيد التسجيل؟'))return;const payload={request_id:crypto.randomUUID(),party_id:account.id,operation:op,material_id:op==='withdraw'?mat.id:null,quantity:op==='withdraw'?qty:null,payment:op==='pay'?pay:null};busy(true);try{await api('/rest/v1/rpc/haail_record',payload);alert('تم تسجيل العملية');await employee()}catch(x){alert('تعذر تأكيد العملية. حدّث الحساب وتحقق من رصيده قبل تكرار التسجيل. '+x.message)}finally{busy(false)}}}
async function management(){if(profile?.role!=='admin')return;busy(true);try{const users=await api('/rest/v1/haail_users?select=*'),audit=await api('/rest/v1/haail_audit?select=*&order=created_at.desc&limit=100');materials=await api('/rest/v1/haail_materials?select=*&order=name');app.innerHTML=`<section class="panel"><h2>المواد والأسعار</h2><form id="mat"><div><label>اسم المادة</label><input name="name" required maxlength="100"></div>${moneyField}<button>إضافة مادة</button></form>${materials.map(m=>`<p>${esc(m.name)} — ${fmt(m.price)} — ${m.active?'متاحة':'موقوفة'} <button onclick="toggleMaterial('${m.id}',${!m.active})">${m.active?'إيقاف':'تفعيل'}</button></p>`).join('')}</section><section class="panel"><h2>إضافة موظف</h2><p>أنشئ حساب الموظف هنا، ثم حدّد صلاحية مطابقة الكاشير والصرفيات من قسم صلاحيات الموظفين.</p><form id="user"><div><label>اسم المستخدم</label><input name="username" dir="ltr" autocapitalize="none" pattern="[a-zA-Z][a-zA-Z0-9_.-]{2,31}" required></div><div><label>كلمة المرور</label><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div><div><label>اسم الموظف</label><input name="name" required maxlength="100"></div><button>تخويل للسحب والتسديد فقط</button></form>${users.map(u=>`<p>${esc(u.name)} (${esc(u.username||'')}) — ${u.role==='admin'?'مدير':'موظف'} ${u.role==='employee'?`<button class="danger" onclick="revokeUser('${u.user_id}')">إيقاف الصلاحية</button>`:''}</p>`).join('')}</section><section class="panel"><h2>نقل بيانات الجهاز القديمة</h2><button onclick="importOld()">استيراد البيانات المحفوظة بهذا المتصفح</button><p>أو استخدم النسخ الاحتياطي لاستيراد ملف JSON. يتم الاستيراد فقط إذا كانت القاعدة المشتركة فارغة.</p></section><section class="panel"><h2>سجل الرقابة — آخر 100 عملية</h2>${audit.map(a=>`<p>${esc(new Date(a.created_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'}))} | ${esc(a.actor_name)} | ${esc(a.action)} | ${esc(a.payload.note||'')} ${a.payload.amount?fmt(a.payload.amount):''}</p>`).join('')}</section>`;
document.getElementById('mat').onsubmit=e=>adminAction(async()=>{e.preventDefault();const f=new FormData(e.target),price=Number(f.get('amount'));if(!Number.isSafeInteger(price)||price<1)throw Error('السعر غير صحيح');await api('/rest/v1/haail_materials',{name:f.get('name').trim(),price,active:true})});document.getElementById('user').onsubmit=e=>adminAction(async()=>{e.preventDefault();const f=new FormData(e.target);await api('/functions/v1/haail-auth',{action:'create',username:f.get('username').trim(),password:f.get('password'),name:f.get('name').trim()});alert('تم إنشاء حساب الموظف')});}catch(x){alert(x.message)}finally{busy(false)}}
async function adminAction(fn){if(profile?.role!=='admin')return;busy(true);try{await fn();await management()}catch(x){alert(x.message)}finally{busy(false)}}
function toggleMaterial(mid,active){adminAction(()=>api('/rest/v1/haail_materials?id=eq.'+mid,{active},'PATCH'))}
function revokeUser(uid){if(confirm('إيقاف صلاحية الموظف؟'))adminAction(()=>api('/rest/v1/haail_users?user_id=eq.'+uid,null,'DELETE'))}
function importOld(){if(profile?.role!=='admin')return;if(db.entries.length||db.parties.length)return alert('القاعدة المشتركة غير فارغة. تم منع الاستبدال');const old=JSON.parse(localStorage.getItem(KEY)||'null');if(!validDB(old))return alert('لا توجد بيانات قديمة صالحة هنا. استخدم ملف النسخة الاحتياطية من جهازك القديم');if(confirm('نقل بيانات هذا المتصفح إلى القاعدة المشتركة؟')){db=old;save()}}
const restoreBeforeCloud=restore;restore=async function(){if(profile?.role!=='admin')return;if(db.entries.length||db.parties.length)return alert('الاستيراد متاح عندما تكون القاعدة المشتركة فارغة فقط');await restoreBeforeCloud()};
const backupBeforeCloud=backup;backup=function(){return backupBeforeCloud().replace('البيانات محفوظة داخل متصفح هذا الجهاز فقط، وقد تُفقد عند مسح بيانات Safari أو استخدام التصفح الخاص. النسخة لا تحتوي على تسجيل دخول أو مزامنة بين الأجهزة.','البيانات محفوظة في قاعدة البيانات المشتركة. البيانات القديمة بهذا الجهاز تبقى محفوظة حتى تستوردها. لا تشارك حساب المدير.')};
boot();
restore=async function(){if(profile?.role!=='admin')return;if(db.entries.length||db.parties.length)return alert('الاستيراد متاح عندما تكون القاعدة المشتركة فارغة فقط');const file=document.getElementById('restore').files[0];if(!file)return alert('اختر ملف النسخة');busy(true);try{const incoming=JSON.parse(await file.text());if(!validDB(incoming))throw Error('النسخة غير صالحة');if(!confirm('استيراد البيانات إلى القاعدة المشتركة؟'))return;await api('/rest/v1/rpc/haail_save',{body:incoming,expected:revision});await refreshAdmin();render();alert('تم الاستيراد والحفظ')}catch(x){alert('لم يتم تأكيد الاستيراد: '+x.message)}finally{busy(false)}};
const adminRenderWithSettings = render;
render = function () {
  adminRenderWithSettings();
  if (profile?.role === 'admin')
    nav.insertAdjacentHTML('afterbegin',
      '<button onclick="sharedDaily()">الصرفيات اليومية</button>');
};

const employeeWithMovements = employee;
employee = async function () {
  await employeeWithMovements();
  nav.insertAdjacentHTML('afterbegin',
    '<button onclick="sharedDaily()">الصرفيات اليومية</button>');
};

let dailyPoll = null;

async function sharedDaily() {
  if (!profile) return;
  clearInterval(dailyPoll);
  busy(true);
  try {
    const data = await api('/rest/v1/rpc/haail_cash_summary', {});
    app.innerHTML = `
      <section class="panel">
        <h2>الصرفيات اليومية</h2>
        <button onclick="sharedDaily()">تحديث</button>
        <div class="cards" id="fundTotals">${sharedTotals(data)}</div>
        <p id="fundSync">تم التحديث</p>
        ${profile.role === 'admin' ? openingBalanceForm(data) : ''}
      </section>
      <section class="panel">
        <h2>تسجيل صرف</h2>
        <form id="cloudSpend">
          <div><label>المادة / وجه الصرف</label>
            <input name="item" required maxlength="100"></div>
          <div><label>التفاصيل</label>
            <input name="details" required maxlength="300"></div>
          <div><label>المبلغ بالدينار</label>
            <input name="amount" type="number" min="1" step="1" required></div>
          <button>حفظ وخصم المبلغ</button>
        </form>
      </section>
      <section class="panel">
        <h2>سجل الصرفيات</h2>
        <div id="fundRows">${sharedRows(data)}</div>
      </section>
      ${profile.role === 'admin' ? `
      <section class="panel">
        <h2>زيادة الرصيد — للمدير</h2>
        <form id="cloudTopup">
          <div><label>المبلغ</label>
            <input name="amount" type="number" min="1" step="1" required></div>
          <div><label>البيان</label>
            <input name="details" required maxlength="300"></div>
          <button>زيادة الرصيد</button>
        </form>
      </section>` : ''}`;

    document.getElementById('cloudSpend').onsubmit =
      e => recordFund(e, 'spend');
    const openingForm = document.getElementById('openingForm');
    if (openingForm) openingForm.onsubmit = changeOpeningBalance;
    const top = document.getElementById('cloudTopup');
    if (top) top.onsubmit = e => recordFund(e, 'topup');
    dailyPoll = setInterval(refreshFund, 10000);
  } catch (x) {
    alert(x.message);
  } finally {
    busy(false);
  }
}

function sharedTotals(d) {
  return stat('إجمالي المخصص', d.funded) +
    stat('إجمالي المصروف', d.spent) +
    stat('الصافي المتبقي', d.remaining);
}

function sharedRows(d) {
  return `<div class="scroll"><table>
    <thead><tr>
      <th>التاريخ</th><th>المادة</th><th>التفاصيل</th>
      <th>المبلغ</th><th>الموظف</th>
    </tr></thead><tbody>
    ${d.entries.slice().reverse().map(e => `
      <tr>
        <td>${datefmt(e.date)}</td>
        <td>${esc(e.category)}</td>
        <td>${esc(e.note)}</td>
        <td>${fmt(e.amount)}</td>
        <td>${esc(e.actorName)}</td>
      </tr>`).join('') ||
      '<tr><td colspan="5">لا توجد صرفيات</td></tr>'}
    </tbody></table></div>`;
}

async function refreshFund() {
  if (!profile || !document.getElementById('fundTotals')) {
    clearInterval(dailyPoll);
    return;
  }
  try {
    const d = await api('/rest/v1/rpc/haail_cash_summary', {});
    if (!document.getElementById('fundTotals')) return;
    document.getElementById('fundTotals').innerHTML = sharedTotals(d);
    document.getElementById('fundRows').innerHTML = sharedRows(d);
    document.getElementById('fundSync').textContent =
      'آخر تحديث: ' + new Date().toLocaleTimeString('ar-IQ');
  } catch (_) {
    const el = document.getElementById('fundSync');
    if (el) el.textContent = 'تعذر التحديث؛ تحقق من الاتصال أو سجل دخولك مجدداً';
  }
}

async function recordFund(e, operation) {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const amount = Number(f.get('amount'));
  if (!Number.isSafeInteger(amount) || amount < 1)
    return alert('المبلغ غير صحيح');
  if (!confirm('تأكيد ' +
      (operation === 'spend' ? 'صرف ' : 'إضافة ') + fmt(amount)))
    return;

  busy(true);
  try {
    await api('/rest/v1/rpc/haail_cash_record', {
      request_id: crypto.randomUUID(),
      operation,
      amount,
      item: operation === 'spend' ? f.get('item') : 'تعزيز رصيد',
      details: f.get('details')
    });
    form.reset();
    if (profile.role === 'admin') await refreshAdmin();
    await refreshFund();
    alert('تم الحفظ في الحساب المشترك');
  } catch (x) {
    alert('لم يتم تأكيد الحفظ: ' + x.message +
      '؛ تحقق من السجل قبل تكرار العملية');
  } finally {
    busy(false);
  }
}
// تحديث التاريخ والحذف وكشف اليوم
function haailToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = type => parts.find(p => p.type === type).value;
  return value('year') + '-' + value('month') + '-' + value('day');
}

const dailyBeforeDate = sharedDaily;
sharedDaily = async function () {
  await dailyBeforeDate();
  const form = document.getElementById('cloudSpend');
  if (!form) return;

  if (!form.elements.expense_date) {
    const box = document.createElement('div');
    box.innerHTML = `
      <label>تاريخ المصروف</label>
      <input type="date" name="expense_date" required>`;
    box.querySelector('input').value = haailToday();
    form.prepend(box);
  }

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.innerHTML = `
    <h2>كشف صرفيات يوم</h2>
    <label>تاريخ الكشف</label>
    <input id="dailyReportDate" type="date">
    <button onclick="loadDailyReport()">عرض الكشف</button>
    <div id="dailyReportBody"></div>`;
  app.append(panel);
  document.getElementById('dailyReportDate').value = haailToday();
  await loadDailyReport();
};

const rowsBeforeDelete = sharedRows;
sharedRows = function (d) {
  const html = rowsBeforeDelete(d);
  if (profile?.role !== 'admin') return html;

  const box = document.createElement('div');
  box.innerHTML = html;
  const head = document.createElement('th');
  head.textContent = 'حذف';
  box.querySelector('thead tr').append(head);

  const entries = d.entries.slice().reverse();
  box.querySelectorAll('tbody tr').forEach((row, i) => {
    if (!entries[i]) return;
    const cell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'حذف';
    button.setAttribute(
      'onclick',
      'deleteDailyExpense(' + JSON.stringify(entries[i].id) + ')'
    );
    cell.append(button);
    row.append(cell);
  });
  return box.innerHTML;
};

recordFund = async function (e, operation) {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const amount = Number(f.get('amount'));
  const date = operation === 'spend'
    ? f.get('expense_date') : haailToday();

  if (!Number.isSafeInteger(amount) || amount < 1)
    return alert('المبلغ غير صحيح');
  if (!date) return alert('حدد تاريخ المصروف');
  if (!confirm('تأكيد ' +
      (operation === 'spend' ? 'صرف ' : 'إضافة ') + fmt(amount)))
    return;

  busy(true);
  try {
    await api('/rest/v1/rpc/haail_cash_record_dated', {
      request_id: crypto.randomUUID(),
      operation,
      amount,
      item: operation === 'spend' ? f.get('item') : 'تعزيز رصيد',
      details: f.get('details'),
      expense_date: date
    });

    form.reset();
    if (form.elements.expense_date)
      form.elements.expense_date.value = date;
    if (profile.role === 'admin') await refreshAdmin();
    await refreshFund();
    alert('تم الحفظ');
  } catch (x) {
    alert('لم يتم تأكيد الحفظ: ' + x.message +
      '؛ تحقق من السجل قبل التكرار');
  } finally {
    busy(false);
  }
};

async function deleteDailyExpense(id) {
  if (profile?.role !== 'admin') return;
  if (!confirm('حذف هذا المصروف وإرجاع مبلغه للرصيد؟')) return;
  busy(true);
  try {
    await api('/rest/v1/rpc/haail_cash_delete', {
      request_id: crypto.randomUUID(),
      entry_id: id
    });
    await refreshAdmin();
    await refreshFund();
    alert('تم الحذف وإرجاع المبلغ للرصيد');
  } catch (x) {
    alert(x.message);
  } finally {
    busy(false);
  }
}

let currentDailyReport = null;
let dailyReportRequest = 0;

function makeDailyReport(d, date) {
  const sum = list => list.reduce(
    (total, e) => total + Number(e.amount), 0
  );
  const rows = d.entries.filter(e => e.date === date);
  const opening = 0 +
    sum((d.topups || []).filter(e => e.date < date)) -
    sum(d.entries.filter(e => e.date < date));
  const topups = sum((d.topups || []).filter(e => e.date === date));
  const spent = sum(rows);
  return {
    date, rows, opening, topups, spent,
    closing: opening + topups - spent
  };
}

async function loadDailyReport() {
  const date = document.getElementById('dailyReportDate')?.value;
  if (!date) return;
  const request = ++dailyReportRequest;
  try {
    const d = await api('/rest/v1/rpc/haail_cash_summary', {});
    const body = document.getElementById('dailyReportBody');
    if (!body || request !== dailyReportRequest ||
        document.getElementById('dailyReportDate').value !== date)
      return;

    currentDailyReport = makeDailyReport(d, date);
    body.innerHTML = reportDailyHTML(currentDailyReport) + `
      <p>
        <button onclick="printDailyReport()">طباعة الكشف</button>
        <button onclick="whatsappDailyReport()">إرسال عبر الواتساب</button>
      </p>`;
  } catch (e) {
    currentDailyReport = null;
    const body = document.getElementById('dailyReportBody');
    if (body) body.textContent = 'تعذر تحميل الكشف: ' + e.message;
  }
}

function reportDailyHTML(r) {
  return `
    <h2>مطعم هيل</h2>
    <h3>كشف الصرفيات اليومية — ${esc(r.date)}</h3>
    <p>الرصيد قبل اليوم: ${fmt(r.opening)}</p>
    <p>تعزيز الرصيد خلال اليوم: ${fmt(r.topups)}</p>
    ${rowsBeforeDelete({ entries: r.rows })}
    <p><strong>مجموع صرف اليوم: ${fmt(r.spent)}</strong></p>
    <p><strong>الرصيد بنهاية اليوم: ${fmt(r.closing)}</strong></p>
    <small>حسب العمليات الموجودة وقت إعداد الكشف</small>`;
}

function selectedDailyReport() {
  const date = document.getElementById('dailyReportDate')?.value;
  if (!currentDailyReport || currentDailyReport.date !== date) {
    alert('اضغط عرض الكشف أولاً');
    return null;
  }
  return currentDailyReport;
}

function whatsappDailyReport() {
  const r = selectedDailyReport();
  if (!r) return;
  const text = [
    'مطعم هيل',
    'كشف صرفيات ' + r.date,
    'الرصيد قبل اليوم: ' + fmt(r.opening),
    'تعزيز اليوم: ' + fmt(r.topups),
    ...r.rows.map((e, i) =>
      (i + 1) + '. ' + e.category +
      ' — ' + e.note +
      ' — ' + fmt(e.amount) +
      ' — ' + e.actorName
    ),
    r.rows.length ? '' : 'لا توجد صرفيات بهذا اليوم',
    'مجموع الصرف: ' + fmt(r.spent),
    'المتبقي بنهاية اليوم: ' + fmt(r.closing)
  ].filter(Boolean).join('\n');

  window.open(
    'https://wa.me/?text=' + encodeURIComponent(text),
    '_blank', 'noopener'
  );
}

function printDailyReport() {
  const r = selectedDailyReport();
  if (!r) return;
  document.getElementById('dailyPrintFrame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'dailyPrintFrame';
  frame.style =
    'position:fixed;width:1px;height:1px;left:-10000px;border:0';
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };
  frame.srcdoc = `
    <!doctype html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="utf-8">
      <title>كشف الصرفيات اليومية</title>
      <style>
        body {font:14px Arial;padding:20px;color:#111}
        table {border-collapse:collapse;width:100%}
        td,th {
          border:1px solid #999;padding:8px;
          text-align:right;overflow-wrap:anywhere
        }
        h2 {text-align:center}
        @page {size:A4;margin:12mm}
      </style>
    </head>
    <body>${reportDailyHTML(r)}</body>
    </html>`;
  document.body.append(frame);
}

const refreshBeforeReport = refreshFund;
refreshFund = async function () {
  await refreshBeforeReport();
  if (document.getElementById('dailyReportBody'))
    await loadDailyReport();
};
printDailyReport = function () {
  const r = selectedDailyReport();
  if (!r) return;

  document.getElementById('haailPrintArea')?.remove();
  document.getElementById('haailPrintStyle')?.remove();

  const area = document.createElement('section');
  area.id = 'haailPrintArea';
  area.dir = 'rtl';
  area.innerHTML = reportDailyHTML(r);
  area.style.display = 'none';

  const style = document.createElement('style');
  style.id = 'haailPrintStyle';
  style.textContent = `
    @media print {
      body > *:not(#haailPrintArea) {
        display: none !important;
      }
      #haailPrintArea {
        display: block !important;
        color: #000;
        background: #fff;
        font: 14px Arial;
      }
      #haailPrintArea .scroll {
        overflow: visible !important;
      }
      #haailPrintArea table {
        width: 100%;
        border-collapse: collapse;
      }
      #haailPrintArea td,
      #haailPrintArea th {
        border: 1px solid #999;
        padding: 7px;
        text-align: right;
      }
      @page { size: A4; margin: 12mm; }
    }
  `;

  document.head.append(style);
  document.body.append(area);
  window.print();
};
// تعديل الرصيد الافتتاحي — للمدير فقط
const totalsBeforeOpening = sharedTotals;
sharedTotals = function (d) {
  return stat('الرصيد الافتتاحي', Number(d.opening ?? 0)) +
    totalsBeforeOpening(d);
};

function openingBalanceForm(data) {
  const date = data.date || haailToday();
  const amount = Number(data.opening ?? 0);
  return `
    <form id="openingForm" data-date="${esc(date)}">
      <h3>تعديل الرصيد الافتتاحي</h3>
      <p>عهدة يوم ${esc(datefmt(date))}. اكتب المبلغ الصحيح لبداية اليوم بالدينار.</p>
      <label for="openingAmount">الرصيد الافتتاحي بالدينار</label>
      <input id="openingAmount" name="opening" type="number"
        min="0" max="9007199254740991" step="1" value="${amount}" required>
      <button type="submit">حفظ تعديل الرصيد الافتتاحي</button>
    </form>
  `;
}

async function changeOpeningBalance(e) {
  e.preventDefault();
  if (profile?.role !== 'admin') return;

  const form = e.target;
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  if (form.dataset.date !== haailToday())
    return alert('تغيّر تاريخ اليوم. اضغط تحديث قبل تعديل الرصيد.');
  const value = new FormData(form).get('opening');
  const amount = Number(value);

  if (!String(value).trim() ||
      !Number.isSafeInteger(amount) || amount < 0)
    return alert('اكتب مبلغاً صحيحاً');

  if (!confirm('تغيير الرصيد الافتتاحي إلى ' + fmt(amount) + '؟'))
    return;

  button.disabled = true;
  busy(true);
  let saved = false;
  try {
    await api('/rest/v1/rpc/haail_cash_opening', {
      request_id: crypto.randomUUID(),
      new_opening: amount
    });
    saved = true;
    form.elements.opening.defaultValue = String(amount);
    await refreshAdmin();
    await refreshFund();
    alert('تم حفظ الرصيد الافتتاحي');
  } catch (x) {
    alert(saved
      ? 'تم حفظ الرصيد الافتتاحي. اضغط تحديث لعرض الحساب بعد التعديل.'
      : 'تعذر تأكيد التعديل؛ اضغط تحديث للتحقق: ' + x.message);
  } finally {
    button.disabled = false;
    busy(false);
  }
}

// احتساب الكشف حسب الرصيد الافتتاحي المحفوظ
makeDailyReport = function (d, date) {
  const sum = rows =>
    rows.reduce((total, e) => total + Number(e.amount), 0);

  const entries = d.entries || [];
  const additions = d.topups || [];
  const rows = entries.filter(e => e.date === date);

  const opening = Number(d.opening ?? 0) +
    sum(additions.filter(e => e.date < date)) -
    sum(entries.filter(e => e.date < date));

  const topups = sum(additions.filter(e => e.date === date));
  const spent = sum(rows);

  return {
    date, rows, opening, topups, spent,
    closing: opening + topups - spent
  };
};
loadDailyReport = async function (show = false) {
  const input = document.getElementById('dailyReportDate');
  const body = document.getElementById('dailyReportBody');
  if (!input || !body) return;
  if (!input.value) return alert('اختر تاريخ الكشف');

  const date = input.value;
  const request = ++dailyReportRequest;

  if (show) {
    body.textContent = 'جاري تحميل الكشف…';
    body.scrollIntoView({ block: 'start' });
  }

  try {
    const data = await api('/rest/v1/rpc/haail_cash_summary', {});
    if (request !== dailyReportRequest ||
        !body.isConnected || input.value !== date) return;

    currentDailyReport = makeDailyReport(data, date);
    body.innerHTML = reportDailyHTML(currentDailyReport) + `
      <p>
        <button type="button" onclick="printDailyReport()">
          طباعة الكشف
        </button>
        <button type="button" onclick="whatsappDailyReport()">
          إرسال عبر الواتساب
        </button>
      </p>`;

    if (show) body.scrollIntoView({ block: 'start' });
  } catch (error) {
    if (request !== dailyReportRequest || !body.isConnected) return;
    currentDailyReport = null;
    body.textContent = 'تعذر عرض الكشف: ' + error.message;
  }
};

const dailyBeforeReportClick = sharedDaily;
sharedDaily = async function () {
  await dailyBeforeReportClick();
  const input = document.getElementById('dailyReportDate');
  if (!input) return;

  const button = input.closest('section').querySelector('button');
  if (button) {
    button.type = 'button';
    button.onclick = () => loadDailyReport(true);
  }
};
const employeeBeforeDebts = employee;
employee = async function () {
  await employeeBeforeDebts();

  const movement = document.getElementById('movement');
  if (!movement || profile?.role !== 'employee') return;

  const description = movement.closest('section').querySelector('p');
  if (description) {
    description.textContent =
      'صلاحيتك: فتح حساب مدين وإضافة دين وسحب مواد وتسديد. التعديل والحذف للمدير.';
  }

  app.insertAdjacentHTML('beforeend', `
    <section class="panel">
      <h2>فتح حساب مدين جديد</h2>
      <form id="employeeNewAccount">
        <label>اسم الشخص أو المجهز</label>
        <input name="account_name" required maxlength="100">
        <label>رقم الهاتف — اختياري</label>
        <input name="account_phone" type="tel" maxlength="30">
        <button type="submit">فتح الحساب</button>
      </form>
    </section>

    <section class="panel">
      <h2>إضافة دين على حساب</h2>
      <form id="employeeAddDebt">
        <label>الحساب</label>
        <select name="party_id" required>
          <option value="">اختر الحساب</option>
          ${accounts.map(p => `
            <option value="${esc(p.id)}">
              ${esc(p.name)} — المتبقي ${fmt(p.balance)}
            </option>
          `).join('')}
        </select>
        <label>مبلغ الدين بالدينار</label>
        <input name="amount" type="number"
          min="1" max="9007199254740991" step="1" required>
        <label>بيان الدين / المواد المسحوبة</label>
        <input name="details" required maxlength="300">
        <button type="submit">مراجعة وإضافة الدين</button>
      </form>
      <p>سجّل العملية مرة واحدة: بسحب المواد أو بإضافة الدين.</p>
    </section>
  `);

  bindEmployeeDebt('employeeNewAccount', 'create');
  bindEmployeeDebt('employeeAddDebt', 'add');
};

function bindEmployeeDebt(formId, operation) {
  const form = document.getElementById(formId);
  let pending = null;
  let sending = false;

  form.onsubmit = async function (event) {
    event.preventDefault();
    if (sending || profile?.role !== 'employee') return;

    if (!pending) {
      const f = new FormData(form);
      const payload = { operation };

      if (operation === 'create') {
        payload.account_name =
          String(f.get('account_name') || '').trim();
        payload.account_phone =
          String(f.get('account_phone') || '').trim();

        if (!payload.account_name)
          return alert('اكتب اسم الحساب');

        if (!confirm('فتح حساب باسم: ' + payload.account_name + '؟'))
          return;
      } else {
        payload.party_id = f.get('party_id');
        payload.amount = Number(f.get('amount'));
        payload.details = String(f.get('details') || '').trim();

        const account = accounts.find(
          p => p.id === payload.party_id
        );

        if (!account) return alert('اختر الحساب');
        if (!Number.isSafeInteger(payload.amount) ||
            payload.amount < 1 || !payload.details)
          return alert('تحقق من المبلغ وبيان الدين');

        if (!confirm(
          'إضافة دين على: ' + account.name +
          '\nالمبلغ: ' + fmt(payload.amount) +
          '\nالبيان: ' + payload.details
        )) return;
      }

      pending = payload;
    }

    const button = form.querySelector('button');
    sending = true;
    button.disabled = true;

    try {
      if (!pending.request_id)
        pending.request_id = crypto.randomUUID();

      await api('/rest/v1/rpc/haail_employee_debt', pending);
    } catch (error) {
      alert(
        'لم يتم تأكيد التسجيل: ' + error.message +
        '\nاضغط نفس الزر لإعادة المحاولة بنفس رقم العملية.'
      );
      sending = false;
      button.disabled = false;
      return;
    }

    pending = null;
    form.reset();
    alert('تم التسجيل بنجاح');

    try {
      await employee();
    } catch (error) {
      alert('العملية محفوظة؛ اضغط تحديث الحسابات لتحديث العرض.');
      sending = false;
      button.disabled = false;
    }
  };
}
const employeeBeforeInvoice = employee;
employee = async function () {
  await employeeBeforeInvoice();

  const movement = document.getElementById('movement');
  if (!movement || profile?.role !== 'employee') return;
  if (document.getElementById('materialInvoice')) return;

  // إبقاء التسديد بالاستمارة القديمة
  const operation = document.getElementById('operation');
  operation.querySelector('option[value="withdraw"]')?.remove();
  operation.value = 'pay';
  operation.dispatchEvent(new Event('change'));

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.innerHTML = `
    <h2>سحب مواد على الحساب</h2>
    <form id="materialInvoice">
      <fieldset style="border:0;padding:0;min-width:0">
        <label>الحساب</label>
        <select name="party" required>
          <option value="">اختر الحساب</option>
          ${accounts.map(p => `
            <option value="${esc(p.id)}">
              ${esc(p.name)} — المتبقي ${fmt(p.balance)}
            </option>
          `).join('')}
        </select>

        <div class="scroll">
          <table style="min-width:650px">
            <thead><tr>
              <th>المادة</th>
              <th>الكمية</th>
              <th>سعر الوحدة</th>
              <th>الإجمالي</th>
              <th>إزالة السطر</th>
            </tr></thead>
            <tbody id="invoiceRows"></tbody>
          </table>
        </div>

        <button type="button" id="invoiceAdd">
          إضافة مادة
        </button>
        <h3>المجموع الكلي:
          <span id="invoiceTotal">0 د.ع</span>
        </h3>
      </fieldset>

      <p id="invoiceStatus" role="status"></p>
      <button type="submit" id="invoiceSave">
        مراجعة وحفظ سحب المواد
      </button>
    </form>
  `;

  movement.closest('section').after(panel);

  const form = document.getElementById('materialInvoice');
  const rows = document.getElementById('invoiceRows');
  const fieldset = form.querySelector('fieldset');
  const saveButton = document.getElementById('invoiceSave');
  const status = document.getElementById('invoiceStatus');
  let pending = null;
  let sending = false;

  function calculate() {
    let total = 0;
    let valid = true;

    rows.querySelectorAll('tr').forEach(row => {
      const quantity = Number(row.querySelector('.qty').value);
      const price = Number(row.querySelector('.price').value);
      const line = quantity * price;

      const ok = Number.isSafeInteger(quantity) &&
        quantity > 0 && quantity <= 100000 &&
        Number.isSafeInteger(price) && price > 0 &&
        Number.isSafeInteger(line);

      row.querySelector('.lineTotal').textContent =
        ok ? fmt(line) : '—';

      if (ok) total += line;
      else valid = false;
    });

    if (!Number.isSafeInteger(total)) valid = false;

    document.getElementById('invoiceTotal').textContent =
      valid ? fmt(total) : 'تحقق من الكمية والسعر';

    return valid ? total : null;
  }

  function addRow() {
    if (rows.children.length >= 50)
      return alert('الحد الأعلى 50 مادة');

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input class="itemName"
        aria-label="اسم المادة"
        required maxlength="100"></td>
      <td><input class="qty" aria-label="الكمية"
        type="number" min="1" max="100000"
        step="1" value="1" required></td>
      <td><input class="price" aria-label="سعر الوحدة"
        type="number" min="1" max="9007199254740991"
        step="1" required></td>
      <td class="lineTotal">—</td>
      <td><button type="button">إزالة</button></td>
    `;

    row.querySelector('button').onclick = () => {
      row.remove();
      calculate();
    };
    rows.append(row);
    calculate();
  }

  document.getElementById('invoiceAdd').onclick = addRow;
  rows.oninput = calculate;
  addRow();

  form.onsubmit = async function (event) {
    event.preventDefault();
    if (sending || profile?.role !== 'employee') return;

    if (!pending) {
      const partyId = form.elements.party.value;
      const account = accounts.find(p => p.id === partyId);
      if (!account) return alert('اختر الحساب');

      const items = [...rows.querySelectorAll('tr')].map(row => ({
        name: row.querySelector('.itemName').value.trim(),
        quantity: Number(row.querySelector('.qty').value),
        price: Number(row.querySelector('.price').value)
      }));

      const total = calculate();
      if (!items.length || items.some(x => !x.name) ||
          total === null || total < 1)
        return alert('أكمل أسماء المواد والكميات والأسعار');

      if (!confirm(
        'تسجيل سحب مواد على: ' + account.name +
        '\nعدد السطور: ' + items.length +
        '\nالمجموع: ' + fmt(total) +
        '\nسيُضاف المجموع إلى الدين. تأكيد؟'
      )) return;

      pending = { party_id: partyId, items };
    }

    sending = true;
    fieldset.disabled = true;
    saveButton.disabled = true;
    status.textContent = 'جاري حفظ سحب المواد…';

    try {
      if (!pending.request_id)
        pending.request_id = crypto.randomUUID();

      await api('/rest/v1/rpc/haail_material_invoice', pending);
    } catch (error) {
      sending = false;
      saveButton.disabled = false;
      saveButton.textContent = 'إعادة محاولة نفس العملية';
      status.textContent =
        'لم يتم تأكيد الحفظ: ' + error.message +
        ' — إعادة المحاولة تستخدم نفس رقم العملية لمنع التكرار.';
      return;
    }

    pending = null;
    status.textContent = 'تم حفظ المواد وإضافة مجموعها إلى الدين';
    alert('تم حفظ سحب المواد بنجاح');

    try {
      await employee();
    } catch (_) {
      status.textContent =
        'العملية محفوظة. اضغط تحديث الحسابات لتحديث الرصيد.';
    }
  };
};
// تحديث الحساب اليومي
const legacyDailyReport = makeDailyReport;
makeDailyReport = function (d, date) {
  if (d.dailyVersion !== 2 || date < d.startDate)
    return legacyDailyReport({
      ...d,
      opening: d.legacyOpening ?? d.opening
    }, date);

  const v = d.days?.[date];
  const rows = (d.entries || []).filter(e => e.date === date);
  const opening = Number(v?.opening || 0);
  const topups = Number(v?.topups || 0);
  const spent = rows.reduce((s, e) => s + Number(e.amount), 0);

  return {
    date, rows, opening, topups, spent,
    closing: opening + topups - spent,
    daily: true,
    closed: !!v?.closed,
    unopened: !v
  };
};

const legacyDailyTotals = sharedTotals;
sharedTotals = function (d) {
  if (d.dailyVersion !== 2) return legacyDailyTotals(d);

  return '<p>حساب يوم ' + esc(datefmt(d.date)) +
    ' — توقيت بغداد</p>' +
    stat('الرصيد الافتتاحي لليوم', Number(d.opening)) +
    stat('مخصص اليوم مع التعزيزات', Number(d.funded)) +
    stat('مصروف اليوم', Number(d.spent)) +
    stat('المتبقي لليوم', Number(d.remaining));
};

const legacyDailyRows = sharedRows;
sharedRows = function (d) {
  return legacyDailyRows(d.dailyVersion === 2 ? {
    ...d,
    entries: d.entries.filter(e => e.date === d.date)
  } : d);
};

const legacyDailyHTML = reportDailyHTML;
reportDailyHTML = function (r) {
  const html = legacyDailyHTML(r);
  if (!r.daily) return html;

  return html.replace(
    'الرصيد قبل اليوم:',
    'الرصيد الافتتاحي لهذا اليوم:'
  ) + '<p>' + (
    r.unopened ? 'لم يُفتح مخصص لهذا اليوم.' :
    r.closed ? 'تم ترحيل المتبقي إلى الإيرادات: ' +
      fmt(Math.max(0, r.closing)) :
      'يُرحّل المتبقي إلى الإيرادات بعد انتهاء اليوم.'
  ) + '</p>';
};

recordFund = async function (event, operation) {
  event.preventDefault();
  const form = event.target;
  if (form.dataset.sending === 'yes') return;

  const f = new FormData(form);
  const amount = Number(f.get('amount'));
  const date = operation === 'spend'
    ? f.get('expense_date') : haailToday();

  if (!Number.isSafeInteger(amount) || amount < 1 || !date)
    return alert('تحقق من المبلغ والتاريخ');

  const body = {
    operation,
    amount,
    item: operation === 'spend'
      ? f.get('item') : 'تعزيز رصيد',
    details: f.get('details'),
    expense_date: date
  };

  const signature = JSON.stringify(body);

  if (form.dataset.pending &&
      form.dataset.signature !== signature)
    return alert(
      'لم يُؤكد حفظ المحاولة السابقة. أعد نفس البيانات للتحقق قبل إدخال عملية أخرى.'
    );

  if (!form.dataset.pending) {
    if (!confirm(
      'تأكيد ' + (operation === 'spend' ? 'صرف ' : 'إضافة ') +
      fmt(amount) + ' بتاريخ ' + datefmt(date) + '؟'
    )) return;

    form.dataset.pending = crypto.randomUUID();
    form.dataset.signature = signature;
  }

  form.dataset.sending = 'yes';
  busy(true);
  let saved = false;

  try {
    await api('/rest/v1/rpc/haail_cash_record_dated', {
      ...body,
      request_id: form.dataset.pending
    });

    saved = true;
    delete form.dataset.pending;
    delete form.dataset.signature;
    form.reset();

    if (form.elements.expense_date)
      form.elements.expense_date.value = haailToday();

    if (profile.role === 'admin') await refreshAdmin();
    await refreshFund();
    alert('تم الحفظ');
  } catch (error) {
    alert(saved
      ? 'العملية محفوظة؛ حدّث الصفحة لعرض الرصيد.'
      : 'لم يتم تأكيد الحفظ: ' + error.message +
        ' — تحقق من السجل؛ إعادة نفس المحاولة تستخدم رقم العملية نفسه.');
  } finally {
    delete form.dataset.sending;
    busy(false);
  }
};

const refreshAdminBeforeDailyV2 = refreshAdmin;
refreshAdmin = async function () {
  await api('/rest/v1/rpc/haail_cash_summary', {});
  return refreshAdminBeforeDailyV2();
};

const removeEntryBeforeDailyV2 = removeEntry;
removeEntry = function (id) {
  if (db.entries.find(e => e.id === id)?.dailyReturnDate)
    return alert(
      'هذا إيراد ترحيل تلقائي. لتصحيحه عدّل مصروفات اليوم الأصلي؛ يتحدث المتبقي تلقائياً.'
    );
  return removeEntryBeforeDailyV2(id);
};

/* Fund accounting v3: main cash and petty cash are separate assets. */
function haailAutomaticReturn(e) {
  return !!e.dailyReturnDate && e.id === 'daily_return_' + e.dailyReturnDate;
}
function haailCashPosition(state) {
  const rows = (state.entries || []).filter(e => !haailAutomaticReturn(e));
  const total = rows.reduce((s,e) => s + (e.method === 'نقدي'
    ? (e.type === 'income' ? 1 : e.type === 'expense' ? -1 : 0) * Number(e.amount) : 0),0);
  const fund = state.dailyFund || {};
  const held = Object.values(fund.days || {}).reduce((s,d) =>
    s + (!d.closed ? Number(d.remaining || 0) : 0),0);
  return {total, held, main: total - held};
}
function haailWithoutReturns(fn) {
  return function(...args) {
    const original = db.entries;
    db.entries = original.filter(e => !haailAutomaticReturn(e));
    try { return fn.apply(this,args); } finally { db.entries = original; }
  };
}
cashBalance = function() { return haailCashPosition(db).main; };
home = haailWithoutReturns(home);
const haailHomeBeforeFunds = home;
home = function() {
  const p = haailCashPosition(db);
  return haailHomeBeforeFunds() +
    '<section class="panel"><h2>توزيع النقد المسجّل</h2><div class="cards">' +
    stat('الموجود بعهدة الصرف',p.held) + stat('النقد الكلي: الصندوق والعهدة',p.total) +
    '</div><p class="muted">تخصيص العهدة تحويل داخلي. المتبقي يرجع للصندوق دون احتسابه إيراداً جديداً. الأرصدة مبنية على الحركات المسجّلة.</p>' +
    (db.dailyFund?.accountingVersion === 3 ? '' :
    '<p class="notice">حساب الإيرادات يستبعد ترحيل العهدة الآلي. يلزم تشغيل تحديث قاعدة البيانات fund-accounting-v3.sql لإيقاف التمويل اليومي التلقائي وتصحيح السجل المشترك.</p>') +
    (p.main < 0 ? '<p class="notice">الصندوق المسجّل لا يغطي عهدة الصرف. راجع إيرادات النقد والرصيد السابق والمبالغ المسلّمة فعلياً؛ لا تضف إيرادات وهمية لتسوية الفرق.</p>' : '') +
    '</section>';
};
ledger = haailWithoutReturns(ledger);
showReport = haailWithoutReturns(showReport);
exportCSV = haailWithoutReturns(exportCSV);
printLedger = haailWithoutReturns(printLedger);
const haailDailyHTMLBeforeAccounting = reportDailyHTML;
reportDailyHTML = function(r) {
  return haailDailyHTMLBeforeAccounting(r)
    .replace('تم ترحيل المتبقي إلى الإيرادات:', 'المتبقي المعاد إلى الصندوق (تحويل داخلي):')
    .replace('يُرحّل المتبقي إلى الإيرادات بعد انتهاء اليوم.', 'يعود المتبقي إلى الصندوق بعد انتهاء اليوم، ولا يزيد الإيرادات.');
};
const haailDailyBeforeAccounting = sharedDaily;
sharedDaily = async function() {
  await haailDailyBeforeAccounting();
  const top = document.getElementById('cloudTopup');
  if (top) {
    top.closest('section').querySelector('h2').textContent = 'تعزيز العهدة من الصندوق — للمدير';
    top.querySelector('button').textContent = 'تحويل المبلغ للعهدة';
  }
};


/* Contact calling v2: attach to each account card, independently of print markup. */
(() => {
  function phoneForCall(value) {
    let n = String(value ?? '').trim()
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[\s().\-–—]/g, '');
    if (n.startsWith('00')) n = '+' + n.slice(2);
    if (/^9640?7\d{9}$/.test(n)) n = '+964' + n.replace(/^9640?/, '');
    if (/^\+96407\d{9}$/.test(n)) n = '+964' + n.slice(5);
    if (/^07\d{9}$/.test(n)) n = '+964' + n.slice(1);
    if (/^7\d{9}$/.test(n)) n = '+964' + n;
    return /^\+?\d{7,15}$/.test(n) ? n : '';
  }
  const previous = parties;
  parties = function(type) {
    const html = previous.apply(this, arguments);
    const root = document.createElement('div');
    root.innerHTML = html;
    for (const form of root.querySelectorAll('form[onsubmit]')) {
      const handler = form.getAttribute('onsubmit') || '';
      if (!handler.includes('addMovement(')) continue;
      const p = db.parties.find(p => p.type === type &&
        (handler.includes("'" + p.id + "'") || handler.includes('"' + p.id + '"')));
      const number = p && phoneForCall(p.phone);
      if (!number) continue;
      const card = form.closest('.panel');
      const header = card && card.querySelector('.topline');
      if (!header || header.querySelector('[data-haail-call]')) continue;
      const link = document.createElement('a');
      link.className = 'btn no-print';
      link.dataset.haailCall = p.id;
      link.href = 'tel:' + number;
      link.textContent = '📞 اتصال';
      link.setAttribute('aria-label', 'اتصال بـ ' + p.name);
      link.style.cssText = 'display:inline-block;text-decoration:none;background:#19685e;color:#fff;padding:10px 16px;border-radius:12px;margin:8px;min-height:44px;box-sizing:border-box';
      (header.querySelector('h3')?.parentElement || header).append(link);
    }
    return root.innerHTML;
  };
})();

/* Private, shared invoice attachments. Accounting balances are never changed. */
(() => {
  const bucket = 'haail-invoices';
  let currentParty = null;
  let uploading = false;
  let requestGeneration = 0;
  const mimeExtensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','application/pdf':'pdf'};
  const previousParties = parties;
  parties = function(type) {
    const root = document.createElement('div');
    root.innerHTML = previousParties.apply(this, arguments);
    for (const form of root.querySelectorAll('form[onsubmit]')) {
      const handler = form.getAttribute('onsubmit') || '';
      if (!handler.includes('addMovement(')) continue;
      const p = db.parties.find(p => p.type === type &&
        (handler.includes("'" + p.id + "'") || handler.includes('"' + p.id + '"')));
      if (!p) continue;
      const card = form.closest('.panel');
      if (!card || card.querySelector('[data-invoice-party]')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'no-print';
      button.dataset.invoiceParty = p.id;
      button.textContent = '📎 فواتير المكتب';
      button.style.cssText = 'margin-top:12px;margin-bottom:8px';
      form.before(button);
    }
    return root.innerHTML;
  };
  function invoiceAccounts() {
    return profile?.role === 'admin' ? db.parties : accounts;
  }
  const employeeBeforeInvoices = employee;
  employee = async function() {
    await employeeBeforeInvoices.apply(this, arguments);
    if (profile?.role !== 'employee') return;
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.innerHTML = '<h2>📎 فواتير المكاتب</h2><p>اختَر الحساب لرفع فاتورة أو فتح الفواتير المحفوظة. رفع الفاتورة لا يغيّر رصيد الدين.</p>';
    if (!accounts.length) panel.insertAdjacentHTML('beforeend','<p>لا توجد حسابات متاحة حالياً.</p>');
    for (const p of accounts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.invoiceParty = p.id;
      button.textContent = '📎 ' + p.name;
      button.style.cssText = 'display:block;margin:8px 0;min-height:44px';
      panel.append(button);
    }
    app.append(panel);
  };
  function closeInvoices() {
    if (uploading) return alert('انتظر اكتمال رفع الفاتورة أولاً.');
    requestGeneration++;
    document.getElementById('haailInvoiceView')?.remove();
    currentParty = null;
  }
  async function storageRequest(path, options = {}) {
    const response = await fetch(cfg.url + '/storage/v1/' + path, {
      ...options,
      headers: {apikey:cfg.key, Authorization:'Bearer ' + session.access_token, ...(options.headers || {})}
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.message || result.error || 'تعذر حفظ أو فتح الفاتورة');
    return result;
  }
  function ready() {
    if (!['admin','employee'].includes(profile?.role) || !session?.access_token) throw Error('سجّل الدخول بحساب مخوّل.');
  }
  async function loadInvoices(partyId) {
    const generation = ++requestGeneration;
    const list = document.getElementById('haailInvoiceList');
    list.textContent = 'جارٍ تحميل الفواتير…';
    try {
      const rows = await api('/rest/v1/haail_invoices?party_id=eq.' + encodeURIComponent(partyId) + '&select=*&order=invoice_date.desc,created_at.desc');
      if (generation !== requestGeneration || currentParty !== partyId) return;
      list.innerHTML = rows.length ? rows.map(r => `<article class="panel" style="margin-top:10px">
        <b>${esc(r.invoice_number || 'فاتورة بدون رقم')}</b> — ${esc(datefmt(r.invoice_date))}
        <p>${r.amount == null ? '' : 'المبلغ: ' + fmt(r.amount)}</p>
        <p>${esc(r.original_name)} — ${(r.size_bytes / 1024 / 1024).toFixed(2)} MB</p>
        ${r.note ? '<p>' + esc(r.note) + '</p>' : ''}
        <button type="button" data-invoice-open="${esc(r.object_path)}">فتح الفاتورة</button>
        <button type="button" data-invoice-download="${esc(r.object_path)}">تنزيل الفاتورة</button>
        </article>`).join('') : '<p>ماكو فواتير محفوظة لهذا الحساب بعد.</p>';
    } catch (error) {
      if (generation !== requestGeneration || currentParty !== partyId) return;
      list.textContent = 'تعذر تحميل الفواتير: ' + error.message + ' — إذا كانت أول مرة، شغّل ملف invoices-setup.sql ثم اضغط تحديث.';
    }
  }
  async function showInvoices(partyId) {
    ready();
    if (uploading) return;
    const p = invoiceAccounts().find(p => p.id === partyId);
    if (!p) throw Error('الحساب غير موجود');
    closeInvoices();
    currentParty = partyId;
    const view = document.createElement('section');
    view.id = 'haailInvoiceView';
    view.setAttribute('role','dialog');
    view.setAttribute('aria-modal','true');
    view.setAttribute('aria-label','فواتير ' + p.name);
    view.style.cssText = 'position:fixed;inset:0;background:#f3f6f5;z-index:10001;overflow:auto;padding:16px;box-sizing:border-box;direction:rtl';
    view.innerHTML = `<div style="max-width:760px;margin:auto"><div class="panel">
      <button type="button" data-invoice-close>رجوع للحساب</button>
      <h2>📎 فواتير ${esc(p.name)}</h2>
      <p>الفواتير محفوظة مع الحساب وتظهر من أجهزتك عند دخولك بحساب مخوّل.</p>
      <p>حفظ الفاتورة لا يسجّل ديناً أو مصروفاً؛ سجّل الحركة المالية من الحساب عند الحاجة.</p>
      <form id="haailInvoiceUpload">
      <div><label>رقم الفاتورة (اختياري)</label><input name="invoice_number" maxlength="100"></div>
      <div><label>تاريخ الفاتورة</label><input name="invoice_date" type="date" value="${haailToday()}" required></div>
      <div><label>مبلغ الفاتورة — دينار عراقي (اختياري)</label><input name="invoice_amount" type="number" min="0" step="1"></div>
      <div><label>ملاحظات (اختياري)</label><input name="invoice_note" maxlength="500"></div>
      <div><label>من الاستوديو أو ملف PDF — حتى 10 ميغابايت</label><input name="invoice_file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif"></div>
      <div><label>أو صوّر الفاتورة بالكاميرا</label><input name="invoice_camera" type="file" accept="image/*" capture="environment"></div>
      <p id="haailInvoiceChosen" role="status"></p>
      <button type="submit">حفظ الفاتورة</button><p id="haailInvoiceStatus" role="status"></p>
      </form></div><div class="panel"><button type="button" data-invoice-refresh>تحديث الفواتير</button><div id="haailInvoiceList"></div></div></div>`;
    document.body.append(view);
    const form = view.querySelector('form');
    for (const name of ['invoice_file','invoice_camera']) {
      form.elements[name].addEventListener('change', () => {
        const other = name === 'invoice_file' ? 'invoice_camera' : 'invoice_file';
        if (form.elements[name].files.length) form.elements[other].value = '';
        view.querySelector('#haailInvoiceChosen').textContent = form.elements[name].files[0]?.name || '';
      });
    }
    form.addEventListener('submit', uploadInvoice);
    await loadInvoices(partyId);
  }
  async function uploadInvoice(event) {
    event.preventDefault();
    if (uploading) return;
    const form = event.target;
    const status = document.getElementById('haailInvoiceStatus');
    let uploadedPath = null;
    let metadataAttempted = false;
    try {
      ready();
      const partyId = currentParty;
      if (!invoiceAccounts().some(p => p.id === partyId)) throw Error('الحساب غير موجود');
      const file = form.elements.invoice_file.files[0] || form.elements.invoice_camera.files[0];
      if (!file) throw Error('اختَر صورة أو PDF للفاتورة أولاً');
      if (!file.size || file.size > 10485760) throw Error('حجم الملف لازم يكون أكثر من صفر وبحد أقصى 10 ميغابايت');
      const fallback = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',pdf:'application/pdf'};
      const mime = file.type || fallback[file.name.split('.').pop().toLowerCase()];
      if (!mimeExtensions[mime]) throw Error('اختَر صورة JPG أو PNG أو WEBP أو HEIC أو ملف PDF');
      const data = new FormData(form);
      const value = String(data.get('invoice_amount') || '').trim();
      const amount = value === '' ? null : Number(value);
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw Error('أدخل مبلغاً صحيحاً');
      const date = data.get('invoice_date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('أدخل تاريخ الفاتورة');
      uploading = true;
      form.querySelector('button[type=submit]').disabled = true;
      status.textContent = 'جارٍ رفع وحفظ الفاتورة… لا تغلق الصفحة.';
      const invoiceId = crypto.randomUUID();
      const objectPath = session.user.id + '/' + invoiceId + '.' + mimeExtensions[mime];
      await storageRequest('object/' + bucket + '/' + objectPath, {method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:file});
      uploadedPath = objectPath;
      const record = {id:invoiceId,party_id:partyId,invoice_number:String(data.get('invoice_number') || '').trim(),invoice_date:date,amount,note:String(data.get('invoice_note') || '').trim(),object_path:objectPath,original_name:file.name,mime_type:mime,size_bytes:file.size};
      metadataAttempted = true;
      try {
        await api('/rest/v1/haail_invoices',record);
      } catch (error) {
        // A response may be lost after commit: confirm the same ID before cleanup.
        let confirmed;
        try {confirmed = await api('/rest/v1/haail_invoices?id=eq.' + invoiceId + '&select=id');}
        catch (_) {throw Error('تعذر تأكيد الحفظ. اضغط تحديث الفواتير بعد رجوع الاتصال قبل إعادة الرفع.');}
        if (!confirmed.length) {
          metadataAttempted = false;
          throw error;
        }
      }
      uploadedPath = null;
      form.reset();
      form.elements.invoice_date.value = haailToday();
      document.getElementById('haailInvoiceChosen').textContent = '';
      status.textContent = 'تم حفظ الفاتورة ✅';
      await loadInvoices(partyId);
    } catch (error) {
      if (uploadedPath && !metadataAttempted) {
        try {await storageRequest('object/' + bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[uploadedPath]})});} catch (_) {}
      }
      status.textContent = 'لم يتم تأكيد الحفظ: ' + error.message;
    } finally {
      uploading = false;
      form.querySelector('button[type=submit]').disabled = false;
    }
  }
  document.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target) return;
    try {
      if (target.hasAttribute('data-invoice-party')) return await showInvoices(target.dataset.invoiceParty);
      if (target.hasAttribute('data-invoice-close')) return closeInvoices();
      if (target.hasAttribute('data-invoice-refresh')) {ready();return await loadInvoices(currentParty);}
      const path = target.dataset.invoiceOpen || target.dataset.invoiceDownload;
      if (!path) return;
      ready();
      // Open synchronously so Safari permits the new tab.
      const popup = window.open('about:blank','_blank');
      if (!popup) throw Error('اسمح بفتح النوافذ لهذا الموقع ثم أعد المحاولة');
      try {
        popup.opener = null;
        const result = await storageRequest('object/sign/' + bucket + '/' + path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});
        let url = cfg.url + '/storage/v1' + result.signedURL;
        if (target.dataset.invoiceDownload) url += '&download=';
        popup.location.href = url;
      } catch(error) {popup.close();throw error;}
    } catch(error) {alert(error.message);}
  });
})();

