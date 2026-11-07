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
