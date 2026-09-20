/**
 * FASE 4.2 — O SCRIPT QUE CRIA AS CONTAS DAS LOJAS.
 *
 * Este script roda com `service_role`, que ignora TODA a RLS, e cria contas de
 * verdade. Um engano nele não dá erro: dá conta a mais, conta a menos, ou conta
 * apontando para a loja errada — e ninguém percebe até alguém tentar entrar.
 *
 * COMO ESTES TESTES FUNCIONAM
 * ---------------------------
 * Sobe um SUPABASE FALSO (um servidor HTTP local que imita a Admin API e o
 * PostgREST) e executa o script DE VERDADE como processo filho, apontado para
 * ele. Não é mock de função: é o script inteiro, com `process.argv`, variáveis
 * de ambiente, `fetch` e tudo o mais — o mesmo caminho que rodará na máquina do
 * proprietário, só que contra um servidor de mentira.
 *
 * Assim dá para afirmar coisas que um mock não provaria: que o dry-run não
 * emite NENHUM POST, que a segunda execução não escreve nada, e que o UUID
 * gravado no perfil é exatamente o que o Auth devolveu.
 *
 * NENHUMA SENHA aparece aqui. Os testes usam um valor descartável passado por
 * ambiente, como o script exige.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { selectableStores, storeLoginEmail } from '@/lib/storeLogin';

const execFileAsync = promisify(execFile);
const RAIZ = resolve(__dirname, '../..');
const SCRIPT = resolve(RAIZ, 'scripts/create_store_auth_users.mjs');
const FONTE = readFileSync(SCRIPT, 'utf8');

/** Valor descartável — não é senha de ninguém, e nunca sai deste arquivo. */
const SENHA_DE_TESTE = 'valor-de-teste-descartavel';

/* =========================================================================
 * O Supabase falso
 * ====================================================================== */

interface FakeSupabase {
  server: Server;
  url: string;
  /** Contas do Auth: uuid -> email. */
  users: Map<string, string>;
  /** Perfis: store_id -> registro. */
  profiles: Map<string, Record<string, unknown>>;
  /** Toda escrita recebida, na ordem. É o que prova que o dry-run não escreve. */
  writes: Array<{ path: string; body: Record<string, unknown> }>;
}

async function subirFake(
  seed: {
    users?: Array<[string, string]>;
    profiles?: Array<[string, Record<string, unknown>]>;
  } = {},
): Promise<FakeSupabase> {
  const users = new Map(seed.users ?? []);
  const profiles = new Map(seed.profiles ?? []);
  const writes: FakeSupabase['writes'] = [];
  let proximoUuid = 1;

  const server = createServer((req, res) => {
    const corpo: Buffer[] = [];
    req.on('data', (chunk) => corpo.push(chunk as Buffer));
    req.on('end', () => {
      const url = req.url ?? '';
      const texto = Buffer.concat(corpo).toString('utf8');
      const json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};

      const responder = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      // Admin API — listar contas
      if (req.method === 'GET' && url.startsWith('/auth/v1/admin/users')) {
        return responder(200, {
          users: [...users.entries()].map(([id, email]) => ({ id, email })),
        });
      }

      // Admin API — criar conta
      if (req.method === 'POST' && url.startsWith('/auth/v1/admin/users')) {
        writes.push({ path: 'auth', body: json });
        const email = String(json.email).toLowerCase();
        if ([...users.values()].includes(email)) {
          return responder(422, { msg: 'email already registered' });
        }
        const id = `uuid-gerado-${String(proximoUuid).padStart(3, '0')}`;
        proximoUuid += 1;
        users.set(id, email);
        return responder(200, { id, email });
      }

      // PostgREST — ler perfis
      if (req.method === 'GET' && url.startsWith('/rest/v1/quadro_profiles')) {
        return responder(200, [...profiles.values()]);
      }

      // PostgREST — criar perfil
      if (req.method === 'POST' && url.startsWith('/rest/v1/quadro_profiles')) {
        writes.push({ path: 'profiles', body: json });
        const storeId = String(json.store_id);
        if (profiles.has(storeId)) {
          return responder(409, { message: 'duplicate key value' });
        }
        profiles.set(storeId, json);
        return responder(201, {});
      }

      return responder(404, { message: `sem rota: ${req.method} ${url}` });
    });
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const porta = (server.address() as { port: number }).port;

  return { server, url: `http://127.0.0.1:${porta}`, users, profiles, writes };
}

/** Roda o script de verdade contra o Supabase falso. */
async function rodar(fake: FakeSupabase, args: string[] = []) {
  const { stdout } = await execFileAsync('node', [SCRIPT, ...args], {
    cwd: RAIZ,
    env: {
      ...process.env,
      SUPABASE_URL: fake.url,
      SUPABASE_SERVICE_ROLE_KEY: 'chave-falsa-de-teste',
      STORE_INITIAL_PASSWORD: SENHA_DE_TESTE,
    },
  });
  return stdout;
}

/** Roda esperando falha, e devolve a saída de erro. */
async function rodarEsperandoErro(env: Record<string, string | undefined>, args: string[] = []) {
  try {
    await execFileAsync('node', [SCRIPT, ...args], {
      cwd: RAIZ,
      env: { ...process.env, ...env },
    });
    return null;
  } catch (erro) {
    return String((erro as { stderr?: string }).stderr ?? erro);
  }
}

let fake: FakeSupabase | null = null;

afterEach(async () => {
  if (fake) {
    await new Promise<void>((ok) => fake!.server.close(() => ok()));
    fake = null;
  }
});

/* =========================================================================
 * A leitura da rede
 * ====================================================================== */

describe('Script de contas — a rede que ele lê', () => {
  // TESTE 18
  it('18. lê exatamente 34 lojas', async () => {
    const { lerRedeOficial } = await import('../../scripts/create_store_auth_users.mjs');
    const lojas = lerRedeOficial();

    expect(lojas).toHaveLength(34);
    expect(lojas).toHaveLength(selectableStores().length);
  });

  // TESTE 19
  it('19. NÃO interpreta distrito como loja', async () => {
    const { lerRedeOficial } = await import('../../scripts/create_store_auth_users.mjs');
    const lojas = lerRedeOficial();

    // Os distritos têm a MESMA forma de objeto e códigos "1" e "2". Uma versão
    // anterior deste leitor os pegava e teria criado loja1@ e loja2@.
    expect(lojas.every((l) => l.id.startsWith('store-'))).toBe(true);
    expect(lojas.some((l) => l.id.startsWith('district-'))).toBe(false);
    expect(lojas.some((l) => l.code === '1' || l.code === '2')).toBe(false);
  });

  // TESTE 20
  it('20. o e-mail técnico é o mesmo que o app usa', async () => {
    const { lerRedeOficial, emailDaLoja } = await import(
      '../../scripts/create_store_auth_users.mjs'
    );

    // Duas implementações da convenção: o script e `storeLoginEmail`. Se
    // divergirem, a conta criada não é a que o login procura.
    const doScript = lerRedeOficial()
      .map((l) => emailDaLoja(l.code))
      .sort();
    const doApp = selectableStores().map((s) => storeLoginEmail(s.code)).sort();

    expect(doScript).toEqual(doApp);
    expect(doScript).toContain('loja307@hiperideal.com.br');
    expect(doScript).toContain('loja124@hiperideal.com.br');
    expect(doScript).toContain('loja311@hiperideal.com.br');
  });
});

/* =========================================================================
 * Dry-run e escrita
 * ====================================================================== */

describe('Script de contas — dry-run e --apply', () => {
  // TESTE 21
  it('21. o dry-run NÃO cria nada', async () => {
    fake = await subirFake();
    const saida = await rodar(fake, ['--dry-run']);

    expect(saida).toContain('DRY RUN');
    expect(saida).toContain('Rede oficial ........ 34');
    expect(saida).toContain('Contas a criar ...... 34');
    expect(saida).toContain('Perfis a vincular ... 34');
    expect(saida).toContain('307  LEPARC     -> loja307@hiperideal.com.br');

    // A prova: o servidor não recebeu NENHUMA escrita.
    expect(fake.writes).toEqual([]);
    expect(fake.users.size).toBe(0);
    expect(fake.profiles.size).toBe(0);
  });

  // TESTE 22
  it('22. sem argumento nenhum também é dry-run — escrever exige --apply', async () => {
    fake = await subirFake();
    const saida = await rodar(fake, []);

    expect(saida).toContain('DRY RUN');
    expect(fake.writes).toEqual([]);

    // E o próprio código deixa isso explícito: o padrão é não escrever.
    expect(FONTE).toContain("const APLICAR = args.includes('--apply')");
    expect(FONTE).toContain('const DRY_RUN = !APLICAR');
  });

  // TESTE 23
  it('23. a service_role é obrigatória', async () => {
    const erro = await rodarEsperandoErro({
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: '',
      STORE_INITIAL_PASSWORD: SENHA_DE_TESTE,
    });

    expect(erro).toContain('SUPABASE_SERVICE_ROLE_KEY');
    // E não é aceita por argumento — ficaria no histórico do shell.
    expect(FONTE).not.toMatch(/--service[-_]?role/);
  });

  // TESTE 24
  it('24. a senha é obrigatória e só existe em runtime', async () => {
    const erro = await rodarEsperandoErro({
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: 'chave-falsa-de-teste',
      STORE_INITIAL_PASSWORD: '',
    });

    expect(erro).toContain('STORE_INITIAL_PASSWORD');
    expect(erro).toContain('não tem valor padrão');
    // Vem do ambiente, e de mais lugar nenhum.
    expect(FONTE).toContain('process.env.STORE_INITIAL_PASSWORD');
  });

  // TESTE 25
  it('25. não existe senha escrita no script', () => {
    // Atribuição de senha a um literal: password = "...", senha: '...', etc.
    const senhaEscrita = /\b(password|senha|passwd|pwd)\b\s*[:=]\s*['"`][^'"`\n]{1,}['"`]/i;
    expect(senhaEscrita.test(FONTE)).toBe(false);

    // A senha do proprietário, especificamente, não pode estar em lugar nenhum
    // do repositório versionado.
    //
    // Os arquivos MOSTRAM o comando a rodar, e o comando tem a variável nele:
    //
    //     $env:STORE_INITIAL_PASSWORD="..."
    //
    // Isso é documentação, não senha. O que o teste procura é um valor DE
    // VERDADE atribuído à variável — qualquer coisa que não seja um marcador
    // como `...`, `<senha>` ou `SUA_SENHA`.
    const ehMarcador = (valor: string) =>
      /^[.<>\s]*$/.test(valor) || /^<.*>$/.test(valor) || /^(SUA|SEU|COLOQUE|TROQUE)/i.test(valor);

    for (const caminho of [
      'scripts/create_store_auth_users.mjs',
      'README.md',
      'docs/FASE-4-IMPLANTACAO.md',
      'supabase/seed_store_profiles.example.sql',
      'src/lib/storeLogin.ts',
    ]) {
      const conteudo = readFileSync(resolve(RAIZ, caminho), 'utf8');
      const atribuicoes = [
        ...conteudo.matchAll(/STORE_INITIAL_PASSWORD\s*=\s*['"`]([^'"`\n]*)['"`]/g),
      ].map((m) => m[1]);

      const reais = atribuicoes.filter((valor) => !ehMarcador(valor));
      expect(reais, `${caminho} atribui um valor real à senha inicial`).toEqual([]);
    }
  });

  // TESTE 26
  it('26. nenhuma service_role em NENHUM arquivo de src/', () => {
    // O prefixo VITE_ é justamente o que faria o Vite expor a variável ao
    // navegador. O script não usa esse prefixo, e não pode passar a usar.
    expect(FONTE).not.toMatch(/VITE_SUPABASE_SERVICE/);
    expect(FONTE).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');

    // E `src/` — tudo que o Vite empacota — não pode mencionar a chave. Varre
    // a árvore inteira, não uma lista de arquivos escolhidos: a lista
    // envelheceria e o arquivo novo passaria despercebido.
    const arquivos = readdirSync(resolve(RAIZ, 'src'), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entrada) => entrada.isFile() && /\.(ts|tsx)$/.test(entrada.name))
      .map((entrada) => resolve(entrada.parentPath ?? entrada.path, entrada.name));

    expect(arquivos.length).toBeGreaterThan(20);

    const suspeitos = arquivos
      .filter((caminho) => /SERVICE_ROLE|service_role/.test(readFileSync(caminho, 'utf8')))
      // Os testes podem citar o nome ao explicar por que ele não pode estar lá.
      .filter((caminho) => !caminho.replaceAll('\\', '/').includes('/tests/'));

    expect(suspeitos).toEqual([]);
  });

  it('cria as 34 contas e os 34 perfis quando mandado', async () => {
    fake = await subirFake();
    const saida = await rodar(fake, ['--apply']);

    expect(saida).toContain('APLICANDO');
    expect(fake.users.size).toBe(34);
    expect(fake.profiles.size).toBe(34);
    expect(fake.writes.filter((w) => w.path === 'auth')).toHaveLength(34);
    expect(fake.writes.filter((w) => w.path === 'profiles')).toHaveLength(34);
  });
});

/* =========================================================================
 * Idempotência e a loja 124
 * ====================================================================== */

describe('Script de contas — idempotência e a loja 124', () => {
  // TESTE 27
  it('27. conta que já existe não é duplicada', async () => {
    fake = await subirFake({
      users: [['uuid-ja-existia', 'loja307@hiperideal.com.br']],
    });

    const saida = await rodar(fake, ['--dry-run']);
    expect(saida).toContain('Contas a criar ...... 33');
    expect(saida).toMatch(/EXISTENTE 307/);

    await rodar(fake, ['--apply']);
    expect(fake.users.size).toBe(34); // 33 novas + a que já existia
    expect([...fake.users.values()].filter((e) => e === 'loja307@hiperideal.com.br')).toHaveLength(
      1,
    );
  });

  // TESTE 28
  it('28. perfil que já existe não é duplicado', async () => {
    fake = await subirFake({
      users: [['uuid-307', 'loja307@hiperideal.com.br']],
      profiles: [
        [
          'store-307',
          { id: 'uuid-307', store_id: 'store-307', role: 'MANAGER', access_scope: 'STORE' },
        ],
      ],
    });

    const saida = await rodar(fake, ['--dry-run']);
    expect(saida).toContain('Perfis a vincular ... 33');

    await rodar(fake, ['--apply']);
    expect(fake.profiles.size).toBe(34);
    expect(fake.profiles.get('store-307')!.id).toBe('uuid-307'); // intacto
  });

  // TESTE 29 — a regra que protege a loja em produção.
  it('29. a loja 124 é preservada: nenhuma SEGUNDA conta é criada para ela', async () => {
    // O gerente real da 124 existe, mas com e-mail FORA da convenção.
    fake = await subirFake({
      users: [['uuid-gerente-real-124', 'gerente.antigo@hiperideal.com.br']],
      profiles: [
        [
          'store-124',
          {
            id: 'uuid-gerente-real-124',
            store_id: 'store-124',
            role: 'MANAGER',
            access_scope: 'STORE',
            active: true,
          },
        ],
      ],
    });

    const saida = await rodar(fake, ['--dry-run']);

    // A loja tem gerente: é EXISTENTE, mesmo o e-mail da convenção não existindo.
    expect(saida).toContain('Contas a criar ...... 33');
    expect(saida).toContain('Perfis a vincular ... 33');
    expect(saida).toMatch(/EXISTENTE 124/);
    // E o script AVISA que o e-mail precisa ser renomeado no painel.
    expect(saida).toContain('e-mail fora da convenção');
    expect(saida).toContain('gerente.antigo@hiperideal.com.br -> loja124@hiperideal.com.br');

    await rodar(fake, ['--apply']);

    // NENHUMA conta nova para a 124: nem loja124@, nem outra.
    expect([...fake.users.values()]).not.toContain('loja124@hiperideal.com.br');
    expect(fake.users.get('uuid-gerente-real-124')).toBe('gerente.antigo@hiperideal.com.br');
    // O perfil dela continua exatamente o mesmo, com o mesmo UUID.
    expect(fake.profiles.get('store-124')!.id).toBe('uuid-gerente-real-124');
    expect(fake.profiles.size).toBe(34); // 33 novos + o dela
  });

  // TESTE 30
  it('30. o UUID que o Auth devolve vira o profile.id', async () => {
    fake = await subirFake();
    await rodar(fake, ['--apply']);

    for (const [storeId, perfil] of fake.profiles) {
      const uuid = perfil.id as string;
      // O uuid tem que EXISTIR no Auth — não pode ser inventado pelo script.
      expect(fake.users.has(uuid), `${storeId} tem perfil com uuid inexistente`).toBe(true);
      expect(uuid.startsWith('uuid-gerado-')).toBe(true);
    }

    // E o e-mail daquela conta é o da loja do perfil: nenhum par trocado.
    for (const [storeId, perfil] of fake.profiles) {
      const codigo = storeId.replace('store-', '');
      expect(fake.users.get(perfil.id as string)).toBe(`loja${codigo}@hiperideal.com.br`);
    }
  });

  // TESTE 31
  it('31. o store_id de cada perfil é o da loja certa', async () => {
    fake = await subirFake();
    await rodar(fake, ['--apply']);

    const esperados = selectableStores().map((s) => s.id).sort();
    expect([...fake.profiles.keys()].sort()).toEqual(esperados);
  });

  // TESTE 32
  it('32. todo perfil nasce MANAGER / STORE / ativo, sem distrito', async () => {
    fake = await subirFake();
    await rodar(fake, ['--apply']);

    for (const perfil of fake.profiles.values()) {
      expect(perfil.role).toBe('MANAGER');
      expect(perfil.access_scope).toBe('STORE');
      expect(perfil.active).toBe(true);
      // Escopo STORE exige district_id nulo — o CHECK do banco cobra isso.
      expect(perfil.district_id).toBeNull();
      expect(perfil.job_title).toBe('Gerente');
    }
  });

  // TESTE 33
  it('33. a segunda execução não escreve nada', async () => {
    fake = await subirFake();

    await rodar(fake, ['--apply']);
    const escritasDaPrimeira = fake.writes.length;
    expect(escritasDaPrimeira).toBe(68); // 34 contas + 34 perfis

    const saida = await rodar(fake, ['--apply']);

    // Nenhuma escrita nova, e nada mudou.
    expect(fake.writes).toHaveLength(escritasDaPrimeira);
    expect(fake.users.size).toBe(34);
    expect(fake.profiles.size).toBe(34);
    expect(saida).toContain('EXISTENTE');
    expect(saida).not.toContain('FALHA');
  });
});
