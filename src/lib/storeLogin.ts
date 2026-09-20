import { NETWORK_STORES, type NetworkStore } from '@/data/network';
import { matchesSearch } from '@/utils/text';

/**
 * LOGIN TÉCNICO DAS LOJAS — como `store_id` vira uma conta do Supabase Auth.
 *
 * DECISÃO: convenção determinística, calculada no navegador.
 *
 *     store-307  ->  loja307@hiperideal.com.br
 *
 * As alternativas e por que foram descartadas:
 *
 *   TABELA DE MAPEAMENTO (quadro_store_logins, legível por anon)
 *     Publicaria um diretório de contas para qualquer visitante — exatamente o
 *     que o pedido manda evitar. E ainda exigiria uma consulta antes do login.
 *
 *   LISTAR quadro_profiles NO LOGIN
 *     Pior: expõe os usuários reais da rede, e a RLS de `quadro_profiles` teria
 *     que ser afrouxada para anônimo. Fora de questão.
 *
 *   RPC ANÔNIMA QUE DEVOLVE O E-MAIL
 *     Vira o mesmo diretório, só que com mais peças móveis.
 *
 * A convenção não precisa de banco, não precisa de rede e não expõe lista
 * nenhuma: o e-mail é derivado do código que o gerente acabou de escolher.
 *
 * E-MAIL NÃO É CREDENCIAL. Quem protege a conta é a senha, que nunca aparece
 * no código. Saber que `loja307@hiperideal.com.br` existe não dá acesso a
 * nada — é o mesmo nível de segredo do nome da loja na fachada.
 *
 * E, principalmente: ESCOLHER A LOJA NÃO AUTORIZA NADA. A seleção só localiza
 * a conta. Depois do login, quem manda é `quadro_profiles.store_id`, lido do
 * banco a partir de `auth.uid()` — ver `assertProfileMatchesSelection`.
 */

/** Domínio das contas técnicas das lojas. */
export const STORE_LOGIN_DOMAIN = 'hiperideal.com.br';

/**
 * `307` -> `loja307@hiperideal.com.br`
 *
 * Determinístico e sem acento: o código da loja é sempre numérico.
 */
export function storeLoginEmail(storeCode: string): string {
  return `loja${storeCode.trim().toLowerCase()}@${STORE_LOGIN_DOMAIN}`;
}

/** Todas as lojas ativas, na ordem em que o seletor deve mostrar. */
export function selectableStores(): NetworkStore[] {
  return NETWORK_STORES.filter((store) => store.active).sort((a, b) =>
    a.code.localeCompare(b.code, 'pt-BR', { numeric: true }),
  );
}

/**
 * Busca do seletor: por código ou por nome, ignorando maiúscula, acento,
 * hífen e espaço.
 *
 * "307", "LEPARC", "Le Parc" e "le parc" encontram a mesma loja — o gerente
 * digita do jeito que lembra.
 */
export function searchStores(query: string, stores = selectableStores()): NetworkStore[] {
  const termo = query.trim();
  if (termo === '') return stores;

  // O hífen é separador no rótulo ("307 - LEPARC") e também aparece em nomes
  // digitados ("le-parc"): vira espaço nos dois lados da comparação.
  const normalizado = termo.replace(/-/g, ' ');

  return stores.filter((store) => {
    const alvo = [store.code, store.name, store.fullName ?? '', `${store.code} ${store.name}`]
      .join(' ')
      .replace(/-/g, ' ');
    return matchesSearch(alvo, normalizado);
  });
}

/** `307 - LEPARC` */
export function storeOptionLabel(store: NetworkStore): string {
  return `${store.code} - ${store.name}`;
}

/**
 * A loja que o gerente escolheu NÃO define a loja da sessão.
 *
 * Se alguém selecionar LEPARC e autenticar com a conta da PQSHOP, o sistema
 * abre PQSHOP — porque é o que o perfil diz. Esta função existe só para a tela
 * poder AVISAR que houve divergência, nunca para decidir acesso.
 */
export function selectionMatchesProfile(
  selectedStoreId: string | null,
  profileStoreId: string | null,
): boolean {
  if (!selectedStoreId || !profileStoreId) return true;
  return selectedStoreId === profileStoreId;
}
