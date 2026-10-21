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

export function AppHeader({ profile, store, onSignOut, showSignOut }: Props) {
  return (
    <header className="quadro-banner">
      <div className="quadro-banner__main">
        <div className="quadro-banner__brand" aria-label="Hiperideal, Conferência de Quadro">
          <span className="quadro-banner__monogram" aria-hidden="true">H</span>
          <span className="quadro-banner__brandtext">
            <strong>hiperideal<span style={{ color: '#2aa773' }}>.</span></strong>
            <span>{APP_SUBTITLE} <span aria-hidden="true">/</span> Gestão de Pessoas</span>
          </span>
        </div>
        <div className="quadro-banner__right">
          <span className="quadro-banner__tag">Gestão de quadro</span>
          <div className="quadro-banner__account">
            <div className="quadro-banner__account-details">
              {store !== undefined && (
                <div className="quadro-banner__store">
                  <strong>{store ? store.name : 'Loja não identificada'}</strong>
                  {store && <span>Filial {store.code}</span>}
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
              <button type="button" className="quadro-banner__signout" onClick={onSignOut}>
                Sair
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
