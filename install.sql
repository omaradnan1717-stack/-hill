-- Run once in a new Supabase project for Haail.
BEGIN;

-- database.sql
-- Run once in Supabase SQL Editor, then assign the owner UUID below.
create table public.haail_users(user_id uuid primary key references auth.users(id), username text unique check(username ~ '^[a-z][a-z0-9_.-]{2,31}$'), role text not null check(role in ('admin','employee')), name text not null);
create table public.haail_state(id integer primary key check(id=1), data jsonb not null default '{"entries":[],"parties":[]}', revision bigint not null default 0);
insert into public.haail_state(id) values(1);
create table public.haail_materials(id uuid primary key default gen_random_uuid(), name text not null, price bigint not null check(price>0), active boolean not null default true);
create table public.haail_audit(id uuid primary key default gen_random_uuid(), actor uuid not null, actor_name text not null, action text not null, payload jsonb not null, created_at timestamptz not null default now());
alter table public.haail_users enable row level security;
alter table public.haail_state enable row level security;
alter table public.haail_materials enable row level security;
alter table public.haail_audit enable row level security;
create function public.haail_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.haail_users where user_id=auth.uid() and role='admin')$$;
create policy own_profile on public.haail_users for select to authenticated using(user_id=auth.uid() or public.haail_admin());
create policy admin_users on public.haail_users for all to authenticated using(public.haail_admin()) with check(public.haail_admin());
create policy admin_state on public.haail_state for select to authenticated using(public.haail_admin());
create policy read_materials on public.haail_materials for select to authenticated using(exists(select 1 from public.haail_users where user_id=auth.uid()));
create policy manage_materials on public.haail_materials for all to authenticated using(public.haail_admin()) with check(public.haail_admin());
create policy read_audit on public.haail_audit for select to authenticated using(public.haail_admin());
revoke all on public.haail_state,public.haail_audit from anon,authenticated;
grant select on public.haail_state,public.haail_audit to authenticated;
grant select,insert,update,delete on public.haail_users,public.haail_materials to authenticated;
create function public.haail_save(body jsonb, expected bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare rev bigint; begin
 if not public.haail_admin() then raise exception 'Forbidden'; end if;
 if jsonb_typeof(body->'entries') is distinct from 'array' or jsonb_typeof(body->'parties') is distinct from 'array' then raise exception 'Invalid data'; end if;
 update public.haail_state set data=body, revision=revision+1 where id=1 and revision=expected returning revision into rev;
 if rev is null then raise exception 'Conflict: reload before saving'; end if;
 insert into public.haail_audit(actor,actor_name,action,payload) select auth.uid(),name,'admin_save',jsonb_build_object('revision',rev) from public.haail_users where user_id=auth.uid();
 return rev; end $$;
create function public.haail_accounts() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name','balance',coalesce((select sum(case when m->>'kind'='add' then (m->>'amount')::numeric else -(m->>'amount')::numeric end) from jsonb_array_elements(p->'movements') m),0))),'[]') from public.haail_state s, jsonb_array_elements(s.data->'parties') p where s.id=1 and p->>'type'='debt' and exists(select 1 from public.haail_users where user_id=auth.uid()) $$;
create function public.haail_record(request_id uuid, party_id text, operation text, material_id uuid default null, quantity integer default null, payment bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; p jsonb; movement jsonb; u public.haail_users; mat public.haail_materials; idx integer; total bigint; due numeric; previous public.haail_audit;
begin
 select * into u from public.haail_users where user_id=auth.uid(); if not found then raise exception 'Forbidden'; end if;
 select data into s from public.haail_state where id=1 for update;
 select * into previous from public.haail_audit where id=request_id;
 if found then if previous.actor<>auth.uid() then raise exception 'Duplicate request'; end if; return previous.payload; end if;
 select value, (ordinality-1)::integer into p,idx from jsonb_array_elements(s->'parties') with ordinality where value->>'id'=party_id and value->>'type'='debt';
 if p is null then raise exception 'Account unavailable'; end if;
 if operation='withdraw' then
  select * into mat from public.haail_materials where id=material_id and active;
  if not found or quantity is null or quantity<1 or quantity>100000 then raise exception 'Invalid material or quantity'; end if;
  total=mat.price*quantity;
 elsif operation='pay' then
  select coalesce(sum(case when m->>'kind'='add' then (m->>'amount')::numeric else -(m->>'amount')::numeric end),0) into due from jsonb_array_elements(p->'movements') m;
  if payment is null or payment<1 or payment>due then raise exception 'Payment exceeds balance or is invalid'; end if; total=payment;
 else raise exception 'Forbidden operation'; end if;
 if total>9007199254740991 then raise exception 'Amount too large'; end if;
 movement=jsonb_build_object('id',request_id,'date',to_char(now() at time zone 'Asia/Baghdad','YYYY-MM-DD'),'amount',total,'kind',case when operation='pay' then 'pay' else 'add' end,'note',case when operation='pay' then 'تسديد مبلغ' else 'سحب مواد: '||mat.name||' × '||quantity end,'actorId',auth.uid(),'actorName',u.name,'createdAt',now(),'materialId',material_id,'quantity',quantity,'unitPrice',mat.price);
 s=jsonb_set(s,array['parties',idx::text,'movements'],(p->'movements')||jsonb_build_array(movement));
 update public.haail_state set data=s,revision=revision+1 where id=1;
 insert into public.haail_audit(id,actor,actor_name,action,payload) values(request_id,auth.uid(),u.name,operation,movement);
 return movement;
end $$;
revoke execute on function public.haail_admin(), public.haail_save(jsonb,bigint),public.haail_accounts(),public.haail_record(uuid,text,text,uuid,integer,bigint) from public,anon;
grant execute on function public.haail_admin(), public.haail_save(jsonb,bigint),public.haail_accounts(),public.haail_record(uuid,text,text,uuid,integer,bigint) to authenticated;
-- After creating your account in Authentication > Users, replace OWNER_UUID:
-- insert into public.haail_users(user_id,role,name,username) values('OWNER_UUID','admin','مدير مطعم هيل','admin');

-- haail-daily-upgrade.sql
-- هيل: فصل الصرفيات اليومية. نفّذ الملف كاملاً مرة واحدة.

-- نسخة أمان قبل الترقية، لا تظهر للموظفين أو عبر API.
create table if not exists public.haail_daily_v2_backup (
 id integer primary key, data jsonb not null, revision bigint, saved_at timestamptz default now()
);
alter table public.haail_daily_v2_backup enable row level security;
revoke all on public.haail_daily_v2_backup from public, anon, authenticated;
insert into public.haail_daily_v2_backup(id,data,revision)
 select id,data,revision from public.haail_state where id=1 on conflict do nothing;

-- الحساب دالة نقية: لا تحذف الحركات القديمة ولا تنشئ أرصدة لأيام لم تفتح.
create or replace function public.haail_daily_reconcile(s jsonb, day_date date)
returns jsonb language plpgsql set search_path='' as $$
declare f jsonb; days jsonb; k text; v jsonb; opening numeric;
 tops numeric; spent numeric; rest numeric; rows jsonb;
begin
 f := coalesce(s->'dailyFund','{}'::jsonb);
 if coalesce((f->>'dailyVersion')::integer,0) <> 2 then
   f := f || jsonb_build_object('dailyVersion',2,'startDate',day_date::text,
     'defaultOpening',coalesce((f->>'opening')::numeric,0),
     'legacyOpening',coalesce((f->>'opening')::numeric,0),'days','{}'::jsonb);
 end if;
 days := coalesce(f->'days','{}'::jsonb);
 if not days ? day_date::text then
   days := days || jsonb_build_object(day_date::text,jsonb_build_object(
     'opening',coalesce((f->>'defaultOpening')::numeric,0)));
 end if;
 rows := coalesce(s->'entries','[]'::jsonb);
 for k,v in select key,value from jsonb_each(days) loop
   if k::date > day_date then continue; end if;
   opening := (v->>'opening')::numeric;
   select coalesce(sum((x->>'amount')::numeric),0) into tops
    from jsonb_array_elements(coalesce(f->'topups','[]'::jsonb)) x where x->>'date'=k;
   select coalesce(sum((x->>'amount')::numeric),0) into spent
    from jsonb_array_elements(rows) x where x->>'date'=k
     and x->>'type'='expense' and x->>'fundId'='daily_cash';
   rest := opening+tops-spent;
   if rest<0 then raise exception 'مصروف يوم % يتجاوز رصيده الافتتاحي وتعزيزاته',k; end if;
   if opening+tops>9007199254740991 then raise exception 'Amount too large'; end if;
   v := v || jsonb_build_object('topups',tops,'spent',spent,'remaining',rest,'closed',k::date<day_date);
   days := jsonb_set(days,array[k],v);
   if k::date < day_date then
     -- المعرّف ثابت: تحديث نفس الإيراد عند تصحيح مصروف قديم، بلا تكرار.
     select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into rows
      from jsonb_array_elements(rows) with ordinality a(x,n)
      where x->>'id' is distinct from 'daily_return_'||k;
     if rest>0 then
       rows := rows || jsonb_build_array(jsonb_build_object(
        'id','daily_return_'||k,'type','income','date',k,'amount',rest,
        'category','متبقي مخصص الصرف اليومي','method','نقدي',
        'note','ترحيل متبقي مخصص يوم '||k,'created',
          floor(extract(epoch from ((k::date+1)::timestamp at time zone 'Asia/Baghdad'))*1000),
        'dailyReturnDate',k,'actorName','النظام'));
     end if;
   end if;
 end loop;
 f := f || jsonb_build_object('days',days,'opening',(days->day_date::text->'opening'));
 return jsonb_set(jsonb_set(s,'{entries}',rows),'{dailyFund}',f);
end $$;
revoke all on function public.haail_daily_reconcile(jsonb,date) from public,anon,authenticated;

-- أي تعديل من المدير أو الموظف يعيد تسوية اليوم المغلق داخل نفس المعاملة.
create or replace function public.haail_daily_state_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.data := public.haail_daily_reconcile(new.data,(now() at time zone 'Asia/Baghdad')::date);
 return new;
end $$;
revoke all on function public.haail_daily_state_trigger() from public,anon,authenticated;
drop trigger if exists haail_daily_reconcile_trigger on public.haail_state;
create trigger haail_daily_reconcile_trigger before update on public.haail_state
 for each row execute function public.haail_daily_state_trigger();

create or replace function public.haail_cash_summary()
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; next_s jsonb; d text := to_char(now() at time zone 'Asia/Baghdad','YYYY-MM-DD'); f jsonb; v jsonb;
begin
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

create or replace function public.haail_cash_record(request_id uuid,operation text,amount bigint,item text,details text)
returns jsonb language sql security definer set search_path='' as $$
 select public.haail_cash_record_dated(request_id,operation,amount,item,details,(now() at time zone 'Asia/Baghdad')::date)
$$;

create or replace function public.haail_cash_opening(request_id uuid,new_opening bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.haail_users; s jsonb; p jsonb; d date:=(now() at time zone 'Asia/Baghdad')::date;
begin
 select * into u from public.haail_users where user_id=auth.uid() and role='admin';
 if not found then raise exception 'التعديل للمدير فقط'; end if;
 if request_id is null or new_opening is null or new_opening<0 or new_opening>9007199254740991 then raise exception 'المبلغ غير صحيح'; end if;
 select data into s from public.haail_state where id=1 for update;
 if exists(select 1 from public.haail_audit where id=request_id) then
  select payload into p from public.haail_audit where id=request_id and actor=auth.uid() and action='cash_opening';
  if not found then raise exception 'Duplicate request'; end if; return p;
 end if;
 s:=public.haail_daily_reconcile(s,d);
 p:=jsonb_build_object('date',d,'before',s->'dailyFund'->'days'->d::text->'opening','after',new_opening);
 s:=jsonb_set(s,array['dailyFund','days',d::text,'opening'],to_jsonb(new_opening));
 s:=public.haail_daily_reconcile(s,d);
 update public.haail_state set data=s,revision=revision+1 where id=1;
 insert into public.haail_audit(id,actor,actor_name,action,payload) values(request_id,auth.uid(),u.name,'cash_opening',p);
 return p;
end $$;

revoke all on function public.haail_cash_summary(),public.haail_cash_record(uuid,text,bigint,text,text),public.haail_cash_record_dated(uuid,text,bigint,text,text,date),public.haail_cash_opening(uuid,bigint) from public,anon;
grant execute on function public.haail_cash_summary(),public.haail_cash_record(uuid,text,bigint,text,text),public.haail_cash_record_dated(uuid,text,bigint,text,text,date),public.haail_cash_opening(uuid,bigint) to authenticated;

-- تفعيل يوم الترقية فقط؛ لا تُحوّل متبقي الأيام القديمة إلى إيرادات بأثر رجعي.
update public.haail_state set data=public.haail_daily_reconcile(data,(now() at time zone 'Asia/Baghdad')::date),revision=revision+1 where id=1;
-- تسوية منتصف الليل عند تفعيل pg_cron؛ وإلا تتم أول مرة يُفتح الحساب.
create or replace function public.haail_daily_tick()
returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; v jsonb;
begin
 select data into s from public.haail_state where id=1 for update;
 v:=public.haail_daily_reconcile(s,(now() at time zone 'Asia/Baghdad')::date);
 if v is distinct from s then
  update public.haail_state set data=v,revision=revision+1 where id=1;
 end if;
end $$;
revoke all on function public.haail_daily_tick() from public,anon,authenticated;
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   perform cron.schedule('haail-daily-rollover-v2','* * * * *','select public.haail_daily_tick();');
 else
   raise notice 'pg_cron غير مفعّل: تتم التسوية عند أول فتح أو تسجيل عملية بعد منتصف الليل.';
 end if;
end $cron$;
notify pgrst,'reload schema';

-- fund-accounting-v3.sql
-- هيل: فصل تحويلات عهدة الصرف عن الإيرادات. نفّذ كاملاً مرة واحدة.

create table if not exists public.haail_fund_accounting_backup_20261101
 (id integer primary key, data jsonb not null, revision bigint, saved_at timestamptz default now());
alter table public.haail_fund_accounting_backup_20261101 enable row level security;
revoke all on public.haail_fund_accounting_backup_20261101 from public, anon, authenticated;
insert into public.haail_fund_accounting_backup_20261101(id,data,revision)
 select id,data,revision from public.haail_state where id=1 on conflict do nothing;
do $migration$
begin
 if to_regprocedure('public.haail_daily_reconcile_v2_original(jsonb,date)') is null then
  alter function public.haail_daily_reconcile(jsonb,date) rename to haail_daily_reconcile_v2_original;
 end if;
end $migration$;
create or replace function public.haail_daily_reconcile(s jsonb, day_date date)
returns jsonb language plpgsql set search_path='' as $fn$
declare result jsonb; fund jsonb; rows jsonb; transfers jsonb; prior jsonb;
begin
 -- تتطلب ترقية الحساب اليومي السابقة؛ لا نخمن أرصدة البيانات القديمة.
 if coalesce((s->'dailyFund'->>'dailyVersion')::integer,0) <> 2 then
  raise exception 'نفّذ ترقية الحساب اليومي v2 أولاً';
 end if;
 fund := s->'dailyFund';
 -- اليوم الجديد لا يُموّل تلقائياً. اليوم الحالي والأيام السابقة تبقى كما سُجّلت.
 fund := fund || jsonb_build_object('defaultOpening',0,'accountingVersion',3);
 s := jsonb_set(s,'{dailyFund}',fund);
 result := public.haail_daily_reconcile_v2_original(s,day_date);
 -- إزالة الإيرادات الآلية المحددة فقط، مع حفظها في سجل منفصل قابل للمراجعة.
 select coalesce(jsonb_agg(e order by n),'[]'::jsonb) into prior
 from jsonb_array_elements(coalesce(result->'entries','[]'::jsonb)) with ordinality a(e,n)
 where e->>'dailyReturnDate' is not null and e->>'id'='daily_return_'||(e->>'dailyReturnDate');
 select coalesce(jsonb_agg(e order by n),'[]'::jsonb) into rows
 from jsonb_array_elements(coalesce(result->'entries','[]'::jsonb)) with ordinality a(e,n)
 where not (e->>'dailyReturnDate' is not null and e->>'id'='daily_return_'||(e->>'dailyReturnDate'));
 fund := result->'dailyFund';
 -- التحويلات ليست دخلاً أو مصروفاً؛ تُعاد تسويتها عند تعديل اليوم الأصلي.
 select coalesce(jsonb_agg(jsonb_build_object(
  'date',k,'toFund',(v->>'opening')::numeric+coalesce((v->>'topups')::numeric,0),
  'toMain',case when coalesce((v->>'closed')::boolean,false) then (v->>'remaining')::numeric else 0 end
 ) order by k),'[]'::jsonb) into transfers from jsonb_each(fund->'days') a(k,v);
 if not fund ? 'reclassifiedReturnsAtUpgrade' then
  fund := fund || jsonb_build_object('reclassifiedReturnsAtUpgrade',prior);
 end if;
 fund := fund || jsonb_build_object('accountingVersion',3,'defaultOpening',0,'transfers',transfers);
 return jsonb_set(jsonb_set(result,'{entries}',rows),'{dailyFund}',fund);
end $fn$;
revoke all on function public.haail_daily_reconcile(jsonb,date),public.haail_daily_reconcile_v2_original(jsonb,date) from public,anon,authenticated;
update public.haail_state set
 data=public.haail_daily_reconcile(data,(now() at time zone 'Asia/Baghdad')::date),
 revision=revision+1 where id=1;
notify pgrst,'reload schema';

-- cash-delete.sql
CREATE OR REPLACE FUNCTION public.haail_cash_delete(request_id uuid, entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  u public.haail_users;
  s jsonb;
  e jsonb;
begin
  select * into u
  from public.haail_users
  where user_id = auth.uid()
    and role = 'admin';

  if not found then
    raise exception 'Forbidden';
  end if;

  select data into s
  from public.haail_state
  where id = 1
  for update;

  if exists (
    select 1 from public.haail_audit
    where id = request_id
  ) then
    select payload into e
    from public.haail_audit
    where id = request_id
      and actor = auth.uid()
      and action = 'cash_delete';

    if not found then
      raise exception 'Duplicate request';
    end if;
    return e;
  end if;

  select x into e
  from jsonb_array_elements(s->'entries') x
  where x->>'id' = entry_id::text
    and x->>'fundId' = 'daily_cash'
    and x->>'type' = 'expense';

  if e is null then
    raise exception 'Expense not found or already deleted';
  end if;

  s = jsonb_set(s, '{entries}', (
    select coalesce(
      jsonb_agg(x order by n), '[]'::jsonb
    )
    from jsonb_array_elements(s->'entries')
      with ordinality a(x, n)
    where x->>'id' is distinct from entry_id::text
  ));

  update public.haail_state
  set data = s, revision = revision + 1
  where id = 1;

  insert into public.haail_audit(
    id, actor, actor_name, action, payload
  ) values (
    request_id, auth.uid(), u.name, 'cash_delete', e
  );

  return e;
end;
$function$;
revoke all on function public.haail_cash_delete(uuid,uuid) from public,anon;
grant execute on function public.haail_cash_delete(uuid,uuid) to authenticated;
notify pgrst,'reload schema';

-- invoices-setup.sql
-- Run once in Supabase SQL Editor. Existing accounting data is not modified.

create table if not exists public.haail_invoices (
 id uuid primary key,
 party_id text not null,
 invoice_number text not null default '',
 invoice_date date not null,
 amount numeric(18,0) check (amount >= 0),
 note text not null default '',
 object_path text not null unique,
 original_name text not null,
 mime_type text not null,
 size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now()
);
create index if not exists haail_invoices_party_date on public.haail_invoices(party_id,invoice_date desc);
alter table public.haail_invoices enable row level security;
grant select,insert,delete on public.haail_invoices to authenticated;
drop policy if exists haail_invoices_employee_read on public.haail_invoices;
drop policy if exists haail_invoices_employee_add on public.haail_invoices;
create policy haail_invoices_employee_read on public.haail_invoices for select to authenticated
 using (exists(select 1 from public.haail_users where user_id=auth.uid() and role='employee'));
create policy haail_invoices_employee_add on public.haail_invoices for insert to authenticated
 with check (created_by=auth.uid() and exists(select 1 from public.haail_users where user_id=auth.uid() and role='employee'));
drop policy if exists haail_invoices_admin on public.haail_invoices;
create policy haail_invoices_admin on public.haail_invoices for all to authenticated
 using (exists(select 1 from public.haail_users where user_id=auth.uid() and role='admin'))
 with check (created_by=auth.uid() and exists(select 1 from public.haail_users where user_id=auth.uid() and role='admin'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('haail-invoices','haail-invoices',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists haail_invoice_files_read on storage.objects;
create policy haail_invoice_files_read on storage.objects for select to authenticated
 using(bucket_id='haail-invoices' and exists(select 1 from public.haail_users where user_id=auth.uid() and role in ('admin','employee')));
drop policy if exists haail_invoice_files_add on storage.objects;
create policy haail_invoice_files_add on storage.objects for insert to authenticated
 with check(bucket_id='haail-invoices' and exists(select 1 from public.haail_users where user_id=auth.uid() and role in ('admin','employee')));
drop policy if exists haail_invoice_files_cleanup on storage.objects;
create policy haail_invoice_files_cleanup on storage.objects for delete to authenticated
 using(bucket_id='haail-invoices' and exists(select 1 from public.haail_users where user_id=auth.uid() and role='admin'));

-- daily-receipts.sql
create table if not exists public.haail_daily_receipts (
 id uuid primary key, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), receipt_date date not null,
 payment_kind text not null check(payment_kind in ('cash','credit')),
 party_id text, party_name text, amount bigint not null check(amount between 1 and 9007199254740991),
 item text not null, details text not null, object_path text not null unique,
 original_name text not null, mime_type text not null, size_bytes integer not null check(size_bytes between 1 and 10485760),
 check ((payment_kind='credit' and party_id is not null) or (payment_kind='cash' and party_id is null))
);
alter table public.haail_daily_receipts enable row level security;
revoke all on public.haail_daily_receipts from public,anon,authenticated;
grant select on public.haail_daily_receipts to authenticated;
drop policy if exists daily_receipts_read on public.haail_daily_receipts;
create policy daily_receipts_read on public.haail_daily_receipts for select to authenticated
 using(exists(select 1 from public.haail_users where user_id=auth.uid() and role in ('admin','employee')));
create or replace function public.haail_receipt_record(
 request_id uuid, receipt_date date, payment_kind text, party_id text,
 amount bigint, item text, details text, object_path text,
 original_name text, mime_type text, size_bytes integer)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare u public.haail_users; s jsonb; p jsonb; idx integer; e jsonb;
 old public.haail_daily_receipts; obj storage.objects;
 day_date date := (now() at time zone 'Asia/Baghdad')::date;
begin
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
revoke all on function public.haail_receipt_record(uuid,date,text,text,bigint,text,text,text,text,text,integer) from public,anon;
grant execute on function public.haail_receipt_record(uuid,date,text,text,bigint,text,text,text,text,text,integer) to authenticated;
notify pgrst,'reload schema';

-- employee-debts.sql
create function public.haail_employee_debt(
 request_id uuid, operation text, account_name text default null,
 account_phone text default null, party_id text default null,
 amount bigint default null, details text default null, items jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 employee public.haail_users;
 previous public.haail_audit;
 state jsonb;
 party jsonb;
 result jsonb;
 line jsonb;
 party_index integer;
 quantity numeric;
 price numeric;
 total numeric := 0;
 event_name text;
 movement_note text;
begin
 select * into employee from public.haail_users where user_id=auth.uid() and role='employee';
 if not found then raise exception 'Forbidden'; end if;
 if request_id is null or operation is null or operation not in ('create','add','invoice') then
  raise exception 'العملية غير صالحة';
 end if;
 event_name := 'employee_debt_' || operation;

 select data into state from public.haail_state where id=1 for update;
 select * into previous from public.haail_audit where id=request_id;
 if found then
  if previous.actor<>auth.uid() or previous.action<>event_name then raise exception 'Duplicate request'; end if;
  return previous.payload;
 end if;

 if operation='create' then
  if length(trim(coalesce(account_name,''))) not between 1 and 100
   or length(trim(coalesce(account_phone,''))) > 30 then
   raise exception 'تحقق من اسم الحساب ورقم الهاتف';
  end if;
  result := jsonb_build_object('id',request_id,'type','debt','name',trim(account_name),
   'phone',trim(coalesce(account_phone,'')),'movements','[]'::jsonb);
  state := jsonb_set(state,'{parties}',(state->'parties') || jsonb_build_array(result));
 else
  select value,(ordinality-1)::integer into party,party_index
  from jsonb_array_elements(state->'parties') with ordinality
  where value->>'id'=party_id and value->>'type'='debt';
  if party is null then raise exception 'اختر حساب دين موجوداً'; end if;
  if operation='invoice' then
   if jsonb_typeof(items) is distinct from 'array' then raise exception 'أضف مواد الفاتورة'; end if;
   if jsonb_array_length(items) not between 1 and 200 then raise exception 'عدد سطور الفاتورة غير صالح'; end if;
   for line in select value from jsonb_array_elements(items) loop
    if length(trim(coalesce(line->>'name',''))) not between 1 and 100
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or jsonb_typeof(line->'price') is distinct from 'number' then
     raise exception 'تحقق من بيانات المواد';
    end if;
    quantity := (line->>'quantity')::numeric;
    price := (line->>'price')::numeric;
    if quantity<>trunc(quantity) or price<>trunc(price)
      or quantity not between 1 and 9007199254740991
      or price not between 1 and 9007199254740991 then
     raise exception 'تحقق من كميات المواد وأسعارها';
    end if;
    total := total + quantity*price;
   end loop;
   select 'سحب مواد: ' || string_agg(trim(value->>'name') || ' × ' || (value->>'quantity'), '، ' order by ordinality)
   into movement_note from jsonb_array_elements(items) with ordinality;
  else
   total := amount;
   movement_note := trim(coalesce(details,''));
   if length(movement_note) not between 1 and 300 then raise exception 'تحقق من بيان الدين'; end if;
  end if;
  if total is null or total not between 1 and 9007199254740991 then raise exception 'المبلغ غير صالح'; end if;
  result := jsonb_build_object('id',request_id,'kind','add','amount',total,'note',movement_note,
   'date',(now() at time zone 'Asia/Baghdad')::date,'actorId',auth.uid(),
   'actorName',employee.name,'createdAt',now());
  if operation='invoice' then result := result || jsonb_build_object('items',items); end if;
  state := jsonb_set(state,array['parties',party_index::text,'movements'],
   (party->'movements') || jsonb_build_array(result));
 end if;

 update public.haail_state set data=state,revision=revision+1 where id=1;
 insert into public.haail_audit(id,actor,actor_name,action,payload)
 values(request_id,auth.uid(),employee.name,event_name,result);
 return result;
end $$;

create function public.haail_material_invoice(request_id uuid, party_id text, items jsonb)
returns jsonb language sql set search_path='' as $$
 select public.haail_employee_debt($1,'invoice',party_id => $2, items => $3)
$$;

revoke all on function public.haail_employee_debt(uuid,text,text,text,text,bigint,text,jsonb),
 public.haail_material_invoice(uuid,text,jsonb) from public,anon;
grant execute on function public.haail_employee_debt(uuid,text,text,text,text,bigint,text,jsonb),
 public.haail_material_invoice(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';

-- notifications-setup.sql
create table if not exists public.haail_push_links (
 endpoint text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 subscription jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.haail_notice_events (
 id uuid primary key default gen_random_uuid(), recipient uuid not null references auth.users(id) on delete cascade,
 source_id text not null, title text not null, body text not null, created_at timestamptz not null default now(),
 unique(recipient,source_id)
);
alter table public.haail_push_links enable row level security;
alter table public.haail_notice_events enable row level security;
revoke all on public.haail_push_links,public.haail_notice_events from anon,authenticated;
grant select on public.haail_notice_events to authenticated;
grant all on public.haail_push_links,public.haail_notice_events to service_role;
drop policy if exists own_notices on public.haail_notice_events;
create policy own_notices on public.haail_notice_events for select to authenticated using (
 recipient=auth.uid() and exists(select 1 from public.haail_users where user_id=auth.uid())
);
create index if not exists haail_notice_recipient_time on public.haail_notice_events(recipient,created_at desc);
create or replace function public.haail_queue_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare who uuid; actor_role text; actor_name text; source text;
begin
 if tg_table_name='haail_audit' then
  who=new.actor; source='audit:'||new.id::text;
 else
  who=auth.uid(); source=tg_table_name||':'||new.id::text;
 end if;
 select role,name into actor_role,actor_name from public.haail_users where user_id=who;
 if actor_role is null then return new; end if;
 insert into public.haail_notice_events(recipient,source_id,title,body)
 select user_id,source,'مطعم هيل',
 case when actor_role='admin' then 'سجّلت الإدارة تحديثاً جديداً في هيل. افتح البرنامج لمراجعة الحسابات المتاحة لك.'
 else coalesce(actor_name,'الموظف')||' سجّل حركة جديدة في هيل. افتح البرنامج لمراجعة التفاصيل.' end
 from public.haail_users where user_id<>who and role<>actor_role
 on conflict(recipient,source_id) do nothing;
 return new;
end $$;
revoke all on function public.haail_queue_notice() from public,anon,authenticated;
drop trigger if exists haail_notice_audit on public.haail_audit;
create trigger haail_notice_audit after insert on public.haail_audit for each row execute function public.haail_queue_notice();
-- Optional attachments tables: no historical events are sent.
do $$ begin
 if to_regclass('public.haail_invoices') is not null then
  execute 'drop trigger if exists haail_notice_invoice on public.haail_invoices';
  execute 'create trigger haail_notice_invoice after insert on public.haail_invoices for each row execute function public.haail_queue_notice()';
 end if;
end $$;

-- Next: configure an INSERT Database Webhook on haail_notice_events to haail-notify,
-- with x-haail-webhook-secret set to the same AW TAR secret configured on the server.

COMMIT;
