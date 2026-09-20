import { BackButton } from '@/components/BackButton';
import type { SessionProfile } from '@/types/auth';

interface Props {
  profile: SessionProfile;
  onBack: () => void;
}

export function SupervisorAdministrationPage({ profile, onBack }: Props) {
  return (
    <main className="page">
      <BackButton onClick={onBack} />

      <div className="page-hero">
        <h2 className="page-hero__title">Administração | Conferência de Quadro</h2>
        <p className="page-hero__subtitle">{profile.name} · Área administrativa</p>
      </div>

      <section className="section">
        <div className="section__head">
          <div>
            <h2 className="section__title">Administração</h2>
            <p className="section__hint">Lojas, funções e usuários da rede.</p>
          </div>
        </div>

        <div className="section__body">
          <div className="empty-state">
            <p className="empty-state__title">Recursos administrativos em breve.</p>
            <p className="empty-state__text">
              Esta área ainda não possui operações disponíveis.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
