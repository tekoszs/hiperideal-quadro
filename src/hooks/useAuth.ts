import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthState } from '@/types/auth';
import {
  AuthError,
  getAuthMode,
  getCurrentSession,
  getDemoProfile,
  loadProfile,
  onAuthChange,
  signIn as signInService,
  signInWithStore as signInWithStoreService,
  signOut as signOutService,
} from '@/services/authService';

/**
 * Sessão da aplicação.
 *
 * DEMO     -> perfil local fixo, sem tela de login.
 * SUPABASE -> exige login real; a sessão é restaurada pelo SDK ao recarregar,
 *             e o perfil (role/loja) é sempre relido do banco.
 */
export function useAuth() {
  const mode = useMemo(() => getAuthMode(), []);
  const [state, setState] = useState<AuthState>(() =>
    mode === 'DEMO'
      ? {
          mode,
          status: 'READY',
          profile: getDemoProfile(),
          email: null,
          error: null,
        }
      : { mode, status: 'LOADING', profile: null, email: null, error: null },
  );
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (mode === 'DEMO') return;
    let cancelled = false;

    async function applySession(session: Awaited<ReturnType<typeof getCurrentSession>>) {
      if (!session) {
        if (!cancelled) {
          setState({ mode, status: 'SIGNED_OUT', profile: null, email: null, error: null });
        }
        return;
      }

      try {
        const profile = await loadProfile(session);
        if (cancelled) return;
        setState({
          mode,
          status: profile ? 'READY' : 'NO_PROFILE',
          profile,
          email: session.user.email ?? null,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          mode,
          status: 'NO_PROFILE',
          profile: null,
          email: session.user.email ?? null,
          error: error instanceof Error ? error.message : 'Falha ao carregar o perfil.',
        });
      }
    }

    // Restaura a sessão salva ao abrir/recarregar a página.
    void getCurrentSession().then(applySession);

    // Login, logout e renovação de token (inclusive vindos de outra aba).
    const unsubscribe = onAuthChange((session) => {
      void applySession(session);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [mode]);

  /**
   * Executa uma tentativa de login e trata o erro de um jeito só.
   *
   * Os dois caminhos (e-mail e loja) terminam no mesmo Supabase Auth, então
   * compartilham o tratamento — o que muda é apenas como o endereço da conta
   * é obtido.
   */
  const runSignIn = useCallback(async (attempt: () => Promise<void>) => {
    setSigningIn(true);
    setState((current) => ({ ...current, error: null }));
    try {
      await attempt();
      // O restante do estado vem pelo onAuthChange.
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'SIGNED_OUT',
        error:
          error instanceof AuthError
            ? error.message
            : 'Não foi possível entrar. Tente novamente.',
      }));
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutService();
      setState({ mode, status: 'SIGNED_OUT', profile: null, email: null, error: null });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Falha ao sair.',
      }));
    }
  }, [mode]);

  const signIn = useCallback(
    (email: string, password: string) => runSignIn(() => signInService(email, password)),
    [runSignIn],
  );

  /** Login do gerente pela filial escolhida. Ver `signInWithStore`. */
  const signInWithStore = useCallback(
    (storeId: string, password: string) =>
      runSignIn(() => signInWithStoreService(storeId, password)),
    [runSignIn],
  );

  return { ...state, signingIn, signIn, signInWithStore, signOut };
}
