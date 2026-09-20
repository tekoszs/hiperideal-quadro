/**
 * ALIASES DE LOGIN GERENCIAL — como "jackson" vira uma conta do Supabase Auth.
 *
 * DECISÃO: mapa determinístico, calculado no navegador, sem consulta ao banco.
 *
 * Cada alias mapeia para o e-mail técnico da conta Supabase Auth. O usuário
 * nunca vê esse e-mail — só digita o alias amigável.
 *
 * O mesmo raciocínio de `lib/storeLogin.ts`: E-MAIL NÃO É CREDENCIAL. Quem
 * protege a conta é a senha, que nunca aparece no código.
 *
 * O mapa é CENTRALIZADO aqui. Outros módulos importam `resolveUserAlias`.
 */

interface AliasEntry {
  /** Nome amigável que o usuário digita (case-insensitive). */
  alias: string;
  /** E-mail técnico da conta Supabase Auth. */
  email: string;
}

/**
 * Mapa de aliases → e-mails.
 *
 * Os e-mails seguem o padrão da organização. As contas devem existir no
 * Supabase Auth com as senhas correspondentes configuradas no painel.
 */
const ALIASES: AliasEntry[] = [
  { alias: 'jackson', email: 'jackson.costa@hiperideal.com.br' },
  { alias: 'paulo', email: 'paulo.sergio@hiperideal.com.br' },
  { alias: 'ericson', email: 'ericson.silva@hiperideal.com.br' },
  { alias: 'anias', email: 'roberval.anias@hiperideal.com.br' },
];

/**
 * Resolve um alias de usuário para o e-mail técnico.
 *
 * - Case-insensitive: "Jackson", "JACKSON", "jackson" resolvem para o mesmo.
 * - Trim: " jackson " também funciona.
 * - Retorna `null` quando o alias não é reconhecido (não revela se existe).
 *
 * @example
 * resolveUserAlias('jackson')  // 'jackson@hiperideal.com.br'
 * resolveUserAlias(' JACKSON ') // 'jackson@hiperideal.com.br'
 * resolveUserAlias('desconhecido') // null
 */
export function resolveUserAlias(username: string): string | null {
  const normalized = username.trim().toLowerCase();
  const entry = ALIASES.find((candidate) => candidate.alias === normalized);
  return entry?.email ?? null;
}

/**
 * Verifica se um alias é reconhecido.
 *Útil para testes e validação sem expor o e-mail.
 */
export function isKnownAlias(username: string): boolean {
  return resolveUserAlias(username) !== null;
}
