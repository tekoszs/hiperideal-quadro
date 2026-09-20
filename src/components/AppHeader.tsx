import type { Store } from '@/types/domain';
import type { SessionProfile } from '@/types/auth';
import { ROLE_LABEL } from '@/types/auth';
import { APP_NAME, APP_SUBTITLE } from '@/lib/constants';

interface Props {
  profile: SessionProfile | null;
  /** Quando presente, mostra a loja (tela do gerente). */
  store?: Store | null;
  onSignOut: () => void;
  showSignOut: boolean;
}

/**
 * FASE 4.4 — CABEÇALHO LEVE.
 *
 * O que ele responde é "onde eu estou e quem eu sou", e nada além disso.
 *
 * A DATA SAIU DAQUI. Ela é a informação mais importante da tela, e por isso
 * mora no título do conteúdo (`ConferenceHeading`), em tamanho de título. Ter
 * a data em dois lugares custou um bug na fase 4.3 — o cabeçalho anunciava
 * domingo enquanto o formulário estava no sábado. Com uma fonte só, essa
 * divergência deixa de ser possível em vez de precisar de conserto.
 *
 * Os três blocos rótulo/valor empilhados viraram duas linhas de texto: a mesma
 * informação, com uma fração do peso visual.
 */
export function AppHeader({ profile, store, onSignOut, showSignOut }: Props) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-header__brand-block">
          <h1 className="app-header__brand">{APP_NAME}</h1>
          {/* Redundante com o título do conteúdo no celular, onde some. */}
          <p className="app-header__subtitle">{APP_SUBTITLE}</p>
        </div>

        <div className="app-header__meta">
          <div className="app-header__lines">
            {store !== undefined && (
              <p className="app-header__store">
                {store ? store.name : '—'}
                {store && <span className="app-header__code">Código {store.code}</span>}
              </p>
            )}

            {profile && (
              <p className="app-header__user">
                {profile.name}
                <span className="app-header__role">{ROLE_LABEL[profile.role]}</span>
              </p>
            )}
          </div>

          {showSignOut && (
            <button type="button" className="app-header__signout" onClick={onSignOut}>
              Sair
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
