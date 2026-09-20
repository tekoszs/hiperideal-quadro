import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AnalyticsFilters,
  AnalyticsFocus,
  DateRange,
  PeriodKind,
  ResolvedPeriod,
} from '@/types/analytics';
import type { SessionProfile } from '@/types/auth';
import { resolvePeriod } from '@/domain/period';
import {
  analyze,
  analyzeFocus,
  analyzeStore,
  loadNetworkRange,
  type LoadedRange,
} from '@/services/analyticsService';

/** Período local do drawer de foco: SEMANA (7 dias) ou MÊS (mês inteiro). */
export type FocusPeriodKind = 'SEMANA' | 'MÊS';

/**
 * Estado da Visão da Rede.
 *
 * O que vai ao banco e o que não vai:
 *
 *   trocar de PERÍODO  -> nova busca (o intervalo mudou);
 *   trocar de DISTRITO -> nenhuma busca, recalcula em memória;
 *   trocar de LOJA     -> nenhuma busca, recalcula em memória;
 *   trocar de GRUPO    -> nenhuma busca, recalcula em memória;
 *   abrir uma LOJA     -> nenhuma busca, recalcula em memória.
 *
 * NENHUM FILTRO DESTA TELA AUTORIZA COISA ALGUMA. A busca sai sem `store_id` e
 * sem `district_id`: quem decide o que volta é a RLS, a partir de `auth.uid()`.
 * Distrito e loja aqui só recortam o que já chegou. Mudar o estado pelo
 * DevTools muda o recorte, nunca o conjunto.
 *
 * Os cálculos ficam em `useMemo` porque são puros: só refazem quando os dados
 * ou os filtros mudam de verdade, nunca a cada render.
 */
export function useNetworkAnalytics(profile: SessionProfile) {
  const [kind, setKind] = useState<PeriodKind>('LAST_7');
  const [custom, setCustom] = useState<DateRange | null>(null);

  const [loaded, setLoaded] = useState<LoadedRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Distrito travado do perfil distrital.
   *
   * É CONVENIÊNCIA, não segurança: Paulo já recebe do banco só as lojas do
   * distrito dele. Travar aqui apenas evita mostrar a ele um seletor com uma
   * opção só, e mantém o rótulo da tela coerente.
   */
  const lockedDistrictId = profile.accessScope === 'DISTRICT' ? profile.districtId : null;

  const [districtId, setDistrictId] = useState<string | null>(lockedDistrictId);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [functionGroup, setFunctionGroup] = useState<string | null>(null);
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);

  /**
   * O que está aberto no drawer de foco: uma função, um grupo ou um setor.
   *
   * Fica ao lado de `openStoreId`, não dentro dele, porque os dois podem estar
   * abertos ao mesmo tempo: quem clica numa loja DENTRO do detalhe de uma
   * função espera voltar para a função ao fechar a loja.
   */
  const [focus, setFocus] = useState<AnalyticsFocus | null>(null);

  /**
   * FASE F — seletor SEMANA | MÊS no drawer de foco.
   *
   * Controla o período usado para recalcular os números dentro do drawer.
   * 'SEMANA' usa o período semanal do painel; 'MÊS' usa o mês inteiro da
   * referência. O dashboard principal NÃO muda — só o drawer.
   */
  const [focusPeriodKind, setFocusPeriodKind] = useState<FocusPeriodKind>('SEMANA');

  const period = useMemo(
    () => resolvePeriod(kind, { custom: custom ?? undefined }),
    [kind, custom],
  );

  /**
   * Para o drawer de foco poder alternar SEMANA|MÊS sem nova ida ao banco,
   * carregamos SEMPRE o mês inteiro da referência. O dashboard filtra em
   * memória para mostrar só os 7 dias (ou o período escolhido).
   */
  const loadPeriod = useMemo(() => {
    return resolvePeriod('MONTH', { custom: custom ?? undefined });
  }, [custom]);

  useEffect(() => {
    const signal = { cancelled: false };

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const result = await loadNetworkRange(loadPeriod);
        if (signal.cancelled) return;
        setLoaded(result);
      } catch (cause) {
        if (signal.cancelled) return;
        setLoaded(null);
        setError(cause instanceof Error ? cause.message : 'Falha ao carregar o período.');
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      signal.cancelled = true;
    };
  }, [loadPeriod]);

  const filters: AnalyticsFilters = useMemo(
    () => ({ districtId: lockedDistrictId ?? districtId, storeId, functionGroup }),
    [lockedDistrictId, districtId, storeId, functionGroup],
  );

  const analytics = useMemo(
    () => (loaded ? analyze(loaded, filters, period) : null),
    [loaded, filters, period],
  );

  /**
   * Período efetivo do drawer de foco.
   *
   * SEMANA = o período resolvido do painel (geralmente LAST_7).
   * MÊS    = primeiro ao último dia do mês da referência.
   */
  const focusPeriod: ResolvedPeriod = useMemo(() => {
    if (focusPeriodKind === 'SEMANA') return period;
    return resolvePeriod('MONTH', { custom: custom ?? undefined });
  }, [focusPeriodKind, period, custom]);

  const focusAnalysis = useMemo(
    () =>
      loaded && focus ? analyzeFocus(loaded, focus, filters, focusPeriod) : null,
    [loaded, focus, filters, focusPeriod],
  );

  const storeAnalysis = useMemo(
    () =>
      loaded && openStoreId
        ? analyzeStore(
            loaded,
            openStoreId,
            filters,
            focus?.kind === 'POSITION' ? focus.positionId : null,
            focusPeriod,
          )
        : null,
    [loaded, openStoreId, filters, focus, focusPeriod],
  );

  /** Trocar para personalizado já leva as datas do período atual. */
  const changeKind = useCallback(
    (next: PeriodKind) => {
      if (next === 'CUSTOM' && !custom) {
        setCustom({ start: period.range.start, end: period.range.end });
      }
      setOpenStoreId(null);
      setFocus(null);
      setFocusPeriodKind('SEMANA');
      setKind(next);
    },
    [custom, period.range.end, period.range.start],
  );

  const changeCustom = useCallback((next: DateRange) => {
    setOpenStoreId(null);
    setFocus(null);
    setFocusPeriodKind('SEMANA');
    setCustom(next);
    setKind('CUSTOM');
  }, []);

  return {
    period,
    kind,
    changeKind,
    custom: custom ?? period.range,
    changeCustom,

    analytics,
    loading,
    error,

    districtId: lockedDistrictId ?? districtId,
    districtLocked: lockedDistrictId !== null,
    setDistrictId: useCallback(
      (next: string | null) => {
        if (lockedDistrictId !== null) return;
        setOpenStoreId(null);
        setStoreId(null);
        setDistrictId(next);
      },
      [lockedDistrictId],
    ),

    storeId,
    setStoreId: useCallback((next: string | null) => {
      setOpenStoreId(null);
      setStoreId(next);
    }, []),
    functionGroup,
    setFunctionGroup,

    focusAnalysis,
    openFocus: setFocus,
    closeFocus: useCallback(() => {
      setFocus(null);
      setOpenStoreId(null);
      setFocusPeriodKind('SEMANA');
    }, []),

    storeAnalysis,
    openStore: setOpenStoreId,
    closeStore: useCallback(() => setOpenStoreId(null), []),

    focusPeriodKind,
    setFocusPeriodKind,
  };
}
