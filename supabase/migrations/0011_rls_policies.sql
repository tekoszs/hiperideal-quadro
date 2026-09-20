-- 0011 — RLS real por perfil -------------------------------------------------
--
-- Nenhuma política usa `using (true)` / `with check (true)`.
-- Toda decisão passa pelas funções de 0006, que leem o perfil no BANCO —
-- a role nunca vem do frontend.
--
-- Resumo:
--   MANAGER     lê e escreve somente a própria loja, e só enquanto DRAFT/REOPENED
--   SUPERVISOR  lê a rede inteira; não escreve conferência
--   ADMIN       lê a rede inteira; administra perfis; não escreve conferência
--   anon        nada

alter table public.quadro_stores             enable row level security;
alter table public.quadro_positions          enable row level security;
alter table public.quadro_store_staffing     enable row level security;
alter table public.quadro_profiles           enable row level security;
alter table public.quadro_absence_reasons    enable row level security;
alter table public.quadro_daily_conferences  enable row level security;
alter table public.quadro_daily_items        enable row level security;
alter table public.quadro_daily_item_reasons enable row level security;
alter table public.quadro_audit_logs         enable row level security;

-- ===========================================================================
-- Cadastros (somente leitura pela API; manutenção é administrativa/SQL)
-- ===========================================================================
drop policy if exists quadro_stores_select on public.quadro_stores;
create policy quadro_stores_select on public.quadro_stores
  for select to authenticated
  using (public.quadro_can_access_store(id));

-- Gerente enxerga as funções vinculadas ao quadro da SUA loja.
-- Supervisor/admin enxergam as funções de qualquer loja acessível.
drop policy if exists quadro_positions_select on public.quadro_positions;
create policy quadro_positions_select on public.quadro_positions
  for select to authenticated
  using (
    exists (
      select 1
        from public.quadro_store_staffing ss
       where ss.position_id = quadro_positions.id
         and ss.effective_to is null
         and public.quadro_can_access_store(ss.store_id)
    )
  );

drop policy if exists quadro_store_staffing_select on public.quadro_store_staffing;
create policy quadro_store_staffing_select on public.quadro_store_staffing
  for select to authenticated
  using (public.quadro_can_access_store(store_id));

-- Tabela de referência: qualquer usuário COM PERFIL ATIVO lê.
-- (Não é `true`: usuário autenticado sem perfil ativo não lê nada.)
drop policy if exists quadro_absence_reasons_select on public.quadro_absence_reasons;
create policy quadro_absence_reasons_select on public.quadro_absence_reasons
  for select to authenticated
  using (public.quadro_current_profile_role() is not null);

-- ===========================================================================
-- Perfis
-- ===========================================================================
drop policy if exists quadro_profiles_select on public.quadro_profiles;
create policy quadro_profiles_select on public.quadro_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.quadro_current_profile_role() in ('SUPERVISOR', 'ADMIN')
  );

-- A pessoa pode corrigir o próprio nome. role/store_id/active são bloqueados
-- pelo gatilho quadro_guard_profile_privileges (WITH CHECK não enxerga a linha antiga).
drop policy if exists quadro_profiles_update_self on public.quadro_profiles;
create policy quadro_profiles_update_self on public.quadro_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ADMIN administra perfis (o gatilho libera role/store_id só para ADMIN).
drop policy if exists quadro_profiles_update_admin on public.quadro_profiles;
create policy quadro_profiles_update_admin on public.quadro_profiles
  for update to authenticated
  using (public.quadro_current_profile_role() = 'ADMIN')
  with check (public.quadro_current_profile_role() = 'ADMIN');

drop policy if exists quadro_profiles_insert_admin on public.quadro_profiles;
create policy quadro_profiles_insert_admin on public.quadro_profiles
  for insert to authenticated
  with check (public.quadro_current_profile_role() = 'ADMIN');

-- Sem política de DELETE: perfil não se apaga pela API.

-- ===========================================================================
-- Conferências
-- ===========================================================================
drop policy if exists quadro_daily_conferences_select on public.quadro_daily_conferences;
create policy quadro_daily_conferences_select on public.quadro_daily_conferences
  for select to authenticated
  using (public.quadro_can_access_store(store_id));

-- Criação: só o gerente da loja, sempre como DRAFT e sempre em seu próprio nome.
drop policy if exists quadro_daily_conferences_insert on public.quadro_daily_conferences;
create policy quadro_daily_conferences_insert on public.quadro_daily_conferences
  for insert to authenticated
  with check (
    public.quadro_can_write_store(store_id)
    and created_by = auth.uid()
    and status = 'DRAFT'
  );

-- Edição: só o gerente da loja e só enquanto não estiver enviada.
-- O WITH CHECK não restringe status porque a RPC de envio precisa gravar
-- SUBMITTED; quem governa a transição é o gatilho quadro_guard_conference_transition.
drop policy if exists quadro_daily_conferences_update on public.quadro_daily_conferences;
create policy quadro_daily_conferences_update on public.quadro_daily_conferences
  for update to authenticated
  using (
    public.quadro_can_write_store(store_id)
    and status in ('DRAFT', 'REOPENED')
  )
  with check (public.quadro_can_write_store(store_id));

-- Sem política de DELETE: conferência não se apaga pela API.

-- ===========================================================================
-- Itens da conferência
-- ===========================================================================
drop policy if exists quadro_daily_items_select on public.quadro_daily_items;
create policy quadro_daily_items_select on public.quadro_daily_items
  for select to authenticated
  using (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_access_store(dc.store_id)
    )
  );

drop policy if exists quadro_daily_items_insert on public.quadro_daily_items;
create policy quadro_daily_items_insert on public.quadro_daily_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  );

drop policy if exists quadro_daily_items_update on public.quadro_daily_items;
create policy quadro_daily_items_update on public.quadro_daily_items
  for update to authenticated
  using (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  )
  with check (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_write_store(dc.store_id)
    )
  );

-- A RPC de rascunho apaga funções que saíram do payload.
drop policy if exists quadro_daily_items_delete on public.quadro_daily_items;
create policy quadro_daily_items_delete on public.quadro_daily_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  );

-- ===========================================================================
-- Motivos dos itens (dois níveis acima até a conferência)
-- ===========================================================================
drop policy if exists quadro_daily_item_reasons_select on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_select on public.quadro_daily_item_reasons
  for select to authenticated
  using (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_access_store(dc.store_id)
    )
  );

drop policy if exists quadro_daily_item_reasons_insert on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_insert on public.quadro_daily_item_reasons
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  );

drop policy if exists quadro_daily_item_reasons_update on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_update on public.quadro_daily_item_reasons
  for update to authenticated
  using (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  )
  with check (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
    )
  );

drop policy if exists quadro_daily_item_reasons_delete on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_delete on public.quadro_daily_item_reasons
  for delete to authenticated
  using (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  );

-- ===========================================================================
-- Auditoria
-- ===========================================================================
-- Só é possível gravar log EM SEU PRÓPRIO NOME. Ninguém consegue dizer
-- "eu sou outro usuário".
drop policy if exists quadro_audit_logs_insert on public.quadro_audit_logs;
create policy quadro_audit_logs_insert on public.quadro_audit_logs
  for insert to authenticated
  with check (user_id = auth.uid());

-- Gerente não precisa da auditoria global; supervisor/admin consultam.
drop policy if exists quadro_audit_logs_select on public.quadro_audit_logs;
create policy quadro_audit_logs_select on public.quadro_audit_logs
  for select to authenticated
  using (public.quadro_current_profile_role() in ('SUPERVISOR', 'ADMIN'));

-- Sem UPDATE/DELETE: append-only (reforçado pelo gatilho de 0005).

-- ===========================================================================
-- Privilégios de tabela (RLS filtra LINHAS; o grant decide a OPERAÇÃO)
-- ===========================================================================
-- COEXISTÊNCIA: as revogações abaixo citam UMA A UMA as tabelas deste
-- sistema. Um `revoke all on all tables in schema public from anon` tiraria
-- também os privilégios das tabelas de OUTROS sistemas que compartilham o
-- schema public — por isso não é usado aqui.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.quadro_stores, public.quadro_positions,
             public.quadro_store_staffing, public.quadro_absence_reasons,
             public.quadro_profiles, public.quadro_daily_conferences,
             public.quadro_daily_items, public.quadro_daily_item_reasons,
             public.quadro_audit_logs from anon';
    execute 'revoke all on public.quadro_v_conference_items,
             public.quadro_v_conference_item_reasons from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- COEXISTÊNCIA: nada de `grant/revoke ... on schema public`. O privilégio
    -- de USAGE no schema é do dono do banco e já está concedido no Supabase;
    -- mexer nele afetaria todos os sistemas que compartilham o schema.
    execute 'grant select on public.quadro_stores, public.quadro_positions, public.quadro_store_staffing,
             public.quadro_absence_reasons, public.quadro_profiles, public.quadro_daily_conferences,
             public.quadro_daily_items, public.quadro_daily_item_reasons, public.quadro_audit_logs
             to authenticated';

    -- Escrita só onde a RPC precisa. Ninguém apaga conferência nem cadastro.
    execute 'grant insert, update on public.quadro_daily_conferences to authenticated';
    execute 'grant insert, update, delete on public.quadro_daily_items to authenticated';
    execute 'grant insert, update, delete on public.quadro_daily_item_reasons to authenticated';
    execute 'grant insert on public.quadro_audit_logs to authenticated';
    execute 'grant insert, update on public.quadro_profiles to authenticated';
  end if;
end
$$;
