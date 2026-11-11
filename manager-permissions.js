 'use strict';
let hillPermissions=null;
async function loadHillPermissions(){hillPermissions=await api('/rest/v1/rpc/haail_permissions_get',{});return hillPermissions;}
const hillEmployee=employee;
employee=async function(){
 await hillEmployee();
 try{await loadHillPermissions();}catch(e){hillPermissions=null;}
 nav.querySelectorAll('button').forEach(b=>{if(b.textContent.includes('الصرفيات'))b.hidden=!hillPermissions?.expenses;});
 if(hillPermissions?.cashier)nav.insertAdjacentHTML('afterbegin','<button onclick="cashierPage()">مطابقة الكاشير</button>');
};
const hillDaily=sharedDaily;
sharedDaily=async function(){
 try{if(!(await loadHillPermissions()).expenses)throw Error('غير مخوّل بالصرفيات');return await hillDaily();}catch(e){alert(e.message);}
};
const hillCashier=cashierPage;
cashierPage=async function(){
 if(profile?.role==='admin')return hillCashier();
 try{if(!(await loadHillPermissions()).cashier)throw Error('غير مخوّل بمطابقة الكاشير');return hillCashier();}catch(e){alert(e.message);}
};
const hillManagement=management;
management=async function(){await hillManagement();if(profile?.role!=='admin')return;
 const section=document.createElement('section');section.className='panel';app.prepend(section);
 section.innerHTML='<h2>صلاحيات الموظفين</h2>';
 try{const users=await api('/rest/v1/rpc/haail_permissions_list',{});
 for(const u of users){const form=document.createElement('form');
 const name=document.createElement('h3');name.textContent=u.name;form.append(name);
 const boxes={};for(const [key,label] of [['cashier','مطابقة الكاشير'],['expenses','الصرفيات']]){
 const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.checked=u[key];boxes[key]=c;l.append(c,document.createTextNode(label));form.append(l);}
 const button=document.createElement('button');button.textContent='حفظ الصلاحيات';form.append(button);
 const status=document.createElement('p');status.setAttribute('role','status');form.append(status);
 form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{await api('/rest/v1/rpc/haail_permissions_set',{target:u.user_id,allow_cashier:boxes.cashier.checked,allow_expenses:boxes.expenses.checked});status.textContent='تم حفظ الصلاحيات';}catch(e){status.textContent='لم يتم تأكيد الحفظ: '+e.message;}finally{button.disabled=false;}};section.append(form);}
 if(!users.length)section.append(document.createTextNode('أضف موظفاً من النموذج أدناه أولاً.'));
 }catch(e){section.append(document.createTextNode('يلزم تفعيل تحديث الصلاحيات بقاعدة البيانات مرة واحدة. '));const a=document.createElement('a');a.href='manager-permissions.sql';a.textContent='فتح نص التفعيل';a.target='_blank';section.append(a);}
};
