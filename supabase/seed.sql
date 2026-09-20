-- ARQUIVO GERADO AUTOMATICAMENTE — não editar à mão.
-- Origem: docs/Quadrodia.xlsx
-- Regerar: python3 scripts/import_quadro.py docs/Quadrodia.xlsx

begin;

-- Lojas -------------------------------------------------------------
insert into public.quadro_stores (id, code, name, active) values
  ('store-124', '124', 'PARQUE SHOPPING', true)
-- FASE 4: quem manda no nome e no distrito da loja e a rede oficial
-- (migration 0016_seed_network.sql), nao a planilha. Aqui o insert so garante
-- que a loja EXISTA, para o quadro autorizado ter chave estrangeira valida.
-- `do nothing` evita que este seed desfaca o nome operacional da rede -- foi
-- exatamente o que aconteceu no primeiro teste: a 124 voltava a "PARQUE
-- SHOPPING" depois de a migration ja ter gravado "PQSHOP".
on conflict (id) do nothing;

-- Funções -----------------------------------------------------------
insert into public.quadro_positions (id, name, function_group, sector, active, display_order) values
  ('pos-acougueiro', 'ACOUGUEIRO', 'ACOUGUEIRO', NULL, true, 1),
  ('pos-atendente-alimentos-padaria', 'ATENDENTE ALIMENTOS - PADARIA', 'ATENDENTE ALIMENTOS', 'PADARIA', true, 2),
  ('pos-atendente-alimentos-fatiados', 'ATENDENTE ALIMENTOS - FATIADOS', 'ATENDENTE ALIMENTOS', 'FATIADOS', true, 3),
  ('pos-atendente-alimentos-frutas', 'ATENDENTE ALIMENTOS - FRUTAS', 'ATENDENTE ALIMENTOS', 'FRUTAS', true, 4),
  ('pos-aux-de-validade', 'AUX DE VALIDADE', 'AUX DE VALIDADE', NULL, true, 5),
  ('pos-aux-de-cozinha-refeitorio', 'AUX. DE COZINHA - REFEITÓRIO', 'AUX. DE COZINHA', 'REFEITÓRIO', true, 6),
  ('pos-aux-de-cozinha-galeteria', 'AUX. DE COZINHA - GALETERIA', 'AUX. DE COZINHA', 'GALETERIA', true, 7),
  ('pos-aux-de-pessoal', 'AUX. DE PESSOAL', 'AUX. DE PESSOAL', NULL, true, 8),
  ('pos-aux-servico-gerais', 'AUX. SERVICO GERAIS', 'AUX. SERVICO GERAIS', NULL, true, 9),
  ('pos-caixa-geral', 'CAIXA GERAL', 'CAIXA GERAL', NULL, true, 10),
  ('pos-conferente', 'CONFERENTE', 'CONFERENTE', NULL, true, 11),
  ('pos-cozinheiro', 'COZINHEIRO', 'COZINHEIRO', NULL, true, 12),
  ('pos-empacotador', 'EMPACOTADOR', 'EMPACOTADOR', NULL, true, 13),
  ('pos-encarregado', 'ENCARREGADO', 'ENCARREGADO', NULL, true, 14),
  ('pos-fiscal-de-patrimonio', 'FISCAL DE PATRIMONIO', 'FISCAL DE PATRIMONIO', NULL, true, 15),
  ('pos-gerente-de-loja', 'GERENTE DE LOJA', 'GERENTE DE LOJA', NULL, true, 16),
  ('pos-lider-de-atendimento', 'LIDER DE ATENDIMENTO', 'LIDER DE ATENDIMENTO', NULL, true, 17),
  ('pos-operador-de-caixa', 'OPERADOR DE CAIXA', 'OPERADOR DE CAIXA', NULL, true, 18),
  ('pos-operador-de-suporte', 'OPERADOR DE SUPORTE', 'OPERADOR DE SUPORTE', NULL, true, 19),
  ('pos-padeiro', 'PADEIRO', 'PADEIRO', NULL, true, 20),
  ('pos-promotor-vendas-especializado', 'PROMOTOR VENDAS ESPECIALIZADO', 'PROMOTOR VENDAS ESPECIALIZADO', NULL, true, 21),
  ('pos-repositor-horti', 'REPOSITOR - HORTI', 'REPOSITOR', 'HORTI', true, 22),
  ('pos-repositor-mercearia', 'REPOSITOR - MERCEARIA', 'REPOSITOR', 'MERCEARIA', true, 23),
  ('pos-repositor-frios', 'REPOSITOR - FRIOS', 'REPOSITOR', 'FRIOS', true, 24),
  ('pos-repositor-bazar', 'REPOSITOR - BAZAR', 'REPOSITOR', 'BAZAR', true, 25)
on conflict (id) do update set name = excluded.name, function_group = excluded.function_group, sector = excluded.sector, display_order = excluded.display_order;

-- Quadro por loja (authorized_quantity NULL = não informado na planilha) --
insert into public.quadro_store_staffing (id, store_id, position_id, authorized_quantity, effective_from) values
  ('staff-124-acougueiro', 'store-124', 'pos-acougueiro', NULL, date '2026-01-01'),
  ('staff-124-atendente-alimentos-padaria', 'store-124', 'pos-atendente-alimentos-padaria', NULL, date '2026-01-01'),
  ('staff-124-atendente-alimentos-fatiados', 'store-124', 'pos-atendente-alimentos-fatiados', NULL, date '2026-01-01'),
  ('staff-124-atendente-alimentos-frutas', 'store-124', 'pos-atendente-alimentos-frutas', NULL, date '2026-01-01'),
  ('staff-124-aux-de-validade', 'store-124', 'pos-aux-de-validade', NULL, date '2026-01-01'),
  ('staff-124-aux-de-cozinha-refeitorio', 'store-124', 'pos-aux-de-cozinha-refeitorio', NULL, date '2026-01-01'),
  ('staff-124-aux-de-cozinha-galeteria', 'store-124', 'pos-aux-de-cozinha-galeteria', NULL, date '2026-01-01'),
  ('staff-124-aux-de-pessoal', 'store-124', 'pos-aux-de-pessoal', NULL, date '2026-01-01'),
  ('staff-124-aux-servico-gerais', 'store-124', 'pos-aux-servico-gerais', NULL, date '2026-01-01'),
  ('staff-124-caixa-geral', 'store-124', 'pos-caixa-geral', NULL, date '2026-01-01'),
  ('staff-124-conferente', 'store-124', 'pos-conferente', NULL, date '2026-01-01'),
  ('staff-124-cozinheiro', 'store-124', 'pos-cozinheiro', NULL, date '2026-01-01'),
  ('staff-124-empacotador', 'store-124', 'pos-empacotador', NULL, date '2026-01-01'),
  ('staff-124-encarregado', 'store-124', 'pos-encarregado', NULL, date '2026-01-01'),
  ('staff-124-fiscal-de-patrimonio', 'store-124', 'pos-fiscal-de-patrimonio', NULL, date '2026-01-01'),
  ('staff-124-gerente-de-loja', 'store-124', 'pos-gerente-de-loja', NULL, date '2026-01-01'),
  ('staff-124-lider-de-atendimento', 'store-124', 'pos-lider-de-atendimento', NULL, date '2026-01-01'),
  ('staff-124-operador-de-caixa', 'store-124', 'pos-operador-de-caixa', NULL, date '2026-01-01'),
  ('staff-124-operador-de-suporte', 'store-124', 'pos-operador-de-suporte', NULL, date '2026-01-01'),
  ('staff-124-padeiro', 'store-124', 'pos-padeiro', NULL, date '2026-01-01'),
  ('staff-124-promotor-vendas-especializado', 'store-124', 'pos-promotor-vendas-especializado', NULL, date '2026-01-01'),
  ('staff-124-repositor-horti', 'store-124', 'pos-repositor-horti', NULL, date '2026-01-01'),
  ('staff-124-repositor-mercearia', 'store-124', 'pos-repositor-mercearia', NULL, date '2026-01-01'),
  ('staff-124-repositor-frios', 'store-124', 'pos-repositor-frios', NULL, date '2026-01-01'),
  ('staff-124-repositor-bazar', 'store-124', 'pos-repositor-bazar', NULL, date '2026-01-01')
on conflict (id) do update set authorized_quantity = excluded.authorized_quantity;

commit;
