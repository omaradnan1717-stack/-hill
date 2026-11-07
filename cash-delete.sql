begin;
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
commit;
