'use strict';
/* FURSA V5.1 — OWNER-ONLY publishing; enforce database RLS. Demo remains local. */
(() => {
  const $ = id => document.getElementById(id);
  const cfg=window.FURSA_CONFIG||{};
  const url=String(cfg.url||'').trim();
  const key=String(cfg.publishableKey||cfg.anonKey||'').trim();
  const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && key.length>25;
  let db=null, session=null, role=null, lastJobs=[], lastManaged=[];
  let busy=false;
  const simple = value => String(value||'').slice(0,140);
  function status(text, error=false){
    $('v5AuthSummary').textContent=text;
    $('v5AuthSummary').style.borderColor=error?'#da9f98':'#ebdfc1';
  }
  function say(text,error=false){$('v5AuthError').textContent=text;$('v5AuthError').style.color=error?'#a63c26':'#346b42'}
  function updateUI(){
    const button=$('v5AuthBtn');
    const admin=isAdmin();
    if(!configured){
      button.textContent='◈ تجربة محلية';
      $('navAdmin').hidden=false;
      return;
    }
    $('v5Refresh').hidden=false;
    button.textContent=admin?'◈ مدير FURSA':'◈ دخول المدير';
    $('v5AuthForm').hidden=!!session;
    $('v5SignedBlock').hidden=!session;
    $('v5SignedText').textContent=session?`${session.user.email} · ${admin?'مدير الموقع':'لا توجد صلاحية للنشر لهذا الحساب'}`:'';
    $('v5AdminNote').hidden=!admin;
    $('navAdmin').hidden=!admin;
    $('navAdmin').textContent='◈ لوحة مدير الموقع';
    $('addJob').disabled=!admin;
    $('resetDemo').hidden=true;
    document.querySelector('label[for="importJobs"]')?.setAttribute('hidden','');
    $('navAdmin').setAttribute('aria-label','لوحة المدير الحصرية');
    if(!admin && window.FursaV4?.getPage()==='admin')window.FursaV4.openPage('public');
  }
  function normalize(row){
    return {id:row.id,title:row.title,company:row.company,city:row.city,field:row.field,type:row.type,experience:row.experience,
      salaryMin:row.salary_min,salaryMax:row.salary_max,remote:row.remote,description:row.description,
      sourceLang:row.source_lang||'ar',translations:row.translations||{},createdAt:row.created_at,
      status:row.status,ownerId:row.owner_id};
  }
  function rowPayload(job){
    return {title:job.title,company:job.company,city:job.city,field:job.field,type:job.type,experience:job.experience,
      salary_min:job.salaryMin,salary_max:job.salaryMax,remote:job.remote,description:job.description,
      source_lang:job.sourceLang||'ar',translations:job.translations||{},status:'published'};
  }
  function throwIfError(result){if(result.error)throw result.error;return result.data}
  async function loadAll(){
    if(!db)return;
    const [publicResult,managedResult]=await Promise.all([
      db.from('jobs').select('*').eq('status','published').order('created_at',{ascending:false}).limit(500),
      isAdmin()?db.from('jobs').select('*').order('created_at',{ascending:false}).limit(500):Promise.resolve({data:[],error:null})
    ]);
    const published=throwIfError(publicResult)||[];
    let owned=throwIfError(managedResult)||[];
    lastJobs=published.map(normalize);
    lastManaged=owned.map(normalize);
    window.FursaV4.setCloudJobs(lastJobs,lastManaged);
  }
  async function refreshAll(){
    try{await loadAll();status('متصل بقاعدة البيانات. فقط مدير FURSA يستطيع إنشاء ونشر وإدارة الوظائف.');say('');}
    catch(err){status('تعذّر تحميل الوظائف. تحقق من SQL والصلاحيات والاتصال.',true);say(simple(err.message),true);}
  }
  async function loadRole(){
    session=(await db.auth.getSession()).data.session;
    role=null;
    if(session){
      const res=await db.from('profiles').select('role').eq('id',session.user.id).single();
      if(res.error){say('تعذّر تحميل صلاحيات الحساب: '+simple(res.error.message),true);}
      else role=res.data.role;
    }
    updateUI();
  }
  async function recheck(){await loadRole();await refreshAll();}
  function isAdmin(){return !!(session && role==='admin')}
  function mayManage(){return isAdmin()}
  function promptLogin(){
    if(!configured){window.FursaV4.toast('لا توجد قاعدة بيانات. افتح README لإعداد Supabase.');return;}
    if(session&&!isAdmin())say('هذا الحساب لا يملك صلاحيات المدير؛ تواصل مع مالك المشروع.',true);
    $('v5AuthDialog').showModal();
  }
  async function saveJob(job,previous,translationResult){
    if(!mayManage()){promptLogin();return}
    if(busy)return;
    busy=true;
    try{
      const row=rowPayload(job);
      // Only the unique admin may save and publish. SQL RLS also enforces this.
      let result;
      if(previous){ result=await db.from('jobs').update(row).eq('id',previous.id).select('id').single(); }
      else {row.owner_id=session.user.id;result=await db.from('jobs').insert(row).select('id').single();}
      throwIfError(result);
      window.FursaV4.closeEditor();
      await refreshAll();
      window.FursaV4.toast(translationResult===false?'تم نشر الوظيفة، بعض الترجمات ناقصة.':'تم نشر الوظيفة لجميع الزوار ✓');
    }catch(err){window.FursaV4.toast('تعذّر الحفظ: '+simple(err.message));}
    finally{busy=false}
  }
  async function deleteJob(job){
    if(!mayManage())return promptLogin();
    if(!confirm(`حذف إعلان «${job.title}» من قاعدة البيانات نهائيًا؟`))return;
    try{throwIfError(await db.from('jobs').delete().eq('id',job.id));await refreshAll();window.FursaV4.toast('حُذف الإعلان من قاعدة البيانات ✓')}
    catch(err){window.FursaV4.toast('الحذف لم ينجح: '+simple(err.message))}
  }
  async function moderate(id,statusValue){
    if(!isAdmin())return;
    if(!confirm(statusValue==='published'?'نشر هذه الوظيفة للزوار؟':'إخفاء هذه الوظيفة عن الزوار؟'))return;
    try{throwIfError(await db.from('jobs').update({status:statusValue}).eq('id',id));await refreshAll();window.FursaV4.toast(statusValue==='published'?'تم نشر الإعلان ✓':'تم إخفاء الإعلان عن الزوار')}
    catch(err){window.FursaV4.toast('تعذّرت المراجعة: '+simple(err.message))}
  }
  async function submitAuth(ev){
    ev.preventDefault(); if(!db||busy)return;
    const form=ev.currentTarget, data=new FormData(form);
    const email=String(data.get('email')||'').trim().toLowerCase();
    const password=String(data.get('password')||'');
    if(password.length<8)return say('كلمة المرور لازم تكون 8 حروف على الأقل',true);
    busy=true;$('v5AuthSubmit').disabled=true;say('جاري تسجيل الدخول...');
    try{
      const res=await db.auth.signInWithPassword({email,password});throwIfError(res);
      form.querySelector('[name="password"]').value='';
      await recheck();
      if(isAdmin()){$('v5AuthDialog').close();say('تم تسجيل دخول المدير ✓');}
      else say('هذا الحساب ليس مدير FURSA، ولا يملك أي صلاحية لإضافة الوظائف.',true);
    }catch(err){say('تعذّر الدخول: '+simple(err.message),true)}
    finally{busy=false;$('v5AuthSubmit').disabled=false}
  }
  function wire(){
    $('v5Refresh').addEventListener('click',()=>{if(db)refreshAll();});
    $('v5AuthBtn').addEventListener('click',()=>{if(!configured)return window.FursaV4.toast('الوضع المحلي: اربط Supabase من config.js لتفعيل الحسابات.');promptLogin()});
    $('v5AuthClose').addEventListener('click',()=>$('v5AuthDialog').close());
    $('v5AuthForm').addEventListener('submit',submitAuth);
    $('v5Logout').addEventListener('click',async()=>{await db?.auth.signOut();$('v5AuthDialog').close();await recheck()});
    $('adminRows').addEventListener('click',e=>{const approve=e.target.closest('[data-approve]');const hide=e.target.closest('[data-reject]');if(approve)moderate(approve.dataset.approve,'published');if(hide)moderate(hide.dataset.reject,'draft')});
    window.addEventListener('focus',()=>{if(db&&document.visibilityState==='visible')refreshAll()});
  }
  async function start(){
    wire();updateUI();
    if(!configured){status('هذه نسخة محلية. بإمكانك إضافة وتعديل الوظائف تجريبيًا، لكن الآخرين لن يشاهدوها.');return}
    if(location.protocol!=='https:' && location.hostname!=='localhost' && location.hostname!=='127.0.0.1'){
      status('وضع الاتصال يحتاج صفحة HTTPS منشورة أو localhost. افتح README للتعليمات.',true);return;
    }
    window.FursaV4.setCloudMode();
    $('v5ModeStrip').innerHTML='<b>FURSA LIVE</b><span class="strip-divider"></span> نشر الوظائف حصري لمدير الموقع · لا تقديم إلكتروني حاليًا';
    document.querySelector('.local-label').textContent='قاعدة مشتركة';
    document.querySelector('#jobs .section-header p').textContent='الوظائف المنشورة هنا تأتي من قاعدة البيانات المشتركة بعد مراجعة المدير. خدمات تقديم الطلبات ستتوفر لاحقًا.';
    document.querySelector('#statJobs')?.nextElementSibling?.replaceChildren(document.createTextNode('وظائف منشورة'));
    document.querySelector('.footer-note').innerHTML='FURSA V5 · وظائف مشتركة<br>التقديم الإلكتروني غير متاح بعد';
    document.querySelector('#adminView .admin-heading .kicker').textContent='✦ FURSA / مدير الموقع';
    document.querySelector('#adminView .admin-heading p').textContent='أنت وحدك تقدر تضيف وتعدل وتحذف الوظائف المنشورة لكل الزوار.';
    document.querySelector('#adminView .admin-notice p').innerHTML='<strong>سياسة النشر:</strong> حساب المدير الوحيد يدير جميع الإعلانات، والصلاحيات محمية في قاعدة البيانات. لا تستقبل بيانات المتقدمين عبر هذه النسخة.';
    document.querySelector('#adminView .admin-bar p').textContent='بعد الحفظ تُنشر الوظيفة مباشرة وتظهر لكل الزوار عند تحديث الموقع.';
    document.querySelector('#adminView .admin-stats small').textContent='وظائف مدير الموقع';
    document.querySelector('#editorDialog .micro-label').textContent='✦ FURSA / نشر حصري للمدير';
    try{
      await new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';script.onload=resolve;script.onerror=()=>reject(new Error('فشل تحميل مكتبة Supabase؛ تحقق من الاتصال'));document.head.append(script)
      });
      if(!window.supabase?.createClient)throw Error('مكتبة Supabase غير متاحة');
      db=window.supabase.createClient(url.replace(/\/$/,''),key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      db.auth.onAuthStateChange((_event,_session)=>{setTimeout(()=>{recheck().catch(err=>status(simple(err.message),true))},0)});
      await recheck();
    }catch(err){status('فشل الاتصال، لا يمكن عرض وظائف حقيقية حاليًا: '+simple(err.message),true);say(simple(err.message),true)}
  }
  window.FursaV5={mayManage,isAdmin,promptLogin,saveJob,deleteJob,refreshAll};
  start();
})();
