-- ============================================================================
-- TESTE DE ISOLAMENTO ENTRE LOJAS — Supabase real
--
-- Cole no SQL Editor do Supabase e execute UMA VEZ.
--
-- IMPORTANTE: tudo roda dentro de BEGIN ... ROLLBACK.
-- A loja de teste e o usuário de teste NUNCA são gravados de verdade.
-- Nada é adicionado ao catálogo oficial.
--
-- Pré-requisito: install.sql já aplicado e o gerente real já cadastrado
-- em `quadro_profiles` (rode seed_profiles.example.sql antes).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Cenário temporário: uma segunda loja e um segundo gerente.
-- ---------------------------------------------------------------------------
insert into public.quadro_stores (id, code, name, active)
values ('store-teste-isolamento', 'ZZZ', 'LOJA TEMPORARIA DE TESTE', true);

insert into public.quadro_store_staffing (id, store_id, position_id, authorized_quantity, effective_from)
select 'staff-teste-' || p.id, 'store-teste-isolamento', p.id, null, current_date
  from public.quadro_positions p;

insert into auth.users (id, email)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'gerente.temporario@teste.local');

insert into public.quadro_profiles (id, name, role, store_id, active)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Gerente Temporario', 'MANAGER',
        'store-teste-isolamento', true);

-- Um rascunho na loja temporária, criado pelo gerente temporário.
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', false);
set local role authenticated;

select public.quadro_rpc_save_daily_conference_draft(
  'store-teste-isolamento',
  current_date - 1,
  '[{"position_id":"pos-operador-de-caixa","absence_quantity":0,"day_off_quantity":2,"reasons":[]}]'::jsonb
) as conferencia_da_loja_temporaria;

reset role;

-- ---------------------------------------------------------------------------
-- Agora, como o GERENTE REAL da loja 124.
-- Troque o UUID abaixo pelo id do seu gerente (veja a consulta no fim).
-- ---------------------------------------------------------------------------
-- O gerente real é localizado pelo perfil (role MANAGER na loja 124).
-- Se houver mais de um, o primeiro é usado — o teste vale igual.
do $$
begin
  if not exists (select 1 from public.quadro_profiles
                  where role = 'MANAGER' and store_id = 'store-124' and active) then
    raise exception 'Nenhum gerente ativo na loja 124. Rode seed_profiles.example.sql antes.';
  end if;
end
$$;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.quadro_profiles where role = 'MANAGER' and store_id = 'store-124' limit 1),
  false
);
set local role authenticated;

-- 1. Lojas visíveis: deve aparecer SOMENTE a 124.
select 'lojas visiveis para o gerente 124' as verificacao,
       coalesce(string_agg(code || ' - ' || name, ', '), '(nenhuma)') as resultado,
       case when count(*) = 1 and bool_and(id = 'store-124') then 'OK' else 'FALHA' end as res
  from public.quadro_stores;

-- 2. Conferências visíveis da loja temporária: deve ser ZERO.
select 'conferencias da loja temporaria visiveis' as verificacao,
       count(*)::text as resultado,
       case when count(*) = 0 then 'OK' else 'FALHA' end as res
  from public.quadro_daily_conferences
 where store_id = 'store-teste-isolamento';

-- 3. Itens da loja temporária: deve ser ZERO.
select 'itens da loja temporaria visiveis' as verificacao,
       count(*)::text as resultado,
       case when count(*) = 0 then 'OK' else 'FALHA' end as res
  from public.quadro_daily_items di
  join public.quadro_daily_conferences dc on dc.id = di.conference_id
 where dc.store_id = 'store-teste-isolamento';

-- 4. Views também isolam.
select 'views isolam a loja temporaria' as verificacao,
       count(*)::text as resultado,
       case when count(*) = 0 then 'OK' else 'FALHA' end as res
  from public.quadro_v_conference_items
 where store_id = 'store-teste-isolamento';

-- 5. Escrever na loja do outro deve FALHAR.
do $$
begin
  perform public.quadro_rpc_save_daily_conference_draft(
    'store-teste-isolamento',
    current_date - 1,
    '[{"position_id":"pos-padeiro","absence_quantity":0,"day_off_quantity":1,"reasons":[]}]'::jsonb
  );
  raise notice 'FALHA: gerente da 124 conseguiu escrever na loja temporaria!';
exception when others then
  raise notice 'OK: escrita na loja de outro recusada -> %', sqlerrm;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- DESFAZ TUDO. Nada acima é persistido.
-- ---------------------------------------------------------------------------
rollback;

-- Confirmação: a loja temporária não existe mais.
select 'apos rollback, lojas cadastradas' as verificacao,
       string_agg(code || ' - ' || name, ', ') as resultado
  from public.quadro_stores;
