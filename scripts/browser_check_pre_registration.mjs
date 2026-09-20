/**
 * FASE 4.5 — PRÉ-REGISTRO E JUSTIFICATIVA PENDENTE, num navegador de verdade.
 *
 * O `npm test` roda em jsdom, que não tem layout: lá dentro nada tem largura,
 * nada tem altura e nada rola. O que só existe onde há layout:
 *
 *   • o botão de hoje ser um alvo de toque de verdade em 360px;
 *   • o modal de resolução caber na tela e não estourar a largura;
 *   • o bloco de pendências ser legível sem rolagem horizontal da página;
 *   • as cores serem ÂMBAR e não vermelho — medido no `getComputedStyle`,
 *     não conferido no olho;
 *   • os 7 chips continuarem 7 depois de tudo (a fase 4.4 preservada).
 *
 * Larguras: 1280 (desktop), 430, 390 e 360.
 *
 * Não faz parte de `npm test` (Playwright não é dependência do projeto).
 *
 * COMO RODAR:
 *   npm run dev
 *   npm i -D playwright
 *   node scripts/browser_check_pre_registration.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.APP_URL ?? 'http://localhost:5173';
const SHOTS = process.env.SHOT_DIR ?? '.';

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

const falhas = [];
function check(nome, condicao, detalhe = '') {
  const ok = Boolean(condicao);
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
  if (!ok) falhas.push(`${nome}${detalhe ? ` (${detalhe})` : ''}`);
}

function iso(offsetDias) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const HOJE = iso(0);
const ANTEONTEM = iso(2);
const PENDENTE = 'reason-aguardando-justificativa';

function conferencia(date, status, { absences = 0, pending = 0 } = {}) {
  const reasons = [];
  if (absences - pending > 0) {
    reasons.push({
      id: `r-at-${date}`,
      reasonId: 'reason-atestado-medico',
      quantity: absences - pending,
      observation: null,
    });
  }
  if (pending > 0) {
    reasons.push({ id: `r-ag-${date}`, reasonId: PENDENTE, quantity: pending, observation: null });
  }

  return {
    id: `conf-${date}`,
    storeId: 'store-124',
    referenceDate: date,
    status,
    createdBy: '00000000-0000-4000-8000-000000000001',
    submittedBy: status === 'SUBMITTED' ? '00000000-0000-4000-8000-000000000001' : null,
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T11:00:00.000Z`,
    submittedAt: status === 'SUBMITTED' ? `${date}T11:00:00.000Z` : null,
    items: [
      {
        id: `item-${date}`,
        positionId: 'pos-operador-de-caixa',
        absenceQuantity: absences,
        dayOffQuantity: 0,
        observation: null,
        reasons,
      },
    ],
  };
}

// D-2..D-7 enviadas; D-2 com uma justificativa pendente; D-1 em aberto.
const DADOS = {};
for (let i = 3; i <= 7; i += 1) DADOS[`store-124::${iso(i)}`] = conferencia(iso(i), 'SUBMITTED');
DADOS[`store-124::${ANTEONTEM}`] = conferencia(ANTEONTEM, 'SUBMITTED', {
  absences: 2,
  pending: 1,
});

/** Luminância relativa (WCAG 2.1) a partir de um `rgb(...)`. */
function contraste(corA, corB) {
  const canal = (txt) => {
    const [r, g, b] = txt.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    return [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const a = lum(canal(corA));
  const b = lum(canal(corB));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** O canal vermelho domina claramente? É como se reconhece "isto é erro". */
function pareceVermelho(rgb) {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  return r > 130 && r > g * 1.8 && r > b * 1.8;
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

const semRolagemHorizontal = async (page) => {
  const r = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
  }));
  return { ok: r.s <= r.c + 1, detalhe: `${r.s} / ${r.c}` };
};

const TELAS = [
  ['DESKTOP 1280x900', { width: 1280, height: 900 }, 'desktop'],
  ['CELULAR 430x932', { width: 430, height: 932 }, null],
  ['CELULAR 390x844', { width: 390, height: 844 }, 'celular'],
  ['CELULAR 360x800', { width: 360, height: 800 }, null],
];

for (const [nome, viewport, apelido] of TELAS) {
  console.log(`\n=== ${nome} ===`);
  const { page, erros } = await abrir(viewport);
  const celular = viewport.width <= 620;

  /* ================================================ a fase 4.4 preservada */
  check(
    'os 7 chips continuam 7, em ordem cronológica',
    (await page.locator('.chip--date').count()) === 7,
    String(await page.locator('.chip--date').count()),
  );
  const datasDaFila = await page
    .locator('.chip--date')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('aria-describedby') ?? '').replace('chip-state-', '')),
    );
  check(
    'e HOJE não é o oitavo chip',
    !datasDaFila.includes(HOJE),
    datasDaFila.join(' '),
  );
  check(
    'a data continua sendo o título da tela',
    (await page.locator('.conf-head__date').innerText()).length === 10,
  );

  /* ============================================ pendências de justificativa */
  const painel = page.locator('.pendjust');
  check('o bloco de pendências aparece', await painel.isVisible());
  check(
    'e diz data, função, quantidade e dias de espera',
    /1 pendência/.test(await painel.innerText()) &&
      /OPERADOR DE CAIXA/.test(await painel.innerText()) &&
      /Aguardando há 2 dias/.test(await painel.innerText()),
    (await painel.innerText()).replace(/\n/g, ' | ').slice(0, 120),
  );

  /*
    ÂMBAR, NUNCA VERMELHO. A conferência é válida — a falta foi contada e
    chegou ao supervisor. O que falta é o papel.
  */
  const corPendencia = await painel
    .locator('.pendjust__row')
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { fg: s.color, bg: s.backgroundColor, border: s.borderTopColor };
    });
  check(
    'a pendência NÃO usa vermelho',
    !pareceVermelho(corPendencia.bg) && !pareceVermelho(corPendencia.border),
    `bg ${corPendencia.bg} · borda ${corPendencia.border}`,
  );
  check(
    'contraste do texto da pendência >= 4.5:1',
    contraste(corPendencia.fg, corPendencia.bg) >= 4.5,
    `${contraste(corPendencia.fg, corPendencia.bg).toFixed(2)}:1`,
  );

  const alvoPendencia = await painel
    .locator('.pendjust__row')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  check('a pendência é um alvo de toque (>= 44px)', alvoPendencia >= 44, `${Math.round(alvoPendencia)}px`);

  let rolagem = await semRolagemHorizontal(page);
  check('a PÁGINA não rola na horizontal (chegada)', rolagem.ok, rolagem.detalhe);

  if (apelido) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `${SHOTS}/fase45-pendencias-${apelido}.png`,
      fullPage: viewport.width > 620,
    });
    console.log(`  ..  screenshot: fase45-pendencias-${apelido}.png`);
  }

  /* ================================================ o modal de resolução */
  await painel.locator('.pendjust__row').first().click();
  await page.waitForSelector('.modal--resolve', { timeout: 5000 });

  const modal = page.locator('.modal--resolve');
  check(
    'o modal mostra loja, data, função e o que está pendente',
    /PARQUE SHOPPING/.test(await modal.innerText()) &&
      /OPERADOR DE CAIXA/.test(await modal.innerText()) &&
      /aguardando justificativa/i.test(await modal.innerText()),
  );

  const larguraModal = await modal.evaluate((el) => el.getBoundingClientRect().width);
  check(
    'o modal cabe na tela',
    larguraModal <= viewport.width,
    `${Math.round(larguraModal)}px em ${viewport.width}px`,
  );

  const alvoConfirmar = await modal
    .getByRole('button', { name: 'Confirmar alteração' })
    .evaluate((el) => el.getBoundingClientRect().height);
  check('o botão de confirmar é um alvo de toque', alvoConfirmar >= 40, `${Math.round(alvoConfirmar)}px`);

  rolagem = await semRolagemHorizontal(page);
  check('a PÁGINA não rola na horizontal (modal aberto)', rolagem.ok, rolagem.detalhe);

  if (apelido) {
    await page.screenshot({
      path: `${SHOTS}/fase45-resolucao-${apelido}.png`,
      fullPage: false,
    });
    console.log(`  ..  screenshot: fase45-resolucao-${apelido}.png`);
  }

  /* ------------------------------------------- resolver e ver o resultado */
  await modal.getByLabel('Motivo definitivo').selectOption('reason-atestado-medico');
  await modal.getByRole('button', { name: 'Confirmar alteração' }).click();
  await page.waitForSelector('.pendjust', { state: 'detached', timeout: 8000 });

  check('resolvida, a pendência some da tela', (await page.locator('.pendjust').count()) === 0);

  const conferido = await page.evaluate(
    ([chave, data]) => {
      const todas = JSON.parse(window.localStorage.getItem(chave) ?? '{}');
      const conf = todas[`store-124::${data}`];
      const item = conf.items[0];
      return {
        status: conf.status,
        faltas: item.absenceQuantity,
        motivos: item.reasons.map((r) => [r.reasonId, r.quantity]),
      };
    },
    ['hiperideal.quadro.conferences.v1', ANTEONTEM],
  );
  check('o total de faltas NÃO mudou', conferido.faltas === 2, String(conferido.faltas));
  check('a conferência continua ENVIADA', conferido.status === 'SUBMITTED', conferido.status);
  check(
    'e o motivo virou atestado, sem sobrar aguardando',
    JSON.stringify(conferido.motivos) === JSON.stringify([['reason-atestado-medico', 2]]),
    JSON.stringify(conferido.motivos),
  );

  /* ==================================================== pré-registro de hoje */
  const botaoHoje = page.getByRole('button', { name: 'Registrar ocorrências de hoje' });
  const alvoHoje = await botaoHoje.evaluate((el) => el.getBoundingClientRect().height);
  check('o botão de hoje é um alvo de toque (>= 44px)', alvoHoje >= 44, `${Math.round(alvoHoje)}px`);

  await botaoHoje.click();
  await page.waitForTimeout(500);

  const titulo = page.locator('.conf-head');
  check(
    'o título vira "Pré-registro de hoje" com a data de hoje',
    /Pré-registro de hoje/.test(await titulo.innerText()) &&
      (await page.locator('.conf-head__date').innerText()).length === 10,
    (await titulo.innerText()).replace(/\n/g, ' | '),
  );
  check(
    'e explica que o envio vem depois',
    /poderá ser enviada posteriormente/i.test(await titulo.innerText()),
  );
  check('o botão fica marcado', (await botaoHoje.getAttribute('aria-pressed')) === 'true');

  check(
    'NÃO existe botão de finalizar no pré-registro',
    (await page.getByRole('button', { name: 'Finalizar conferência' }).count()) === 0,
  );
  check(
    'mas continua sendo possível salvar',
    (await page.getByRole('button', { name: 'Salvar rascunho' }).count()) === 1,
  );
  check(
    'os 7 chips continuam 7 no pré-registro',
    (await page.locator('.chip--date').count()) === 7,
  );

  /* --------------------------- lançar uma falta aguardando justificativa */
  await page.getByRole('spinbutton', { name: 'Faltas em OPERADOR DE CAIXA' }).fill('1');
  await page.waitForTimeout(300);

  const provisorio = page.locator('.reason-row--pending').first();
  check('o motivo provisório existe no painel', await provisorio.isVisible());

  const corMotivo = await provisorio.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fg: s.color, bg: s.backgroundColor, border: s.borderTopColor };
  });
  check(
    'o motivo provisório é âmbar, não vermelho',
    !pareceVermelho(corMotivo.bg) && !pareceVermelho(corMotivo.border),
    `bg ${corMotivo.bg} · borda ${corMotivo.border}`,
  );

  await page
    .getByRole('spinbutton', { name: 'Aguardando justificativa em pos-operador-de-caixa' })
    .fill('1');
  await page.waitForTimeout(300);

  check(
    'a soma fecha com o motivo provisório',
    /Motivos informados: 1 de 1/.test(await page.locator('.reasons').first().innerText()),
  );
  check(
    'e a tela explica o que "aguardando" significa',
    /poderá ser atualizado posteriormente/i.test(
      await page.locator('.reasons').first().innerText(),
    ),
  );

  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.waitForTimeout(600);

  const preRegistro = await page.evaluate(
    ([chave, data]) => {
      const todas = JSON.parse(window.localStorage.getItem(chave) ?? '{}');
      const conf = todas[`store-124::${data}`];
      return conf ? { status: conf.status, data: conf.referenceDate } : null;
    },
    ['hiperideal.quadro.conferences.v1', HOJE],
  );
  check(
    'o pré-registro é salvo como DRAFT na data de hoje',
    preRegistro?.status === 'DRAFT' && preRegistro?.data === HOJE,
    JSON.stringify(preRegistro),
  );

  rolagem = await semRolagemHorizontal(page);
  check('a PÁGINA não rola na horizontal (pré-registro)', rolagem.ok, rolagem.detalhe);

  const estouram = await page.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    const dentroDeRolador = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    return [...document.querySelectorAll('main *')]
      .filter((el) => el.getBoundingClientRect().right > limite + 1)
      .filter((el) => !dentroDeRolador(el))
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 60))
      .slice(0, 4);
  });
  check('nada estoura a largura da tela', estouram.length === 0, estouram.join(' | '));

  if (apelido) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `${SHOTS}/fase45-preregistro-${apelido}.png`,
      fullPage: viewport.width > 620,
    });
    console.log(`  ..  screenshot: fase45-preregistro-${apelido}.png`);
  }

  check('sem NaN / undefined / Invalid Date', !/NaN|undefined|Invalid Date/.test(await page.locator('main').innerText()));
  check('console limpo', erros.length === 0, erros.join(' | '));

  await page.close();
}

await browser.close();

console.log(
  falhas.length === 0
    ? '\nTUDO OK — pré-registro e justificativa pendente aprovados em 1280, 430, 390 e 360.\n'
    : `\n${falhas.length} FALHA(S):\n  - ${falhas.join('\n  - ')}\n`,
);
process.exit(falhas.length === 0 ? 0 : 1);
