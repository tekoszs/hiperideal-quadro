/** Utilitários numéricos das contagens de falta/folga. */

/**
 * Normaliza qualquer entrada do usuário para um inteiro >= 0.
 * Valores negativos, decimais, NaN, vazio ou texto viram 0 ou o inteiro válido.
 * É a única porta de entrada de números na conferência — impede valor negativo.
 */
export function toNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return fallback;
    const digitsOnly = trimmed.replace(/[^\d-]/g, '');
    const parsed = Number.parseInt(digitsOnly, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(0, parsed);
  }

  return fallback;
}

/** Soma segura de uma lista de números. */
export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Pluralização simples em português. */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
