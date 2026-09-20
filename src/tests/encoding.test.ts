import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABSENCE_REASONS, getActiveReasons } from '@/data/absenceReasons';
import { POSITIONS, STORES } from '@/data/catalog';

/**
 * REGRESSÃO — os motivos apareceram corrompidos na tela do Supabase real:
 *
 *   "Atestado mÃ©dico"  em vez de  "Atestado médico"
 *
 * CAUSA: texto UTF-8 que passou por uma etapa que o leu como Latin-1/CP1252.
 * O byte 0xC3 0xA9 (é) vira os dois caracteres Ã (U+00C3) e © (U+00A9).
 *
 * Estes testes travam as duas pontas:
 *  - os arquivos-fonte deste projeto continuam em UTF-8 correto;
 *  - nenhum texto oficial tem o padrão de mojibake.
 */

/**
 * Detector de mojibake — o MESMO critério do SQL de auditoria.
 *
 * U+00C2/U+00C3 seguido de um byte de continuação reinterpretado
 * (U+0080..U+00BF), ou o losango de substituição U+FFFD.
 *
 * Não dá falso positivo em português legítimo: em "SÃO", o Ã é seguido de
 * "O" (U+004F), que está fora da faixa.
 */
const MOJIBAKE = /[ÂÃ][-¿]|�/;

const MOTIVOS_OFICIAIS = [
  'Atestado médico',
  'Falta injustificada',
  'Ausência justificada',
  'Declaração / comparecimento',
  'Afastamento',
  'Licença',
  'Suspensão',
  'Outros',
  // Fase 4.5 — o motivo provisório. Sem acento, mas entra na lista oficial
  // pelo mesmo motivo dos outros: o que a tela mostra tem de ser o que o banco
  // guarda, letra por letra.
  'Aguardando justificativa',
];

describe('O detector de mojibake funciona', () => {
  it('acusa texto corrompido de verdade', () => {
    expect(MOJIBAKE.test('Atestado mÃ©dico')).toBe(true);
    expect(MOJIBAKE.test('AusÃªncia justificada')).toBe(true);
    expect(MOJIBAKE.test('DeclaraÃ§Ã£o / comparecimento')).toBe(true);
    expect(MOJIBAKE.test('LicenÃ§a')).toBe(true);
    expect(MOJIBAKE.test('SuspensÃ£o')).toBe(true);
    expect(MOJIBAKE.test('REFEITÃRIO')).toBe(true);
  });

  it('NÃO acusa português legítimo (sem falso positivo)', () => {
    for (const texto of [
      'Atestado médico',
      'Declaração / comparecimento',
      'SÃO PAULO',
      'AVALIAÇÃO',
      'REFEITÓRIO',
      'AUX. DE COZINHA - REFEITÓRIO',
    ]) {
      expect(MOJIBAKE.test(texto), texto).toBe(false);
    }
  });

  it('reproduz a corrupção exatamente como aconteceu (UTF-8 lido como Latin-1)', () => {
    const utf8 = Buffer.from('Atestado médico', 'utf8');
    const lidoComoLatin1 = utf8.toString('latin1');

    expect(lidoComoLatin1).toBe('Atestado mÃ©dico');
    expect(MOJIBAKE.test(lidoComoLatin1)).toBe(true);
  });
});

// TESTE 10 e 11
describe('Motivos de falta em UTF-8 correto', () => {
  it('os motivos oficiais estão escritos com acento de verdade', () => {
    expect(ABSENCE_REASONS.map((reason) => reason.name)).toEqual(MOTIVOS_OFICIAIS);
  });

  it('nenhum motivo tem mojibake', () => {
    for (const reason of ABSENCE_REASONS) {
      expect(MOJIBAKE.test(reason.name), reason.name).toBe(false);
    }
  });

  it('os motivos exibidos na tela (getActiveReasons) também estão limpos', () => {
    const exibidos = getActiveReasons();
    expect(exibidos).toHaveLength(MOTIVOS_OFICIAIS.length);
    for (const reason of exibidos) {
      expect(MOJIBAKE.test(reason.name), reason.name).toBe(false);
    }
    expect(exibidos.map((r) => r.name)).toContain('Atestado médico');
    expect(exibidos.map((r) => r.name)).toContain('Suspensão');
    expect(exibidos.map((r) => r.name)).toContain('Aguardando justificativa');
  });

  it('FOLGA continua fora dos motivos de falta', () => {
    expect(ABSENCE_REASONS.some((r) => /folga/i.test(r.name))).toBe(false);
  });
});

describe('Catálogo de lojas e funções em UTF-8 correto', () => {
  it('nenhuma função ou setor tem mojibake', () => {
    for (const position of POSITIONS) {
      expect(MOJIBAKE.test(position.name), position.name).toBe(false);
      if (position.sector) {
        expect(MOJIBAKE.test(position.sector), position.sector).toBe(false);
      }
    }
  });

  it('REFEITÓRIO — o único texto acentuado do catálogo — está correto', () => {
    const refeitorio = POSITIONS.find((p) => p.id === 'pos-aux-de-cozinha-refeitorio');
    expect(refeitorio?.name).toBe('AUX. DE COZINHA - REFEITÓRIO');
    expect(refeitorio?.sector).toBe('REFEITÓRIO');
  });

  it('nenhuma loja tem mojibake', () => {
    for (const store of STORES) {
      expect(MOJIBAKE.test(store.name), store.name).toBe(false);
    }
  });
});

describe('Arquivos SQL entregues ao Supabase', () => {
  const SQL = [
    'supabase/install.sql',
    'supabase/schema.sql',
    'supabase/seed.sql',
    'supabase/migrations/0012_seed_absence_reasons.sql',
    'supabase/migrations/0018_pending_reason_resolution.sql',
  ].map((path) => ({ path, sql: readFileSync(path, 'utf8') }));

  it('nenhum arquivo SQL contém mojibake', () => {
    for (const { path, sql } of SQL) {
      expect(MOJIBAKE.test(sql), `${path} contém texto corrompido`).toBe(false);
    }
  });

  /**
   * O motivo tem de existir NO BANCO, não só no frontend — e é a migration que
   * o coloca lá. Os oito primeiros vieram na 0012; "Aguardando justificativa"
   * veio na 0018. Este teste lê as duas: se alguém adicionar um motivo só no
   * TypeScript, ele acusa.
   */
  it('todo motivo exibido na tela é semeado por alguma migration', () => {
    const seeds = [
      'supabase/migrations/0012_seed_absence_reasons.sql',
      'supabase/migrations/0018_pending_reason_resolution.sql',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    for (const nome of MOTIVOS_OFICIAIS) {
      expect(seeds, `nenhuma migration semeia "${nome}"`).toContain(nome);
    }

    // E o id também: o nome pode ser reescrito, o id é o que amarra os dados.
    for (const reason of getActiveReasons()) {
      expect(seeds, `nenhuma migration semeia o id "${reason.id}"`).toContain(reason.id);
    }
  });
});

/**
 * Os scripts de `supabase/fixes/` são colados no SQL Editor pelo navegador.
 * Se eles próprios tiverem byte acentuado, podem se corromper no caminho —
 * que foi a origem do problema. Por isso são gerados 100% em ASCII, com os
 * acentos escritos como escapes Unicode que o PostgreSQL resolve na hora.
 */
describe('Scripts de correção são imunes a encoding', () => {
  const DIR = 'supabase/fixes';
  const arquivos = readdirSync(DIR).filter((nome) => nome.endsWith('.sql'));

  it('existem os três scripts (auditoria + as duas correções)', () => {
    expect(arquivos.sort()).toEqual([
      '000_auditoria_mojibake.sql',
      '001_fix_quadro_absence_reasons_utf8.sql',
      '002_fix_quadro_positions_utf8.sql',
    ]);
  });

  it('todos são 100% ASCII', () => {
    for (const nome of arquivos) {
      const bytes = readFileSync(`${DIR}/${nome}`);
      const naoAscii = [...bytes].filter((byte) => byte > 127);
      expect(naoAscii, `${nome} tem ${naoAscii.length} byte(s) não-ASCII`).toHaveLength(0);
    }
  });

  it('a correção 001 mexe SOMENTE em quadro_absence_reasons', () => {
    const sql = readFileSync(`${DIR}/001_fix_quadro_absence_reasons_utf8.sql`, 'utf8');
    const alvos = [...sql.matchAll(/update\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]);

    expect(alvos).not.toHaveLength(0);
    expect(new Set(alvos)).toEqual(new Set(['quadro_absence_reasons']));
    // Nada de estrutura nem de exclusão.
    expect(sql).not.toMatch(/\b(drop|alter|truncate|delete)\b/i);
  });

  it('a correção 002 mexe SOMENTE em quadro_positions', () => {
    const sql = readFileSync(`${DIR}/002_fix_quadro_positions_utf8.sql`, 'utf8');
    const alvos = [...sql.matchAll(/update\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]);

    expect(new Set(alvos)).toEqual(new Set(['quadro_positions']));
    expect(sql).not.toMatch(/\b(drop|alter|truncate|delete)\b/i);
  });

  it('nenhum script cita tabela de outro sistema', () => {
    const proibidos = ['public.profiles', 'public.stores', 'public.positions', 'public.daily_items'];
    for (const nome of arquivos) {
      const sql = readFileSync(`${DIR}/${nome}`, 'utf8');
      for (const proibido of proibidos) {
        expect(sql.includes(proibido), `${nome} cita ${proibido}`).toBe(false);
      }
    }
  });

  it('as correções são idempotentes por construção (só gravam o que difere)', () => {
    for (const nome of ['001_fix_quadro_absence_reasons_utf8.sql', '002_fix_quadro_positions_utf8.sql']) {
      const sql = readFileSync(`${DIR}/${nome}`, 'utf8');
      expect(sql, `${nome} sem guarda "is distinct from"`).toMatch(/is distinct from/i);
    }
  });
});
