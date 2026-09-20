interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchField({ value, onChange, placeholder = 'Buscar função...' }: Props) {
  return (
    <div className="search">
      <span className="search__icon" aria-hidden="true">
        ⌕
      </span>
      <input
        className="search__input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label="Buscar função"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
