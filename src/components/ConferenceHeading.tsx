import {
  CONFERENCE_STATUS_TONE,
  CONFERENCE_STATUS_WORD,
  conferenceStatusSentence,
  type ConferenceViewState,
} from '@/domain/conferenceStatusView';
import { formatBrDate, weekdayName } from '@/utils/date';

interface Props {
  /** A data ISO que a conferência aberta está usando. */
  referenceDate: string;
  state: ConferenceViewState;
  /** Carimbo do envio, para a frase "enviada em 05/09 às 08:14". */
  submittedAt: string | null;
}

/**
 * FASE 4.4 — O TÍTULO DA CONFERÊNCIA.
 *
 * A DATA É A INFORMAÇÃO MAIS IMPORTANTE DA TELA. O gerente que abre o sistema
 * numa segunda-feira precisa saber, antes de qualquer outra coisa, QUE DIA ele
 * está preenchendo — o erro caro aqui é lançar as faltas do sábado no domingo.
 * Por isso ela é o título, em tamanho de título, e não um campo no cabeçalho.
 *
 * ESTE É O ÚNICO LUGAR DA TELA QUE ANUNCIA A DATA. Na fase 4.3 o cabeçalho
 * verde também mostrava uma "Referência", calculada por conta própria, e as
 * duas discordavam. A correção de lá passava a data para o cabeçalho; a
 * correção desta fase é melhor: o cabeçalho não fala mais de data nenhuma, e
 * duas fontes que podem divergir viraram uma que não pode.
 *
 * FASE 4.5 — o mesmo título serve ao PRÉ-REGISTRO. Quando a data é hoje, o
 * rótulo muda de "Conferência de" para "Pré-registro de hoje", e a frase de
 * status explica que o envio vem depois. O que NÃO muda é a data em tamanho
 * grande: no pré-registro ela importa tanto quanto na conferência.
 *
 * O `referenceDate` vem da CONFERÊNCIA CARREGADA, não do seletor — é o dado que
 * será gravado.
 */
export function ConferenceHeading({ referenceDate, state, submittedAt }: Props) {
  const preRegistro = state === 'PRE_REGISTRATION';

  return (
    <header className={`conf-head${preRegistro ? ' conf-head--pre' : ''}`}>
      <div className="conf-head__top">
        <div className="conf-head__identity">
          <h2 className="conf-head__title">
            {preRegistro ? 'Pré-registro de hoje' : 'Conferência de'}{' '}
            <span className="conf-head__date">{formatBrDate(referenceDate)}</span>
          </h2>
          <p className="conf-head__weekday">{weekdayName(referenceDate)}</p>
        </div>

        <span
          className={`conf-status conf-status--${CONFERENCE_STATUS_TONE[state]}`}
          /* O selo repete o que a frase abaixo já diz por extenso: quem não
             distingue as cores continua tendo a informação em texto. */
        >
          {CONFERENCE_STATUS_WORD[state]}
        </span>
      </div>

      <p className="conf-head__sentence">{conferenceStatusSentence(state, submittedAt)}</p>
    </header>
  );
}
