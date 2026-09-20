import { useState, type FormEvent } from 'react';
import { StorePicker } from '@/components/StorePicker';
import { APP_NAME, APP_SUBTITLE } from '@/lib/constants';
import { selectableStores, storeOptionLabel } from '@/lib/storeLogin';
import { resolveUserAlias } from '@/lib/userAliases';

/** Os dois caminhos de entrada. */
type AccessMode = 'STORE' | 'MANAGEMENT';

interface Props {
  /** Acesso gerencial: alias do usuário e senha. */
  onSignIn: (email: string, password: string) => void | Promise<void>;
  /** Acesso loja: filial escolhida e senha. */
  onSignInWithStore: (storeId: string, password: string) => void | Promise<void>;
  loading: boolean;
  error: string | null;
}

export function LoginPage({ onSignIn, onSignInWithStore, loading, error }: Props) {
  const [mode, setMode] = useState<AccessMode>('STORE');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const selecionada = selectableStores().find((store) => store.id === storeId) ?? null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLocalError(null);

    if (mode === 'STORE') {
      if (!storeId) {
        setLocalError('Selecione sua filial para continuar.');
        return;
      }
      await onSignInWithStore(storeId, password);
    } else {
      const email = resolveUserAlias(username);
      if (!email) {
        setLocalError('Usuário ou senha inválidos.');
        setPassword('');
        return;
      }
      await onSignIn(email, password);
    }

    setPassword('');
  };

  const trocarModo = (next: AccessMode) => {
    setMode(next);
    setPassword('');
    setLocalError(null);
  };

  const mensagem = localError ?? error;

  return (
    <div className="login">
      <div className="login__hero" aria-hidden="true" />

      <form className="login__card" onSubmit={handleSubmit}>
        <div className="login__brand">
          <h1 className="login__title">{APP_NAME}</h1>
          <p className="login__subtitle">{APP_SUBTITLE}</p>
        </div>

        <div className="login__modes" role="group" aria-label="Tipo de acesso">
          <button
            type="button"
            className={`login__mode${mode === 'STORE' ? ' login__mode--on' : ''}`}
            aria-pressed={mode === 'STORE'}
            disabled={loading}
            onClick={() => trocarModo('STORE')}
          >
            Acesso loja
          </button>
          <button
            type="button"
            className={`login__mode${mode === 'MANAGEMENT' ? ' login__mode--on' : ''}`}
            aria-pressed={mode === 'MANAGEMENT'}
            disabled={loading}
            onClick={() => trocarModo('MANAGEMENT')}
          >
            Acesso gerencial
          </button>
        </div>

        {mensagem && (
          <div className="alert alert--error" role="alert">
            {mensagem}
          </div>
        )}

        {mode === 'STORE' ? (
          <>
            <StorePicker value={storeId} onChange={setStoreId} disabled={loading} />
            {selecionada && (
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={storeOptionLabel(selecionada)}
                readOnly
                hidden
              />
            )}
          </>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor="login-username">
              Usuário
            </label>
            <input
              id="login-username"
              className="field__input"
              type="text"
              autoComplete="username"
              placeholder="Digite seu usuário"
              required
              value={username}
              disabled={loading}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor="login-password">
            Senha
          </label>
          <input
            id="login-password"
            className="field__input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            disabled={loading}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button type="submit" className="btn btn--primary login__submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="login__hint">
          {mode === 'STORE'
            ? 'Escolha a filial e informe a senha da loja. Não é preciso digitar e-mail.'
            : 'Informe seu usuário e senha. Caso não tenha acesso, fale com o administrador.'}
        </p>
      </form>
    </div>
  );
}
