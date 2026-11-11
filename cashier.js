'use strict';
// Uses the existing revision-checked state transaction: both revenues commit together.
const renderBeforeCashier = render;
render = function() {
  renderBeforeCashier();
  if (profile?.role === 'admin') nav.insertAdjacentHTML('afterbegin','<button onclick="cashierPage()">مطابقة الكاشير</button>');
};
function cashierGroups() {
  return db.entries.filter(e=>e.cashierMatch).map(e=>e.cashierMatch);
}
function cashierPage() {
  const isAdmin = profile?.role === 'admin';
  if (!isAdmin && profile?.role !== 'cashier' && !hillPermissions?.cashier) return;
  clearInterval(dailyPoll);
  const rows = isAdmin ? cashierGroups().sort((a,b)=>b.date.localeCompare(a.date)) : [];
  app.innerHTML = `<section class="panel"><h2>مطابقة الكاشير</h2><p>الكلي − الماستر − دخول الكاشير = الصافي النقدي. الحفظ يرحّل الإيرادين معاً.</p><form id="cashierForm"><div><label>اسم الكاشير</label><input name="cashier" maxlength="100" required list="cashierNames"><datalist id="cashierNames">${[...new Set(rows.map(r=>r.cashier))].map(n=>`<option value="${esc(n)}">`).join('')}</datalist></div><div><label>التاريخ</label><input name="date" type="date" value="${today()}" required></div><div><label>الشفت / رقم الوجبة</label><input name="shift" value="1" maxlength="50" required></div><div><label>المبيعات الكلية (د.ع)</label><input name="total" type="number" min="1" step="1" required></div><div><label>الماستر (د.ع)</label><input name="master" type="number" min="0" step="1" value="0" required></div><div><label>دخول الكاشير (د.ع)</label><input name="opening" type="number" min="0" step="1" value="0" required></div><div><label>الصافي النقدي</label><output id="cashierNet" style="display:block;padding:11px;font-weight:bold">—</output></div><button type="submit">حفظ وترحيل المطابقة</button></form><p id="cashierStatus" role="status"></p></section>${isAdmin ? `<section class="panel"><h2>المطابقات المستقلة</h2><div class="scroll"><table><thead><tr><th>التاريخ</th><th>الكاشير</th><th>الشفت</th><th>الكلي</th><th>دخول الكاشير</th><th>صافي النقدي</th><th>ماستر</th><th>إجراء</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${datefmt(r.date)}</td><td>${esc(r.cashier)}</td><td>${esc(r.shift)}</td><td>${fmt(r.total)}</td><td>${fmt(r.opening||0)}</td><td>${fmt(r.total-r.master-(r.opening||0))}</td><td>${fmt(r.master)}</td><td><button class="danger" onclick="deleteCashierMatch('${esc(r.id)}')">إلغاء المطابقة</button></td></tr>`).join('')||'<tr><td colspan="8">لا توجد مطابقات</td></tr>'}</tbody></table></div><p class="notice">كل كاشير مستقل. عند وجود أكثر من وجبة لنفس الكاشير في اليوم، استخدم رقم شفت مختلفاً. لا تسجّل هذه المبيعات مرة ثانية يدوياً بالإيرادات. الإلغاء يحذف إيرادي المطابقة معاً.</p></section>` : ''}`;
  const form=document.getElementById('cashierForm');
  form.oninput=()=>{const t=Number(form.elements.total.value),m=Number(form.elements.master.value),o=Number(form.elements.opening.value);document.getElementById('cashierNet').textContent=Number.isSafeInteger(t)&&Number.isSafeInteger(m)&&Number.isSafeInteger(o)&&o>=0&&m>=0&&t-m>=o?fmt(t-m-o):'تحقق من المبالغ';};
  mountMasterReceipts(form);
  form.onsubmit=async ev=>{
    ev.preventDefault();
    const f=new FormData(form),cashier=String(f.get('cashier')).trim().replace(/\s+/g,' '),shift=String(f.get('shift')).trim(),date=f.get('date'),total=Number(f.get('total')),master=Number(f.get('master')),opening=Number(f.get('opening'));
    if(!cashier||!shift||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isSafeInteger(total)||total<=0||!Number.isSafeInteger(master)||master<0||master>total||!Number.isSafeInteger(opening)||opening<0||opening>total-master)return alert('تحقق من الاسم والتاريخ والمبالغ؛ مجموع الماستر ودخول الكاشير لا يتجاوز الكلي');
    if(total-opening===0)return alert('الصافي والماستر صفر؛ لا يوجد إيراد لترحيله');
    const status=document.getElementById('cashierStatus');
    busy(true);
    try {
      if (!isAdmin) {
        await api('/rest/v1/rpc/haail_cashier_submit',{cashier,shift,match_date:date,total,master,opening});
        form.reset();
        form.oninput();
        status.textContent='تم حفظ المطابقة وترحيل الإيراد ✅';
        return;
      }
      await refreshAdmin();
      if(cashierGroups().some(r=>r.date===date&&r.cashier===cashier&&r.shift===shift))throw Error('هذه المطابقة مرحّلة سابقاً لنفس الكاشير والتاريخ والشفت');
      const match={id:id(),cashier,shift,date,total,master,opening}, next=structuredClone(db),created=Date.now();
      const newRows=[{amount:total-master-opening,method:'نقدي'},{amount:master,method:'ماستر كارد'}].filter(e=>e.amount>0).map(e=>({...e,id:id(),type:'income',created,date,category:'مبيعات الكاشير',note:'مطابقة '+cashier+' — شفت '+shift+' — دخول الكاشير '+opening,cashierMatchId:match.id}));
      newRows[0].cashierMatch=match;
      next.entries.push(...newRows);
      const newRevision=await api('/rest/v1/rpc/haail_save',{body:next,expected:revision});
      db=next;committed=structuredClone(next);revision=newRevision;
      cashierPage();document.getElementById('cashierStatus').textContent='تم حفظ المطابقة وترحيل النقدي والماستر ✅';
    } catch(error) {
      // Refresh after ambiguous responses: a committed match will block a retry.
      if(isAdmin){try{await refreshAdmin();}catch(_){}}
      status.textContent='لم يتم تأكيد الحفظ: '+error.message+' — عند إعادة المحاولة يتم فحص التكرار أولاً.';
    } finally {busy(false);}
  };
}
async function deleteCashierMatch(matchId) {
  if(profile?.role!=='admin'||!confirm('إلغاء المطابقة وحذف الإيراد النقدي وإيراد الماستر المرتبطين بها؟'))return;
  busy(true);
  try {
    await refreshAdmin();
    if(!cashierGroups().some(r=>r.id===matchId))throw Error('المطابقة غير موجودة؛ حدّث السجل');
    const next=structuredClone(db);next.entries=next.entries.filter(e=>e.cashierMatchId!==matchId);
    const newRevision=await api('/rest/v1/rpc/haail_save',{body:next,expected:revision});
    db=next;committed=structuredClone(next);revision=newRevision;cashierPage();
  }catch(e){alert('لم يتم تأكيد الإلغاء: '+e.message);try{await refreshAdmin();cashierPage();}catch(_){}}finally{busy(false);}
}
const removeEntryBeforeCashier=removeEntry;
removeEntry=function(key){const e=db.entries.find(e=>e.id===key);if(e?.cashierMatchId)return deleteCashierMatch(e.cashierMatchId);return removeEntryBeforeCashier(key);};

const ledgerBeforeSimpleMatch=ledger;
ledger=function(type){return (type==='income'?'<section class="panel"><button onclick="cashierPage()">مطابقة الكاشير</button></section>':'')+ledgerBeforeSimpleMatch(type);};


function parseMasterReceipt(value){
 const text=String(value).trim().replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
 if(!/^(?:\d+|\d{1,3}(?:[,٬]\d{3})+)$/.test(text))throw Error('أدخل مبلغ الوصل رقماً صحيحاً، مثل 15,000');
 const amount=Number(text.replace(/[,٬]/g,''));
 if(!Number.isSafeInteger(amount)||amount<=0)throw Error('مبلغ الوصل يجب أن يكون أكبر من صفر');
 return amount;
}
function mountMasterReceipts(form){
 const master=form.elements.master;
 const box=document.createElement('div');box.style.gridColumn='1 / -1';
 box.innerHTML=`<details><summary>جمع وصولات الماستر</summary><p>أضف مبلغ كل وصل؛ المجموع ينتقل تلقائياً إلى خانة الماستر. الحفظ يتم بزر حفظ وترحيل المطابقة.</p><label>مبلغ الوصل<input data-receipt-amount type="text" inputmode="numeric" autocomplete="off" placeholder="مثال: 15,000" dir="ltr"></label><button type="button" data-add-receipt>إضافة الوصل</button><ol data-receipt-list></ol><p data-receipt-total></p><button type="button" class="light" data-clear-receipts>مسح قائمة الوصولات</button><p data-receipt-status role="status"></p></details>`;
 master.parentElement.insertAdjacentElement('afterend',box);
 const input=box.querySelector('[data-receipt-amount]'),list=box.querySelector('[data-receipt-list]'),summary=box.querySelector('[data-receipt-total]'),status=box.querySelector('[data-receipt-status]');
 let amounts=[];
 function draw(sync){
  list.replaceChildren();
  const total=amounts.reduce((a,b)=>a+b,0);
  amounts.forEach((amount,index)=>{
   const row=document.createElement('li');row.append(document.createTextNode(fmt(amount)+' '));
   const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='حذف';
   remove.onclick=()=>{amounts.splice(index,1);draw(true);};row.append(remove);list.append(row);
  });
  summary.textContent='عدد الوصولات: '+amounts.length+' — المجموع: '+fmt(total);
  master.readOnly=amounts.length>0;
  if(sync){master.value=String(total);master.dispatchEvent(new Event('input',{bubbles:true}));}
 }
 function add(){
  try{
   const amount=parseMasterReceipt(input.value),total=amounts.reduce((a,b)=>a+b,0)+amount;
   if(!Number.isSafeInteger(total))throw Error('مجموع الوصولات أكبر من الحد المسموح');
   if(!amounts.length && Number(master.value)>0 && !confirm('استبدال مبلغ الماستر الحالي بمجموع قائمة الوصولات؟'))return;
   amounts.push(amount);input.value='';status.textContent='';draw(true);input.focus();
  }catch(e){status.textContent=e.message;}
 }
 box.querySelector('[data-add-receipt]').onclick=add;
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add();}});
 // An unadded receipt must never silently disappear during final submission.
 input.addEventListener('input',()=>input.setCustomValidity(input.value.trim()?'اضغط إضافة الوصل أولاً':''));
 box.querySelector('[data-add-receipt]').addEventListener('click',()=>{if(!input.value)input.setCustomValidity('');});
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!input.value)input.setCustomValidity('');});
 box.querySelector('[data-clear-receipts]').onclick=()=>{
  if(!amounts.length)return;
  if(!confirm('مسح قائمة الوصولات وتصفير خانة الماستر؟'))return;
  amounts=[];status.textContent='';draw(true);
 };
 form.addEventListener('reset',()=>{amounts=[];input.setCustomValidity('');status.textContent='';setTimeout(()=>draw(false),0);});
 draw(false);
}
