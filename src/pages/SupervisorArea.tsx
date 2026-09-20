import { useCallback, useState } from 'react';
import type { SessionProfile } from '@/types/auth';
import { SupervisorAdministrationPage } from '@/pages/SupervisorAdministrationPage';
import { SupervisorConferencesPage } from '@/pages/SupervisorConferencesPage';
import { SupervisorHomePage } from '@/pages/SupervisorHomePage';
import { SupervisorNetworkDashboardPage } from '@/pages/SupervisorNetworkDashboardPage';
import { getDistrict } from '@/data/network';

interface Props {
  profile: SessionProfile;
}

/** Telas do supervisor/administrador. */
type SupervisorView = 'HOME' | 'NETWORK' | 'CONFERENCES' | 'ADMINISTRATION';

/**
 * Navegação interna do supervisor.
 *
 * Fica aqui, e não no App, para o App continuar cuidando só de autenticação e
 * de escolher a área por perfil — como foi definido na fase 1.
 *
 * `conferencesDate` existe para o link que vem da Visão da Rede ("Ver
 * conferências de 05/09/2026") abrir a tela já naquela data, em vez de
 * duplicar o detalhamento operacional dentro do dashboard.
 */
export function SupervisorArea({ profile }: Props) {
  const [view, setView] = useState<SupervisorView>('HOME');
  const [conferencesDate, setConferencesDate] = useState<string | undefined>(undefined);

  const openConferences = useCallback((referenceDate?: string) => {
    setConferencesDate(referenceDate);
    setView('CONFERENCES');
  }, []);

  if (view === 'HOME') {
    return (
      <SupervisorHomePage
        profile={profile}
        onOpenNetwork={() => setView('NETWORK')}
        onOpenConferences={() => openConferences(undefined)}
        onOpenAdministration={() => setView('ADMINISTRATION')}
      />
    );
  }

  return (
    <>
      <SupervisorNav
        current={view}
        networkLabel={
          profile.accessScope === 'DISTRICT' ? 'Visão do Distrito' : 'Visão da Rede'
        }
        scopeLabel={
          profile.accessScope === 'DISTRICT'
            ? (getDistrict(profile.districtId)?.name ?? 'Distrito')
            : null
        }
        onNetwork={() => setView('NETWORK')}
        onConferences={() => openConferences(undefined)}
        onAdministration={() => setView('ADMINISTRATION')}
        showAdministration={profile.role === 'ADMIN'}
      />

      {view === 'NETWORK' ? (
        <SupervisorNetworkDashboardPage
          profile={profile}
          onBack={() => setView('HOME')}
          onOpenConferences={openConferences}
        />
      ) : view === 'CONFERENCES' ? (
        <SupervisorConferencesPage
          profile={profile}
          onBack={() => setView('HOME')}
          initialDate={conferencesDate}
        />
      ) : (
        <SupervisorAdministrationPage profile={profile} onBack={() => setView('HOME')} />
      )}
    </>
  );
}

interface NavProps {
  current: SupervisorView;
  /** "Visão da Rede" ou "Visão do Distrito", conforme o escopo. */
  networkLabel: string;
  /** Distrito fixo do perfil, quando houver. Informativo. */
  scopeLabel: string | null;
  onNetwork: () => void;
  onConferences: () => void;
  onAdministration: () => void;
  showAdministration: boolean;
}

/** Abas das áreas gerenciais, com a atual destacada. */
function SupervisorNav({
  current,
  networkLabel,
  scopeLabel,
  onNetwork,
  onConferences,
  onAdministration,
  showAdministration,
}: NavProps) {
  return (
    <nav className="supervisor-nav" aria-label="Áreas do supervisor">
      <div className="supervisor-nav__tabs">
        <button
          type="button"
          className={`supervisor-nav__tab${current === 'NETWORK' ? ' supervisor-nav__tab--on' : ''}`}
          aria-current={current === 'NETWORK' ? 'page' : undefined}
          onClick={onNetwork}
        >
          {networkLabel}
        </button>
        <button
          type="button"
          className={`supervisor-nav__tab${current === 'CONFERENCES' ? ' supervisor-nav__tab--on' : ''}`}
          aria-current={current === 'CONFERENCES' ? 'page' : undefined}
          onClick={onConferences}
        >
          Conferências
        </button>
        {showAdministration && (
          <button
            type="button"
            className={`supervisor-nav__tab${current === 'ADMINISTRATION' ? ' supervisor-nav__tab--on' : ''}`}
            aria-current={current === 'ADMINISTRATION' ? 'page' : undefined}
            onClick={onAdministration}
          >
            Administração
          </button>
        )}
      </div>

      {scopeLabel && <span className="supervisor-nav__scope">{scopeLabel}</span>}
    </nav>
  );
}
