/**
 * ARQUIVO GERADO AUTOMATICAMENTE — não editar à mão.
 * Origem: docs/Quadrodia.xlsx
 * Regerar: python3 scripts/import_quadro.py docs/Quadrodia.xlsx
 *
 * Nenhuma função foi agrupada ou inventada: cada linha da planilha
 * corresponde a exatamente uma função (Position).
 */
import type { Position, Store, StoreStaffing } from '@/types/domain';

export const CATALOG_SOURCE_FILE = 'docs/Quadrodia.xlsx';

export const STORES: Store[] = [
  { id: 'store-124', code: '124', name: 'PARQUE SHOPPING', active: true },
];

export const POSITIONS: Position[] = [
  { id: 'pos-acougueiro', name: 'ACOUGUEIRO', functionGroup: 'ACOUGUEIRO', sector: null, active: true, displayOrder: 1 },
  { id: 'pos-atendente-alimentos-padaria', name: 'ATENDENTE ALIMENTOS - PADARIA', functionGroup: 'ATENDENTE ALIMENTOS', sector: 'PADARIA', active: true, displayOrder: 2 },
  { id: 'pos-atendente-alimentos-fatiados', name: 'ATENDENTE ALIMENTOS - FATIADOS', functionGroup: 'ATENDENTE ALIMENTOS', sector: 'FATIADOS', active: true, displayOrder: 3 },
  { id: 'pos-atendente-alimentos-frutas', name: 'ATENDENTE ALIMENTOS - FRUTAS', functionGroup: 'ATENDENTE ALIMENTOS', sector: 'FRUTAS', active: true, displayOrder: 4 },
  { id: 'pos-aux-de-validade', name: 'AUX DE VALIDADE', functionGroup: 'AUX DE VALIDADE', sector: null, active: true, displayOrder: 5 },
  { id: 'pos-aux-de-cozinha-refeitorio', name: 'AUX. DE COZINHA - REFEITÓRIO', functionGroup: 'AUX. DE COZINHA', sector: 'REFEITÓRIO', active: true, displayOrder: 6 },
  { id: 'pos-aux-de-cozinha-galeteria', name: 'AUX. DE COZINHA - GALETERIA', functionGroup: 'AUX. DE COZINHA', sector: 'GALETERIA', active: true, displayOrder: 7 },
  { id: 'pos-aux-de-pessoal', name: 'AUX. DE PESSOAL', functionGroup: 'AUX. DE PESSOAL', sector: null, active: true, displayOrder: 8 },
  { id: 'pos-aux-servico-gerais', name: 'AUX. SERVICO GERAIS', functionGroup: 'AUX. SERVICO GERAIS', sector: null, active: true, displayOrder: 9 },
  { id: 'pos-caixa-geral', name: 'CAIXA GERAL', functionGroup: 'CAIXA GERAL', sector: null, active: true, displayOrder: 10 },
  { id: 'pos-conferente', name: 'CONFERENTE', functionGroup: 'CONFERENTE', sector: null, active: true, displayOrder: 11 },
  { id: 'pos-cozinheiro', name: 'COZINHEIRO', functionGroup: 'COZINHEIRO', sector: null, active: true, displayOrder: 12 },
  { id: 'pos-empacotador', name: 'EMPACOTADOR', functionGroup: 'EMPACOTADOR', sector: null, active: true, displayOrder: 13 },
  { id: 'pos-encarregado', name: 'ENCARREGADO', functionGroup: 'ENCARREGADO', sector: null, active: true, displayOrder: 14 },
  { id: 'pos-fiscal-de-patrimonio', name: 'FISCAL DE PATRIMONIO', functionGroup: 'FISCAL DE PATRIMONIO', sector: null, active: true, displayOrder: 15 },
  { id: 'pos-gerente-de-loja', name: 'GERENTE DE LOJA', functionGroup: 'GERENTE DE LOJA', sector: null, active: true, displayOrder: 16 },
  { id: 'pos-lider-de-atendimento', name: 'LIDER DE ATENDIMENTO', functionGroup: 'LIDER DE ATENDIMENTO', sector: null, active: true, displayOrder: 17 },
  { id: 'pos-operador-de-caixa', name: 'OPERADOR DE CAIXA', functionGroup: 'OPERADOR DE CAIXA', sector: null, active: true, displayOrder: 18 },
  { id: 'pos-operador-de-suporte', name: 'OPERADOR DE SUPORTE', functionGroup: 'OPERADOR DE SUPORTE', sector: null, active: true, displayOrder: 19 },
  { id: 'pos-padeiro', name: 'PADEIRO', functionGroup: 'PADEIRO', sector: null, active: true, displayOrder: 20 },
  { id: 'pos-promotor-vendas-especializado', name: 'PROMOTOR VENDAS ESPECIALIZADO', functionGroup: 'PROMOTOR VENDAS ESPECIALIZADO', sector: null, active: true, displayOrder: 21 },
  { id: 'pos-repositor-horti', name: 'REPOSITOR - HORTI', functionGroup: 'REPOSITOR', sector: 'HORTI', active: true, displayOrder: 22 },
  { id: 'pos-repositor-mercearia', name: 'REPOSITOR - MERCEARIA', functionGroup: 'REPOSITOR', sector: 'MERCEARIA', active: true, displayOrder: 23 },
  { id: 'pos-repositor-frios', name: 'REPOSITOR - FRIOS', functionGroup: 'REPOSITOR', sector: 'FRIOS', active: true, displayOrder: 24 },
  { id: 'pos-repositor-bazar', name: 'REPOSITOR - BAZAR', functionGroup: 'REPOSITOR', sector: 'BAZAR', active: true, displayOrder: 25 },
];

export const STORE_STAFFING: StoreStaffing[] = [
  { id: 'staff-124-acougueiro', storeId: 'store-124', positionId: 'pos-acougueiro', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-atendente-alimentos-padaria', storeId: 'store-124', positionId: 'pos-atendente-alimentos-padaria', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-atendente-alimentos-fatiados', storeId: 'store-124', positionId: 'pos-atendente-alimentos-fatiados', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-atendente-alimentos-frutas', storeId: 'store-124', positionId: 'pos-atendente-alimentos-frutas', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-aux-de-validade', storeId: 'store-124', positionId: 'pos-aux-de-validade', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-aux-de-cozinha-refeitorio', storeId: 'store-124', positionId: 'pos-aux-de-cozinha-refeitorio', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-aux-de-cozinha-galeteria', storeId: 'store-124', positionId: 'pos-aux-de-cozinha-galeteria', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-aux-de-pessoal', storeId: 'store-124', positionId: 'pos-aux-de-pessoal', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-aux-servico-gerais', storeId: 'store-124', positionId: 'pos-aux-servico-gerais', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-caixa-geral', storeId: 'store-124', positionId: 'pos-caixa-geral', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-conferente', storeId: 'store-124', positionId: 'pos-conferente', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-cozinheiro', storeId: 'store-124', positionId: 'pos-cozinheiro', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-empacotador', storeId: 'store-124', positionId: 'pos-empacotador', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-encarregado', storeId: 'store-124', positionId: 'pos-encarregado', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-fiscal-de-patrimonio', storeId: 'store-124', positionId: 'pos-fiscal-de-patrimonio', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-gerente-de-loja', storeId: 'store-124', positionId: 'pos-gerente-de-loja', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-lider-de-atendimento', storeId: 'store-124', positionId: 'pos-lider-de-atendimento', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-operador-de-caixa', storeId: 'store-124', positionId: 'pos-operador-de-caixa', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-operador-de-suporte', storeId: 'store-124', positionId: 'pos-operador-de-suporte', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-padeiro', storeId: 'store-124', positionId: 'pos-padeiro', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-promotor-vendas-especializado', storeId: 'store-124', positionId: 'pos-promotor-vendas-especializado', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-repositor-horti', storeId: 'store-124', positionId: 'pos-repositor-horti', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-repositor-mercearia', storeId: 'store-124', positionId: 'pos-repositor-mercearia', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-repositor-frios', storeId: 'store-124', positionId: 'pos-repositor-frios', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
  { id: 'staff-124-repositor-bazar', storeId: 'store-124', positionId: 'pos-repositor-bazar', authorizedQuantity: null, effectiveFrom: '2026-01-01', effectiveTo: null },
];
