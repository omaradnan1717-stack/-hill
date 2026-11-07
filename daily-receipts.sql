begin;
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
commit;
