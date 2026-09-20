import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  AnalyticsFilters,
  NetworkRangeData,
  RangeConferenceRow,
  RangeItemRow,
  RangeReasonRow,
} from '@/types/analytics';
import type { DailyConference } from '@/types/domain';
import {
  buildDailySeries,
  buildNetworkAnalytics,
  buildStoreAnalysis,
  dayCoverageState,
  submittedConferenceIds,
} from '@/domain/analytics';
import { resolvePeriod } from '@/domain/period';
import { LocalStorageAdapter, MemoryStore } from '@/services/storage';

/**
 * CORREÇÃO DE CONSISTÊNCIA ANALÍTICA (fase 3B).
 *
 * DEFEITO REAL, reproduzido no PostgreSQL antes de corrigir:
 *
 *   `quadro_v_conference_items` e `quadro_v_conference_item_reasons` NÃO
 *   filtram status — devolvem também as linhas de conferências DRAFT e
 *   REOPENED. Uma conferência em rascunho ficava PENDENTE na cobertura e, ao
 *   mesmo tempo, tinha as faltas somadas no total, no ranking, nos motivos e
 *   na comparação.
 *
 *   10/05 ENVIADA com 3 faltas + 11/05 RASCUNHO com 10 faltas
 *     -> o painel dizia 13 faltas. O correto é 3.
 *
 * A correção tem DUAS CAMADAS: o adaptador filtra `status` na consulta e o
 * domínio refaz a checagem sobre `RangeConferenceRow[]`. Estes testes cobrem
 * as duas, e provam que o domínio segura mesmo se o adaptador falhar.
 */

const TODAY = new Date(2026, 8, 6, 10, 0, 0); // D-1 = 05/09/2026
const PERIOD = resolvePeriod('CUSTOM', {
  today: TODAY,
  custom: { start: '2026-09-01', end: '2026-09-05' },
});
const SEM_FILTRO: AnalyticsFilters = { districtId: null, storeId: null, functionGroup: null };

const STORES = [
  { id: 'store-124', code: '124', name: 'PARQUE SHOPPING', districtId: 'district-1' },
  { id: 'store-200', code: '200', name: 'CENTRO', districtId: 'district-2' },
];

function conferencia(
  id: string,
  referenceDate: string,
  status: RangeConferenceRow['status'],
  storeId = 'store-124',
): RangeConferenceRow {
  return {
    id,
    storeId,
    referenceDate,
    status,
    submittedAt: status === 'SUBMITTED' ? `${referenceDate}T11:00:00Z` : null,
  };
}

function item(
  conferenceId: string,
  referenceDate: string,
  absences: number,
  extra: Partial<RangeItemRow> = {},
): RangeItemRow {
  return {
    conferenceId,
    storeId: 'store-124',
    storeName: 'PARQUE SHOPPING',
    referenceDate,
    positionId: 'pos-caixa',
    positionName: 'OPERADOR DE CAIXA',
    functionGroup: 'OPERADOR DE CAIXA',
    sector: null,
    absenceQuantity: absences,
    dayOffQuantity: 0,
    observation: null,
    ...extra,
  };
}

function motivo(
  conferenceId: string,
  referenceDate: string,
  reasonId: string,
  reasonName: string,
  quantity: number,
): RangeReasonRow {
  return {
    conferenceId,
    storeId: 'store-124',
    referenceDate,
    positionId: 'pos-caixa',
    reasonId,
    reasonName,
    reasonQuantity: quantity,
    observation: null,
  };
}

/**
 * O cenário do defeito, montado como o banco entregaria HOJE:
 * o adaptador (ou uma versão dele sem o filtro) devolve as linhas das duas
 * conferências, e é o domínio que precisa separar.
 */
const ENVIADA_3 = conferencia('sub', '2026-09-01', 'SUBMITTED');
const RASCUNHO_10 = conferencia('dra', '2026-09-02', 'DRAFT');
const REABERTA_5 = conferencia('reo', '2026-09-03', 'REOPENED');

const DATA: NetworkRangeData = {
  stores: STORES,
  conferences: [ENVIADA_3, RASCUNHO_10, REABERTA_5],
  items: [
    item('sub', '2026-09-01', 3, { dayOffQuantity: 2 }),
    item('dra', '2026-09-02', 10, { dayOffQuantity: 7 }),
    item('reo', '2026-09-03', 5, { dayOffQuantity: 4 }),
  ],
  reasons: [
    motivo('sub', '2026-09-01', 'reason-atestado-medico', 'Atestado médico', 3),
    motivo('dra', '2026-09-02', 'reason-falta-injustificada', 'Falta injustificada', 10),
    motivo('reo', '2026-09-03', 'reason-licenca', 'Licença', 5),
  ],
};

const A = buildNetworkAnalytics(DATA, PERIOD, SEM_FILTRO);

/* ======================================================================= */

describe('submittedConferenceIds — o helper da regra', () => {
  it('só devolve os ids de conferências ENVIADAS', () => {
    const ids = submittedConferenceIds(DATA.conferences);
    expect([...ids]).toEqual(['sub']);
    expect(ids.has('dra')).toBe(false);
    expect(ids.has('reo')).toBe(false);
  });

  it('lista vazia devolve conjunto vazio, sem estourar', () => {
    expect(submittedConferenceIds([]).size).toBe(0);
  });
});

// TESTES 1, 2, 3 e 4
describe('Só SUBMITTED vira número oficial', () => {
  it('1. SUBMITTED com 3 faltas -> total 3', () => {
    const so = buildNetworkAnalytics(
      { ...DATA, conferences: [ENVIADA_3], items: [DATA.items[0]], reasons: [DATA.reasons[0]] },
      PERIOD,
      SEM_FILTRO,
    );
    expect(so.headline.totalAbsences).toBe(3);
  });

  it('2. DRAFT com 10 faltas -> total oficial 0', () => {
    const so = buildNetworkAnalytics(
      { ...DATA, conferences: [RASCUNHO_10], items: [DATA.items[1]], reasons: [DATA.reasons[1]] },
      PERIOD,
      SEM_FILTRO,
    );
    expect(so.headline.totalAbsences).toBe(0);
    expect(so.headline.totalDayOffs).toBe(0);
  });

  it('3. REOPENED com 5 faltas -> total oficial 0', () => {
    const so = buildNetworkAnalytics(
      { ...DATA, conferences: [REABERTA_5], items: [DATA.items[2]], reasons: [DATA.reasons[2]] },
      PERIOD,
      SEM_FILTRO,
    );
    expect(so.headline.totalAbsences).toBe(0);
  });

  it('4. SUBMITTED 3 + DRAFT 10 + REOPENED 5 -> total oficial 3', () => {
    // Antes da correção este número era 18.
    expect(A.headline.totalAbsences).toBe(3);
    expect(A.headline.totalDayOffs).toBe(2);
  });

  it('lojas com falta conta só quem tem falta ENVIADA', () => {
    expect(A.headline.storesWithAbsence).toBe(1);
  });

  it('a média por dia usa só o oficial', () => {
    // 3 faltas em 5 dias, não 18.
    expect(A.headline.absencesPerDay).toBeCloseTo(0.6, 5);
  });
});

// TESTES 5 e 6
describe('Motivos', () => {
  it('5. motivo de DRAFT/REOPENED não entra no ranking', () => {
    expect(A.reasons.some((r) => r.reasonId === 'reason-falta-injustificada')).toBe(false);
    expect(A.reasons.some((r) => r.reasonId === 'reason-licenca')).toBe(false);
  });

  it('6. motivo de SUBMITTED entra', () => {
    expect(A.reasons).toHaveLength(1);
    expect(A.reasons[0]).toMatchObject({
      reasonId: 'reason-atestado-medico',
      quantity: 3,
      share: 100,
    });
  });

  it('a soma dos motivos oficiais fecha com as faltas oficiais', () => {
    const soma = A.reasons.reduce((total, r) => total + r.quantity, 0);
    expect(soma).toBe(A.headline.totalAbsences);
  });
});

// TESTE 7
describe('7. Comparação com o período anterior ignora DRAFT', () => {
  it('5 enviadas agora vs 3 enviadas antes — os 10 em rascunho não contam', () => {
    // Anterior de 01–05/09 é 27–31/08.
    const data: NetworkRangeData = {
      stores: STORES,
      conferences: [
        conferencia('atual', '2026-09-02', 'SUBMITTED'),
        conferencia('ant-ok', '2026-08-28', 'SUBMITTED'),
        conferencia('ant-draft', '2026-08-29', 'DRAFT'),
      ],
      items: [
        item('atual', '2026-09-02', 5),
        item('ant-ok', '2026-08-28', 3),
        item('ant-draft', '2026-08-29', 10),
      ],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);

    expect(resultado.headline.absencesDelta.current).toBe(5);
    // 3, e não 13.
    expect(resultado.headline.absencesDelta.previous).toBe(3);
    expect(resultado.headline.absencesDelta.percent).toBeCloseTo(66.667, 2);
  });

  it('anterior só com rascunho vira "sem base", não uma queda inventada', () => {
    const data: NetworkRangeData = {
      stores: STORES,
      conferences: [
        conferencia('atual', '2026-09-02', 'SUBMITTED'),
        conferencia('ant-draft', '2026-08-29', 'DRAFT'),
      ],
      items: [item('atual', '2026-09-02', 5), item('ant-draft', '2026-08-29', 10)],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    expect(resultado.headline.absencesDelta.previous).toBe(0);
    expect(resultado.headline.absencesDelta.hasBase).toBe(false);
    expect(resultado.headline.absencesDelta.percent).toBeNull();
  });
});

// TESTES 8, 9 e 10
describe('Rankings ignoram DRAFT/REOPENED', () => {
  it('8. ranking de lojas', () => {
    expect(A.storeRanking).toHaveLength(1);
    expect(A.storeRanking[0].absences).toBe(3);
    // A loja só entra pelo que foi enviado.
    expect(A.storeRanking[0].daysWithAbsence).toBe(1);
  });

  it('9. ranking de funções', () => {
    expect(A.positionRanking).toHaveLength(1);
    expect(A.positionRanking[0].absences).toBe(3);
  });

  it('10. setores', () => {
    const comSetor: NetworkRangeData = {
      ...DATA,
      items: [
        item('sub', '2026-09-01', 3, { positionId: 'pos-padaria', sector: 'PADARIA' }),
        item('dra', '2026-09-02', 10, { positionId: 'pos-frios', sector: 'FRIOS' }),
      ],
    };
    const resultado = buildNetworkAnalytics(comSetor, PERIOD, SEM_FILTRO);

    expect(resultado.sectors.entries.map((e) => e.sector)).toEqual(['PADARIA']);
    expect(resultado.sectors.entries[0].absences).toBe(3);
    expect(resultado.sectors.applicableTotal).toBe(3);
  });

  it('grupos de função também', () => {
    expect(A.functionGroups).toHaveLength(1);
    expect(A.functionGroups[0].absences).toBe(3);
  });
});

// TESTES 11 e 12
describe('Atenções ignoram DRAFT/REOPENED', () => {
  it('11. atenção por volume não considera rascunho', () => {
    const data: NetworkRangeData = {
      stores: STORES,
      conferences: [
        conferencia('a', '2026-09-01', 'SUBMITTED', 'store-124'),
        conferencia('b', '2026-09-01', 'DRAFT', 'store-200'),
      ],
      items: [
        item('a', '2026-09-01', 2),
        item('b', '2026-09-01', 50, { storeId: 'store-200', storeName: 'CENTRO' }),
      ],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    const volume = resultado.storeAttention.find((alerta) => alerta.rule === 'HIGHEST_VOLUME');

    // A CENTRO tem 50 faltas em rascunho: não é a maior da rede oficialmente.
    // Com uma única loja oficial, a regra nem dispara.
    expect(volume).toBeUndefined();
    expect(resultado.storeRanking.map((e) => e.storeId)).toEqual(['store-124']);
  });

  it('12. atenção por sequência só conta dias com falta ENVIADA', () => {
    // 3 dias seguidos, mas o do meio é rascunho -> a sequência quebra.
    const data: NetworkRangeData = {
      stores: [STORES[0]],
      conferences: [
        conferencia('d1', '2026-09-01', 'SUBMITTED'),
        conferencia('d2', '2026-09-02', 'DRAFT'),
        conferencia('d3', '2026-09-03', 'SUBMITTED'),
      ],
      items: [
        item('d1', '2026-09-01', 1),
        item('d2', '2026-09-02', 1),
        item('d3', '2026-09-03', 1),
      ],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    expect(resultado.storeAttention.some((a) => a.rule === 'CONSECUTIVE_DAYS')).toBe(false);
  });

  it('a sequência dispara quando os três dias são ENVIADOS', () => {
    const data: NetworkRangeData = {
      stores: [STORES[0]],
      conferences: [
        conferencia('d1', '2026-09-01', 'SUBMITTED'),
        conferencia('d2', '2026-09-02', 'SUBMITTED'),
        conferencia('d3', '2026-09-03', 'SUBMITTED'),
      ],
      items: [
        item('d1', '2026-09-01', 1),
        item('d2', '2026-09-02', 1),
        item('d3', '2026-09-03', 1),
      ],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    expect(resultado.storeAttention.some((a) => a.rule === 'CONSECUTIVE_DAYS')).toBe(true);
  });

  it('a alta forte compara oficial contra oficial', () => {
    const data: NetworkRangeData = {
      stores: [STORES[0]],
      conferences: [
        conferencia('atual', '2026-09-02', 'SUBMITTED'),
        conferencia('ant', '2026-08-28', 'SUBMITTED'),
        conferencia('ant-draft', '2026-08-29', 'DRAFT'),
      ],
      items: [
        item('atual', '2026-09-02', 10),
        item('ant', '2026-08-28', 4),
        // Se este rascunho entrasse, a base viraria 100 e não haveria alta.
        item('ant-draft', '2026-08-29', 96),
      ],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    const alta = resultado.storeAttention.find((a) => a.rule === 'SHARP_INCREASE');
    expect(alta?.message).toContain('4 → 10 faltas');
  });
});

// TESTES 13, 14, 15 e 16
describe('Zero de verdade x ausência de informação', () => {
  it('13. dia sem SUBMITTED é "sem dados", não zero confirmado', () => {
    const dia2 = A.daily.find((p) => p.date === '2026-09-02')!;
    // Existe conferência nesse dia — mas em rascunho.
    expect(dia2.submitted).toBe(0);
    expect(dia2.state).toBe('NO_DATA');
    expect(dia2.coverage).toBe(0);
    // O zero de faltas aqui significa "não sabemos", e o estado diz isso.
    expect(dia2.absences).toBe(0);
  });

  it('14. dia com SUBMITTED e 0 faltas é zero VERDADEIRO', () => {
    const data: NetworkRangeData = {
      stores: [STORES[0]],
      conferences: [conferencia('z', '2026-09-01', 'SUBMITTED')],
      items: [item('z', '2026-09-01', 0)],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    const dia1 = resultado.daily.find((p) => p.date === '2026-09-01')!;

    expect(dia1.absences).toBe(0);
    expect(dia1.submitted).toBe(1);
    expect(dia1.expected).toBe(1);
    expect(dia1.state).toBe('COMPLETE');
    expect(dia1.coverage).toBe(1);
  });

  it('15. cobertura parcial é identificada', () => {
    // 2 lojas, só uma enviou naquele dia.
    const data: NetworkRangeData = {
      stores: STORES,
      conferences: [conferencia('p', '2026-09-01', 'SUBMITTED', 'store-124')],
      items: [item('p', '2026-09-01', 4)],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    const dia1 = resultado.daily.find((p) => p.date === '2026-09-01')!;

    expect(dia1.state).toBe('PARTIAL');
    expect(dia1.submitted).toBe(1);
    expect(dia1.expected).toBe(2);
    expect(dia1.coverage).toBe(0.5);
  });

  it('16. cobertura 100% é identificada', () => {
    const data: NetworkRangeData = {
      stores: STORES,
      conferences: [
        conferencia('a', '2026-09-01', 'SUBMITTED', 'store-124'),
        conferencia('b', '2026-09-01', 'SUBMITTED', 'store-200'),
      ],
      items: [item('a', '2026-09-01', 1)],
      reasons: [],
    };

    const resultado = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    const dia1 = resultado.daily.find((p) => p.date === '2026-09-01')!;

    expect(dia1.state).toBe('COMPLETE');
    expect(dia1.coverage).toBe(1);
  });

  it('a regra dos três estados, isolada', () => {
    expect(dayCoverageState(0, 5)).toBe('NO_DATA');
    expect(dayCoverageState(2, 5)).toBe('PARTIAL');
    expect(dayCoverageState(5, 5)).toBe('COMPLETE');
    // Sem loja nenhuma não há o que esperar.
    expect(dayCoverageState(0, 0)).toBe('NO_DATA');
    // Defensivo: mais enviadas que esperadas é cobertura cheia, não parcial.
    expect(dayCoverageState(6, 5)).toBe('COMPLETE');
  });

  it('todo dia do período continua virando um ponto, com o estado certo', () => {
    expect(A.daily).toHaveLength(5);

    // 01/09: a PARQUE enviou, a CENTRO não -> parcial (1 de 2 lojas).
    // 02 e 03: existe conferência, mas em rascunho/reaberta -> sem dado.
    // 04 e 05: ninguém abriu conferência -> sem dado.
    expect(A.daily.map((p) => p.state)).toEqual([
      'PARTIAL',
      'NO_DATA',
      'NO_DATA',
      'NO_DATA',
      'NO_DATA',
    ]);
    expect(A.daily.map((p) => p.submitted)).toEqual([1, 0, 0, 0, 0]);
    expect(A.daily.every((p) => p.expected === 2)).toBe(true);
  });
});

// TESTES 17 e 18
describe('Filtro de loja muda o denominador do dia', () => {
  const data: NetworkRangeData = {
    stores: STORES,
    conferences: [conferencia('a', '2026-09-01', 'SUBMITTED', 'store-124')],
    items: [item('a', '2026-09-01', 2)],
    reasons: [],
  };

  it('18. rede usa expected = quantidade de lojas', () => {
    const rede = buildNetworkAnalytics(data, PERIOD, SEM_FILTRO);
    const dia1 = rede.daily.find((p) => p.date === '2026-09-01')!;

    expect(dia1.expected).toBe(2);
    expect(dia1.state).toBe('PARTIAL');
  });

  it('17. uma loja selecionada usa expected = 1', () => {
    const umaLoja = buildNetworkAnalytics(data, PERIOD, {
      districtId: null,
      storeId: 'store-124',
      functionGroup: null,
    });
    const dia1 = umaLoja.daily.find((p) => p.date === '2026-09-01')!;

    // Com a PARQUE selecionada, ela enviou: o dia está COMPLETO para ela.
    expect(dia1.expected).toBe(1);
    expect(dia1.state).toBe('COMPLETE');
    expect(dia1.coverage).toBe(1);
  });

  it('a loja que NÃO enviou fica sem dados quando selecionada', () => {
    const outraLoja = buildNetworkAnalytics(data, PERIOD, {
      districtId: null,
      storeId: 'store-200',
      functionGroup: null,
    });
    const dia1 = outraLoja.daily.find((p) => p.date === '2026-09-01')!;

    expect(dia1.expected).toBe(1);
    expect(dia1.submitted).toBe(0);
    expect(dia1.state).toBe('NO_DATA');
  });

  it('o drawer de uma loja usa expected = 1 por dia', () => {
    const analise = buildStoreAnalysis(data, PERIOD, 'store-124', SEM_FILTRO)!;
    expect(analise.daily.every((p) => p.expected === 1)).toBe(true);
    expect(analise.daily.find((p) => p.date === '2026-09-01')?.state).toBe('COMPLETE');
  });
});

// TESTE 19
describe('19. Modo demonstração segue a mesma regra', () => {
  function conferenciaLocal(
    id: string,
    referenceDate: string,
    status: DailyConference['status'],
    absences: number,
  ): DailyConference {
    return {
      id,
      storeId: 'store-124',
      referenceDate,
      status,
      createdBy: 'demo',
      submittedBy: status === 'SUBMITTED' ? 'demo' : null,
      createdAt: `${referenceDate}T09:00:00Z`,
      updatedAt: `${referenceDate}T09:00:00Z`,
      submittedAt: status === 'SUBMITTED' ? `${referenceDate}T11:00:00Z` : null,
      items: [
        {
          id: `${id}-item`,
          positionId: 'pos-operador-de-caixa',
          absenceQuantity: absences,
          dayOffQuantity: 0,
          observation: null,
          reasons: [
            {
              id: `${id}-reason`,
              reasonId: 'reason-atestado-medico',
              quantity: absences,
              observation: null,
            },
          ],
        },
      ],
    };
  }

  it('o LocalStorageAdapter não devolve itens de rascunho', async () => {
    const store = new MemoryStore();
    store.setItem(
      'hiperideal.quadro.conferences.v1',
      JSON.stringify({
        'store-124::2026-09-01': conferenciaLocal('a', '2026-09-01', 'SUBMITTED', 3),
        'store-124::2026-09-02': conferenciaLocal('b', '2026-09-02', 'DRAFT', 10),
      }),
    );

    const adapter = new LocalStorageAdapter(store);
    const dados = await adapter.getNetworkRange({
      start: '2026-09-01',
      end: '2026-09-05',
      comparisonStart: '2026-08-27',
    });

    // As duas conferências aparecem (a cobertura precisa delas)...
    expect(dados.conferences).toHaveLength(2);
    // ...mas só os itens e motivos da ENVIADA.
    expect(dados.items).toHaveLength(1);
    expect(dados.items[0].absenceQuantity).toBe(3);
    expect(dados.reasons).toHaveLength(1);
    expect(dados.reasons[0].reasonQuantity).toBe(3);
  });

  it('o total do demo bate com o oficial', async () => {
    const store = new MemoryStore();
    store.setItem(
      'hiperideal.quadro.conferences.v1',
      JSON.stringify({
        'store-124::2026-09-01': conferenciaLocal('a', '2026-09-01', 'SUBMITTED', 3),
        'store-124::2026-09-02': conferenciaLocal('b', '2026-09-02', 'DRAFT', 10),
      }),
    );

    const dados = await new LocalStorageAdapter(store).getNetworkRange({
      start: '2026-09-01',
      end: '2026-09-05',
      comparisonStart: '2026-08-27',
    });
    const resultado = buildNetworkAnalytics(
      { ...dados, stores: [STORES[0]] },
      PERIOD,
      SEM_FILTRO,
    );

    expect(resultado.headline.totalAbsences).toBe(3);
    expect(resultado.headline.coverage.submitted).toBe(1);
    expect(resultado.headline.coverage.inProgress).toBe(1);
  });
});

// TESTE 20
describe('20. CAMADA A — o SupabaseAdapter filtra status na consulta', () => {
  const adapter = readFileSync('src/services/storage/SupabaseAdapter.ts', 'utf8');

  it('as duas views são consultadas com status = SUBMITTED', () => {
    const trecho = adapter.slice(adapter.indexOf('async getNetworkRange'));

    const itens = trecho.slice(trecho.indexOf('quadro_v_conference_items'));
    expect(itens.slice(0, 260)).toContain("eq('status', OFFICIAL_STATUS)");

    const motivos = trecho.slice(trecho.indexOf('quadro_v_conference_item_reasons'));
    expect(motivos.slice(0, 260)).toContain("eq('status', OFFICIAL_STATUS)");
  });

  it('o status oficial é SUBMITTED, e só ele', () => {
    expect(adapter).toContain("const OFFICIAL_STATUS = 'SUBMITTED'");
  });

  it('a consulta de conferências NÃO filtra status — a cobertura precisa das outras', () => {
    const trecho = adapter.slice(adapter.indexOf('async getNetworkRange'));
    const conferencias = trecho.slice(
      trecho.indexOf("from('quadro_daily_conferences')"),
      trecho.indexOf('quadro_v_conference_items'),
    );
    expect(conferencias).not.toContain("eq('status'");
  });
});

// TESTE 21
describe('21. CAMADA B — o domínio segura mesmo com adaptador furado', () => {
  /**
   * Simula um adaptador que ESQUECEU o filtro: devolve as linhas de DRAFT e
   * REOPENED. É exatamente o estado anterior à correção — e o estado de
   * qualquer adaptador novo que venha a errar.
   */
  it('itens de conferência não enviada são descartados no domínio', () => {
    // DATA já é esse cenário: 3 linhas de item, só uma é de conferência enviada.
    expect(DATA.items).toHaveLength(3);
    expect(A.headline.totalAbsences).toBe(3);
  });

  it('motivos de conferência não enviada também', () => {
    expect(DATA.reasons).toHaveLength(3);
    expect(A.reasons).toHaveLength(1);
  });

  it('item órfão, sem conferência nenhuma, não entra', () => {
    const orfao: NetworkRangeData = {
      stores: [STORES[0]],
      conferences: [],
      items: [item('fantasma', '2026-09-01', 99)],
      reasons: [motivo('fantasma', '2026-09-01', 'reason-outros', 'Outros', 99)],
    };

    const resultado = buildNetworkAnalytics(orfao, PERIOD, SEM_FILTRO);
    expect(resultado.headline.totalAbsences).toBe(0);
    expect(resultado.reasons).toEqual([]);
  });
});

// TESTES 22 e 23
describe('isEmpty e cobertura', () => {
  it('22. sem nenhum SUBMITTED, isEmpty analítico = true', () => {
    const soRascunho = buildNetworkAnalytics(
      {
        stores: STORES,
        conferences: [RASCUNHO_10, REABERTA_5],
        items: [DATA.items[1], DATA.items[2]],
        reasons: [DATA.reasons[1], DATA.reasons[2]],
      },
      PERIOD,
      SEM_FILTRO,
    );

    expect(soRascunho.isEmpty).toBe(true);
    expect(soRascunho.headline.totalAbsences).toBe(0);
  });

  it('com pelo menos um SUBMITTED, isEmpty = false', () => {
    expect(A.isEmpty).toBe(false);
  });

  it('23. DRAFT continua contando como pendência na cobertura', () => {
    const cobertura = A.headline.coverage;

    // 2 lojas × 5 dias = 10 esperadas; 1 enviada.
    expect(cobertura.expected).toBe(10);
    expect(cobertura.submitted).toBe(1);
    expect(cobertura.pending).toBe(9);
    // As duas não enviadas ficam contadas à parte, para a tela poder dizer
    // "2 em preenchimento" em vez de deixar parecer que ninguém começou.
    expect(cobertura.inProgress).toBe(2);
  });

  it('a pendência de conferência continua virando atenção', () => {
    const pendencias = A.storeAttention.filter((a) => a.rule === 'PENDING_CONFERENCES');
    expect(pendencias.length).toBeGreaterThan(0);
  });
});

// TESTE 24
describe('24. Nada de NaN ou Infinity depois da correção', () => {
  it('nenhum número do resultado é não-finito', () => {
    const cenarios = [
      A,
      buildNetworkAnalytics(
        { stores: [], conferences: [], items: [], reasons: [] },
        PERIOD,
        SEM_FILTRO,
      ),
      buildNetworkAnalytics(
        { stores: STORES, conferences: [RASCUNHO_10], items: [DATA.items[1]], reasons: [] },
        PERIOD,
        SEM_FILTRO,
      ),
    ];

    for (const cenario of cenarios) {
      const numeros: number[] = [];
      JSON.stringify(cenario, (_chave, valor) => {
        if (typeof valor === 'number') numeros.push(valor);
        return valor;
      });
      expect(numeros.every((n) => Number.isFinite(n))).toBe(true);
    }
  });

  it('cobertura de dia com zero lojas não vira NaN', () => {
    const semLoja = buildDailySeries(
      { start: '2026-09-01', end: '2026-09-02' },
      [],
      [],
      0,
    );
    expect(semLoja.every((p) => p.coverage === null)).toBe(true);
    expect(semLoja.every((p) => p.state === 'NO_DATA')).toBe(true);
  });
});
