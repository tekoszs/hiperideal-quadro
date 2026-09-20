/**
 * Teste manual da VISÃO DA REDE, automatizado.
 *
 * Roda em Chromium de verdade, desktop (1280) e celular (390), e verifica o
 * que só o navegador prova: que o dashboard não rola na horizontal, que os
 * gráficos desenham, que nada vira NaN e que o console fica limpo.
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
 *   node scripts/browser_check_network.mjs
 */
import { chromium } from 'playwright';

// `?demo=rede` escolhe o perfil de gerencia no MODO DEMONSTRACAO -- que so
// existe com o .env do Supabase vazio. Sem isso a demonstracao abre a tela do
// gerente e as telas de supervisao nunca sao medidas num navegador de verdade.
const URL = 'http://localhost:5173/?demo=rede';

function iso(offsetDias) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const D1 = iso(1);
const D2 = iso(2);
const D3 = iso(3);

/** Uma conferência no formato que o LocalStorageAdapter grava. */
function conferencia(id, date, itens, status = 'SUBMITTED') {
  return {
    id,
    storeId: 'store-124',
    referenceDate: date,
    status,
    createdBy: '00000000-0000-4000-8000-000000000001',
    submittedBy: '00000000-0000-4000-8000-000000000001',
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T11:42:00.000Z`,
    submittedAt: status === 'SUBMITTED' ? `${date}T11:42:00.000Z` : null,
    submittedBy: status === 'SUBMITTED' ? '00000000-0000-4000-8000-000000000001' : null,
    items: itens,
  };
}

function item(uid, positionId, absence, dayOff, reasons = []) {
  return {
    id: `2222${uid}-2222-4222-8222-222222222222`,
    positionId,
    absenceQuantity: absence,
    dayOffQuantity: dayOff,
    observation: null,
    reasons: reasons.map((r, i) => ({
      id: `3333${uid}${i}-3333-4333-8333-333333333333`,
      reasonId: r.id,
      quantity: r.qty,
      observation: null,
    })),
  };
}

const DADOS = {
  [`store-124::${D3}`]: conferencia('c1', D3, [
    item('a', 'pos-atendente-alimentos-padaria', 1, 0, [
      { id: 'reason-atestado-medico', qty: 1 },
    ]),
    // 2 faltas divididas em 2 motivos — o caso que não pode virar 4.
    item('b', 'pos-operador-de-caixa', 2, 6, [
      { id: 'reason-atestado-medico', qty: 1 },
      { id: 'reason-falta-injustificada', qty: 1 },
    ]),
    item('c', 'pos-acougueiro', 0, 0),
  ]),
  [`store-124::${D2}`]: conferencia('c2', D2, [
    item('d', 'pos-operador-de-caixa', 2, 0, [{ id: 'reason-falta-injustificada', qty: 2 }]),
    item('e', 'pos-repositor-mercearia', 1, 0, [{ id: 'reason-outros', qty: 1 }]),
  ]),
  // RASCUNHO com 10 faltas: nao pode aparecer em nenhum numero oficial.
  [`store-124::${D1}`]: conferencia(
    'c3',
    D1,
    [item('f', 'pos-aux-de-cozinha-refeitorio', 10, 2, [{ id: 'reason-licenca', qty: 10 }])],
    'DRAFT',
  ),
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
    ['hiperideal.quadro.conferences.v1', JSON.stringify(DADOS)],
  );

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Visão da Rede' }).click();
  await page.waitForSelector('.summary--analytics', { timeout: 15000 });
  return { page, erros };
}

const valorCard = (page, rotulo) =>
  page
    .locator('.summary-card')
    .filter({ has: page.locator('.summary-card__label', { hasText: new RegExp(`^${rotulo}$`) }) })
    .locator('.summary-card__value')
    .first()
    .innerText();

/* ------------------------------------------------------------------ DESKTOP */
console.log('\n=== DESKTOP 1280x900 ===');
{
  const { page, erros } = await abrir({ width: 1280, height: 950 });

  const faltas = await valorCard(page, 'Faltas');
  const folgas = await valorCard(page, 'Folgas');
  const media = await valorCard(page, 'Média por dia');
  const cobertura = await valorCard(page, 'Cobertura');

  // 3 (D-3 enviada) + 3 (D-2 enviada) = 6. O RASCUNHO de D-1 tem 10 faltas e
  // NAO pode entrar: se entrasse, daria 16.
  check('Faltas = 6 — rascunho fora', faltas === '6', faltas);
  check('Folgas = 6 — rascunho fora', folgas === '6', folgas);
  check('Media por dia = 0,9 (6 faltas / 7 dias)', media === '0,9', media);
  check('Cobertura = 28,6% (2 de 7)', cobertura === '28,6%', cobertura);
  check(
    'avisa que rascunho nao entra',
    (await page.locator('text=/est\u00e1 em preenchimento e n\u00e3o entra/').count()) > 0,
  );
  const motivosTexto = await page
    .locator('[aria-label="Distribuição das faltas por motivo"]')
    .innerText();
  check('motivo do rascunho (Licenca) fora do ranking', !motivosTexto.includes('Licença'), motivosTexto.replace(/\n/g, ' '));

  // Os tres estados do grafico de evolucao.
  const estados = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.panel .bars__plot')][0].children;
    return [...cols].map((c) =>
      c.querySelector('.bars__gap') ? 'NO_DATA'
      : c.querySelector('.bars__bar--partial') ? 'PARTIAL'
      : 'COMPLETE',
    );
  });
  check('dia sem conferencia nao vira barra zero', estados.filter((e) => e === 'NO_DATA').length >= 4, estados.join(','));
  check('legenda dos estados aparece', (await page.locator('.bars__legend').count()) > 0);

  const periodo = await page.locator('.period__summary-value').innerText();
  check('periodo em DD/MM/AAAA', /^\d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}$/.test(periodo), periodo);

  const corpo = await page.locator('main').innerText();
  check('sem NaN / Infinity / undefined', !/NaN|Infinity|undefined/.test(corpo));

  // Gráficos
  const barrasEvolucao = await page.locator('.panel', { hasText: 'Evolução' }).locator('.bars__col').count();
  check('evolucao com 7 barras', barrasEvolucao === 7, String(barrasEvolucao));

  const barrasSemana = await page
    .locator('.panel', { hasText: 'Faltas por dia da semana' })
    .locator('.bars__col')
    .count();
  check('dia da semana com 7 barras', barrasSemana === 7, String(barrasSemana));

  // Alternador de série
  await page.getByRole('button', { name: 'Folgas', exact: true }).click();
  await page.waitForTimeout(200);
  check(
    'alterna para Folgas (uma serie por vez)',
    (await page.locator('[aria-label="Folgas por dia no período"]').count()) === 1,
  );
  await page.getByRole('button', { name: 'Faltas', exact: true }).click();

  // Rankings
  const funcoes = await page
    .locator('[aria-label="Ranking de funções por faltas"] .ranking__label')
    .allInnerTexts();
  check(
    'funcoes com nome completo, nao fundidas',
    funcoes.includes('OPERADOR DE CAIXA') && funcoes.includes('REPOSITOR - MERCEARIA'),
    funcoes.join(' | '),
  );

  const setores = await page
    .locator('[aria-label="Ranking de setores por faltas"] .ranking__label')
    .allInnerTexts();
  check('setores nao inventam setor para funcao sem setor', !setores.includes('OPERADOR DE CAIXA'), setores.join(' | '));
  check(
    'declara as faltas sem setor',
    (await page.locator('text=/vieram de funções/').count()) > 0,
  );

  const motivos = await page
    .locator('[aria-label="Distribuição das faltas por motivo"] .ranking__label')
    .allInnerTexts();
  check('motivos com acento correto', motivos.includes('Atestado médico'), motivos.join(' | '));
  check('sem mojibake', !/[ÂÃ][-¿]/.test(corpo));

  // Grupo de função expande
  const grupoAtendente = page.locator('.group-list__head', { hasText: 'ATENDENTE ALIMENTOS' });
  check('grupo de funcao aparece', (await grupoAtendente.count()) > 0);

  await page.screenshot({ path: '/tmp/rede-desktop.png', fullPage: true });

  // Drawer da loja
  await page.getByRole('button', { name: /Abrir análise de/ }).first().click();
  const drawer = page.getByRole('dialog');
  await drawer.waitFor();
  const textoDrawer = (await drawer.textContent()) ?? '';
  check(
    'drawer da loja abre com conferencias',
    (await drawer.locator('text=Conferências do período').count()) > 0,
  );
  check('drawer sem NaN', !/NaN|Infinity/.test(textoDrawer));
  await page.screenshot({ path: '/tmp/rede-loja.png' });
  await drawer.getByRole('button', { name: 'Fechar análise' }).click();

  // Periodo: Dia. D-1 e o RASCUNHO -> nao ha dado oficial, e a tela precisa
  // dizer isso em vez de mostrar "0 faltas" como se tivesse apurado.
  await page.getByRole('button', { name: 'Dia', exact: true }).click();
  await page.waitForTimeout(500);
  check(
    'dia so com rascunho mostra estado vazio, nao 0 faltas',
    (await page.locator('text=Nenhuma conferência enviada no período selecionado.').count()) > 0,
  );
  check('estado vazio nao mostra cards de faltas', (await page.locator('.summary--analytics').count()) === 0);
  check('estado vazio mostra a cobertura', (await page.locator('.empty-state__facts').count()) === 1);
  check(
    'estado vazio explica o rascunho',
    (await page.locator('text=/em preenchimento/').count()) > 0,
  );
  await page.screenshot({ path: '/tmp/rede-vazio.png' });

  // 30 dias
  await page.getByRole('button', { name: '30 dias' }).click();
  await page.waitForTimeout(400);
  const barras30 = await page.locator('.panel', { hasText: 'Evolução' }).locator('.bars__col').count();
  check('30 dias desenha 30 barras', barras30 === 30, String(barras30));

  // Personalizado
  await page.getByRole('button', { name: 'Personalizado' }).click();
  await page.waitForTimeout(300);
  check('personalizado abre os campos', (await page.locator('.period__field input').count()) === 2);

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

  // Nenhum elemento pode estourar a viewport.
  const estouros = await page.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    // Um elemento pode passar da borda DESDE QUE esteja dentro de um contêiner
    // que rola sozinho (a fila de filtros). O que não pode é a página rolar.
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
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 60));
  });
  check('nenhum elemento estoura a largura', estouros.length === 0, estouros.slice(0, 3).join(' | '));

  const grid = await page.evaluate(() => {
    const el = document.querySelector('.analytics-grid');
    return el ? getComputedStyle(el).gridTemplateColumns : '';
  });
  check('paineis empilham em uma coluna', !grid.includes(' '), grid);

  await page.screenshot({ path: '/tmp/rede-mobile.png', fullPage: true });

  // Drawer no celular
  await page.getByRole('button', { name: /Abrir análise de/ }).first().click();
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
  await page.screenshot({ path: '/tmp/rede-mobile-loja.png' });

  check('sem erro de JS', erros.length === 0, erros.join(' | '));
  await page.close();
}

await browser.close();

console.log('');
console.log(falhas.length === 0 ? 'RESULTADO: PASSOU' : `RESULTADO: FALHOU (${falhas.join(', ')})`);
process.exit(falhas.length === 0 ? 0 : 1);
