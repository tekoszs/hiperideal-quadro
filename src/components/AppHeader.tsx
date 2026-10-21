import type { Store } from '@/types/domain';
import type { SessionProfile } from '@/types/auth';
import { ROLE_LABEL } from '@/types/auth';
import { APP_SUBTITLE } from '@/lib/constants';

interface Props {
  profile: SessionProfile | null;
  store?: Store | null;
  onSignOut: () => void;
  showSignOut: boolean;
}

/**
 * Cabeçalho da conferência. A arte aprovada fica em public/download.jpg.
 * As informações de acesso e a ação de sair permanecem interativas e fora
 * da imagem, evitando texto duplicado e sobreposição em telas menores.
 */
export function AppHeader({ profile, store, onSignOut, showSignOut }: Props) {
  const showAccountBar = store !== undefined || Boolean(profile) || showSignOut;

  return (
    <header className="quadro-banner">
      <div className="quadro-banner__mobile-brand">
        <strong>Hiperideal</strong>
        <span>{APP_SUBTITLE}</span>
      </div>

      <div className="quadro-banner__artwork">
        <img
          className="quadro-banner__image"
          src="/download.jpg"
          alt="Hiperideal. Conferência Diária de Quadro. Sou do Time Ideal."
          width={1955}
          height={251}
          decoding="async"
        />
      </div>

      {showAccountBar && (
        <div className="quadro-banner__account">
          <div className="quadro-banner__account-details">
            {store !== undefined && (
              <div className="quadro-banner__store">
                <strong>{store ? store.name : 'Loja não identificada'}</strong>
                {store && <span>Código {store.code}</span>}
              </div>
            )}
            {profile && (
              <div className="quadro-banner__user">
                <strong>{profile.name}</strong>
                <span>{ROLE_LABEL[profile.role]}</span>
              </div>
            )}
          </div>

          {showSignOut && (
            <button
              type="button"
              className="quadro-banner__signout"
              onClick={onSignOut}
            >
              Sair
            </button>
          )}
        </div>
      )}
    </header>
  );
}
