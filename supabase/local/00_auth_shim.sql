-- ============================================================================
-- SHIM DE AUTENTICAÇÃO — SOMENTE PARA POSTGRESQL LOCAL
--
-- NÃO RODE ESTE ARQUIVO NO SUPABASE. O Supabase já fornece o schema `auth`,
-- a função `auth.uid()` e os papéis anon / authenticated / service_role.
--
-- Este arquivo recria o mínimo necessário para que as migrations e os testes
-- rodem num PostgreSQL comum, com o MESMO comportamento do Supabase.
--
-- Uso:
--   psql -d hiperideal -f supabase/local/00_auth_shim.sql
--   psql -d hiperideal -f supabase/schema.sql
--   psql -d hiperideal -f supabase/seed.sql
-- ============================================================================

-- Este arquivo é SÓ para PostgreSQL local e nunca é aplicado no Supabase,
-- então pode ter necessidades próprias. Mesmo assim, pgcrypto não é preciso:
-- gen_random_uuid() é nativo do PostgreSQL desde a versão 13.

create schema if not exists auth;

-- Espelha o essencial de auth.users do Supabase.
create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

-- Mesma implementação do Supabase: lê o "sub" do JWT posto na sessão.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  );
$$;

-- Papéis que o PostgREST assume conforme o token recebido.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
