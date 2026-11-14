'use strict';
// Presentation only: preserve existing entries, cloud saving and cash accounting.
function revenueRows(rows) {
  return rows.filter(e => e.type === 'income' &&
    !(typeof haailAutomaticReturn === 'function' && haailAutomaticReturn(e)));
}
function revenueSummary(rows) {
  const all = revenueRows(rows), cash = all.filter(e=>e.method==='نقدي'),
    master = all.filter(e=>e.method==='ماستر كارد'),
    other = all.filter(e=>!['نقدي','ماستر كارد'].includes(e.method));
  const expenses = rows.filter(e=>e.type==='expense');
  const cashSpent=sum(expenses.filter(e=>e.method==='نقدي'));
  const masterSpent=sum(expenses.filter(e=>e.method==='ماستر كارد'));
  return '<div class="cards">'+stat('إيراد نقدي',sum(cash))+stat('إيراد ماستر',sum(master))+
    (other.length?stat('إيرادات بطرق أخرى',sum(other)):'')+stat('إجمالي الإيرادات',sum(all))+
    stat('إجمالي المصروفات',sum(expenses))+stat('المتبقي بعد المصروفات',sum(all)-sum(expenses))+
    stat('المصروف النقدي',cashSpent)+stat('المتبقي من الإيراد النقدي',sum(cash)-cashSpent)+
    stat('مصروفات الماستر',masterSpent)+stat('المتبقي من إيراد الماستر',sum(master)-masterSpent)+'</div>';

}
const ledgerBeforeRevenueSplit = ledger;
ledger = function(type) {
  if(type!=='income') return ledgerBeforeRevenueSplit(type);
  const all = revenueRows(db.entries).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.created-a.created);
  const groups=[['إيراد نقدي','نقدي'],['إيراد ماستر','ماستر كارد']];
  const other=all.filter(e=>!['نقدي','ماستر كارد'].includes(e.method));
  return '<section class="panel"><button onclick="cashierPage()">مطابقة الكاشير</button></section>'+ 
    '<section class="panel"><h2>ملخص الإيرادات المسجلة</h2>'+revenueSummary(db.entries)+'</section>'+ 
    groups.map(([title,method])=>`<section class="panel"><h2>إضافة ${title}</h2><form onsubmit="addEntry(event,'income')">${dateField.replace(/value="[^"]*"/,`value="${today()}"`)}${moneyField}<input type="hidden" name="method" value="${method}"><div><label>التصنيف</label><select name="category">${['مبيعات المطعم','مبيعات الكافيه','توصيل','إيراد آخر'].map(c=>`<option>${c}</option>`).join('')}</select></div>${noteField}<button>حفظ ${title}</button></form></section><section class="panel"><div class="topline"><h2>سجل ${title}</h2><b>${fmt(sum(all.filter(e=>e.method===method)))}</b></div>${entryTable(all.filter(e=>e.method===method),true)}</section>`).join('')+
    (other.length?'<section class="panel"><h2>إيرادات بطرق أخرى</h2>'+entryTable(other,true)+'</section>':'')+
    '<div class="actions no-print"><button onclick="printLedger(\'income\')">عرض كشف الإيرادات / طباعة</button></div>'+
    '<p class="notice">المتبقي يُحسب بعد طرح المصروفات المسجّلة لنفس الفترة وبحسب طريقة الدفع. هذا المتبقي لا يشمل الرصيد السابق أو تحويل عهدة الصرف. الماستر يدخل بإجمالي الإيرادات، ولا يدخل برصيد الصندوق النقدي. إيرادات مطابقة الكاشير تظهر تلقائياً هنا؛ لا تسجّلها مرة ثانية.</p>';
};
const homeBeforeRevenueSplit=home;
home=function(){return homeBeforeRevenueSplit()+'<section class="panel" style="margin-top:14px"><h2>تفصيل إيرادات الشهر</h2>'+revenueSummary(db.entries.filter(e=>e.date.startsWith(filterMonth)))+'</section>';};
const showReportBeforeRevenueSplit=showReport;
showReport=function(){
  showReportBeforeRevenueSplit();
  const from=document.getElementById('from').value,to=document.getElementById('to').value;
  if(from>to)return;
  document.getElementById('reportResult').insertAdjacentHTML('beforeend','<h3>تفصيل الإيرادات للفترة</h3>'+revenueSummary(db.entries.filter(e=>e.date>=from&&e.date<=to)));
};
const printLedgerBeforeRevenueSplit=printLedger;
printLedger=function(type){
  if(type!=='income')return printLedgerBeforeRevenueSplit(type);
  const rows=db.entries.filter(e=>!(typeof haailAutomaticReturn==='function'&&haailAutomaticReturn(e))).slice().sort((a,b)=>a.date.localeCompare(b.date));
  openStatement('كشف الإيرادات',revenueSummary(rows)+['نقدي','ماستر كارد'].map(method=>'<h3>'+ (method==='نقدي'?'إيراد نقدي':'إيراد ماستر')+'</h3>'+entryTable(revenueRows(rows).filter(e=>e.method===method),false)).join('')+
    (revenueRows(rows).some(e=>!['نقدي','ماستر كارد'].includes(e.method))?'<h3>إيرادات بطرق أخرى</h3>'+entryTable(revenueRows(rows).filter(e=>!['نقدي','ماستر كارد'].includes(e.method)),false):''));
};
if(profile?.role==='admin')render();

