import { useCallback, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { useAuth } from '@/hooks/useAuth';
import { LoginPage } from '@/pages/LoginPage';
import { ManagerConferencePage } from '@/pages/ManagerConferencePage';
import { NoProfilePage } from '@/pages/NoProfilePage';
import { SupervisorArea } from '@/pages/SupervisorArea';
import { DEMO_NOTICE } from '@/lib/demo';
import type { Store } from '@/types/domain';

/**
 * Dev-only: visualiza o LoginPage sem autenticar.
 * Uso: ?preview=login na URL. Só funciona em DEV/DEMO.
 * Em produção, o parâmetro é ignorado (o status nunca será SIGNED_OUT quando
 * Supabase está configurado — mas mesmo assim, guardamos com mode check).
 */
function isLoginPreview(): boolean {
  if (import.meta.env.PROD) return false;
  return new URLSearchParams(window.location.search).get('preview') === 'login';
}

/**
 * Ponto de montagem da aplicação: autenticação e navegação por perfil.
 * Nenhuma regra de negócio mora aqui.
 *
 *   MANAGER    -> Conferência Diária (loja vinda do perfil)
 *   SUPERVISOR -> Painel do Supervisor (home simples nesta fase)
 *   ADMIN      -> Painel do Administrador (home simples nesta fase)
 */
export default function App() {
  const { mode, status, profile, email, error, signingIn, signIn, signInWithStore, signOut } =
    useAuth();
  const [managerStore, setManagerStore] = useState<Store | null>(null);

  /*
   * A DATA NÃO PASSA MAIS POR AQUI (fase 4.4).
   *
   * Na 4.3 o `App` guardava a data para o cabeçalho mostrá-la, depois de um bug
   * em que ele calculava D-1 sozinho e discordava do formulário. Agora a data
   * mora só no título do conteúdo, onde o gerente precisa dela — e o cabeçalho
   * não tem o que divergir.
   */

  const handleStoreLoaded = useCallback((store: Store | null) => {
    setManagerStore(store);
  }, []);

  if (status === 'LOADING') {
    return (
      <div className="app-shell">
        <p className="state">Verificando sua sessão...</p>
      </div>
    );
  }

  /* DEV only: preview visual do login sem autenticar. */
  if (isLoginPreview()) {
    return (
      <LoginPage
        onSignIn={() => undefined}
        onSignInWithStore={() => undefined}
        loading={false}
        error={null}
      />
    );
  }

  if (status === 'SIGNED_OUT') {
    return (
      <LoginPage
        onSignIn={signIn}
        onSignInWithStore={signInWithStore}
        loading={signingIn}
        error={error}
      />
    );
  }

  // Roteia pelo ESCOPO, não pelo papel: quem enxerga uma loja só vai para a
  // conferência; quem enxerga distrito ou rede vai para a área de supervisão.
  const isManager = profile?.accessScope === 'STORE';

  return (
    <div className="app-shell">
      {mode === 'DEMO' && (
        <div className="demo-banner" role="status">
          <strong>Modo demonstração</strong>
          <span>{DEMO_NOTICE}</span>
        </div>
      )}

      <AppHeader
        profile={profile}
        store={isManager ? managerStore : undefined}
        onSignOut={() => void signOut()}
        showSignOut={mode === 'SUPABASE'}
      />

      {status === 'NO_PROFILE' || !profile ? (
        <NoProfilePage email={email} error={error} />
      ) : isManager ? (
        <ManagerConferencePage profile={profile} onStoreLoaded={handleStoreLoaded} />
      ) : (
        <SupervisorArea profile={profile} />
      )}
    </div>
  );
}
