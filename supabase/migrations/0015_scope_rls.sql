-- 0015 -- RLS por escopo -----------------------------------------------------
--
-- Substitui os helpers de acesso para entenderem STORE / DISTRICT / ALL.
--
-- O QUE NAO MUDA
-- --------------
--   - a ESCRITA continua sendo so do gerente da propria loja;
--   - conferencia SUBMITTED continua imutavel para todo mundo, inclusive ADMIN;
--   - nenhuma policy vira USING (true);
--   - nenhum objeto do Organico e tocado.
--
-- DE ONDE VEM A AUTORIZACAO
-- -------------------------
--       auth.uid()  ->  quadro_profiles  ->  access_scope + store_id/district_id
--
-- Nunca do frontend. As funcoes abaixo NAO aceitam parametro que troque a
-- identidade: recebem a loja consultada e olham o proprio perfil de quem
-- pergunta. Um usuario pode forjar qualquer coisa no navegador -- district_id
-- na URL, store_id no filtro, payload adulterado -- e nada disso chega aqui.

-- Distrito do usuario autenticado. NULL para escopo STORE e ALL.
create or replace function public.quadro_current_profile_district_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.district_id
    from public.quadro_profiles p
   where p.id = auth.uid()
     and p.active;
$$;

-- Escopo do usuario autenticado. NULL = sem perfil ativo (logado, sem acesso).
create or replace function public.quadro_current_access_scope()
returns public.quadro_access_scope
language sql
stable
security definer
set search_path = ''
as $$
  select p.access_scope
    from public.quadro_profiles p
   where p.id = auth.uid()
     and p.active;
$$;

-- ---------------------------------------------------------------------------
-- LEITURA de loja
-- ---------------------------------------------------------------------------
--
--   STORE     -> so a propria loja
--   DISTRICT  -> so lojas cujo district_id bate com o do perfil
--   ALL       -> a rede inteira
--
-- O join com quadro_stores acontece DENTRO de uma funcao security definer, e e
-- de proposito: o distrito verdadeiro da loja precisa ser lido sem passar pela
-- RLS de quadro_stores, senao a policy chamaria a si mesma.
--
-- Loja com district_id NULL nao aparece para escopo DISTRICT: `s.district_id =
-- p.district_id` e falso quando um dos lados e NULL. Padrao seguro -- descuido
-- de cadastro nao vira acesso indevido.
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
      left join public.quadro_stores s on s.id = p_store_id
     where p.id = auth.uid()
       and p.active
       and (
         p.access_scope = 'ALL'
         or (p.access_scope = 'STORE'    and p.store_id = p_store_id)
         or (p.access_scope = 'DISTRICT' and s.district_id = p.district_id)
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- LEITURA de distrito
-- ---------------------------------------------------------------------------
--
--   ALL       -> todos os distritos (para o filtro "Todos os distritos")
--   DISTRICT  -> so o proprio
--   STORE     -> so o distrito da propria loja, para a tela exibir o nome
create or replace function public.quadro_can_access_district(p_district_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.quadro_profiles p
      left join public.quadro_stores s on s.id = p.store_id
     where p.id = auth.uid()
       and p.active
       and (
         p.access_scope = 'ALL'
         or (p.access_scope = 'DISTRICT' and p.district_id = p_district_id)
         or (p.access_scope = 'STORE'    and s.district_id = p_district_id)
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- ESCRITA -- inalterada na pratica
-- ---------------------------------------------------------------------------
--
-- Continua sendo somente o gerente da propria loja. Escopo DISTRICT e ALL NAO
-- ganham escrita: nao existe regra de negocio que permita supervisor lancar
-- falta no lugar do gerente. Quando existir (reabertura), sera RPC propria,
-- explicita e auditada.
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
       and p.access_scope = 'STORE'
       and p.store_id = p_store_id
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS da tabela de distritos
-- ---------------------------------------------------------------------------
alter table public.quadro_districts enable row level security;

drop policy if exists quadro_districts_select on public.quadro_districts;
create policy quadro_districts_select on public.quadro_districts
  for select to authenticated
  using (public.quadro_can_access_district(id));

-- Sem policy de INSERT/UPDATE/DELETE: distrito nao se cria nem se apaga pela
-- API. E manutencao administrativa, por SQL.

-- ---------------------------------------------------------------------------
-- Perfis: supervisor distrital enxerga so a propria gente
-- ---------------------------------------------------------------------------
--
-- Antes: qualquer SUPERVISOR ou ADMIN lia TODOS os perfis. Com distritos isso
-- vazaria o diretorio da rede inteira para um supervisor distrital.
--
-- Agora:
--   - a propria linha, sempre;
--   - ADMIN e escopo ALL: todos os perfis;
--   - escopo DISTRICT: so perfis do proprio distrito -- inclusive os gerentes
--     das lojas do distrito, que e o que a tela de conferencias precisa para
--     mostrar quem enviou.
drop policy if exists quadro_profiles_select on public.quadro_profiles;
create policy quadro_profiles_select on public.quadro_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.quadro_current_access_scope() = 'ALL'
    or (
      public.quadro_current_access_scope() = 'DISTRICT'
      and (
        -- perfil distrital do mesmo distrito
        district_id = public.quadro_current_profile_district_id()
        -- ou gerente de uma loja do distrito
        or exists (
          select 1
            from public.quadro_stores s
           where s.id = quadro_profiles.store_id
             and s.district_id = public.quadro_current_profile_district_id()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Privilegios do novo objeto
-- ---------------------------------------------------------------------------
--
-- COEXISTENCIA: cada GRANT/REVOKE cita nominalmente o objeto quadro_*. Nada
-- de `on all tables in schema`, que atingiria as tabelas do Organico.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.quadro_districts from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.quadro_districts to authenticated';
    execute 'grant execute on function public.quadro_current_profile_district_id() to authenticated';
    execute 'grant execute on function public.quadro_current_access_scope() to authenticated';
    execute 'grant execute on function public.quadro_can_access_district(text) to authenticated';
  end if;
end
$$;

revoke all on function public.quadro_current_profile_district_id() from public;
revoke all on function public.quadro_current_access_scope()        from public;
revoke all on function public.quadro_can_access_district(text)     from public;
