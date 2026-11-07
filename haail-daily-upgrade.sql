-- هيل: فصل الصرفيات اليومية. نفّذ الملف كاملاً مرة واحدة.
begin;
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
commit;
