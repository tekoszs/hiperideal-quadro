// @vitest-environment jsdom
/**
 * FASE 4.2 — O DETALHE POR FUNÇÃO, GRUPO E SETOR.
 *
 * A rede de teste é pequena e os números são escolhidos para serem conferidos
 * na mão. O caso que mais importa é a PADARIA:
 *
 *   307 LEPARC   3 faltas em 2 dias (a última em D-2)  -- 2 motivos no mesmo dia
 *   124 PQSHOP   2 faltas em 1 dia  (D-3)
 *   311 PANAMBY  1 falta  em 1 dia  (D-4)  -- SEM motivo registrado
 *   -------------------------------------------------
 *   total        6 faltas em 3 lojas, mas só 5 em motivos
 *
 * As 3 faltas da LEPARC num único dia estão divididas em DOIS motivos. Se
 * alguém somar faltas a partir da view de motivos, o total vira 9 — e é
 * exatamente isso que o teste 9 vigia.
 *
 * Há também uma conferência em RASCUNHO com 50 faltas na padaria. Ela não pode
 * aparecer em número nenhum: se aparecer, o total salta para 56.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DailyConference } from '@/types/domain';
import type {
  NetworkRangeData,
  RangeConferenceRow,
  RangeItemRow,
  RangeReasonRow,
} from '@/types/analytics';
import type { NetworkStoreRef } from '@/types/network';
import type { SessionProfile } from '@/types/auth';
import type { StorageAdapter } from '@/services/storage';
import { setStorageAdapter } from '@/services/storage';
import { buildFocusAnalysis, buildStoreAnalysis } from '@/domain/analytics';
import { resolvePeriod } from '@/domain/period';
import { SupervisorNetworkDashboardPage } from '@/pages/SupervisorNetworkDashboardPage';
import { getReferenceDate, shiftIsoDate } from '@/utils/date';

const D1 = getReferenceDate();
const D2 = shiftIsoDate(D1, -1);
const D3 = shiftIsoDate(D1, -2);
const D4 = shiftIsoDate(D1, -3);

const PADARIA = 'pos-atendente-alimentos-padaria';
const CAIXA = 'pos-operador-de-caixa';

const TODAS: NetworkStoreRef[] = [
  { id: 'store-307', code: '307', name: 'LEPARC', districtId: 'district-1' },
  { id: 'store-124', code: '124', name: 'PQSHOP', districtId: 'district-1' },
  { id: 'store-311', code: '311', name: 'PANAMBY', districtId: 'district-2' },
];

const DO_DISTRITO_1 = TODAS.filter((s) => s.districtId === 'district-1');
const DO_DISTRITO_2 = TODAS.filter((s) => s.districtId === 'district-2');

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

function conf(
  id: string,
  storeId: string,
  date: string,
  status: RangeConferenceRow['status'] = 'SUBMITTED',
): RangeConferenceRow {
  return {
    id,
    storeId,
    referenceDate: date,
    status,
    submittedAt: status === 'SUBMITTED' ? `${date}T11:00:00Z` : null,
  };
}

function item(
  conferenceId: string,
  storeId: string,
  date: string,
  positionId: string,
  absences: number,
  over: Partial<RangeItemRow> = {},
): RangeItemRow {
  const store = TODAS.find((s) => s.id === storeId)!;
  const nomes: Record<string, [string, string, string | null]> = {
    [PADARIA]: ['ATENDENTE ALIMENTOS - PADARIA', 'ATENDENTE ALIMENTOS', 'PADARIA'],
    [CAIXA]: ['OPERADOR DE CAIXA', 'OPERADOR DE CAIXA', null],
  };
  const [positionName, functionGroup, sector] = nomes[positionId];

  return {
    conferenceId,
    storeId,
    storeName: store.name,
    referenceDate: date,
    positionId,
    positionName,
    functionGroup,
    sector,
    absenceQuantity: absences,
    dayOffQuantity: 0,
    observation: null,
    ...over,
  };
}

function motivo(
  conferenceId: string,
  storeId: string,
  date: string,
  positionId: string,
  reasonId: string,
  reasonName: string,
  quantity: number,
  observation: string | null = null,
): RangeReasonRow {
  return {
    conferenceId,
    storeId,
    referenceDate: date,
    positionId,
    reasonId,
    reasonName,
    reasonQuantity: quantity,
    observation,
  };
}

/**
 * Período com dados. `stores` é o que a RLS teria entregue a este perfil.
 *
 * As conferências e as linhas são recortadas pelas lojas visíveis — é assim
 * que o banco se comporta, e simular diferente tornaria os testes de escopo
 * inúteis.
 */
function makeRange(stores: NetworkStoreRef[] = TODAS): NetworkRangeData {
  const visiveis = new Set(stores.map((s) => s.id));

  const conferences = [
    conf('c-307-a', 'store-307', D3),
    conf('c-307-b', 'store-307', D2),
    conf('c-124-a', 'store-124', D3),
    conf('c-311-a', 'store-311', D4),
    // RASCUNHO: 50 faltas que não podem entrar em número nenhum.
    conf('c-307-draft', 'store-307', D1, 'DRAFT'),
  ].filter((c) => visiveis.has(c.storeId));

  const items = [
    // LEPARC: 3 faltas na padaria em D-3 (divididas em 2 motivos) e 0 em D-2...
    item('c-307-a', 'store-307', D3, PADARIA, 3, { observation: 'Turno da manhã descoberto' }),
    // ...mas em D-2 a padaria volta a ter 1 falta -> 2 dias com falta.
    item('c-307-b', 'store-307', D2, PADARIA, 0),
    item('c-307-b', 'store-307', D2, CAIXA, 4),
    // PQSHOP: 2 faltas em D-3, e uma folga no caixa no mesmo dia.
    item('c-124-a', 'store-124', D3, PADARIA, 2),
    item('c-124-a', 'store-124', D3, CAIXA, 0, { dayOffQuantity: 1 }),
    // PANAMBY: 1 falta em D-4.
    item('c-311-a', 'store-311', D4, PADARIA, 1),
    // RASCUNHO — 50 faltas. Nunca deve aparecer.
    item('c-307-draft', 'store-307', D1, PADARIA, 50),
  ].filter((i) => visiveis.has(i.storeId));

  const reasons = [
    // 3 faltas, DOIS motivos: 2 + 1. Somar aqui daria 3 — e somar a view de
    // itens junto daria 6. O total tem de continuar 3 nesta loja.
    motivo('c-307-a', 'store-307', D3, PADARIA, 'reason-atestado', 'Atestado médico', 2, 'Consulta'),
    motivo('c-307-a', 'store-307', D3, PADARIA, 'reason-injustificada', 'Falta injustificada', 1),
    motivo('c-124-a', 'store-124', D3, PADARIA, 'reason-atestado', 'Atestado médico', 2),
    // A PANAMBY tem 1 falta e NENHUM motivo registrado — acontece com dado
    // antigo, anterior à regra de motivos. É o que torna este cenário capaz de
    // distinguir "somar itens" de "somar motivos": aqui os dois dão números
    // diferentes (6 faltas contra 5 motivos), e só um deles está certo.
    motivo('c-307-b', 'store-307', D2, CAIXA, 'reason-injustificada', 'Falta injustificada', 4),
    // Do rascunho — não pode entrar.
    motivo('c-307-draft', 'store-307', D1, PADARIA, 'reason-licenca', 'Licença', 50),
  ].filter((r) => visiveis.has(r.storeId));

  return { stores, conferences, items, reasons };
}

/**
 * Ajuste fino: a LEPARC precisa de 3 faltas em DOIS dias distintos para o teste
 * de "dias com falta" e "última ocorrência" ter o que medir.
 */
function makeRangeComDoisDias(stores: NetworkStoreRef[] = TODAS): NetworkRangeData {
  const base = makeRange(stores);
  return {
    ...base,
    items: base.items.map((linha) =>
      linha.conferenceId === 'c-307-b' && linha.positionId === PADARIA
        ? { ...linha, absenceQuantity: 1 }
        : linha,
    ),
    reasons: [
      ...base.reasons,
      ...(stores.some((s) => s.id === 'store-307')
        ? [motivo('c-307-b', 'store-307', D2, PADARIA, 'reason-outros', 'Outros', 1)]
        : []),
    ],
  };
}

const PERIODO = resolvePeriod('LAST_7');
const SEM_FILTRO = { districtId: null, storeId: null, functionGroup: null };

let visiveis: NetworkStoreRef[] = TODAS;
let usarDoisDias = false;

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
    getNetworkRange: async () =>
      usarDoisDias ? makeRangeComDoisDias(visiveis) : makeRange(visiveis),
  };
}

beforeEach(() => {
  visiveis = TODAS;
  usarDoisDias = false;
  setStorageAdapter(fakeAdapter());
});

afterEach(() => {
  cleanup();
  setStorageAdapter(null);
});

async function abrirDashboard(profile = perfil()) {
  render(<SupervisorNetworkDashboardPage profile={profile} onOpenConferences={() => undefined} />);
  await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toBeTruthy());
  return userEvent.setup();
}

/** O drawer aberto, seja de foco ou de loja. */
const drawer = () => screen.getByRole('dialog');

/* ======================================================================= */

describe('Detalhe da função — o drawer na tela', { timeout: 30000 }, () => {
  // TESTE 1
  it('1. clicar numa FUNÇÃO EM ATENÇÃO abre o drawer', async () => {
    const user = await abrirDashboard();

    const atencao = screen
      .getByRole('heading', { name: 'Funções em atenção' })
      .closest<HTMLElement>('.panel')!;
    const botao = within(atencao).getAllByRole('button')[0];
    const nome = botao.textContent ?? '';

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(botao);

    expect(drawer()).toBeTruthy();
    expect(within(drawer()).getByText(nome)).toBeTruthy();
  });

  // TESTE 2
  it('2. o drawer mostra o total correto — e o rascunho fica de fora', async () => {
    const user = await abrirDashboard();

    await user.click(screen.getByRole('button', { name: 'ATENDENTE ALIMENTOS - PADARIA' }));

    // 3 (LEPARC) + 2 (PQSHOP) + 1 (PANAMBY) = 6. Com o rascunho seriam 56.
    expect(totalDoDrawer('Faltas')).toBe('6');
  });

  // TESTE 3
  it('3. mostra as lojas impactadas, com contagem própria', async () => {
    const user = await abrirDashboard();
    await user.click(screen.getByRole('button', { name: 'ATENDENTE ALIMENTOS - PADARIA' }));

    expect(totalDoDrawer('Lojas impactadas')).toBe('3');

    const linhas = within(drawer()).getAllByRole('row').slice(1); // pula o cabeçalho
    expect(linhas).toHaveLength(3);
    expect(within(drawer()).getByText('LEPARC')).toBeTruthy();
    expect(within(drawer()).getByText('PQSHOP')).toBeTruthy();
    expect(within(drawer()).getByText('PANAMBY')).toBeTruthy();
  });

  // TESTE 4
  it('4. as lojas vêm ordenadas por faltas e, no empate, pela mais recente', async () => {
    const user = await abrirDashboard();
    await user.click(screen.getByRole('button', { name: 'ATENDENTE ALIMENTOS - PADARIA' }));

    const nomes = within(drawer())
      .getAllByRole('row')
      .slice(1)
      .map((linha) => within(linha).getByRole('button').textContent);

    // 3 > 2 > 1
    expect(nomes).toEqual(['307LEPARC', '124PQSHOP', '311PANAMBY']);
  });

  // TESTE 5
  it('5. mostra os motivos da função, sem misturar os de outras', async () => {
    const user = await abrirDashboard();
    await user.click(screen.getByRole('button', { name: 'ATENDENTE ALIMENTOS - PADARIA' }));

    const painel = within(drawer()).getByLabelText(/Motivos das faltas/);
    const linhas = within(painel)
      .getAllByRole('listitem')
      .map((linha) => linha.textContent ?? '');

    // Atestado 2 (LEPARC) + 2 (PQSHOP) = 4; injustificada 1; outros 1.
    // Total 6 — exatamente as faltas da padaria.
    expect(linhas.some((t) => t.includes('Atestado médico') && t.includes('4'))).toBe(true);
    expect(linhas.some((t) => t.includes('Falta injustificada') && t.includes('1'))).toBe(true);

    // As 4 faltas do CAIXA são de OUTRA função e não podem estar aqui: se
    // estivessem, "Falta injustificada" apareceria com 5.
    expect(linhas.some((t) => t.includes('Falta injustificada') && t.includes('5'))).toBe(false);
    // E o motivo do RASCUNHO não existe nesta lista.
    expect(linhas.some((t) => t.includes('Licença'))).toBe(false);
  });

  // TESTE 14
  it('14. clicar numa loja do drawer abre o detalhe daquela loja', async () => {
    const user = await abrirDashboard();
    await user.click(screen.getByRole('button', { name: 'ATENDENTE ALIMENTOS - PADARIA' }));
    await user.click(within(drawer()).getByRole('button', { name: /LEPARC/ }));

    // O drawer da loja fica por cima; o foco continua atrás.
    const abertos = screen.getAllByRole('dialog');
    expect(abertos.length).toBeGreaterThanOrEqual(1);
    const loja = abertos[abertos.length - 1];
    expect(within(loja).getByText('LEPARC')).toBeTruthy();
    // Dia a dia com motivos e observação.
    expect(within(loja).getByText('Ocorrências, dia a dia')).toBeTruthy();
    expect(within(loja).getByText('Turno da manhã descoberto')).toBeTruthy();
  });

  // TESTE 17
  it('17. em 390px o drawer não gera rolagem horizontal', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/global.css', 'utf8');

    // Em telas estreitas a tabela vira card: o cabeçalho sai e cada célula
    // carrega o próprio rótulo. Quatro colunas em 390px empurrariam a página.
    expect(css).toContain('.focus-table thead');
    expect(css).toMatch(/\.focus-table td::before\s*\{[^}]*content:\s*attr\(data-label\)/);
    // A rolagem lateral, quando existe, fica DENTRO do contêiner da tabela.
    expect(css).toMatch(/\.focus-table__scroll\s*\{[^}]*overflow-x:\s*auto/);

    const user = await abrirDashboard();
    await user.click(screen.getByRole('button', { name: 'ATENDENTE ALIMENTOS - PADARIA' }));

    // Toda célula precisa do rótulo, senão o modo card fica sem legenda.
    const celulas = within(drawer())
      .getAllByRole('cell')
      .map((c) => c.getAttribute('data-label'));
    expect(celulas.every(Boolean)).toBe(true);
  });
});

/**
 * Valor de um total do drawer pelo rótulo.
 *
 * Busca DENTRO de `.drawer__totals`: "Faltas" também é cabeçalho da tabela de
 * lojas, e procurar na tela inteira acharia os dois.
 */
function totalDoDrawer(label: string): string {
  const totais = drawer().querySelector<HTMLElement>('.drawer__totals')!;
  const bloco = within(totais).getByText(label).closest('.drawer__total')!;
  return bloco.querySelector('.drawer__total-value')!.textContent ?? '';
}

/* ======================================================================= */

describe('Detalhe da função — as contas', () => {
  // TESTE 6
  it('6. conferência em RASCUNHO não entra', () => {
    const analise = buildFocusAnalysis(makeRange(), PERIODO, SEM_FILTRO, {
      kind: 'POSITION',
      positionId: PADARIA,
    });

    expect(analise.totalAbsences).toBe(6);
    expect(analise.reasons.some((r) => r.reasonName === 'Licença')).toBe(false);
  });

  // TESTE 7
  it('7. conferência REABERTA também não entra', () => {
    const base = makeRange();
    const comReaberta: NetworkRangeData = {
      ...base,
      conferences: base.conferences.map((c) =>
        c.id === 'c-124-a' ? { ...c, status: 'REOPENED' as const, submittedAt: null } : c,
      ),
    };

    const analise = buildFocusAnalysis(comReaberta, PERIODO, SEM_FILTRO, {
      kind: 'POSITION',
      positionId: PADARIA,
    });

    // As 2 faltas da PQSHOP saem: 6 - 2 = 4, e a loja some da lista.
    expect(analise.totalAbsences).toBe(4);
    expect(analise.stores.map((s) => s.storeCode)).toEqual(['307', '311']);
  });

  // TESTE 8
  it('8. conferência ENVIADA entra', () => {
    const analise = buildFocusAnalysis(makeRange(), PERIODO, SEM_FILTRO, {
      kind: 'POSITION',
      positionId: PADARIA,
    });

    expect(analise.stores.map((s) => s.storeCode)).toEqual(['307', '124', '311']);
    expect(analise.stores.map((s) => s.absences)).toEqual([3, 2, 1]);
  });

  // TESTE 9 — a regra que atravessa o projeto inteiro.
  it('9. 3 faltas divididas em 2 motivos continuam sendo 3', () => {
    const analise = buildFocusAnalysis(makeRange(), PERIODO, SEM_FILTRO, {
      kind: 'POSITION',
      positionId: PADARIA,
    });

    const leparc = analise.stores.find((s) => s.storeCode === '307')!;
    // 3 faltas num dia, divididas em 2 motivos. Se a falta fosse contada uma
    // vez por motivo, esta loja teria 6 e o total da rede seria 9.
    expect(leparc.absences).toBe(3);

    // E o total NÃO pode sair da soma dos motivos: aqui eles somam 5 (a
    // PANAMBY não tem motivo registrado) enquanto as faltas são 6. Quem
    // contar pelos motivos perde uma falta; quem contar pela view de motivos
    // sem cuidado, dobra as outras.
    const somaDosMotivos = analise.reasons.reduce((total, r) => total + r.quantity, 0);
    expect(somaDosMotivos).toBe(5);
    expect(analise.totalAbsences).toBe(6);
  });

  // TESTE 15
  it('15. o período é respeitado', () => {
    // Um período de UM dia (D-1) só tem o rascunho — nada oficial.
    const umDia = resolvePeriod('DAY');
    const analise = buildFocusAnalysis(makeRange(), umDia, SEM_FILTRO, {
      kind: 'POSITION',
      positionId: PADARIA,
    });

    expect(analise.totalAbsences).toBe(0);
    expect(analise.stores).toEqual([]);
    expect(analise.isEmpty).toBe(true);
  });

  // TESTE 16
  it('16. o filtro de distrito é respeitado', () => {
    const soD1 = buildFocusAnalysis(
      makeRange(),
      PERIODO,
      { ...SEM_FILTRO, districtId: 'district-1' },
      { kind: 'POSITION', positionId: PADARIA },
    );

    // LEPARC 3 + PQSHOP 2 = 5. A PANAMBY (D2) fica fora.
    expect(soD1.totalAbsences).toBe(5);
    expect(soD1.stores.map((s) => s.storeCode)).toEqual(['307', '124']);
  });

  it('dias com falta e última ocorrência saem certos', () => {
    const analise = buildFocusAnalysis(makeRangeComDoisDias(), PERIODO, SEM_FILTRO, {
      kind: 'POSITION',
      positionId: PADARIA,
    });

    const leparc = analise.stores.find((s) => s.storeCode === '307')!;
    expect(leparc.absences).toBe(4); // 3 em D-3 + 1 em D-2
    expect(leparc.daysWithAbsence).toBe(2);
    expect(leparc.lastOccurrence).toBe(D2); // a MAIS RECENTE, não a primeira
  });

  it('o foco de GRUPO soma as funções do grupo e lista as funções', () => {
    const analise = buildFocusAnalysis(makeRange(), PERIODO, SEM_FILTRO, {
      kind: 'GROUP',
      functionGroup: 'ATENDENTE ALIMENTOS',
    });

    expect(analise.totalAbsences).toBe(6);
    expect(analise.positions.map((p) => p.label)).toEqual(['ATENDENTE ALIMENTOS - PADARIA']);
  });

  it('o foco de SETOR usa o setor, não o grupo', () => {
    const analise = buildFocusAnalysis(makeRange(), PERIODO, SEM_FILTRO, {
      kind: 'SECTOR',
      sector: 'PADARIA',
    });

    expect(analise.title).toBe('PADARIA');
    expect(analise.totalAbsences).toBe(6);
  });

  it('o foco de FUNÇÃO não repete a própria função como "funções dentro"', () => {
    const analise = buildFocusAnalysis(makeRange(), PERIODO, SEM_FILTRO, {
      kind: 'POSITION',
      positionId: PADARIA,
    });
    expect(analise.positions).toEqual([]);
  });
});

/* ======================================================================= */

describe('Escopo — o drawer respeita quem está olhando', () => {
  // TESTE 10
  it('10. Paulo (Distrito 1) não vê loja do Distrito 2', () => {
    // A RLS entrega a ele só as lojas do distrito dele.
    const analise = buildFocusAnalysis(
      makeRange(DO_DISTRITO_1),
      PERIODO,
      SEM_FILTRO,
      { kind: 'POSITION', positionId: PADARIA },
    );

    expect(analise.stores.map((s) => s.storeCode)).toEqual(['307', '124']);
    expect(analise.stores.some((s) => s.storeCode === '311')).toBe(false);
    expect(analise.totalAbsences).toBe(5);

    // E pedir o outro distrito no filtro não traz nada de novo — o filtro
    // recorta o que chegou, não amplia.
    const tentativa = buildFocusAnalysis(
      makeRange(DO_DISTRITO_1),
      PERIODO,
      { ...SEM_FILTRO, districtId: 'district-2' },
      { kind: 'POSITION', positionId: PADARIA },
    );
    expect(tentativa.stores).toEqual([]);
    expect(tentativa.totalAbsences).toBe(0);
  });

  // TESTE 11
  it('11. Ericson (Distrito 2) não vê loja do Distrito 1', () => {
    const analise = buildFocusAnalysis(
      makeRange(DO_DISTRITO_2),
      PERIODO,
      SEM_FILTRO,
      { kind: 'POSITION', positionId: PADARIA },
    );

    expect(analise.stores.map((s) => s.storeCode)).toEqual(['311']);
    expect(analise.totalAbsences).toBe(1);
  });

  // TESTE 12
  it('12. Roberval (rede) vê os dois distritos', () => {
    const analise = buildFocusAnalysis(makeRange(), PERIODO, SEM_FILTRO, {
      kind: 'POSITION',
      positionId: PADARIA,
    });
    expect(analise.stores.map((s) => s.storeCode).sort()).toEqual(['124', '307', '311']);
  });

  // TESTE 13
  it('13. Jackson (admin) vê os dois distritos', async () => {
    // Pela tela, com o perfil de ADMIN: o resultado tem de ser o mesmo.
    const user = await abrirDashboard(perfil({ role: 'ADMIN', jobTitle: 'Administrador' }));
    await user.click(screen.getByRole('button', { name: 'ATENDENTE ALIMENTOS - PADARIA' }));

    expect(totalDoDrawer('Lojas impactadas')).toBe('3');
    expect(within(drawer()).getByText('PANAMBY')).toBeTruthy();
  });

  it('o gerente distrital, pela tela, só enxerga as lojas dele', async () => {
    visiveis = DO_DISTRITO_1;
    const user = await abrirDashboard(
      perfil({ accessScope: 'DISTRICT', districtId: 'district-1' }),
    );

    await user.click(screen.getByRole('button', { name: 'ATENDENTE ALIMENTOS - PADARIA' }));

    expect(totalDoDrawer('Faltas')).toBe('5');
    expect(totalDoDrawer('Lojas impactadas')).toBe('2');
    expect(within(drawer()).queryByText('PANAMBY')).toBeNull();
  });
});

/* ======================================================================= */

describe('Detalhe da loja aberto pela função', () => {
  it('mostra datas, quantidades, motivos e observações', () => {
    const analise = buildStoreAnalysis(
      makeRangeComDoisDias(),
      PERIODO,
      'store-307',
      SEM_FILTRO,
      PADARIA,
    )!;

    expect(analise.days.map((d) => d.date)).toEqual([D2, D3]); // mais recente primeiro

    const dia3 = analise.days.find((d) => d.date === D3)!;
    const padaria = dia3.occurrences.find((o) => o.positionId === PADARIA)!;

    expect(padaria.absences).toBe(3);
    expect(padaria.observation).toBe('Turno da manhã descoberto');
    expect(padaria.reasons.map((r) => `${r.reasonName}:${r.quantity}`)).toEqual([
      'Atestado médico:2',
      'Falta injustificada:1',
    ]);
    expect(padaria.reasons[0].observation).toBe('Consulta');
  });

  it('mostra as OUTRAS funções com ocorrência no mesmo dia', () => {
    const analise = buildStoreAnalysis(makeRange(), PERIODO, 'store-307', SEM_FILTRO, PADARIA)!;

    const dia2 = analise.days.find((d) => d.date === D2)!;
    // Em D-2 a padaria zerou, mas o caixa teve 4 faltas: o dia continua na
    // lista, com a função que realmente teve ocorrência.
    expect(dia2.occurrences.map((o) => o.positionName)).toEqual(['OPERADOR DE CAIXA']);
  });

  it('destaca a função que trouxe o usuário, sem esconder as demais', () => {
    const analise = buildStoreAnalysis(makeRange(), PERIODO, 'store-124', SEM_FILTRO, PADARIA)!;

    expect(analise.highlightPositionId).toBe(PADARIA);
    const dia = analise.days.find((d) => d.date === D3)!;
    // A folga do caixa continua visível — destacar não é filtrar.
    expect(dia.occurrences.map((o) => o.positionId).sort()).toEqual([CAIXA, PADARIA].sort());
  });

  it('dia sem ocorrência nenhuma não vira linha vazia', () => {
    const analise = buildStoreAnalysis(makeRange(), PERIODO, 'store-311', SEM_FILTRO, null)!;
    // A PANAMBY só tem 1 dia com ocorrência no período de 7 dias.
    expect(analise.days).toHaveLength(1);
    expect(analise.days[0].date).toBe(D4);
  });
});
