interface Props {
  email: string | null;
  error: string | null;
}

/**
 * Autenticado no Supabase, mas sem registro ativo em `profiles`.
 *
 * É o comportamento correto: sem perfil, a RLS não libera nada. Quem cria o
 * perfil é o administrador (veja docs/SEGURANCA-RLS.md).
 */
export function NoProfilePage({ email, error }: Props) {
  return (
    <main className="page">
      <section className="section">
        <div className="section__head">
          <div>
            <h2 className="section__title">Acesso não liberado</h2>
            <p className="section__hint">{email ?? 'Usuário autenticado'}</p>
          </div>
        </div>
        <div className="section__body">
          <div className="alert alert--warning">
            Seu login funcionou, mas este usuário ainda não tem um perfil ativo no
            sistema. Peça ao administrador para vincular seu usuário a uma loja e
            a um perfil de acesso.
          </div>
          {error && (
            <p className="field__hint" style={{ marginTop: 12 }}>
              Detalhe técnico: {error}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
