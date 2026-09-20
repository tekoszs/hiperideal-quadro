/**
 * FASE 4.3 — A DATA DE REFERÊNCIA num navegador de verdade.
 *
 * A tela do gerente é a que roda no celular do gerente, encostado no balcão,
 * numa segunda-feira. O que só o navegador prova:
 *
 *   • os chips de pendência são alvos de toque de verdade (>= 44px de altura),
 *     e não um link fino que erra o dedo;
 *   • a fila de chips rola sozinha em 390px — a PÁGINA nunca rola na
 *     horizontal;
 *   • o `<input type="date">` recusa hoje e o futuro pelos próprios `min`/`max`;
 *   • trocar de data troca a conferência de verdade, sem recarregar a página.
 *
 * O cenário é montado no localStorage antes de a página carregar, no formato
 * real do LocalStorageAdapter: os dias antigos enviados, os dois últimos em
 * aberto — a segunda-feira com o fim de semana pendente.
 *
 * Não faz parte de `npm test` (Playwright não é dependência do projeto).
 *
 * COMO RODAR:
 *   npm run dev
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/browser_check_reference_date.mjs
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

function iso(offsetDias) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const HOJE = iso(0);
/** A pendência mais recente — o "domingo" da história. */
const RECENTE = iso(1);
/** A pendência mais antiga — o "sábado", que a tela deve abrir. */
const ANTIGA = iso(2);

/** Uma conferência ENVIADA, no formato que o LocalStorageAdapter grava. */
function enviada(date) {
  return {
    id: `conf-${date}`,
    storeId: 'store-124',
    referenceDate: date,
    status: 'SUBMITTED',
    createdBy: '00000000-0000-4000-8000-000000000001',
    submittedBy: '00000000-0000-4000-8000-000000000001',
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T11:00:00.000Z`,
    submittedAt: `${date}T11:00:00.000Z`,
    items: [
      {
        id: `item-${date}`,
        positionId: 'pos-operador-de-caixa',
        absenceQuantity: 0,
        dayOffQuantity: 0,
        observation: null,
        reasons: [],
      },
    ],
  };
}

// D-3 .. D-7 enviadas; D-1 e D-2 em aberto.
const DADOS = {};
for (let i = 3; i <= 7; i += 1) {
  const d = iso(i);
  DADOS[`store-124::${d}`] = enviada(d);
}

async function abrir(viewport) {
  const page = await browser.newPage({ viewport });
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));

  await page.addInitScript(
    ([chave, valor]) => window.localStorage.setItem(chave, valor),
    ['hiperideal.quadro.conferences.v1', JSON.stringify(DADOS)],
  );

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#reference-date', { timeout: 15000 });
  return { page, erros };
}

for (const [nome, viewport] of [
  ['DESKTOP 1280x900', { width: 1280, height: 900 }],
  ['CELULAR 390x844', { width: 390, height: 844 }],
]) {
  console.log(`\n=== ${nome} ===`);
  const { page, erros } = await abrir(viewport);

  /* ------------------------------------------------------ as pendências */
  const chips = page.locator('.chip--pending');
  check('mostra as 2 pendências', (await chips.count()) === 2, String(await chips.count()));

  const textos = await chips.allInnerTexts();
  check(
    'a mais ANTIGA vem primeiro',
    textos[0].includes(ANTIGA.slice(8) + '/' + ANTIGA.slice(5, 7)),
    textos.map((t) => t.replace(/\n/g, ' ')).join(' | '),
  );

  const seletor = page.locator('#reference-date');
  check('abre na pendência mais antiga', (await seletor.inputValue()) === ANTIGA, ANTIGA);

  /* --------------------------------------------------- limites da data */
  check('não permite hoje nem depois', (await seletor.getAttribute('max')) === RECENTE, RECENTE);
  check(
    'o máximo é anterior a hoje',
    (await seletor.getAttribute('max')) < HOJE,
    `max=${await seletor.getAttribute('max')} hoje=${HOJE}`,
  );
  check(
    'a janela começa em D-7',
    (await seletor.getAttribute('min')) === iso(7),
    String(await seletor.getAttribute('min')),
  );

  /* ------------------------------------------------- alvo de toque real */
  const altura = await chips.first().evaluate((el) => el.getBoundingClientRect().height);
  check('o chip é um alvo de toque (>= 44px)', altura >= 44, `${Math.round(altura)}px`);

  /* --------------------------------------------------- trocar de data */
  await chips.nth(1).click();
  await page.waitForTimeout(400);
  check('clicar no chip troca a data', (await seletor.inputValue()) === RECENTE, RECENTE);
  check(
    'o chip clicado fica marcado',
    (await chips.nth(1).getAttribute('aria-pressed')) === 'true',
  );

  await chips.nth(0).click();
  await page.waitForTimeout(400);
  check('e volta para a outra', (await seletor.inputValue()) === ANTIGA, ANTIGA);

  /* ------------------------------------------------------ higiene da tela */
  const rolagem = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
  }));
  check('a PÁGINA não rola na horizontal', rolagem.s <= rolagem.c + 1, `${rolagem.s} / ${rolagem.c}`);

  const estouram = await page.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    const dentroDeRolador = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    return [...document.querySelectorAll('.refdate *')]
      .filter((el) => el.getBoundingClientRect().right > limite + 1)
      .filter((el) => !dentroDeRolador(el))
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 50))
      .slice(0, 4);
  });
  check('nada da barra de datas estoura a largura', estouram.length === 0, estouram.join(' | '));

  const corpo = await page.locator('.refdate').innerText();
  check('sem NaN / undefined / Invalid Date', !/NaN|undefined|Invalid/.test(corpo));
  check('console limpo', erros.length === 0, erros.join(' | '));

  await page.close();
}

await browser.close();

console.log(
  falhas.length === 0
    ? '\nTUDO OK — data de referência aprovada em 1280 e 390.\n'
    : `\n${falhas.length} FALHA(S): ${falhas.join(', ')}\n`,
);
process.exit(falhas.length === 0 ? 0 : 1);
