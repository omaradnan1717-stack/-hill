begin;
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
commit;
-- Next: configure an INSERT Database Webhook on haail_notice_events to haail-notify,
-- with x-haail-webhook-secret set to the same AW TAR secret configured on the server.
