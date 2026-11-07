-- Run once in Supabase SQL Editor. Existing accounting data is not modified.
begin;
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
commit;
