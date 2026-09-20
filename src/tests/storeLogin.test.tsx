// @vitest-environment jsdom
/**
 * FASE 4 — ENTRADA POR FILIAL.
 *
 * O gerente escolhe a loja numa lista e digita a senha. Não digita e-mail.
 *
 * O QUE ESTES TESTES PROTEGEM, e a razão de cada um:
 *
 *   • a escolha da loja NÃO autoriza nada — ela só monta o endereço da conta
 *     técnica. É a confusão mais perigosa possível nesta tela, então está
 *     testada de duas maneiras (a função e a tela);
 *   • NENHUMA SENHA no bundle, no código ou nos testes. Há um teste que varre
 *     o próprio código-fonte procurando senha escrita;
 *   • a busca precisa achar a loja do jeito que o gerente lembra: "307",
 *     "leparc", "Le Parc", "le-parc".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NETWORK_STORES } from '@/data/network';
import { LoginPage } from '@/pages/LoginPage';
import { StorePicker } from '@/components/StorePicker';
import {
  STORE_LOGIN_DOMAIN,
  searchStores,
  selectableStores,
  selectionMatchesProfile,
  storeLoginEmail,
  storeOptionLabel,
} from '@/lib/storeLogin';

const RAIZ = resolve(__dirname, '../..');

afterEach(cleanup);

/** Tela de login pronta, com espiões nos dois caminhos de entrada. */
function renderLogin() {
  const porLoja = vi.fn();
  const porEmail = vi.fn();
  render(
    <LoginPage
      onSignIn={porEmail}
      onSignInWithStore={porLoja}
      loading={false}
      error={null}
    />,
  );
  return { porLoja, porEmail, user: userEvent.setup() };
}

describe('Login por filial', () => {
  // TESTE 1
  it('1. o e-mail técnico é derivado do código da loja', () => {
    expect(storeLoginEmail('307')).toBe(`loja307@${STORE_LOGIN_DOMAIN}`);
    expect(storeLoginEmail('124')).toBe(`loja124@${STORE_LOGIN_DOMAIN}`);
    // Espaço à toa não muda o endereço.
    expect(storeLoginEmail('  311 ')).toBe(`loja311@${STORE_LOGIN_DOMAIN}`);
  });

  // TESTE 2
  it('2. cada loja da rede gera um e-mail diferente', () => {
    const emails = selectableStores().map((store) => storeLoginEmail(store.code));
    expect(new Set(emails).size).toBe(emails.length);
  });

  // TESTE 3
  it('3. o seletor lista todas as lojas ativas, ordenadas por código', () => {
    const lista = selectableStores();
    expect(lista).toHaveLength(NETWORK_STORES.filter((store) => store.active).length);

    const codigos = lista.map((store) => Number(store.code));
    expect(codigos).toEqual([...codigos].sort((a, b) => a - b));
  });

  // TESTE 4
  it('4. a busca acha por código', () => {
    const achadas = searchStores('307');
    expect(achadas).toHaveLength(1);
    expect(achadas[0].name).toBe('LEPARC');
  });

  // TESTE 5
  it('5. a busca ignora maiúscula, acento, hífen e espaço', () => {
    for (const termo of ['LEPARC', 'leparc', 'Le Parc', 'le-parc', 'LE PARC']) {
      const achadas = searchStores(termo);
      expect(
        achadas.some((store) => store.code === '307'),
        `"${termo}" deveria encontrar a 307`,
      ).toBe(true);
    }
  });

  // TESTE 6 — o nome por extenso também entra na busca.
  it('6. a busca acha pelo nome por extenso', () => {
    expect(searchStores('PARQUE SHOPPING').some((store) => store.code === '124')).toBe(true);
    expect(searchStores('costa espanha').some((store) => store.code === '306')).toBe(true);
  });

  // TESTE 7
  it('7. busca sem resultado devolve lista vazia, não a rede inteira', () => {
    expect(searchStores('loja que nao existe')).toEqual([]);
    // Busca vazia devolve tudo — é o estado inicial do seletor.
    expect(searchStores('   ')).toHaveLength(selectableStores().length);
  });

  // TESTE 8 — A REGRA CENTRAL DA TELA.
  it('8. escolher a filial NÃO autoriza: quem manda é o perfil', () => {
    // Escolheu LEPARC mas o perfil diz PQSHOP: divergência.
    expect(selectionMatchesProfile('store-307', 'store-124')).toBe(false);
    // Bate: sem divergência.
    expect(selectionMatchesProfile('store-124', 'store-124')).toBe(true);
    // Sem perfil de loja (gerência) não há o que divergir.
    expect(selectionMatchesProfile('store-307', null)).toBe(true);
  });

  // TESTE 9
  it('9. a tela de login abre no acesso da loja, sem campo de e-mail', () => {
    renderLogin();

    expect(screen.getByRole('button', { name: 'Acesso loja' })).toHaveProperty(
      'ariaPressed',
      'true',
    );
    expect(screen.queryByLabelText('Usuário')).toBeNull();
    expect(screen.getByLabelText('Selecione sua filial')).toBeTruthy();
  });

  // TESTE 10
  it('10. escolher a loja e enviar a senha chama o login por filial', async () => {
    const { porLoja, porEmail, user } = renderLogin();

    await user.type(screen.getByLabelText('Selecione sua filial'), '307');
    await user.click(screen.getByRole('option', { name: /LEPARC/ }));
    await user.type(screen.getByLabelText('Senha'), 'senha-de-teste');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(porLoja).toHaveBeenCalledWith('store-307', 'senha-de-teste');
    expect(porEmail).not.toHaveBeenCalled();
  });

  // TESTE 11
  it('11. sem escolher a filial, a tela explica e não tenta entrar', async () => {
    const { porLoja, user } = renderLogin();

    await user.type(screen.getByLabelText('Senha'), 'qualquer');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(porLoja).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Selecione sua filial');
  });

  // TESTE 12
  it('12. o acesso gerencial resolve o alias para e-mail antes de autenticar', async () => {
    const { porLoja, porEmail, user } = renderLogin();

    await user.click(screen.getByRole('button', { name: 'Acesso gerencial' }));

    expect(screen.queryByLabelText('Selecione sua filial')).toBeNull();
    await user.type(screen.getByLabelText('Usuário'), 'paulo');
    await user.type(screen.getByLabelText('Senha'), 'senha-de-teste');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(porEmail).toHaveBeenCalledWith('paulo.sergio@hiperideal.com.br', 'senha-de-teste');
    expect(porLoja).not.toHaveBeenCalled();
  });

  // TESTE 13 — a regra que o proprietário escreveu, virada em teste.
  //
  // Varre o código-fonte procurando senha escrita. Não é uma prova absoluta
  // (nada substitui revisar), mas pega o descuido comum: alguém "só para
  // testar" deixa uma senha padrão no código e ela vai para o bundle.
  it('13. não existe senha escrita no código do login', () => {
    const arquivos = [
      'src/pages/LoginPage.tsx',
      'src/components/StorePicker.tsx',
      'src/lib/storeLogin.ts',
      'src/services/authService.ts',
      'src/hooks/useAuth.ts',
      'src/data/network.ts',
      'supabase/migrations/0016_seed_network.sql',
      'supabase/seed_managers.example.sql',
    ];

    // Atribuição de senha a um literal: password = "...", senha: '...', etc.
    const senhaEscrita =
      /\b(password|senha|passwd|pwd)\b\s*[:=]\s*['"`][^'"`\n]{3,}['"`]/i;

    for (const caminho of arquivos) {
      const conteudo = readFileSync(resolve(RAIZ, caminho), 'utf8');
      expect(senhaEscrita.test(conteudo), `${caminho} parece conter uma senha escrita`).toBe(
        false,
      );
    }
  });
});

describe('Seletor de filial', () => {
  // TESTE 14 (extra) — 34 opções não podem virar 34 botões na tela.
  it('mostra a lista filtrada e o quanto sobrou da rede', async () => {
    const user = userEvent.setup();
    render(<StorePicker value={null} onChange={() => undefined} />);

    const total = selectableStores().length;
    expect(screen.getByText(`${total} de ${total} lojas`)).toBeTruthy();

    await user.type(screen.getByLabelText('Selecione sua filial'), '307');
    expect(screen.getByText(`1 de ${total} lojas`)).toBeTruthy();

    const lista = screen.getByRole('listbox');
    expect(within(lista).getAllByRole('option')).toHaveLength(1);
  });

  // TESTE 15 (extra)
  it('depois de escolher, mostra a loja e deixa trocar', async () => {
    const user = userEvent.setup();
    const trocas: Array<string | null> = [];

    const leparc = selectableStores().find((store) => store.code === '307')!;
    render(<StorePicker value={leparc.id} onChange={(next) => trocas.push(next)} />);

    expect(screen.getByText(storeOptionLabel(leparc))).toBeTruthy();
    // Com a loja escolhida, a busca sai da tela — não há o que procurar.
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Trocar' }));
    expect(trocas).toEqual([null]);
  });
});
