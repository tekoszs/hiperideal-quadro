import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NetworkDetail, NetworkFilter } from '@/types/network';
import type { SessionProfile } from '@/types/auth';
import { applyDistrictFilter, selectNetworkRows, summarizeNetworkDay } from '@/domain/network';
import { buildDistrictOptions } from '@/domain/analytics';
import { getNetworkDetail, loadNetworkDay, type NetworkDay } from '@/services/networkService';
import { getReferenceDate, shiftIsoDate } from '@/utils/date';

/**
 * Estado da tela CONFERÊNCIAS do supervisor.
 *
 * Abre sempre em D-1, como a tela do gerente. Distrito, filtro, busca e
 * ordenação acontecem em memória sobre o dia já carregado — trocar de filtro
 * não vai ao banco de novo; trocar de DATA vai.
 *
 * O DISTRITO aqui só recorta: a busca sai sem `district_id` e o que volta é
 * decidido pela RLS. Um gerente distrital já recebe apenas as lojas dele.
 */
export function useNetworkDay(profile: SessionProfile, initialDate: string = getReferenceDate()) {
  const [referenceDate, setReferenceDate] = useState(initialDate);
  const [day, setDay] = useState<NetworkDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<NetworkFilter>('ALL');
  const [search, setSearch] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);

  // Distrito travado do perfil distrital — conveniência, não segurança.
  const lockedDistrictId = profile.accessScope === 'DISTRICT' ? profile.districtId : null;
  const [districtId, setDistrictId] = useState<string | null>(lockedDistrictId);
  const distritoAtivo = lockedDistrictId ?? districtId;

  const load = useCallback(async (date: string, signal: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadNetworkDay(date);
      if (signal.cancelled) return;
      setDay(loaded);
    } catch (cause) {
      if (signal.cancelled) return;
      setDay(null);
      setError(
        cause instanceof Error ? cause.message : 'Falha ao carregar as conferências do dia.',
      );
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(referenceDate, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [referenceDate, load]);

  /** Trocar de data fecha o detalhamento aberto — ele é de outro dia. */
  const changeDate = useCallback((next: string) => {
    setSelectedStoreId(null);
    setReferenceDate(next);
  }, []);

  const goToPreviousDay = useCallback(
    () => changeDate(shiftIsoDate(referenceDate, -1)),
    [changeDate, referenceDate],
  );

  const goToNextDay = useCallback(
    () => changeDate(shiftIsoDate(referenceDate, 1)),
    [changeDate, referenceDate],
  );

  const rows = useMemo(
    () => (day ? selectNetworkRows(day.rows, { filter, search, districtId: distritoAtivo }) : []),
    [day, filter, search, distritoAtivo],
  );

  /**
   * Linhas do distrito escolhido, ANTES do filtro e da busca.
   *
   * É a base honesta dos cards e da mensagem de lista vazia: com o Distrito 1
   * selecionado, "3 de 20" tem de contar as 20 do distrito, não as 34 da rede.
   */
  const districtRows = useMemo(
    () => (day ? applyDistrictFilter(day.rows, distritoAtivo) : []),
    [day, distritoAtivo],
  );

  const summary = useMemo(
    () => (day ? summarizeNetworkDay(districtRows) : null),
    [day, districtRows],
  );

  /**
   * Lojas que já ENVIARAM no distrito/escopo atual.
   * Independe dos chips e da busca para funcionar como uma visão rápida do dia.
   */
  const submittedRows = useMemo(
    () =>
      districtRows
        .filter((row) => row.status === 'SUBMITTED')
        .sort((a, b) => a.storeName.localeCompare(b.storeName, 'pt-BR')),
    [districtRows],
  );

  /** Opções do seletor: saem das lojas que chegaram, nunca de uma lista fixa. */
  const districts = useMemo(
    () => (day ? buildDistrictOptions(day.raw.stores) : []),
    [day],
  );

  const detail: NetworkDetail | null = useMemo(
    () => (day && selectedStoreId ? getNetworkDetail(day, selectedStoreId) : null),
    [day, selectedStoreId],
  );

  return {
    referenceDate,
    summary,
    /** Já enviadas no escopo atual, sem depender do filtro/busca da lista. */
    submittedRows,
    /** Já filtradas, buscadas e ordenadas. */
    rows,
    /** Lojas do distrito atual antes do filtro — base da lista vazia. */
    totalRows: districtRows.length,
    loading,
    error,

    districts,
    districtId: distritoAtivo,
    /** True quando o perfil é distrital: a tela mostra o distrito, sem seletor. */
    districtLocked: lockedDistrictId !== null,
    setDistrictId: useCallback(
      (next: string | null) => {
        if (lockedDistrictId !== null) return;
        setSelectedStoreId(null);
        setDistrictId(next);
      },
      [lockedDistrictId],
    ),

    filter,
    setFilter,
    search,
    setSearch,
    detail,
    openDetail: setSelectedStoreId,
    closeDetail: useCallback(() => setSelectedStoreId(null), []),
    changeDate,
    goToPreviousDay,
    goToNextDay,
    reload: useCallback(
      () => load(referenceDate, { cancelled: false }),
      [load, referenceDate],
    ),
  };
}
