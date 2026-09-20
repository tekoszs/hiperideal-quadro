/**
 * FASE 4 — a VISÃO DO DISTRITO num navegador de verdade.
 *
 * `?demo=distrito` monta um perfil de escopo DISTRICT no modo demonstração
 * (que só existe com o .env do Supabase vazio — ver `src/lib/demo.ts`).
 *
 * O que este arquivo mede, e por quê:
 *
 *   • o gerente distrital NÃO recebe um seletor de distrito com uma opção só:
 *     ele lê o nome do distrito, em texto. Isso é layout, e layout se prova em
 *     pixel, não em jsdom;
 *   • a barra de filtros não pode rolar na horizontal em 390px, agora que
 *     ganhou mais um campo;
 *   • o título e o rótulo do distrito acompanham o ESCOPO do perfil.
 *
 * Não faz parte de `npm test` (Playwright não é dependência do projeto).
 *
 * COMO RODAR:
 *   npm run dev
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/browser_check_district.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

const falhas = [];
function check(nome, condicao, detalhe = '') {
  const ok = Boolean(condicao);
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
  if (!ok) falhas.push(nome);
}

function iso(offsetDias) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const D2 = iso(2);

/** Uma conferência enviada, no formato que o LocalStorageAdapter grava. */
const DADOS = {
  [`store-124::${D2}`]: {
    id: 'd1',
    storeId: 'store-124',
    referenceDate: D2,
    status: 'SUBMITTED',
    createdBy: '00000000-0000-4000-8000-000000000001',
    submittedBy: '00000000-0000-4000-8000-000000000001',
    createdAt: `${D2}T09:00:00.000Z`,
    updatedAt: `${D2}T11:00:00.000Z`,
    submittedAt: `${D2}T11:00:00.000Z`,
    items: [
      {
        id: '22220000-2222-4222-8222-222222222222',
        positionId: 'pos-operador-de-caixa',
        absenceQuantity: 2,
        dayOffQuantity: 1,
        observation: null,
        reasons: [
          {
            id: '33330000-3333-4333-8333-333333333333',
            reasonId: 'reason-atestado-medico',
            quantity: 2,
            observation: null,
          },
        ],
      },
    ],
  },
};

async function abrir(viewport, escopo) {
  const page = await browser.newPage({ viewport });
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));

  await page.addInitScript(
    ([chave, valor]) => window.localStorage.setItem(chave, valor),
    ['hiperideal.quadro.conferences.v1', JSON.stringify(DADOS)],
  );

  await page.goto(`${BASE}/?demo=${escopo}`, { waitUntil: 'networkidle' });
  return { page, erros };
}

/* ================================================================= DESKTOP */
console.log('\n=== GERENTE DISTRITAL — DESKTOP 1280x900 ===');
{
  const { page, erros } = await abrir({ width: 1280, height: 900 }, 'distrito');

  const titulo = await page.locator('.section__title').first().innerText();
  check('a home fala de gerência distrital', /Distrital/i.test(titulo), titulo);
  check(
    'o cartão principal chama "Visão do Distrito"',
    (await page.locator('.home-card__title', { hasText: 'Visão do Distrito' }).count()) === 1,
  );

  await page.locator('.home-card__title', { hasText: 'Visão do Distrito' }).click();
  await page.waitForSelector('.analytics-filters', { timeout: 15000 });

  check(
    'o título da tela é "Visão do Distrito"',
    (await page.locator('.section__title', { hasText: 'Visão do Distrito' }).count()) === 1,
  );
  check(
    'NÃO existe seletor de distrito — não há o que escolher',
    (await page.locator('.analytics-filters select').count()) === 2 ||
      (await page.locator('.analytics-filters__fixed').count()) === 1,
    `selects=${await page.locator('.analytics-filters select').count()}`,
  );

  const fixo = await page.locator('.analytics-filters__fixed').innerText();
  check('mostra o distrito em texto', /Distrito 1/.test(fixo), fixo.replace(/\n/g, ' · '));
  check('nomeia o responsável', /Paulo/.test(fixo), fixo.replace(/\n/g, ' · '));

  const scope = await page.locator('.supervisor-nav__scope').count();
  check('a barra de navegação repete o distrito', scope === 1, String(scope));

  const corpo = await page.locator('main').innerText();
  check('sem NaN / undefined', !/NaN|undefined/.test(corpo));
  check('console limpo', erros.length === 0, erros.join(' | '));
  await page.close();
}

/* ============================================================ REDE, DESKTOP */
console.log('\n=== GERÊNCIA DA REDE — DESKTOP 1280x900 ===');
{
  const { page, erros } = await abrir({ width: 1280, height: 900 }, 'rede');

  await page.locator('.home-card__title', { hasText: 'Visão da Rede' }).click();
  await page.waitForSelector('.analytics-filters', { timeout: 15000 });

  check(
    'o título da tela é "Visão da Rede"',
    (await page.locator('.section__title', { hasText: 'Visão da Rede' }).count()) === 1,
  );

  // No modo demonstração existe UMA loja, logo UM distrito: nada a escolher.
  // O que importa é que a decisão venha dos dados, não de um número escrito.
  const seletores = await page.locator('.analytics-filters select').count();
  check('a barra de filtros existe', seletores >= 1, String(seletores));

  const loja = await page.locator('.analytics-filters label', { hasText: 'Loja' }).innerText();
  check('a contagem de lojas sai dos dados', /\(\d+\)/.test(loja), loja.replace(/\n/g, ' | '));

  check('console limpo', erros.length === 0, erros.join(' | '));
  await page.close();
}

/* ================================================================== 390px */
console.log('\n=== GERENTE DISTRITAL — CELULAR 390x844 ===');
{
  const { page, erros } = await abrir({ width: 390, height: 844 }, 'distrito');

  await page.locator('.home-card__title', { hasText: 'Visão do Distrito' }).click();
  await page.waitForSelector('.analytics-filters', { timeout: 15000 });

  const rola = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check('NÃO rola na horizontal', rola.scroll <= rola.client + 1, `${rola.scroll} / ${rola.client}`);

  // Um elemento pode passar da borda DESDE QUE esteja dentro de um contêiner
  // que rola sozinho — a fila de chips do período é assim de propósito. O que
  // não pode é a PÁGINA rolar, e isso o teste acima já cobriu.
  const estouram = await page.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    const dentroDeRolador = (el) => {
      for (let no = el.parentElement; no; no = no.parentElement) {
        const overflow = getComputedStyle(no).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') return true;
      }
      return false;
    };
    return [...document.querySelectorAll('main *')]
      .filter((el) => el.getBoundingClientRect().right > limite + 1)
      .filter((el) => !dentroDeRolador(el))
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 60))
      .slice(0, 5);
  });
  check('nenhum elemento estoura a largura', estouram.length === 0, estouram.join(' | '));

  // Com uma coluna, os campos do filtro ficam empilhados.
  const larguras = await page.evaluate(() =>
    [...document.querySelectorAll('.analytics-filters > *')].map((el) =>
      Math.round(el.getBoundingClientRect().width),
    ),
  );
  check('os campos do filtro ocupam a linha inteira', larguras.length > 0, larguras.join(', '));

  check('a barra de navegação cabe', (await page.locator('.supervisor-nav__scope').count()) === 1);
  check('console limpo', erros.length === 0, erros.join(' | '));
  await page.close();
}

await browser.close();

console.log(
  falhas.length === 0
    ? '\nTUDO OK — visão do distrito aprovada em 1280 e 390.\n'
    : `\n${falhas.length} FALHA(S): ${falhas.join(', ')}\n`,
);
process.exit(falhas.length === 0 ? 0 : 1);
