/**
 * Apoio aos testes de integração contra PostgreSQL real.
 *
 * Reproduz o que o PostgREST faz a cada requisição no Supabase:
 *   - assume o papel `anon` ou `authenticated`;
 *   - publica o `sub` do JWT em `request.jwt.claim.sub`, que é de onde
 *     `auth.uid()` lê a identidade.
 *
 * Assim os testes exercitam a MESMA RLS que rodará em produção.
 */
import { Client } from 'pg';

export const TEST_STORE = 'store-124';

/**
 * Loja usada SOMENTE para provar isolamento entre lojas nos testes.
 * Não está no catálogo (`supabase/seed.sql`) e não vem da planilha —
 * é criada apenas dentro do banco de teste.
 */
export const OTHER_STORE = 'store-999-teste';

export const USERS = {
  manager: {
    id: '11111111-aaaa-4aaa-8aaa-111111111111',
    email: 'gerente124@teste.local',
    name: 'Gerente 124',
  },
  otherManager: {
    id: '22222222-bbbb-4bbb-8bbb-222222222222',
    email: 'gerente999@teste.local',
    name: 'Gerente 999',
  },
  supervisor: {
    id: '33333333-cccc-4ccc-8ccc-333333333333',
    email: 'supervisor@teste.local',
    name: 'Supervisor Rede',
  },
  admin: {
    id: '44444444-dddd-4ddd-8ddd-444444444444',
    email: 'admin@teste.local',
    name: 'Administrador',
  },
  orphan: {
    id: '55555555-eeee-4eee-8eee-555555555555',
    email: 'semperfil@teste.local',
    name: 'Sem Perfil',
  },
} as const;

/**
 * FASE 4 — os quatro perfis de gerência, com os escopos reais.
 *
 * IDs e e-mails são DE TESTE. Os usuários de verdade nascem no painel do
 * Supabase Auth, com senhas que o proprietário define e que nunca passam por
 * aqui. Estes existem só dentro do banco de teste, para a RLS ter em quem ser
 * exercitada.
 */
export const SCOPE_USERS = {
  paulo: {
    id: '66666666-1111-4111-8111-666666666666',
    email: 'paulo@teste.local',
    name: 'Paulo Sergio',
    role: 'SUPERVISOR',
    scope: 'DISTRICT',
    districtId: 'district-1',
    jobTitle: 'Gerente Distrital',
  },
  ericson: {
    id: '77777777-2222-4222-8222-777777777777',
    email: 'ericson@teste.local',
    name: 'Ericson Silva',
    role: 'SUPERVISOR',
    scope: 'DISTRICT',
    districtId: 'district-2',
    jobTitle: 'Gerente Distrital',
  },
  roberval: {
    id: '88888888-3333-4333-8333-888888888888',
    email: 'roberval@teste.local',
    name: 'Roberval',
    role: 'SUPERVISOR',
    scope: 'ALL',
    districtId: null,
    jobTitle: 'Gerente Geral',
  },
  jackson: {
    id: '99999999-4444-4444-8444-999999999999',
    email: 'jackson@teste.local',
    name: 'Jackson',
    role: 'ADMIN',
    scope: 'ALL',
    districtId: null,
    jobTitle: 'Administrador',
  },
} as const;

/**
 * A data ISO de N dias atrás, NA DATA OPERACIONAL DA BAHIA.
 *
 * Duas razões, e as duas doeram:
 *
 * 1. Data FIXA vira bomba-relógio de calendário. Desde que a RPC recusa enviar
 *    hoje, `2026-09-06` passa hoje e falha no dia 6 de setembro, quando ela
 *    deixa de ser passado.
 *
 * 2. E o "hoje" tem de ser o MESMO que as RPCs usam. Elas usam
 *    `quadro_business_date()` — a data civil da Bahia. Se o teste calculasse
 *    pelo relógio da máquina (UTC no CI), o intervalo entre 21h e meia-noite
 *    de Brasília produziria um "ontem" que para o banco ainda é hoje, e o teste
 *    falharia por motivo nenhum.
 */
export function daysAgo(days: number): string {
  const hoje = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bahia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const [ano, mes, dia] = hoje.split('-').map(Number);
  // Meio-dia local: nenhuma conversão de fuso atravessa a meia-noite.
  const date = new Date(ano, mes - 1, dia, 12, 0, 0, 0);
  date.setDate(date.getDate() - days);

  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

/** Volta ao superusuário e limpa a identidade — usado no preparo dos testes. */
export async function asSuperuser(client: Client): Promise<void> {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claim.sub', '', false)");
}

/** Assume um usuário autenticado, como o PostgREST faria com um JWT válido. */
export async function asUser(client: Client, userId: string): Promise<void> {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await client.query('set role authenticated');
}

/** Visitante sem token: é o que a chave anon entrega. */
export async function asAnon(client: Client): Promise<void> {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claim.sub', '', false)");
  await client.query('set role anon');
}

/**
 * Cria usuários, perfis e a loja de isolamento.
 * Idempotente: pode rodar em qualquer ordem, quantas vezes for preciso.
 */
export async function seedTestUsers(client: Client): Promise<void> {
  await asSuperuser(client);

  await client.query(
    `insert into public.quadro_stores (id, code, name, active)
     values ($1, '999', 'LOJA TESTE ISOLAMENTO', true)
     on conflict (id) do nothing`,
    [OTHER_STORE],
  );

  // A loja de teste recebe as mesmas funções, para o teste de isolamento
  // comparar lojas equivalentes.
  await client.query(
    `insert into public.quadro_store_staffing (id, store_id, position_id, authorized_quantity, effective_from)
     select 'staff-999-' || p.id, $1, p.id, null, date '2026-01-01'
       from public.quadro_positions p
     on conflict (id) do nothing`,
    [OTHER_STORE],
  );

  for (const user of Object.values(USERS)) {
    await client.query(
      `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`,
      [user.id, user.email],
    );
  }

  // `access_scope` é explícito desde a fase 4: o CHECK do banco exige que
  // STORE traga store_id, DISTRICT traga district_id e ALL não traga nenhum
  // dos dois. Deixar no default seria testar um perfil que não existe.
  const profiles: Array<[string, string, string, string | null, string]> = [
    [USERS.manager.id, USERS.manager.name, 'MANAGER', TEST_STORE, 'STORE'],
    [USERS.otherManager.id, USERS.otherManager.name, 'MANAGER', OTHER_STORE, 'STORE'],
    [USERS.supervisor.id, USERS.supervisor.name, 'SUPERVISOR', null, 'ALL'],
    [USERS.admin.id, USERS.admin.name, 'ADMIN', null, 'ALL'],
    // USERS.orphan NÃO recebe perfil: é o caso "autenticado mas sem acesso".
  ];

  for (const [id, name, role, storeId, scope] of profiles) {
    await client.query(
      `insert into public.quadro_profiles (id, name, role, store_id, active, access_scope)
       values ($1, $2, $3::public.quadro_profile_role, $4, true,
               $5::public.quadro_access_scope)
       on conflict (id) do update set name = excluded.name`,
      [id, name, role, storeId, scope],
    );
  }
}

/**
 * FASE 4 — cria os quatro perfis de gerência dentro do banco de teste.
 *
 * Só funciona depois das migrations 0013–0016 (distritos, escopo, RLS e rede).
 * Idempotente, como `seedTestUsers`.
 */
export async function seedScopeUsers(client: Client): Promise<void> {
  await asSuperuser(client);

  for (const user of Object.values(SCOPE_USERS)) {
    await client.query(
      `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`,
      [user.id, user.email],
    );

    await client.query(
      `insert into public.quadro_profiles
             (id, name, role, store_id, district_id, active, access_scope, job_title)
       values ($1, $2, $3::public.quadro_profile_role, null, $4, true,
               $5::public.quadro_access_scope, $6)
       on conflict (id) do update
          set name         = excluded.name,
              role         = excluded.role,
              district_id  = excluded.district_id,
              access_scope = excluded.access_scope,
              job_title    = excluded.job_title`,
      [user.id, user.name, user.role, user.districtId, user.scope, user.jobTitle],
    );
  }
}

/** Quantas lojas ATIVAS um distrito tem hoje. Lido do banco, nunca fixado. */
export async function countStoresOfDistrict(
  client: Client,
  districtId: string,
): Promise<number> {
  const { rows } = await client.query(
    'select count(*)::int as total from public.quadro_stores where district_id = $1 and active',
    [districtId],
  );
  return rows[0].total as number;
}

/** Apaga conferências das lojas de teste (audit_logs é append-only e permanece). */
export async function resetConferences(client: Client): Promise<void> {
  await asSuperuser(client);
  await client.query("select set_config('quadro.status_change', 'on', false)");
  await client.query('delete from public.quadro_daily_conferences where store_id = any($1)', [
    [TEST_STORE, OTHER_STORE],
  ]);
  await client.query("select set_config('quadro.status_change', 'off', false)");
}

/** Payload de itens no formato que a RPC espera (espelha SupabaseAdapter). */
export function rpcItems(
  items: Array<{
    positionId: string;
    absence?: number;
    dayOff?: number;
    observation?: string | null;
    reasons?: Array<{ reasonId: string; quantity: number; observation?: string | null }>;
  }>,
) {
  return items.map((item) => ({
    position_id: item.positionId,
    absence_quantity: item.absence ?? 0,
    day_off_quantity: item.dayOff ?? 0,
    observation: item.observation ?? null,
    reasons: (item.reasons ?? []).map((reason) => ({
      reason_id: reason.reasonId,
      quantity: reason.quantity,
      observation: reason.observation ?? null,
    })),
  }));
}

export async function saveDraft(
  client: Client,
  storeId: string,
  referenceDate: string,
  items: ReturnType<typeof rpcItems>,
): Promise<string> {
  const { rows } = await client.query(
    'select public.quadro_rpc_save_daily_conference_draft($1, $2::date, $3::jsonb) as id',
    [storeId, referenceDate, JSON.stringify(items)],
  );
  return rows[0].id as string;
}

export async function submitConference(client: Client, conferenceId: string) {
  const { rows } = await client.query(
    'select * from public.quadro_rpc_submit_daily_conference($1::uuid)',
    [conferenceId],
  );
  return rows[0] as {
    status: string;
    submitted_at: string | null;
    submitted_by: string | null;
    created_by: string;
  };
}

/**
 * Uma conferência HISTÓRICA, escrita direto nas tabelas.
 *
 * POR QUE NÃO PELA RPC
 * --------------------
 * Desde a correção da janela (0018), as RPCs recusam qualquer data anterior a
 * D-7 — e é essa a regra que elas existem para aplicar. As suítes de leitura
 * (Visão da Rede, analytics, RLS do supervisor) precisam de histórico de meses
 * atrás, longe das datas das outras suítes para não colidirem entre si.
 *
 * Usar a RPC para plantar esse histórico era abusar da porta da frente do
 * gerente: funcionava só porque o piso da janela ainda não existia. Escrever
 * direto é o retrato fiel do que existe num banco com meses de operação — essas
 * linhas foram gravadas quando as datas ainda estavam dentro da janela.
 *
 * Roda como SUPERUSUÁRIO e devolve a conexão nesse papel. O `status_change`
 * é aberto e FECHADO aqui dentro: é a porta estreita da 0007, e deixá-la aberta
 * contaminaria o teste seguinte.
 */
export async function seedHistoricalConference(
  client: Client,
  params: {
    storeId: string;
    referenceDate: string;
    createdBy?: string;
    status?: 'DRAFT' | 'SUBMITTED' | 'REOPENED';
    items: ReturnType<typeof rpcItems>;
  },
): Promise<string> {
  const {
    storeId,
    referenceDate,
    createdBy = USERS.manager.id,
    status = 'SUBMITTED',
    items,
  } = params;

  await asSuperuser(client);

  // Nasce DRAFT SEMPRE: o gatilho `quadro_daily_items_block_submitted` recusa
  // itens numa conferência já enviada, então a ordem aqui é a mesma da vida
  // real — abre, preenche, envia.
  const { rows } = await client.query(
    `insert into public.quadro_daily_conferences (store_id, reference_date, status, created_by)
     values ($1, $2::date, 'DRAFT', $3)
     returning id`,
    [storeId, referenceDate, createdBy],
  );
  const conferenceId = rows[0].id as string;

  for (const item of items) {
    const { rows: criado } = await client.query(
      `insert into public.quadro_daily_items
         (conference_id, position_id, absence_quantity, day_off_quantity, observation)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        conferenceId,
        item.position_id,
        item.absence_quantity,
        item.day_off_quantity,
        item.observation,
      ],
    );
    const itemId = criado[0].id as string;

    for (const reason of item.reasons) {
      await client.query(
        `insert into public.quadro_daily_item_reasons
           (daily_item_id, reason_id, quantity, observation)
         values ($1, $2, $3, $4)`,
        [itemId, reason.reason_id, reason.quantity, reason.observation],
      );
    }
  }

  if (status !== 'DRAFT') {
    await client.query("select set_config('quadro.status_change','on',false)");
    await client.query(
      `update public.quadro_daily_conferences
          set status = $2::public.quadro_conference_status,
              submitted_by = case when $2 = 'SUBMITTED' then $3::uuid else null end,
              submitted_at = case when $2 = 'SUBMITTED' then now() else null end
        where id = $1`,
      [conferenceId, status, createdBy],
    );
    await client.query("select set_config('quadro.status_change','off',false)");
  }

  return conferenceId;
}
