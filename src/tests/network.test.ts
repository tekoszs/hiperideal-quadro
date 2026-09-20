import { describe, expect, it } from 'vitest';
import type {
  NetworkConferenceRow,
  NetworkDayData,
  NetworkItemRow,
  NetworkReasonRow,
} from '@/types/network';
import {
  applyNetworkFilter,
  buildNetworkDetail,
  buildNetworkRows,
  reasonTotals,
  scopeDetailItems,
  searchNetworkRows,
  selectNetworkRows,
  sortNetworkRows,
  summarizeNetworkDay,
  totalsFromItems,
} from '@/domain/network';

/**
 * FASE 3A — regras da área Conferências do supervisor.
 *
 * Cenário usado em quase todos os testes, montado para exercitar de uma vez as
 * três situações que importam:
 *
 *   PARQUE SHOPPING  ENVIADA    3 faltas / 6 folgas / 2 funções  (3 faltas em 2 motivos)
 *   CENTRO           ENVIADA    0 faltas / 2 folgas / 1 função
 *   ORLA             rascunho   1 falta
 *   BAIRRO NOVO      sem conferência -> PENDENTE
 */

const REFERENCE_DATE = '2026-09-05';

const STORES = [
  { id: 'store-124', code: '124', name: 'PARQUE SHOPPING', districtId: 'district-1' },
  { id: 'store-200', code: '200', name: 'CENTRO', districtId: 'district-2' },
  { id: 'store-300', code: '300', name: 'ORLA', districtId: 'district-1' },
  { id: 'store-400', code: '400', name: 'BAIRRO NOVO', districtId: 'district-2' },
];

const CONF_PARQUE = 'conf-parque';
const CONF_CENTRO = 'conf-centro';
const CONF_ORLA = 'conf-orla';

const CONFERENCES: NetworkConferenceRow[] = [
  {
    id: CONF_PARQUE,
    storeId: 'store-124',
    referenceDate: REFERENCE_DATE,
    status: 'SUBMITTED',
    submittedAt: '2026-09-06T11:42:00.000Z',
    submittedBy: 'user-gerente-124',
    submittedByName: 'Ana Gerente',
    updatedAt: '2026-09-06T11:42:00.000Z',
  },
  {
    id: CONF_CENTRO,
    storeId: 'store-200',
    referenceDate: REFERENCE_DATE,
    status: 'SUBMITTED',
    submittedAt: '2026-09-06T12:10:00.000Z',
    submittedBy: 'user-gerente-200',
    submittedByName: 'Bruno Gerente',
    updatedAt: '2026-09-06T12:10:00.000Z',
  },
  {
    id: CONF_ORLA,
    storeId: 'store-300',
    referenceDate: REFERENCE_DATE,
    status: 'DRAFT',
    submittedAt: null,
    submittedBy: null,
    submittedByName: null,
    updatedAt: '2026-09-06T09:00:00.000Z',
  },
];

function item(over: Partial<NetworkItemRow> & { conferenceId: string; positionId: string }): NetworkItemRow {
  return {
    storeId: 'store-124',
    positionName: over.positionId,
    functionGroup: over.positionId,
    sector: null,
    absenceQuantity: 0,
    dayOffQuantity: 0,
    observation: null,
    ...over,
  };
}

const ITEMS: NetworkItemRow[] = [
  // PARQUE SHOPPING — 3 faltas e 6 folgas em 2 funções com ocorrência.
  item({
    conferenceId: CONF_PARQUE,
    positionId: 'pos-padaria',
    positionName: 'ATENDENTE ALIMENTOS - PADARIA',
    functionGroup: 'ATENDENTE ALIMENTOS',
    sector: 'PADARIA',
    absenceQuantity: 1,
    dayOffQuantity: 0,
    observation: 'Associada apresentou atestado.',
  }),
  item({
    conferenceId: CONF_PARQUE,
    positionId: 'pos-caixa',
    positionName: 'OPERADOR DE CAIXA',
    functionGroup: 'OPERADOR DE CAIXA',
    absenceQuantity: 2,
    dayOffQuantity: 6,
  }),
  // Função sem ocorrência: entra no quadro, não conta como impactada.
  item({
    conferenceId: CONF_PARQUE,
    positionId: 'pos-acougueiro',
    positionName: 'ACOUGUEIRO',
    functionGroup: 'ACOUGUEIRO',
  }),
  // CENTRO — só folga.
  item({
    conferenceId: CONF_CENTRO,
    storeId: 'store-200',
    positionId: 'pos-caixa',
    positionName: 'OPERADOR DE CAIXA',
    dayOffQuantity: 2,
  }),
  // ORLA — rascunho com 1 falta.
  item({
    conferenceId: CONF_ORLA,
    storeId: 'store-300',
    positionId: 'pos-padeiro',
    positionName: 'PADEIRO',
    absenceQuantity: 1,
  }),
];

/**
 * 3 faltas da PARQUE distribuídas em 2 motivos — e o OPERADOR DE CAIXA com
 * 2 faltas em 2 motivos diferentes. É exatamente o cenário que a view antiga
 * multiplicava.
 */
const REASONS: NetworkReasonRow[] = [
  {
    conferenceId: CONF_PARQUE,
    positionId: 'pos-padaria',
    reasonId: 'reason-atestado-medico',
    reasonName: 'Atestado médico',
    reasonQuantity: 1,
    observation: null,
  },
  {
    conferenceId: CONF_PARQUE,
    positionId: 'pos-caixa',
    reasonId: 'reason-atestado-medico',
    reasonName: 'Atestado médico',
    reasonQuantity: 1,
    observation: null,
  },
  {
    conferenceId: CONF_PARQUE,
    positionId: 'pos-caixa',
    reasonId: 'reason-falta-injustificada',
    reasonName: 'Falta injustificada',
    reasonQuantity: 1,
    observation: null,
  },
  {
    conferenceId: CONF_ORLA,
    positionId: 'pos-padeiro',
    reasonId: 'reason-outros',
    reasonName: 'Outros',
    reasonQuantity: 1,
    observation: 'Convocação judicial',
  },
];

const DAY: NetworkDayData = {
  stores: STORES,
  conferences: CONFERENCES,
  items: ITEMS,
  reasons: REASONS,
};

const rows = buildNetworkRows(DAY);
const rowOf = (storeId: string) => rows.find((row) => row.storeId === storeId)!;

// TESTE 1
describe('Conferência enviada aparece', () => {
  it('a loja com conferência SUBMITTED entra como Enviada', () => {
    const parque = rowOf('store-124');
    expect(parque.status).toBe('SUBMITTED');
    expect(parque.conferenceId).toBe(CONF_PARQUE);
    expect(parque.storeName).toBe('PARQUE SHOPPING');
  });

  it('rascunho não vira "enviada"', () => {
    expect(rowOf('store-300').status).toBe('DRAFT');
    expect(rowOf('store-300').submittedAt).toBeNull();
  });
});

// TESTE 2
describe('Loja sem conferência aparece PENDENTE', () => {
  it('a lista parte de quadro_stores, não das conferências', () => {
    // 4 lojas cadastradas, só 3 com conferência: as 4 aparecem.
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.storeId).sort()).toEqual([
      'store-124',
      'store-200',
      'store-300',
      'store-400',
    ]);
  });

  it('a loja sem conferência fica PENDING, com tudo zerado e sem conferenceId', () => {
    const bairro = rowOf('store-400');
    expect(bairro.status).toBe('PENDING');
    expect(bairro.conferenceId).toBeNull();
    expect(bairro.totalAbsences).toBe(0);
    expect(bairro.totalDayOffs).toBe(0);
    expect(bairro.submittedAt).toBeNull();
  });

  it('sem nenhuma conferência, TODAS as lojas ficam pendentes', () => {
    const vazio = buildNetworkRows({ ...DAY, conferences: [], items: [], reasons: [] });
    expect(vazio).toHaveLength(4);
    expect(vazio.every((row) => row.status === 'PENDING')).toBe(true);
    expect(summarizeNetworkDay(vazio).pending).toBe(4);
  });
});

// TESTE 3 e 4
describe('Somas de faltas e folgas', () => {
  it('faltas são somadas corretamente por loja', () => {
    expect(rowOf('store-124').totalAbsences).toBe(3); // 1 + 2
    expect(rowOf('store-200').totalAbsences).toBe(0);
    expect(rowOf('store-300').totalAbsences).toBe(1);
  });

  it('folgas são somadas corretamente por loja', () => {
    expect(rowOf('store-124').totalDayOffs).toBe(6);
    expect(rowOf('store-200').totalDayOffs).toBe(2);
  });

  it('funções impactadas contam falta OU folga, uma vez cada', () => {
    // PADARIA (1 falta) + CAIXA (2 faltas e 6 folgas) = 2. ACOUGUEIRO zerado fica fora.
    expect(rowOf('store-124').impactedPositions).toBe(2);
    expect(rowOf('store-200').impactedPositions).toBe(1);
  });

  it('os cards do topo somam a rede inteira', () => {
    const resumo = summarizeNetworkDay(rows);
    expect(resumo).toEqual({
      stores: 4,
      submitted: 2,
      pending: 2, // BAIRRO NOVO (sem conferência) + ORLA (rascunho)
      totalAbsences: 4, // 3 + 0 + 1
      totalDayOffs: 8, // 6 + 2
    });
  });

  it('o número de lojas é o de quadro_stores — nada é inventado', () => {
    expect(summarizeNetworkDay(rows).stores).toBe(STORES.length);
  });
});

// TESTE 5 — REGRESSÃO da duplicação
describe('Múltiplos motivos NÃO duplicam faltas', () => {
  it('3 faltas em 2 motivos continuam sendo 3 faltas', () => {
    const parque = rowOf('store-124');
    const motivosDaParque = REASONS.filter((r) => r.conferenceId === CONF_PARQUE);

    // A view de motivos tem 3 linhas para a PARQUE (a função CAIXA aparece 2x).
    expect(motivosDaParque).toHaveLength(3);
    // Ainda assim o total de faltas é 3, e não 6.
    expect(parque.totalAbsences).toBe(3);
  });

  it('a função com 2 motivos aparece uma vez só na contagem de impactadas', () => {
    // OPERADOR DE CAIXA tem 2 motivos; conta como 1 função impactada.
    expect(rowOf('store-124').impactedPositions).toBe(2);
  });

  it('a soma dos motivos fecha com as faltas (as duas fontes batem)', () => {
    const itensDaParque = ITEMS.filter((i) => i.conferenceId === CONF_PARQUE);
    const motivosDaParque = REASONS.filter((r) => r.conferenceId === CONF_PARQUE);

    const faltas = totalsFromItems(itensDaParque).totalAbsences;
    const porMotivo = [...reasonTotals(motivosDaParque).values()].reduce((a, b) => a + b, 0);

    expect(faltas).toBe(3);
    expect(porMotivo).toBe(3);
  });

  it('a distribuição por motivo usa reason_quantity', () => {
    const distribuicao = reasonTotals(REASONS.filter((r) => r.conferenceId === CONF_PARQUE));
    expect(distribuicao.get('reason-atestado-medico')).toBe(2); // padaria + caixa
    expect(distribuicao.get('reason-falta-injustificada')).toBe(1);
  });

  it('a view de motivos nem carrega absence_quantity — a regra é do tipo', () => {
    // Guarda de documentação: se alguém adicionar o campo em NetworkReasonRow,
    // este teste continua passando, mas o de cima quebra assim que a soma for
    // feita pela fonte errada. Aqui só provamos que o dado não vem junto.
    for (const reason of REASONS) {
      expect(Object.keys(reason)).not.toContain('absenceQuantity');
      expect(Object.keys(reason)).not.toContain('absence_quantity');
    }
  });
});

// TESTE 6, 7 e 8
describe('Detalhamento da loja', () => {
  const detalhe = buildNetworkDetail(DAY, 'store-124', REFERENCE_DATE)!;

  it('traz o cabeçalho com loja, data, status e horário', () => {
    expect(detalhe.storeName).toBe('PARQUE SHOPPING');
    expect(detalhe.referenceDate).toBe(REFERENCE_DATE);
    expect(detalhe.status).toBe('SUBMITTED');
    expect(detalhe.submittedAt).toBe('2026-09-06T11:42:00.000Z');
  });

  it('o resumo do detalhe bate com a linha da lista', () => {
    expect(detalhe.totalAbsences).toBe(3);
    expect(detalhe.totalDayOffs).toBe(6);
    expect(detalhe.impactedPositions).toBe(2);
  });

  // TESTE 8
  it('mostra o responsável vindo de quadro_profiles pelo submitted_by', () => {
    expect(detalhe.submittedByName).toBe('Ana Gerente');
    // E é o gerente CERTO: cada loja tem o seu.
    expect(buildNetworkDetail(DAY, 'store-200', REFERENCE_DATE)?.submittedByName).toBe(
      'Bruno Gerente',
    );
  });

  it('sem envio, não há responsável — e nada é inventado', () => {
    expect(buildNetworkDetail(DAY, 'store-300', REFERENCE_DATE)?.submittedByName).toBeNull();
    expect(buildNetworkDetail(DAY, 'store-400', REFERENCE_DATE)?.submittedByName).toBeNull();
  });

  // TESTE 6
  it('mostra TODOS os motivos de cada função', () => {
    const caixa = detalhe.items.find((i) => i.positionId === 'pos-caixa')!;
    expect(caixa.reasons).toHaveLength(2);
    expect(caixa.reasons.map((r) => r.reasonName).sort()).toEqual([
      'Atestado médico',
      'Falta injustificada',
    ]);
    // A soma dos motivos da função fecha com as faltas DELA.
    expect(caixa.reasons.reduce((total, r) => total + r.quantity, 0)).toBe(
      caixa.absenceQuantity,
    );
  });

  // TESTE 7
  it('mostra a observação da função', () => {
    const padaria = detalhe.items.find((i) => i.positionId === 'pos-padaria')!;
    expect(padaria.observation).toBe('Associada apresentou atestado.');

    const caixa = detalhe.items.find((i) => i.positionId === 'pos-caixa')!;
    expect(caixa.observation).toBeNull(); // a tela mostra "Sem observação."
  });

  it('mostra a observação do motivo quando existe', () => {
    const orla = buildNetworkDetail(DAY, 'store-300', REFERENCE_DATE)!;
    const padeiro = orla.items.find((i) => i.positionId === 'pos-padeiro')!;
    expect(padeiro.reasons[0]).toMatchObject({
      reasonName: 'Outros',
      observation: 'Convocação judicial',
    });
  });

  it('alterna entre Ocorrências e Todas as funções', () => {
    // O quadro da PARQUE tem 3 funções; só 2 tiveram ocorrência.
    expect(scopeDetailItems(detalhe.items, 'ALL')).toHaveLength(3);
    expect(scopeDetailItems(detalhe.items, 'OCCURRENCES')).toHaveLength(2);
    expect(
      scopeDetailItems(detalhe.items, 'OCCURRENCES').map((i) => i.positionId).sort(),
    ).toEqual(['pos-caixa', 'pos-padaria']);
  });

  it('loja sem conferência abre o detalhe vazio, sem erro', () => {
    const bairro = buildNetworkDetail(DAY, 'store-400', REFERENCE_DATE)!;
    expect(bairro.status).toBe('PENDING');
    expect(bairro.items).toEqual([]);
    expect(bairro.totalAbsences).toBe(0);
  });

  it('loja inexistente devolve null em vez de estourar', () => {
    expect(buildNetworkDetail(DAY, 'store-inexistente', REFERENCE_DATE)).toBeNull();
  });
});

// TESTES 9, 10 e 11
describe('Filtros', () => {
  it('Enviadas mostra só quem enviou', () => {
    const enviadas = applyNetworkFilter(rows, 'SUBMITTED');
    expect(enviadas.map((r) => r.storeName).sort()).toEqual(['CENTRO', 'PARQUE SHOPPING']);
  });

  it('Pendentes mostra quem NÃO enviou — inclusive rascunho', () => {
    const pendentes = applyNetworkFilter(rows, 'PENDING');
    expect(pendentes.map((r) => r.storeName).sort()).toEqual(['BAIRRO NOVO', 'ORLA']);
  });

  it('Com faltas mostra só quem tem falta', () => {
    const comFaltas = applyNetworkFilter(rows, 'WITH_ABSENCES');
    expect(comFaltas.map((r) => r.storeName).sort()).toEqual(['ORLA', 'PARQUE SHOPPING']);
    expect(comFaltas.every((r) => r.totalAbsences > 0)).toBe(true);
  });

  it('Sem faltas é o complemento exato de Com faltas', () => {
    const semFaltas = applyNetworkFilter(rows, 'NO_ABSENCES');
    expect(semFaltas.map((r) => r.storeName).sort()).toEqual(['BAIRRO NOVO', 'CENTRO']);
    expect(
      applyNetworkFilter(rows, 'WITH_ABSENCES').length + semFaltas.length,
    ).toBe(rows.length);
  });

  it('Todos não filtra nada', () => {
    expect(applyNetworkFilter(rows, 'ALL')).toHaveLength(4);
  });
});

// TESTE 12
describe('Busca por loja', () => {
  it('encontra pelo nome', () => {
    expect(searchNetworkRows(rows, 'parque').map((r) => r.storeName)).toEqual([
      'PARQUE SHOPPING',
    ]);
  });

  it('ignora acento e maiúscula', () => {
    const comAcento = buildNetworkRows({
      ...DAY,
      stores: [{ id: 'store-900', code: '900', name: 'AVENIDA SÃO JOÃO', districtId: 'district-1' }],
      conferences: [],
    });
    expect(searchNetworkRows(comAcento, 'sao joao')).toHaveLength(1);
    expect(searchNetworkRows(comAcento, 'SÃO')).toHaveLength(1);
  });

  it('encontra pelo código da loja', () => {
    expect(searchNetworkRows(rows, '124').map((r) => r.storeName)).toEqual([
      'PARQUE SHOPPING',
    ]);
  });

  it('busca vazia devolve tudo', () => {
    expect(searchNetworkRows(rows, '   ')).toHaveLength(4);
  });

  it('busca sem resultado devolve lista vazia', () => {
    expect(searchNetworkRows(rows, 'loja que nao existe')).toHaveLength(0);
  });
});

describe('Ordenação: primeiro o que exige atenção', () => {
  it('pendentes vêm antes, depois maior número de faltas', () => {
    expect(sortNetworkRows(rows).map((r) => r.storeName)).toEqual([
      'BAIRRO NOVO', // PENDENTE (sem conferência)
      'ORLA', // rascunho
      'PARQUE SHOPPING', // enviada com 3 faltas
      'CENTRO', // enviada sem falta
    ]);
  });

  it('entre enviadas, quem tem mais faltas aparece primeiro', () => {
    const enviadas = sortNetworkRows(applyNetworkFilter(rows, 'SUBMITTED'));
    expect(enviadas.map((r) => r.totalAbsences)).toEqual([3, 0]);
  });

  it('empate é desempatado por nome, para a lista não dançar', () => {
    const base = buildNetworkRows({
      stores: [
        { id: 's-b', code: '2', name: 'BETA', districtId: 'district-1' },
        { id: 's-a', code: '1', name: 'ALFA', districtId: 'district-1' },
      ],
      conferences: [],
      items: [],
      reasons: [],
    });
    expect(sortNetworkRows(base).map((r) => r.storeName)).toEqual(['ALFA', 'BETA']);
  });

  it('não modifica o array original', () => {
    const antes = rows.map((r) => r.storeId);
    sortNetworkRows(rows);
    expect(rows.map((r) => r.storeId)).toEqual(antes);
  });

  it('selectNetworkRows aplica filtro, busca e ordem juntos', () => {
    const resultado = selectNetworkRows(rows, { filter: 'WITH_ABSENCES', search: 'o' });
    // ORLA e PARQUE SHOPPING têm falta e contêm "o"; ORLA (rascunho) vem antes.
    expect(resultado.map((r) => r.storeName)).toEqual(['ORLA', 'PARQUE SHOPPING']);
  });
});
