begin;

create table if not exists public.haail_cashier_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.haail_cashier_users enable row level security;
revoke all on table public.haail_cashier_users from public, anon, authenticated;

create or replace function public.haail_cashier_access()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.haail_cashier_users where user_id = auth.uid()
  ) and not exists (
    select 1 from public.haail_users where user_id = auth.uid()
  );
$$;

create or replace function public.haail_cashier_submit(
  cashier text, shift text, match_date date, total bigint, master bigint, opening bigint
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  state_data jsonb;
  match_id uuid := gen_random_uuid();
  match_data jsonb;
  entries jsonb;
  entry_data jsonb;
  cash_amount bigint;
begin
  if not public.haail_cashier_access() then
    raise exception 'هذا الحساب غير مخوّل بمطابقة الكاشير' using errcode = '42501';
  end if;

  cashier := regexp_replace(btrim(cashier), '\s+', ' ', 'g');
  shift := btrim(shift);
  if cashier is null or char_length(cashier) not between 1 and 100
    or shift is null or char_length(shift) not between 1 and 50
    or match_date is null or match_date not between date '0001-01-01' and date '9999-12-31'
    or total is null or total not between 1 and 9007199254740991
    or master is null or master not between 0 and total
    or opening is null or opening not between 0 and total - master
    or opening = total then
    raise exception 'تحقق من اسم الكاشير والتاريخ والشفت والمبالغ' using errcode = '22023';
  end if;

  select data into strict state_data from public.haail_state where id = 1 for update;
  if not public.haail_cashier_access() then
    raise exception 'انتهى تخويل مطابقة الكاشير' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(state_data->'entries') as entry(value)
    where entry.value #>> '{cashierMatch,date}' = match_date::text
      and entry.value #>> '{cashierMatch,cashier}' = cashier
      and entry.value #>> '{cashierMatch,shift}' = shift
  ) then
    raise exception 'هذه المطابقة مرحّلة سابقاً لنفس الكاشير والتاريخ والشفت' using errcode = '23505';
  end if;

  cash_amount := total - master - opening;
  match_data := jsonb_build_object(
    'id', match_id, 'cashier', cashier, 'shift', shift, 'date', match_date,
    'total', total, 'master', master, 'opening', opening, 'recordedBy', auth.uid()
  );
  entry_data := jsonb_build_object(
    'type', 'income', 'date', match_date, 'created', floor(extract(epoch from clock_timestamp()) * 1000),
    'category', 'مبيعات الكاشير', 'note', 'مطابقة ' || cashier || ' — شفت ' || shift || ' — دخول الكاشير ' || opening,
    'cashierMatchId', match_id
  );
  entries := '[]'::jsonb;
  if cash_amount > 0 then
    entries := jsonb_build_array(entry_data || jsonb_build_object(
      'id', gen_random_uuid(), 'amount', cash_amount, 'method', 'نقدي', 'cashierMatch', match_data
    ));
  end if;
  if master > 0 then
    if cash_amount = 0 then
      entry_data := entry_data || jsonb_build_object('cashierMatch', match_data);
    end if;
    entries := entries || jsonb_build_array(entry_data || jsonb_build_object(
      'id', gen_random_uuid(), 'amount', master, 'method', 'ماستر كارد'
    ));
  end if;

  update public.haail_state
  set data = jsonb_set(state_data, '{entries}', (state_data->'entries') || entries),
      revision = revision + 1
  where id = 1;
end;
$$;

revoke all on function public.haail_cashier_access() from public, anon, authenticated;
revoke all on function public.haail_cashier_submit(text,text,date,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.haail_cashier_access() to authenticated;
grant execute on function public.haail_cashier_submit(text,text,date,bigint,bigint,bigint) to authenticated;
commit;
