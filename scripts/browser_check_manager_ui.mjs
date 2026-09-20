/**
 * FASE 4.4 — A TELA DO GERENTE NUM NAVEGADOR DE VERDADE.
 *
 * O `npm test` roda em jsdom, que não tem layout: lá dentro nada tem largura,
 * nada tem altura e nada rola. Tudo o que esta fase promete — não estourar a
 * largura em 360px, alvo de toque confortável, contraste, a data como o maior
 * texto da tela — só existe onde há layout de verdade.
 *
 * Larguras: 1280 (desktop), 430 (iPhone Pro Max), 390 (iPhone padrão) e 360
 * (o Android mais estreito ainda em uso nas lojas).
 *
 * O cenário é montado no localStorage antes de a página carregar, no formato
 * real do LocalStorageAdapter: os dias antigos enviados, os dois últimos em
 * aberto — a segunda-feira com o fim de semana pendente.
 *
 * Não faz parte de `npm test` (Playwright não é dependência do projeto).
 *
 * COMO RODAR:
 *   npm run dev
 *   npm i -D playwright
 *   node scripts/browser_check_manager_ui.mjs
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

const RECENTE = iso(1);
const ANTIGA = iso(2);

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
for (let i = 3; i <= 7; i += 1) DADOS[`store-124::${iso(i)}`] = enviada(iso(i));

/** Luminância relativa (WCAG 2.1) a partir de um `rgb(...)` do getComputedStyle. */
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

  /* ------------------------------------------- a data é o título da tela */
  const titulo = page.locator('.conf-head');
  const dataGrande = page.locator('.conf-head__date');
  check('o título traz a data escolhida', (await dataGrande.innerText()).length === 10,
    await dataGrande.innerText());

  const tamanhoData = await dataGrande.evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  );
  const tamanhoMarca = await page
    .locator('.app-header__brand')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(
    'a data é o maior texto da tela (maior que a marca)',
    tamanhoData > tamanhoMarca,
    `data ${tamanhoData}px vs marca ${tamanhoMarca}px`,
  );

  check(
    'o título diz o dia da semana e a situação',
    /segunda|terça|quarta|quinta|sexta|sábado|domingo/i.test(await titulo.innerText()) &&
      /pendente|rascunho|enviada|reaberta/i.test(await titulo.innerText()),
    (await titulo.innerText()).replace(/\n/g, ' | '),
  );

  check(
    'sai o texto técnico "ainda não conferida"',
    !/ainda não conferida/i.test(await page.locator('main').innerText()),
  );

  /* ------------------------------------ o cabeçalho não repete a data */
  const cabecalho = await page.locator('.app-header').innerText();
  check(
    'o cabeçalho NÃO repete a data (uma fonte só)',
    !cabecalho.includes(ANTIGA.slice(8)) && !/\d{2}\/\d{2}\/\d{4}/.test(cabecalho),
    cabecalho.replace(/\n/g, ' | '),
  );
  check('o cabeçalho mantém a loja', /PARQUE SHOPPING/i.test(cabecalho));

  const alturaCabecalho = await page
    .locator('.app-header')
    .evaluate((el) => el.getBoundingClientRect().height);
  check(
    celular ? 'cabeçalho compacto no celular (< 110px)' : 'cabeçalho enxuto (< 140px)',
    alturaCabecalho < (celular ? 110 : 140),
    `${Math.round(alturaCabecalho)}px`,
  );

  /* --------------------------------------------- pendências e progresso */
  check(
    'anuncia as 2 pendências',
    /2 conferências pendentes/i.test(await page.locator('.refdate').innerText()),
  );
  check(
    'mostra o progresso da janela',
    /5 de 7 concluídas/.test(await page.locator('.refdate').innerText()),
  );

  /* -------------------------------------------------------------- chips */
  const chips = page.locator('.chip--date');
  check('a janela inteira vira chip', (await chips.count()) === 7, String(await chips.count()));

  /* A fila é cronológica e não depende do status de nenhum dia. */
  const datasDaFila = await chips.evaluateAll((els) =>
    els.map((el) => (el.getAttribute('aria-describedby') ?? '').replace('chip-state-', '')),
  );
  const cronologica = [...datasDaFila].sort();
  check(
    'a fila está em ordem cronológica crescente',
    JSON.stringify(datasDaFila) === JSON.stringify(cronologica),
    datasDaFila.join(' '),
  );
  check(
    'e cobre exatamente D-7 até D-1',
    datasDaFila[0] === iso(7) && datasDaFila[6] === iso(1),
    `${datasDaFila[0]} .. ${datasDaFila[6]}`,
  );

  /* O chip aberto: a pendência mais antiga, esteja onde estiver na fila. */
  const aberto = page.locator('.chip--date[aria-current="date"]');
  const linhas = (await aberto.innerText()).split('\n').filter(Boolean);
  check('o chip tem três linhas (dia, data, situação)', linhas.length === 3, linhas.join(' / '));
  check(
    'abre na pendência mais ANTIGA',
    linhas[1] === ANTIGA.slice(8) + '/' + ANTIGA.slice(5, 7),
    linhas[1],
  );

  /*
    Com a fila cronológica, a data aberta nasce quase no fim dela — e sete chips
    não cabem em 360px. Se o scrollIntoView não fizesse o trabalho, o gerente
    abriria a tela sem ver em que dia está.
  */
  const abertoVisivelNaChegada = await aberto.evaluate((el) => {
    const fila = el.closest('.chips').getBoundingClientRect();
    const chip = el.getBoundingClientRect();
    return chip.left >= fila.left - 1 && chip.right <= fila.right + 1;
  });
  check('a data aberta está visível na fila já na chegada', abertoVisivelNaChegada);

  const primeiro = aberto;
  const caixa = await primeiro.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { h: r.height, w: r.width };
  });
  check('o chip é um alvo de toque (>= 44px)', caixa.h >= 44, `${Math.round(caixa.h)}x${Math.round(caixa.w)}px`);

  check('o selecionado tem aria-current', (await primeiro.getAttribute('aria-current')) === 'date');
  const anel = await primeiro.evaluate((el) => getComputedStyle(el).boxShadow);
  check('o selecionado tem anel, não só cor de fundo', anel !== 'none', anel.slice(0, 40));

  const marcados = await page.locator('.chip--date[aria-current="date"]').count();
  check('só UMA data está aberta', marcados === 1, String(marcados));

  const check_enviada = await page.locator('.chip--submitted .chip__check').count();
  check('as enviadas trazem um check além da cor', check_enviada === 5, String(check_enviada));

  /* ----------------------------------------------------- contraste real */
  const cores = await primeiro.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fg: s.color, bg: s.backgroundColor };
  });
  check(
    'contraste do chip selecionado >= 4.5:1',
    contraste(cores.fg, cores.bg) >= 4.5,
    `${contraste(cores.fg, cores.bg).toFixed(2)}:1`,
  );

  const sentenca = await page.locator('.conf-head__sentence').evaluate((el) => {
    const s = getComputedStyle(el);
    let n = el.parentElement;
    let bg = s.backgroundColor;
    while (n && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
      bg = getComputedStyle(n).backgroundColor;
      n = n.parentElement;
    }
    return { fg: s.color, bg };
  });
  check(
    'contraste da frase de status >= 4.5:1',
    contraste(sentenca.fg, sentenca.bg) >= 4.5,
    `${contraste(sentenca.fg, sentenca.bg).toFixed(2)}:1`,
  );

  /* ---------------------------------------------------------- foco visível */
  await primeiro.focus();
  const foco = await primeiro.evaluate((el) => getComputedStyle(el).outlineStyle);
  check('o chip tem foco visível pelo teclado', foco !== 'none', foco);

  /* ----------------------------------------- retrato do estado de chegada */
  if (apelido) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `${SHOTS}/fase44-gerente-${apelido}.png`,
      fullPage: viewport.width > 620,
    });
    console.log(`  ..  screenshot: fase44-gerente-${apelido}.png`);
  }

  /* ------------------------------------------------ preencher uma falta */
  const faltas = page.getByRole('spinbutton', { name: 'Faltas em OPERADOR DE CAIXA' });
  await faltas.fill('2');
  await page.waitForTimeout(300);

  const motivos = page.locator('.reasons').first();
  check('o painel de motivos abre com falta > 0', await motivos.isVisible());
  check(
    'o contador de motivos é visível e conta certo',
    /Motivos informados: 0 de 2/.test(await motivos.innerText()),
    (await motivos.innerText()).split('\n')[1],
  );

  if (celular) {
    const colunas = await page
      .locator('.reasons__grid')
      .first()
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    check('no celular os motivos ficam em 1 coluna', colunas === 1, `${colunas} coluna(s)`);
  }

  const menos = page.getByRole('button', { name: 'Diminuir Faltas em OPERADOR DE CAIXA' }).first();
  const alvoStepper = await menos.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return Math.min(r.width, r.height);
  });
  check(
    celular ? 'os +/- têm alvo de toque >= 44px' : 'os +/- têm alvo >= 34px',
    alvoStepper >= (celular ? 44 : 34),
    `${Math.round(alvoStepper)}px`,
  );

  /* ------------------------------------------- salvamento sem interrupção */
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.waitForTimeout(500);
  const statusSalvo = await page.locator('.actions__status').innerText();
  check(
    'o aviso de salvamento é discreto e traz a hora',
    /^Rascunho salvo às \d{2}:\d{2}$/.test(statusSalvo),
    statusSalvo,
  );
  check(
    'nenhum modal ou faixa interrompe o preenchimento',
    (await page.locator('.modal').count()) === 0 &&
      (await page.locator('.alert--success').count()) === 0,
  );
  // O título passou a dizer "rascunho" sozinho, pelo histórico recarregado.
  check(
    'o título acompanha: agora é rascunho',
    /rascunho/i.test(await titulo.innerText()),
    (await titulo.innerText()).replace(/\n/g, ' | '),
  );

  if (apelido) {
    // O painel de motivos fica lá embaixo, na função que recebeu a falta.
    await motivos.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `${SHOTS}/fase44-gerente-${apelido}-motivos.png`,
      fullPage: viewport.width > 620,
    });
    console.log(`  ..  screenshot: fase44-gerente-${apelido}-motivos.png`);
  }

  /* --------------------------------------------- o envio e a próxima pendência
     É o momento que faz a segunda-feira funcionar, e ele só existe depois de
     uma conferência VÁLIDA — por isso o motivo é preenchido antes. */
  await page
    .getByRole('spinbutton', { name: 'Falta injustificada em pos-operador-de-caixa' })
    .fill('2');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Finalizar conferência' }).click();
  await page.getByRole('button', { name: 'Enviar conferência' }).click();
  await page.waitForSelector('.sent', { timeout: 10000 });

  const enviado = page.locator('.sent');
  check(
    'o envio é confirmado com um ✓',
    /Conferência enviada com sucesso/.test(await enviado.innerText()),
  );
  check(
    'e a próxima pendência é nomeada com data e dia da semana',
    /PRÓXIMA CONFERÊNCIA PENDENTE/i.test(await enviado.innerText()) &&
      (await enviado.innerText()).includes(RECENTE.slice(8) + '/' + RECENTE.slice(5, 7)),
    (await enviado.innerText()).replace(/\n/g, ' | '),
  );

  const irPara = page.getByRole('button', { name: 'Ir para próxima pendência' });
  const alvoBotao = await irPara.evaluate((el) => el.getBoundingClientRect().height);
  check(
    'o botão da próxima pendência é grande o bastante',
    alvoBotao >= 44,
    `${Math.round(alvoBotao)}px`,
  );

  if (apelido) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `${SHOTS}/fase44-gerente-${apelido}-enviada.png`,
      fullPage: viewport.width > 620,
    });
    console.log(`  ..  screenshot: fase44-gerente-${apelido}-enviada.png`);
  }

  await irPara.click();
  await page.waitForTimeout(400);
  check(
    'e leva de fato para a data seguinte',
    (await page.locator('#reference-date').inputValue()) === RECENTE,
    RECENTE,
  );
  check(
    'o progresso andou para 6 de 7',
    /6 de 7 concluídas/.test(await page.locator('.refdate').innerText()),
  );

  /* A data aberta não pode ficar fora da fila rolada. */
  const visivel = await page
    .locator('.chip--date[aria-current="date"]')
    .evaluate((el) => {
      const fila = el.closest('.chips').getBoundingClientRect();
      const chip = el.getBoundingClientRect();
      return chip.left >= fila.left - 1 && chip.right <= fila.right + 1;
    });
  check('o chip da data aberta fica visível na fila', visivel);

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
    return [...document.querySelectorAll('main *, .app-header *')]
      .filter((el) => el.getBoundingClientRect().right > limite + 1)
      .filter((el) => !dentroDeRolador(el))
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 60))
      .slice(0, 4);
  });
  check('nada estoura a largura da tela', estouram.length === 0, estouram.join(' | '));

  const cortado = await page.evaluate(() =>
    [...document.querySelectorAll('.conf-head *, .chip--date *, .refdate__progress-text')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible')
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 50))
      .slice(0, 4),
  );
  check('nenhum texto do título ou dos chips é truncado', cortado.length === 0, cortado.join(' | '));

  if (celular) {
    const rolaChips = await page
      .locator('.refdate .chips')
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    check('a fila de chips rola sozinha no celular', rolaChips);
  }

  const corpo = await page.locator('main').innerText();
  check('sem NaN / undefined / Invalid Date', !/NaN|undefined|Invalid Date/.test(corpo));
  check('console limpo', erros.length === 0, erros.join(' | '));

  await page.close();
}

await browser.close();

console.log(
  falhas.length === 0
    ? '\nTUDO OK — tela do gerente aprovada em 1280, 430, 390 e 360.\n'
    : `\n${falhas.length} FALHA(S):\n  - ${falhas.join('\n  - ')}\n`,
);
process.exit(falhas.length === 0 ? 0 : 1);
