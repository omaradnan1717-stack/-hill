begin;
create table if not exists public.haail_permissions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 cashier boolean not null default false, expenses boolean not null default false
);
alter table public.haail_permissions enable row level security;
revoke all on public.haail_permissions from public,anon,authenticated;
create or replace function public.haail_permission(kind text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.haail_admin() or coalesce(
 (select case kind when 'cashier' then p.cashier when 'expenses' then p.expenses else false end
 from public.haail_permissions p where p.user_id=auth.uid()),
 case kind when 'cashier' then exists(select 1 from public.haail_cashier_users where user_id=auth.uid())
 when 'expenses' then exists(select 1 from public.haail_users where user_id=auth.uid() and role='employee') else false end);
$$;
create or replace function public.haail_permissions_get() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('cashier',public.haail_permission('cashier'),'expenses',public.haail_permission('expenses'));
$$;
create or replace function public.haail_permissions_list() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.haail_admin() then raise exception 'غير مخوّل'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',u.user_id,'name',u.name,
 'cashier',coalesce(p.cashier,exists(select 1 from public.haail_cashier_users c where c.user_id=u.user_id)),
 'expenses',coalesce(p.expenses,true))) from public.haail_users u left join public.haail_permissions p using(user_id)
 where u.role='employee'),'[]'::jsonb);
end $$;
create or replace function public.haail_permissions_set(target uuid,allow_cashier boolean,allow_expenses boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.haail_admin() then raise exception 'غير مخوّل'; end if;
 if allow_cashier is null or allow_expenses is null or not exists(select 1 from public.haail_users where user_id=target and role='employee') then raise exception 'اختر موظفاً موجوداً'; end if;
 insert into public.haail_permissions values(target,allow_cashier,allow_expenses)
 on conflict(user_id) do update set cashier=excluded.cashier,expenses=excluded.expenses;
 insert into public.haail_audit(id,actor,actor_name,action,payload)
 select gen_random_uuid(),auth.uid(),name,'permissions',jsonb_build_object('user_id',target,'cashier',allow_cashier,'expenses',allow_expenses)
 from public.haail_users where user_id=auth.uid();
end $$;
create or replace function public.haail_cashier_access() returns boolean
language sql stable security definer set search_path='' as $$ select public.haail_permission('cashier'); $$;
create or replace function public.haail_cash_summary()
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; next_s jsonb; d text := to_char(now() at time zone 'Asia/Baghdad','YYYY-MM-DD'); f jsonb; v jsonb;
begin
 if not public.haail_permission('expenses') then raise exception 'غير مخوّل بالصرفيات' using errcode='42501'; end if;
 if not exists(select 1 from public.haail_users where user_id=auth.uid()) then raise exception 'Forbidden'; end if;
 select data into s from public.haail_state where id=1 for update;
 next_s := public.haail_daily_reconcile(s,d::date);
 if next_s is distinct from s then
   update public.haail_state set data=next_s,revision=revision+1 where id=1;
 end if;
 f:=next_s->'dailyFund'; v:=f->'days'->d;
 return jsonb_build_object('dailyVersion',2,'date',d,'startDate',f->'startDate',
  'days',f->'days','legacyOpening',f->'legacyOpening','opening',v->'opening',
  'funded',(v->>'opening')::numeric+(v->>'topups')::numeric,
  'spent',v->'spent','remaining',v->'remaining',
  'entries',coalesce((select jsonb_agg(e order by e->>'date',e->>'createdAt')
    from jsonb_array_elements(next_s->'entries') e where e->>'type'='expense'
     and e->>'fundId'='daily_cash'),'[]'::jsonb),
  'topups',coalesce(f->'topups','[]'::jsonb));
end $$;
create or replace function public.haail_cash_record_dated(request_id uuid,operation text,amount bigint,item text,details text,expense_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.haail_users; s jsonb; e jsonb; prev public.haail_audit;
 d date:=(now() at time zone 'Asia/Baghdad')::date; f jsonb; target text;
begin
 if not public.haail_permission('expenses') then raise exception 'غير مخوّل بالصرفيات' using errcode='42501'; end if;
 select * into u from public.haail_users where user_id=auth.uid();
 if not found then raise exception 'Forbidden'; end if;
 if request_id is null or operation is null or operation not in ('spend','topup')
  or (operation='topup' and u.role<>'admin') then raise exception 'Forbidden'; end if;
 if amount is null or amount<1 or amount>9007199254740991 or expense_date is null
  or length(trim(coalesce(item,'')))=0 or length(item)>100
  or length(trim(coalesce(details,'')))=0 or length(details)>300 then raise exception 'Invalid input'; end if;
 select data into s from public.haail_state where id=1 for update;
 select * into prev from public.haail_audit where id=request_id;
 if found then
  if prev.actor is distinct from auth.uid() or prev.action is distinct from operation then raise exception 'Duplicate request'; end if;
  return prev.payload;
 end if;
 s:=public.haail_daily_reconcile(s,d); f:=s->'dailyFund'; target:=expense_date::text;
 if expense_date>d then raise exception 'لا يمكن تسجيل صرف بتاريخ مستقبلي'; end if;
 if u.role<>'admin' and expense_date<>d then raise exception 'الموظف يسجل مصروف اليوم فقط'; end if;
 if expense_date<(f->>'startDate')::date then raise exception 'هذا التاريخ قبل تفعيل الحساب اليومي؛ السجل القديم محفوظ'; end if;
 if not (f->'days') ? target then
   f:=jsonb_set(f,array['days',target],jsonb_build_object('opening',(f->'defaultOpening')));
   s:=jsonb_set(s,'{dailyFund}',f);
 end if;
 e:=jsonb_build_object('id',request_id,'created',floor(extract(epoch from now())*1000),
  'createdAt',now(),'date',target,'amount',amount,'category',trim(item),'note',trim(details),
  'actorId',auth.uid(),'actorName',u.name,'fundId','daily_cash');
 if operation='spend' then
  e:=e||jsonb_build_object('type','expense','method','نقدي');
  s:=jsonb_set(s,'{entries}',(s->'entries')||jsonb_build_array(e));
 else
  s:=jsonb_set(s,'{dailyFund}',f||jsonb_build_object('topups',coalesce(f->'topups','[]'::jsonb)||jsonb_build_array(e)));
 end if;
 s:=public.haail_daily_reconcile(s,d);
 update public.haail_state set data=s,revision=revision+1 where id=1;
 insert into public.haail_audit(id,actor,actor_name,action,payload)
 values(request_id,auth.uid(),u.name,operation,e);
 return e;
end $$;
create or replace function public.haail_receipt_record(
 request_id uuid, receipt_date date, payment_kind text, party_id text,
 amount bigint, item text, details text, object_path text,
 original_name text, mime_type text, size_bytes integer)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare u public.haail_users; s jsonb; p jsonb; idx integer; e jsonb;
 old public.haail_daily_receipts; obj storage.objects;
 day_date date := (now() at time zone 'Asia/Baghdad')::date;
begin
 if not public.haail_permission('expenses') then raise exception 'غير مخوّل بالصرفيات' using errcode='42501'; end if;
 select * into u from public.haail_users where user_id=auth.uid() and role in ('admin','employee');
 if not found then raise exception 'غير مخوّل'; end if;
 if request_id is null then raise exception 'رقم العملية مطلوب'; end if;
 -- All accounting writers serialize on the same state row.
 select data into s from public.haail_state where id=1 for update;
 if s is null then raise exception 'الحساب غير مهيأ'; end if;
 select * into old from public.haail_daily_receipts r where r.id=request_id;
 if found then
  if old.created_by is distinct from auth.uid() or
   (old.receipt_date,old.payment_kind,old.party_id,old.amount,old.item,old.details,old.object_path,old.original_name,old.mime_type,old.size_bytes)
   is distinct from (receipt_date,payment_kind,party_id,amount,trim(item),trim(details),object_path,original_name,mime_type,size_bytes)
   then raise exception 'رقم المحاولة مستخدم ببيانات مختلفة'; end if;
  return to_jsonb(old);
 end if;
 if exists(select 1 from public.haail_audit a where a.id=request_id) then raise exception 'رقم العملية مستخدم'; end if;
 if payment_kind is null or payment_kind not in ('cash','credit') or receipt_date is null
  or receipt_date>day_date or (u.role='employee' and receipt_date<>day_date)
  or amount is null or amount<1 or amount>9007199254740991
  or length(trim(coalesce(item,'')))=0 or length(item)>100
  or length(trim(coalesce(details,'')))=0 or length(details)>300
  or length(coalesce(original_name,'')) not between 1 and 255
  or size_bytes is null or size_bytes not between 1 and 10485760
  or mime_type is null or mime_type not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')
  or object_path is null or split_part(object_path,'/',1)<>auth.uid()::text
  or split_part(split_part(object_path,'/',2),'.',1)<>request_id::text
  or (payment_kind='cash' and party_id is not null)
 then raise exception 'تحقق من بيانات الوصل والتاريخ'; end if;
 select * into obj from storage.objects o where o.bucket_id='haail-invoices' and o.name=object_path;
 if not found or coalesce((obj.metadata->>'size')::bigint,-1)<>size_bytes
  or obj.metadata->>'mimetype' is distinct from mime_type then raise exception 'ارفع الوصل كاملاً أولاً'; end if;
 if payment_kind='cash' then
  e:=public.haail_cash_record_dated(request_id,'spend',amount,item,details,receipt_date);
  select data into s from public.haail_state where id=1;
  select (n-1)::integer into idx from jsonb_array_elements(s->'entries') with ordinality a(v,n) where v->>'id'=request_id::text;
  if idx is null then raise exception 'تعذر ربط الوصل بالمصروف'; end if;
  s:=jsonb_set(s,array['entries',idx::text],(s->'entries'->idx)||jsonb_build_object('receiptId',request_id));
 else
  select v,(n-1)::integer into p,idx from jsonb_array_elements(s->'parties') with ordinality a(v,n)
   where v->>'id'=party_id and v->>'type'='debt';
  if p is null then raise exception 'اختر مكتباً موجوداً في الديون'; end if;
  e:=jsonb_build_object('id',request_id,'date',receipt_date,'amount',amount,'kind','add',
   'note','شراء آجل: '||trim(item)||' — '||trim(details),'actorId',auth.uid(),'actorName',u.name,
   'createdAt',now(),'receiptId',request_id,'paymentKind','credit');
  s:=jsonb_set(s,array['parties',idx::text,'movements'],coalesce(p->'movements','[]'::jsonb)||jsonb_build_array(e));
  insert into public.haail_invoices(id,party_id,invoice_date,amount,note,object_path,original_name,mime_type,size_bytes,created_by)
   values(request_id,party_id,receipt_date,amount,'شراء آجل: '||trim(item)||' — '||trim(details),object_path,original_name,mime_type,size_bytes,auth.uid());
  insert into public.haail_audit(id,actor,actor_name,action,payload)
   values(request_id,auth.uid(),u.name,'credit_receipt',e);
 end if;
 update public.haail_state set data=s,revision=revision+1 where id=1;
 insert into public.haail_daily_receipts(id,created_by,receipt_date,payment_kind,party_id,party_name,amount,item,details,object_path,original_name,mime_type,size_bytes)
 values(request_id,auth.uid(),receipt_date,payment_kind,party_id,p->>'name',amount,trim(item),trim(details),object_path,original_name,mime_type,size_bytes);
 select * into old from public.haail_daily_receipts r where r.id=request_id;
 return to_jsonb(old);
end $fn$;
revoke all on function public.haail_permission(text),public.haail_permissions_get(),public.haail_permissions_list(),public.haail_permissions_set(uuid,boolean,boolean) from public,anon;
grant execute on function public.haail_permission(text),public.haail_permissions_get(),public.haail_permissions_list(),public.haail_permissions_set(uuid,boolean,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
