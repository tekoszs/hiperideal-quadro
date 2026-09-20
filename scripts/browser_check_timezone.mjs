/**
 * FASE 4.5 (correção) — A TELA SEGUE O RELÓGIO DA BAHIA, NÃO O DO APARELHO.
 *
 * O QUE ESTE CHECK PROVA, E POR QUE NENHUM OUTRO PROVA
 * ----------------------------------------------------
 * O `npm test` roda em jsdom, e jsdom não tem fuso próprio: os testes puros
 * injetam `today`, então nunca exercitam o CAMINHO PADRÃO — justamente o que o
 * gerente usa. Playwright dá um fuso de verdade a cada contexto, e é a única
 * forma de perguntar "e se o celular estiver em outro dia?".
 *
 * O DEFEITO QUE ISTO IMPEDE DE VOLTAR
 * -----------------------------------
 * Com `new Date()` no lugar de `businessNow()`, um celular em UTC+14 abria a
 * tela num "hoje" que já é amanhã na Bahia. A janela de 7 dias inteira desliza
 * um dia: a conferência que o gerente precisa fazer some da fila, e o
 * pré-registro nasce numa data que o banco recusa. Medido com a mutação: a tela
 * mostrou 01/09 quando a Bahia estava em 07/09 — sem erro, sem aviso.
 *
 * FUSOS ESCOLHIDOS. Kiritimati (UTC+14) e Adak (UTC-10) são os extremos
 * habitados; entre eles cabe qualquer aparelho. O check AVISA quando o fuso
 * testado calha de estar no mesmo dia civil da Bahia — nessa hora aquele caso
 * não prova nada, e dizer isso é mais honesto que exibir um OK vazio.
 *
 * Não faz parte de `npm test` (Playwright não é dependência do projeto).
 *
 * COMO RODAR:
 *   npm run dev
 *   npm i -D playwright
 *   node scripts/browser_check_timezone.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.APP_URL ?? 'http://localhost:5173';
const FUSOS = ['Pacific/Kiritimati', 'America/Adak', 'Asia/Tokyo', 'UTC'];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

/** A mesma conta que `businessNow()` faz no app e `quadro_business_date()` no banco. */
const bahia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());

let falhou = false;
let algumProvou = false;

for (const tz of FUSOS) {
  const ctx = await browser.newContext({
    timezoneId: tz,
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });

  const doAparelho = await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));

  await page.getByRole('button', { name: /registrar ocorrências de hoje/i }).click();
  await page.waitForTimeout(400);

  // A data grande do cabeçalho do pré-registro, em DD/MM/AAAA.
  const naTela = (await page.locator('text=/^\\d{2}\\/\\d{2}\\/\\d{4}$/').first().innerText()).trim();
  const iso = naTela.split('/').reverse().join('-');

  const diferem = doAparelho !== bahia;
  if (diferem) algumProvou = true;

  const ok = iso === bahia;
  if (!ok) falhou = true;

  console.log(
    `${ok ? 'OK  ' : 'ERRO'} ${tz.padEnd(20)} aparelho=${doAparelho}  tela=${iso}  ` +
      `bahia=${bahia}${diferem ? '   <- os dias DIFEREM: este caso prova' : '   (mesmo dia civil)'}`,
  );

  await ctx.close();
}

await browser.close();

if (falhou) {
  console.error('\nA TELA SEGUIU O APARELHO. Veja `businessNow()` em src/utils/date.ts.');
  process.exit(1);
}

if (!algumProvou) {
  // Acontece nas poucas horas em que o mundo inteiro está no mesmo dia civil.
  // Passar aqui não significa nada, e fingir que sim seria pior que falhar.
  console.error(
    '\nNENHUM FUSO CAIU EM DIA DIFERENTE DA BAHIA nesta hora — o check não provou nada.',
  );
  process.exit(2);
}

console.log('\nA tela seguiu a Bahia em todos os fusos, inclusive nos que já viraram o dia.');
