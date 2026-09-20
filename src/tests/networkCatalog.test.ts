/**
 * FASE 4 — A REDE OFICIAL: 34 lojas, 2 distritos.
 *
 * O ponto destes testes NÃO é conferir 34 nomes na mão. É garantir que as
 * TRÊS cópias da rede não se separem:
 *
 *   scripts/build_network.py            o gerador (fonte única)
 *   src/data/network.ts                 o que o navegador usa no login
 *   supabase/migrations/0016_seed_network.sql   o que o banco recebe
 *
 * As duas últimas são GERADAS pela primeira. Se alguém editar uma à mão, a
 * comparação abaixo quebra — que é exatamente o defeito que queremos impedir:
 * uma loja existir no seletor de login e não existir no banco (ou o contrário).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISTRICTS,
  NETWORK_STORES,
  getDistrict,
  storeLabel,
  storesOfDistrict,
} from '@/data/network';

const RAIZ = resolve(__dirname, '../..');
const SEED_SQL = readFileSync(resolve(RAIZ, 'supabase/migrations/0016_seed_network.sql'), 'utf8');

/** Contagens LIDAS da lista, nunca escritas: se a rede crescer, elas crescem. */
const TOTAL = NETWORK_STORES.length;
const POR_DISTRITO = new Map(
  DISTRICTS.map((district) => [
    district.id,
    NETWORK_STORES.filter((store) => store.districtId === district.id).length,
  ]),
);

describe('Rede oficial — catálogo', () => {
  // TESTE 1
  it('1. tem exatamente 34 lojas', () => {
    expect(TOTAL).toBe(34);
  });

  // TESTE 2
  it('2. tem exatamente 2 distritos, ambos ativos', () => {
    expect(DISTRICTS).toHaveLength(2);
    expect(DISTRICTS.every((district) => district.active)).toBe(true);
  });

  // TESTE 3
  it('3. o Distrito 1 tem 20 lojas e o Distrito 2 tem 14', () => {
    expect(POR_DISTRITO.get('district-1')).toBe(20);
    expect(POR_DISTRITO.get('district-2')).toBe(14);
    // E a soma fecha: nenhuma loja ficou fora de distrito.
    expect(POR_DISTRITO.get('district-1')! + POR_DISTRITO.get('district-2')!).toBe(TOTAL);
  });

  // TESTE 4
  it('4. toda loja pertence a um distrito que existe', () => {
    for (const store of NETWORK_STORES) {
      expect(
        getDistrict(store.districtId),
        `loja ${store.code} aponta para distrito inexistente: ${store.districtId}`,
      ).toBeDefined();
    }
  });

  // TESTE 5
  it('5. não há código de loja repetido', () => {
    const codigos = NETWORK_STORES.map((store) => store.code);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  // TESTE 6
  it('6. não há id de loja repetido e o id deriva do código', () => {
    const ids = NETWORK_STORES.map((store) => store.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const store of NETWORK_STORES) {
      expect(store.id).toBe(`store-${store.code}`);
    }
  });

  // TESTE 7 — a loja que já estava em produção antes da fase 4.
  it('7. a loja 124 continua na rede, no Distrito 1, com o nome por extenso', () => {
    const parque = NETWORK_STORES.find((store) => store.code === '124');
    expect(parque).toBeDefined();
    expect(parque!.id).toBe('store-124');
    expect(parque!.name).toBe('PQSHOP');
    expect(parque!.fullName).toBe('PARQUE SHOPPING');
    expect(parque!.districtId).toBe('district-1');
  });

  // TESTE 8
  it('8. LEPARC (307) é do Distrito 1 e PANAMBY (311) é do Distrito 2', () => {
    const leparc = NETWORK_STORES.find((store) => store.code === '307');
    const panamby = NETWORK_STORES.find((store) => store.code === '311');

    expect(leparc?.districtId).toBe('district-1');
    expect(panamby?.districtId).toBe('district-2');
  });

  // TESTE 9
  it('9. `storesOfDistrict` devolve só as lojas do distrito pedido', () => {
    const d1 = storesOfDistrict('district-1');
    const d2 = storesOfDistrict('district-2');

    expect(d1).toHaveLength(POR_DISTRITO.get('district-1')!);
    expect(d2).toHaveLength(POR_DISTRITO.get('district-2')!);
    expect(d1.every((store) => store.districtId === 'district-1')).toBe(true);
    expect(d2.every((store) => store.districtId === 'district-2')).toBe(true);

    // Nenhuma loja aparece nos dois.
    const idsD2 = new Set(d2.map((store) => store.id));
    expect(d1.some((store) => idsD2.has(store.id))).toBe(false);
  });

  // TESTE 10
  it('10. `storesOfDistrict(null)` devolve a rede inteira', () => {
    expect(storesOfDistrict(null)).toHaveLength(TOTAL);
  });

  // TESTE 11
  it('11. o rótulo é sempre "código - nome"', () => {
    const leparc = NETWORK_STORES.find((store) => store.code === '307')!;
    expect(storeLabel(leparc)).toBe('307 - LEPARC');
  });

  /* -----------------------------------------------------------------------
   * A PARIDADE com o SQL — o ponto principal deste arquivo.
   * -------------------------------------------------------------------- */

  // TESTE 12
  it('12. o seed SQL insere exatamente as mesmas 34 lojas do módulo TS', () => {
    // Linhas do INSERT: ('store-307', '307', 'LEPARC', 'LE PARC', 'district-1')
    const noSql = new Set(
      [...SEED_SQL.matchAll(/\(\s*'(store-[^']+)'\s*,\s*'([^']+)'\s*,/g)].map(
        (match) => `${match[1]}|${match[2]}`,
      ),
    );
    const noTs = new Set(NETWORK_STORES.map((store) => `${store.id}|${store.code}`));

    expect(noSql.size).toBe(TOTAL);
    expect([...noTs].filter((chave) => !noSql.has(chave))).toEqual([]);
    expect([...noSql].filter((chave) => !noTs.has(chave))).toEqual([]);
  });

  // TESTE 13
  it('13. o seed SQL declara os mesmos 2 distritos', () => {
    for (const district of DISTRICTS) {
      expect(SEED_SQL).toContain(`'${district.id}'`);
      expect(SEED_SQL).toContain(`'${district.name}'`);
    }
  });

  // TESTE 14 — o gerador escreve SQL só com ASCII, de propósito.
  //
  // Não é preciosismo: a fase 2 perdeu acentos em produção porque um arquivo
  // UTF-8 foi lido como Latin-1 no caminho até o banco. Migration sem byte
  // acima de 127 não tem como sofrer isso.
  it('14. o seed SQL é ASCII puro — nada de mojibake no caminho até o banco', () => {
    const forasteiros = [...SEED_SQL].filter((letra) => letra.charCodeAt(0) > 127);
    expect(forasteiros).toEqual([]);
  });

  // TESTE 15 — a rede nunca some por descuido.
  it('15. o seed confere as contagens dentro do próprio banco', () => {
    // O arquivo termina com um bloco que levanta exceção se a contagem não
    // fechar: o banco recusa um seed pela metade em vez de ficar incompleto.
    expect(SEED_SQL).toMatch(/raise exception/i);
    expect(SEED_SQL).toContain('34');
    expect(SEED_SQL).toContain('20');
    expect(SEED_SQL).toContain('14');
  });
});
