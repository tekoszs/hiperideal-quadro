/**
 * COEXISTÊNCIA COM OUTROS SISTEMAS NO MESMO SUPABASE
 *
 * O banco é compartilhado com o sistema Organico. Estes testes leem os
 * arquivos SQL e falham se algum objeto perder o prefixo `quadro_` ou se
 * voltar a existir um comando de escopo global.
 *
 * São testes de ARQUIVO: rodam sempre, sem precisar de banco.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = 'supabase/migrations';
const INSTALL = readFileSync('supabase/install.sql', 'utf8');
const SCHEMA = readFileSync('supabase/schema.sql', 'utf8');
const SEED = readFileSync('supabase/seed.sql', 'utf8');

function migrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
}

/** Remove comentários de linha para não acusar falso positivo em texto. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

const INSTALL_SQL = stripComments(INSTALL);

/**
 * SQL que vai para o Supabase real. O shim local e o Organico simulado
 * (supabase/local/*) NÃO entram aqui: são só para PostgreSQL no computador.
 */
const PRODUCTION_SQL: Array<[string, string]> = [
  ['install.sql', INSTALL],
  ['schema.sql', SCHEMA],
  ['seed.sql', SEED],
  ['seed_profiles.example.sql', readFileSync('supabase/seed_profiles.example.sql', 'utf8')],
  ...readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => [f, readFileSync(join(MIGRATIONS_DIR, f), 'utf8')] as [string, string]),
];

describe('install.sql não pode tocar em objetos de outros sistemas', () => {
  it('não usa comandos de escopo global (ALL TABLES / ALL FUNCTIONS / ALL SEQUENCES)', () => {
    // `revoke all on all tables in schema public` derrubaria os privilégios
    // das tabelas do Organico junto com as nossas.
    expect(INSTALL_SQL).not.toMatch(/on\s+all\s+tables\s+in\s+schema/i);
    expect(INSTALL_SQL).not.toMatch(/on\s+all\s+functions\s+in\s+schema/i);
    expect(INSTALL_SQL).not.toMatch(/on\s+all\s+sequences\s+in\s+schema/i);
    expect(INSTALL_SQL).not.toMatch(/on\s+all\s+routines\s+in\s+schema/i);
  });

  it('NÃO executa CREATE EXTENSION', () => {
    // Instalar extensão exige privilégio elevado e mexe no banco inteiro.
    // gen_random_uuid() é nativo do PostgreSQL desde a versão 13.
    for (const [nome, sql] of PRODUCTION_SQL) {
      expect(stripComments(sql), `${nome} contém CREATE EXTENSION`).not.toMatch(
        /\bcreate\s+extension\b/i,
      );
    }
  });

  it('NÃO executa GRANT/REVOKE ... ON SCHEMA public', () => {
    // O privilégio de USAGE no schema é compartilhado por todos os sistemas.
    for (const [nome, sql] of PRODUCTION_SQL) {
      expect(stripComments(sql), `${nome} mexe em privilégio de schema`).not.toMatch(
        /\b(grant|revoke)\b[^;]*\bon\s+schema\b/i,
      );
    }
  });

  it('NÃO executa ALTER DEFAULT PRIVILEGES', () => {
    // Mudaria o privilégio padrão de objetos FUTUROS de outros sistemas.
    for (const [nome, sql] of PRODUCTION_SQL) {
      expect(stripComments(sql), `${nome} contém ALTER DEFAULT PRIVILEGES`).not.toMatch(
        /\balter\s+default\s+privileges\b/i,
      );
    }
  });

  it('todo GRANT/REVOKE cita nominalmente um objeto quadro_*', () => {
    // Pega o comando inteiro até o `;` ou até o fecha-aspas do EXECUTE.
    const comandos = INSTALL_SQL.match(/\b(?:grant|revoke)\b[^;']*/gi) ?? [];
    expect(comandos.length).toBeGreaterThan(0);

    for (const comando of comandos) {
      const normalizado = comando.replace(/\s+/g, ' ').trim();
      // `revoke ... from public` remove privilégio do papel PUBLIC — sempre
      // sobre uma função nossa, nunca sobre o schema.
      expect(
        /quadro_/i.test(normalizado),
        `GRANT/REVOKE sem objeto quadro_: ${normalizado.slice(0, 140)}`,
      ).toBe(true);
    }
  });

  it('nenhum GRANT/REVOKE atinge tabela ou função de outro sistema', () => {
    const alvos = INSTALL_SQL.match(/\b(?:grant|revoke)\b[^;']*/gi) ?? [];
    for (const alvo of alvos) {
      const referencias = alvo.match(/public\.(\w+)/g) ?? [];
      for (const referencia of referencias) {
        expect(
          referencia.startsWith('public.quadro_'),
          `privilégio sobre objeto de outro sistema: ${referencia}`,
        ).toBe(true);
      }
    }
  });

  it('não apaga nada: sem DROP DATABASE/SCHEMA/TABLE, TRUNCATE ou DELETE solto', () => {
    expect(INSTALL_SQL).not.toMatch(/\bdrop\s+(database|schema|table)\b/i);
    expect(INSTALL_SQL).not.toMatch(/\btruncate\b/i);
    // DELETE só existe dentro do corpo das RPCs, sempre com WHERE da conferência.
    const deletes = INSTALL_SQL.match(/\bdelete\s+from\s+([a-z_.]+)/gi) ?? [];
    for (const statement of deletes) {
      expect(statement.toLowerCase()).toContain('quadro_');
    }
  });

  it('todo DROP existente é do próprio namespace quadro_', () => {
    const drops = INSTALL_SQL.match(/\bdrop\s+(trigger|policy|view|function|index|type)[^;]*/gi) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    for (const statement of drops) {
      expect(
        /quadro_/i.test(statement),
        `DROP fora do namespace quadro_: ${statement.slice(0, 120)}`,
      ).toBe(true);
    }
  });

  it('todo ALTER TABLE é em tabela quadro_', () => {
    const alters = INSTALL_SQL.match(/\balter\s+table\s+(?:if\s+exists\s+)?[a-z_."]+/gi) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const statement of alters) {
      expect(
        /quadro_/i.test(statement),
        `ALTER TABLE fora do namespace quadro_: ${statement}`,
      ).toBe(true);
    }
  });

  it('só toca no schema auth para LER auth.users e auth.uid()', () => {
    const authRefs = INSTALL_SQL.match(/\bauth\.[a-z_]+/gi) ?? [];
    const permitted = new Set(['auth.users', 'auth.uid']);
    for (const ref of authRefs) {
      expect(permitted.has(ref.toLowerCase()), `referência inesperada: ${ref}`).toBe(true);
    }
    // E nunca cria/altera nada dentro de auth.
    expect(INSTALL_SQL).not.toMatch(/\b(create|alter|drop)\s+[a-z ]*\bauth\./i);
  });

  it('não referencia public.profiles de outro sistema', () => {
    expect(INSTALL_SQL).not.toMatch(/public\.profiles\b/);
    expect(INSTALL_SQL).not.toMatch(/public\.stores\b/);
    expect(INSTALL_SQL).not.toMatch(/public\.positions\b/);
    expect(INSTALL_SQL).not.toMatch(/public\.daily_items\b/);
    expect(INSTALL_SQL).not.toMatch(/public\.audit_logs\b/);
  });
});

describe('todos os objetos usam o prefixo quadro_', () => {
  const kinds: Array<[string, RegExp]> = [
    ['tabela', /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi],
    ['view', /create\s+(?:or\s+replace\s+)?view\s+public\.(\w+)/gi],
    ['tipo', /create\s+type\s+public\.(\w+)/gi],
    ['função', /create\s+or\s+replace\s+function\s+public\.(\w+)/gi],
    ['índice', /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)/gi],
    ['trigger', /create\s+trigger\s+(\w+)/gi],
    ['policy', /create\s+policy\s+(\w+)/gi],
    ['constraint', /constraint\s+(\w+)\s+(?:check|unique|foreign)/gi],
  ];

  for (const [kind, pattern] of kinds) {
    it(`${kind}: todos com prefixo`, () => {
      const names = [...INSTALL_SQL.matchAll(pattern)].map((m) => m[1]);
      expect(names.length, `nenhum(a) ${kind} encontrado(a)`).toBeGreaterThan(0);
      const semPrefixo = names.filter((n) => !n.startsWith('quadro_'));
      expect(semPrefixo, `${kind}(s) sem prefixo: ${semPrefixo.join(', ')}`).toEqual([]);
    });
  }

  it('as duas RPCs têm nome próprio', () => {
    expect(INSTALL_SQL).toContain('public.quadro_rpc_save_daily_conference_draft');
    expect(INSTALL_SQL).toContain('public.quadro_rpc_submit_daily_conference');
  });

  it('o seed grava só em tabelas quadro_', () => {
    const inserts = [...SEED.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.every((t) => t.startsWith('quadro_'))).toBe(true);
  });

  it('as tabelas esperadas estão no install.sql', () => {
    const esperadas = [
      // Fase 4: a rede oficial trouxe os distritos, e eles seguem a regra.
      'quadro_districts',
      'quadro_stores',
      'quadro_positions',
      'quadro_store_staffing',
      'quadro_profiles',
      'quadro_absence_reasons',
      'quadro_daily_conferences',
      'quadro_daily_items',
      'quadro_daily_item_reasons',
      'quadro_audit_logs',
      // Fase 4.5: a trilha das resoluções de justificativa pendente.
      'quadro_absence_reason_resolutions',
    ];
    for (const tabela of esperadas) {
      expect(INSTALL_SQL, `faltou ${tabela}`).toContain(`create table if not exists public.${tabela}`);
    }
  });
});

describe('Etapa 0 — verificação prévia cobre todos os tipos de objeto', () => {
  const PREFLIGHT = readFileSync('supabase/tests/preflight_check.sql', 'utf8');

  it('procura em pg_class, pg_proc, pg_type, pg_policies e pg_trigger', () => {
    for (const catalogo of ['pg_class', 'pg_proc', 'pg_type', 'pg_policies', 'pg_trigger']) {
      expect(PREFLIGHT, `não consulta ${catalogo}`).toContain(catalogo);
    }
  });

  it('cobre view, materialized view, índice, sequence, procedure, enum e domínio', () => {
    const esperados = [
      "'v'", // view
      "'m'", // materialized view
      "'i'", // índice
      "'S'", // sequence
      "'p'", // procedure / tabela particionada
      "'e'", // enum
      "'d'", // domínio
    ];
    for (const marcador of esperados) {
      expect(PREFLIGHT, `não cobre relkind/typtype ${marcador}`).toContain(marcador);
    }
  });

  it('detecta policy e trigger quadro_* presos a tabela de outro sistema', () => {
    expect(PREFLIGHT).toContain('POLICY EM TABELA DE OUTRO SISTEMA');
    expect(PREFLIGHT).toContain('TRIGGER EM TABELA DE OUTRO SISTEMA');
  });

  it('dá um veredito claro no fim', () => {
    expect(PREFLIGHT).toContain('NADA ENCONTRADO');
    expect(PREFLIGHT).toContain('PARE e reporte');
  });

  it('é somente leitura: nenhum comando de escrita', () => {
    const somenteLeitura = stripComments(PREFLIGHT);
    expect(somenteLeitura).not.toMatch(/\b(insert|update|delete|drop|create|alter|truncate)\b/i);
  });
});

describe('snapshot e migrations não divergem', () => {
  it('schema.sql contém todas as migrations', () => {
    for (const migration of migrations()) {
      const marker = migration
        .split('\n')
        .find((line) => line.trim().length > 0 && !line.trim().startsWith('--'));
      if (marker) expect(SCHEMA).toContain(marker.trim());
    }
  });

  it('install.sql = schema.sql + seed.sql', () => {
    expect(INSTALL).toContain(SCHEMA.trim().slice(0, 400));
    expect(INSTALL).toContain(SEED.trim().slice(0, 200));
  });

  it('o GUC de autorização também tem namespace próprio', () => {
    expect(INSTALL_SQL).toContain("'quadro.status_change'");
    expect(INSTALL_SQL).not.toContain("'hiperideal.status_change'");
  });
});

describe('o frontend fala com as tabelas prefixadas', () => {
  const sources = [
    'src/services/storage/SupabaseAdapter.ts',
    'src/services/catalogService.ts',
    'src/services/authService.ts',
  ].map((path) => ({ path, code: readFileSync(path, 'utf8') }));

  it('nenhum .from() aponta para tabela sem prefixo', () => {
    for (const { path, code } of sources) {
      const tabelas = [...code.matchAll(/\.from\(\s*'([^']+)'/g)].map((m) => m[1]);
      for (const tabela of tabelas) {
        expect(tabela.startsWith('quadro_'), `${path}: .from('${tabela}')`).toBe(true);
      }
    }
  });

  it('nenhum .rpc() aponta para RPC sem prefixo', () => {
    for (const { path, code } of sources) {
      const rpcs = [...code.matchAll(/\.rpc\(\s*'([^']+)'/g)].map((m) => m[1]);
      for (const rpc of rpcs) {
        expect(rpc.startsWith('quadro_rpc_'), `${path}: .rpc('${rpc}')`).toBe(true);
      }
    }
  });

  it('o select aninhado do PostgREST usa os nomes prefixados COM alias', () => {
    const adapter = readFileSync('src/services/storage/SupabaseAdapter.ts', 'utf8');
    // Prefixo: o banco só tem os nomes com quadro_.
    expect(adapter).toContain('quadro_daily_items (');
    expect(adapter).toContain('quadro_daily_item_reasons (');
    // Alias: sem ele o PostgREST devolve a propriedade com o nome da tabela
    // e o toDomain lê undefined — a conferência voltaria vazia, sem erro.
    expect(adapter).toContain('daily_items:quadro_daily_items (');
    expect(adapter).toContain('daily_item_reasons:quadro_daily_item_reasons (');
  });

  it('o select de funções também usa alias explícito', () => {
    const catalog = readFileSync('src/services/catalogService.ts', 'utf8');
    expect(catalog).toContain('positions:quadro_positions (');
  });

  /**
   * Guarda geral: qualquer relacionamento aninhado `quadro_x (` dentro de um
   * .select() precisa vir com alias `nome:quadro_x (`. Foi assim que o erro
   * "Cannot read properties of undefined (reading 'active')" chegou em produção.
   */
  it('todo relacionamento aninhado quadro_* tem alias', () => {
    for (const { path, code } of sources) {
      // Os selects deste projeto vivem em template literals (`...`).
      const selects = [...code.matchAll(/`([^`]*)`/g)]
        .map((m) => m[1])
        .filter((literal) => literal.includes('quadro_') && literal.includes('('));

      for (const select of selects) {
        // `alias:tabela (` ou `alias:tabela!fk_hint (` — o hint é a sintaxe do
        // PostgREST para escolher a FK quando existe mais de um caminho.
        for (const match of select.matchAll(/(\w+\s*:\s*)?(quadro_\w+)(![A-Za-z0-9_]+)?\s*\(/g)) {
          const [, alias, tabela] = match;
          expect(alias, `${path}: relacionamento "${tabela} (" sem alias no select`).toBeTruthy();
        }
      }
    }
  });

  /**
   * quadro_daily_conferences tem DUAS FKs para quadro_profiles (created_by e
   * submitted_by). Sem o hint, o PostgREST não sabe qual seguir e recusa a
   * consulta inteira com "more than one relationship was found".
   */
  it('o embed do responsável pelo envio traz o hint da FK correta', () => {
    const adapter = readFileSync('src/services/storage/SupabaseAdapter.ts', 'utf8');

    expect(adapter).toContain(
      'submitter:quadro_profiles!quadro_daily_conferences_submitted_by_fkey',
    );

    // A checagem do caminho errado olha só os SELECTs (template literals),
    // não os comentários — o comentário cita a outra FK para explicar por que
    // o hint existe, e isso não é um defeito.
    const selects = [...adapter.matchAll(/`([^`]*)`/g)].map((m) => m[1]).join('\n');
    // Quem ENVIOU, nunca quem criou.
    expect(selects).toContain('submitted_by_fkey');
    expect(selects).not.toContain('created_by_fkey');
  });
});
