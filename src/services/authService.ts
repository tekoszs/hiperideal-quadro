import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabaseClient';
import { DEMO_PROFILE, demoProfileFor, demoScopeFromLocation } from '@/lib/demo';
import type { AccessScope, AuthMode, SessionProfile } from '@/types/auth';
import type { ProfileRole } from '@/types/domain';
import { storeLoginEmail } from '@/lib/storeLogin';
import { NETWORK_STORES } from '@/data/network';

interface ProfileRow {
  id: string;
  name: string;
  role: ProfileRole;
  store_id: string | null;
  active: boolean;
  access_scope: AccessScope;
  district_id: string | null;
  job_title: string | null;
}

/** DEMO quando o .env do Supabase está vazio; SUPABASE quando configurado. */
export function getAuthMode(): AuthMode {
  return isSupabaseConfigured() ? 'SUPABASE' : 'DEMO';
}

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase não configurado.');
  }
  return client;
}

/** Traduz os erros do Supabase Auth para português, sem vazar detalhe técnico. */
function translateAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) {
    return 'Usuário ou senha inválidos.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'E-mail ainda não confirmado. Verifique sua caixa de entrada.';
  }
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return 'Muitas tentativas. Aguarde um instante e tente de novo.';
  }
  if (normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'Sem conexão com o servidor. Verifique a internet.';
  }
  return 'Usuário ou senha inválidos.';
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Login com e-mail e senha.
 *
 * O e-mail vem da resolução do alias (lib/userAliases.ts). O frontend nunca
 * expõe o e-mail técnico — o usuário digita apenas o alias.
 *
 * A senha vai direto para o Supabase Auth e NUNCA é guardada localmente —
 * quem persiste a sessão é o próprio SDK, com token renovável.
 */
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new AuthError(translateAuthError(error.message));
}

/**
 * LOGIN DO GERENTE DE LOJA — escolhe a filial e digita a senha.
 *
 * O e-mail nunca é digitado nem exibido: sai da convenção determinística em
 * `lib/storeLogin.ts`, a partir do código da loja escolhida. Por baixo continua
 * sendo o Supabase Auth com e-mail e senha — nenhuma autenticação própria foi
 * inventada.
 *
 * A LOJA ESCOLHIDA NÃO AUTORIZA NADA. Ela só monta o endereço da conta. Depois
 * do login, a loja da sessão vem de `quadro_profiles.store_id`, lido do banco
 * a partir de `auth.uid()`. Se alguém escolher LEPARC e autenticar a conta da
 * PQSHOP, a sessão abre PQSHOP.
 *
 * A senha vai direto para o Supabase e não é guardada em lugar nenhum.
 */
export async function signInWithStore(storeId: string, password: string): Promise<void> {
  const store = NETWORK_STORES.find((candidate) => candidate.id === storeId);
  if (!store) {
    throw new AuthError('Selecione uma filial da lista.');
  }

  const { error } = await requireClient().auth.signInWithPassword({
    email: storeLoginEmail(store.code),
    password,
  });
  if (error) throw new AuthError(translateAuthError(error.message));
}

export async function signOut(): Promise<void> {
  if (getAuthMode() === 'DEMO') return;
  const { error } = await requireClient().auth.signOut();
  if (error) throw new AuthError('Não foi possível sair. Tente novamente.');
}

/** Sessão salva pelo SDK — é o que restaura o login após recarregar a página. */
export async function getCurrentSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

/** Notifica login/logout/refresh de token, inclusive em outra aba. */
export function onAuthChange(callback: (session: Session | null) => void): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

/**
 * Carrega o perfil do usuário autenticado.
 *
 * A RLS garante que só a própria linha volta. Retorna null quando o usuário
 * existe no Auth mas não tem perfil ativo — caso legítimo, tratado na UI.
 */
export async function loadProfile(session: Session): Promise<SessionProfile | null> {
  const { data, error } = await requireClient()
    .from('quadro_profiles')
    .select('id, name, role, store_id, active, access_scope, district_id, job_title')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) throw new AuthError(`Falha ao carregar o perfil: ${error.message}`);
  if (!data) return null;

  const row = data as ProfileRow;
  if (!row.active) return null;

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    storeId: row.store_id,
    active: row.active,
    email: session.user.email ?? null,
    // O escopo vem SEMPRE do banco. Se a coluna ainda não existir (base antiga
    // antes da migration 0014), cai no comportamento anterior: gerente vê a
    // própria loja, supervisor e admin veem a rede.
    accessScope: row.access_scope ?? (row.role === 'MANAGER' ? 'STORE' : 'ALL'),
    districtId: row.district_id ?? null,
    jobTitle: row.job_title ?? null,
  };
}

/**
 * Perfil usado no modo demo. Nunca é usado quando o Supabase está configurado.
 *
 * A SEGUNDA GUARDA É DE PROPÓSITO. Quem chama já está dentro do ramo DEMO do
 * `useAuth`, mas o `?demo=` da URL escolhe um perfil — e um seletor de perfil
 * vindo da URL só pode existir onde não há banco nenhum atrás. Repetir a
 * checagem aqui torna impossível esta linha ser alcançada com o Supabase
 * ligado, mesmo que alguém chame a função de outro lugar amanhã.
 */
export function getDemoProfile(): SessionProfile {
  if (isSupabaseConfigured()) return { ...DEMO_PROFILE };

  const search = typeof window === 'undefined' ? '' : window.location.search;
  return demoProfileFor(demoScopeFromLocation(search));
}
