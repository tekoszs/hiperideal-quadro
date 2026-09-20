interface Props {
  onClick: () => void;
}

export function BackButton({ onClick }: Props) {
  return (
    <button type="button" className="btn btn--ghost btn--sm back-button" onClick={onClick}>
      ← Voltar
    </button>
  );
}
