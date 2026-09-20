// @vitest-environment jsdom
/**
 * FASE 4.3 — CONFERÊNCIA POR DATA DE REFERÊNCIA.
 *
 * O PROBLEMA, na forma em que ele aparece:
 *
 *   Segunda-feira, 07/09. O gerente precisa conferir o SÁBADO (05/09) e o
 *   DOMINGO (06/09). Com D-1 fixo, a tela só oferecia o domingo — e o sábado
 *   ficava inalcançável, sem nenhuma forma de regularizar.
 *
 * O CENÁRIO DESTES TESTES É ESSE, montado sobre o dia de hoje: os dias mais
 * antigos da janela já enviados, e os dois últimos em aberto. O porquê de não
 * congelar o relógio está explicado no bloco "O cenário", logo abaixo.
 *
 * O adaptador é o `LocalStorageAdapter` REAL, sobre memória — não um dublê. Ele
 * já implementa a chave `loja::data`, a recusa de editar conferência enviada e
 * a listagem por loja. Testar contra ele é testar o caminho que roda.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DailyConference } from '@/types/domain';
import type { SessionProfile } from '@/types/auth';
import { LocalStorageAdapter, MemoryStore, setStorageAdapter } from '@/services/storage';
import {
  InvalidReferenceDateError,
  TodayNotSubmittableError,
  loadOrCreateConference,
  saveDraft,
  submitConference,
} from '@/services/conferenceService';
import {
  buildReferenceDates,
  isMonthlyRecordableDate,
  monthCalendarDates,
  isSelectableReferenceDate,
  nextPendingAfter,
  pendingReferenceDates,
  REFERENCE_WINDOW_DAYS,
  selectableReferenceDates,
  shortDateLabel,
  suggestedReferenceDate,
} from '@/domain/referenceWindow';
import { ManagerConferencePage } from '@/pages/ManagerConferencePage';
import App from '@/App';
import { STORES, POSITIONS } from '@/data/catalog';
import { getActiveReasons } from '@/data/absenceReasons';
import {
  businessToday,
  formatBrDate,
  formatLongBrDate,
  shiftIsoDate,
  toIsoDate,
  weekdayName,
} from '@/utils/date';

/* =========================================================================
 * O cenário
 * ====================================================================== */

/**
 * A HISTÓRIA é a segunda-feira; as DATAS são relativas ao dia de hoje.
 *
 * Por que não congelar o relógio numa segunda-feira de verdade: o serviço
 * valida a data contra o relógio REAL (`assertSelectableDate`), de propósito —
 * é a barreira que não confia na tela. Congelar o relógio só do React deixaria
 * a tela numa segunda-feira e o serviço em outro dia, e o teste passaria a
 * medir a discordância entre os dois em vez do comportamento.
 *
 * Então o cenário é montado sobre o hoje real:
 *
 *   D-7 .. D-3   já enviadas   (os dias de semana)
 *   D-2          PENDENTE      (o "sábado" da história)
 *   D-1          PENDENTE      (o "domingo")
 *
 * A mecânica é idêntica, o teste não envelhece, e o que depende de dia da
 * semana de verdade — os rótulos SÁB/DOM — está testado no bloco "A janela de
 * datas", onde o `today` é injetado livremente porque não há serviço no meio.
 */
const HOJE = toIsoDate(new Date());
/** O "domingo" da história: a pendência mais recente. */
const RECENTE = shiftIsoDate(HOJE, -1);
/** O "sábado": a pendência mais ANTIGA, que a tela deve abrir. */
const ANTIGA = shiftIsoDate(HOJE, -2);
const FUTURO = shiftIsoDate(HOJE, 1);

/**
 * Dias elegíveis do mês: do primeiro dia do mês até ontem.
 * Equivale ao cálculo do `monthlyProgress` no frontend.
 */
const ELIGIVEIS = Number(HOJE.slice(8)) - 1;

const LOJA = STORES[0].id; // store-124
const CAIXA = 'pos-operador-de-caixa';
const INJUSTIFICADA = 'reason-falta-injustificada';

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

/** Escreve uma conferência direto na memória do adaptador. */
function semear(
  referenceDate: string,
  status: 'SUBMITTED' | 'DRAFT',
  absences = 0,
) {
  const bruto = store.getItem('hiperideal.quadro.conferences.v1');
  const todas: Record<string, DailyConference> = bruto ? JSON.parse(bruto) : {};

  todas[`${LOJA}::${referenceDate}`] = {
    id: `${status.toLowerCase()}-${referenceDate}`,
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
        positionId: CAIXA,
        absenceQuantity: absences,
        dayOffQuantity: 0,
        observation: null,
        reasons:
          absences > 0
            ? [
                {
                  id: `reason-${referenceDate}`,
                  reasonId: INJUSTIFICADA,
                  quantity: absences,
                  observation: null,
                },
              ]
            : [],
      },
    ],
  } as DailyConference;

  store.setItem('hiperideal.quadro.conferences.v1', JSON.stringify(todas));
}

/**
 * Os dias mais antigos da janela já enviados.
 *
 * Sem isto TODAS as 7 datas ficariam pendentes e a "mais antiga" seria D-7 —
 * correto pela regra, mas não é o caso que o gerente vive na segunda-feira.
 */
function semearSemanaEnviada() {
  for (let i = 3; i <= Number(HOJE.slice(8)); i += 1) {
    semear(shiftIsoDate(HOJE, -i), 'SUBMITTED');
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

const seletorDeData = () =>
  document.querySelector('.monthly-calendar__day[aria-current="date"]') as HTMLButtonElement;

/**
 * O texto dos chips que ainda faltam enviar, na ordem em que aparecem.
 *
 * A fase 4.4 passou a mostrar a JANELA INTEIRA em chips — o que falta e o que
 * já foi — então a fila deixou de ser só das pendências. O que este helper
 * devolve continua sendo o mesmo de antes: as pendências, mais antiga primeiro.
 */
const chipsPendentes = () =>
  within(screen.getByRole('grid', { name: /setembro|agosto|outubro/i }))
    .getAllByRole('button')
    .filter((b) =>
      b.classList.contains('monthly-calendar__day--pending') ||
      b.classList.contains('monthly-calendar__day--draft') ||
      b.classList.contains('monthly-calendar__day--reopened'),
    )
    .map((b) => `${shortDateLabel(b.getAttribute('data-date') ?? '')} ${b.getAttribute('title') ?? ''}`);

/** Só as pendências existem enquanto houver o quê enviar. */
const tituloDePendencias = () => screen.queryByText(/conferências? pendentes?$/i);

const chipsDaFila = () =>
  within(screen.getByRole('grid', { name: /setembro|agosto|outubro/i })).getAllByRole('button');

/** As datas ISO dos chips, na ordem em que estão na fila. */
const datasDosChips = () =>
  chipsDaFila().map((b) => b.getAttribute('data-date') ?? '');

/** A janela em ordem cronológica crescente: D-7 primeiro, D-1 por último. */
const janelaCronologica = () =>
  monthCalendarDates(HOJE.slice(0, 7)).filter((date): date is string => date !== null);

/** Lança 1 falta no caixa, com motivo, para a conferência ficar válida. */
async function preencherUmaFalta(user: ReturnType<typeof userEvent.setup>) {
  const linha = screen.getByText('OPERADOR DE CAIXA').closest('.position-row') as HTMLElement;
  const faltas = within(linha).getByLabelText('Faltas em OPERADOR DE CAIXA');
  await user.clear(faltas);
  await user.type(faltas, '1');

  // O rótulo do campo de motivo é "<motivo> em <positionId>"; o nome do motivo
  // sozinho também aparece como texto visível ao lado.
  const rotuloMotivo = `Falta injustificada em ${CAIXA}`;
  await waitFor(() => expect(within(linha).getByLabelText(rotuloMotivo)).toBeTruthy());
  const motivo = within(linha).getByLabelText(rotuloMotivo);
  await user.clear(motivo);
  await user.type(motivo, '1');
}

/** Finaliza e confirma o envio. */
async function enviar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Finalizar conferência' }));
  await user.click(await screen.findByRole('button', { name: 'Enviar conferência' }));
}

/* =========================================================================
 * A) até H), J), K), O) — a tela
 * ====================================================================== */

describe('Segunda-feira com o fim de semana pendente', { timeout: 30000 }, () => {
  /**
   * REGRESSÃO — a tela dizia uma data e o formulário outra.
   *
   * Na fase 4.3 o `App` calculava D-1 por conta própria para o cabeçalho verde.
   * Com a escolha de data, o cabeçalho anunciava "domingo" enquanto o gerente
   * preenchia o sábado: dois números diferentes na mesma tela para a mesma
   * coisa. Pego olhando a tela num navegador, não pelos testes.
   *
   * A FASE 4.4 MUDOU O LUGAR DA DATA, não a regressão. Ela saiu do cabeçalho e
   * virou o TÍTULO do conteúdo, e o cabeçalho não fala mais de data nenhuma —
   * é por isso que este teste agora cobra três coisas de uma vez:
   *
   *   1. o título anuncia a mesma data do seletor;
   *   2. e a mesma data da conferência carregada (o dado que será gravado);
   *   3. e o cabeçalho não repete data alguma — a duplicação que originou o bug
   *      não pode voltar por descuido.
   */
  it('título, seletor e conferência carregada usam a MESMA data', async () => {
    semearSemanaEnviada();

    // Renderiza o APP inteiro: o cabeçalho mora nele, não na página. No modo
    // demonstração o perfil é gerente da store-124 — o mesmo desta suíte.
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Data da conferência')).toBeTruthy(), {
      timeout: 8000,
    });
    const user = userEvent.setup();

    const titulo = () => document.querySelector('.conf-head')?.textContent ?? '';
    const cabecalho = () => document.querySelector('.app-header')?.textContent ?? '';
    /** A linha da função lê o item da conferência que está de fato carregada. */
    const faltasCarregadas = () =>
      (screen.getByLabelText('Faltas em OPERADOR DE CAIXA') as HTMLInputElement).value;

    expect(seletorDeData().value).toBe(ANTIGA);
    expect(titulo()).toContain(formatBrDate(ANTIGA));
    expect(titulo()).not.toContain(formatBrDate(RECENTE));
    // Semeado com 0 faltas; a outra data nem existe ainda.
    expect(faltasCarregadas()).toBe('0');

    // O cabeçalho não anuncia data: uma fonte só, nada a divergir.
    expect(cabecalho()).not.toContain(formatBrDate(ANTIGA));
    expect(cabecalho()).not.toContain(formatBrDate(RECENTE));

    await user.click(
      screen.getByRole('button', { name: `Conferência de ${formatLongBrDate(RECENTE)}` }),
    );

    await waitFor(() => expect(titulo()).toContain(formatBrDate(RECENTE)));
    expect(titulo()).not.toContain(formatBrDate(ANTIGA));
    expect(seletorDeData().value).toBe(RECENTE);
    expect(cabecalho()).not.toContain(formatBrDate(RECENTE));
  }, 15000);

  /**
   * O TÍTULO É A DATA. Ela é a informação que o gerente confere antes de
   * digitar qualquer número, e lançar o sábado no domingo é o erro caro.
   */
  it('o título traz a data, o dia da semana e o status da conferência', async () => {
    semearSemanaEnviada();
    await abrirTela();

    const titulo = document.querySelector('.conf-head') as HTMLElement;
    expect(titulo.textContent).toContain(`Conferência de ${formatBrDate(ANTIGA)}`);
    expect(titulo.textContent).toContain(weekdayName(ANTIGA));
    // PENDENTE: existe a data, não existe conferência enviada nela.
    expect(within(titulo).getByText('pendente')).toBeTruthy();
    expect(within(titulo).getByText('Esta conferência ainda não foi enviada.')).toBeTruthy();
  });

  it('o título usa a frase certa para cada status', async () => {
    semearSemanaEnviada();
    semear(ANTIGA, 'DRAFT', 2);
    await abrirTela();

    const titulo = () => document.querySelector('.conf-head') as HTMLElement;
    expect(
      within(titulo()).getByText('Rascunho salvo. Você pode continuar o preenchimento.'),
    ).toBeTruthy();
    expect(within(titulo()).getByText('rascunho')).toBeTruthy();

    // A mesma tela, numa data já enviada: outra frase, outro selo.
    fireEvent.click(screen.getByRole('button', { name: `Conferência de ${formatLongBrDate(shiftIsoDate(HOJE, -3))}` }));
    await waitFor(() =>
      expect(within(titulo()).getByText(/Conferência enviada em \d{2}\/\d{2} às \d{2}:\d{2}/))
        .toBeTruthy(),
    );
    expect(within(titulo()).getByText('enviada')).toBeTruthy();
  });

  /**
   * O PROGRESSO DA JANELA. "2 pendentes" responde o que falta; "5 de 7
   * concluídas" responde o tamanho do buraco. Quem volta de férias precisa das
   * duas respostas.
   */
  it('mostra o progresso da janela, e ele anda a cada envio', async () => {
    semearSemanaEnviada(); // D-3..D-(day) enviadas
    // D-1 fica em RASCUNHO: começado NÃO é concluído. Um rascunho que contasse
    // como concluído diria ao gerente que ele está mais em dia do que está.
    semear(RECENTE, 'DRAFT', 1);
    const user = await abrirTela();

    expect(screen.getByText(`${ELIGIVEIS - 2} de ${ELIGIVEIS} dias elegíveis`)).toBeTruthy();

    await preencherUmaFalta(user);
    await enviar(user);

    await waitFor(() =>
      expect(screen.getByText(`${ELIGIVEIS - 1} de ${ELIGIVEIS} dias elegíveis`)).toBeTruthy(),
    );
  }, 15000);

  /**
   * A janela inteira em chips: o que falta e o que já foi. Sem os enviados, a
   * tela responderia "o que falta?" e ficaria muda sobre "quanto já fiz?".
   */
  it('os chips cobrem a janela inteira, com a situação de cada data', async () => {
    semearSemanaEnviada();
    await abrirTela();

    expect(datasDosChips()).toEqual(janelaCronologica());
    expect(chipsDaFila().filter((c) => c.classList.contains('monthly-calendar__day--submitted'))).toHaveLength(ELIGIVEIS - 2);
    expect(chipsDaFila().filter((c) => c.classList.contains('monthly-calendar__day--pending'))).toHaveLength(2);
  });

  /**
   * REGRESSÃO — enviar uma conferência NÃO pode mexer no lugar do chip.
   *
   * Enquanto a fila era ordenada por pendência, o dia que acabava de ser enviado
   * deixava de ser pendência e PULAVA para outro ponto da fila: o gerente via
   * sumir da frente exatamente o chip em que tinha acabado de trabalhar, e outro
   * dia tomar o lugar. Datas são uma sequência temporal — a posição de cada uma
   * é aprendida, e tem de ser estável.
   *
   * Enviar muda a COR e a PALAVRA do chip. Não muda a posição.
   */
  it('enviar muda o status do chip, nunca a posição dele na fila', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    const ordemAntes = datasDosChips();
    expect(ordemAntes).toEqual(janelaCronologica());

    const chipDaEnviada = () =>
      screen.getByRole('button', { name: `Conferência de ${formatLongBrDate(ANTIGA)}` });

    const posicaoAntes = ordemAntes.indexOf(ANTIGA);
    expect(chipDaEnviada().classList.contains('monthly-calendar__day--pending')).toBe(true);
    expect(chipDaEnviada().classList.contains('monthly-calendar__day--submitted')).toBe(false);

    await preencherUmaFalta(user);
    await enviar(user);
    await waitFor(() => expect(gravadas()[`${LOJA}::${ANTIGA}`].status).toBe('SUBMITTED'));

    // O status mudou...
    await waitFor(() => expect(chipDaEnviada().classList.contains('monthly-calendar__day--submitted')).toBe(true));
    expect(chipDaEnviada().classList.contains('monthly-calendar__day--pending')).toBe(false);

    // ...e a fila continua exatamente a mesma, na mesma ordem.
    expect(datasDosChips()).toEqual(ordemAntes);
    expect(datasDosChips().indexOf(ANTIGA)).toBe(posicaoAntes);
  }, 15000);

  /**
   * ACESSIBILIDADE — a data aberta não pode ser reconhecível só pela cor.
   */
  it('a data selecionada é anunciada e marcada além da cor', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    const chipDe = (date: string) =>
      screen.getByRole('button', { name: `Conferência de ${formatLongBrDate(date)}` });

    expect(chipDe(ANTIGA).getAttribute('aria-current')).toBe('date');
    expect(chipDe(ANTIGA).getAttribute('aria-current')).toBe('date');
    expect(chipDe(RECENTE).getAttribute('aria-current')).toBeNull();

    expect(chipDe(ANTIGA).getAttribute('title')).toMatch(/pendente/i);

    await user.click(chipDe(RECENTE));
    await waitFor(() => expect(chipDe(RECENTE).getAttribute('aria-current')).toBe('date'));
    expect(chipDe(ANTIGA).getAttribute('aria-current')).toBeNull();
  }, 15000);

  // TESTE A
  it('A. mostra as duas datas em aberto como conferências pendentes', async () => {
    semearSemanaEnviada();
    await abrirTela();

    const chips = chipsPendentes();
    expect(chips).toHaveLength(2);
    expect(chips[0]).toContain(shortDateLabel(ANTIGA)); // o "sábado"
    expect(chips[1]).toContain(shortDateLabel(RECENTE)); // o "domingo"
    expect(within(screen.getByLabelText('Resumo das conferências')).getByText('2', { exact: true })).toBeTruthy();
  });

  // TESTE O
  it('O. abre na pendência MAIS ANTIGA, não em D-1', async () => {
    semearSemanaEnviada();
    await abrirTela();

    expect(seletorDeData().value).toBe(ANTIGA);
    expect(seletorDeData().value).not.toBe(RECENTE);
  });

  // TESTE B
  it('B. clicar num chip seleciona aquela data', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    const chipRecente = screen.getByRole('button', {
      name: `Conferência de ${formatLongBrDate(RECENTE)}`,
    });
    await user.click(chipRecente);
    await waitFor(() => expect(seletorDeData().value).toBe(RECENTE));

    const chipAntiga = screen.getByRole('button', {
      name: `Conferência de ${formatLongBrDate(ANTIGA)}`,
    });
    await user.click(chipAntiga);
    await waitFor(() => expect(seletorDeData().value).toBe(ANTIGA));
  });

  // TESTE C
  it('C. o rascunho é salvo NA DATA selecionada, e só nela', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    await preencherUmaFalta(user);
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    // Fase 4.4: o aviso é discreto e traz a hora, em vez de uma faixa verde
    // atravessando a tela de quem ainda está preenchendo.
    await waitFor(() =>
      expect(screen.getByText(/^Rascunho salvo às \d{2}:\d{2}$/)).toBeTruthy(),
    );

    const todas = gravadas();
    expect(todas[`${LOJA}::${ANTIGA}`].referenceDate).toBe(ANTIGA);
    expect(todas[`${LOJA}::${ANTIGA}`].status).toBe('DRAFT');
    // E não encostou na outra data pendente.
    expect(todas[`${LOJA}::${RECENTE}`]).toBeUndefined();
  });

  // TESTE D
  it('D. enviar risca a data da lista de pendências', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    await preencherUmaFalta(user);
    await enviar(user);

    await waitFor(() => expect(gravadas()[`${LOJA}::${ANTIGA}`].status).toBe('SUBMITTED'));
    await waitFor(() => expect(chipsPendentes()).toHaveLength(1));
    expect(chipsPendentes()[0]).toContain(shortDateLabel(RECENTE));
  });

  // TESTES E e F — a sequência inteira da segunda-feira.
  it('E+F. depois de enviar a primeira, a tela oferece a próxima e ela é enviada', async () => {
    semearSemanaEnviada();
    const user = await abrirTela();

    await preencherUmaFalta(user);
    await enviar(user);

    // O envio é confirmado, a sugestão nomeia a próxima pendência e leva até ela.
    await waitFor(() =>
      expect(screen.getByText('Conferência enviada com sucesso')).toBeTruthy(),
    );
    const bloco = screen.getByText(/Próxima conferência pendente/i).closest('.sent') as HTMLElement;
    expect(within(bloco).getByText(formatBrDate(RECENTE))).toBeTruthy();
    expect(within(bloco).getByText(weekdayName(RECENTE))).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Ir para próxima pendência' }));
    await waitFor(() => expect(seletorDeData().value).toBe(RECENTE));

    await preencherUmaFalta(user);
    await enviar(user);

    await waitFor(() => expect(gravadas()[`${LOJA}::${RECENTE}`].status).toBe('SUBMITTED'));

    // Sem pendência, o aviso some — em vez de mostrar "0 pendentes" —, e a
    // janela aparece fechada.
    await waitFor(() => expect(tituloDePendencias()).toBeNull());
    expect(screen.getByText(`${ELIGIVEIS} de ${ELIGIVEIS} dias elegíveis`)).toBeTruthy();
  }, 15000);

  // TESTE G
  it('G. data já enviada abre bloqueada para edição', async () => {
    semearSemanaEnviada();
    semear(ANTIGA, 'SUBMITTED', 2);
    await abrirTela();

    // Só a mais recente está pendente, então a tela abre nela.
    expect(seletorDeData().value).toBe(RECENTE);

    await userEvent.setup().click(screen.getByRole('button', { name: `Conferência de ${formatLongBrDate(ANTIGA)}` }));
    await waitFor(() => expect(seletorDeData().value).toBe(ANTIGA));
    await waitFor(() => expect(screen.getByText(/Está bloqueada para edição/i)).toBeTruthy());

    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Finalizar conferência' })).toBeNull();

    const linha = screen.getByText('OPERADOR DE CAIXA').closest('.position-row') as HTMLElement;
    const campo = within(linha).getByLabelText('Faltas em OPERADOR DE CAIXA') as HTMLInputElement;
    expect(campo.disabled).toBe(true);
  });

  // TESTE H
  it('H. rascunho antigo carrega com o que já tinha sido digitado', async () => {
    semearSemanaEnviada();
    semear(ANTIGA, 'DRAFT', 3);
    await abrirTela();

    // Rascunho continua pendente: a tela abre nele.
    expect(seletorDeData().value).toBe(ANTIGA);

    const linha = screen.getByText('OPERADOR DE CAIXA').closest('.position-row') as HTMLElement;
    const campo = within(linha).getByLabelText('Faltas em OPERADOR DE CAIXA') as HTMLInputElement;
    expect(campo.value).toBe('3');

    // E o chip diz que é rascunho, não "ainda não conferida".
    expect(chipsPendentes()[0]).toContain('rascunho');
  });

  // TESTES J e K
  it('J+K. o seletor não permite hoje nem data futura', async () => {
    semearSemanaEnviada();
    await abrirTela();

    const input = seletorDeData();
    expect(input.getAttribute('data-date')).toBe(ANTIGA); // a tela abre na pendência mais antiga

    // Nenhum chip oferece hoje ou o futuro.
    expect(screen.getByRole('button', { name: /hoje, pré-registro/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Conferência de ${formatLongBrDate(FUTURO)}` }).hasAttribute('disabled')).toBe(true);
  });
});

/* =========================================================================
 * A regra, sem tela
 * ====================================================================== */

/**
 * Aqui o `today` é injetado: são funções puras, sem serviço no meio, então dá
 * para ser segunda-feira de verdade e conferir os rótulos SÁB/DOM.
 */
describe('A janela de datas', () => {
  /** 07/09/2026 é uma segunda-feira. Meio-dia para não flertar com fuso. */
  const SEGUNDA = new Date(2026, 8, 7, 12, 0, 0);
  const SEGUNDA_ISO = '2026-09-07';
  const DOMINGO = '2026-09-06';
  const SABADO = '2026-09-05';
  const SEXTA = '2026-09-04';

  it('oferece os 7 dias anteriores, sem hoje e sem futuro', () => {
    const datas = selectableReferenceDates(SEGUNDA);

    expect(datas).toHaveLength(REFERENCE_WINDOW_DAYS);
    expect(datas[0]).toBe(DOMINGO); // D-1, mais recente primeiro
    expect(datas.at(-1)).toBe('2026-08-31'); // D-7
    expect(datas).not.toContain(SEGUNDA_ISO);
  });

  // TESTE K, na regra
  it('K. hoje é recusado', () => {
    expect(isSelectableReferenceDate(SEGUNDA_ISO, SEGUNDA)).toBe(false);
  });

  // TESTE J, na regra
  it('J. o futuro é recusado', () => {
    expect(isSelectableReferenceDate('2026-09-08', SEGUNDA)).toBe(false);
    expect(isSelectableReferenceDate('2027-01-01', SEGUNDA)).toBe(false);
  });

  it('data antiga demais também é recusada', () => {
    expect(isSelectableReferenceDate('2026-08-31', SEGUNDA)).toBe(true); // limite
    expect(isSelectableReferenceDate('2026-08-30', SEGUNDA)).toBe(false); // um dia além
  });

  it('não trata sábado e domingo como exceção — a regra é a janela', () => {
    // Uma QUARTA-FEIRA com a terça em aberto: mesmo mecanismo, sem nada
    // escrito sobre fim de semana.
    const quarta = new Date(2026, 8, 9, 12, 0, 0);
    const datas = buildReferenceDates(
      [
        { id: 'a', referenceDate: '2026-09-07', totalAbsences: 0, totalDayOffs: 0, status: 'SUBMITTED', submittedAt: 'x' },
      ],
      quarta,
    );

    const pendentes = pendingReferenceDates(datas);
    expect(pendentes[0].date).toBe('2026-09-02');
    expect(suggestedReferenceDate(datas, quarta)).toBe('2026-09-02');
    // A terça (08/09) está pendente e acessível, como qualquer outro dia.
    expect(pendentes.some((p) => p.date === '2026-09-08')).toBe(true);
  });

  // TESTE O, na regra
  it('O. a sugestão é a pendência mais antiga', () => {
    const historico = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', SEXTA].map(
      (date) => ({
        id: date,
        referenceDate: date,
        totalAbsences: 0,
        totalDayOffs: 0,
        status: 'SUBMITTED' as const,
        submittedAt: 'x',
      }),
    );

    const datas = buildReferenceDates(historico, SEGUNDA);
    expect(suggestedReferenceDate(datas, SEGUNDA)).toBe(SABADO);
    expect(nextPendingAfter(datas, SABADO)?.date).toBe(DOMINGO);
    expect(nextPendingAfter(datas, DOMINGO)?.date).toBe(SABADO);
  });

  it('sem pendência nenhuma, abre em D-1', () => {
    const historico = selectableReferenceDates(SEGUNDA).map((date) => ({
      id: date,
      referenceDate: date,
      totalAbsences: 0,
      totalDayOffs: 0,
      status: 'SUBMITTED' as const,
      submittedAt: 'x',
    }));

    const datas = buildReferenceDates(historico, SEGUNDA);
    expect(pendingReferenceDates(datas)).toEqual([]);
    expect(suggestedReferenceDate(datas, SEGUNDA)).toBe(DOMINGO);
  });

  it('rascunho e reaberta continuam pendentes; só enviada resolve', () => {
    const datas = buildReferenceDates(
      [
        { id: 'a', referenceDate: DOMINGO, totalAbsences: 0, totalDayOffs: 0, status: 'DRAFT', submittedAt: null },
        { id: 'b', referenceDate: SABADO, totalAbsences: 0, totalDayOffs: 0, status: 'REOPENED', submittedAt: null },
        { id: 'c', referenceDate: SEXTA, totalAbsences: 0, totalDayOffs: 0, status: 'SUBMITTED', submittedAt: 'x' },
      ],
      SEGUNDA,
    );

    const porData = new Map(datas.map((d) => [d.date, d]));
    expect(porData.get(DOMINGO)!.pending).toBe(true);
    expect(porData.get(SABADO)!.pending).toBe(true);
    expect(porData.get(SEXTA)!.pending).toBe(false);
  });

  it('o rótulo do chip traz o dia da semana', () => {
    expect(shortDateLabel(SABADO)).toBe('SÁB 05/09');
    expect(shortDateLabel(DOMINGO)).toBe('DOM 06/09');
  });
});

/* =========================================================================
 * O serviço recusa o que a tela não deveria ter oferecido
 * ====================================================================== */

describe('O serviço não confia na tela', () => {
  const contexto = { positions: POSITIONS, reasons: getActiveReasons() };

  // TESTE K, no serviço
  /**
   * FASE 4.5 — a regra de "hoje" virou DUAS regras.
   *
   * Até a 4.4, hoje era recusado em qualquer caminho. Agora ele é o
   * PRÉ-REGISTRO: o gerente lança a ocorrência enquanto lembra, e o registro
   * fica em DRAFT — mesmo status, mesmo id, mesma linha que amanhã será o
   * rascunho de ontem.
   *
   * O que continua proibido é ENVIAR hoje, e por um motivo que não é de
   * interface: enviar transforma o lançamento em número oficial, e o dia ainda
   * não terminou.
   */
  it('K. hoje pode ser REGISTRADO (pré-registro), mas não ENVIADO', async () => {
    const preRegistro = await loadOrCreateConference({
      storeId: LOJA,
      referenceDate: HOJE,
      positions: POSITIONS,
      createdBy: GERENTE.id,
    });

    expect(preRegistro.referenceDate).toBe(HOJE);
    expect(preRegistro.status).toBe('DRAFT');

    // Gravar, sim.
    const salvo = await saveDraft(preRegistro);
    expect(salvo.status).toBe('DRAFT');
    expect(gravadas()[`${LOJA}::${HOJE}`].referenceDate).toBe(HOJE);

    // Enviar, não — e o erro diz por quê, em vez de falar de "janela".
    await expect(submitConference(salvo, contexto)).rejects.toThrow(TodayNotSubmittableError);
    await expect(submitConference(salvo, contexto)).rejects.toThrow(/o dia não terminou/i);

    // E nada foi enviado: continua rascunho.
    expect(gravadas()[`${LOJA}::${HOJE}`].status).toBe('DRAFT');
  });

  // TESTE J, no serviço
  it('J. recusa criar conferência FUTURA', async () => {
    await expect(
      loadOrCreateConference({
        storeId: LOJA,
        referenceDate: shiftIsoDate(HOJE, 14),
        positions: POSITIONS,
        createdBy: GERENTE.id,
      }),
    ).rejects.toThrow(InvalidReferenceDateError);
  });

  it('recusa GRAVAR e ENVIAR um rascunho futuro, mesmo montado à mão', async () => {
    const forjada: DailyConference = {
      id: 'forjada',
      storeId: LOJA,
      referenceDate: FUTURO,
      status: 'DRAFT',
      createdBy: GERENTE.id,
      submittedBy: null,
      createdAt: 'x',
      updatedAt: 'x',
      submittedAt: null,
      items: [],
    };

    // É este o caminho que um estado manipulado no DevTools tomaria.
    await expect(saveDraft(forjada)).rejects.toThrow(InvalidReferenceDateError);
    await expect(submitConference(forjada, contexto)).rejects.toThrow(InvalidReferenceDateError);
  });

  /**
   * O pré-registro de hoje forjado à mão também não vira envio. É o mesmo
   * caminho do teste acima, mas com a data que a tela DE FATO oferece — o erro
   * aqui tem de ser o específico de hoje, não o genérico de janela.
   */
  it('recusa ENVIAR o pré-registro de hoje montado à mão', async () => {
    const forjada: DailyConference = {
      id: 'forjada-hoje',
      storeId: LOJA,
      referenceDate: HOJE,
      status: 'DRAFT',
      createdBy: GERENTE.id,
      submittedBy: null,
      createdAt: 'x',
      updatedAt: 'x',
      submittedAt: null,
      items: [],
    };

    await expect(submitConference(forjada, contexto)).rejects.toThrow(TodayNotSubmittableError);
    // Gravar continua permitido: é exatamente o que o pré-registro faz.
    await expect(saveDraft(forjada)).resolves.toBeTruthy();
  });

  /* -----------------------------------------------------------------------
   * O PISO DA JANELA — a mesma regra dos dois lados
   *
   * A tela nunca ofereceu uma data mais velha que D-7, e o serviço já recusava.
   * O que faltava era o BANCO: as RPCs só protegiam hoje e o futuro, então uma
   * chamada direta com o token do gerente gravava e ENVIAVA a conferência de
   * três meses atrás.
   *
   * Fechado na 0018 com `quadro_reference_window_days()`. Estes testes fixam o
   * lado da tela; `pendingReason.integration.test.ts` compara os dois números e
   * falha se alguém mexer só num deles.
   * -------------------------------------------------------------------- */

  it('a janela do produto começa no primeiro dia do mês operacional', () => {

    // O "hoje" vem de `businessToday()` — a MESMA fonte que as funções usam por
    // padrão, e a mesma data civil que `quadro_business_date()` calcula no
    // banco. Usar o relógio do container faria o teste piscar na virada do dia.
    const hoje = businessToday();

    const primeiroDia = `${hoje.slice(0, 7)}-01`;
    expect(isMonthlyRecordableDate(primeiroDia)).toBe(true);
    expect(isMonthlyRecordableDate(shiftIsoDate(primeiroDia, -1))).toBe(false);
  });

  it('o serviço recusa GRAVAR e ENVIAR uma data anterior ao mês', async () => {
    const velha = shiftIsoDate(`${businessToday().slice(0, 7)}-01`, -1);

    await expect(
      loadOrCreateConference({
        storeId: LOJA,
        referenceDate: velha,
        positions: POSITIONS,
        createdBy: GERENTE.id,
      }),
    ).rejects.toThrow(InvalidReferenceDateError);

    const forjada: DailyConference = {
      id: 'forjada-velha',
      storeId: LOJA,
      referenceDate: velha,
      status: 'DRAFT',
      createdBy: GERENTE.id,
      submittedBy: null,
      createdAt: 'x',
      updatedAt: 'x',
      submittedAt: null,
      items: [],
    };

    // O caminho do DevTools: um estado manipulado com data antiga.
    await expect(saveDraft(forjada)).rejects.toThrow(InvalidReferenceDateError);
    await expect(submitConference(forjada, contexto)).rejects.toThrow(InvalidReferenceDateError);

    // E nada foi gravado.
    expect(gravadas()[`${LOJA}::${velha}`]).toBeUndefined();
  });

  // TESTE I, no adaptador — o banco tem a segunda barreira (ver
  // `referenceDate.integration.test.ts`), mas o caminho normal também não pode
  // duplicar.
  it('I. duas gravações na mesma loja e data reusam a MESMA conferência', async () => {
    const primeira = await loadOrCreateConference({
      storeId: LOJA,
      referenceDate: ANTIGA,
      positions: POSITIONS,
      createdBy: GERENTE.id,
    });
    await saveDraft(primeira);

    const segunda = await loadOrCreateConference({
      storeId: LOJA,
      referenceDate: ANTIGA,
      positions: POSITIONS,
      createdBy: GERENTE.id,
    });

    expect(segunda.id).toBe(primeira.id);

    const daData = Object.keys(gravadas()).filter((k) => k.endsWith(`::${ANTIGA}`));
    expect(daData).toHaveLength(1);
  });

  // TESTE G, no serviço
  it('G. conferência ENVIADA não aceita gravação', async () => {
    semear(ANTIGA, 'SUBMITTED', 2);

    const enviada = await loadOrCreateConference({
      storeId: LOJA,
      referenceDate: ANTIGA,
      positions: POSITIONS,
      createdBy: GERENTE.id,
    });
    expect(enviada.status).toBe('SUBMITTED');

    await expect(saveDraft(enviada)).rejects.toThrow(/bloqueada para edição/i);
  });
});
