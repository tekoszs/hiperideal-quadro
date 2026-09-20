-- 0003 — Perfis ligados ao Supabase Auth -------------------------------------
--
-- quadro_profiles.id É o auth.users.id. Não existe perfil sem usuário autenticado,
-- e a role NUNCA vem do frontend: é lida daqui.

create table if not exists public.quadro_profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  role       public.quadro_profile_role not null default 'MANAGER',
  store_id   text references public.quadro_stores (id) on delete restrict,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  -- MANAGER obrigatoriamente pertence a uma loja.
  -- SUPERVISOR e ADMIN podem ter store_id nulo (acesso à rede).
  constraint quadro_profiles_manager_needs_store_ck
    check (role <> 'MANAGER' or store_id is not null)
);

create index if not exists quadro_profiles_store_idx on public.quadro_profiles (store_id);
create index if not exists quadro_profiles_role_idx on public.quadro_profiles (role);

-- ---------------------------------------------------------------------------
-- Ninguém promove a si mesmo.
--
-- A RLS de quadro_profiles permite que a pessoa atualize a própria linha (para
-- corrigir o nome), mas WITH CHECK não enxerga a linha antiga — então a
-- imutabilidade de role/store_id/active precisa de gatilho.
-- ---------------------------------------------------------------------------
create or replace function public.quadro_guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.quadro_profile_role;
begin
  select p.role into v_actor_role
    from public.quadro_profiles p
   where p.id = auth.uid() and p.active;

  -- ADMIN pode administrar perfis.
  if v_actor_role = 'ADMIN' then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Alteração de perfil (role) não permitida.' using errcode = '42501';
  end if;

  if new.store_id is distinct from old.store_id then
    raise exception 'Alteração de loja do usuário não permitida.' using errcode = '42501';
  end if;

  if new.active is distinct from old.active then
    raise exception 'Ativação/desativação de usuário não permitida.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'Alteração de id de perfil não permitida.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.quadro_guard_profile_privileges() from public;

drop trigger if exists quadro_profiles_guard_privileges on public.quadro_profiles;
create trigger quadro_profiles_guard_privileges
  before update on public.quadro_profiles
  for each row execute function public.quadro_guard_profile_privileges();
