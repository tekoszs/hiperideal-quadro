/**
 * Tipos das funções que `create_store_auth_users.mjs` exporta para teste.
 *
 * O script é `.mjs` de propósito: ele roda com `node` puro, sem passo de
 * build, na máquina do proprietário — um `.ts` exigiria compilar antes de
 * criar as contas, e é justamente aí que se erra a versão do arquivo.
 *
 * Este arquivo existe só para o TypeScript enxergar as duas funções que os
 * testes importam. Ele não muda nada em tempo de execução.
 */

/** Uma loja da rede oficial, como o script a lê de `src/data/network.ts`. */
export interface LojaDaRede {
  id: string;
  code: string;
  name: string;
}

/** Lê as lojas ativas da rede oficial. Lança se a lista não puder ser lida. */
export function lerRedeOficial(fonte?: string): LojaDaRede[];

/** `307` -> `loja307@hiperideal.com.br`. A mesma convenção de `storeLogin.ts`. */
export function emailDaLoja(codigo: string | number): string;
