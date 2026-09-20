/** Utilitários de texto (busca sem acento, normalização de observação). */

export function stripAccents(value: string): string {
  // ̀-ͯ = marcas diacríticas combinantes geradas pelo NFD.
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Normaliza para comparação de busca: sem acento, minúsculo, espaços colapsados. */
export function normalizeForSearch(value: string): string {
  return stripAccents(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Retorna true quando todos os termos da busca aparecem no texto. */
export function matchesSearch(haystack: string, query: string): boolean {
  const normalizedQuery = normalizeForSearch(query);
  if (normalizedQuery === '') return true;
  const normalizedHaystack = normalizeForSearch(haystack);
  return normalizedQuery
    .split(' ')
    .every((term) => normalizedHaystack.includes(term));
}

/**
 * TEXTO DURANTE A DIGITAÇÃO — preserva exatamente o que foi digitado.
 *
 * É o ÚNICO tratamento que pode rodar no `onChange` de um campo controlado.
 * Mantém espaços internos, o espaço temporário no fim da palavra, acentos,
 * pontuação e quebras de linha. Só o texto totalmente vazio vira `null`,
 * porque aí não há nada para preservar (e a coluna do banco é nullable).
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * Antes, o `onChange` chamava `normalizeObservation`, que faz `trim()`.
 * Como o textarea é controlado (`value={item.observation ?? ''}`), o React
 * reescrevia o campo já sem o espaço a cada tecla: digitar
 * "Afastamento funcionário" era impossível — o espaço sumia no instante em que
 * era digitado e a segunda palavra nunca começava.
 *
 * REGRA: `trim()` só na validação final e imediatamente antes de persistir.
 */
export function keepAsTyped(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value === '' ? null : value;
}

/**
 * TEXTO NA HORA DE GRAVAR/VALIDAR — vazio ou só espaços vira null.
 *
 * NÃO use no `onChange` de campo controlado. Ver `keepAsTyped` acima.
 */
export function normalizeObservation(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** True quando sobra conteúdo real depois do trim (só espaços não conta). */
export function hasText(value: string | null | undefined): boolean {
  return normalizeObservation(value) !== null;
}
