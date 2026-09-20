import type { DistrictOption } from '@/types/analytics';
import type { SessionProfile } from '@/types/auth';
import { BackButton } from '@/components/BackButton';
import { ConferenceDetailDrawer } from '@/components/ConferenceDetailDrawer';
import { DateNavigator } from '@/components/DateNavigator';
import { NetworkSummaryCards } from '@/components/NetworkSummaryCards';
import { NetworkTable } from '@/components/NetworkTable';
import { SearchField } from '@/components/SearchField';
import { useNetworkDay } from '@/hooks/useNetworkDay';
import { NETWORK_FILTERS, NETWORK_FILTER_LABEL } from '@/lib/constants';
import { formatBrTime } from '@/utils/date';

interface Props {
  /** Perfil da sessão — define o alcance da tela. Vem do banco, não da URL. */
  profile: SessionProfile;
  /**
   * Retorna para a home da área gerencial quando a página está na navegação
   * interna.
   */
  onBack?: () => void;
  /**
   * Data inicial. Vem preenchida quando a Visão da Rede manda para cá
   * ("Ver conferências de 05/09/2026"); sem ela a tela abre em D-1.
   */
  initialDate?: string;
}

/**
 * FASE 3A — Conferências do supervisor.
 *
 * Responde, na primeira olhada: quem enviou, quem não enviou, quantas faltas,
 * quantas folgas, a que horas e o que cada loja informou.
 *
 * SOMENTE LEITURA: não há nenhum caminho de escrita nesta tela. Reabertura,
 * edição e exportação são de fases posteriores.
 *
 * ALCANCE (fase 4): a lista já chega recortada pela RLS. O seletor de distrito
 * aparece só quando existe mais de um distrito para escolher — quem enxerga um
 * distrito lê o nome dele, sem um seletor de uma opção.
 */
export function SupervisorConferencesPage({ profile, onBack, initialDate }: Props) {
  const {
    referenceDate,
    summary,
    submittedRows,
    rows,
    totalRows,
    loading,
    error,
    districts,
    districtId,
    districtLocked,
    setDistrictId,
    filter,
    setFilter,
    search,
    setSearch,
    detail,
    openDetail,
    closeDetail,
    changeDate,
    goToPreviousDay,
    goToNextDay,
  } = useNetworkDay(profile, initialDate);

  const listaVaziaPorFiltro = totalRows > 0 && rows.length === 0;

  const distritoAtual = districts.find((item) => item.id === districtId) ?? null;
  const distritoUnico = districts.length === 1;
  const mostrarSeletorDeDistrito = !districtLocked && !distritoUnico && districts.length > 0;
  const distritoFixo = distritoAtual ?? districts[0] ?? null;

  return (
    <main className="page">
      {onBack && <BackButton onClick={onBack} />}

      <div className="page-hero">
        <h2 className="page-hero__title">Conferências do Dia</h2>
        <p className="page-hero__subtitle">
          {districtLocked && distritoAtual
            ? `${distritoAtual.name} · ${profile.name}`
            : `${profile.name} · Acompanhamento diário`}
        </p>
      </div>

      <section className="section">
        <div className="section__head section__head--network">
          <div>
            <h2 className="section__title">Conferências</h2>
            <p className="section__hint">
              O que cada loja enviou no dia. Pendentes aparecem primeiro.
            </p>
          </div>

          <DateNavigator
            value={referenceDate}
            onChange={changeDate}
            onPrevious={goToPreviousDay}
            onNext={goToNextDay}
            disabled={loading}
          />
        </div>

        <div className="section__body">
          {error && (
            <div className="alert alert--error" role="alert">
              {error}
            </div>
          )}

          {summary && <NetworkSummaryCards summary={summary} />}

          <section className="submitted-stores" aria-label="Lojas que já enviaram a conferência">
            <div className="submitted-stores__head">
              <div>
                <p className="submitted-stores__eyebrow">Envios confirmados</p>
                <h3 className="submitted-stores__title">Lojas que já enviaram</h3>
              </div>
              <strong className="submitted-stores__count">
                {submittedRows.length} de {totalRows}
              </strong>
            </div>

            {submittedRows.length === 0 ? (
              <p className="submitted-stores__empty">
                Nenhuma loja enviou a conferência desta data ainda.
              </p>
            ) : (
              <div className="submitted-stores__list">
                {submittedRows.map((row) => (
                  <button
                    key={row.storeId}
                    type="button"
                    className="submitted-stores__item"
                    onClick={() => openDetail(row.storeId)}
                    aria-label={`Ver conferência enviada por ${row.storeName}`}
                  >
                    <span className="submitted-stores__dot" aria-hidden="true" />
                    <span className="submitted-stores__identity">
                      <strong>{row.storeName}</strong>
                      <small>Cód. {row.storeCode}</small>
                    </span>
                    <span className="submitted-stores__time">
                      {formatBrTime(row.submittedAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="network-toolbar">
            {/*
              DISTRITO — opções derivadas das lojas que o banco devolveu. Não há
              contagem escrita no código: o rótulo mostra quantas lojas cada
              distrito tem hoje.
            */}
            {mostrarSeletorDeDistrito && (
              <label className="network-toolbar__field">
                <span>Distrito</span>
                <select
                  value={districtId ?? ''}
                  onChange={(event) => setDistrictId(event.target.value || null)}
                >
                  <option value="">Todos os distritos ({totalRowsLabel(districts)})</option>
                  {districts.map((district) => (
                    <option key={district.id} value={district.id}>
                      {district.name} ({district.storeCount})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!mostrarSeletorDeDistrito && distritoFixo && (
              <p className="network-toolbar__fixed">
                <span>Distrito</span>
                <strong>
                  {distritoFixo.name}
                  {distritoFixo.managerName ? ` · ${distritoFixo.managerName}` : ''}
                </strong>
              </p>
            )}

            <div className="chips" role="group" aria-label="Filtrar conferências">
              {NETWORK_FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`chip${filter === option ? ' chip--on' : ''}`}
                  aria-pressed={filter === option}
                  onClick={() => setFilter(option)}
                >
                  {NETWORK_FILTER_LABEL[option]}
                </button>
              ))}
            </div>

            <SearchField value={search} onChange={setSearch} placeholder="Buscar loja..." />
          </div>

          {loading ? (
            <p className="state">Carregando as conferências do dia...</p>
          ) : (
            <NetworkTable
              rows={rows}
              onOpenDetail={openDetail}
              emptyMessage={
                listaVaziaPorFiltro
                  ? 'Nenhuma loja atende a esse filtro nesta data.'
                  : 'Nenhuma loja cadastrada com acesso para o seu perfil.'
              }
            />
          )}
        </div>
      </section>

      {detail && <ConferenceDetailDrawer detail={detail} onClose={closeDetail} />}
    </main>
  );
}

/** Soma as lojas de todos os distritos — calculada, nunca escrita. */
function totalRowsLabel(districts: DistrictOption[]): number {
  return districts.reduce((total, district) => total + district.storeCount, 0);
}
