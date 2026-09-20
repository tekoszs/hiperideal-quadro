import { STORES } from '@/data/catalog';
import type { SessionProfile } from '@/types/auth';

/**
 * MODO DEMONSTRAÇÃO
 *
 * Existe só quando o .env do Supabase está VAZIO. Serve para testar a tela
 * do gerente sem banco. Regras:
 *
 *  - com Supabase configurado, este perfil NUNCA é usado: exige login real;
 *  - os dados ficam no LocalStorage e não se misturam com o Supabase;
 *  - a loja é a primeira do catálogo importado da planilha — nenhuma loja
 *    fictícia é inventada aqui.
 */
const demoStore = STORES[0];

export const DEMO_PROFILE: SessionProfile = {
  // UUID fixo: mantém o rascunho do demo estável entre recarregamentos.
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Gerente Demo',
  role: 'MANAGER',
  storeId: demoStore?.id ?? null,
  active: true,
  email: null,
  accessScope: 'STORE',
  districtId: null,
  jobTitle: 'Gerente de Loja',
};

export const DEMO_NOTICE =
  'Modo demonstração: os dados ficam apenas neste navegador e não vão para o Supabase.';

/**
 * Perfis alternativos do MODO DEMONSTRAÇÃO, escolhidos por `?demo=`.
 *
 *   ?demo=rede       gerente da rede    (escopo ALL)
 *   ?demo=distrito   gerente distrital  (escopo DISTRICT, distrito 1)
 *   (sem parâmetro)  gerente de loja    — o padrão de sempre
 *
 * PARA QUE ISTO EXISTE: as telas do supervisor precisam ser abertas num
 * navegador de verdade para valerem alguma coisa — largura, rolagem, altura de
 * lista. Sem uma forma de escolher o perfil, o modo demonstração só abre a tela
 * do gerente e as telas de supervisão nunca são medidas em pixel nenhum.
 *
 * POR QUE ISTO NÃO É UM BURACO DE SEGURANÇA
 * -----------------------------------------
 * `getDemoProfile` só é chamado quando `getAuthMode()` devolve DEMO, e DEMO só
 * existe quando o .env do Supabase está VAZIO — sem URL e sem chave não há
 * banco, não há sessão e não há dado de ninguém: tudo vive no LocalStorage
 * daquele navegador. Com o Supabase configurado, este código inteiro é
 * inalcançável, e ainda assim `getDemoProfile` confere de novo antes de olhar
 * a URL (ver `authService.ts`). Há teste garantindo as duas coisas.
 *
 * Em outras palavras: `?demo=rede` não dá acesso a nada, porque no modo
 * demonstração não existe nada a que dar acesso.
 */
export type DemoScope = 'loja' | 'rede' | 'distrito';

export function demoProfileFor(scope: DemoScope): SessionProfile {
  if (scope === 'rede') {
    return {
      ...DEMO_PROFILE,
      name: 'Gerência Demo',
      role: 'SUPERVISOR',
      storeId: null,
      accessScope: 'ALL',
      districtId: null,
      jobTitle: 'Gerente Geral',
    };
  }

  if (scope === 'distrito') {
    return {
      ...DEMO_PROFILE,
      name: 'Gerência Distrital Demo',
      role: 'SUPERVISOR',
      storeId: null,
      accessScope: 'DISTRICT',
      districtId: 'district-1',
      jobTitle: 'Gerente Distrital',
    };
  }

  return { ...DEMO_PROFILE };
}

/** Lê `?demo=` da URL. Qualquer valor desconhecido cai no padrão. */
export function demoScopeFromLocation(search: string): DemoScope {
  const valor = new URLSearchParams(search).get('demo');
  return valor === 'rede' || valor === 'distrito' ? valor : 'loja';
}
