#!/usr/bin/env node
/**
 * FASE 4.2 — CONTAS AUTH DAS LOJAS.
 *
 * ============================================================================
 * ESTE SCRIPT NÃO FOI EXECUTADO, e não roda por acidente: sem `--apply` ele
 * apenas SIMULA e mostra o plano. Quem executa é você, na sua máquina.
 * ============================================================================
 *
 * O que ele faz, quando você mandar:
 *
 *   1. lê as 34 lojas de `src/data/network.ts` — a mesma lista do seletor de
 *      login, então nunca inventa nem esquece uma loja;
 *   2. cria em `auth.users`, pela Admin API, a conta que faltar:
 *      `loja<codigo>@hiperideal.com.br`;
 *   3. cria em `quadro_profiles` o perfil de gerente, usando o UUID QUE O
 *      SUPABASE DEVOLVEU — nunca um UUID inventado aqui.
 *
 *
 * A SENHA NÃO ESTÁ NESTE ARQUIVO, E NÃO PODE ESTAR
 * ------------------------------------------------
 * Ela vem de `STORE_INITIAL_PASSWORD`, lida do ambiente NO MOMENTO DA
 * EXECUÇÃO. Não há valor padrão, não há literal, não há arquivo de exemplo com
 * a senha dentro. Se a variável não estiver definida, o script recusa rodar.
 *
 * O script nunca imprime a senha: nem no plano, nem no sucesso, nem no erro.
 * Há teste varrendo este arquivo à procura de senha escrita.
 *
 * SENHA INICIAL COMPARTILHADA — o que isso significa na prática. Todas as
 * lojas começam com a mesma senha, por decisão operacional do proprietário.
 * Vale registrar o que ela protege e o que não protege:
 *
 *   • ela NÃO decide o que cada gerente enxerga. Quem decide é
 *     `auth.uid()` -> `quadro_profiles.store_id` -> RLS. Entrar com a conta da
 *     LEPARC dá acesso à LEPARC porque o PERFIL diz isso, não porque a loja foi
 *     escolhida na tela;
 *   • enquanto a senha for a mesma, quem a conhece pode entrar como QUALQUER
 *     loja — e as ações ficam registradas no nome daquela loja. É um risco de
 *     RESPONSABILIZAÇÃO, não de vazamento da rede: mesmo assim ninguém vê mais
 *     do que uma loja por vez;
 *   • trocar depois por senha individual não exige mudança nenhuma de código.
 *     É trocar a senha no painel do Supabase Auth, loja por loja, quando você
 *     decidir.
 *
 *
 * ONDE MORA A CHAVE
 * -----------------
 * `SUPABASE_SERVICE_ROLE_KEY` ignora toda a RLS.
 *
 *   • vem SÓ do ambiente. Argumento de linha de comando não é aceito: ficaria
 *     no histórico do shell;
 *   • o nome NÃO começa com `VITE_`, e é isso que impede o Vite de embutir a
 *     chave no bundle — ele só expõe ao navegador o que tem esse prefixo;
 *   • este arquivo vive em `scripts/`, fora de `src/`, então não é alcançável
 *     a partir de `src/main.tsx` e não entra em build nenhum;
 *   • nunca é impressa, nem em mensagem de erro.
 *
 * Feche o terminal e a chave vai junto.
 *
 *
 * COMO USAR
 * ---------
 * PowerShell:
 *
 *   $env:SUPABASE_URL="https://SEUPROJETO.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."
 *   $env:STORE_INITIAL_PASSWORD="..."
 *   node scripts/create_store_auth_users.mjs --dry-run
 *
 * bash / zsh:
 *
 *   export SUPABASE_URL="https://SEUPROJETO.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="..."
 *   export STORE_INITIAL_PASSWORD="..."
 *   node scripts/create_store_auth_users.mjs --dry-run
 *
 * Só depois de conferir o plano:
 *
 *   node scripts/create_store_auth_users.mjs --apply
 *
 * Rodar duas vezes é seguro: conta e perfil existentes são reportados como
 * EXISTENTE e nada é criado, alterado ou duplicado.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ==========================================================================
 * Argumentos — o padrão é NÃO escrever
 * ======================================================================= */

const args = process.argv.slice(2);
const APLICAR = args.includes('--apply');
/** `--dry-run` é o padrão; aceito explicitamente para o comando ficar legível. */
const DRY_RUN = !APLICAR;

/* ==========================================================================
 * A rede oficial — lida da fonte única, nunca digitada aqui
 * ======================================================================= */

/**
 * Extrai as lojas de `src/data/network.ts` sem precisar compilar TypeScript.
 *
 * TRÊS CERCAS, e a primeira existe por um defeito real. Uma versão anterior
 * deste leitor casava com QUALQUER objeto `{id, code, name, active}` — e o
 * arquivo também declara os DISTRITOS, que têm exatamente essa forma. Teria
 * criado `loja1@` e `loja2@` em produção, com senha, e ninguém perceberia até
 * alguém perguntar o que eram aquelas duas contas.
 *
 *   1. recorta só o trecho de `NETWORK_STORES` — cerca estrutural;
 *   2. exige `districtId:` no objeto — loja tem, distrito não;
 *   3. exige código numérico — o e-mail é montado a partir dele.
 */
export function lerRedeOficial(fonte = readFileSync(resolve(RAIZ, 'src/data/network.ts'), 'utf8')) {
  const inicio = fonte.indexOf('NETWORK_STORES');
  if (inicio === -1) throw new Error('NETWORK_STORES não encontrado em src/data/network.ts.');
  const abre = fonte.indexOf('[', inicio);
  const fecha = fonte.indexOf('];', abre);
  if (abre === -1 || fecha === -1) throw new Error('Não consegui delimitar NETWORK_STORES.');

  const trecho = fonte.slice(abre, fecha);
  const padrao =
    /\{\s*id:\s*'([^']+)',\s*code:\s*'([^']+)',\s*name:\s*'([^']+)',[^}]*?districtId:\s*'[^']*',[^}]*?active:\s*(true|false)\s*\}/g;

  const lojas = [];
  let m;
  while ((m = padrao.exec(trecho)) !== null) {
    if (m[4] !== 'true') continue;
    if (!/^\d+$/.test(m[2])) {
      throw new Error(`Código de loja não numérico: "${m[2]}". O e-mail sai daqui — abortando.`);
    }
    lojas.push({ id: m[1], code: m[2], name: m[3] });
  }

  if (lojas.length === 0) throw new Error('Nenhuma loja lida de src/data/network.ts.');

  const codigos = new Set(lojas.map((l) => l.code));
  if (codigos.size !== lojas.length) {
    throw new Error('Código de loja repetido — duas lojas dariam o mesmo e-mail. Abortando.');
  }
  return lojas;
}

/** A MESMA convenção de `src/lib/storeLogin.ts`. Há teste comparando as duas. */
export const emailDaLoja = (codigo) => `loja${String(codigo).trim().toLowerCase()}@hiperideal.com.br`;

/* ==========================================================================
 * Supabase Admin API
 * ======================================================================= */

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
const SENHA_INICIAL = process.env.STORE_INITIAL_PASSWORD ?? '';

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`${SUPABASE_URL}${caminho}`, {
    ...opcoes,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers ?? {}),
    },
  });

  const texto = await resposta.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { raw: texto };
  }
  return { ok: resposta.ok, status: resposta.status, json };
}

/**
 * As contas que já existem, nos dois sentidos.
 *
 * `porUuid` existe por causa da loja 124: o gerente dela já tem conta, mas com
 * um e-mail que pode não seguir a convenção. Sem esse mapa o script não teria
 * como dizer QUAL conta está ligada ao perfil dela.
 */
async function contasExistentes() {
  const porEmail = new Map();
  const porUuid = new Map();

  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const { ok, status, json } = await api(`/auth/v1/admin/users?page=${pagina}&per_page=200`);
    if (!ok) throw new Error(`Falha ao listar usuários do Auth (HTTP ${status}).`);
    const lote = json?.users ?? [];
    for (const u of lote) {
      if (!u.email) continue;
      porEmail.set(u.email.toLowerCase(), u.id);
      porUuid.set(u.id, u.email.toLowerCase());
    }
    if (lote.length < 200) break;
  }
  return { porEmail, porUuid };
}

/** Perfis de loja que já existem: store_id -> {id, role, access_scope}. */
async function perfisExistentes() {
  const { ok, status, json } = await api(
    '/rest/v1/quadro_profiles?select=id,store_id,role,access_scope,active&store_id=not.is.null',
  );
  if (!ok) throw new Error(`Falha ao ler quadro_profiles (HTTP ${status}).`);

  const porLoja = new Map();
  for (const perfil of json ?? []) porLoja.set(perfil.store_id, perfil);
  return porLoja;
}

async function criarConta(email) {
  const { ok, status, json } = await api('/auth/v1/admin/users', {
    method: 'POST',
    // A senha entra AQUI e em nenhum outro lugar. Nunca é ecoada.
    body: JSON.stringify({ email, password: SENHA_INICIAL, email_confirm: true }),
  });
  if (!ok) {
    throw new Error(`HTTP ${status} — ${json?.msg ?? json?.message ?? 'erro desconhecido'}`);
  }
  if (!json?.id) throw new Error('O Supabase não devolveu o UUID da conta criada.');
  return json.id;
}

/**
 * Cria o perfil com o UUID DEVOLVIDO PELO AUTH.
 *
 * `id` é o mesmo uuid de `auth.users` — é isso que liga a sessão ao perfil, e é
 * por isso que inventar um uuid aqui deixaria a conta órfã: ela entraria e não
 * enxergaria nada.
 */
async function criarPerfil(uuid, loja) {
  const { ok, status, json } = await api('/rest/v1/quadro_profiles', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: uuid,
      name: `${loja.name} - Gerente da Loja`,
      role: 'MANAGER',
      access_scope: 'STORE',
      store_id: loja.id,
      district_id: null,
      job_title: 'Gerente',
      active: true,
    }),
  });
  if (!ok) {
    throw new Error(`perfil: HTTP ${status} — ${json?.message ?? 'erro desconhecido'}`);
  }
}

/* ==========================================================================
 * Execução
 * ======================================================================= */

function abortar(mensagem) {
  console.error(`\n  ERRO: ${mensagem}\n`);
  process.exit(1);
}

async function main() {
  console.log('\n=== CONTAS AUTH DAS LOJAS ===');
  console.log(DRY_RUN ? '    MODO: DRY RUN — nada será criado\n' : '    MODO: APLICANDO\n');

  if (!SUPABASE_URL) abortar('defina SUPABASE_URL no ambiente.');
  if (!SERVICE_ROLE) {
    abortar(
      'defina SUPABASE_SERVICE_ROLE_KEY no ambiente (Supabase > Settings > API).\n' +
        '         Não passe a chave por argumento: ela ficaria no histórico do shell.',
    );
  }
  if (!SENHA_INICIAL) {
    abortar(
      'defina STORE_INITIAL_PASSWORD no ambiente.\n' +
        '         A senha não existe neste repositório e não tem valor padrão —\n' +
        '         ela é informada só no momento da execução.',
    );
  }

  const lojas = lerRedeOficial();
  const { porEmail, porUuid } = await contasExistentes();
  const perfis = await perfisExistentes();

  /*
   * A REGRA QUE PROTEGE A LOJA 124.
   *
   * A decisão de criar conta NÃO olha só o e-mail: olha primeiro se a loja já
   * TEM GERENTE. A 124 tem — desde as fases anteriores, com um e-mail que pode
   * não seguir a convenção. Se a decisão fosse só pelo e-mail, o script veria
   * que `loja124@...` não existe e criaria uma SEGUNDA conta para a mesma loja:
   * o gerente antigo continuaria entrando pelo e-mail dele e a conta nova
   * ficaria órfã, sem perfil, dando "Acesso não liberado".
   *
   * Loja com gerente é EXISTENTE, ponto. Se o e-mail dela estiver fora da
   * convenção, o script AVISA — a correção é renomear no painel do Supabase,
   * o que preserva o UUID e portanto o perfil, o histórico e as conferências.
   */
  const plano = lojas.map((loja) => {
    const email = emailDaLoja(loja.code);
    const perfil = perfis.get(loja.id) ?? null;
    const uuidDoPerfil = perfil?.id ?? null;
    const emailDoPerfil = uuidDoPerfil ? (porUuid.get(uuidDoPerfil) ?? null) : null;
    const uuidDoEmail = porEmail.get(email) ?? null;

    return {
      loja,
      email,
      perfil,
      uuid: uuidDoPerfil ?? uuidDoEmail,
      emailDoPerfil,
      // Loja que JÁ TEM GERENTE nunca ganha conta nova.
      criarConta: perfil === null && uuidDoEmail === null,
      criarPerfil: perfil === null,
      // Tem gerente, mas com e-mail fora da convenção: o login por filial não
      // vai encontrá-lo até o e-mail ser ajustado no painel.
      precisaRenomear: perfil !== null && emailDoPerfil !== null && emailDoPerfil !== email,
    };
  });

  const aCriarConta = plano.filter((p) => p.criarConta);
  const aCriarPerfil = plano.filter((p) => p.criarPerfil);

  console.log(`  Rede oficial ........ ${lojas.length}`);
  console.log(`  Contas existentes ... ${lojas.length - aCriarConta.length}`);
  console.log(`  Contas a criar ...... ${aCriarConta.length}`);
  console.log(`  Perfis a vincular ... ${aCriarPerfil.length}\n`);

  for (const p of plano) {
    const marca = p.criarConta ? 'CRIAR    ' : 'EXISTENTE';
    const perfilMarca = p.criarPerfil ? 'perfil: CRIAR' : 'perfil: EXISTENTE';
    console.log(
      `  ${marca} ${p.loja.code.padEnd(4)} ${p.loja.name.padEnd(10)} -> ${p.email.padEnd(30)} ${perfilMarca}`,
    );
  }

  const renomear = plano.filter((p) => p.precisaRenomear);
  if (renomear.length > 0) {
    console.log('\n  ATENÇÃO — estas lojas já têm gerente, com e-mail fora da convenção.');
    console.log('  Nenhuma conta nova foi planejada para elas (seria uma segunda conta na');
    console.log('  mesma loja). Para o login por filial funcionar, renomeie o e-mail no');
    console.log('  painel: Authentication > Users > editar Email. O UUID não muda, então');
    console.log('  perfil, histórico e conferências ficam intactos.\n');
    for (const p of renomear) {
      console.log(`      ${p.loja.code} ${p.loja.name}: ${p.emailDoPerfil} -> ${p.email}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n  Nada foi criado. Para aplicar de verdade:');
    console.log('      node scripts/create_store_auth_users.mjs --apply\n');
    return;
  }

  console.log('\n  --- APLICANDO ---');
  const falhas = [];

  for (const p of plano) {
    if (!p.criarConta && !p.criarPerfil) {
      console.log(`      EXISTENTE ${p.email}`);
      continue;
    }

    try {
      // O uuid vem do Auth — criado agora, ou o da conta que já existia.
      const uuid = p.criarConta ? await criarConta(p.email) : p.uuid;
      if (p.criarPerfil) await criarPerfil(uuid, p.loja);
      console.log(`      ok        ${p.email}`);
    } catch (erro) {
      falhas.push([p.loja.code, erro.message]);
      console.log(`      FALHA     ${p.email} — ${erro.message}`);
    }
  }

  if (falhas.length > 0) {
    console.log(`\n  ${falhas.length} loja(s) falharam. Rode de novo: o que deu certo é pulado.`);
  } else {
    console.log('\n  Concluído.');
  }
  console.log();
}

// Só executa quando chamado direto — importar o módulo (nos testes) não dispara
// nada, e é isso que permite testar o leitor da rede sem tocar em rede nenhuma.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((erro) => abortar(erro instanceof Error ? erro.message : String(erro)));
}
