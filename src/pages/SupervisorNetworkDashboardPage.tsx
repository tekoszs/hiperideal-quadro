import { useState } from 'react';
import type { SessionProfile } from '@/types/auth';
import { AnalyticsCards } from '@/components/AnalyticsCards';
import { BackButton } from '@/components/BackButton';
import { NetworkPendingJustifications } from '@/components/NetworkPendingJustifications';
import { FocusDrawer } from '@/components/FocusDrawer';
import { PeriodSelector } from '@/components/PeriodSelector';
import { StoreAnalysisDrawer } from '@/components/StoreAnalysisDrawer';
import { BarSeries } from '@/components/charts/BarSeries';
import { DailyEvolution } from '@/components/DailyEvolution';
import { RankingBars } from '@/components/charts/RankingBars';
import { useNetworkAnalytics } from '@/hooks/useNetworkAnalytics';
import { WEEKDAY_MIN_SAMPLE } from '@/lib/constants';
import { formatBrDate } from '@/utils/date';

interface Props {
  /** Perfil da sessão — define o alcance da tela. Vem do banco, não da URL. */
  profile: SessionProfile;
  /** Retorna para a home da área gerencial quando a página está na navegação interna. */
  onBack?: () => void;
  /** Abre a tela Conferências, opcionalmente já numa data. */
  onOpenConferences: (referenceDate?: string) => void;
}

/**
 * FASE 3B — VISÃO DA REDE.
 *
 * Painel analítico do supervisor, SOMENTE LEITURA.
 *
 * Ordem da tela, de cima para baixo: período e filtros → resumo → evolução →
 * rankings → funções, setores e motivos → atenções. É a ordem em que a
 * pergunta aparece: "como estamos", depois "onde", depois "por quê".
 *
 * ALCANCE (fase 4): a mesma tela serve o gerente distrital e o gerente da rede.
 * A diferença não está num `if` de cargo — está no que o banco devolve. O
 * seletor de distrito nasce das lojas que chegaram: quem recebe um distrito vê
 * um distrito, e não existe "34", "20" ou "14" escrito aqui.
 */
export function SupervisorNetworkDashboardPage({ profile, onBack, onOpenConferences }: Props) {
  const {
    period,
    kind,
    changeKind,
    custom,
    changeCustom,
    analytics,
    loading,
    error,
    districtId,
    districtLocked,
    setDistrictId,
    storeId,
    setStoreId,
    functionGroup,
    setFunctionGroup,
    focusAnalysis,
    openFocus,
    closeFocus,
    storeAnalysis,
    openStore,
    closeStore,
    focusPeriodKind,
    setFocusPeriodKind,
  } = useNetworkAnalytics(profile);

  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);

  const amostraFraca =
    analytics !== null && analytics.weekdays.some((dia) => dia.sampleDays < WEEKDAY_MIN_SAMPLE);

  // Distrito atual só para o texto. Sai da lista devolvida pela análise, que
  // por sua vez sai das lojas acessíveis.
  const distritoAtual = analytics?.districts.find((item) => item.id === districtId) ?? null;

  // Um distrito só: não existe o que escolher. Mostra qual é, em texto.
  const distritoUnico = analytics !== null && analytics.districts.length === 1;
  const mostrarSeletorDeDistrito =
    analytics !== null && !districtLocked && !distritoUnico && analytics.districts.length > 0;

  // O TÍTULO SEGUE O ESCOPO DO PERFIL, não a contagem de distritos que voltou.
  // São coisas diferentes: o escopo diz quem a pessoa é, a contagem diz o que
  // ela pode escolher agora. Ligar o título à contagem chamava de "Visão do
  // Distrito" o modo demonstração — que tem uma loja só, não um distrito.
  const titulo = districtLocked ? 'Visão do Distrito' : 'Visão da Rede';

  return (
    <main className="page">
      {onBack && <BackButton onClick={onBack} />}

      <div className="page-hero">
        <h2 className="page-hero__title">{titulo}</h2>
        <p className="page-hero__subtitle">
          {districtLocked && distritoAtual
            ? `${distritoAtual.name} · ${profile.name}`
            : `${profile.name} · Todas as lojas da rede`}
        </p>
      </div>

      <section className="section">
        <div className="section__head section__head--network">
          <div>
            <h2 className="section__title">Filtros e Período</h2>
            <p className="section__hint">
              Consolidado de faltas e folgas por loja, função, setor e motivo
              {distritoAtual ? ` — ${distritoAtual.name}` : ''}.
            </p>
          </div>
        </div>

        <div className="section__body">
          <PeriodSelector
            period={period}
            kind={kind}
            onChangeKind={changeKind}
            custom={custom}
            onChangeCustom={changeCustom}
            disabled={loading}
          />

          {analytics && (
            <div className="analytics-filters">
              {/*
                DISTRITO — as opções vêm das lojas que o banco devolveu, nunca de
                uma lista fixa. Quem só enxerga um distrito não recebe um seletor
                com uma opção: recebe o nome do distrito, em texto.
              */}
              {mostrarSeletorDeDistrito && (
                <label className="analytics-filters__field">
                  <span>Distrito</span>
                  <select
                    value={districtId ?? ''}
                    onChange={(event) => setDistrictId(event.target.value || null)}
                  >
                    <option value="">Todos os distritos</option>
                    {analytics.districts.map((district) => (
                      <option key={district.id} value={district.id}>
                        {district.managerName
                          ? `${district.name} - ${district.managerName}`
                          : district.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {!mostrarSeletorDeDistrito && analytics.districts.length > 0 && (
                <p className="analytics-filters__fixed">
                  <span>Distrito</span>
                  <strong>
                    {distritoAtual?.name ?? analytics.districts[0]?.name}
                    {(distritoAtual ?? analytics.districts[0])?.managerName
                      ? ` · ${(distritoAtual ?? analytics.districts[0])?.managerName}`
                      : ''}
                  </strong>
                </p>
              )}

              <label className="analytics-filters__field">
                <span>Loja</span>
                <select
                  value={storeId ?? ''}
                  onChange={(event) => setStoreId(event.target.value || null)}
                >
                  {/* Contagem calculada, não escrita: sobe e desce com a rede. */}
                  <option value="">
                    {analytics.stores.length === 1
                      ? 'Todas as lojas (1)'
                      : `Todas as lojas (${analytics.stores.length})`}
                  </option>
                  {analytics.stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.code} - {store.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="analytics-filters__field">
                <span>Grupo de função</span>
                <select
                  value={functionGroup ?? ''}
                  onChange={(event) => setFunctionGroup(event.target.value || null)}
                >
                  <option value="">Todas as funções</option>
                  {analytics.availableGroups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onOpenConferences(period.range.end)}
              >
                Ver conferências de {formatBrDate(period.range.end)}
              </button>
            </div>
          )}

          {error && (
            <div className="alert alert--error" role="alert">
              {error}
            </div>
          )}

          {loading && <p className="state">Carregando o período...</p>}

          {/*
            SEM DADO OFICIAL no período. Não mostramos cards de faltas zerados
            aqui: "0 faltas" ao lado de rankings vazios pareceria um resultado
            apurado. Mostramos só a cobertura, que é justamente o que explica o
            vazio — e, se houver rascunho, quantos são.
          */}
          {!loading && analytics && analytics.isEmpty && (
            <div className="empty-state">
              <p className="empty-state__title">
                Nenhuma conferência enviada no período selecionado.
              </p>
              <p className="empty-state__text">
                Sem conferência enviada não há número oficial para consolidar. A
                cobertura abaixo mostra o que era esperado.
              </p>
              <dl className="empty-state__facts">
                <div>
                  <dt>Esperadas</dt>
                  <dd>{analytics.headline.coverage.expected}</dd>
                </div>
                <div>
                  <dt>Enviadas</dt>
                  <dd>{analytics.headline.coverage.submitted}</dd>
                </div>
                <div>
                  <dt>Pendentes</dt>
                  <dd>{analytics.headline.coverage.pending}</dd>
                </div>
              </dl>
              {analytics.headline.coverage.inProgress > 0 && (
                <p className="empty-state__text">
                  {analytics.headline.coverage.inProgress === 1
                    ? '1 conferência está em preenchimento'
                    : `${analytics.headline.coverage.inProgress} conferências estão em preenchimento`}{' '}
                  e ainda não conta como dado oficial.
                </p>
              )}
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => onOpenConferences(period.range.end)}
              >
                Ver conferências de {formatBrDate(period.range.end)}
              </button>
            </div>
          )}

          {!loading && analytics && (
            <>
              {!analytics.isEmpty && (
                <>
                  <AnalyticsCards
                    headline={analytics.headline}
                    kind={kind}
                    storeCount={analytics.storesConsidered}
                    days={period.days}
                  />

                  {/* Aviso explícito: o que está fora dos números e por quê. */}
                  {analytics.headline.coverage.inProgress > 0 && (
                    <p className="official-note">
                      Os números consideram apenas conferências <strong>enviadas</strong>.{' '}
                      {analytics.headline.coverage.inProgress === 1
                        ? '1 conferência do período está em preenchimento e não entra'
                        : `${analytics.headline.coverage.inProgress} conferências do período estão em preenchimento e não entram`}{' '}
                      no consolidado.
                    </p>
                  )}

                  {/*
                    FASE 4.5 — o que já foi enviado mas ainda espera documento.
                    Fica ANTES dos rankings porque é ação pendente, não análise.
                  */}
                  <NetworkPendingJustifications pendings={analytics.pendingJustifications} />
                </>
              )}

              {/* ---------------------------------------------- evolução */}
              <DailyEvolution daily={analytics.daily} />

              {!analytics.isEmpty && (
                <>
                  {/* --------------------------------------- rankings lado a lado */}
                  <div className="analytics-grid">
                <section className="panel">
                  <h3 className="panel__title">Lojas com mais faltas</h3>
                  <RankingBars
                    ariaLabel="Ranking de lojas por faltas"
                    emptyMessage="Nenhuma falta registrada no período."
                    onSelect={openStore}
                    rows={analytics.storeRanking.map((entry) => ({
                      key: entry.storeId,
                      label: entry.label,
                      hint:
                        entry.daysWithAbsence > 0
                          ? `${entry.daysWithAbsence} ${entry.daysWithAbsence === 1 ? 'dia' : 'dias'} com falta · ${decimal(entry.averagePerDayWithAbsence)} por dia`
                          : 'sem falta no período',
                      value: entry.absences,
                      share: entry.share,
                    }))}
                  />
                </section>

                <section className="panel">
                  <h3 className="panel__title">Funções mais impactadas</h3>
                  <RankingBars
                    ariaLabel="Ranking de funções por faltas"
                    emptyMessage="Nenhuma falta registrada no período."
                    onSelect={(positionId) => openFocus({ kind: 'POSITION', positionId })}
                    rows={analytics.positionRanking.map((entry) => ({
                      key: entry.positionId,
                      label: entry.label,
                      hint: `${entry.storesAffected} ${entry.storesAffected === 1 ? 'loja' : 'lojas'}`,
                      value: entry.absences,
                      share: entry.share,
                    }))}
                  />
                </section>
              </div>

              {/* ------------------------------------------- grupos de função */}
              <section className="panel">
                <h3 className="panel__title">Grupos de função</h3>
                <p className="panel__hint">
                  Agrupamento apenas analítico — no banco cada função continua um
                  registro separado.
                </p>
                <ul className="group-list">
                  {analytics.functionGroups.map((group) => {
                    const aberto = grupoAberto === group.functionGroup;
                    // Só abre quando o grupo tem mais de uma função dentro.
                    const temDetalhe = group.positions.length > 1;
                    return (
                      <li key={group.functionGroup} className="group-list__item">
                        <button
                          type="button"
                          className="group-list__head"
                          aria-expanded={aberto}
                          disabled={!temDetalhe}
                          onClick={() => setGrupoAberto(aberto ? null : group.functionGroup)}
                        >
                          <span className="group-list__name">
                            {temDetalhe && (
                              <span className="group-list__caret" aria-hidden="true">
                                {aberto ? '▾' : '▸'}
                              </span>
                            )}
                            {group.label}
                          </span>
                          <span className="group-list__count">{group.absences}</span>
                        </button>
                        {/* O cabeçalho já expande as funções do grupo; este
                            botão responde a outra pergunta — "em que lojas". */}
                        <button
                          type="button"
                          className="group-list__stores"
                          onClick={() =>
                            openFocus({ kind: 'GROUP', functionGroup: group.functionGroup })
                          }
                        >
                          {group.storesAffected} {group.storesAffected === 1 ? 'loja' : 'lojas'} ›
                        </button>
                        {aberto && (
                          <ul className="group-list__children">
                            {group.positions.map((position) => (
                              <li key={position.positionId}>
                                <button
                                  type="button"
                                  className="group-list__child"
                                  onClick={() =>
                                    openFocus({
                                      kind: 'POSITION',
                                      positionId: position.positionId,
                                    })
                                  }
                                >
                                  {position.sector ?? position.label}
                                </button>
                                <strong>{position.absences}</strong>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* ------------------------------------------ setores e motivos */}
              <div className="analytics-grid">
                <section className="panel">
                  <h3 className="panel__title">Setores mais impactados</h3>
                  <RankingBars
                    ariaLabel="Ranking de setores por faltas"
                    emptyMessage="Nenhuma função com setor teve falta no período."
                    onSelect={(sector) => openFocus({ kind: 'SECTOR', sector })}
                    rows={analytics.sectors.entries.map((entry) => ({
                      key: entry.sector,
                      label: entry.sector,
                      hint: `${entry.storesAffected} ${entry.storesAffected === 1 ? 'loja' : 'lojas'}`,
                      value: entry.absences,
                      share: entry.share,
                    }))}
                  />
                  {/* Função sem setor não ganha setor inventado — mas as faltas
                      dela também não podem sumir da conta. */}
                  {analytics.sectors.absencesWithoutSector > 0 && (
                    <p className="panel__hint">
                      {analytics.sectors.absencesWithoutSector} falta(s) vieram de funções
                      sem setor definido e ficam fora deste ranking. Os percentuais usam
                      como base as {analytics.sectors.applicableTotal} faltas de funções
                      com setor.
                    </p>
                  )}
                </section>

                <section className="panel">
                  <h3 className="panel__title">Motivos das faltas</h3>
                  <RankingBars
                    ariaLabel="Distribuição das faltas por motivo"
                    emptyMessage="Nenhum motivo registrado no período."
                    rows={analytics.reasons.map((entry) => ({
                      key: entry.reasonId,
                      label: entry.reasonName,
                      value: entry.quantity,
                      share: entry.share,
                    }))}
                  />
                </section>
              </div>

              {/* --------------------------------------------- dia da semana */}
              <section className="panel">
                <h3 className="panel__title">Faltas por dia da semana</h3>
                {amostraFraca && (
                  <p className="panel__hint">
                    Amostra pequena: o período não repete os dias da semana vezes
                    suficientes para indicar tendência. Leia como contagem, não como padrão.
                  </p>
                )}
                <BarSeries
                  tone="brand"
                  ariaLabel="Faltas acumuladas por dia da semana"
                  points={analytics.weekdays.map((dia) => ({
                    label: dia.label,
                    value: dia.absences,
                    title: `${dia.label}: ${dia.absences} falta(s) em ${dia.sampleDays} dia(s) do período`,
                  }))}
                />
              </section>

              {/* -------------------------------------------------- atenções */}
              <div className="analytics-grid">
                <section className="panel">
                  <h3 className="panel__title">Lojas em atenção</h3>
                  {analytics.storeAttention.length === 0 ? (
                    <p className="ranking__empty">Nada em atenção neste período.</p>
                  ) : (
                    <ul className="attention">
                      {analytics.storeAttention.map((alerta, index) => (
                        <li key={`${alerta.storeId}-${alerta.rule}-${index}`} className="attention__row">
                          <span className="attention__icon" aria-hidden="true">
                            ⚠
                          </span>
                          <span className="attention__body">
                            <button
                              type="button"
                              className="attention__name"
                              onClick={() => openStore(alerta.storeId)}
                            >
                              {alerta.storeName}
                            </button>
                            <span className="attention__msg">{alerta.message}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="panel">
                  <h3 className="panel__title">Funções em atenção</h3>
                  {analytics.positionAttention.length === 0 ? (
                    <p className="ranking__empty">Nada em atenção neste período.</p>
                  ) : (
                    <ul className="attention">
                      {analytics.positionAttention.map((alerta) => (
                        <li key={alerta.positionId} className="attention__row">
                          <span className="attention__icon" aria-hidden="true">
                            ⚠
                          </span>
                          <span className="attention__body">
                            {/* Passou a ser botão na fase 4.2: um alerta que não
                                leva a lugar nenhum obriga o supervisor a
                                procurar a mesma função no ranking ao lado. */}
                            <button
                              type="button"
                              className="attention__name"
                              onClick={() =>
                                openFocus({ kind: 'POSITION', positionId: alerta.positionId })
                              }
                            >
                              {alerta.positionName}
                            </button>
                            <span className="attention__msg">{alerta.message}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/*
        OS DOIS PODEM ESTAR ABERTOS. Quem clica numa loja DENTRO do detalhe de
        uma função espera voltar para a função ao fechar a loja — por isso a
        loja fica por cima, e fechá-la revela o foco atrás.
      */}
      {focusAnalysis && (
        <FocusDrawer
          analysis={focusAnalysis}
          period={period}
          focusPeriodKind={focusPeriodKind}
          onFocusPeriodChange={setFocusPeriodKind}
          onClose={closeFocus}
          onOpenStore={openStore}
        />
      )}

      {storeAnalysis && (
        <StoreAnalysisDrawer
          analysis={storeAnalysis}
          period={period}
          onClose={closeStore}
          onOpenConferences={(date) => {
            closeStore();
            closeFocus();
            onOpenConferences(date);
          }}
        />
      )}
    </main>
  );
}

/** `2,4` — uma casa, ou `—` quando não há base. */
function decimal(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(1).replace('.', ',');
}
