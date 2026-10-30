/* משרלי billing: private admin-only records. Never store amounts or payment state in localStorage. */
'use strict';
(()=>{
 const $=id=>document.getElementById(id);let companies=[],charges=[],loading=false;
 const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
 const db=()=>window.FursaV5?.getClient();
 const admin=()=>!!window.FursaV5?.isAdmin();
 const fmt=n=>'₪'+Number(n||0).toLocaleString('en-US');
 function setStatus(msg){$('billingStatus').textContent=msg;}
 function updateHint(){
   const select=$('jobCompanyId'),hint=$('jobPricingHint');
   if(!select||!hint)return;
   if(!admin()){hint.hidden=true;return;}
   const c=companies.find(x=>x.id===select.value);
   if(!c){hint.hidden=false;hint.textContent='لازم تسجل شركة وتختارها قبل حفظ الوظيفة.';return}
   const used=charges.some(x=>x.company_id===c.id);
   const editing=!!$('editId').value;
   hint.hidden=false;
   hint.textContent=editing?'تعديل الإعلان الحالي لا ينشئ رسوم نشر جديدة.':'سعر هذا الإعلان: '+(used?'₪70 — يُحفظ كمسودة حتى تأكيد الدفع':'₪0 — الإعلان المجاني الأول لهذه الشركة')+'.';
 }
 function syncEditor(id){
   const wrap=$('companySelectWrap'),sel=$('jobCompanyId');
   if(!wrap||!sel)return;
   wrap.hidden=!admin();sel.required=admin();
   const existing=window.FursaV5?.getManagedJobs()?.find(x=>x.id===id);
   sel.replaceChildren();
   const blank=document.createElement('option');blank.value='';blank.textContent='اختر الشركة';sel.append(blank);
   companies.forEach(c=>{const opt=document.createElement('option');opt.value=c.id;opt.textContent=c.name;sel.append(opt)});
   sel.value=existing?.companyId||'';
   sel.disabled=!!existing?.companyId;
   $('jobCompany').readOnly=!!existing?.companyId;
   if(existing?.companyId){$('jobCompany').value=existing.company;}
   updateHint();
 }
 function render(){
   const jobs=window.FursaV5?.getManagedJobs()||[];
   $('totalCompanies').textContent=companies.length;
   $('totalPaid').textContent=fmt(charges.filter(x=>x.payment_status==='paid').reduce((t,x)=>t+x.amount_ils,0));
   $('totalUnpaid').textContent=fmt(charges.filter(x=>x.payment_status==='unpaid').reduce((t,x)=>t+x.amount_ils,0));
   $('companiesRows').innerHTML=companies.length?companies.map(c=>{
    const fees=charges.filter(x=>x.company_id===c.id);
    return `<tr><td><b>${esc(c.name)}</b><br><small>${esc(c.contact_email||'')}</small></td><td>${fees.length}</td><td>${fees.filter(f=>f.amount_ils===0).length}</td><td>${fees.filter(f=>f.payment_status==='paid').length}</td><td>${fmt(fees.filter(f=>f.payment_status==='unpaid').reduce((s,f)=>s+f.amount_ils,0))}</td></tr>`;
   }).join(''):'<tr><td colspan="5">ما في شركات مسجّلة بعد.</td></tr>';
   $('feesRows').innerHTML=charges.length?charges.map(f=>{
    const c=companies.find(x=>x.id===f.company_id),j=jobs.find(x=>x.id===f.job_id);
    const caption=f.payment_status==='free'?'مجاني':f.payment_status==='paid'?'مدفوع':'بانتظار الدفع';
    return `<tr><td>${esc(c?.name||'شركة سابقة')}</td><td>${esc(j?.title||'إعلان محذوف')}</td><td>${fmt(f.amount_ils)}</td><td>${caption}</td><td>${f.payment_status==='unpaid'&&j?`<button type="button" data-markpaid="${esc(j.id)}">تأكيد دفع ₪70 ونشر</button>`:'—'}</td></tr>`
   }).join(''):'<tr><td colspan="5">ما في رسوم مسجّلة بعد.</td></tr>';
   updateHint();
 }
 async function refresh(){
   if(!admin()||!db()||loading)return;
   loading=true;
   try{
      const [a,b]=await Promise.all([
        db().from('mishrali_companies').select('id,name,contact_email,created_at').order('created_at',{ascending:false}).limit(500),
        db().from('mishrali_job_fees').select('id,job_id,company_id,amount_ils,payment_status,paid_at,created_at').order('created_at',{ascending:false}).limit(1000)
      ]);
      if(a.error)throw a.error;if(b.error)throw b.error;
      companies=a.data||[];charges=b.data||[];render();
      setStatus('سجل الأسعار متصل بقاعدة البيانات. الحفظ والدفع محصوران بحساب المدير.');
   }catch(err){setStatus('تعذّر تحميل السجل: '+String(err.message||err).slice(0,160));throw err}
   finally{loading=false}
 }
 async function createCompany(ev){
   ev.preventDefault();if(!admin()||!db())return;
   const name=$('companyName').value.trim(),email=$('companyEmail').value.trim().toLowerCase()||null;
   if(name.length<2)return;
   if(companies.some(x=>x.name.trim().toLowerCase()===name.toLowerCase()))return setStatus('الشركة مسجّلة عندنا من قبل. اخترها من القائمة بدل تسجيلها مرتين.');
   const btn=$('companyForm').querySelector('button');btn.disabled=true;
   try{
     const {error}=await db().from('mishrali_companies').insert({name,contact_email:email});if(error)throw error;
     $('companyForm').reset();await refresh();setStatus('تم تسجيل الشركة. الإعلان الأول لها مجاني مرة واحدة.');
   }catch(err){setStatus('تعذّر حفظ الشركة: '+String(err.message||err).slice(0,160))}
   finally{btn.disabled=false}
 }
 async function markPaid(id){
   if(!admin()||!db())return;
   if(!confirm('هل استلمت ₪70 فعلًا لهذا الإعلان؟ سيتم تسجيل الدفع ونشر الوظيفة لجميع الزوار.'))return;
   const {data,error}=await db().rpc('mishrali_confirm_job_payment',{p_job_id:id});
   if(error)return setStatus('لم يتم تأكيد الدفع: '+String(error.message||error).slice(0,180));
   setStatus('تم تسجيل الدفع ونشر الإعلان. احتفظ بمستند الدفع خارج الموقع.');
   await window.FursaV5.refreshAll();
 }
 $('companyForm')?.addEventListener('submit',createCompany);
 $('feesRows')?.addEventListener('click',ev=>{const btn=ev.target.closest('[data-markpaid]');if(btn)markPaid(btn.dataset.markpaid)});
 $('jobCompanyId')?.addEventListener('change',()=>{
   const c=companies.find(x=>x.id===$('jobCompanyId').value);
   if(c){$('jobCompany').value=c.name;$('jobCompany').readOnly=true}else $('jobCompany').readOnly=false;
   updateHint();
 });
 window.MishraliBilling={refresh,syncEditor};
})();
