import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AbsenceReason,
  DailyConference,
  Position,
  ValidationIssue,
} from '@/types/domain';
import {
  sanitizeConferenceForPersistence,
  setAbsenceQuantity,
  setDayOffQuantity,
  setItemObservation,
  setReasonObservation,
  setReasonQuantity,
} from '@/domain/conferenceFactory';
import { buildSummary } from '@/domain/summary';
import {
  canEditConference,
  getPendingPositionIds,
  validateConference,
} from '@/domain/validation';
import {
  loadOrCreateConference,
  saveDraft,
  submitConference,
} from '@/services/conferenceService';
import { nowIso } from '@/utils/date';

export type FeedbackTone = 'success' | 'error' | 'info';

export interface Feedback {
  tone: FeedbackTone;
  message: string;
}

interface Params {
  storeId: string | null;
  /** null enquanto `useConferenceDates` ainda não escolheu a data. */
  referenceDate: string | null;
  positions: Position[];
  reasons: AbsenceReason[];
  /** UUID do usuário logado. No Supabase o banco reescreve com auth.uid(). */
  createdBy: string;
  /**
   * Chamado depois de gravar (rascunho ou envio).
   *
   * Existe para a lista de pendências se atualizar sozinha: enviar o sábado tem
   * de riscar o sábado da lista, e quem sabe disso é `useConferenceDates`.
   */
  onPersisted?: () => void;
  readOnly?: boolean;
}

/**
 * Estado da tela do gerente.
 * Toda persistência passa por `conferenceService` — a tela nunca vê localStorage.
 */
export function useDailyConference({
  storeId,
  referenceDate,
  positions,
  reasons,
  createdBy,
  onPersisted,
  readOnly = false,
}: Params) {
  const [conference, setConference] = useState<DailyConference | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  /**
   * Quando esta tela gravou pela última vez — só para o aviso discreto
   * "Rascunho salvo às 08:14" (fase 4.4).
   *
   * Não uso `conference.updatedAt` porque uma conferência recém-criada já nasce
   * com ele preenchido, e a tela diria "salvo" sobre algo que nunca foi
   * gravado. Este campo só existe depois de uma gravação de verdade.
   */
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId || !referenceDate || positions.length === 0) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const loaded = await loadOrCreateConference({
          storeId: storeId as string,
          referenceDate: referenceDate as string,
          positions,
          createdBy,
        });
        if (cancelled) return;
        setConference(loaded);
        setIssues([]);
        setDirty(false);
        // Trocou de data: o "salvo às ..." era da data anterior.
        setLastSavedAt(null);
      } catch (error) {
        if (cancelled) return;
        setFeedback({
          tone: 'error',
          message: error instanceof Error ? error.message : 'Falha ao carregar a conferência.',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [storeId, referenceDate, positions, createdBy]);

  const editable = conference ? !readOnly && canEditConference(conference) : false;

  /** Aplica uma alteração local, limpando o feedback anterior. */
  const mutate = useCallback(
    (updater: (current: DailyConference) => DailyConference) => {
      setConference((current) => {
        if (!current || !canEditConference(current)) return current;
        return updater(current);
      });
      setDirty(true);
      setFeedback(null);
    },
    [],
  );

  const actions = useMemo(
    () => ({
      changeAbsence: (positionId: string, value: unknown) =>
        mutate((current) => setAbsenceQuantity(current, positionId, value)),
      changeDayOff: (positionId: string, value: unknown) =>
        mutate((current) => setDayOffQuantity(current, positionId, value)),
      changeReasonQuantity: (positionId: string, reasonId: string, value: unknown) =>
        mutate((current) => setReasonQuantity(current, positionId, reasonId, value)),
      changeReasonObservation: (positionId: string, reasonId: string, value: string) =>
        mutate((current) => setReasonObservation(current, positionId, reasonId, value)),
      changeItemObservation: (positionId: string, value: string) =>
        mutate((current) => setItemObservation(current, positionId, value)),
    }),
    [mutate],
  );

  const handleSaveDraft = useCallback(async () => {
    if (!conference) return;
    setSaving(true);
    try {
      const saved = await saveDraft(conference);
      setConference(saved);
      setDirty(false);
      setLastSavedAt(nowIso());
      // Sem faixa verde: quem salvou rascunho continua preenchendo, e o aviso
      // discreto na barra de ações já diz a que horas foi (fase 4.4).
      setFeedback(null);
      onPersisted?.();
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Falha ao salvar o rascunho.',
      });
    } finally {
      setSaving(false);
    }
  }, [conference, onPersisted]);

  /**
   * Valida sem enviar — usa exatamente as mesmas regras do envio
   * (`validateConference`), para a tela nunca divergir do serviço.
   * Retorna true quando está pronto para a tela de confirmação.
   */
  const validateForSubmit = useCallback((): boolean => {
    if (!conference) return false;

    // Valida o MESMO texto que será gravado (já com trim), para a tela nunca
    // aprovar uma observação que o envio depois recusaria — e vice-versa.
    const result = validateConference(sanitizeConferenceForPersistence(conference), {
      positions,
      reasons,
    });
    setIssues(result.issues);

    if (!result.valid) {
      setFeedback({
        tone: 'error',
        message: 'Existem pendências. Corrija antes de finalizar.',
      });
      return false;
    }

    setFeedback(null);
    return true;
  }, [conference, positions, reasons]);

  const handleSubmit = useCallback(async () => {
    if (!conference) return false;
    setSaving(true);
    try {
      const result = await submitConference(conference, { positions, reasons });
      if (!result.ok) {
        setIssues(result.validation.issues);
        setFeedback({ tone: 'error', message: 'Existem pendências. Corrija antes de finalizar.' });
        return false;
      }
      setConference(result.conference);
      setIssues([]);
      setDirty(false);
      setLastSavedAt(nowIso());
      setFeedback(null);
      onPersisted?.();
      return true;
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Falha ao enviar a conferência.',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [conference, positions, reasons, onPersisted]);

  const summary = useMemo(
    () => (conference ? buildSummary(conference) : null),
    [conference],
  );

  const pendingPositionIds = useMemo(() => getPendingPositionIds(issues), [issues]);

  return {
    conference,
    summary,
    issues,
    pendingPositionIds,
    feedback,
    loading,
    saving,
    dirty,
    lastSavedAt,
    editable,
    actions,
    saveDraft: handleSaveDraft,
    validateForSubmit,
    submit: handleSubmit,
    clearFeedback: () => setFeedback(null),
  };
}
