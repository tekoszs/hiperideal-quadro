// @vitest-environment jsdom
/**
 * FASE 4 — O ESCOPO NA TELA.
 *
 * O que estes testes provam:
 *
 *   1. o filtro de distrito RECORTA o que já chegou — nunca amplia. O teste
 *      mais importante do arquivo é o 9: o gerente distrital recebe do "banco"
 *      só as lojas dele, e nem o estado da tela nem o filtro fazem aparecer
 *      uma loja a mais;
 *   2. nenhuma contagem é fixa. "34", "20" e "14" não estão escritos em lugar
 *      nenhum da tela: saem das lojas que voltaram da consulta. O teste 11 usa
 *      uma rede de 5 lojas em 2 distritos e confere que a tela mostra 5, 3 e 2;
 *   3. quem enxerga um distrito só não recebe um seletor de uma opção.
 *
 * A rede de teste é pequena de propósito: 5 lojas legíveis provam a regra
 * melhor que 34 nomes reais copiados.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DailyConference } from '@/types/domain';
import type { NetworkRangeData } from '@/types/analytics';
import type { NetworkStoreRef } from '@/types/network';
import type { SessionProfile } from '@/types/auth';
import type { StorageAdapter } from '@/services/storage';
import { setStorageAdapter } from '@/services/storage';
import { buildDistrictOptions, buildNetworkAnalytics, selectStores } from '@/domain/analytics';
import { resolvePeriod } from '@/domain/period';
import { SupervisorNetworkDashboardPage } from '@/pages/SupervisorNetworkDashboardPage';
import { getReferenceDate, shiftIsoDate } from '@/utils/date';

const D1 = getReferenceDate();
const D2 = shiftIsoDate(D1, -1);

/* -------------------------------------------------------------------------
 * Rede de teste: 3 lojas no distrito 1, 2 no distrito 2.
 * ---------------------------------------------------------------------- */

const TODAS: NetworkStoreRef[] = [
  { id: 'store-101', code: '101', name: 'ALFA', districtId: 'district-1' },
  { id: 'store-102', code: '102', name: 'BRAVO', districtId: 'district-1' },
  { id: 'store-103', code: '103', name: 'CHARLIE', districtId: 'district-1' },
  { id: 'store-201', code: '201', name: 'DELTA', districtId: 'district-2' },
  { id: 'store-202', code: '202', name: 'ECO', districtId: 'district-2' },
];

const DO_DISTRITO_1 = TODAS.filter((store) => store.districtId === 'district-1');

/** Perfil de gerência com o escopo que o teste precisa. */
function perfil(over: Partial<SessionProfile> = {}): SessionProfile {
  return {
    id: 'user-teste',
    name: 'Perfil de Teste',
    role: 'SUPERVISOR',
    storeId: null,
    active: true,
    email: 'teste@hiperideal.com.br',
    accessScope: 'ALL',
    districtId: null,
    jobTitle: null,
    ...over,
  };
}

/**
 * Período com dados. Cada loja com falta tem a MESMA quantidade, para as somas
 * por distrito serem óbvias de conferir na mão:
 *
 *   ALFA 2 · BRAVO 3   -> distrito 1 = 5
 *   DELTA 4            -> distrito 2 = 4
 */
function makeRange(stores: NetworkStoreRef[]): NetworkRangeData {
  const acessiveis = new Set(stores.map((store) => store.id));
  const lancamentos: Array<[string, string, number]> = [
    ['c-alfa', 'store-101', 2],
    ['c-bravo', 'store-102', 3],
    ['c-delta', 'store-201', 4],
  ].filter(([, storeId]) => acessiveis.has(storeId as string)) as Array<[string, string, number]>;

  return {
    stores,
    conferences: lancamentos.map(([id, storeId]) => ({
      id,
      storeId,
      referenceDate: D2,
      status: 'SUBMITTED' as const,
      submittedAt: 'x',
    })),
    items: lancamentos.map(([id, storeId, faltas]) => ({
      conferenceId: id,
      storeId,
      storeName: stores.find((store) => store.id === storeId)!.name,
      referenceDate: D2,
      positionId: 'pos-operador-de-caixa',
      positionName: 'OPERADOR DE CAIXA',
      functionGroup: 'OPERADOR DE CAIXA',
      sector: null,
      absenceQuantity: faltas,
      dayOffQuantity: 0,
      observation: null,
    })),
    reasons: lancamentos.map(([id, storeId, faltas]) => ({
      conferenceId: id,
      storeId,
      referenceDate: D2,
      positionId: 'pos-operador-de-caixa',
      reasonId: 'reason-falta-injustificada',
      reasonName: 'Falta injustificada',
      reasonQuantity: faltas,
      observation: null,
    })),
  };
}

/** O que a RLS entregaria a este perfil — o adaptador finge ser o banco. */
let visiveis: NetworkStoreRef[] = TODAS;

function fakeAdapter(): StorageAdapter {
  return {
    name: 'Teste',
    getConference: async () => null,
    saveConference: async (c: DailyConference) => c,
    submitConference: async (c: DailyConference) => c,
    listConferences: async () => [],
    // Fase 4.5: o dublê não resolve justificativa — estas telas são de leitura.
    resolvePendingReason: async () => undefined,
    getNetworkDay: async () => ({ stores: [], conferences: [], items: [], reasons: [] }),
    getNetworkRange: async () => makeRange(visiveis),
  };
}

beforeEach(() => {
  visiveis = TODAS;
  setStorageAdapter(fakeAdapter());
});

afterEach(() => {
  cleanup();
  setStorageAdapter(null);
});

async function renderDashboard(profile: SessionProfile) {
  render(<SupervisorNetworkDashboardPage profile={profile} onOpenConferences={() => undefined} />);
  await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toBeTruthy());
  return userEvent.setup();
}

/** Valor de um card do topo pelo rótulo. */
function cardValue(label: string): string {
  const resumo = screen.getByLabelText('Resumo do período');
  return (
    within(resumo)
      .getByText(label)
      .closest('.summary-card')!
      .querySelector('.summary-card__value')!.textContent ?? ''
  );
}

const PERIODO = resolvePeriod('LAST_7');

/* ======================================================================= */

describe('Escopo no domínio', () => {
  // TESTE 1
  it('1. sem distrito escolhido, todas as lojas acessíveis contam', () => {
    const analise = buildNetworkAnalytics(makeRange(TODAS), PERIODO, {
      districtId: null,
      storeId: null,
      functionGroup: null,
    });

    expect(analise.storesConsidered).toBe(TODAS.length);
    expect(analise.headline.totalAbsences).toBe(9); // 2 + 3 + 4
  });

  // TESTE 2
  it('2. escolher um distrito soma só as lojas dele', () => {
    const d1 = buildNetworkAnalytics(makeRange(TODAS), PERIODO, {
      districtId: 'district-1',
      storeId: null,
      functionGroup: null,
    });
    const d2 = buildNetworkAnalytics(makeRange(TODAS), PERIODO, {
      districtId: 'district-2',
      storeId: null,
      functionGroup: null,
    });

    expect(d1.headline.totalAbsences).toBe(5); // ALFA 2 + BRAVO 3
    expect(d2.headline.totalAbsences).toBe(4); // DELTA 4
    // E os dois juntos fecham o total: nenhuma falta se perdeu no caminho.
    expect(d1.headline.totalAbsences + d2.headline.totalAbsences).toBe(9);
  });

  // TESTE 3 — a cobertura acompanha o recorte.
  it('3. o esperado do período usa as lojas do distrito, não da rede', () => {
    const d1 = buildNetworkAnalytics(makeRange(TODAS), PERIODO, {
      districtId: 'district-1',
      storeId: null,
      functionGroup: null,
    });

    expect(d1.storesConsidered).toBe(3);
    expect(d1.headline.coverage.expected).toBe(3 * PERIODO.days);
  });

  // TESTE 4
  it('4. o ranking de lojas só traz lojas do distrito escolhido', () => {
    const d2 = buildNetworkAnalytics(makeRange(TODAS), PERIODO, {
      districtId: 'district-2',
      storeId: null,
      functionGroup: null,
    });

    expect(d2.storeRanking.map((entry) => entry.label)).toEqual(['DELTA']);
  });

  // TESTE 5
  it('5. o seletor de loja mostra só as lojas do distrito escolhido', () => {
    const d1 = buildNetworkAnalytics(makeRange(TODAS), PERIODO, {
      districtId: 'district-1',
      storeId: null,
      functionGroup: null,
    });

    expect(d1.stores.map((store) => store.name)).toEqual(['ALFA', 'BRAVO', 'CHARLIE']);
  });

  // TESTE 6 — escolher uma loja não pode encolher o próprio seletor.
  it('6. com uma loja escolhida, o seletor continua listando o distrito inteiro', () => {
    const uma = buildNetworkAnalytics(makeRange(TODAS), PERIODO, {
      districtId: 'district-1',
      storeId: 'store-101',
      functionGroup: null,
    });

    expect(uma.stores).toHaveLength(3);
    expect(uma.storesConsidered).toBe(1);
    expect(uma.headline.totalAbsences).toBe(2);
  });

  // TESTE 7 — as opções saem dos dados, não de uma lista escrita.
  it('7. os distritos do seletor vêm das lojas acessíveis, com a contagem certa', () => {
    const opcoes = buildDistrictOptions(TODAS);

    expect(opcoes.map((item) => item.id)).toEqual(['district-1', 'district-2']);
    expect(opcoes.map((item) => item.storeCount)).toEqual([3, 2]);
    // O nome do responsável é informativo e vem do catálogo.
    expect(opcoes[0].managerName).toBe('Paulo Sergio');
  });

  // TESTE 8
  it('8. loja sem distrito conta em "todos" e sai quando um distrito é escolhido', () => {
    const comOrfa: NetworkStoreRef[] = [
      ...TODAS,
      { id: 'store-999', code: '999', name: 'SEM DISTRITO', districtId: null },
    ];

    expect(selectStores(comOrfa, { districtId: null, storeId: null, functionGroup: null }))
      .toHaveLength(6);
    expect(
      selectStores(comOrfa, { districtId: 'district-1', storeId: null, functionGroup: null }),
    ).toHaveLength(3);
    // E ela não desapareceu do seletor de distrito por acidente: não há
    // distrito inventado para ela.
    expect(buildDistrictOptions(comOrfa).map((item) => item.id)).toEqual([
      'district-1',
      'district-2',
    ]);
  });

  // TESTE 9 — O TESTE QUE IMPORTA.
  //
  // Paulo recebe do banco só as 3 lojas do distrito dele. Pedir o distrito 2
  // no filtro não faz nenhuma loja aparecer: o filtro recorta o que veio, e o
  // que veio já foi decidido pela RLS.
  it('9. pedir outro distrito não traz nenhuma loja a mais', () => {
    const soDoPaulo = makeRange(DO_DISTRITO_1);

    const tentativa = buildNetworkAnalytics(soDoPaulo, PERIODO, {
      districtId: 'district-2',
      storeId: null,
      functionGroup: null,
    });

    expect(tentativa.storesConsidered).toBe(0);
    expect(tentativa.storeRanking).toEqual([]);
    expect(tentativa.headline.totalAbsences).toBe(0);
    // Nem escolhendo uma loja pelo id: ela não está no conjunto entregue.
    const porId = buildNetworkAnalytics(soDoPaulo, PERIODO, {
      districtId: null,
      storeId: 'store-201',
      functionGroup: null,
    });
    expect(porId.storesConsidered).toBe(0);
    expect(porId.headline.totalAbsences).toBe(0);
  });
});

describe('Escopo na tela', () => {
  // TESTE 10
  it('10. o perfil de rede vê o seletor com os dois distritos e "Todos"', async () => {
    await renderDashboard(perfil());

    const seletor = screen.getByLabelText('Distrito') as HTMLSelectElement;
    const rotulos = [...seletor.options].map((option) => option.textContent);

    expect(rotulos[0]).toBe('Todos os distritos');
    expect(rotulos).toContain('Distrito 1 - Paulo Sergio');
    expect(rotulos).toContain('Distrito 2 - Ericson Silva');
    expect(screen.getByRole('heading', { name: 'Visão da Rede' })).toBeTruthy();
  });

  // TESTE 11 — nenhuma contagem escrita no código.
  it('11. as contagens da tela saem dos dados, não de um número fixo', async () => {
    const user = await renderDashboard(perfil());

    // 5 lojas na rede de teste — a tela não sabe nada de "34".
    expect(cardValue('Lojas com falta')).toBe('3');
    expect(screen.getByText('de 5 lojas')).toBeTruthy();
    expect((screen.getByLabelText('Loja') as HTMLSelectElement).options[0].textContent).toBe(
      'Todas as lojas (5)',
    );

    await user.selectOptions(screen.getByLabelText('Distrito'), 'district-1');

    expect(screen.getByText('de 3 lojas')).toBeTruthy();
    expect((screen.getByLabelText('Loja') as HTMLSelectElement).options[0].textContent).toBe(
      'Todas as lojas (3)',
    );
    expect(cardValue('Faltas')).toBe('5');
  });

  // TESTE 12
  it('12. o gerente distrital não recebe seletor de distrito — e nem precisa', async () => {
    // A RLS entregaria só as lojas dele.
    visiveis = DO_DISTRITO_1;

    await renderDashboard(
      perfil({ accessScope: 'DISTRICT', districtId: 'district-1', jobTitle: 'Gerente Distrital' }),
    );

    // Sem <select> de distrito: não há segundo distrito para escolher.
    expect(screen.queryByLabelText('Distrito')).toBeNull();
    // Mas a tela diz de qual distrito se trata — no lugar do seletor, e de
    // novo no subtítulo, para quem chega direto por link saber onde está.
    expect(screen.getAllByText(/Distrito 1/).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.analytics-filters__fixed')?.textContent).toContain(
      'Distrito 1',
    );
    expect(screen.getByRole('heading', { name: 'Visão do Distrito' })).toBeTruthy();

    // E só as lojas dele entram nos números.
    expect(screen.getByText('de 3 lojas')).toBeTruthy();
    expect(cardValue('Faltas')).toBe('5');

    const lojas = screen.getByLabelText('Loja') as HTMLSelectElement;
    expect([...lojas.options].map((option) => option.textContent)).toEqual([
      'Todas as lojas (3)',
      '101 - ALFA',
      '102 - BRAVO',
      '103 - CHARLIE',
    ]);
  });

  // TESTE 13 (extra) — trocar de distrito não deixa uma loja órfã no filtro.
  it('13. trocar de distrito zera a loja escolhida', async () => {
    const user = await renderDashboard(perfil());

    await user.selectOptions(screen.getByLabelText('Distrito'), 'district-1');
    await user.selectOptions(screen.getByLabelText('Loja'), 'store-101');
    expect((screen.getByLabelText('Loja') as HTMLSelectElement).value).toBe('store-101');

    await user.selectOptions(screen.getByLabelText('Distrito'), 'district-2');

    // Sem isso, a tela ficaria vazia mostrando "ALFA" como loja escolhida.
    expect((screen.getByLabelText('Loja') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('de 2 lojas')).toBeTruthy();
  });
});
