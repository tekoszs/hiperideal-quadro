// @vitest-environment jsdom
/**
 * FASE 4.5 — PRÉ-REGISTRO DE HOJE E JUSTIFICATIVA PENDENTE, na tela.
 *
 * O QUE ESTA FASE RESOLVE, na forma em que aparece:
 *
 *   Sábado, o associado falta. O gerente sabe da AUSÊNCIA, mas não do MOTIVO —
 *   o atestado chega na terça. Até aqui ele tinha duas saídas ruins: inventar
 *   um motivo, ou não enviar a conferência. E, se quisesse anotar a falta no
 *   próprio sábado para não depender da memória na segunda, não podia: hoje era
 *   recusado em qualquer caminho.
 *
 * Estes testes cobrem as duas metades na TELA. O que é regra de servidor —
 * gatilho, concorrência, separação de privilégios — está em
 * `pendingReason.integration.test.ts`, contra PostgreSQL de verdade, porque
 * jsdom não tem gatilho nem transação.
 *
 * O adaptador é o `LocalStorageAdapter` REAL, que espelha as mesmas recusas da
 * RPC — não um dublê que aceita tudo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DailyConference } from '@/types/domain';
import type { SessionProfile } from '@/types/auth';
import { LocalStorageAdapter, MemoryStore, setStorageAdapter } from '@/services/storage';
import { ManagerConferencePage } from '@/pages/ManagerConferencePage';
import { STORES } from '@/data/catalog';
import { PENDING_REASON_ID } from '@/data/absenceReasons';
import { conferenceViewState } from '@/domain/conferenceStatusView';
import {
  collectPendingJustifications,
  pendingQuantityOf,
  totalPendingQuantity,
  waitingDaysSince,
} from '@/domain/pendingJustification';
import { formatBrDate, shiftIsoDate, toIsoDate } from '@/utils/date';

const HOJE = toIsoDate(new Date());
const ANTEONTEM = shiftIsoDate(HOJE, -2);

const LOJA = STORES[0].id;
const CAIXA = 'pos-operador-de-caixa';
const ATESTADO = 'reason-atestado-medico';

const GERENTE: SessionProfile = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Gerente de Teste',
  role: 'MANAGER',
  storeId: LOJA,
  active: true,
  email: null,
  accessScope: 'STORE',
  districtId: null,
  jobTitle: 'Gerente de Loja',
};

let store: MemoryStore;

interface SemearParams {
  status: 'SUBMITTED' | 'DRAFT';
  absences?: number;
  pending?: number;
  positionId?: string;
}

/** Escreve uma conferência direto na memória do adaptador. */
function semear(referenceDate: string, params: SemearParams) {
  const { status, absences = 0, pending = 0, positionId = CAIXA } = params;
  const bruto = store.getItem('hiperideal.quadro.conferences.v1');
  const todas: Record<string, DailyConference> = bruto ? JSON.parse(bruto) : {};

  const reasons = [];
  if (absences - pending > 0) {
    reasons.push({
      id: `r-atestado-${referenceDate}`,
      reasonId: ATESTADO,
      quantity: absences - pending,
      observation: null,
    });
  }
  if (pending > 0) {
    reasons.push({
      id: `r-aguardando-${referenceDate}`,
      reasonId: PENDING_REASON_ID,
      quantity: pending,
      observation: null,
    });
  }

  todas[`${LOJA}::${referenceDate}`] = {
    id: `conf-${referenceDate}`,
    storeId: LOJA,
    referenceDate,
    status,
    createdBy: GERENTE.id,
    submittedBy: status === 'SUBMITTED' ? GERENTE.id : null,
    createdAt: `${referenceDate}T09:00:00.000Z`,
    updatedAt: `${referenceDate}T11:00:00.000Z`,
    submittedAt: status === 'SUBMITTED' ? `${referenceDate}T11:00:00.000Z` : null,
    items: [
      {
        id: `item-${referenceDate}`,
        positionId,
        absenceQuantity: absences,
        dayOffQuantity: 0,
        observation: null,
        reasons,
      },
    ],
  } as DailyConference;

  store.setItem('hiperideal.quadro.conferences.v1', JSON.stringify(todas));
}

/**
 * A janela quase toda enviada, com ONTEM em aberto.
 *
 * Ontem fica pendente de propósito: é assim que a tela abre numa conferência
 * EDITÁVEL, que é o estado normal do gerente. Com tudo enviado, a tela abriria
 * bloqueada e os testes mediriam o caso raro.
 */
function semearSemanaEnviada() {
  for (let i = 2; i <= Number(HOJE.slice(8)); i += 1) {
    semear(shiftIsoDate(HOJE, -i), { status: 'SUBMITTED' });
  }
}

function gravadas(): Record<string, DailyConference> {
  const bruto = store.getItem('hiperideal.quadro.conferences.v1');
  return bruto ? JSON.parse(bruto) : {};
}

beforeEach(() => {
  store = new MemoryStore();
  setStorageAdapter(new LocalStorageAdapter(store));
});

afterEach(() => {
  cleanup();
  setStorageAdapter(null);
});

async function abrirTela() {
  render(<ManagerConferencePage profile={GERENTE} />);
  await waitFor(() => expect(screen.getByLabelText('Data da conferência')).toBeTruthy(), {
    timeout: 8000,
  });
  return userEvent.setup();
}

const botaoDeHoje = () =>
  screen.getByRole('button', { name: 'Registrar ocorrências de hoje' });
const titulo = () => document.querySelector('.conf-head') as HTMLElement;
const chips = () =>
  within(screen.getByRole('grid', { name: /setembro|agosto|outubro/i })).getAllByRole('button');

/* =========================================================================
 * O pré-registro de hoje
 * ====================================================================== */

describe('Pré-registro de hoje', { timeout: 30000 }, () => {
  it('a tela oferece o registro de hoje pelo calendário e por atalho', async () => {
    semearSemanaEnviada();
    await abrirTela();

    expect(botaoDeHoje()).toBeTruthy();
    // Ele começa desligado: a tela abre na conferência, não no pré-registro.
    expect(botaoDeHoje().getAttribute('aria-pressed')).toBe('false');
  });

  /**
   * HOJE NÃO É O OITAVO CHIP. A fila responde "o que falta ENVIAR?", e hoje não
   * pode ser enviado — misturá-lo ali faria o gerente tentar enviar um dia que
   * ainda não terminou.
   */
  it('hoje aparece na grade e não conta como concluído', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    expect(chips()).toHaveLength(30);
    expect(screen.getByRole('button', { name: /hoje, pré-registro/i })).toBeTruthy();

    // E continua fora depois de entrar no pré-registro.
    await user.click(botaoDeHoje());
    await waitFor(() => expect(titulo().textContent).toContain('Pré-registro de hoje'));
    expect(chips()).toHaveLength(30);
    expect(screen.getByRole('button', { name: /hoje, pré-registro/i })).toBeTruthy();
  }, 15000);

  it('o modo pré-registro muda o título, mostra a data de hoje e explica o que é', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    await user.click(botaoDeHoje());

    await waitFor(() => expect(titulo().textContent).toContain('Pré-registro de hoje'));
    // A data continua grande e visível: no pré-registro ela importa igual.
    expect(titulo().textContent).toContain(formatBrDate(HOJE));
    expect(
      within(titulo()).getByText(
        'Este é um pré-registro. A conferência oficial poderá ser enviada posteriormente.',
      ),
    ).toBeTruthy();
    expect(botaoDeHoje().getAttribute('aria-pressed')).toBe('true');
  });

  /**
   * SEM BOTÃO DE ENVIAR — escondido, não desabilitado. Um botão cinza faz o
   * gerente tentar, falhar e procurar o que está errado.
   */
  it('no pré-registro não existe "Finalizar conferência"', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    expect(screen.getByRole('button', { name: 'Finalizar conferência' })).toBeTruthy();

    await user.click(botaoDeHoje());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Finalizar conferência' })).toBeNull(),
    );

    // Salvar continua: é exatamente o que o pré-registro faz.
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeTruthy();
    expect(screen.getByText(/poderá ser enviada a partir de amanhã/i)).toBeTruthy();
  });

  it('salva o pré-registro como DRAFT na data de hoje', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    await user.click(botaoDeHoje());
    await waitFor(() => expect(titulo().textContent).toContain('Pré-registro de hoje'));

    const linha = screen.getByText('OPERADOR DE CAIXA').closest('.position-row') as HTMLElement;
    const faltas = within(linha).getByLabelText('Faltas em OPERADOR DE CAIXA');
    await user.clear(faltas);
    await user.type(faltas, '1');

    const rotulo = `Aguardando justificativa em ${CAIXA}`;
    await waitFor(() => expect(within(linha).getByLabelText(rotulo)).toBeTruthy());
    const provisorio = within(linha).getByLabelText(rotulo);
    await user.clear(provisorio);
    await user.type(provisorio, '1');

    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(gravadas()[`${LOJA}::${HOJE}`]).toBeTruthy());

    const salva = gravadas()[`${LOJA}::${HOJE}`];
    expect(salva.status).toBe('DRAFT');
    expect(salva.referenceDate).toBe(HOJE);
    expect(pendingQuantityOf(salva.items.find((i) => i.positionId === CAIXA)!)).toBe(1);
  }, 15000);

  /**
   * A VIRADA DO DIA — o mesmo registro, com o mesmo id.
   *
   * Amanhã ele não é copiado, migrado nem recriado: a mesma linha simplesmente
   * deixa de ser "hoje", e a tela passa a chamá-la de rascunho. O banco não
   * ganha status novo, e `unique (store_id, reference_date)` garante que não
   * exista uma segunda conferência para a mesma data.
   */
  it('a virada do dia só muda a LEITURA — mesmo id, mesmo status', () => {
    // Hoje, o mesmo DRAFT é apresentado como pré-registro.
    expect(conferenceViewState('DRAFT', true)).toBe('PRE_REGISTRATION');
    // Amanhã, a mesma linha vira rascunho. Nada foi gravado no meio.
    expect(conferenceViewState('DRAFT', false)).toBe('DRAFT');
    // E uma conferência enviada nunca é lida como pré-registro.
    expect(conferenceViewState('SUBMITTED', true)).toBe('SUBMITTED');
  });

  it('reabrir o pré-registro carrega o que já tinha, sem criar outra conferência', async () => {
    semearSemanaEnviada();
    semear(HOJE, { status: 'DRAFT', absences: 2, pending: 2 });
    const user = await abrirTela();

    await user.click(botaoDeHoje());
    await waitFor(() => expect(titulo().textContent).toContain('Pré-registro de hoje'));

    const linha = screen.getByText('OPERADOR DE CAIXA').closest('.position-row') as HTMLElement;
    const faltas = within(linha).getByLabelText(
      'Faltas em OPERADOR DE CAIXA',
    ) as HTMLInputElement;
    expect(faltas.value).toBe('2');

    // Uma chave só para hoje: nada de segunda conferência na mesma data.
    expect(Object.keys(gravadas()).filter((k) => k.endsWith(`::${HOJE}`))).toHaveLength(1);
    expect(gravadas()[`${LOJA}::${HOJE}`].id).toBe(`conf-${HOJE}`);
  });
});

/* =========================================================================
 * Aguardando justificativa, no painel de motivos
 * ====================================================================== */

describe('O motivo provisório na tela', () => {
  it('aparece como motivo, em âmbar, e explica o que significa', async () => {
    semearSemanaEnviada();
    semear(ANTEONTEM, { status: 'DRAFT', absences: 1, pending: 1 });
    await abrirTela();

    const linha = screen.getByText('OPERADOR DE CAIXA').closest('.position-row') as HTMLElement;

    // Entra na soma como qualquer outro motivo: 1 de 1, conferência válida.
    expect(within(linha).getByText('Motivos informados: 1 de 1')).toBeTruthy();

    const provisorio = within(linha)
      .getByText('Aguardando justificativa')
      .closest('.reason-row') as HTMLElement;
    expect(provisorio.className).toContain('reason-row--pending');

    expect(within(linha).getByText(/1 falta aguardando justificativa/i)).toBeTruthy();
    expect(
      within(linha).getByText(/poderá ser atualizado posteriormente/i),
    ).toBeTruthy();
  });
});

/* =========================================================================
 * Resolver a justificativa depois do envio
 * ====================================================================== */

describe('Resolver justificativa de conferência enviada', () => {
  it('a tela lista a pendência com data, função, quantidade e dias de espera', async () => {
    semearSemanaEnviada();
    semear(ANTEONTEM, { status: 'SUBMITTED', absences: 1, pending: 1 });
    await abrirTela();

    const painel = screen.getByRole('region', { name: 'Pendências de justificativa' });
    expect(within(painel).getByText('1 pendência')).toBeTruthy();
    expect(within(painel).getByText(formatBrDate(ANTEONTEM))).toBeTruthy();
    expect(within(painel).getByText('OPERADOR DE CAIXA')).toBeTruthy();
    expect(within(painel).getByText('1 falta')).toBeTruthy();
    expect(within(painel).getByText('Aguardando há 2 dias')).toBeTruthy();
  });

  it('não mostra pendência de RASCUNHO — ali o gerente só troca o motivo e salva', async () => {
    semearSemanaEnviada();
    semear(ANTEONTEM, { status: 'DRAFT', absences: 1, pending: 1 });
    await abrirTela();

    expect(screen.queryByRole('region', { name: 'Pendências de justificativa' })).toBeNull();
  });

  /**
   * O CAMINHO INTEIRO: terça-feira, o atestado chega, o gerente troca o motivo.
   * A conferência NÃO é reaberta e o total de faltas não muda.
   */
  it('troca o motivo sem reabrir a conferência e sem mexer no total de faltas', async () => {
    semearSemanaEnviada();
    semear(ANTEONTEM, { status: 'SUBMITTED', absences: 2, pending: 1 });
    const user = await abrirTela();

    const antes = gravadas()[`${LOJA}::${ANTEONTEM}`].items[0];
    expect(antes.absenceQuantity).toBe(2);

    const painel = screen.getByRole('region', { name: 'Pendências de justificativa' });
    await user.click(within(painel).getAllByRole('button')[0]);

    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText('Ajustar justificativa pendente')).toBeTruthy();
    expect(within(modal).getByText('OPERADOR DE CAIXA')).toBeTruthy();

    await user.selectOptions(within(modal).getByLabelText('Motivo definitivo'), ATESTADO);
    await user.click(within(modal).getByRole('button', { name: 'Confirmar alteração' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Pendências de justificativa' })).toBeNull(),
    );

    const depois = gravadas()[`${LOJA}::${ANTEONTEM}`];
    const item = depois.items[0];

    // O que MUDOU: só o motivo.
    expect(item.reasons.map((r) => [r.reasonId, r.quantity])).toEqual([[ATESTADO, 2]]);
    // O que NÃO mudou: tudo o mais.
    expect(item.absenceQuantity).toBe(2);
    expect(item.dayOffQuantity).toBe(antes.dayOffQuantity);
    expect(depois.status).toBe('SUBMITTED');
    expect(depois.referenceDate).toBe(ANTEONTEM);
    expect(depois.id).toBe(`conf-${ANTEONTEM}`);
  });

  it('o modal recusa observação vazia quando o destino é "Outros"', async () => {
    semearSemanaEnviada();
    semear(ANTEONTEM, { status: 'SUBMITTED', absences: 1, pending: 1 });
    const user = await abrirTela();

    const painel = screen.getByRole('region', { name: 'Pendências de justificativa' });
    await user.click(within(painel).getAllByRole('button')[0]);

    const modal = await screen.findByRole('dialog');
    await user.selectOptions(
      within(modal).getByLabelText('Motivo definitivo'),
      'reason-outros',
    );

    const confirmar = within(modal).getByRole('button', {
      name: 'Confirmar alteração',
    }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    expect(within(modal).getByText(/exige observação/i)).toBeTruthy();

    await user.type(within(modal).getByLabelText(/Observação/), 'Apurado com o RH');
    await waitFor(() => expect(confirmar.disabled).toBe(false));
  });
});

/* =========================================================================
 * As contas puras
 * ====================================================================== */

describe('As pendências, sem tela', () => {
  const conferencia = (
    referenceDate: string,
    status: 'SUBMITTED' | 'DRAFT',
    pending: number,
  ): DailyConference =>
    ({
      id: `c-${referenceDate}`,
      storeId: LOJA,
      referenceDate,
      status,
      createdBy: 'x',
      submittedBy: null,
      createdAt: 'x',
      updatedAt: 'x',
      submittedAt: null,
      items: [
        {
          id: `i-${referenceDate}`,
          positionId: CAIXA,
          absenceQuantity: pending,
          dayOffQuantity: 0,
          observation: null,
          reasons: pending
            ? [{ id: 'r', reasonId: PENDING_REASON_ID, quantity: pending, observation: null }]
            : [],
        },
      ],
    }) as DailyConference;

  const SEGUNDA = new Date(2026, 8, 7, 12, 0, 0);

  it('só conferência ENVIADA vira pendência de justificativa', () => {
    const pendencias = collectPendingJustifications(
      [
        conferencia('2026-09-05', 'SUBMITTED', 1),
        conferencia('2026-09-06', 'DRAFT', 3),
      ],
      SEGUNDA,
    );

    expect(pendencias).toHaveLength(1);
    expect(pendencias[0].referenceDate).toBe('2026-09-05');
  });

  it('vêm da mais antiga para a mais recente', () => {
    const pendencias = collectPendingJustifications(
      [
        conferencia('2026-09-06', 'SUBMITTED', 1),
        conferencia('2026-09-02', 'SUBMITTED', 1),
        conferencia('2026-09-04', 'SUBMITTED', 1),
      ],
      SEGUNDA,
    );

    expect(pendencias.map((p) => p.referenceDate)).toEqual([
      '2026-09-02',
      '2026-09-04',
      '2026-09-06',
    ]);
  });

  it('conta as faltas, não as linhas', () => {
    const pendencias = collectPendingJustifications(
      [conferencia('2026-09-05', 'SUBMITTED', 3), conferencia('2026-09-06', 'SUBMITTED', 2)],
      SEGUNDA,
    );

    expect(pendencias).toHaveLength(2);
    expect(totalPendingQuantity(pendencias)).toBe(5);
  });

  it('os dias de espera contam do dia da falta até hoje, e nunca ficam negativos', () => {
    expect(waitingDaysSince('2026-09-07', SEGUNDA)).toBe(0);
    expect(waitingDaysSince('2026-09-06', SEGUNDA)).toBe(1);
    expect(waitingDaysSince('2026-08-31', SEGUNDA)).toBe(7);
    // Data no futuro não produz "-1 dias".
    expect(waitingDaysSince('2026-09-09', SEGUNDA)).toBe(0);
  });

  it('conferência sem motivo provisório não gera pendência', () => {
    expect(
      collectPendingJustifications([conferencia('2026-09-05', 'SUBMITTED', 0)], SEGUNDA),
    ).toEqual([]);
  });
});
