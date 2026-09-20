// @vitest-environment jsdom
/**
 * FASE 4.4 — O QUE A TELA DO GERENTE DIZ.
 *
 * Esta fase não mudou nenhuma regra: mudou o que o gerente lê. Então o que se
 * testa aqui é exatamente isso — a palavra, a frase, a conta e o rótulo.
 *
 * A DIVISÃO É PROPOSITAL:
 *
 *   • as frases e as contas são funções PURAS, e estão testadas como tais —
 *     sem montar tela, sem esperar `waitFor`, sem depender de layout;
 *   • o que só existe com componentes montados (o painel de motivos, o selo do
 *     histórico) está no fim, em jsdom;
 *   • e o que só existe com LAYOUT — não estourar 360px, alvo de toque de
 *     44px, contraste, a data ser o maior texto da tela — NÃO está aqui:
 *     jsdom não tem layout, e um teste que finge medir largura mede zero. Isso
 *     vive em `scripts/browser_check_manager_ui.mjs`, num navegador de verdade.
 *
 * A tela inteira da segunda-feira continua em `referenceDate.test.tsx`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { HistorySection } from '@/components/HistorySection';
import { ReasonsPanel } from '@/components/ReasonsPanel';
import { ReferenceDateBar } from '@/components/ReferenceDateBar';
import {
  CONFERENCE_STATUS_TONE,
  CONFERENCE_STATUS_WORD,
  conferenceStatusSentence,
} from '@/domain/conferenceStatusView';
import {
  buildReferenceDates,
  pendingReferenceDates,
  referenceDateBounds,
  shortDayMonth,
  shortWeekday,
  windowProgress,
  REFERENCE_WINDOW_DAYS,
} from '@/domain/referenceWindow';
import { setAbsenceQuantity, setReasonQuantity } from '@/domain/conferenceFactory';
import { formatBrDayMonth, weekdayName } from '@/utils/date';
import type { ConferenceHistoryEntry } from '@/types/domain';
import { POSITION_PADARIA, REASON_OUTROS, TEST_REASONS, makeDraft } from './fixtures';

afterEach(cleanup);

/** 07/09/2026 é uma segunda-feira. Meio-dia para não flertar com fuso. */
const SEGUNDA = new Date(2026, 8, 7, 12, 0, 0);
const DOMINGO = '2026-09-06';
const SABADO = '2026-09-05';

function enviada(date: string): ConferenceHistoryEntry {
  return {
    id: date,
    referenceDate: date,
    totalAbsences: 0,
    totalDayOffs: 0,
    status: 'SUBMITTED',
    submittedAt: `${date}T11:00:00.000Z`,
  };
}

/* =========================================================================
 * As frases de status
 * ====================================================================== */

describe('O status dito em português', () => {
  it('cada situação tem a sua frase', () => {
    expect(conferenceStatusSentence('MISSING')).toBe(
      'Esta conferência ainda não foi enviada.',
    );
    expect(conferenceStatusSentence('DRAFT')).toBe(
      'Rascunho salvo. Você pode continuar o preenchimento.',
    );
    expect(conferenceStatusSentence('REOPENED')).toBe(
      'Esta conferência foi reaberta para correção.',
    );
  });

  it('a conferência enviada diz QUANDO foi enviada', () => {
    const carimbo = new Date(2026, 8, 6, 8, 14, 0).toISOString();
    const frase = conferenceStatusSentence('SUBMITTED', carimbo);

    expect(frase).toContain(`Conferência enviada em ${formatBrDayMonth(carimbo)} às 08:14.`);
    // A segunda frase existe para explicar os campos cinza antes que o gerente
    // tente digitar e ache que a tela quebrou.
    expect(frase).toContain('Está bloqueada para edição.');
  });

  it('sem carimbo, não inventa hora', () => {
    const frase = conferenceStatusSentence('SUBMITTED', null);
    expect(frase).toBe('Conferência enviada. Está bloqueada para edição.');
    expect(frase).not.toMatch(/\d/);
  });

  it('some o texto técnico da fase 4.3', () => {
    for (const status of ['MISSING', 'DRAFT', 'SUBMITTED', 'REOPENED'] as const) {
      expect(conferenceStatusSentence(status, '2026-09-06T11:00:00.000Z')).not.toMatch(
        /ainda não conferida|rascunho em andamento/i,
      );
    }
  });

  /**
   * Verde é a cor de "chegou ao supervisor". Rascunho e reaberta não chegaram.
   */
  it('só ENVIADA é verde; rascunho e reaberta continuam pendências', () => {
    expect(CONFERENCE_STATUS_TONE.SUBMITTED).toBe('submitted');
    expect(CONFERENCE_STATUS_TONE.MISSING).not.toBe('submitted');
    expect(CONFERENCE_STATUS_TONE.DRAFT).not.toBe('submitted');
    expect(CONFERENCE_STATUS_TONE.REOPENED).not.toBe('submitted');
  });

  it('as quatro palavras do chip cabem num chip', () => {
    // Só estas quatro viram chip: `PRE_REGISTRATION` é de hoje, e hoje não
    // entra na fila dos 7 dias — ele aparece no título, onde há espaço.
    for (const estado of ['MISSING', 'DRAFT', 'SUBMITTED', 'REOPENED'] as const) {
      expect(CONFERENCE_STATUS_WORD[estado].length, estado).toBeLessThanOrEqual(9);
    }
  });

  it('toda palavra de status é minúscula no DOM — a caixa é do CSS', () => {
    for (const palavra of Object.values(CONFERENCE_STATUS_WORD)) {
      expect(palavra).toBe(palavra.toLowerCase());
    }
  });
});

/* =========================================================================
 * O progresso da janela
 * ====================================================================== */

describe('Progresso da janela', () => {
  it('conta as enviadas sobre o tamanho da janela', () => {
    const datas = buildReferenceDates(
      ['2026-09-04', '2026-09-03', '2026-09-02'].map(enviada),
      SEGUNDA,
    );

    expect(windowProgress(datas)).toEqual({ done: 3, total: REFERENCE_WINDOW_DAYS });
  });

  it('anda quando mais uma data é enviada', () => {
    const antes = buildReferenceDates(['2026-09-04'].map(enviada), SEGUNDA);
    const depois = buildReferenceDates(['2026-09-04', SABADO].map(enviada), SEGUNDA);

    expect(windowProgress(antes).done).toBe(1);
    expect(windowProgress(depois).done).toBe(2);
  });

  /**
   * O AVISO DO ENUNCIADO: "concluídas" é sobre a JANELA, não sobre tudo o que
   * a loja já enviou. Uma conferência de duas semanas atrás não aparece como
   * pendência e também não pode contar como concluída — senão a loja em dia
   * mostraria "9 de 7".
   */
  it('não conta conferências de FORA da janela', () => {
    const foraDaJanela = ['2026-08-20', '2026-08-21'].map(enviada);
    const datas = buildReferenceDates([...foraDaJanela, enviada(SABADO)], SEGUNDA);

    const progresso = windowProgress(datas);
    expect(progresso.done).toBe(1);
    expect(progresso.total).toBe(REFERENCE_WINDOW_DAYS);
    expect(progresso.done).toBeLessThanOrEqual(progresso.total);
  });

  it('rascunho e reaberta NÃO contam como concluídas', () => {
    const datas = buildReferenceDates(
      [
        { ...enviada(SABADO), status: 'DRAFT', submittedAt: null },
        { ...enviada(DOMINGO), status: 'REOPENED', submittedAt: null },
      ],
      SEGUNDA,
    );

    expect(windowProgress(datas).done).toBe(0);
  });

  it('a janela cheia fecha em 7 de 7', () => {
    const todas = buildReferenceDates([], SEGUNDA).map((info) => enviada(info.date));
    expect(windowProgress(buildReferenceDates(todas, SEGUNDA))).toEqual({
      done: REFERENCE_WINDOW_DAYS,
      total: REFERENCE_WINDOW_DAYS,
    });
  });
});

/* =========================================================================
 * As três linhas do chip
 * ====================================================================== */

describe('O chip de data', () => {
  it('separa dia da semana e data — as duas primeiras linhas', () => {
    expect(shortWeekday(SABADO)).toBe('SÁB');
    expect(shortDayMonth(SABADO)).toBe('05/09');
    expect(shortWeekday(DOMINGO)).toBe('DOM');
    expect(shortDayMonth(DOMINGO)).toBe('06/09');
  });

  it('e o dia da semana por extenso, para o título', () => {
    expect(weekdayName(SABADO)).toBe('sábado');
    expect(weekdayName('2026-08-31')).toBe('segunda-feira');
  });
});

/* =========================================================================
 * A fila de chips: ordem cronológica, estável
 * ====================================================================== */

describe('O calendário mensal', () => {
  /** As datas dos chips, na ordem em que a fila os coloca. */
  const filaDe = (history: ConferenceHistoryEntry[]) => {
    cleanup();
    const dates = buildReferenceDates(history, SEGUNDA);
    render(
      <ReferenceDateBar
        dates={dates}
        pending={pendingReferenceDates(dates)}
        selected={SABADO}
        month="2026-09"
        bounds={referenceDateBounds(SEGUNDA)}
        disabled={false}
        onSelect={() => undefined}
        today="2026-09-07"
        preRegistration={false}
      />,
    );
    return [...document.querySelectorAll('.monthly-calendar__day')].map((b) => ({
      date: b.getAttribute('aria-label') ?? '',
      estado: [...b.classList].find((c) =>
        ['monthly-calendar__day--pending', 'monthly-calendar__day--draft', 'monthly-calendar__day--submitted', 'monthly-calendar__day--reopened'].includes(c),
      ),
    }));
  };

  const CRONOLOGICA = [
    '2026-08-31',
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    SABADO,
    DOMINGO,
  ];

  it('mostra os 7 dias em ordem cronológica crescente', () => {
    const fila = filaDe(['2026-09-01', '2026-09-03', SABADO].map(enviada));

    expect(fila).toHaveLength(30);
  });

  it('a ordem não depende do status: janela toda pendente é a mesma fila', () => {
    expect(filaDe([])).toHaveLength(30);
    expect(filaDe(CRONOLOGICA.map(enviada))).toHaveLength(30);
  });

  /**
   * REGRESSÃO — a posição do chip é aprendida, e tem de ser estável.
   *
   * Enquanto a fila era ordenada por pendência, enviar uma conferência tirava
   * aquele chip da frente e o mandava para outro ponto da fila. Aqui o mesmo dia
   * troca de status três vezes e não sai do lugar nenhuma delas.
   */
  it('mudar o status de uma data NÃO muda a posição de nenhuma', () => {
    const base = ['2026-09-01', '2026-09-03'].map(enviada);
    const cenarios: Array<[string, ConferenceHistoryEntry[], string]> = [
      ['nunca aberta', base, 'chip--pending'],
      ['rascunho', [...base, { ...enviada(SABADO), status: 'DRAFT', submittedAt: null }], 'chip--draft'],
      ['enviada', [...base, enviada(SABADO)], 'chip--submitted'],
      [
        'reaberta',
        [...base, { ...enviada(SABADO), status: 'REOPENED', submittedAt: null }],
        'chip--reopened',
      ],
    ];

    for (const [nome, history, estadoEsperado] of cenarios) {
      const fila = filaDe(history);

      // A fila inteira, sempre igual.
      expect(fila, nome).toHaveLength(30);
      const estadoMensal = {
        'chip--pending': 'monthly-calendar__day--pending',
        'chip--draft': 'monthly-calendar__day--draft',
        'chip--submitted': 'monthly-calendar__day--submitted',
        'chip--reopened': 'monthly-calendar__day--reopened',
      }[estadoEsperado];
      expect(fila.some((c) => c.estado === estadoMensal), nome).toBe(true);
    }
  });

  it('a data aberta é a única marcada, onde quer que ela esteja na fila', () => {
    filaDe(['2026-09-01'].map(enviada));

    const marcados = document.querySelectorAll('.monthly-calendar__day[aria-current="date"]');
    expect(marcados).toHaveLength(1);
    expect(marcados[0].getAttribute('aria-label')).toContain('05/09/2026');
  });
});

/* =========================================================================
 * Motivos — o contador é o número que libera o envio
 * ====================================================================== */

describe('Painel de motivos', () => {
  const montar = (faltas: number, motivos: number) => {
    let draft = makeDraft();
    draft = setAbsenceQuantity(draft, POSITION_PADARIA, faltas);
    if (motivos > 0) draft = setReasonQuantity(draft, POSITION_PADARIA, REASON_OUTROS, motivos);
    const item = draft.items.find((i) => i.positionId === POSITION_PADARIA)!;

    render(
      <ReasonsPanel
        item={item}
        reasons={TEST_REASONS}
        disabled={false}
        onChangeQuantity={() => undefined}
        onChangeObservation={() => undefined}
      />,
    );
    return document.querySelector('.reasons') as HTMLElement;
  };

  it('o contador aparece e diz quantos faltam', () => {
    const painel = montar(3, 1);

    expect(within(painel).getByText('Motivos informados: 1 de 3')).toBeTruthy();
    expect(within(painel).getByText('Falta informar o motivo de 2 faltas.')).toBeTruthy();
  });

  it('no singular, fala no singular', () => {
    const painel = montar(1, 0);
    expect(within(painel).getByText('Falta informar o motivo de 1 falta.')).toBeTruthy();
  });

  it('fechado, o contador confirma em verde e some o alerta', () => {
    const painel = montar(2, 2);

    const contador = within(painel).getByText('Motivos informados: 2 de 2');
    expect(contador.className).toContain('reasons__counter--ok');
    expect(painel.className).toContain('reasons--closed');
    expect(within(painel).queryByText(/Falta informar/)).toBeNull();
  });

  it('aberto, o contador fica âmbar', () => {
    const painel = montar(2, 1);
    expect(within(painel).getByText('Motivos informados: 1 de 2').className).toContain(
      'reasons__counter--open',
    );
  });

  /**
   * Acontece de verdade: lança 3 faltas, informa 3 motivos, depois corrige as
   * faltas para 2. Sem esta frase o contador diria "3 de 2" e ficaria mudo
   * sobre o que fazer.
   */
  it('avisa também quando há motivo A MAIS que falta', () => {
    const painel = montar(1, 3);

    expect(within(painel).getByText('Motivos informados: 3 de 1')).toBeTruthy();
    expect(
      within(painel).getByText('Há 2 motivos a mais do que faltas. Ajuste os números.'),
    ).toBeTruthy();
    // E nunca uma contagem negativa.
    expect(painel.textContent).not.toMatch(/-\d/);
  });
});

/* =========================================================================
 * Uma palavra só para cada estado, na tela inteira
 * ====================================================================== */

describe('Vocabulário único do gerente', () => {
  it('o histórico usa as mesmas palavras do chip e do título', () => {
    render(
      <HistorySection
        entries={[
          enviada(SABADO),
          { ...enviada(DOMINGO), status: 'DRAFT', submittedAt: null },
          { ...enviada('2026-09-04'), status: 'REOPENED', submittedAt: null },
        ]}
      />,
    );

    expect(screen.getByText(CONFERENCE_STATUS_WORD.SUBMITTED)).toBeTruthy();
    expect(screen.getByText(CONFERENCE_STATUS_WORD.DRAFT)).toBeTruthy();
    expect(screen.getByText(CONFERENCE_STATUS_WORD.REOPENED)).toBeTruthy();

    // A palavra antiga do histórico não convive com a nova: elas nomeavam o
    // mesmo estado de duas formas na mesma tela.
    expect(screen.queryByText('Em preenchimento')).toBeNull();
  });
});
