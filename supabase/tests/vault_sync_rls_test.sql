-- pgTAP integration test for vault_sync row isolation.
-- Run with: supabase test db
begin;

select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'inkly-a@example.invalid', 'test-only', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'inkly-b@example.invalid', 'test-only', pg_catalog.now(), pg_catalog.now(), pg_catalog.now());

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ insert into public.vault_sync (user_id, envelope) values ('10000000-0000-4000-8000-000000000001', '{"format":"test-ciphertext"}'::jsonb) $$,
  'account A can create its own encrypted envelope'
);

select throws_ok(
  $$ insert into public.vault_sync (user_id, envelope) values ('20000000-0000-4000-8000-000000000002', '{"format":"test-ciphertext"}'::jsonb) $$,
  '42501',
  null,
  'account A cannot create a row for account B'
);

select is(
  (select count(*)::integer from public.vault_sync),
  1,
  'account A can read its own row'
);

select is(
  (select revision::integer from public.vault_sync where user_id = '10000000-0000-4000-8000-000000000001'),
  1,
  'new cloud envelope starts at revision one'
);

update public.vault_sync
   set envelope = '{"format":"updated-test-ciphertext"}'::jsonb
 where user_id = '10000000-0000-4000-8000-000000000001';

select is(
  (select revision::integer from public.vault_sync where user_id = '10000000-0000-4000-8000-000000000001'),
  2,
  'server increments revision on every update'
);

select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::integer from public.vault_sync),
  0,
  'account B cannot read account A row'
);

update public.vault_sync
   set envelope = '{"format":"tampered"}'::jsonb
 where user_id = '10000000-0000-4000-8000-000000000001';

set local role postgres;

select is(
  (select envelope ->> 'format' from public.vault_sync where user_id = '10000000-0000-4000-8000-000000000001'),
  'updated-test-ciphertext',
  'account B cannot update account A row'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$ insert into public.vault_sync (user_id, envelope) values ('20000000-0000-4000-8000-000000000002', '{"format":"test-ciphertext"}'::jsonb) $$,
  'account B can create its own encrypted envelope'
);

set local role anon;
select throws_ok(
  $$ select count(*) from public.vault_sync $$,
  '42501',
  null,
  'anonymous role has no table privilege'
);

select * from finish();
rollback;
