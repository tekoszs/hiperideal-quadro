import { useEffect, useState } from 'react';
import type { AbsenceReason, Position, Store } from '@/types/domain';
import {
  getStoreById,
  listAbsenceReasons,
  listPositionsByStore,
} from '@/services/catalogService';

export interface CatalogState {
  loading: boolean;
  error: string | null;
  store: Store | null;
  positions: Position[];
  reasons: AbsenceReason[];
}

/**
 * Carrega loja, funções e motivos da loja indicada.
 *
 * O `storeId` vem do PERFIL do usuário — o gerente não escolhe a loja.
 * Nenhuma tela acessa o catálogo direto.
 */
export function useCatalog(storeId: string | null): CatalogState {
  const [state, setState] = useState<CatalogState>({
    loading: true,
    error: null,
    store: null,
    positions: [],
    reasons: [],
  });

  useEffect(() => {
    let cancelled = false;

    if (!storeId) {
      setState({
        loading: false,
        error: 'Seu usuário não está vinculado a uma loja.',
        store: null,
        positions: [],
        reasons: [],
      });
      return;
    }

    async function load(id: string) {
      setState((current) => ({ ...current, loading: true }));
      try {
        const [store, positions, reasons] = await Promise.all([
          getStoreById(id),
          listPositionsByStore(id),
          listAbsenceReasons(),
        ]);
        if (cancelled) return;

        if (!store) {
          setState({
            loading: false,
            error: 'Loja não encontrada ou sem permissão de acesso.',
            store: null,
            positions: [],
            reasons: [],
          });
          return;
        }

        setState({ loading: false, error: null, store, positions, reasons });
      } catch (error) {
        if (cancelled) return;
        setState({
          loading: false,
          error: error instanceof Error ? error.message : 'Falha ao carregar cadastros.',
          store: null,
          positions: [],
          reasons: [],
        });
      }
    }

    void load(storeId);
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  return state;
}
