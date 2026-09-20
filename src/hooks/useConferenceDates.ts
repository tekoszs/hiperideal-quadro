import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConferenceHistoryEntry } from '@/types/domain';
import {
  isPreRegistrationDate,
  monthStartIso,
  monthlyReferenceDates,
  nextPendingAfter,
  pendingReferenceDates,
  suggestedReferenceDate,
} from '@/domain/referenceWindow';
import type { PendingJustification } from '@/domain/pendingJustification';
import { loadStoreConferences } from '@/services/conferenceService';
import { HISTORY_LIMIT } from '@/lib/constants';
import { businessNow, toIsoDate } from '@/utils/date';

interface Params {
  storeId: string | null;
  /** Injetável para os testes conseguirem ser uma segunda-feira. */
  today?: Date;
}

/**
 * FASE 4.3 — a data da conferência e as pendências.
 *
 * Este hook é o DONO do histórico da loja. Antes ele era carregado dentro de
 * `useDailyConference`; ficar nos dois lugares significaria duas leituras da
 * mesma coisa e, pior, duas versões da verdade sobre o que está pendente logo
 * depois de um envio.
 *
 * A ESCOLHA AUTOMÁTICA ACONTECE UMA VEZ SÓ. Quando o histórico chega, a tela
 * abre na pendência mais antiga — na segunda-feira, o sábado. Depois disso o
 * gerente manda: um `ref` impede que uma recarga do histórico mova a data
 * debaixo de quem está digitando.
 *
 * FASE 4.5 — o mesmo hook passou a devolver as PENDÊNCIAS DE JUSTIFICATIVA.
 * Elas saem da mesma lista de conferências que o histórico, então pedi-las
 * separadamente seria uma segunda viagem ao banco para reler os mesmos
 * registros.
 */
export function useConferenceDates({ storeId, today }: Params) {
  const [history, setHistory] = useState<ConferenceHistoryEntry[] | null>(null);
  const [pendingJustifications, setPendingJustifications] = useState<PendingJustification[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Já escolhemos a data inicial? Só a primeira carga decide. */
  const jaEscolheu = useRef(false);

  // `today` fixo por montagem: recalcular a cada render faria a janela deslizar
  // à meia-noite com a tela aberta, trocando a data do que o gerente digita.
  const agora = useMemo(() => today ?? businessNow(), [today]);
  const hoje = useMemo(() => toIsoDate(agora), [agora]);

  const carregar = useCallback(async () => {
    if (!storeId) return;
    try {
      setError(null);
      const snapshot = await loadStoreConferences(storeId, HISTORY_LIMIT, agora);
      setHistory(snapshot.history);
      setPendingJustifications(snapshot.pending);
    } catch (cause) {
      setHistory([]);
      setPendingJustifications([]);
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar as pendências.');
    }
  }, [storeId, agora]);

  useEffect(() => {
    jaEscolheu.current = false;
    setHistory(null);
    setSelected(null);
    setMonth(null);
    void carregar();
  }, [carregar]);

  const mesAtual = useMemo(() => monthStartIso(hoje).slice(0, 7), [hoje]);
  const visibleMonth = month ?? mesAtual;
  const dates = useMemo(() => monthlyReferenceDates(history ?? [], visibleMonth, agora), [history, visibleMonth, agora]);

  const pending = useMemo(() => pendingReferenceDates(dates), [dates]);

  // Abre a pendência mais antiga, uma vez, quando o histórico chega.
  useEffect(() => {
    if (jaEscolheu.current || history === null) return;
    jaEscolheu.current = true;
    const currentDates = monthlyReferenceDates(history, mesAtual, agora);
    const elegiveis = currentDates.filter((info) => info.date < hoje);
    setSelected(suggestedReferenceDate(elegiveis, agora));
  }, [history, dates, agora]);

  const bounds = useMemo(() => ({ min: `${visibleMonth}-01`, max: `${visibleMonth}-31` }), [visibleMonth]);

  return {
    /** Conferências já existentes da loja — alimenta a seção Histórico. */
    history: history ?? [],
    /** Faltas enviadas que ainda esperam um motivo definitivo (fase 4.5). */
    pendingJustifications,
    /** null enquanto o histórico não chegou — a tela espera para não piscar. */
    referenceDate: selected,
    /** Todas as datas da janela, mais recente primeiro. */
    dates,
    /** Só as pendentes, mais antiga primeiro. */
    pending,
    /** `min` e `max` do seletor de data. */
    bounds,
    month: visibleMonth,
    isReadOnlyMonth: visibleMonth < mesAtual,
    /** A data de hoje, para o botão de pré-registro. */
    today: hoje,
    /** A tela está no pré-registro de hoje? */
    isPreRegistration: selected !== null && isPreRegistrationDate(selected, agora),
    error,
    ready: history !== null && selected !== null,

    selectDate: useCallback((date: string) => setSelected(date), []),
    selectMonth: useCallback((nextMonth: string) => {
      const normalizedMonth = nextMonth.slice(0, 7);
      setMonth(normalizedMonth);
      const existing = history
        ?.filter((entry) => entry.referenceDate.slice(0, 7) === normalizedMonth)
        .sort((a, b) => a.referenceDate.localeCompare(b.referenceDate));
      setSelected(existing?.[0]?.referenceDate ?? null);
    }, [history]),

    /** Recarrega o histórico — chamado depois de salvar ou enviar. */
    refresh: carregar,

    /** A próxima pendência depois de resolver `date`, ou null. */
    nextAfter: useCallback(
      (date: string) => nextPendingAfter(dates, date),
      [dates],
    ),
  };
}
