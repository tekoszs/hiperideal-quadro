// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DailyConference } from '@/types/domain';
import type { NetworkDayData } from '@/types/network';
import type { StorageAdapter } from '@/services/storage';
import { setStorageAdapter } from '@/services/storage';
import { SupervisorArea } from '@/pages/SupervisorArea';
import { SupervisorConferencesPage } from '@/pages/SupervisorConferencesPage';
import { getReferenceDate } from '@/utils/date';
import type { SessionProfile } from '@/types/auth';

/**
 * FASE 3A — a tela do supervisor, renderizada de verdade.
 *
 * O adaptador é substituído por um duplo em memória: os testes exercitam a
 * cadeia real (página -> hook -> serviço -> adaptador -> domínio) sem banco.
 */

const REFERENCE_DATE = getReferenceDate();

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

const ADMIN: SessionProfile = {
  ...SUPERVISOR,
  id: 'user-admin',
  name: 'Administradora Rede',
  role: 'ADMIN',
  email: 'admin@teste.local',
  jobTitle: 'Administradora',
};

function makeDay(referenceDate: string): NetworkDayData {
  return {
    stores: [
      { id: 'store-124', code: '124', name: 'PARQUE SHOPPING', districtId: 'district-1' },
      { id: 'store-400', code: '400', name: 'BAIRRO NOVO', districtId: 'district-2' },
    ],
    conferences: [
      {
        id: 'conf-parque',
        storeId: 'store-124',
        referenceDate,
        status: 'SUBMITTED',
        submittedAt: '2026-09-06T11:42:00.000Z',
        submittedBy: 'user-gerente-124',
        submittedByName: 'Ana Gerente',
        updatedAt: '2026-09-06T11:42:00.000Z',
      },
    ],
    items: [
      {
        conferenceId: 'conf-parque',
        storeId: 'store-124',
        positionId: 'pos-padaria',
        positionName: 'ATENDENTE ALIMENTOS - PADARIA',
        functionGroup: 'ATENDENTE ALIMENTOS',
        sector: 'PADARIA',
        absenceQuantity: 1,
        dayOffQuantity: 0,
        observation: 'Associada apresentou atestado.',
      },
      {
        conferenceId: 'conf-parque',
        storeId: 'store-124',
        positionId: 'pos-caixa',
        positionName: 'OPERADOR DE CAIXA',
        functionGroup: 'OPERADOR DE CAIXA',
        sector: null,
        absenceQuantity: 2,
        dayOffQuantity: 6,
        observation: null,
      },
      {
        conferenceId: 'conf-parque',
        storeId: 'store-124',
        positionId: 'pos-acougueiro',
        positionName: 'ACOUGUEIRO',
        functionGroup: 'ACOUGUEIRO',
        sector: null,
        absenceQuantity: 0,
        dayOffQuantity: 0,
        observation: null,
      },
    ],
    // 3 faltas em 2 motivos — o cenário que a view antiga multiplicava.
    reasons: [
      {
        conferenceId: 'conf-parque',
        positionId: 'pos-padaria',
        reasonId: 'reason-atestado-medico',
        reasonName: 'Atestado médico',
        reasonQuantity: 1,
        observation: null,
      },
      {
        conferenceId: 'conf-parque',
        positionId: 'pos-caixa',
        reasonId: 'reason-atestado-medico',
        reasonName: 'Atestado médico',
        reasonQuantity: 1,
        observation: null,
      },
      {
        conferenceId: 'conf-parque',
        positionId: 'pos-caixa',
        reasonId: 'reason-falta-injustificada',
        reasonName: 'Falta injustificada',
        reasonQuantity: 1,
        observation: null,
      },
    ],
  };
}

/** Adaptador de teste: só a leitura da rede é exercitada aqui. */
function fakeAdapter(): { adapter: StorageAdapter; datasPedidas: string[] } {
  const datasPedidas: string[] = [];
  const adapter: StorageAdapter = {
    name: 'Teste',
    getConference: async () => null,
    saveConference: async (c: DailyConference) => c,
    submitConference: async (c: DailyConference) => c,
    listConferences: async () => [],
    // Fase 4.5: o dublê não resolve justificativa — estas telas são de leitura.
    resolvePendingReason: async () => undefined,
    async getNetworkDay(referenceDate: string) {
      datasPedidas.push(referenceDate);
      // Só o dia de referência tem dados; qualquer outro volta vazio.
      return referenceDate === REFERENCE_DATE
        ? makeDay(referenceDate)
        : { ...makeDay(referenceDate), conferences: [], items: [], reasons: [] };
    },
    // A Visão da Rede (fase 3B) não é exercitada por este arquivo.
    async getNetworkRange() {
      return { stores: [], conferences: [], items: [], reasons: [] };
    },
  };
  return { adapter, datasPedidas };
}

let datasPedidas: string[] = [];

beforeEach(() => {
  const fake = fakeAdapter();
  datasPedidas = fake.datasPedidas;
  setStorageAdapter(fake.adapter);
});

afterEach(() => {
  cleanup();
  setStorageAdapter(null);
});

async function renderPage() {
  render(<SupervisorConferencesPage profile={SUPERVISOR} onBack={() => undefined} />);
  await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
}

/** Linha da lista correspondente a uma loja. */
function linhaDa(loja: string): HTMLElement {
  const nome = screen.getByText(loja);
  return nome.closest('.network-row') as HTMLElement;
}

// TESTE 1
describe('A conferência enviada aparece na lista', () => {
  it('mostra a loja, o status Enviada e o horário do envio', async () => {
    await renderPage();

    const parque = linhaDa('PARQUE SHOPPING');
    expect(within(parque).getByText('Enviada')).toBeTruthy();
    // 11:42 UTC no fuso do container (UTC) -> 11:42.
    expect(parque.textContent).toMatch(/\d{2}:\d{2}/);
  });
});

// TESTE 2
describe('Loja sem conferência aparece PENDENTE', () => {
  it('a loja que não enviou continua na lista, marcada como Pendente', async () => {
    await renderPage();

    const bairro = linhaDa('BAIRRO NOVO');
    expect(within(bairro).getByText('Pendente')).toBeTruthy();
    // Sem conferência não há número para mostrar.
    expect(within(bairro).getAllByText('—').length).toBeGreaterThan(0);
  });
});

// TESTES 3, 4 e 5
describe('Cards do topo', () => {
  it('somam faltas e folgas sem duplicar por motivo', async () => {
    await renderPage();

    const resumo = screen.getByLabelText('Resumo do dia na rede');
    const valorDe = (rotulo: string) =>
      within(resumo)
        .getByText(rotulo)
        .closest('.summary-card')!
        .querySelector('.summary-card__value')!.textContent;

    expect(valorDe('Lojas')).toBe('2');
    expect(valorDe('Enviaram')).toBe('1');
    expect(valorDe('Pendentes')).toBe('1');
    // 3 faltas em 2 motivos: continua 3, nunca 6.
    expect(valorDe('Faltas')).toBe('3');
    expect(valorDe('Folgas')).toBe('6');
  });

  it('a linha da loja mostra faltas 3 e funções impactadas 2', async () => {
    await renderPage();

    const parque = linhaDa('PARQUE SHOPPING');
    const numeros = within(parque)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);

    expect(numeros.join('|')).toContain('3'); // faltas
    expect(numeros.join('|')).toContain('6'); // folgas
    expect(numeros.join('|')).toContain('2'); // funções impactadas
  });
});

// TESTES 6, 7 e 8
describe('Detalhamento da loja', () => {
  async function abrirDetalhe() {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Ver detalhes de PARQUE SHOPPING' }));
    const painel = await screen.findByRole('dialog');
    return { user, painel };
  }

  it('abre com loja, referência, status, horário e responsável', async () => {
    const { painel } = await abrirDetalhe();

    expect(within(painel).getByText('PARQUE SHOPPING')).toBeTruthy();
    expect(within(painel).getByText('Enviada')).toBeTruthy();
    // TESTE 8 — responsável vem do banco (submitted_by -> quadro_profiles).
    expect(within(painel).getByText('Ana Gerente')).toBeTruthy();
  });

  it('o resumo do detalhe mostra 3 faltas, 6 folgas e 2 funções', async () => {
    const { painel } = await abrirDetalhe();

    const total = (rotulo: string) =>
      within(painel)
        .getByText(rotulo)
        .closest('.drawer__total')!
        .querySelector('.drawer__total-value')!.textContent;

    expect(total('Faltas')).toBe('3');
    expect(total('Folgas')).toBe('6');
    expect(total('Funções impactadas')).toBe('2');
  });

  // TESTE 6
  it('mostra todos os motivos de cada função', async () => {
    const { painel } = await abrirDetalhe();

    const caixa = within(painel).getByText('OPERADOR DE CAIXA').closest('.detail-item')!;
    expect(within(caixa as HTMLElement).getByText(/Atestado médico/)).toBeTruthy();
    expect(within(caixa as HTMLElement).getByText(/Falta injustificada/)).toBeTruthy();
  });

  // TESTE 7
  it('mostra a observação, e "Sem observação." quando não há', async () => {
    const { painel } = await abrirDetalhe();

    expect(within(painel).getByText('Associada apresentou atestado.')).toBeTruthy();
    expect(within(painel).getByText('Sem observação.')).toBeTruthy();
  });

  it('alterna entre Ocorrências e Todas as funções', async () => {
    const { user, painel } = await abrirDetalhe();

    // Ocorrências: só PADARIA e CAIXA.
    expect(painel.querySelectorAll('.detail-item')).toHaveLength(2);
    expect(within(painel).queryByText('ACOUGUEIRO')).toBeNull();

    await user.click(within(painel).getByRole('button', { name: 'Todas as funções' }));

    expect(painel.querySelectorAll('.detail-item')).toHaveLength(3);
    expect(within(painel).getByText('ACOUGUEIRO')).toBeTruthy();
  });

  it('fecha pelo botão e pela tecla Esc', async () => {
    const { user, painel } = await abrirDetalhe();

    await user.click(within(painel).getByRole('button', { name: 'Fechar detalhes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Ver detalhes de PARQUE SHOPPING' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('loja pendente abre o detalhe avisando que não enviou', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Ver detalhes de BAIRRO NOVO' }));
    const painel = await screen.findByRole('dialog');

    expect(
      within(painel).getByText('Esta loja ainda não enviou a conferência desta data.'),
    ).toBeTruthy();
  });
});

// TESTES 9, 10, 11 e 12
describe('Filtros e busca na tela', () => {
  it('Enviadas deixa só quem enviou', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Enviadas' }));

    expect(screen.getByText('PARQUE SHOPPING')).toBeTruthy();
    expect(screen.queryByText('BAIRRO NOVO')).toBeNull();
  });

  it('Pendentes deixa só quem não enviou', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Pendentes' }));

    expect(screen.getByText('BAIRRO NOVO')).toBeTruthy();
    expect(screen.queryByText('PARQUE SHOPPING')).toBeNull();
  });

  it('Com faltas deixa só quem tem falta', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Com faltas' }));

    expect(screen.getByText('PARQUE SHOPPING')).toBeTruthy();
    expect(screen.queryByText('BAIRRO NOVO')).toBeNull();
  });

  it('Sem faltas deixa só quem não tem', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Sem faltas' }));

    expect(screen.getByText('BAIRRO NOVO')).toBeTruthy();
    expect(screen.queryByText('PARQUE SHOPPING')).toBeNull();
  });

  it('busca por loja filtra a lista', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.type(screen.getByLabelText('Buscar função'), 'parque');

    expect(screen.getByText('PARQUE SHOPPING')).toBeTruthy();
    expect(screen.queryByText('BAIRRO NOVO')).toBeNull();
  });

  it('busca sem resultado explica que é o filtro, não a falta de lojas', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.type(screen.getByLabelText('Buscar função'), 'zzz');

    expect(screen.getByText('Nenhuma loja atende a esse filtro nesta data.')).toBeTruthy();
  });

  it('trocar de filtro NÃO vai ao banco de novo', async () => {
    const user = userEvent.setup();
    await renderPage();
    const idasAoBanco = datasPedidas.length;

    await user.click(screen.getByRole('button', { name: 'Pendentes' }));
    await user.click(screen.getByRole('button', { name: 'Todos' }));

    expect(datasPedidas).toHaveLength(idasAoBanco);
  });
});

// TESTE 13
describe('Referência padrão D-1', () => {
  it('abre automaticamente no dia anterior', async () => {
    await renderPage();

    const seletor = screen.getByLabelText('Referência') as HTMLInputElement;
    expect(seletor.value).toBe(REFERENCE_DATE);
    expect(datasPedidas[0]).toBe(REFERENCE_DATE);
  });

  it('o seletor não deixa escolher data futura', async () => {
    await renderPage();

    const seletor = screen.getByLabelText('Referência') as HTMLInputElement;
    const hoje = new Date();
    const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    expect(seletor.max).toBe(hojeIso);
  });

  it('o botão de dia anterior recarrega o dia certo', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Dia anterior' }));

    await waitFor(() => expect(datasPedidas).toHaveLength(2));
    // Um dia antes de D-1.
    const esperado = new Date(`${REFERENCE_DATE}T12:00:00`);
    esperado.setDate(esperado.getDate() - 1);
    const iso = `${esperado.getFullYear()}-${String(esperado.getMonth() + 1).padStart(2, '0')}-${String(esperado.getDate()).padStart(2, '0')}`;
    expect(datasPedidas[1]).toBe(iso);
  });

  it('em outra data sem conferência, todas as lojas ficam pendentes', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Dia anterior' }));

    await waitFor(() => expect(screen.getAllByText('Pendente')).toHaveLength(2));
  });
});

// TESTE 17
describe('Mobile não gera rolagem horizontal', () => {
  it('nenhum bloco da lista usa largura fixa maior que a tela', () => {
    // A lista não usa <table>: tabela real não reflui e força rolagem.
    // Aqui garantimos que a marcação é de grid/flex, que o CSS reflui em card.
    render(<SupervisorConferencesPage profile={SUPERVISOR} onBack={() => undefined} />);
    expect(document.querySelector('table')).toBeNull();
  });

  it('o CSS transforma a tabela em card e esconde o cabeçalho no celular', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/global.css', 'utf8');

    // Existe o ponto de virada para card.
    expect(css).toMatch(/@media \(max-width: 860px\)/);
    // No modo card o cabeçalho de colunas some...
    expect(css).toMatch(/\.network-list__head\s*\{\s*display:\s*none/);
    // ...e cada número passa a exibir o próprio rótulo.
    expect(css).toContain('content: attr(data-label)');
  });

  it('a lista carrega o rótulo de cada número para o modo card', async () => {
    await renderPage();

    const parque = linhaDa('PARQUE SHOPPING');
    const rotulos = within(parque)
      .getAllByRole('cell')
      .map((cell) => cell.getAttribute('data-label'))
      .filter(Boolean);

    expect(rotulos).toEqual(['Faltas', 'Folgas', 'Funções impactadas', 'Enviado às']);
  });

  it('só a fila de chips rola na horizontal — nunca a página', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/global.css', 'utf8');

    // Rolagem lateral só é aceitável DENTRO de um contêiner próprio e pequeno.
    // No corpo da página, nunca. Estes são os únicos autorizados:
    //   .chips              — a fila de filtros desta fase;
    //   .table-scroll       — o histórico do gerente, que já existia;
    //   .store-picker__list — as 34 filiais no login (fase 4), rolagem vertical
    //                         com a horizontal liberada por segurança;
    //   .focus-table__scroll — a tabela de lojas do drawer de foco (fase 4.2).
    //                         Em 390px ela vira card e nem rola; a rolagem
    //                         existe para as larguras intermediárias.
    const PERMITIDOS = ['chips', 'table-scroll', 'store-picker__list', 'focus-table__scroll', 'evolution__chart-wrapper'];

    const ocorrencias = [...css.matchAll(/overflow-x:\s*auto/g)];
    expect(ocorrencias.length).toBeGreaterThan(0);

    for (const ocorrencia of ocorrencias) {
      const antes = css.slice(0, ocorrencia.index);
      // Seletor do bloco em que a declaração está.
      const seletor = antes.slice(antes.lastIndexOf('}') + 1).trim().split('{')[0].trim();
      expect(
        PERMITIDOS.some((permitido) => seletor.includes(permitido)),
        `overflow-x em contêiner não autorizado: "${seletor}"`,
      ).toBe(true);
    }

    // E o corpo da página nunca ganha rolagem lateral.
    expect(css).not.toMatch(/(^|\})\s*body\s*\{[^}]*overflow-x:\s*(auto|scroll)/);
  });
});

describe('Navegação da home do supervisor', () => {
  it('CONFERÊNCIAS é um botão que abre a tela', async () => {
    const user = userEvent.setup();
    render(<SupervisorArea profile={SUPERVISOR} />);

    expect(screen.getByText('Painel Gerencial da Rede')).toBeTruthy();

    const cartao = screen.getByText('Conferências').closest('button')!;
    await user.click(cartao);

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    expect(screen.getByLabelText('Referência')).toBeTruthy();
  });

  /**
   * Atualizado na fase 3B: "Visão da Rede" deixou de ser um cartão morto com
   * "Em breve" e passou a abrir o dashboard analítico.
   */
  it('VISÃO DA REDE virou botão e não diz mais "Em breve"', () => {
    render(<SupervisorArea profile={SUPERVISOR} />);

    const visao = screen.getByText('Visão da Rede').closest('.home-card')!;
    expect((visao as HTMLElement).tagName.toLowerCase()).toBe('button');
    expect(within(visao as HTMLElement).queryByText('Em breve')).toBeNull();
    expect(within(visao as HTMLElement).getByText('Abrir')).toBeTruthy();
  });

  it('Voltar retorna para a home a partir de Conferências sem recarregar a página', async () => {
    const user = userEvent.setup();
    render(<SupervisorArea profile={SUPERVISOR} />);
    const enderecoInicial = window.location.href;

    await user.click(screen.getByText('Conferências').closest('button')!);
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: '← Voltar' }));

    expect(screen.getByText('Painel Gerencial da Rede')).toBeTruthy();
    expect(screen.getByText(/Supervisora Rede · Gerente Geral/)).toBeTruthy();
    expect(window.location.href).toBe(enderecoInicial);
  });

  it('Voltar retorna para a home a partir da Visão da Rede', async () => {
    const user = userEvent.setup();
    render(<SupervisorArea profile={SUPERVISOR} />);

    await user.click(screen.getByText('Visão da Rede').closest('button')!);
    await user.click(await screen.findByRole('button', { name: '← Voltar' }));

    expect(screen.getByText('Painel Gerencial da Rede')).toBeTruthy();
  });

  it('Administração abre a tela informativa e Voltar retorna para a home', async () => {
    const user = userEvent.setup();
    render(<SupervisorArea profile={ADMIN} />);

    await user.click(screen.getByText('Administração').closest('button')!);

    expect(screen.getByText('Recursos administrativos em breve.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Administração | Conferência de Quadro' }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '← Voltar' }));

    expect(screen.getByRole('heading', { name: 'Áreas' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '← Voltar' })).toBeNull();
  });

  it('a barra de abas destaca a tela atual', async () => {
    const user = userEvent.setup();
    render(<SupervisorArea profile={SUPERVISOR} />);

    await user.click(screen.getByText('Conferências').closest('button')!);
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

    const abas = screen.getByLabelText('Áreas do supervisor');
    const atual = within(abas).getByRole('button', { name: 'Conferências' });
    expect(atual.getAttribute('aria-current')).toBe('page');
    expect(
      within(abas).getByRole('button', { name: 'Visão da Rede' }).getAttribute('aria-current'),
    ).toBeNull();
  });
});

describe('Falha de leitura não quebra a tela', () => {
  it('mostra a mensagem do banco em vez de uma tela em branco', async () => {
    setStorageAdapter({
      name: 'Falha',
      getConference: async () => null,
      saveConference: async (c: DailyConference) => c,
      submitConference: async (c: DailyConference) => c,
      listConferences: async () => [],
      // Fase 4.5: o dublê não resolve justificativa — estas telas são de leitura.
      resolvePendingReason: async () => undefined,
      getNetworkDay: async () => {
        throw new Error('permission denied for view quadro_v_conference_items');
      },
      getNetworkRange: async () => ({ stores: [], conferences: [], items: [], reasons: [] }),
    });

    render(<SupervisorConferencesPage profile={SUPERVISOR} onBack={() => undefined} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('permission denied');
  });
});

describe('A tela é somente leitura', () => {
  it('não existe nenhum botão de editar, reabrir ou exportar', async () => {
    await renderPage();

    const botoes = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const proibidos = /editar|reabrir|excluir|exportar|salvar|enviar/i;

    expect(botoes.filter((texto) => proibidos.test(texto))).toEqual([]);
  });
});

describe('O serviço de rede não expõe escrita', () => {
  it('networkService só tem funções de leitura', async () => {
    const modulo = await import('@/services/networkService');
    expect(Object.keys(modulo).sort()).toEqual(['getNetworkDetail', 'loadNetworkDay']);
  });
});

// Mantém o vi importado em uso caso o arquivo evolua para espionar chamadas.
vi.setConfig({ testTimeout: 15000 });
