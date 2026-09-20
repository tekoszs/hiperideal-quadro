import { describe, expect, it } from 'vitest';
import type {
  AnalyticsFilters,
  NetworkRangeData,
  RangeConferenceRow,
  RangeItemRow,
  RangeReasonRow,
} from '@/types/analytics';
import {
  buildCoverage,
  buildDelta,
  buildFunctionGroups,
  buildNetworkAnalytics,
  buildPositionAttention,
  buildPositionRanking,
  buildReasonRanking,
  buildSectorRanking,
  buildStoreAnalysis,
  buildStoreRanking,
  buildWeekdaySeries,
  formatPercent,
  longestAbsenceStreak,
  safeDivide,
  share,
} from '@/domain/analytics';
import { resolvePeriod } from '@/domain/period';

/**
 * FASE 3B — as contas da Visão da Rede.
 *
 * Cenário base: 5 dias (01 a 05/09/2026), duas lojas.
 *
 *   PARQUE SHOPPING (124)
 *     01/09  PADARIA 1 falta · CAIXA 2 faltas (2 motivos) e 6 folgas
 *     02/09  CAIXA 2 faltas
 *     03/09  CAIXA 1 falta            -> 3 dias consecutivos com falta
 *     05/09  sem ocorrência
 *   CENTRO (200)
 *     05/09  REPOSITOR - MERCEARIA 2 faltas
 *
 * Total: 8 faltas, 6 folgas, 5 conferências enviadas de 10 esperadas.
 */

const TODAY = new Date(2026, 8, 6, 10, 0, 0); // 06/09/2026 -> D-1 = 05/09
const PERIOD = resolvePeriod('CUSTOM', {
  today: TODAY,
  custom: { start: '2026-09-01', end: '2026-09-05' },
});

const SEM_FILTRO: AnalyticsFilters = { districtId: null, storeId: null, functionGroup: null };

const STORES = [
  { id: 'store-124', code: '124', name: 'PARQUE SHOPPING', districtId: 'district-1' },
  { id: 'store-200', code: '200', name: 'CENTRO', districtId: 'district-2' },
];

function item(over: Partial<RangeItemRow> & Pick<RangeItemRow, 'conferenceId' | 'referenceDate' | 'positionId'>): RangeItemRow {
  return {
    storeId: 'store-124',
    storeName: 'PARQUE SHOPPING',
    positionName: over.positionId,
    functionGroup: over.positionId,
    sector: null,
    absenceQuantity: 0,
    dayOffQuantity: 0,
    observation: null,
    ...over,
  };
}

const PADARIA = {
  positionId: 'pos-padaria',
  positionName: 'ATENDENTE ALIMENTOS - PADARIA',
  functionGroup: 'ATENDENTE ALIMENTOS',
  sector: 'PADARIA',
};
const FRUTAS = {
  positionId: 'pos-frutas',
  positionName: 'ATENDENTE ALIMENTOS - FRUTAS',
  functionGroup: 'ATENDENTE ALIMENTOS',
  sector: 'FRUTAS',
};
const CAIXA = {
  positionId: 'pos-caixa',
  positionName: 'OPERADOR DE CAIXA',
  functionGroup: 'OPERADOR DE CAIXA',
  sector: null,
};
const MERCEARIA = {
  positionId: 'pos-repositor-mercearia',
  positionName: 'REPOSITOR - MERCEARIA',
  functionGroup: 'REPOSITOR',
  sector: 'MERCEARIA',
};

const ITEMS: RangeItemRow[] = [
  item({ conferenceId: 'c1', referenceDate: '2026-09-01', ...PADARIA, absenceQuantity: 1 }),
  item({
    conferenceId: 'c1',
    referenceDate: '2026-09-01',
    ...CAIXA,
    absenceQuantity: 2,
    dayOffQuantity: 6,
  }),
  item({ conferenceId: 'c1', referenceDate: '2026-09-01', ...FRUTAS }),
  item({ conferenceId: 'c2', referenceDate: '2026-09-02', ...CAIXA, absenceQuantity: 2 }),
  item({ conferenceId: 'c3', referenceDate: '2026-09-03', ...CAIXA, absenceQuantity: 1 }),
  item({ conferenceId: 'c4', referenceDate: '2026-09-05', ...CAIXA }),
  item({
    conferenceId: 'c5',
    referenceDate: '2026-09-05',
    storeId: 'store-200',
    storeName: 'CENTRO',
    ...MERCEARIA,
    absenceQuantity: 2,
  }),
];

/** 3 faltas da PARQUE em 01/09 divididas em 2 motivos no CAIXA. */
const REASONS: RangeReasonRow[] = [
  {
    conferenceId: 'c1',
    storeId: 'store-124',
    referenceDate: '2026-09-01',
    positionId: 'pos-padaria',
    reasonId: 'reason-atestado-medico',
    reasonName: 'Atestado médico',
    reasonQuantity: 1,
    observation: null,
  },
  {
    conferenceId: 'c1',
    storeId: 'store-124',
    referenceDate: '2026-09-01',
    positionId: 'pos-caixa',
    reasonId: 'reason-atestado-medico',
    reasonName: 'Atestado médico',
    reasonQuantity: 1,
    observation: null,
  },
  {
    conferenceId: 'c1',
    storeId: 'store-124',
    referenceDate: '2026-09-01',
    positionId: 'pos-caixa',
    reasonId: 'reason-falta-injustificada',
    reasonName: 'Falta injustificada',
    reasonQuantity: 1,
    observation: null,
  },
  {
    conferenceId: 'c2',
    storeId: 'store-124',
    referenceDate: '2026-09-02',
    positionId: 'pos-caixa',
    reasonId: 'reason-falta-injustificada',
    reasonName: 'Falta injustificada',
    reasonQuantity: 2,
    observation: null,
  },
  {
    conferenceId: 'c3',
    storeId: 'store-124',
    referenceDate: '2026-09-03',
    positionId: 'pos-caixa',
    reasonId: 'reason-atestado-medico',
    reasonName: 'Atestado médico',
    reasonQuantity: 1,
    observation: null,
  },
  {
    conferenceId: 'c5',
    storeId: 'store-200',
    referenceDate: '2026-09-05',
    positionId: 'pos-repositor-mercearia',
    reasonId: 'reason-outros',
    reasonName: 'Outros',
    reasonQuantity: 2,
    observation: null,
  },
];

/** Conferência ENVIADA — a única que vira número no dashboard. */
function enviada(
  id: string,
  referenceDate: string,
  storeId = 'store-124',
): RangeConferenceRow {
  return { id, storeId, referenceDate, status: 'SUBMITTED', submittedAt: `${referenceDate}T11:00:00Z` };
}

/** Conferência em RASCUNHO — conta como pendência, nunca como número. */
function rascunho(
  id: string,
  referenceDate: string,
  storeId = 'store-124',
  status: 'DRAFT' | 'REOPENED' = 'DRAFT',
): RangeConferenceRow {
  return { id, storeId, referenceDate, status, submittedAt: null };
}

const CONFERENCES: RangeConferenceRow[] = [
  { id: 'c1', storeId: 'store-124', referenceDate: '2026-09-01', status: 'SUBMITTED', submittedAt: '2026-09-02T11:00:00Z' },
  { id: 'c2', storeId: 'store-124', referenceDate: '2026-09-02', status: 'SUBMITTED', submittedAt: '2026-09-03T11:00:00Z' },
  { id: 'c3', storeId: 'store-124', referenceDate: '2026-09-03', status: 'SUBMITTED', submittedAt: '2026-09-04T11:00:00Z' },
  { id: 'c4', storeId: 'store-124', referenceDate: '2026-09-05', status: 'SUBMITTED', submittedAt: '2026-09-06T11:00:00Z' },
  { id: 'c5', storeId: 'store-200', referenceDate: '2026-09-05', status: 'SUBMITTED', submittedAt: '2026-09-06T11:00:00Z' },
];

const DATA: NetworkRangeData = {
  stores: STORES,
  conferences: CONFERENCES,
  items: ITEMS,
  reasons: REASONS,
};

const A = buildNetworkAnalytics(DATA, PERIOD, SEM_FILTRO);

/* ======================================================================= */

// TESTES 1 e 2
describe('Totais de faltas e folgas', () => {
  it('soma as faltas do período', () => {
    // 1 + 2 + 2 + 1 + 2 = 8
    expect(A.headline.totalAbsences).toBe(8);
  });

  it('soma as folgas do período', () => {
    expect(A.headline.totalDayOffs).toBe(6);
  });

  it('conta as lojas com falta', () => {
    expect(A.headline.storesWithAbsence).toBe(2);
  });

  it('média por dia divide pelos dias do período', () => {
    // 8 faltas em 5 dias.
    expect(A.headline.absencesPerDay).toBeCloseTo(1.6, 5);
  });
});

// TESTES 3 e 24 — a regra que não pode quebrar
describe('Motivos NÃO duplicam faltas', () => {
  it('3 faltas em 2 motivos continuam sendo 3 faltas', () => {
    const dia1 = A.daily.find((point) => point.date === '2026-09-01')!;
    const motivosDoDia1 = REASONS.filter((reason) => reason.referenceDate === '2026-09-01');

    // A view de motivos tem 3 linhas para o dia 1 (o CAIXA aparece 2 vezes)...
    expect(motivosDoDia1).toHaveLength(3);
    // ...e mesmo assim o dia fechou com 3 faltas, nunca 6.
    expect(dia1.absences).toBe(3);
  });

  it('a soma dos motivos fecha com o total de faltas', () => {
    const somaMotivos = A.reasons.reduce((total, entry) => total + entry.quantity, 0);
    expect(somaMotivos).toBe(A.headline.totalAbsences);
    expect(somaMotivos).toBe(8);
  });

  // TESTE 9
  it('os motivos usam reason_quantity', () => {
    const atestado = A.reasons.find((r) => r.reasonId === 'reason-atestado-medico')!;
    // 1 (padaria 01) + 1 (caixa 01) + 1 (caixa 03) = 3
    expect(atestado.quantity).toBe(3);

    const injustificada = A.reasons.find((r) => r.reasonId === 'reason-falta-injustificada')!;
    expect(injustificada.quantity).toBe(3); // 1 + 2
  });

  it('o tipo da view de motivos nem carrega absence_quantity', () => {
    for (const reason of REASONS) {
      expect(Object.keys(reason)).not.toContain('absenceQuantity');
      expect(Object.keys(reason)).not.toContain('absence_quantity');
    }
  });

  it('percentuais dos motivos somam 100%', () => {
    const soma = A.reasons.reduce((total, entry) => total + (entry.share ?? 0), 0);
    expect(soma).toBeCloseTo(100, 5);
  });
});

// TESTE 4
describe('Ranking de lojas', () => {
  it('ordena por faltas, com a maior primeiro', () => {
    expect(A.storeRanking.map((entry) => entry.label)).toEqual(['PARQUE SHOPPING', 'CENTRO']);
    expect(A.storeRanking[0].absences).toBe(6); // 1 + 2 + 2 + 1
    expect(A.storeRanking[1].absences).toBe(2);
  });

  it('conta os dias com falta e a média por dia com falta', () => {
    const parque = A.storeRanking[0];
    // 01, 02 e 03 tiveram falta; 05 não.
    expect(parque.daysWithAbsence).toBe(3);
    expect(parque.averagePerDayWithAbsence).toBeCloseTo(2, 5); // 6 / 3
  });

  it('traz folgas e percentual do total', () => {
    const parque = A.storeRanking[0];
    expect(parque.dayOffs).toBe(6);
    expect(parque.share).toBeCloseTo((6 / 8) * 100, 5);
  });

  it('loja sem nenhuma ocorrência fica fora do ranking', () => {
    const semOcorrencia = buildStoreRanking(
      [item({ conferenceId: 'x', referenceDate: '2026-09-01', ...CAIXA })],
      STORES,
    );
    expect(semOcorrencia).toEqual([]);
  });
});

// TESTE 5
describe('Ranking de funções', () => {
  it('usa o nome COMPLETO e não funde funções do mesmo grupo', () => {
    expect(A.positionRanking.map((entry) => entry.label)).toEqual([
      'OPERADOR DE CAIXA',
      'REPOSITOR - MERCEARIA',
      'ATENDENTE ALIMENTOS - PADARIA',
    ]);
    expect(A.positionRanking[0].absences).toBe(5); // 2 + 2 + 1
  });

  it('conta as lojas afetadas por função', () => {
    const caixa = A.positionRanking.find((e) => e.positionId === 'pos-caixa')!;
    expect(caixa.storesAffected).toBe(1);
  });

  it('percentual sobre o total de faltas', () => {
    const caixa = A.positionRanking[0];
    expect(caixa.share).toBeCloseTo((5 / 8) * 100, 5);
  });

  it('função sem falta não entra', () => {
    expect(A.positionRanking.some((e) => e.positionId === 'pos-frutas')).toBe(false);
  });
});

// TESTE 6
describe('Agrupamento por function_group', () => {
  it('agrupa mantendo as funções detalhadas dentro', () => {
    const atendente = A.functionGroups.find((g) => g.functionGroup === 'ATENDENTE ALIMENTOS')!;
    expect(atendente.absences).toBe(1);
    // FRUTAS não teve falta, então não aparece no detalhamento.
    expect(atendente.positions.map((p) => p.label)).toEqual(['ATENDENTE ALIMENTOS - PADARIA']);
  });

  it('o total do grupo é a soma das funções dele', () => {
    const comMuitos = buildFunctionGroups([
      item({ conferenceId: 'g', referenceDate: '2026-09-01', ...PADARIA, absenceQuantity: 9 }),
      item({ conferenceId: 'g', referenceDate: '2026-09-01', ...FRUTAS, absenceQuantity: 3 }),
    ]);
    const grupo = comMuitos[0];
    expect(grupo.functionGroup).toBe('ATENDENTE ALIMENTOS');
    expect(grupo.absences).toBe(12);
    expect(grupo.positions.map((p) => p.absences)).toEqual([9, 3]);
    expect(grupo.positions.reduce((t, p) => t + p.absences, 0)).toBe(grupo.absences);
  });

  it('o agrupamento é só analítico: os registros seguem separados', () => {
    const atendente = buildFunctionGroups([
      item({ conferenceId: 'g', referenceDate: '2026-09-01', ...PADARIA, absenceQuantity: 9 }),
      item({ conferenceId: 'g', referenceDate: '2026-09-01', ...FRUTAS, absenceQuantity: 3 }),
    ])[0];
    // Duas funções distintas, dois ids distintos — nada foi fundido.
    expect(new Set(atendente.positions.map((p) => p.positionId)).size).toBe(2);
  });
});

// TESTES 7 e 8
describe('Análise por setor', () => {
  it('só funções COM setor entram no ranking', () => {
    expect(A.sectors.entries.map((entry) => entry.sector)).toEqual(['MERCEARIA', 'PADARIA']);
  });

  it('função sem setor NÃO ganha setor inventado', () => {
    // O CAIXA (sector null) tem 5 faltas e não aparece como setor nenhum.
    expect(A.sectors.entries.some((e) => e.sector === 'OPERADOR DE CAIXA')).toBe(false);
    expect(A.sectors.entries.some((e) => e.sector === null)).toBe(false);
    expect(A.sectors.entries.some((e) => /sem setor/i.test(e.sector))).toBe(false);
  });

  it('as faltas sem setor não somem: voltam separadas para a conta fechar', () => {
    expect(A.sectors.absencesWithoutSector).toBe(5); // as do CAIXA
    expect(A.sectors.applicableTotal).toBe(3); // MERCEARIA 2 + PADARIA 1
    expect(A.sectors.applicableTotal + A.sectors.absencesWithoutSector).toBe(
      A.headline.totalAbsences,
    );
  });

  it('o percentual usa como base só as faltas COM setor', () => {
    const mercearia = A.sectors.entries.find((e) => e.sector === 'MERCEARIA')!;
    expect(mercearia.share).toBeCloseTo((2 / 3) * 100, 5);
    const soma = A.sectors.entries.reduce((total, e) => total + (e.share ?? 0), 0);
    expect(soma).toBeCloseTo(100, 5);
  });

  it('sem nenhuma função com setor, o ranking fica vazio e nada explode', () => {
    const soSemSetor = buildSectorRanking([
      item({ conferenceId: 'x', referenceDate: '2026-09-01', ...CAIXA, absenceQuantity: 4 }),
    ]);
    expect(soSemSetor.entries).toEqual([]);
    expect(soSemSetor.applicableTotal).toBe(0);
    expect(soSemSetor.absencesWithoutSector).toBe(4);
  });
});

// TESTE 18
describe('Cobertura das conferências', () => {
  it('esperadas = lojas ativas × dias do período', () => {
    // 2 lojas × 5 dias = 10
    expect(A.headline.coverage.expected).toBe(10);
    expect(A.headline.coverage.submitted).toBe(5);
    expect(A.headline.coverage.pending).toBe(5);
    expect(A.headline.coverage.rate).toBeCloseTo(0.5, 5);
  });

  it('só SUBMITTED conta como entregue', () => {
    const comRascunho = buildCoverage(
      [
        { id: 'a', storeId: 's', referenceDate: '2026-09-01', status: 'SUBMITTED', submittedAt: 'x' },
        { id: 'b', storeId: 's', referenceDate: '2026-09-02', status: 'DRAFT', submittedAt: null },
        { id: 'c', storeId: 's', referenceDate: '2026-09-03', status: 'REOPENED', submittedAt: null },
      ],
      1,
      3,
    );
    expect(comRascunho.submitted).toBe(1);
    expect(comRascunho.pending).toBe(2);
  });

  // TESTE 23
  it('sem loja nenhuma, a taxa é null em vez de NaN', () => {
    const vazia = buildCoverage([], 0, 5);
    expect(vazia.expected).toBe(0);
    expect(vazia.rate).toBeNull();
    expect(Number.isNaN(vazia.rate as unknown as number)).toBe(false);
  });

  it('pendentes nunca fica negativo', () => {
    const excesso = buildCoverage(
      Array.from({ length: 5 }, (_, i) => ({
        id: `x${i}`,
        storeId: 's',
        referenceDate: '2026-09-01',
        status: 'SUBMITTED' as const,
        submittedAt: 'x',
      })),
      1,
      1,
    );
    expect(excesso.pending).toBe(0);
  });
});

// TESTES 15 e 16
describe('Comparação com o período anterior', () => {
  it('calcula a variação quando há base', () => {
    const delta = buildDelta(12, 8);
    expect(delta.hasBase).toBe(true);
    expect(delta.percent).toBeCloseTo(50, 5);
    expect(formatPercent(delta.percent!)).toBe('+50,0%');
  });

  it('queda vem com sinal negativo', () => {
    const delta = buildDelta(8, 12);
    expect(delta.percent).toBeCloseTo(-33.333, 2);
    expect(formatPercent(delta.percent!)).toBe('-33,3%');
  });

  it('SEM base anterior não inventa percentual', () => {
    const delta = buildDelta(10, 0);
    expect(delta.hasBase).toBe(false);
    expect(delta.percent).toBeNull();
    // Nada de 0%, nada de 100%, nada de Infinity.
    expect(Number.isFinite(delta.percent as unknown as number)).toBe(false);
  });

  it('zero contra zero também não inventa', () => {
    const delta = buildDelta(0, 0);
    expect(delta.hasBase).toBe(false);
    expect(delta.percent).toBeNull();
  });

  it('no cenário base não há período anterior com dados', () => {
    // Os dados carregados vão só de 01 a 05/09; o anterior (27 a 31/08) está vazio.
    expect(A.headline.absencesDelta.previous).toBe(0);
    expect(A.headline.absencesDelta.hasBase).toBe(false);
    expect(A.headline.absencesDelta.percent).toBeNull();
  });

  it('com dados no anterior, a variação aparece', () => {
    const comAnterior: NetworkRangeData = {
      ...DATA,
      // O item do período anterior só conta se a conferência dele existir E
      // estiver ENVIADA — item solto não é dado oficial.
      conferences: [...CONFERENCES, enviada('p1', '2026-08-28')],
      items: [
        ...ITEMS,
        item({ conferenceId: 'p1', referenceDate: '2026-08-28', ...CAIXA, absenceQuantity: 4 }),
      ],
    };
    const resultado = buildNetworkAnalytics(comAnterior, PERIOD, SEM_FILTRO);
    expect(resultado.headline.absencesDelta.previous).toBe(4);
    expect(resultado.headline.absencesDelta.percent).toBeCloseTo(100, 5); // 4 -> 8
  });
});

// TESTE 12 (série) e 22
describe('Evolução diária', () => {
  it('gera um ponto por dia do período, inclusive os vazios', () => {
    expect(A.daily).toHaveLength(5);
    expect(A.daily.map((point) => point.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('dia sem conferência entra zerado, sem sumir do gráfico', () => {
    const dia4 = A.daily.find((point) => point.date === '2026-09-04')!;
    expect(dia4).toMatchObject({ absences: 0, dayOffs: 0, submitted: 0 });
  });

  it('a soma da série bate com o total', () => {
    expect(A.daily.reduce((total, point) => total + point.absences, 0)).toBe(8);
    expect(A.daily.reduce((total, point) => total + point.dayOffs, 0)).toBe(6);
  });

  // TESTE 22
  it('período sem NENHUM dado gera série de zeros, não série vazia', () => {
    const vazio = buildNetworkAnalytics(
      { stores: STORES, conferences: [], items: [], reasons: [] },
      PERIOD,
      SEM_FILTRO,
    );
    expect(vazio.daily).toHaveLength(5);
    expect(vazio.daily.every((point) => point.absences === 0)).toBe(true);
    expect(vazio.isEmpty).toBe(true);
    expect(vazio.storeRanking).toEqual([]);
    expect(vazio.reasons).toEqual([]);
  });

  it('um único dia gera um único ponto', () => {
    const umDia = resolvePeriod('DAY', { today: TODAY });
    const resultado = buildNetworkAnalytics(DATA, umDia, SEM_FILTRO);
    expect(resultado.daily).toHaveLength(1);
    expect(resultado.daily[0].date).toBe('2026-09-05');
  });
});

describe('Distribuição por dia da semana', () => {
  it('acumula as faltas no dia da semana certo', () => {
    // 01/09/2026 é terça-feira.
    const terca = A.weekdays.find((dia) => dia.label === 'Ter')!;
    expect(terca.absences).toBe(3);
    const sabado = A.weekdays.find((dia) => dia.label === 'Sáb')!;
    expect(sabado.absences).toBe(2); // 05/09 é sábado
  });

  it('começa na segunda e tem os 7 dias', () => {
    expect(A.weekdays.map((dia) => dia.label)).toEqual([
      'Seg',
      'Ter',
      'Qua',
      'Qui',
      'Sex',
      'Sáb',
      'Dom',
    ]);
  });

  it('informa a amostra de cada dia da semana', () => {
    // Em 5 dias, cada dia da semana aparece no máximo uma vez.
    const total = A.weekdays.reduce((soma, dia) => soma + dia.sampleDays, 0);
    expect(total).toBe(5);
    expect(A.weekdays.some((dia) => dia.sampleDays === 0)).toBe(true);
  });

  it('série vazia não estoura', () => {
    expect(buildWeekdaySeries([])).toHaveLength(7);
    expect(buildWeekdaySeries([]).every((dia) => dia.absences === 0)).toBe(true);
  });
});

describe('Regras de atenção — determinísticas', () => {
  it('acusa faltas em dias consecutivos', () => {
    const sequencia = A.storeAttention.find((a) => a.rule === 'CONSECUTIVE_DAYS');
    expect(sequencia?.storeName).toBe('PARQUE SHOPPING');
    expect(sequencia?.message).toContain('3 dias consecutivos');
  });

  // TESTE 17
  it('acusa conferências pendentes no período', () => {
    const pendencia = A.storeAttention.filter((a) => a.rule === 'PENDING_CONFERENCES');
    // PARQUE enviou 4 de 5 dias, CENTRO enviou 1 de 5.
    expect(pendencia.map((a) => a.storeName).sort()).toEqual(['CENTRO', 'PARQUE SHOPPING']);
    expect(pendencia.find((a) => a.storeName === 'CENTRO')?.message).toContain('4 conferências');
  });

  it('acusa o maior volume da rede quando há mais de uma loja', () => {
    const volume = A.storeAttention.find((a) => a.rule === 'HIGHEST_VOLUME');
    expect(volume?.storeName).toBe('PARQUE SHOPPING');
    expect(volume?.message).toContain('6 faltas');
  });

  it('com uma loja só, não faz sentido falar em "maior da rede"', () => {
    const umaLoja = buildNetworkAnalytics(
      { ...DATA, stores: [STORES[0]] },
      PERIOD,
      { districtId: null, storeId: 'store-124', functionGroup: null },
    );
    expect(umaLoja.storeAttention.some((a) => a.rule === 'HIGHEST_VOLUME')).toBe(false);
  });

  it('a alta forte exige base mínima — 1 -> 2 faltas não vira alerta', () => {
    const comBasePequena: NetworkRangeData = {
      ...DATA,
      conferences: [enviada('a', '2026-09-01'), enviada('b', '2026-08-28')],
      items: [
        item({ conferenceId: 'a', referenceDate: '2026-09-01', ...CAIXA, absenceQuantity: 2 }),
        item({ conferenceId: 'b', referenceDate: '2026-08-28', ...CAIXA, absenceQuantity: 1 }),
      ],
    };
    const resultado = buildNetworkAnalytics(comBasePequena, PERIOD, SEM_FILTRO);
    expect(resultado.storeAttention.some((a) => a.rule === 'SHARP_INCREASE')).toBe(false);
  });

  it('a alta forte dispara com base suficiente', () => {
    const comAlta: NetworkRangeData = {
      ...DATA,
      conferences: [enviada('a', '2026-09-01'), enviada('b', '2026-08-28')],
      items: [
        item({ conferenceId: 'a', referenceDate: '2026-09-01', ...CAIXA, absenceQuantity: 10 }),
        item({ conferenceId: 'b', referenceDate: '2026-08-28', ...CAIXA, absenceQuantity: 4 }),
      ],
    };
    const resultado = buildNetworkAnalytics(comAlta, PERIOD, SEM_FILTRO);
    const alta = resultado.storeAttention.find((a) => a.rule === 'SHARP_INCREASE');
    expect(alta?.message).toContain('4 → 10 faltas');
  });

  it('longestAbsenceStreak conta só dias realmente seguidos', () => {
    expect(longestAbsenceStreak([])).toBe(0);
    expect(longestAbsenceStreak(['2026-09-01'])).toBe(1);
    expect(longestAbsenceStreak(['2026-09-01', '2026-09-02', '2026-09-03'])).toBe(3);
    // Buraco no dia 3 quebra a sequência.
    expect(longestAbsenceStreak(['2026-09-01', '2026-09-02', '2026-09-04'])).toBe(2);
    // Datas repetidas não inflam a contagem.
    expect(longestAbsenceStreak(['2026-09-01', '2026-09-01', '2026-09-02'])).toBe(2);
  });

  it('funções em atenção trazem faltas e lojas afetadas', () => {
    const caixa = A.positionAttention[0];
    expect(caixa.positionName).toBe('OPERADOR DE CAIXA');
    expect(caixa.message).toBe('5 faltas em 1 loja');
  });
});

// TESTE 20
describe('Filtro de loja', () => {
  const soParque = buildNetworkAnalytics(DATA, PERIOD, {
    districtId: null,
    storeId: 'store-124',
    functionGroup: null,
  });

  it('o dashboard inteiro passa a analisar só a loja escolhida', () => {
    expect(soParque.headline.totalAbsences).toBe(6);
    expect(soParque.headline.totalDayOffs).toBe(6);
    expect(soParque.storeRanking).toHaveLength(1);
    expect(soParque.storeRanking[0].label).toBe('PARQUE SHOPPING');
  });

  it('os motivos também respeitam o filtro', () => {
    // "Outros" era só do CENTRO.
    expect(soParque.reasons.some((r) => r.reasonId === 'reason-outros')).toBe(false);
    expect(soParque.reasons.reduce((t, r) => t + r.quantity, 0)).toBe(6);
  });

  it('a cobertura passa a considerar uma loja só', () => {
    expect(soParque.headline.coverage.expected).toBe(5); // 1 loja × 5 dias
    expect(soParque.headline.coverage.submitted).toBe(4);
  });

  it('o seletor continua listando TODAS as lojas, para poder voltar', () => {
    expect(soParque.stores).toHaveLength(2);
  });
});

describe('Filtro de grupo de função', () => {
  const soCaixa = buildNetworkAnalytics(DATA, PERIOD, {
    districtId: null,
    storeId: null,
    functionGroup: 'OPERADOR DE CAIXA',
  });

  it('limita as faltas ao grupo', () => {
    expect(soCaixa.headline.totalAbsences).toBe(5);
    expect(soCaixa.positionRanking).toHaveLength(1);
  });

  it('limita os motivos às funções do grupo', () => {
    expect(soCaixa.reasons.some((r) => r.reasonId === 'reason-outros')).toBe(false);
    expect(soCaixa.reasons.reduce((t, r) => t + r.quantity, 0)).toBe(5);
  });

  it('lista os grupos disponíveis para o seletor', () => {
    expect(A.availableGroups).toEqual([
      'ATENDENTE ALIMENTOS',
      'OPERADOR DE CAIXA',
      'REPOSITOR',
    ]);
  });
});

// TESTE 21
describe('Filtro de período', () => {
  it('trocar o período muda os totais', () => {
    const doisDias = resolvePeriod('CUSTOM', {
      today: TODAY,
      custom: { start: '2026-09-01', end: '2026-09-02' },
    });
    const resultado = buildNetworkAnalytics(DATA, doisDias, SEM_FILTRO);

    expect(resultado.headline.totalAbsences).toBe(5); // 3 + 2
    expect(resultado.daily).toHaveLength(2);
    expect(resultado.headline.coverage.expected).toBe(4); // 2 lojas × 2 dias
  });

  it('período fora dos dados devolve tudo zerado, sem quebrar', () => {
    const forade = resolvePeriod('CUSTOM', {
      today: TODAY,
      custom: { start: '2026-01-01', end: '2026-01-05' },
    });
    const resultado = buildNetworkAnalytics(DATA, forade, SEM_FILTRO);

    expect(resultado.headline.totalAbsences).toBe(0);
    expect(resultado.isEmpty).toBe(true);
    expect(resultado.headline.absencesPerDay).toBe(0);
  });
});

// TESTES 23 e 29
describe('Nada de NaN, Infinity ou divisão por zero', () => {
  it('safeDivide devolve null em vez de estourar', () => {
    expect(safeDivide(10, 0)).toBeNull();
    expect(safeDivide(0, 0)).toBeNull();
    expect(safeDivide(Number.NaN, 5)).toBeNull();
    expect(safeDivide(5, Number.POSITIVE_INFINITY)).toBeNull();
    expect(safeDivide(10, 4)).toBe(2.5);
  });

  it('share devolve null sem base', () => {
    expect(share(5, 0)).toBeNull();
    expect(share(0, 0)).toBeNull();
    expect(share(1, 4)).toBe(25);
  });

  it('NENHUM número do dashboard é NaN ou Infinity', () => {
    const vazio = buildNetworkAnalytics(
      { stores: [], conferences: [], items: [], reasons: [] },
      PERIOD,
      SEM_FILTRO,
    );

    const numeros: number[] = [];
    JSON.stringify(vazio, (_chave, valor) => {
      if (typeof valor === 'number') numeros.push(valor);
      return valor;
    });

    expect(numeros.length).toBeGreaterThan(0);
    expect(numeros.every((n) => Number.isFinite(n))).toBe(true);
    // JSON.stringify converte NaN/Infinity em null: a varredura acima já
    // garante que nenhum número finito virou lixo, e os campos opcionais são
    // null de propósito.
  });

  it('percentuais ficam null, não NaN, quando não há total', () => {
    const semFalta = buildPositionRanking([
      item({ conferenceId: 'x', referenceDate: '2026-09-01', ...CAIXA }),
    ]);
    expect(semFalta).toEqual([]);

    const semMotivo = buildReasonRanking([]);
    expect(semMotivo).toEqual([]);
  });
});

// TESTE 30
describe('Funciona com apenas UMA loja e UMA conferência', () => {
  const umDia = resolvePeriod('DAY', { today: TODAY });
  const minimo: NetworkRangeData = {
    stores: [STORES[0]],
    conferences: [
      {
        id: 'unica',
        storeId: 'store-124',
        referenceDate: '2026-09-05',
        status: 'SUBMITTED',
        submittedAt: '2026-09-06T11:00:00Z',
      },
    ],
    items: [
      item({ conferenceId: 'unica', referenceDate: '2026-09-05', ...PADARIA, absenceQuantity: 1 }),
    ],
    reasons: [
      {
        conferenceId: 'unica',
        storeId: 'store-124',
        referenceDate: '2026-09-05',
        positionId: 'pos-padaria',
        reasonId: 'reason-atestado-medico',
        reasonName: 'Atestado médico',
        reasonQuantity: 1,
        observation: null,
      },
    ],
  };

  const resultado = buildNetworkAnalytics(minimo, umDia, SEM_FILTRO);

  it('os totais saem certos', () => {
    expect(resultado.headline.totalAbsences).toBe(1);
    expect(resultado.headline.storesWithAbsence).toBe(1);
    expect(resultado.headline.absencesPerDay).toBe(1);
  });

  it('a cobertura fecha em 100%', () => {
    expect(resultado.headline.coverage).toMatchObject({
      expected: 1,
      submitted: 1,
      pending: 0,
    });
    expect(resultado.headline.coverage.rate).toBe(1);
  });

  it('os rankings funcionam com um item só', () => {
    expect(resultado.storeRanking).toHaveLength(1);
    expect(resultado.storeRanking[0].share).toBe(100);
    expect(resultado.positionRanking).toHaveLength(1);
    expect(resultado.reasons).toHaveLength(1);
  });

  it('a série de um dia tem um ponto', () => {
    expect(resultado.daily).toHaveLength(1);
    expect(resultado.daily[0].absences).toBe(1);
  });

  it('não fica vazio nem em atenção por volume', () => {
    expect(resultado.isEmpty).toBe(false);
    expect(resultado.storeAttention.some((a) => a.rule === 'HIGHEST_VOLUME')).toBe(false);
  });
});

describe('Análise de uma loja (drawer)', () => {
  const analise = buildStoreAnalysis(DATA, PERIOD, 'store-124', SEM_FILTRO)!;

  it('traz totais, funções, motivos e conferências da loja', () => {
    expect(analise.storeName).toBe('PARQUE SHOPPING');
    expect(analise.totalAbsences).toBe(6);
    expect(analise.totalDayOffs).toBe(6);
    expect(analise.daysWithAbsence).toBe(3);
    expect(analise.positions[0].label).toBe('OPERADOR DE CAIXA');
    expect(analise.conferences).toHaveLength(4);
  });

  it('as conferências vêm da mais recente para a mais antiga', () => {
    expect(analise.conferences.map((c) => c.referenceDate)).toEqual([
      '2026-09-05',
      '2026-09-03',
      '2026-09-02',
      '2026-09-01',
    ]);
  });

  it('os motivos da loja fecham com as faltas dela', () => {
    expect(analise.reasons.reduce((t, r) => t + r.quantity, 0)).toBe(6);
  });

  it('loja inexistente devolve null em vez de estourar', () => {
    expect(buildStoreAnalysis(DATA, PERIOD, 'store-nao-existe', SEM_FILTRO)).toBeNull();
  });
});

describe('Concordância nas mensagens de atenção', () => {
  it('1 falta no singular, 2 faltas no plural', () => {
    const uma = buildPositionAttention([
      {
        key: 'p',
        positionId: 'p',
        label: 'PADEIRO',
        functionGroup: 'PADEIRO',
        sector: null,
        absences: 1,
        dayOffs: 0,
        share: 100,
        storesAffected: 1,
      },
    ]);
    expect(uma[0].message).toBe('1 falta em 1 loja');

    const varias = buildPositionAttention([
      {
        key: 'p',
        positionId: 'p',
        label: 'PADEIRO',
        functionGroup: 'PADEIRO',
        sector: null,
        absences: 4,
        dayOffs: 0,
        share: 100,
        storesAffected: 3,
      },
    ]);
    expect(varias[0].message).toBe('4 faltas em 3 lojas');
  });
});

/**
 * A regra de dado oficial, verificada também no cenário-base desta suíte.
 * A cobertura completa está em `officialData.test.ts`.
 */
describe('Rascunho não entra no cenário base', () => {
  it('somar um rascunho aos dados não muda nenhum número oficial', () => {
    const comRascunho = buildNetworkAnalytics(
      {
        ...DATA,
        conferences: [...CONFERENCES, rascunho('draft-x', '2026-09-04')],
        items: [
          ...ITEMS,
          item({
            conferenceId: 'draft-x',
            referenceDate: '2026-09-04',
            ...CAIXA,
            absenceQuantity: 99,
            dayOffQuantity: 99,
          }),
        ],
      },
      PERIOD,
      SEM_FILTRO,
    );

    expect(comRascunho.headline.totalAbsences).toBe(A.headline.totalAbsences);
    expect(comRascunho.headline.totalDayOffs).toBe(A.headline.totalDayOffs);
    expect(comRascunho.storeRanking[0].absences).toBe(A.storeRanking[0].absences);
    // Mas ele existe para a cobertura: uma conferência a mais em preenchimento.
    expect(comRascunho.headline.coverage.inProgress).toBe(1);
  });
});
