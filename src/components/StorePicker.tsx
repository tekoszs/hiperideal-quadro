import { useId, useMemo, useState } from 'react';
import type { NetworkStore } from '@/data/network';
import { searchStores, selectableStores, storeOptionLabel } from '@/lib/storeLogin';

interface Props {
  value: string | null;
  onChange: (storeId: string | null) => void;
  disabled?: boolean;
}

/**
 * Seletor pesquisável das lojas da rede.
 *
 * Um campo de busca + uma lista filtrada. NÃO são 34 botões: numa tela de
 * 390px isso viraria uma rolagem interminável, e o gerente que sabe o código
 * da própria loja digita três dígitos e acabou.
 *
 * A busca ignora maiúscula, acento, hífen e espaço — "307", "LEPARC",
 * "Le Parc" e "le parc" chegam na mesma loja.
 *
 * Nada aqui autoriza: a escolha só monta o e-mail técnico do login.
 */
export function StorePicker({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState('');
  const listId = useId();

  const todas = useMemo(() => selectableStores(), []);
  const filtradas = useMemo(() => searchStores(query, todas), [query, todas]);
  const selecionada = todas.find((store) => store.id === value) ?? null;

  return (
    <div className="store-picker">
      <label className="field__label" htmlFor={`${listId}-busca`}>
        Selecione sua filial
      </label>

      {selecionada ? (
        <div className="store-picker__chosen">
          <span className="store-picker__chosen-label">{storeOptionLabel(selecionada)}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
          >
            Trocar
          </button>
        </div>
      ) : (
        <>
          <input
            id={`${listId}-busca`}
            className="field__input"
            type="search"
            value={query}
            disabled={disabled}
            placeholder="Código ou nome — ex.: 307 ou LEPARC"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />

          <ul className="store-picker__list" role="listbox" aria-label="Lojas da rede">
            {filtradas.length === 0 ? (
              <li className="store-picker__empty">Nenhuma loja encontrada.</li>
            ) : (
              filtradas.map((store) => (
                <li key={store.id}>
                  <button
                    type="button"
                    className="store-picker__option"
                    role="option"
                    aria-selected={false}
                    disabled={disabled}
                    onClick={() => onChange(store.id)}
                  >
                    <span className="store-picker__code">{store.code}</span>
                    <span className="store-picker__name">{store.name}</span>
                    {store.fullName && store.fullName !== store.name && (
                      <span className="store-picker__full">{store.fullName}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>

          <p className="field__hint">
            {filtradas.length} de {todas.length} lojas
          </p>
        </>
      )}
    </div>
  );
}

/** Reexportado para os testes não precisarem conhecer o módulo interno. */
export type { NetworkStore };
