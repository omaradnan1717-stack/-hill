-- هيل: فصل تحويلات عهدة الصرف عن الإيرادات. نفّذ كاملاً مرة واحدة.
begin;
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
commit;

