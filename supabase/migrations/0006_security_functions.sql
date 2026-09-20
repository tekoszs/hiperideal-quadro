-- 0006 — Funções de segurança ------------------------------------------------
--
-- POR QUE SECURITY DEFINER:
--   Estas funções leem public.quadro_profiles, que está sob RLS. As próprias políticas
--   de RLS chamam estas funções. Se fossem SECURITY INVOKER, ler quadro_profiles
--   dispararia a política de quadro_profiles, que chamaria a função de novo →
--   recursão infinita ("infinite recursion detected in policy").
--   SECURITY DEFINER quebra o ciclo. É o padrão recomendado pelo Supabase.
--
-- CUIDADOS APLICADOS:
--   - `set search_path = ''` e todos os nomes qualificados: impede que um
--     objeto plantado em schema temporário sequestre a função;
--   - `stable`: o planejador pode cachear dentro da consulta;
--   - EXECUTE revogado de PUBLIC e de anon; concedido só a authenticated;
--   - nenhuma delas aceita parâmetro que troque a identidade — a identidade
--     vem sempre de auth.uid().

-- Papel do usuário autenticado. NULL = sem perfil ativo (logado mas sem acesso).
create or replace function public.quadro_current_profile_role()
returns public.quadro_profile_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.quadro_profiles p
   where p.id = auth.uid()
     and p.active;
$$;

-- Loja do usuário autenticado. NULL para SUPERVISOR/ADMIN (acesso à rede).
create or replace function public.quadro_current_profile_store_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.store_id
    from public.quadro_profiles p
   where p.id = auth.uid()
     and p.active;
$$;

-- LEITURA: gerente vê a própria loja; supervisor e admin veem a rede toda.
create or replace function public.quadro_can_access_store(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.quadro_profiles p
     where p.id = auth.uid()
       and p.active
       and (
         p.role in ('SUPERVISOR', 'ADMIN')
         or (p.role = 'MANAGER' and p.store_id = p_store_id)
       )
  );
$$;

-- ESCRITA: somente o gerente da própria loja.
--
-- SUPERVISOR e ADMIN NÃO ganham escrita por serem perfis elevados — não há
-- regra de negócio que permita supervisor lançar falta no lugar do gerente.
-- Quando existir (ex.: reabertura), entra como RPC própria e explícita.
create or replace function public.quadro_can_write_store(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.quadro_profiles p
     where p.id = auth.uid()
       and p.active
       and p.role = 'MANAGER'
       and p.store_id = p_store_id
  );
$$;

-- Autorização de transição de status: só as RPCs ligam este GUC, que é local
-- à transação. O PostgREST não expõe SET/set_config ao cliente REST, então a
-- chave anon não consegue simular esta autorização.
create or replace function public.quadro_status_change_is_authorized()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('quadro.status_change', true), 'off') = 'on';
$$;

revoke all on function public.quadro_current_profile_role()      from public;
revoke all on function public.quadro_current_profile_store_id()  from public;
revoke all on function public.quadro_can_access_store(text)      from public;
revoke all on function public.quadro_can_write_store(text)       from public;
revoke all on function public.quadro_status_change_is_authorized() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.quadro_current_profile_role() to authenticated';
    execute 'grant execute on function public.quadro_current_profile_store_id() to authenticated';
    execute 'grant execute on function public.quadro_can_access_store(text) to authenticated';
    execute 'grant execute on function public.quadro_can_write_store(text) to authenticated';
    execute 'grant execute on function public.quadro_status_change_is_authorized() to authenticated';
  end if;
end
$$;
