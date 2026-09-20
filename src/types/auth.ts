import type { ProfileRole } from '@/types/domain';

/**
 * Perfil do usuário logado.
 *
 * `role` e `storeId` vêm SEMPRE da tabela `profiles` no banco — nunca de
 * algo escolhido no navegador. No modo demo vêm de uma constante local.
 */
/**
 * Até onde o usuário enxerga. Separado de `role` de propósito: Paulo, Ericson e
 * Roberval são todos SUPERVISOR, mas enxergam 20, 14 e 34 lojas.
 *
 *   STORE     uma loja      (gerente)
 *   DISTRICT  um distrito   (gerente distrital)
 *   ALL       a rede toda   (gerente geral e administrador)
 */
export type AccessScope = 'STORE' | 'DISTRICT' | 'ALL';

export interface SessionProfile {
  id: string;
  name: string;
  role: ProfileRole;
  storeId: string | null;
  active: boolean;
  email: string | null;
  /** Vem do banco. NUNCA de escolha do usuário ou da URL. */
  accessScope: AccessScope;
  /** Distrito do perfil. Só preenchido para escopo DISTRICT. */
  districtId: string | null;
  /** Cargo exibido na tela. Não é regra de segurança. */
  jobTitle: string | null;
}

export type AuthMode = 'SUPABASE' | 'DEMO';

export type AuthStatus =
  /** Ainda verificando se existe sessão salva. */
  | 'LOADING'
  /** Sem sessão: mostrar tela de login. */
  | 'SIGNED_OUT'
  /** Autenticado e com perfil ativo. */
  | 'READY'
  /** Autenticado no Supabase, mas sem registro ativo em `profiles`. */
  | 'NO_PROFILE';

export interface AuthState {
  mode: AuthMode;
  status: AuthStatus;
  profile: SessionProfile | null;
  email: string | null;
  error: string | null;
}

export const ROLE_LABEL: Record<ProfileRole, string> = {
  MANAGER: 'Gerente',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Administrador',
};

/** True quando o perfil enxerga mais de uma loja (supervisão). */
export function isNetworkProfile(profile: SessionProfile): boolean {
  return profile.accessScope === 'DISTRICT' || profile.accessScope === 'ALL';
}
