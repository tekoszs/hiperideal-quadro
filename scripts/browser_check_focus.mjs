/**
 * FASE 4.2 — O DETALHE POR FUNÇÃO num navegador de verdade.
 *
 * `?demo=rede` abre as telas de supervisão no MODO DEMONSTRAÇÃO (que só existe
 * com o .env do Supabase vazio — ver src/lib/demo.ts).
 *
 * O que só o navegador prova:
 *
 *   • a tabela de 4 colunas do drawer NÃO faz a página rolar na horizontal em
 *     390px — ela vira card, e isso é layout, medido em pixel, não em jsdom;
 *   • clicar numa loja abre o detalhe POR CIMA, sem fechar o foco;
 *   • as observações (do lançamento e do motivo) aparecem de verdade;
 *   • o console fica limpo.
 *
 * Não faz parte de `npm test` (Playwright não é dependência do projeto).
 *
 * COMO RODAR:
 *   npm run dev
 *   npm i -D playwright && npx playwright install chromium
 *   node scripts/browser_check_focus.mjs
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const falhas = [];
const ok = (n, c, d='') => { const v=Boolean(c); console.log(`  ${v?'ok  ':'FALHA'} ${n}${d?` -> ${d}`:''}`); if(!v) falhas.push(n); };

function iso(n){const d=new Date();d.setDate(d.getDate()-n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const D2=iso(2), D3=iso(3);
const conf=(id,date,items)=>({id,storeId:'store-124',referenceDate:date,status:'SUBMITTED',
  createdBy:'00000000-0000-4000-8000-000000000001',submittedBy:'00000000-0000-4000-8000-000000000001',
  createdAt:`${date}T09:00:00.000Z`,updatedAt:`${date}T11:00:00.000Z`,submittedAt:`${date}T11:00:00.000Z`,items});
const it=(u,pos,a,f,obs,rs=[])=>({id:`2222${u}-2222-4222-8222-222222222222`,positionId:pos,
  absenceQuantity:a,dayOffQuantity:f,observation:obs,
  reasons:rs.map((r,i)=>({id:`3333${u}${i}-3333-4333-8333-333333333333`,reasonId:r.id,quantity:r.qty,observation:r.obs??null}))});

const DADOS = {
  [`store-124::${D3}`]: conf('f1',D3,[
    it('a','pos-atendente-alimentos-padaria',3,0,'Turno da manhã descoberto',
       [{id:'reason-atestado-medico',qty:2,obs:'Consulta agendada'},{id:'reason-falta-injustificada',qty:1}]),
    it('b','pos-operador-de-caixa',2,1,null,[{id:'reason-outros',qty:2,obs:'Escala trocada'}]),
  ]),
  [`store-124::${D2}`]: conf('f2',D2,[
    it('c','pos-repositor-mercearia',1,0,null,[{id:'reason-licenca',qty:1}]),
  ]),
};

for (const [nome, vp] of [['DESKTOP 1280x900',{width:1280,height:900}],['CELULAR 390x844',{width:390,height:844}]]) {
  console.log(`\n=== ${nome} ===`);
  const p = await b.newPage({ viewport: vp });
  const erros=[]; p.on('pageerror',e=>erros.push(String(e)));
  p.on('console',m=>m.type()==='error'&&erros.push(m.text()));
  await p.addInitScript(([k,v])=>window.localStorage.setItem(k,v),
    ['hiperideal.quadro.conferences.v1', JSON.stringify(DADOS)]);
  await p.goto('http://localhost:5173/?demo=rede',{waitUntil:'networkidle'});
  await p.locator('.home-card__title',{hasText:'Visão da Rede'}).click();
  await p.waitForSelector('.summary--analytics',{timeout:15000});

  // FUNÇÕES EM ATENÇÃO -> clicável
  const atencao = p.locator('.panel', { hasText: 'Funções em atenção' });
  const alvo = atencao.locator('.attention__name').first();
  const nomeFuncao = (await alvo.innerText()).trim();
  ok('função em atenção é um botão', await alvo.evaluate(el => el.tagName) === 'BUTTON');
  await alvo.click();
  await p.waitForSelector('[role="dialog"]',{timeout:5000});
  ok('clicar abre o drawer', (await p.locator('[role="dialog"]').count()) >= 1, nomeFuncao);

  const drawer = p.locator('[role="dialog"]').last();
  ok('mostra "Lojas impactadas"', (await drawer.locator('.drawer__total-label', {hasText:'Lojas impactadas'}).count()) === 1);
  ok('tem a tabela de lojas', (await drawer.locator('.focus-table').count()) === 1);
  ok('tem a coluna Última ocorrência', (await drawer.locator('th', {hasText:'Última ocorrência'}).count()) === 1);
  ok('lista motivos', (await drawer.locator('[aria-label*="Motivos das faltas"]').count()) === 1);
  const corpoDrawer = await drawer.innerText();
  ok('sem NaN / undefined', !/NaN|undefined/.test(corpoDrawer));

  // A página NÃO pode rolar na horizontal com o drawer aberto.
  const rola = await p.evaluate(() => ({s:document.documentElement.scrollWidth, c:document.documentElement.clientWidth}));
  ok('página NÃO rola na horizontal', rola.s <= rola.c + 1, `${rola.s} / ${rola.c}`);

  const estouram = await p.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    const dentroDeRolador = (el) => { for(let n=el.parentElement;n;n=n.parentElement){
      const o=getComputedStyle(n).overflowX; if(o==='auto'||o==='scroll') return true;} return false; };
    return [...document.querySelectorAll('[role="dialog"] *')]
      .filter(el => el.getBoundingClientRect().right > limite + 1)
      .filter(el => !dentroDeRolador(el))
      .map(el => `${el.tagName}.${el.className}`.slice(0,50)).slice(0,4);
  });
  ok('nada estoura a largura', estouram.length === 0, estouram.join(' | '));

  // Clicar numa loja abre o detalhe com dia a dia, motivos e observação.
  await drawer.locator('.focus-table__store').first().click();
  await p.waitForTimeout(300);
  const loja = p.locator('[role="dialog"]').last();
  ok('abre o detalhe da loja', (await loja.locator('.panel__title', {hasText:'Ocorrências, dia a dia'}).count()) === 1);
  const textoLoja = await loja.innerText();
  ok('mostra a observação do lançamento', textoLoja.includes('Turno da manhã descoberto'));
  ok('mostra a observação do motivo', textoLoja.includes('Consulta agendada'));
  ok('mostra OUTRAS funções do mesmo dia', textoLoja.includes('OPERADOR DE CAIXA'));
  ok('destaca a função de origem', (await loja.locator('.occurrence--highlight').count()) >= 1);

  const rola2 = await p.evaluate(() => ({s:document.documentElement.scrollWidth, c:document.documentElement.clientWidth}));
  ok('detalhe da loja não rola na horizontal', rola2.s <= rola2.c + 1, `${rola2.s} / ${rola2.c}`);
  ok('console limpo', erros.length === 0, erros.join(' | '));

  await p.close();
}
await b.close();
console.log(falhas.length===0 ? '\nTUDO OK — detalhe por função aprovado em 1280 e 390.\n'
  : `\n${falhas.length} FALHA(S): ${falhas.join(', ')}\n`);
process.exit(falhas.length===0?0:1);
