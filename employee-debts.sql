begin;

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
commit;
