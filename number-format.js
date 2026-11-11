'use strict';
// Keep the original numeric values used by calculations and saved records.
(()=>{
 const observed=new WeakSet();
 const formatter=new Intl.NumberFormat('en-US',{maximumFractionDigits:20});
 function attach(input){
  if(observed.has(input))return;
  observed.add(input);
  const preview=document.createElement('small');
  preview.className='numeric-preview';
  preview.style.cssText='display:block;direction:ltr;text-align:right;color:#17685c;font-variant-numeric:tabular-nums;margin-top:5px';
  input.insertAdjacentElement('afterend',preview);
  function update(){
   const value=input.value;
   let text='';
   if(value && input.type==='number' && Number.isFinite(Number(value)))text=formatter.format(Number(value));
   if(value && input.type==='date' && /^\d{4}-\d{2}-\d{2}$/.test(value))text=value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4);
   if(preview.textContent!==text)preview.textContent=text;
  }
  input.addEventListener('input',update);
  input.addEventListener('change',update);
  input.form?.addEventListener('reset',()=>setTimeout(update,0));
  update();
 }
 function scan(){document.querySelectorAll('#app input[type="number"],#app input[type="date"]').forEach(attach);}
 new MutationObserver(scan).observe(document.getElementById('app'),{childList:true,subtree:true});
 scan();
})();
