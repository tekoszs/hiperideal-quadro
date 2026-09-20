/**
 * Teste manual da tela CONFERÊNCIAS do supervisor, automatizado.
 *
 * Roda em Chromium de verdade, no desktop (1280px) e no celular (390px), e
 * verifica o que só o navegador prova: que a tabela vira card, que nada rola
 * na horizontal e que o drawer abre com os motivos.
 *
 * Os dados são semeados no localStorage ANTES da página carregar, no formato
 * real do LocalStorageAdapter — o caminho exercitado é o de produção:
 * adaptador -> domínio -> tela.
 *
 * Não faz parte de `npm test` (Playwright não é dependência do projeto).
 *
 * COMO RODAR:
 *   npm run dev
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/browser_check_supervisor.mjs
 */
import { chromium } from 'playwright';

// `?demo=rede` escolhe o perfil de gerencia no MODO DEMONSTRACAO -- que so
// existe com o .env do Supabase vazio. Sem isso a demonstracao abre a tela do
// gerente e as telas de supervisao nunca sao medidas num navegador de verdade.
const URL = 'http://localhost:5173/?demo=rede';

/** D-1, a referência padrão da tela. */
function referenceDate(offset = 1) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const D1 = referenceDate(1);

/** Conferência ENVIADA com 3 faltas divididas em 2 motivos. */
const conferencia = {
  id: '11111111-1111-4111-8111-111111111111',
  storeId: 'store-124',
  referenceDate: D1,
  status: 'SUBMITTED',
  createdBy: '00000000-0000-4000-8000-000000000001',
  submittedBy: '00000000-0000-4000-8000-000000000001',
  createdAt: `${D1}T09:00:00.000Z`,
  updatedAt: `${D1}T11:42:00.000Z`,
  submittedAt: `${D1}T11:42:00.000Z`,
  items: [
    {
      id: '22222222-2222-4222-8222-222222222221',
      positionId: 'pos-atendente-alimentos-padaria',
      absenceQuantity: 1,
      dayOffQuantity: 0,
      observation: 'Associada apresentou atestado.',
      reasons: [
        {
          id: '33333333-3333-4333-8333-333333333331',
          reasonId: 'reason-atestado-medico',
          quantity: 1,
          observation: null,
        },
      ],
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      positionId: 'pos-operador-de-caixa',
      absenceQuantity: 2,
      dayOffQuantity: 6,
      observation: null,
      reasons: [
        {
          id: '33333333-3333-4333-8333-333333333332',
          reasonId: 'reason-atestado-medico',
          quantity: 1,
          observation: null,
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          reasonId: 'reason-falta-injustificada',
          quantity: 1,
          observation: null,
        },
      ],
    },
    {
      id: '22222222-2222-4222-8222-222222222223',
      positionId: 'pos-acougueiro',
      absenceQuantity: 0,
      dayOffQuantity: 0,
      observation: null,
      reasons: [],
    },
  ],
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

const falhas = [];
function check(nome, condicao, detalhe = '') {
  const ok = Boolean(condicao);
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
  if (!ok) falhas.push(nome);
}

async function abrir(viewport) {
  const page = await browser.newPage({ viewport });
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));

  await page.addInitScript(
    ([chave, valor]) => window.localStorage.setItem(chave, valor),
    [
      'hiperideal.quadro.conferences.v1',
      JSON.stringify({ [`${conferencia.storeId}::${D1}`]: conferencia }),
    ],
  );

  await page.goto(URL, { waitUntil: 'networkidle' });
  // Home do supervisor -> abre Conferências.
  await page.getByRole('heading', { name: 'Conferências' }).click();
  await page.waitForSelector('.network-row', { timeout: 15000 });
  return { page, erros };
}

/* ------------------------------------------------------------------ DESKTOP */
console.log('\n=== DESKTOP 1280x900 ===');
{
  const { page, erros } = await abrir({ width: 1280, height: 900 });

  const dataNaTela = await page.getByLabel('Referência').inputValue();
  check('abre em D-1', dataNaTela === D1, `${dataNaTela} (esperado ${D1})`);

  const valorCard = async (rotulo) =>
    page
      .locator('.summary-card', { hasText: rotulo })
      .locator('.summary-card__value')
      .first()
      .innerText();

  const faltas = await valorCard('Faltas');
  const folgas = await valorCard('Folgas');
  const lojas = await valorCard('Lojas');
  const enviaram = await valorCard('Enviaram');

  check('Lojas usa quadro_stores (1 loja real)', lojas === '1', lojas);
  check('Enviaram = 1', enviaram === '1', enviaram);
  // A regra que não pode quebrar: 3 faltas em 2 motivos continuam sendo 3.
  check('Faltas = 3 (nao 6)', faltas === '3', faltas);
  check('Folgas = 6', folgas === '6', folgas);

  const linha = page.locator('.network-row').first();
  check('status Enviada', (await linha.innerText()).includes('Enviada'));
  check('horario do envio aparece', /\d{2}:\d{2}/.test(await linha.innerText()));

  // Detalhe
  await linha.getByRole('button', { name: /Ver detalhes/ }).click();
  const drawer = page.getByRole('dialog');
  await drawer.waitFor();
  const textoDrawer = await drawer.innerText();

  check('drawer mostra a loja', textoDrawer.includes('PARQUE SHOPPING'));
  check('mostra os 2 motivos do caixa', textoDrawer.includes('Atestado médico') && textoDrawer.includes('Falta injustificada'));
  check('mostra a observacao', textoDrawer.includes('Associada apresentou atestado.'));
  check('mostra "Sem observação."', textoDrawer.includes('Sem observação.'));
  check('acentos corretos (sem mojibake)', !/[ÂÃ][-¿]/.test(textoDrawer));

  // Ocorrências (2) -> Todas as funções (3)
  const ocorrencias = await drawer.locator('.detail-item').count();
  await drawer.getByRole('button', { name: 'Todas as funções' }).click();
  const todas = await drawer.locator('.detail-item').count();
  check('alterna Ocorrencias/Todas', ocorrencias === 2 && todas === 3, `${ocorrencias} -> ${todas}`);

  await page.screenshot({ path: '/tmp/supervisor-detalhe.png' });
  await drawer.getByRole('button', { name: 'Fechar detalhes' }).click();
  await page.screenshot({ path: '/tmp/supervisor-desktop.png' });

  // Filtros
  await page.getByRole('button', { name: 'Pendentes', exact: true }).click();
  check('filtro Pendentes esvazia a lista', (await page.locator('.network-row').count()) === 0);
  await page.getByRole('button', { name: 'Com faltas', exact: true }).click();
  check('filtro Com faltas mantem a loja', (await page.locator('.network-row').count()) === 1);
  await page.getByRole('button', { name: 'Todos', exact: true }).click();

  // Dia anterior: a loja passa a PENDENTE (não existe conferência lá).
  await page.getByRole('button', { name: 'Dia anterior' }).click();
  await page.waitForTimeout(400);
  check('outro dia mostra PENDENTE', (await page.locator('.network-row').innerText()).includes('Pendente'));
  await page.screenshot({ path: '/tmp/supervisor-pendente.png' });

  check('sem erro de JS', erros.length === 0, erros.join(' | '));
  await page.close();
}

/* ------------------------------------------------------------------- MOBILE */
console.log('\n=== MOBILE 390x844 ===');
{
  const { page, erros } = await abrir({ width: 390, height: 844 });

  const rolagem = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  check(
    'NAO rola na horizontal',
    rolagem.scrollWidth <= rolagem.clientWidth && rolagem.bodyScroll <= rolagem.clientWidth,
    `scrollWidth ${rolagem.scrollWidth} / clientWidth ${rolagem.clientWidth}`,
  );

  const cabecalhoVisivel = await page.locator('.network-list__head').isVisible();
  check('cabecalho de colunas some no celular', cabecalhoVisivel === false);

  const linha = page.locator('.network-row').first();
  // Os rótulos vêm de `::before { content: attr(data-label) }`, que NÃO entra
  // no innerText — é preciso ler o estilo computado do pseudo-elemento.
  const rotulos = await page.evaluate(() =>
    [...document.querySelectorAll('.network-row .network-list__num')].map((el) =>
      getComputedStyle(el, '::before').content.replace(/^"|"$/g, ''),
    ),
  );
  check(
    'numeros ganham rotulo no card',
    rotulos.includes('Faltas') && rotulos.includes('Folgas') && rotulos.includes('Enviado às'),
    rotulos.join(' | '),
  );

  await page.screenshot({ path: '/tmp/supervisor-mobile.png', fullPage: true });

  // Drawer ocupa a tela inteira e continua sem rolagem lateral.
  await linha.getByRole('button', { name: /Ver detalhes/ }).click();
  await page.getByRole('dialog').waitFor();
  const rolagemDrawer = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(
    'drawer aberto tambem nao rola na horizontal',
    rolagemDrawer.scrollWidth <= rolagemDrawer.clientWidth,
    `${rolagemDrawer.scrollWidth} / ${rolagemDrawer.clientWidth}`,
  );
  await page.screenshot({ path: '/tmp/supervisor-mobile-detalhe.png' });

  check('sem erro de JS', erros.length === 0, erros.join(' | '));
  await page.close();
}

await browser.close();

console.log('');
console.log(falhas.length === 0 ? 'RESULTADO: PASSOU' : `RESULTADO: FALHOU (${falhas.join(', ')})`);
process.exit(falhas.length === 0 ? 0 : 1);
