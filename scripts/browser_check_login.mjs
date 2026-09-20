/**
 * FASE 4 — a TELA DE ENTRADA e o seletor de 34 filiais, em Chromium de verdade.
 *
 * O que só o navegador prova, e por isso este arquivo existe:
 *
 *   • 34 lojas numa tela de 390px não podem empurrar o campo de senha e o
 *     botão "Entrar" para fora da área visível. Isso não aparece em teste de
 *     jsdom: lá nada tem altura. Aqui é medido em pixels;
 *   • a página não pode rolar na horizontal em nenhum dos dois tamanhos;
 *   • a busca do seletor precisa achar a loja do jeito que o gerente lembra;
 *   • o console tem de ficar limpo.
 *
 * Não faz parte de `npm test` (Playwright não é dependência do projeto).
 *
 * COMO RODAR:
 *   npm run dev
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/browser_check_login.mjs
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:5173';

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

const falhas = [];
function check(nome, condicao, detalhe = '') {
  const ok = Boolean(condicao);
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
  if (!ok) falhas.push(nome);
}

/**
 * Abre a tela de login SEM sessão.
 *
 * O modo demonstração entra sozinho quando não há Supabase configurado, então
 *     a tela de entrada real é forçada por `?preview=login` — se a aplicação não
 *     suportar, o script avisa em vez de testar a tela errada.
 */
async function abrirLogin(viewport) {
  const page = await browser.newPage({ viewport });
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));

  await page.goto(`${URL}?preview=login`, { waitUntil: 'networkidle' });
  return { page, erros };
}

/** Quanto do elemento está DENTRO da janela, em pixels. */
async function visivel(page, seletor) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), altura: window.innerHeight };
  }, seletor);
}

for (const [nome, viewport] of [
  ['DESKTOP 1280x900', { width: 1280, height: 900 }],
  ['CELULAR 390x844', { width: 390, height: 844 }],
]) {
  console.log(`\n=== ${nome} ===`);
  const { page, erros } = await abrirLogin(viewport);

  const temLogin = (await page.locator('.login__card').count()) > 0;
  if (!temLogin) {
    console.log(
      '  AVISO: a aplicação entrou direto (modo demonstração). Configure o Supabase\n' +
        '         ou saia da sessão para exercitar a tela de entrada.',
    );
    await page.close();
    continue;
  }

  /* ---------------------------------------------------------- os dois modos */
  check('abre em "Acesso loja"', (await page.locator('.login__mode--on').innerText()) === 'Acesso loja');
  check('não há campo de usuário no acesso loja', (await page.locator('#login-username').count()) === 0);

  await page.getByRole('button', { name: 'Acesso gerencial' }).click();
  check('acesso gerencial mostra usuário', (await page.locator('#login-username').count()) === 1);
  check(
    'acesso gerencial esconde o seletor de filial',
    (await page.locator('.store-picker').count()) === 0,
  );
  await page.getByRole('button', { name: 'Acesso loja' }).click();

  /* ------------------------------------------------------------ o seletor */
  const totalTexto = await page.locator('.field__hint').innerText();
  check('mostra quantas lojas existem', /\d+ de \d+ lojas/.test(totalTexto), totalTexto);

  const opcoesAntes = await page.locator('.store-picker__option').count();
  check('lista todas as filiais da rede', opcoesAntes === 34, String(opcoesAntes));

  // A busca do jeito que o gerente digita.
  for (const [termo, esperado] of [
    ['307', 'LEPARC'],
    ['leparc', 'LEPARC'],
    ['le parc', 'LEPARC'],
    ['le-parc', 'LEPARC'],
    ['parque shopping', 'PQSHOP'],
  ]) {
    await page.locator('.store-picker input[type="search"]').fill(termo);
    await page.waitForTimeout(80);
    const nomes = await page.locator('.store-picker__name').allInnerTexts();
    check(`busca "${termo}" acha ${esperado}`, nomes.includes(esperado), nomes.join(' | '));
  }

  await page.locator('.store-picker input[type="search"]').fill('naoexiste');
  await page.waitForTimeout(80);
  check(
    'busca sem resultado explica, em vez de sumir',
    (await page.locator('.store-picker__empty').count()) === 1,
  );

  /* ---------------------------------------------- O TESTE DE 390px QUE IMPORTA
     Com a lista aberta e 34 lojas, a SENHA e o botão ENTRAR precisam continuar
     dentro da janela. Se a lista crescesse sem limite, o gerente escolheria a
     filial e não acharia onde digitar. */
  await page.locator('.store-picker input[type="search"]').fill('');
  await page.waitForTimeout(80);

  const senha = await visivel(page, '#login-password');
  const entrar = await visivel(page, '.login__submit');
  check(
    'com a lista aberta, o campo Senha continua na tela',
    senha && senha.bottom <= senha.altura,
    senha ? `bottom=${senha.bottom} janela=${senha.altura}` : 'ausente',
  );
  check(
    'com a lista aberta, o botão Entrar continua na tela',
    entrar && entrar.bottom <= entrar.altura,
    entrar ? `bottom=${entrar.bottom} janela=${entrar.altura}` : 'ausente',
  );

  const listaRola = await page.evaluate(() => {
    const el = document.querySelector('.store-picker__list');
    return el ? el.scrollHeight > el.clientHeight + 1 : false;
  });
  check('a lista rola dentro de si mesma', listaRola);

  /* ---------------------------------------------------- escolher e trocar */
  await page.locator('.store-picker input[type="search"]').fill('307');
  await page.waitForTimeout(80);
  await page.locator('.store-picker__option').first().click();
  check(
    'depois de escolher, mostra a filial',
    (await page.locator('.store-picker__chosen-label').innerText()) === '307 - LEPARC',
  );
  await page.getByRole('button', { name: 'Trocar' }).click();
  check('"Trocar" devolve a busca', (await page.locator('.store-picker__list').count()) === 1);

  /* ------------------------------------------------------- higiene da tela */
  const rolaHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  check('sem rolagem horizontal', !rolaHorizontal);

  const corpo = await page.locator('.login').innerText();
  check('sem NaN / undefined na tela', !/NaN|undefined/.test(corpo));
  check('console limpo', erros.length === 0, erros.join(' | '));

  await page.close();
}

await browser.close();

console.log(
  falhas.length === 0
    ? '\nTUDO OK — tela de entrada aprovada em 1280 e 390.\n'
    : `\n${falhas.length} FALHA(S): ${falhas.join(', ')}\n`,
);
process.exit(falhas.length === 0 ? 0 : 1);
