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
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="login__hero" aria-hidden="true"><div className="login__hero-caption"><span>GESTÃO DE PESSOAS</span><strong>Conferências mais simples. Operação mais organizada.</strong><p>Hiperideal · Sua rotina, em um só lugar.</p></div></div>

      <form className="login__card" onSubmit={handleSubmit}>
        <div className="login__brand">
          <span className="login__brand-eyebrow">PORTAL OPERACIONAL</span>
          <h1 className="login__title">{APP_NAME}</h1>
          <p className="login__subtitle">{APP_SUBTITLE}</p>
          <p className="login__brand-description">Acesso às conferências da sua unidade</p>
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
          <div className="login__password-wrap">
            <input
              id="login-password"
              className="field__input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              disabled={loading}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="login__password-toggle"
              disabled={loading}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        <button type="submit" className="btn btn--primary login__submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar no sistema'}
        </button>

        <p className="login__hint">
          {mode === 'STORE'
            ? 'Escolha a filial e informe a senha da loja. Não é preciso digitar e-mail.'
            : 'Informe seu usuário e senha. Caso não tenha acesso, fale com o administrador.'}
        </p>
        <div className="login__footer"><span className="login__security-dot" aria-hidden="true" /> Acesso restrito a usuários autorizados</div>
      </form>
    </div>
  );
}
