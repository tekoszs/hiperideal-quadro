import { useMemo, useState } from 'react';

type DemoRow = { id: string; name: string; district: 'Distrito 1' | 'Distrito 2' | 'Demais lojas'; absences: number; daysOff: number; submitted: boolean; };
const SAMPLE: DemoRow[] = [
  {id:'307',name:'Le Parc',district:'Distrito 1',absences:3,daysOff:9,submitted:true},
  {id:'308',name:'Sauípe',district:'Distrito 1',absences:1,daysOff:4,submitted:true},
  {id:'309',name:'Ibero',district:'Distrito 1',absences:2,daysOff:5,submitted:true},
  {id:'310',name:'Hemisphere',district:'Distrito 1',absences:0,daysOff:6,submitted:true},
  {id:'306',name:'Costa España',district:'Distrito 2',absences:1,daysOff:6,submitted:true},
  {id:'311',name:'Panamby',district:'Distrito 2',absences:2,daysOff:4,submitted:false},
  {id:'129',name:'Horto',district:'Demais lojas',absences:4,daysOff:12,submitted:true},
  {id:'125',name:'Orla',district:'Demais lojas',absences:3,daysOff:10,submitted:true},
  {id:'115',name:'Canela',district:'Demais lojas',absences:2,daysOff:8,submitted:false},
  {id:'103',name:'Piatã',district:'Demais lojas',absences:1,daysOff:11,submitted:true},
];
const all = (rows: DemoRow[], field: 'absences'|'daysOff') => rows.reduce((sum, r) => sum + r[field], 0);
const dateLabel = new Intl.DateTimeFormat('pt-BR', {day:'2-digit',month:'long',year:'numeric'}).format(new Date());
function Metric({label,value,caption,icon,kind}: {label:string;value:string|number;caption:string;icon:string;kind?:'warn'|'critical'}) {
  return <article className={`exec-stat ${kind ?? ''}`}>
    <div className="exec-stat__top"><span className="exec-stat__label">{label}</span><span className="exec-stat__symbol" aria-hidden="true">{icon}</span></div>
    <div className="exec-stat__value">{value}</div><div className="exec-stat__foot">{caption}</div>
  </article>;
}
export function ExecutiveShowcasePage() {
  const [scope,setScope]=useState('all');
  const [windowDays,setWindowDays]=useState<'7'|'30'>('7');
  const [search,setSearch]=useState('');
  const rows=useMemo(()=>SAMPLE.filter(r=>(scope==='all'||r.district===scope)&&(`${r.id} ${r.name}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))),[scope,search]);
  const total=rows.length, delivered=rows.filter(r=>r.submitted).length, pending=total-delivered;
  const pct=total?Math.round(delivered/total*100):0;
  const series=(windowDays==='7'?[12,9,11,7,9,6,8,5,7,6,4,5]:[18,15,19,12,14,11,16,13,10,12,8,11]);
  const districtResults=['Distrito 1','Distrito 2','Demais lojas'].map(name=>({name, rows:rows.filter(r=>r.district===name)})).filter(group=>group.rows.length);
  const exportPrint=()=>window.print();
  return <div className="exec-showcase">
    <aside className="exec-sidebar">
      <div className="exec-logo"><span className="exec-logo-mark">H</span><span>hiperideal.</span></div>
      <p className="exec-sidebar-caption">INTELIGÊNCIA OPERACIONAL</p>
      <button className="exec-side-link active" type="button"><span className="exec-side-icon">▦</span> Visão executiva</button>
      <button className="exec-side-link" type="button" onClick={()=>document.getElementById('tabela-lojas')?.scrollIntoView({behavior:'smooth'})}><span className="exec-side-icon">☷</span> Filiais e conferências</button>
      <button className="exec-side-link" type="button" onClick={()=>document.getElementById('analise-periodo')?.scrollIntoView({behavior:'smooth'})}><span className="exec-side-icon">↗</span> Indicadores</button>
      <a className="exec-side-link" href="/"><span className="exec-side-icon">↪</span> Sistema operacional</a>
      <div className="exec-side-bottom"><strong>Gestão de Quadro</strong>Visual para apresentação institucional. Conteúdo da demonstração separado do ambiente operacional.</div>
    </aside>
    <main className="exec-main">
      <div className="exec-topbar">
        <div className="exec-breadcrumb">Gestão de Pessoas <span> / </span> <strong>Visão executiva</strong></div>
        <div className="exec-top-actions"><span className="exec-demo-tag">Demonstração · dados ilustrativos</span><span className="exec-avatar" aria-label="Perfil de demonstração">HI</span></div>
      </div>
      <div className="exec-title-row">
        <div><p className="exec-overline">CENTRAL DE INDICADORES</p><h1>Painel de Gestão de Quadro</h1><p>Visão consolidada de conferências, faltas e folgas · {dateLabel}</p></div>
        <div className="exec-controls">
          <select className="exec-select" aria-label="Filtrar distrito" value={scope} onChange={e=>setScope(e.target.value)}>
            <option value="all">Toda a rede</option><option value="Distrito 1">Distrito 1</option><option value="Distrito 2">Distrito 2</option><option value="Demais lojas">Demais lojas</option>
          </select>
          <select className="exec-select" aria-label="Período do gráfico" value={windowDays} onChange={e=>setWindowDays(e.target.value as '7'|'30')}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select>
          <button type="button" className="exec-button primary" onClick={exportPrint}>Imprimir relatório</button>
        </div>
      </div>
      <div className="exec-stat-grid" aria-label="Indicadores ilustrativos">
        <Metric label="Lojas analisadas" value={total} caption="Unidades no filtro selecionado" icon="▦"/>
        <Metric label="Cobertura de conferências" value={`${pct}%`} caption={`${delivered} de ${total} lojas enviaram`} icon="◉"/>
        <Metric label="Faltas registradas" value={all(rows,'absences')} caption="Dados ilustrativos do quadro" icon="↗" kind="critical"/>
        <Metric label="Conferências pendentes" value={pending} caption="Lojas que precisam de acompanhamento" icon="!" kind="warn"/>
      </div>
      <div className="exec-two-col" id="analise-periodo">
        <section className="exec-panel"><div className="exec-panel-head"><div><h3>Evolução das faltas</h3><p>Comportamento ilustrativo ao longo do período</p></div><span className="exec-dot">Visão consolidada</span></div>
          <div className="exec-trend" role="img" aria-label="Gráfico ilustrativo de evolução de faltas">
            {series.map((v,i)=><div className="exec-trend-group" key={i}><div className="exec-trend-bar" style={{height:`${Math.max(5,Math.round(v/20*100))}%`}} title={`Ponto ${i+1}: ${v} faltas ilustrativas`}/><span className="exec-trend-label">{i===0?'Início':i===series.length-1?'Fim':i%3===0?`${i+1}`:''}</span></div>)}
          </div>
          <div className="exec-legend">Faltas por referência · valores exemplificativos</div>
        </section>
        <section className="exec-panel"><div className="exec-panel-head"><div><h3>Distribuição por distrito</h3><p>Participação das faltas registradas no filtro</p></div></div>
          {districtResults.length?districtResults.map(group=>{
            const abs=all(group.rows,'absences'),max=Math.max(1,all(rows,'absences'));
            return <div className="exec-progress-row" key={group.name}><span className="exec-progress-label">{group.name}</span><div className="exec-track"><div className="exec-fill" style={{width:`${Math.round(abs/max*100)}%`}}/></div><span className="exec-progress-value">{abs}</span></div>
          }):<p>Nenhum distrito no filtro.</p>}
          <p className="exec-footnote">O acompanhamento por distrito permite identificar concentrações de faltas e priorizar a atuação das lideranças.</p>
        </section>
      </div>
      <section className="exec-panel" id="tabela-lojas">
        <div className="exec-panel-head"><div><h3>Conferências por filial</h3><p>Visão por loja para acompanhamento do preenchimento</p></div><input className="exec-select" type="search" placeholder="Buscar filial..." aria-label="Buscar filial" value={search} onChange={e=>setSearch(e.target.value)} /></div>
        <div className="exec-table-scroll">
          <table className="exec-table"><thead><tr><th>Filial</th><th>Distrito</th><th>Faltas</th><th>Folgas</th><th>Status</th></tr></thead><tbody>
            {rows.map(r=><tr key={r.id}><td><strong>{r.id} · {r.name}</strong></td><td>{r.district}</td><td>{r.absences}</td><td>{r.daysOff}</td><td><span className={`exec-status${r.submitted?'':' pending'}`}>{r.submitted?'Enviada':'Pendente'}</span></td></tr>)}
            {!rows.length&&<tr><td colSpan={5}>Nenhuma filial encontrada para o filtro.</td></tr>}
          </tbody></table>
        </div>
        <p className="exec-footnote"><strong>Importante:</strong> todos os números desta tela são ilustrativos. Eles não são extraídos do Supabase nem representam o resultado oficial do Hiperideal. Use o sistema operacional autenticado para consultar dados reais.</p>
      </section>
      <div className="exec-action-row"><span>HIPERIDEAL · Gestão de Pessoas · Modelo executivo</span><button className="exec-button" type="button" onClick={()=>{setScope('all');setWindowDays('7');setSearch('')}}>Limpar filtros</button></div>
    </main>
  </div>;
}
