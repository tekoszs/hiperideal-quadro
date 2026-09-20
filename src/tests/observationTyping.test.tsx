// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DailyConference } from '@/types/domain';
import { PositionRow } from '@/components/PositionRow';
import {
  sanitizeConferenceForPersistence,
  setAbsenceQuantity,
  setItemObservation,
  setReasonObservation,
  setReasonQuantity,
} from '@/domain/conferenceFactory';
import { validateConference } from '@/domain/validation';
import {
  POSITION_PADARIA,
  REASON_OUTROS,
  TEST_POSITIONS,
  TEST_REASONS,
  VALIDATION_CONTEXT,
  makeDraft,
} from './fixtures';

/**
 * REGRESSÃO — bug real relatado na tela do gerente conectada ao Supabase:
 *
 *   "não consigo escrever 'Afastamento funcionário' — o espaço não permanece"
 *
 * CAUSA: `setItemObservation` (e `setReasonObservation`) chamavam
 * `normalizeObservation`, que faz `trim()`, a CADA `onChange`. Como o textarea é
 * controlado (`value={item.observation ?? ''}`), o React reescrevia o campo já
 * sem o espaço no mesmo instante em que a tecla era digitada. A segunda palavra
 * nunca começava.
 *
 * Estes testes digitam TECLA POR TECLA em um DOM de verdade, pela mesma cadeia
 * da produção: componente -> onChange -> conferenceFactory -> estado ->
 * `value` do textarea. Não testam a função isolada: testam o que o gerente faz.
 */

const PADARIA = TEST_POSITIONS[0];

/**
 * Casca que reproduz o estado da tela do gerente
 * (`useDailyConference.mutate`): estado imutável + re-render controlado.
 */
function Harness({ onState }: { onState?: (conference: DailyConference) => void }) {
  const [conference, setConference] = useState<DailyConference>(() => {
    // Uma falta para o painel de motivos abrir e a linha ficar "ativa".
    let draft = makeDraft();
    draft = setAbsenceQuantity(draft, POSITION_PADARIA, 1);
    draft = setReasonQuantity(draft, POSITION_PADARIA, REASON_OUTROS, 1);
    return draft;
  });

  const item = conference.items.find((candidate) => candidate.positionId === POSITION_PADARIA)!;

  const mutate = (updater: (current: DailyConference) => DailyConference) => {
    setConference((current) => {
      const next = updater(current);
      onState?.(next);
      return next;
    });
  };

  return (
    <PositionRow
      position={PADARIA}
      item={item}
      reasons={TEST_REASONS}
      disabled={false}
      pending={false}
      showOnlySector={false}
      onChangeAbsence={(value) => mutate((c) => setAbsenceQuantity(c, POSITION_PADARIA, value))}
      onChangeDayOff={() => undefined}
      onChangeReasonQuantity={(reasonId, value) =>
        mutate((c) => setReasonQuantity(c, POSITION_PADARIA, reasonId, value))
      }
      onChangeReasonObservation={(reasonId, value) =>
        mutate((c) => setReasonObservation(c, POSITION_PADARIA, reasonId, value))
      }
      onChangeObservation={(value) => mutate((c) => setItemObservation(c, POSITION_PADARIA, value))}
    />
  );
}

function observacaoDaFuncao(): HTMLTextAreaElement {
  return screen.getByLabelText('Observação da função (opcional)') as HTMLTextAreaElement;
}

function observacaoDoMotivo(): HTMLTextAreaElement {
  return screen.getByLabelText(/Observação do motivo/) as HTMLTextAreaElement;
}

afterEach(cleanup);

describe('Observação da função — digitação real, tecla por tecla', () => {
  // TESTE 1
  it('aceita "Afastamento funcionário" (o bug relatado)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Afastamento funcionário');

    expect(campo.value).toBe('Afastamento funcionário');
  });

  // TESTE 2
  it('aceita várias palavras', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Transferido temporariamente para outra loja');

    expect(campo.value).toBe('Transferido temporariamente para outra loja');
    expect(campo.value.split(' ')).toHaveLength(5);
  });

  // TESTE 3
  it('aceita acentos, cedilha e til', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Associado apresentou atestado à direção — licença não usual');

    expect(campo.value).toBe('Associado apresentou atestado à direção — licença não usual');
  });

  // TESTE 4
  it('aceita vírgula e ponto', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Avisou ontem, por telefone. Retorna dia 15.');

    expect(campo.value).toBe('Avisou ontem, por telefone. Retorna dia 15.');
  });

  // TESTE 5
  it('aceita quebra de linha (é um textarea)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Primeira linha{Enter}Segunda linha');

    expect(campo.value).toBe('Primeira linha\nSegunda linha');
  });

  // TESTE 6
  it('espaço interno nunca é removido, nem no meio da frase', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Afastamento funcionário por 15 dias');

    // Exatamente 4 espaços internos, na posição em que foram digitados.
    expect(campo.value).toBe('Afastamento funcionário por 15 dias');
    expect(campo.value.match(/ /g)).toHaveLength(4);
    expect(campo.value).not.toBe('Afastamentofuncionárioetc');
  });

  // TESTE 7
  it('espaço no fim permanece enquanto digita, e o cursor não salta', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Afastamento');
    expect(campo.value).toBe('Afastamento');

    // A tecla que quebrava tudo.
    await user.type(campo, ' ');
    expect(campo.value).toBe('Afastamento ');
    // Cursor no fim do texto: se o valor tivesse sido reescrito com trim,
    // o cursor voltaria para a posição 11.
    expect(campo.selectionStart).toBe(12);
    expect(campo.selectionEnd).toBe(12);

    // E dá para continuar normalmente a partir dali.
    await user.type(campo, 'funcionário');
    expect(campo.value).toBe('Afastamento funcionário');
    expect(campo.selectionStart).toBe('Afastamento funcionário'.length);
  });

  it('digitar o texto do teste manual pedido funciona igual', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Afastamento funcionário por 15 dias');

    expect(campo.value).toBe('Afastamento funcionário por 15 dias');
  });

  it('apagar tudo volta ao campo vazio sem erro', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDaFuncao();

    await user.type(campo, 'Teste');
    await user.clear(campo);

    expect(campo.value).toBe('');
  });
});

describe('Observação do motivo "Outros" — mesma correção, mesmo comportamento', () => {
  it('aceita frase com espaços, acentos e pontuação', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDoMotivo();

    await user.type(campo, 'Convocação judicial, comparecimento obrigatório.');

    expect(campo.value).toBe('Convocação judicial, comparecimento obrigatório.');
  });

  it('espaço no fim permanece (o motivo não some no meio da digitação)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const campo = observacaoDoMotivo();

    await user.type(campo, 'Convocação ');

    expect(campo.value).toBe('Convocação ');
    expect(campo.selectionStart).toBe('Convocação '.length);
  });
});

describe('Limpeza só na hora de validar/gravar', () => {
  // TESTE 8
  it('"Outros" continua exigindo conteúdo real', () => {
    let conference = makeDraft();
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_OUTROS, 1);

    const semObservacao = validateConference(
      sanitizeConferenceForPersistence(conference),
      VALIDATION_CONTEXT,
    );
    expect(semObservacao.valid).toBe(false);
    expect(semObservacao.issues.some((i) => i.code === 'OTHERS_REQUIRES_OBSERVATION')).toBe(true);

    const comObservacao = setReasonObservation(
      conference,
      POSITION_PADARIA,
      REASON_OUTROS,
      'Convocação judicial',
    );
    expect(
      validateConference(sanitizeConferenceForPersistence(comObservacao), VALIDATION_CONTEXT).valid,
    ).toBe(true);
  });

  // TESTE 9
  it('observação só com espaços conta como vazia na validação final', () => {
    let conference = makeDraft();
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_OUTROS, 1);
    conference = setReasonObservation(conference, POSITION_PADARIA, REASON_OUTROS, '     ');

    // Durante a digitação o texto foi preservado como está...
    const item = conference.items.find((i) => i.positionId === POSITION_PADARIA)!;
    expect(item.reasons.find((r) => r.reasonId === REASON_OUTROS)?.observation).toBe('     ');

    // ...mas na hora de gravar vira null e a validação reprova.
    const limpa = sanitizeConferenceForPersistence(conference);
    const itemLimpo = limpa.items.find((i) => i.positionId === POSITION_PADARIA)!;
    expect(itemLimpo.reasons.find((r) => r.reasonId === REASON_OUTROS)?.observation).toBeNull();

    const resultado = validateConference(limpa, VALIDATION_CONTEXT);
    expect(resultado.valid).toBe(false);
    expect(resultado.issues.some((i) => i.code === 'OTHERS_REQUIRES_OBSERVATION')).toBe(true);
  });

  it('o trim final tira só as pontas — espaço interno e quebra de linha ficam', () => {
    let conference = makeDraft();
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setItemObservation(
      conference,
      POSITION_PADARIA,
      '   Afastamento funcionário\npor 15 dias   ',
    );

    const limpa = sanitizeConferenceForPersistence(conference);
    const item = limpa.items.find((i) => i.positionId === POSITION_PADARIA)!;

    expect(item.observation).toBe('Afastamento funcionário\npor 15 dias');
  });

  it('observação da função só com espaços vira null ao gravar', () => {
    let conference = makeDraft();
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setItemObservation(conference, POSITION_PADARIA, '   ');

    const limpa = sanitizeConferenceForPersistence(conference);
    const item = limpa.items.find((i) => i.positionId === POSITION_PADARIA)!;

    expect(item.observation).toBeNull();
  });

  it('a limpeza é idempotente (rodar duas vezes dá o mesmo resultado)', () => {
    let conference = makeDraft();
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 2);
    conference = setItemObservation(conference, POSITION_PADARIA, '  Dois faltantes  ');

    const uma = sanitizeConferenceForPersistence(conference);
    const duas = sanitizeConferenceForPersistence(uma);

    expect(JSON.stringify(duas.items)).toBe(JSON.stringify(uma.items));
  });
});
