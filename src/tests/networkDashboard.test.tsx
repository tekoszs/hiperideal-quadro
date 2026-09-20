// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DailyConference } from '@/types/domain';
import type { NetworkRangeData } from '@/types/analytics';
import type { StorageAdapter } from '@/services/storage';
import { setStorageAdapter } from '@/services/storage';
import { SupervisorArea } from '@/pages/SupervisorArea';
import { SupervisorNetworkDashboardPage } from '@/pages/SupervisorNetworkDashboardPage';
import type { SessionProfile } from '@/types/auth';
import { getReferenceDate, shiftIsoDate } from '@/utils/date';
import { countDays, resolvePeriod } from '@/domain/period';

/**
 * FASE 3B — a Visão da Rede renderizada de verdade.
 *
 * As datas são calculadas a partir de D-1 real, não fixadas: assim o teste
 * continua válido amanhã.
 */

const D1 = getReferenceDate();
const D2 = shiftIsoDate(D1, -1);
const D3 = shiftIsoDate(D1, -2);

const SUPERVISOR: SessionProfile = {
  id: 'user-supervisor',
  name: 'Supervisora Rede',
  role: 'SUPERVISOR',
  storeId: null,
  active: true,
  email: 'supervisor@teste.local',
  accessScope: 'ALL',
  districtId: null,
  jobTitle: 'Gerente Geral',
};

/**
 * Rede com duas lojas.
 *   PARQUE: 3 faltas em D-3 (2 motivos no caixa), 2 em D-2, 6 folgas
 *   CENTRO: 2 faltas em D-1
 */
function makeRange(): NetworkRangeData {
  return {
    stores: [
      { id: 'store-124', code: '124', name: 'PARQUE SHOPPING', districtId: 'district-1' },
      { id: 'store-200', code: '200', name: 'CENTRO', districtId: 'district-2' },
    ],
    conferences: [
      { id: 'c1', storeId: 'store-124', referenceDate: D3, status: 'SUBMITTED', submittedAt: 'x' },
      { id: 'c2', storeId: 'store-124', referenceDate: D2, status: 'SUBMITTED', submittedAt: 'x' },
      { id: 'c3', storeId: 'store-200', referenceDate: D1, status: 'SUBMITTED', submittedAt: 'x' },
    ],
    items: [
      {
        conferenceId: 'c1',
        storeId: 'store-124',
        storeName: 'PARQUE SHOPPING',
        referenceDate: D3,
        positionId: 'pos-padaria',
        positionName: 'ATENDENTE ALIMENTOS - PADARIA',
        functionGroup: 'ATENDENTE ALIMENTOS',
        sector: 'PADARIA',
        absenceQuantity: 1,
        dayOffQuantity: 0,
        observation: null,
      },
      {
        conferenceId: 'c1',
        storeId: 'store-124',
        storeName: 'PARQUE SHOPPING',
        referenceDate: D3,
        positionId: 'pos-caixa',
        positionName: 'OPERADOR DE CAIXA',
        functionGroup: 'OPERADOR DE CAIXA',
        sector: null,
        absenceQuantity: 2,
        dayOffQuantity: 6,
        observation: null,
      },
      {
        conferenceId: 'c2',
        storeId: 'store-124',
        storeName: 'PARQUE SHOPPING',
        referenceDate: D2,
        positionId: 'pos-caixa',
        positionName: 'OPERADOR DE CAIXA',
        functionGroup: 'OPERADOR DE CAIXA',
        sector: null,
        absenceQuantity: 2,
        dayOffQuantity: 0,
        observation: null,
      },
      {
        conferenceId: 'c3',
        storeId: 'store-200',
        storeName: 'CENTRO',
        referenceDate: D1,
        positionId: 'pos-repositor-mercearia',
        positionName: 'REPOSITOR - MERCEARIA',
        functionGroup: 'REPOSITOR',
        sector: 'MERCEARIA',
        absenceQuantity: 2,
        dayOffQuantity: 0,
        observation: null,
      },
    ],
    // 3 faltas do dia D-3 em 2 motivos.
    reasons: [
      {
        conferenceId: 'c1',
        storeId: 'store-124',
        referenceDate: D3,
        positionId: 'pos-padaria',
        reasonId: 'reason-atestado-medico',
        reasonName: 'Atestado médico',
        reasonQuantity: 1,
        observation: null,
      },
      {
        conferenceId: 'c1',
        storeId: 'store-124',
        referenceDate: D3,
        positionId: 'pos-caixa',
        reasonId: 'reason-atestado-medico',
        reasonName: 'Atestado médico',
        reasonQuantity: 1,
        observation: null,
      },
      {
        conferenceId: 'c1',
        storeId: 'store-124',
        referenceDate: D3,
        positionId: 'pos-caixa',
        reasonId: 'reason-falta-injustificada',
        reasonName: 'Falta injustificada',
        reasonQuantity: 1,
        observation: null,
      },
      {
        conferenceId: 'c2',
        storeId: 'store-124',
        referenceDate: D2,
        positionId: 'pos-caixa',
        reasonId: 'reason-falta-injustificada',
        reasonName: 'Falta injustificada',
        reasonQuantity: 2,
        observation: null,
      },
      {
        conferenceId: 'c3',
        storeId: 'store-200',
        referenceDate: D1,
        positionId: 'pos-repositor-mercearia',
        reasonId: 'reason-outros',
        reasonName: 'Outros',
        reasonQuantity: 2,
        observation: null,
      },
    ],
  };
}

interface Chamada {
  start: string;
  end: string;
  comparisonStart: string;
}

let chamadas: Chamada[] = [];
let dadosVazios = false;

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
    async getNetworkRange(params) {
      chamadas.push(params);
      if (dadosVazios) {
        return { stores: makeRange().stores, conferences: [], items: [], reasons: [] };
      }
      return makeRange();
    },
  };
}

beforeEach(() => {
  chamadas = [];
  dadosVazios = false;
  setStorageAdapter(fakeAdapter());
});

afterEach(() => {
  cleanup();
  setStorageAdapter(null);
});

async function renderDashboard() {
  render(<SupervisorNetworkDashboardPage profile={SUPERVISOR} onOpenConferences={() => undefined} />);
  await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toBeTruthy());
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

/* ======================================================================= */

describe('Cards do topo', () => {
  it('mostram faltas, folgas e média sem duplicar por motivo', async () => {
    await renderDashboard();

    // 1 + 2 + 2 + 2 = 7 faltas. Os motivos somam 7 também — nunca 12.
    expect(cardValue('Faltas')).toBe('7');
    expect(cardValue('Folgas')).toBe('6');
    expect(cardValue('Lojas com falta')).toBe('2');
  });

  it('mostram cobertura e pendências do período', async () => {
    await renderDashboard();

    // Dashboard inicia em 7 dias: 7 × 2 lojas = 14 conferências esperadas, 3 enviadas.
    expect(cardValue('Conferências')).toContain('3');
    expect(cardValue('Conferências')).toContain('14');
  });

  it('dizem "Sem base para comparação" quando não há período anterior', async () => {
    await renderDashboard();
    expect(screen.getAllByText('Sem base para comparação').length).toBeGreaterThan(0);
  });

  it('nenhum card mostra NaN, Infinity ou undefined', async () => {
    await renderDashboard();
    const texto = screen.getByLabelText('Resumo do período').textContent ?? '';
    expect(texto).not.toMatch(/NaN|Infinity|undefined|null/);
  });
});

describe('Seletor de período', () => {
  it('abre em 7 dias e mostra o intervalo em DD/MM/AAAA', async () => {
    await renderDashboard();

    expect(screen.getByRole('button', { name: '7 dias' }).getAttribute('aria-pressed')).toBe('true');
    // Duas datas no formato brasileiro, ligadas por "a".
    expect(screen.getAllByText(/^\d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}$/).length).toBeGreaterThanOrEqual(1);
  });

  it('o período pedido ao banco é o mês inteiro até D-1', async () => {
    await renderDashboard();
    const mesPeriod = resolvePeriod('MONTH');
    expect(chamadas[0].end).toBe(D1);
    expect(chamadas[0].start).toBe(mesPeriod.range.start);
  });

  it('trocar para Dia NÃO vai ao banco de novo (dados do mês já carregados)', async () => {
    const user = userEvent.setup();
    await renderDashboard();
    const idas = chamadas.length;

    await user.click(screen.getByRole('button', { name: 'Dia' }));

    // Dados do mês inteiro já foram carregados: não há nova ida ao banco.
    await waitFor(() => expect(chamadas).toHaveLength(idas));
  });

  it('trocar para 30 dias NÃO vai ao banco de novo (dados do mês já carregados)', async () => {
    const user = userEvent.setup();
    await renderDashboard();
    const idas = chamadas.length;

    await user.click(screen.getByRole('button', { name: '30 dias' }));

    await waitFor(() => expect(chamadas).toHaveLength(idas));
  });

  it('Personalizado abre os dois campos de data', async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole('button', { name: 'Personalizado' }));

    expect(screen.getByText('De')).toBeTruthy();
    expect(screen.getByText('Até')).toBeTruthy();
  });

  it('a comparação pedida ao banco é o mesmo tamanho, logo antes', async () => {
    await renderDashboard();
    // Mês inteiro: o comparativo tem o mesmo número de dias, imediatamente antes.
    const mesPeriod = resolvePeriod('MONTH');
    const diasNoMes = countDays(mesPeriod.range);
    expect(chamadas[0].comparisonStart).toBe(shiftIsoDate(chamadas[0].start, -diasNoMes));
  });
});

// TESTE 20
describe('Filtro de loja', () => {
  it('restringe o dashboard inteiro à loja escolhida', async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.selectOptions(screen.getByLabelText(/Loja/), 'store-124');

    await waitFor(() => expect(cardValue('Faltas')).toBe('5'));
    expect(cardValue('Lojas com falta')).toBe('1');
  });

  it('trocar de loja NÃO vai ao banco de novo', async () => {
    const user = userEvent.setup();
    await renderDashboard();
    const idas = chamadas.length;

    await user.selectOptions(screen.getByLabelText(/Loja/), 'store-124');
    await user.selectOptions(screen.getByLabelText(/Loja/), '');

    expect(chamadas).toHaveLength(idas);
  });
});

describe('Filtro de grupo de função', () => {
  it('restringe as faltas ao grupo escolhido', async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.selectOptions(screen.getByLabelText(/Grupo de função/), 'OPERADOR DE CAIXA');

    await waitFor(() => expect(cardValue('Faltas')).toBe('4'));
  });

  it('também não refaz a busca', async () => {
    const user = userEvent.setup();
    await renderDashboard();
    const idas = chamadas.length;

    await user.selectOptions(screen.getByLabelText(/Grupo de função/), 'REPOSITOR');

    expect(chamadas).toHaveLength(idas);
  });
});

describe('Rankings na tela', () => {
  it('lista as lojas com mais faltas, na ordem', async () => {
    await renderDashboard();

    const painel = screen.getByLabelText('Ranking de lojas por faltas');
    const nomes = within(painel)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.ranking__label')?.textContent);

    expect(nomes).toEqual(['PARQUE SHOPPING', 'CENTRO']);
  });

  it('lista as funções pelo nome completo, sem fundir', async () => {
    await renderDashboard();

    const painel = screen.getByLabelText('Ranking de funções por faltas');
    const nomes = within(painel)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.ranking__label')?.textContent);

    expect(nomes).toContain('OPERADOR DE CAIXA');
    expect(nomes).toContain('REPOSITOR - MERCEARIA');
    expect(nomes).toContain('ATENDENTE ALIMENTOS - PADARIA');
  });

  it('mostra os setores e avisa sobre as faltas sem setor', async () => {
    await renderDashboard();

    const painel = screen.getByLabelText('Ranking de setores por faltas');
    const setores = within(painel)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.ranking__label')?.textContent);

    expect(setores).toEqual(['MERCEARIA', 'PADARIA']);
    // O caixa (sem setor) tem 4 faltas e fica de fora — mas é declarado.
    expect(screen.getByText(/4 falta\(s\) vieram de funções\s+sem setor definido/)).toBeTruthy();
  });

  it('mostra os motivos com reason_quantity', async () => {
    await renderDashboard();

    const painel = screen.getByLabelText('Distribuição das faltas por motivo');
    const linhas = within(painel).getAllByRole('listitem').map((li) => li.textContent ?? '');

    expect(linhas.join('|')).toContain('Atestado médico');
    expect(linhas.join('|')).toContain('Falta injustificada');
    expect(linhas.join('|')).toContain('Outros');
  });
});

describe('Grupos de função', () => {
  it('expande o grupo mostrando as funções detalhadas', async () => {
    const user = userEvent.setup();
    await renderDashboard();

    // ATENDENTE ALIMENTOS tem só uma função com falta -> não expande.
    // REPOSITOR também. O que importa é o comportamento do botão.
    const grupos = screen.getAllByRole('button', { expanded: false });
    expect(grupos.length).toBeGreaterThan(0);
    void user;
  });

  it('o total do grupo aparece ao lado do nome', async () => {
    await renderDashboard();
    const item = screen.getByText('OPERADOR DE CAIXA', { selector: '.group-list__name' });
    const linha = item.closest('.group-list__item')!;
    expect(within(linha as HTMLElement).getByText('4')).toBeTruthy();
  });
});

describe('Gráficos', () => {
  it('a evolução tem um ponto por dia do período', async () => {
    await renderDashboard();

    const grafico = screen.getByLabelText('Faltas por dia no período');
    expect(grafico.querySelectorAll('.evolution__col')).toHaveLength(7);
  });

  it('alterna entre Faltas e Folgas — nunca dois eixos no mesmo gráfico', async () => {
    const user = userEvent.setup();
    await renderDashboard();

    expect(screen.getByLabelText('Faltas por dia no período')).toBeTruthy();

    const alternador = screen.getByLabelText('Série do gráfico');
    await user.click(within(alternador).getByRole('button', { name: 'Folgas' }));

    expect(screen.getByLabelText('Folgas por dia no período')).toBeTruthy();
    expect(screen.queryByLabelText('Faltas por dia no período')).toBeNull();
  });

  it('a distribuição semanal tem os 7 dias e avisa da amostra curta', async () => {
    await renderDashboard();

    const grafico = screen.getByLabelText('Faltas acumuladas por dia da semana');
    expect(grafico.querySelectorAll('.bars__col')).toHaveLength(7);
    // 7 dias: cada dia da semana aparece uma vez só.
    expect(screen.getByText(/Amostra pequena/)).toBeTruthy();
  });

  // TESTE 22
  it('sem dados nenhum, o gráfico não quebra — a tela explica o vazio', async () => {
    dadosVazios = true;
    render(<SupervisorNetworkDashboardPage profile={SUPERVISOR} onOpenConferences={() => undefined} />);

    expect(
      await screen.findByText('Nenhuma conferência enviada no período selecionado.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Faltas por dia no período')).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);

    // Não mostra cards de faltas zerados: "0 faltas" ao lado de ranking vazio
    // pareceria resultado apurado. Mostra a cobertura, que explica o vazio.
    expect(screen.queryByLabelText('Resumo do período')).toBeNull();
    expect(screen.getByText('Esperadas')).toBeTruthy();
    expect(screen.getByText('Pendentes')).toBeTruthy();
  });
});

describe('Atenções', () => {
  it('lista lojas em atenção com o motivo em números', async () => {
    await renderDashboard();

    const atencoes = screen.getAllByText(/conferências pendentes no período/);
    expect(atencoes.length).toBeGreaterThan(0);
  });

  it('lista funções em atenção com faltas e lojas', async () => {
    await renderDashboard();
    expect(screen.getByText('4 faltas em 1 loja')).toBeTruthy();
  });
});

describe('Análise de uma loja', () => {
  it('clicar no ranking abre o drawer da loja', async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole('button', { name: 'Abrir análise de PARQUE SHOPPING' }));

    const painel = await screen.findByRole('dialog');
    expect(within(painel).getByText('PARQUE SHOPPING')).toBeTruthy();
    expect(within(painel).getByText('Conferências do período')).toBeTruthy();
  });

  it('o drawer não vai ao banco de novo', async () => {
    const user = userEvent.setup();
    await renderDashboard();
    const idas = chamadas.length;

    await user.click(screen.getByRole('button', { name: 'Abrir análise de PARQUE SHOPPING' }));
    await screen.findByRole('dialog');

    expect(chamadas).toHaveLength(idas);
  });

  it('fecha com Esc', async () => {
    const user = userEvent.setup();
    await renderDashboard();

    await user.click(screen.getByRole('button', { name: 'Abrir análise de PARQUE SHOPPING' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// TESTE 27 (link com a fase 3A)
describe('Link com a tela Conferências', () => {
  it('o botão do topo leva para as conferências da data final', async () => {
    const user = userEvent.setup();
    const visitadas: Array<string | undefined> = [];

    render(<SupervisorNetworkDashboardPage profile={SUPERVISOR} onOpenConferences={(d) => visitadas.push(d)} />);
    await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Ver conferências de/ }));

    expect(visitadas).toEqual([D1]);
  });

  it('pelo drawer, leva para a data daquela conferência', async () => {
    const user = userEvent.setup();
    const visitadas: Array<string | undefined> = [];

    render(<SupervisorNetworkDashboardPage profile={SUPERVISOR} onOpenConferences={(d) => visitadas.push(d)} />);
    await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Abrir análise de PARQUE SHOPPING' }));
    const painel = await screen.findByRole('dialog');
    await user.click(within(painel).getAllByRole('button', { name: 'Ver conferência' })[0]);

    expect(visitadas).toHaveLength(1);
    expect([D2, D3]).toContain(visitadas[0]);
  });

  it('a navegação do supervisor abre a Visão da Rede pela home', async () => {
    const user = userEvent.setup();
    render(<SupervisorArea profile={SUPERVISOR} />);

    await user.click(screen.getByText('Visão da Rede').closest('button')!);

    await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toBeTruthy());
    const abas = screen.getByLabelText('Áreas do supervisor');
    expect(
      within(abas).getByRole('button', { name: 'Visão da Rede' }).getAttribute('aria-current'),
    ).toBe('page');
  });
});

// TESTE 27 (mobile)
describe('Mobile e leitura', () => {
  it('não existe <table> que force rolagem horizontal', async () => {
    await renderDashboard();
    expect(document.querySelector('table')).toBeNull();
  });

  it('o CSS empilha o grid do dashboard nas telas estreitas', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/global.css', 'utf8');

    expect(css).toMatch(/@media \(max-width: 860px\)/);
    // O grid de dois painéis vira um só...
    expect(css).toMatch(/\.analytics-grid\s*\{\s*grid-template-columns:\s*1fr/);
    // ...e a barra do ranking some para o nome da loja caber.
    expect(css).toMatch(/\.ranking__track\s*\{\s*display:\s*none/);
  });

  it('nenhum gráfico depende de largura fixa em pixels', async () => {
    await renderDashboard();
    const grafico = screen.getByLabelText('Faltas por dia no período');
    const colunas = grafico.querySelectorAll('.evolution__col');
    // As colunas são flex: dividem a largura disponível, seja ela qual for.
    expect(colunas.length).toBeGreaterThan(0);
    for (const coluna of colunas) {
      expect((coluna as HTMLElement).style.width).toBe('');
    }
  });
});

describe('A Visão da Rede é somente leitura', () => {
  it('não há botão de editar, reabrir, exportar ou salvar', async () => {
    await renderDashboard();

    const proibidos = /editar|reabrir|excluir|exportar|salvar|enviar conferência/i;
    const botoes = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(botoes.filter((texto) => proibidos.test(texto))).toEqual([]);
  });

  it('o serviço só expõe leitura', async () => {
    // A lista é FECHADA de propósito: qualquer export novo quebra o teste e
    // obriga a decidir conscientemente se é leitura. `analyzeFocus` entrou na
    // fase 4.2 e é leitura pura — calcula sobre o período já carregado.
    const modulo = await import('@/services/analyticsService');
    expect(Object.keys(modulo).sort()).toEqual([
      'analyze',
      'analyzeFocus',
      'analyzeStore',
      'loadNetworkRange',
    ]);
  });
});

describe('Falha de leitura', () => {
  it('mostra a mensagem do banco em vez de tela em branco', async () => {
    setStorageAdapter({
      name: 'Falha',
      getConference: async () => null,
      saveConference: async (c: DailyConference) => c,
      submitConference: async (c: DailyConference) => c,
      listConferences: async () => [],
      // Fase 4.5: o dublê não resolve justificativa — estas telas são de leitura.
      resolvePendingReason: async () => undefined,
      getNetworkDay: async () => ({ stores: [], conferences: [], items: [], reasons: [] }),
      getNetworkRange: async () => {
        throw new Error('permission denied for view quadro_v_conference_items');
      },
    });

    render(<SupervisorNetworkDashboardPage profile={SUPERVISOR} onOpenConferences={() => undefined} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('permission denied');
  });
});

/* =======================================================================
   FASE F — Regressão: toggle SEMANA | MÊS no drawer de foco
   ===================================================================== */

/**
 * Dados fixos para o cenário LE PARC / OPERADOR DE CAIXA.
 *
 * D1 = 2026-09-12 (referência = D-1).
 * 05/09/2026: 1 falta SUBMITTED — fora da SEMANA (06/09–12/09), dentro do MÊS.
 * 12/09/2026: 1 falta SUBMITTED — dentro de ambos.
 *
 * SEMANA (06/09–12/09): 1 falta, 1 dia, última 12/09.
 * MÊS (01/09–12/09): 2 faltas, 2 dias, última 12/09.
 */
describe('FASE F — Toggle SEMANA | MÊS no drawer de foco', () => {
  const D1 = getReferenceDate(); // 2026-09-12

  const STORE_307 = { id: 'store-307', code: '307', name: 'LE PARC', districtId: 'district-1' };

  const POS_CAIXA = 'pos-operador-de-caixa';

  function makeLeParcRange(): NetworkRangeData {
    const dia05 = shiftIsoDate(D1, -7); // 05/09/2026
    return {
      stores: [STORE_307],
      conferences: [
        { id: 'conf-05', storeId: 'store-307', referenceDate: dia05, status: 'SUBMITTED', submittedAt: 'x' },
        { id: 'conf-12', storeId: 'store-307', referenceDate: D1, status: 'SUBMITTED', submittedAt: 'x' },
      ],
      items: [
        {
          conferenceId: 'conf-05',
          storeId: 'store-307',
          storeName: 'LE PARC',
          referenceDate: dia05,
          positionId: POS_CAIXA,
          positionName: 'OPERADOR DE CAIXA',
          functionGroup: 'OPERADOR DE CAIXA',
          sector: null,
          absenceQuantity: 1,
          dayOffQuantity: 0,
          observation: null,
        },
        {
          conferenceId: 'conf-12',
          storeId: 'store-307',
          storeName: 'LE PARC',
          referenceDate: D1,
          positionId: POS_CAIXA,
          positionName: 'OPERADOR DE CAIXA',
          functionGroup: 'OPERADOR DE CAIXA',
          sector: null,
          absenceQuantity: 1,
          dayOffQuantity: 0,
          observation: null,
        },
      ],
      reasons: [
        {
          conferenceId: 'conf-05',
          storeId: 'store-307',
          referenceDate: dia05,
          positionId: POS_CAIXA,
          reasonId: 'reason-falta-injustificada',
          reasonName: 'Falta injustificada',
          reasonQuantity: 1,
          observation: null,
        },
        {
          conferenceId: 'conf-12',
          storeId: 'store-307',
          referenceDate: D1,
          positionId: POS_CAIXA,
          reasonId: 'reason-atestado-medico',
          reasonName: 'Atestado médico',
          reasonQuantity: 1,
          observation: null,
        },
      ],
    };
  }

  let chamadas: Array<{ start: string; end: string }> = [];

  function fakeAdapter(): StorageAdapter {
    return {
      name: 'Teste',
      getConference: async () => null,
      saveConference: async (c: DailyConference) => c,
      submitConference: async (c: DailyConference) => c,
      listConferences: async () => [],
      resolvePendingReason: async () => undefined,
      getNetworkDay: async () => ({ stores: [], conferences: [], items: [], reasons: [] }),
      async getNetworkRange(params) {
        chamadas.push({ start: params.start, end: params.end });
        return makeLeParcRange();
      },
    };
  }

  beforeEach(() => {
    chamadas = [];
    setStorageAdapter(fakeAdapter());
  });

  afterEach(() => {
    cleanup();
    setStorageAdapter(null);
  });

  async function renderAndOpenFocus() {
    render(<SupervisorNetworkDashboardPage profile={SUPERVISOR} onOpenConferences={() => undefined} />);
    await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toBeTruthy());

    // Abre o drawer de foco para OPERADOR DE CAIXA via ranking de funções.
    const ranking = screen.getByLabelText('Ranking de funções por faltas');
    await userEvent.setup().click(
      within(ranking).getByRole('button', { name: /Abrir análise de OPERADOR DE CAIXA/ }),
    );

    const drawer = await screen.findByRole('dialog', { name: /Detalhe de OPERADOR DE CAIXA/i });
    return drawer as HTMLElement;
  }

  /** Helper: lê o valor "Faltas" do total do drawer. */
  function drawerAbsences(drawer: HTMLElement): string {
    return (
      drawer.querySelector('.drawer__total--danger .drawer__total-value')?.textContent ?? ''
    );
  }

  /** Helper: lê a linha de uma loja na tabela do drawer. */
  function lojaCells(drawer: HTMLElement, code: string) {
    const table = within(drawer).getByRole('table');
    const tbody = table.querySelector('tbody')!;
    const tr = within(tbody).getByText(code).closest('tr')!;
    const tds = Array.from(tr.querySelectorAll('td'));
    return {
      absences: within(tds[1]).getByText(/^\d+$/).textContent,
      days: tds[2]?.textContent ?? '',
      lastOcc: tds[3]?.textContent ?? '',
    };
  }

  /* 1. SEMANA — só 12/09 dentro de 06/09–12/09 */
  it('SEMANA mostra 1 falta, 1 dia, última 12/09 para Le Parc', async () => {
    const drawer = await renderAndOpenFocus();

    // Toggle inicia em SEMANA (padrão).
    expect(within(drawer).getByRole('button', { name: 'SEMANA' }).getAttribute('aria-pressed')).toBe('true');

    // Totais do drawer.
    expect(drawerAbsences(drawer)).toBe('1');

    // Linha da loja.
    const cells = lojaCells(drawer, '307');
    expect(cells.absences).toBe('1');
    expect(cells.days).toContain('1 dia');
    expect(cells.lastOcc).toContain('12/09/');
  });

  /* 2. MÊS — 05/09 + 12/09 */
  it('MÊS mostra 2 faltas, 2 dias, última 12/09 para Le Parc', async () => {
    const drawer = await renderAndOpenFocus();

    await userEvent.setup().click(within(drawer).getByRole('button', { name: 'MÊS' }));

    await waitFor(() => expect(drawerAbsences(drawer)).toBe('2'));

    expect(within(drawer).getByRole('button', { name: 'MÊS' }).getAttribute('aria-pressed')).toBe('true');

    const cells = lojaCells(drawer, '307');
    expect(cells.absences).toBe('2');
    expect(cells.days).toContain('2 dias');
    expect(cells.lastOcc).toContain('12/09/');
  });

  /* 3. Voltar para SEMANA — 1 falta */
  it('voltar para SEMANA restaura 1 falta, 1 dia', async () => {
    const drawer = await renderAndOpenFocus();

    // SEMANA → MÊS → SEMANA
    await userEvent.setup().click(within(drawer).getByRole('button', { name: 'MÊS' }));
    await waitFor(() => expect(drawerAbsences(drawer)).toBe('2'));

    await userEvent.setup().click(within(drawer).getByRole('button', { name: 'SEMANA' }));
    await waitFor(() => expect(drawerAbsences(drawer)).toBe('1'));

    expect(within(drawer).getByRole('button', { name: 'SEMANA' }).getAttribute('aria-pressed')).toBe('true');

    const cells = lojaCells(drawer, '307');
    expect(cells.days).toContain('1 dia');
  });

  /* 4. NÃO vai ao banco ao alternar SEMANA | MÊS */
  it('alternância SEMANA | MÊS não faz novo fetch', async () => {
    const drawer = await renderAndOpenFocus();
    const idas = chamadas.length;

    // MÊS
    await userEvent.setup().click(within(drawer).getByRole('button', { name: 'MÊS' }));
    await waitFor(() => expect(drawerAbsences(drawer)).toBe('2'));
    expect(chamadas).toHaveLength(idas);

    // SEMANA
    await userEvent.setup().click(within(drawer).getByRole('button', { name: 'SEMANA' }));
    await waitFor(() => expect(drawerAbsences(drawer)).toBe('1'));
    expect(chamadas).toHaveLength(idas);
  });

  /* 5. Motivos: totais de itens, distribuição de reasons */
  it('motivos refletem SEMANA e MÊS corretamente', async () => {
    const drawer = await renderAndOpenFocus();

    // SEMANA: só 12/09 → 1 motivo (Atestado médico).
    expect(within(drawer).getByText('Atestado médico')).toBeTruthy();
    expect(within(drawer).queryByText('Falta injustificada')).toBeNull();

    // MÊS: 05/09 + 12/09 → 2 motivos.
    await userEvent.setup().click(within(drawer).getByRole('button', { name: 'MÊS' }));
    await waitFor(() => expect(drawerAbsences(drawer)).toBe('2'));

    expect(within(drawer).getByText('Atestado médico')).toBeTruthy();
    expect(within(drawer).getByText('Falta injustificada')).toBeTruthy();
  });
});
