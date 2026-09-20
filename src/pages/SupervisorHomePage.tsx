import type { SessionProfile } from '@/types/auth';
import { getDistrict } from '@/data/network';

interface Props {
  profile: SessionProfile;
  /** Abre a Visão da Rede (fase 3B). */
  onOpenNetwork: () => void;
  /** Abre a área Conferências (fase 3A). */
  onOpenConferences: () => void;
  /** Abre a apresentação da área administrativa. */
  onOpenAdministration: () => void;
}

/**
 * Home do supervisor.
 *
 * As duas áreas já são funcionais: VISÃO DA REDE (consolidado analítico do
 * período) e CONFERÊNCIAS (o dia a dia de quem enviou). Administração de
 * lojas e usuários continua para uma fase posterior.
 */
export function SupervisorHomePage({
  profile,
  onOpenNetwork,
  onOpenConferences,
  onOpenAdministration,
}: Props) {
  const isAdmin = profile.role === 'ADMIN';
  const distrito = getDistrict(profile.districtId);
  const escopoDistrital = profile.accessScope === 'DISTRICT';

  // Título e rótulo mudam com o ESCOPO, não com o cargo digitado: o cargo é
  // texto livre e não pode mandar em nada.
  const titulo = isAdmin
    ? 'Administração | Conferência de Quadro'
    : escopoDistrital
      ? 'Painel do Gerente Distrital'
      : 'Painel Gerencial da Rede';

  const alcance = escopoDistrital
    ? (distrito?.name ?? 'Distrito')
    : 'Todas as lojas da rede';

  return (
    <main className="page">
      <div className="page-hero">
        <h2 className="page-hero__title">{titulo}</h2>
        <p className="page-hero__subtitle">
          {profile.name}
          {profile.jobTitle ? ` · ${profile.jobTitle}` : ''}
          {' · '}
          {alcance}
          {escopoDistrital && distrito?.managerName ? ` · ${distrito.managerName}` : ''}
        </p>
      </div>

      <section className="section">
        <div className="section__head">
          <div>
            <h2 className="section__title">Áreas</h2>
          </div>
        </div>

        <div className="section__body">
          <div className="home-grid">
            <button
              type="button"
              className="home-card home-card--action"
              onClick={onOpenNetwork}
            >
              <h3 className="home-card__title">
                {escopoDistrital ? 'Visão do Distrito' : 'Visão da Rede'}
              </h3>
              <p className="home-card__text">
                Consolidado por período: faltas, folgas, ranking de lojas e funções,
                setores, motivos, evolução e pontos de atenção
                {escopoDistrital && distrito ? ` do ${distrito.name}` : ' da rede'}.
              </p>
              <span className="badge badge--success">Abrir</span>
            </button>

            <button
              type="button"
              className="home-card home-card--action"
              onClick={onOpenConferences}
            >
              <h3 className="home-card__title">Conferências</h3>
              <p className="home-card__text">
                Acompanhamento diário do que cada loja enviou: quem enviou, quem
                está pendente, faltas, folgas e o detalhe por função.
              </p>
              <span className="badge badge--success">Abrir</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                className="home-card home-card--action"
                onClick={onOpenAdministration}
              >
                <h3 className="home-card__title">Administração</h3>
                <p className="home-card__text">
                  Lojas, funções e usuários da rede.
                </p>
                <span className="badge badge--success">Abrir</span>
              </button>
            )}
          </div>

          <p className="section__hint" style={{ marginTop: 20 }}>
            {escopoDistrital
              ? `Seu perfil tem acesso de leitura às lojas do ${distrito?.name ?? 'seu distrito'}.`
              : 'Seu perfil tem acesso de leitura a todas as lojas da rede.'}{' '}
            Nenhuma destas telas edita conferência.
          </p>
        </div>
      </section>
    </main>
  );
}
