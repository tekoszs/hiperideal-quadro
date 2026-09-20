import { describe, expect, it } from 'vitest';
import { POSITIONS, STORES, STORE_STAFFING } from '@/data/catalog';
import { buildPositionGroups } from '@/services/catalogService';

// TESTE 8 — funções com mesmo grupo mas setores diferentes continuam separadas.
describe('Catálogo importado da planilha', () => {
  it('carregou exatamente 1 loja e 25 funções', () => {
    expect(STORES).toHaveLength(1);
    expect(STORES[0]).toMatchObject({ code: '124', name: 'PARQUE SHOPPING' });
    expect(POSITIONS).toHaveLength(25);
  });

  it('mantém ATENDENTE ALIMENTOS separado por setor', () => {
    const atendentes = POSITIONS.filter((p) => p.functionGroup === 'ATENDENTE ALIMENTOS');
    expect(atendentes).toHaveLength(3);
    expect(atendentes.map((p) => p.sector).sort()).toEqual(['FATIADOS', 'FRUTAS', 'PADARIA']);
    // Cada setor é um registro próprio, com id próprio.
    expect(new Set(atendentes.map((p) => p.id)).size).toBe(3);
  });

  it('mantém REPOSITOR separado por setor', () => {
    const repositores = POSITIONS.filter((p) => p.functionGroup === 'REPOSITOR');
    expect(repositores).toHaveLength(4);
    expect(repositores.map((p) => p.sector).sort()).toEqual([
      'BAZAR',
      'FRIOS',
      'HORTI',
      'MERCEARIA',
    ]);
    expect(new Set(repositores.map((p) => p.name)).size).toBe(4);
  });

  it('mantém AUX. DE COZINHA separado por setor', () => {
    const auxiliares = POSITIONS.filter((p) => p.functionGroup === 'AUX. DE COZINHA');
    expect(auxiliares).toHaveLength(2);
    expect(auxiliares.map((p) => p.sector).sort()).toEqual(['GALETERIA', 'REFEITÓRIO']);
  });

  it('deriva grupo e setor a partir do nome da planilha', () => {
    const horti = POSITIONS.find((p) => p.name === 'REPOSITOR - HORTI');
    expect(horti).toMatchObject({ functionGroup: 'REPOSITOR', sector: 'HORTI' });

    const padaria = POSITIONS.find((p) => p.name === 'ATENDENTE ALIMENTOS - PADARIA');
    expect(padaria).toMatchObject({
      functionGroup: 'ATENDENTE ALIMENTOS',
      sector: 'PADARIA',
    });
  });

  it('função sem setor fica com sector null e grupo igual ao nome', () => {
    const operador = POSITIONS.find((p) => p.name === 'OPERADOR DE CAIXA');
    expect(operador).toMatchObject({ functionGroup: 'OPERADOR DE CAIXA', sector: null });
  });

  it('não inventa quantidade de quadro (planilha vazia na coluna QUANTIDADE)', () => {
    expect(STORE_STAFFING).toHaveLength(25);
    expect(STORE_STAFFING.every((s) => s.authorizedQuantity === null)).toBe(true);
  });

  it('não existe nome de função duplicado', () => {
    expect(new Set(POSITIONS.map((p) => p.name)).size).toBe(POSITIONS.length);
  });

  it('nenhuma linha de cabeçalho ou subtotal virou função', () => {
    const proibidos = ['SETOR', 'LOJA', 'TOTAL', 'SUBTOTAL', 'QUANTIDADE'];
    expect(POSITIONS.some((p) => proibidos.includes(p.name.toUpperCase()))).toBe(false);
  });

  it('agrupa visualmente só quem tem mais de uma função no grupo', () => {
    const groups = buildPositionGroups(POSITIONS);
    const comCabecalho = groups.filter((g) => g.groupLabel !== null);

    expect(comCabecalho.map((g) => g.groupLabel).sort()).toEqual([
      'ATENDENTE ALIMENTOS',
      'AUX. DE COZINHA',
      'REPOSITOR',
    ]);

    // Nenhuma função some no agrupamento.
    expect(groups.flatMap((g) => g.positions)).toHaveLength(25);
  });
});
