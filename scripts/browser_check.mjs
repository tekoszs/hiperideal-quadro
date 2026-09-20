/**
 * Teste manual no navegador, automatizado.
 *
 * Prova, em um Chromium de verdade, que a observação aceita frase com espaço
 * ("Afastamento funcionário por 15 dias") e que os motivos aparecem com acento.
 *
 * Não faz parte de `npm test` — Playwright não é dependência do projeto para
 * não pesar o `npm install` de quem só quer rodar o sistema.
 *
 * COMO RODAR:
 *   npm run dev                       # em um terminal (modo demonstração)
 *   npm i -D playwright               # em outro
 *   npx playwright install chromium
 *   node scripts/browser_check.mjs
 *
 * Sai com código 0 quando tudo passa.
 */
import { chromium } from 'playwright';

const FRASE = 'Afastamento funcionário por 15 dias';
const URL = 'http://localhost:5173';

const browser = await chromium.launch(
  // Em ambiente com Chromium pré-instalado, aponte o caminho aqui.
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.position-row', { timeout: 15000 });

console.log('titulo da pagina  :', await page.title());
console.log('funcoes na tela   :', await page.locator('.position-row').count());

// 1) Lançar 1 falta na primeira função para abrir os detalhes.
const linha = page.locator('.position-row').first();
const nomeFuncao = (await linha.locator('.position-row__name').first().innerText()).trim();
console.log('funcao usada      :', nomeFuncao);

await linha.locator('input[type="number"], input').first().fill('1');
await linha.locator('input').first().dispatchEvent('change');
await page.waitForTimeout(300);

// Se o fill nao funcionou, usa o botao de +.
if (!(await page.locator('textarea').count())) {
  await linha.getByRole('button', { name: '+' }).first().click();
  await page.waitForTimeout(300);
}

const totalTextareas = await page.locator('textarea').count();
console.log('textareas abertos :', totalTextareas);

// 2) O TESTE: digitar tecla por tecla no campo "Observação da função".
const campo = page.getByLabel('Observação da função (opcional)');
await campo.click();
await campo.pressSequentially(FRASE, { delay: 20 });

const valor = await campo.inputValue();
const cursor = await campo.evaluate((el) => el.selectionStart);

console.log('');
console.log('digitado          :', JSON.stringify(FRASE));
console.log('ficou no campo    :', JSON.stringify(valor));
console.log('espacos digitados :', (FRASE.match(/ /g) || []).length);
console.log('espacos no campo  :', (valor.match(/ /g) || []).length);
console.log('cursor no fim     :', cursor === valor.length ? 'sim' : `NAO (${cursor} de ${valor.length})`);

// 3) Espaço solto no fim continua lá enquanto digita.
await campo.pressSequentially(' ', { delay: 20 });
const comEspacoFinal = await campo.inputValue();
console.log('espaco no fim     :', comEspacoFinal.endsWith(' ') ? 'permanece' : 'SUMIU');

// 4) Motivos: acentuação em UTF-8 (modo demonstração lê de src/data).
const motivos = await page.locator('.reasons').first().innerText().catch(() => '');
const mojibake = /[ÂÃ][-¿]|�/.test(motivos);
console.log('mojibake nos motivos:', mojibake ? 'SIM (RUIM)' : 'nenhum');
const temAtestado = motivos.includes('Atestado médico');
const temSuspensao = motivos.includes('Suspensão');
console.log('"Atestado médico" :', temAtestado ? 'ok' : 'NAO ENCONTRADO');
console.log('"Suspensão"       :', temSuspensao ? 'ok' : 'NAO ENCONTRADO');

await page.screenshot({ path: '/tmp/tela-gerente.png', fullPage: false });

console.log('');
console.log('erros de JS no console:', erros.length ? erros : 'nenhum');

const ok =
  valor === FRASE &&
  cursor === FRASE.length &&
  comEspacoFinal.endsWith(' ') &&
  !mojibake &&
  temAtestado &&
  temSuspensao &&
  erros.length === 0;

console.log('');
console.log(ok ? 'RESULTADO: PASSOU' : 'RESULTADO: FALHOU');

await browser.close();
process.exit(ok ? 0 : 1);
