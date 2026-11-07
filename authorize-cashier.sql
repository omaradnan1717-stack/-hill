-- Run in project hill after creating the cashier in Authentication → Users.
-- Replace CASHIER_UID with the UID of the new cashier account.
insert into public.haail_cashier_users (user_id)
select id from auth.users
where id = 'CASHIER_UID'::uuid
  and email_confirmed_at is not null
  and not exists (select 1 from public.haail_users where user_id = auth.users.id)
on conflict (user_id) do nothing
returning user_id;

-- To revoke later, run separately with the same UID:
-- delete from public.haail_cashier_users where user_id = 'CASHIER_UID'::uuid;
