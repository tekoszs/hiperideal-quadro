import type { ConferenceStatus } from '@/types/domain';
import {
  CONFERENCE_STATUS_TONE,
  CONFERENCE_STATUS_WORD,
} from '@/domain/conferenceStatusView';

interface Props {
  status: ConferenceStatus;
}

/**
 * O selo do histórico do gerente.
 *
 * FASE 4.4 — passou a usar o MESMO vocabulário do título e dos chips. Antes
 * dizia "Em preenchimento" enquanto o chip da mesma data dizia "Rascunho": duas
 * palavras para o mesmo estado, na mesma tela. A do chip venceu por ser mais
 * curta e caber onde é lida com pressa.
 *
 * A linguagem do supervisor não muda: a lista da rede tem os rótulos dela
 * (`NETWORK_STATUS_LABEL`), e este componente não aparece lá.
 */
export function StatusBadge({ status }: Props) {
  return (
    <span className={`status-badge status-badge--${CONFERENCE_STATUS_TONE[status]}`}>
      {CONFERENCE_STATUS_WORD[status]}
    </span>
  );
}
