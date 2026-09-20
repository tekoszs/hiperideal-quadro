import { useCallback, useEffect, useState } from 'react';
import { ConferenceHeading } from '@/components/ConferenceHeading';
import { ConfirmSubmitModal } from '@/components/ConfirmSubmitModal';
import { PendingJustificationsPanel } from '@/components/PendingJustificationsPanel';
import { ResolveJustificationModal } from '@/components/ResolveJustificationModal';
import { HistorySection } from '@/components/HistorySection';
import { PositionList } from '@/components/PositionList';
import { ReferenceDateBar } from '@/components/ReferenceDateBar';
import { SearchField } from '@/components/SearchField';
import { SummaryCards } from '@/components/SummaryCards';
import { ValidationSummary } from '@/components/ValidationSummary';
import { useCatalog } from '@/hooks/useCatalog';
import { useConferenceDates } from '@/hooks/useConferenceDates';
import { useDailyConference } from '@/hooks/useDailyConference';
import { getStorageName, resolvePendingReason } from '@/services/conferenceService';
import { formatBrDate, formatBrTime, formatLongBrDate, weekdayName } from '@/utils/date';
import { conferenceViewState, CONFERENCE_STATUS_WORD } from '@/domain/conferenceStatusView';
import type { PendingJustification } from '@/domain/pendingJustification';
import type { ReferenceDateInfo, ReferenceDateStatus } from '@/domain/referenceWindow';
import type { SessionProfile } from '@/types/auth';
import type { Store } from '@/types/domain';

interface Props {
  profile: SessionProfile;
  /** Avisa o App qual loja carregou, para o cabeçalho exibir. */
  onStoreLoaded?: (store: Store | null) => void;
}

/** O que mostrar depois de um envio bem-sucedido. */
interface EnvioConcluido {
  date: string;
  next: ReferenceDateInfo | null;
}

/**
 * Tela do GERENTE — conferência POR DATA DE REFERÊNCIA.
 *
 * A página só orquestra componentes e hooks; nenhuma regra de negócio mora
 * aqui. A loja vem do PERFIL: o gerente não escolhe loja.
 *
 * A DATA, sim, ele escolhe (fase 4.3): a tela abre na pendência mais antiga,
 * oferece a janela como chips e, depois de cada envio, aponta a próxima
 * pendência. A fase 4.4 não mexeu em nada disso — só na forma de mostrar.
 */
export function ManagerConferencePage({ profile, onStoreLoaded }: Props) {
  const catalog = useCatalog(profile.storeId);
  const [search, setSearch] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** O envio recém-concluído e a pendência seguinte. Some ao trocar de data. */
  const [envio, setEnvio] = useState<EnvioConcluido | null>(null);
  /** A pendência de justificativa aberta no modal, ou null. */
  const [resolvendo, setResolvendo] = useState<PendingJustification | null>(null);
  const [resolvendoSalvando, setResolvendoSalvando] = useState(false);
  const [resolvendoErro, setResolvendoErro] = useState<string | null>(null);

  const datas = useConferenceDates({ storeId: catalog.store?.id ?? null });

  const {
    conference,
    summary,
    issues,
    pendingPositionIds,
    feedback,
    loading,
    saving,
    dirty,
    lastSavedAt,
    editable,
    actions,
    saveDraft,
    validateForSubmit,
    submit,
  } = useDailyConference({
    storeId: catalog.store?.id ?? null,
    referenceDate: datas.referenceDate,
    positions: catalog.positions,
    reasons: catalog.reasons,
    createdBy: profile.id,
    // Gravou? A lista de pendências tem de refletir isso na hora.
    onPersisted: datas.refresh,
    readOnly: datas.isReadOnlyMonth,
  });

  useEffect(() => {
    onStoreLoaded?.(catalog.store);
  }, [catalog.store, onStoreLoaded]);

  const escolherData = useCallback(
    (date: string) => {
      setEnvio(null);
      setSearch('');
      datas.selectDate(date);
    },
    [datas],
  );

  /**
   * Confirma a troca do motivo provisório por um definitivo.
   *
   * A conferência NÃO é reaberta: quem faz o trabalho é a RPC, numa transação
   * só. Aqui a tela apenas recarrega as pendências depois — se a resolução
   * falhar, o modal continua aberto com o erro, e nada mudou.
   */
  const confirmarResolucao = async (params: {
    toReasonId: string;
    quantity: number;
    observation: string | null;
  }) => {
    if (!resolvendo) return;
    setResolvendoSalvando(true);
    setResolvendoErro(null);
    try {
      await resolvePendingReason({ itemId: resolvendo.itemId, ...params });
      await datas.refresh();
      setResolvendo(null);
    } catch (cause) {
      setResolvendoErro(
        cause instanceof Error ? cause.message : 'Falha ao resolver a justificativa.',
      );
    } finally {
      setResolvendoSalvando(false);
    }
  };

  const handleFinish = () => {
    if (validateForSubmit()) setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    const enviada = datas.referenceDate;
    const sent = await submit();
    if (!sent) return;
    setConfirmOpen(false);
    // Calculado ANTES do refresh: a lista ainda não sabe que esta foi enviada,
    // e `nextAfter` já ignora a própria data.
    setEnvio(enviada ? { date: enviada, next: datas.nextAfter(enviada) } : null);
  };

  if (catalog.error) {
    return (
      <main className="page">
        <div className="alert alert--error">{catalog.error}</div>
      </main>
    );
  }

  const carregando =
    catalog.loading || !datas.ready || loading || !conference || !summary;

  /**
   * O status que o título anuncia.
   *
   * Sai da JANELA (o que está gravado), não do objeto em memória: uma
   * conferência recém-criada já nasce `DRAFT` mesmo sem nunca ter sido salva, e
   * o título diria "Rascunho salvo" sobre uma tela em branco. A exceção são os
   * estados que o próprio envio acabou de produzir, que valem na hora — sem
   * esperar o histórico recarregar.
   */
  const statusGravado: ReferenceDateStatus = !conference
    ? 'MISSING'
    : conference.status === 'SUBMITTED' || conference.status === 'REOPENED'
      ? conference.status
      : (datas.dates.find((info) => info.date === conference.referenceDate)?.status ??
        'MISSING');

  /*
   * FASE 4.5 — o pré-registro é uma LEITURA, não um status.
   *
   * `PRE_REGISTRATION` não existe em `quadro_conference_status`: no banco isso
   * é um DRAFT como qualquer outro, com o mesmo id. A virada do dia acontece
   * sozinha — amanhã a mesma linha simplesmente deixa de ser "hoje" e a tela
   * passa a chamá-la de rascunho, sem copiar dado nem criar conferência nova.
   */
  const estadoDoTitulo = conferenceViewState(statusGravado, datas.isPreRegistration);

  return (
    <>
      <main className="page">
        {!carregando && catalog.store && conference && (
          <div className="page-hero">
            <h2 className="page-hero__title">Conferência Diária de Quadro</h2>
            <p className="page-hero__subtitle">
              {catalog.store.name} · Código {catalog.store.code}
            </p>
            <div className="page-hero__meta">
              <span className="page-hero__meta-item">
                {formatLongBrDate(conference.referenceDate)}
              </span>
              <span className={`page-hero__badge page-hero__badge--${estadoDoTitulo === 'SUBMITTED' ? 'submitted' : 'draft'}`}>
                {CONFERENCE_STATUS_WORD[estadoDoTitulo]}
              </span>
            </div>
          </div>
        )}

        {carregando ? (
          <p className="state">Carregando conferência...</p>
        ) : (
          <>
            <ConferenceHeading
              referenceDate={conference.referenceDate}
              state={estadoDoTitulo}
              submittedAt={conference.submittedAt}
            />

            <ReferenceDateBar
              dates={datas.dates}
              pending={datas.pending}
              selected={conference.referenceDate}
              bounds={datas.bounds}
              disabled={saving}
              onSelect={escolherData}
              today={datas.today}
              preRegistration={datas.isPreRegistration}
              month={datas.month}
              onMonthChange={datas.selectMonth}
            />

            {/*
              As faltas que já foram enviadas e ainda esperam um documento.
              Ficam ACIMA da lista de funções porque são trabalho pendente do
              gerente, não histórico.
            */}
            <PendingJustificationsPanel
              pendings={datas.pendingJustifications}
              positions={catalog.positions}
              disabled={saving || resolvendoSalvando}
              onResolve={(pendencia) => {
                setResolvendoErro(null);
                setResolvendo(pendencia);
              }}
            />

            {/*
              O momento que faz a segunda-feira funcionar: acabou de enviar o
              sábado, e o domingo continua pendente. Sem isto o gerente teria de
              lembrar sozinho de voltar e trocar a data.
            */}
            {envio && (
              <div className="sent" role="status">
                <p className="sent__title">
                  <span className="sent__check" aria-hidden="true">
                    ✓
                  </span>
                  Conferência enviada com sucesso
                </p>

                {envio.next && (
                  <div className="sent__next">
                    <div className="sent__next-info">
                      <span className="sent__next-label">Próxima conferência pendente</span>
                      <span className="sent__next-date">{formatBrDate(envio.next.date)}</span>
                      <span className="sent__next-weekday">
                        {weekdayName(envio.next.date)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => escolherData(envio.next!.date)}
                    >
                      Ir para próxima pendência
                    </button>
                  </div>
                )}
              </div>
            )}

            <SummaryCards summary={summary} />

            {feedback && (
              <div className={`alert alert--${feedback.tone}`} role="status">
                {feedback.message}
              </div>
            )}

            <ValidationSummary issues={issues} />

            <section className="section">
              <div className="section__head">
                <div>
                  <h2 className="section__title">Funções da loja</h2>
                  <p className="section__hint">
                    {catalog.positions.length} funções · faltas e folgas começam em zero
                  </p>
                </div>
                <SearchField value={search} onChange={setSearch} />
              </div>

              <div className="section__body">
                <PositionList
                  positions={catalog.positions}
                  items={conference.items}
                  reasons={catalog.reasons}
                  disabled={!editable}
                  search={search}
                  pendingPositionIds={pendingPositionIds}
                  onChangeAbsence={actions.changeAbsence}
                  onChangeDayOff={actions.changeDayOff}
                  onChangeReasonQuantity={actions.changeReasonQuantity}
                  onChangeReasonObservation={actions.changeReasonObservation}
                  onChangeObservation={actions.changeItemObservation}
                />
              </div>
            </section>

            {editable && (
              <div className="actions">
                {/*
                  Salvamento é informação de canto de tela: quem está preenchendo
                  não pode ser interrompido por modal nem por faixa colorida.
                */}
                <span
                  className={`actions__status${dirty ? ' actions__status--dirty' : ''}`}
                  role="status"
                >
                  {saving
                    ? 'Salvando...'
                    : dirty
                      ? 'Alterações não salvas'
                      : lastSavedAt
                        ? `Rascunho salvo às ${formatBrTime(lastSavedAt)}`
                        : 'Tudo salvo'}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => void saveDraft()}
                  disabled={saving}
                >
                  Salvar rascunho
                </button>
                {/*
                  FASE 4.5 — no pré-registro NÃO existe botão de enviar.
                  Escondê-lo é mais honesto que desabilitá-lo: um botão cinza
                  faz o gerente tentar, falhar e procurar o que está errado. A
                  frase abaixo diz o que acontece em vez disso.
                */}
                {datas.isPreRegistration ? (
                  <span className="actions__note">
                    O pré-registro é salvo, não enviado. A conferência de{' '}
                    {formatBrDate(conference.referenceDate)} poderá ser enviada a partir
                    de amanhã.
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleFinish}
                    disabled={saving}
                  >
                    Finalizar conferência
                  </button>
                )}
              </div>
            )}

            <HistorySection entries={datas.history} />

            <ConfirmSubmitModal
              open={confirmOpen}
              store={catalog.store}
              conference={conference}
              summary={summary}
              positions={catalog.positions}
              reasons={catalog.reasons}
              sending={saving}
              onCancel={() => setConfirmOpen(false)}
              onConfirm={() => void handleConfirm()}
            />

            <ResolveJustificationModal
              pending={resolvendo}
              store={catalog.store}
              positions={catalog.positions}
              saving={resolvendoSalvando}
              error={resolvendoErro}
              onCancel={() => setResolvendo(null)}
              onConfirm={(params) => void confirmarResolucao(params)}
            />
          </>
        )}
      </main>

      <footer className="app-footer">Persistência ativa: {getStorageName()}</footer>
    </>
  );
}
