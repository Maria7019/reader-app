-- Inkly encrypted cloud vault sync
-- Run only after creating the owner's Supabase project.
create table if not exists public.vault_sync (
  user_id uuid primary key references auth.users (id) on delete cascade,
  envelope jsonb not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint vault_sync_envelope_is_object check (pg_catalog.jsonb_typeof(envelope) = 'object')
);

alter table public.vault_sync enable row level security;

-- Remove broad defaults explicitly; policies do not revoke table grants.
revoke all on table public.vault_sync from anon, authenticated;
grant select, insert, update on table public.vault_sync to authenticated;

drop policy if exists "vault_sync_select_own" on public.vault_sync;
create policy "vault_sync_select_own"
  on public.vault_sync
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "vault_sync_insert_own" on public.vault_sync;
create policy "vault_sync_insert_own"
  on public.vault_sync
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "vault_sync_update_own" on public.vault_sync;
create policy "vault_sync_update_own"
  on public.vault_sync
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.inkly_vault_sync_set_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.updated_at := pg_catalog.clock_timestamp();
  else
    new.user_id := old.user_id;
    new.revision := old.revision + 1;
    new.updated_at := pg_catalog.clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function public.inkly_vault_sync_set_metadata() from public, anon, authenticated;

drop trigger if exists inkly_vault_sync_metadata on public.vault_sync;
create trigger inkly_vault_sync_metadata
  before insert or update on public.vault_sync
  for each row
  execute function public.inkly_vault_sync_set_metadata();

comment on table public.vault_sync is
  'Stores only a client-side encrypted Inkly vault envelope. Never store plaintext library data or key material here.';
comment on column public.vault_sync.envelope is
  'Versioned client-side encrypted envelope; server must treat contents as opaque ciphertext.';
