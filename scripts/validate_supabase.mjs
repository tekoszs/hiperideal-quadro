#!/usr/bin/env node
/**
 * VALIDAÇÃO PONTA A PONTA CONTRA UM SUPABASE REAL
 *
 * Usa SOMENTE a chave anon e o login dos usuários de teste — exatamente o
 * mesmo caminho do navegador (PostgREST + Supabase Auth). Nenhuma
 * service_role, nenhuma senha de banco.
 *
 * Uso:
 *   1. preencha .env.validacao (copie de .env.validacao.example)
 *   2. node scripts/validate_supabase.mjs
 *
 * O script NÃO altera estrutura. Ele só grava a conferência de uma data de
 * teste (por padrão 2026-01-02) na loja do gerente, para poder validar o
 * fluxo. Nada é inventado no catálogo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadEnvFile('.env.validacao');

const URL = process.env.SUPABASE_URL?.trim();
const ANON = process.env.SUPABASE_ANON_KEY?.trim();
const REFERENCE_DATE = (process.env.VALIDATION_DATE || '2026-01-02').trim();

const ACCOUNTS = {
  manager: {
    email: process.env.MANAGER_EMAIL?.trim(),
    password: process.env.MANAGER_PASSWORD,
    label: 'MANAGER',
  },
  supervisor: {
    email: process.env.SUPERVISOR_EMAIL?.trim(),
    password: process.env.SUPERVISOR_PASSWORD,
    label: 'SUPERVISOR',
  },
  admin: {
    email: process.env.ADMIN_EMAIL?.trim(),
    password: process.env.ADMIN_PASSWORD,
    label: 'ADMIN',
  },
};

if (!URL || !ANON) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_ANON_KEY. Veja .env.validacao.example.');
  process.exit(2);
}
if (/service_role/i.test(ANON) || ANON.length > 600) {
  console.error('A chave informada parece NÃO ser a anon. Use a chave anon/publishable.');
  process.exit(2);
}

const PADARIA = 'pos-atendente-alimentos-padaria';
const CAIXA = 'pos-operador-de-caixa';
const ATESTADO = 'reason-atestado-medico';
const INJUSTIFICADA = 'reason-falta-injustificada';

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
const results = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'='.repeat(72)}\n${name}\n${'='.repeat(72)}`);
}

function record(ok, label, detail = '') {
  results.push({ section: currentSection, ok, label, detail });
  const mark = ok ? 'OK   ' : 'FALHA';
  console.log(`[${mark}] ${label}${detail ? `\n         ↳ ${detail}` : ''}`);
}

/** Espera que a operação FALHE. Retorna a mensagem real do banco. */
async function expectDenied(label, run, matcher) {
  try {
    const { error } = await run();
    if (error) {
      const matched = !matcher || matcher.test(error.message);
      record(matched, label, `erro real: ${error.message}`);
      return error.message;
    }
    record(false, label, 'a operação foi PERMITIDA (deveria falhar)');
    return null;
  } catch (err) {
    const message = err?.message ?? String(err);
    const matched = !matcher || matcher.test(message);
    record(matched, label, `erro real: ${message}`);
    return message;
  }
}

function anonClient() {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

async function signIn(account) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) throw new Error(`login ${account.label} falhou: ${error.message}`);
  return { client, session: data.session, user: data.user };
}

// ---------------------------------------------------------------------------
// 1. Sem login (anon)
// ---------------------------------------------------------------------------
async function checkAnon() {
  section('1. ANON (sem login) — nada pode ser lido nem executado');
  const client = anonClient();

  for (const table of ['quadro_stores', 'quadro_positions', 'quadro_daily_conferences', 'quadro_profiles', 'quadro_audit_logs']) {
    const { data, error } = await client.from(table).select('*').limit(1);
    const blocked = Boolean(error) || (Array.isArray(data) && data.length === 0);
    record(blocked, `anon não lê ${table}`, error ? `erro real: ${error.message}` : 'retornou 0 linhas');
  }

  await expectDenied('anon não executa rpc_save_daily_conference_draft', () =>
    client.rpc('quadro_rpc_save_daily_conference_draft', {
      p_store_id: 'store-124',
      p_reference_date: REFERENCE_DATE,
      p_items: [],
    }),
  );

  await expectDenied('anon não executa rpc_submit_daily_conference', () =>
    client.rpc('quadro_rpc_submit_daily_conference', {
      p_conference_id: '00000000-0000-0000-0000-000000000000',
    }),
  );
}

// ---------------------------------------------------------------------------
// 2. Nomes reais dos parâmetros expostos pelo PostgREST
// ---------------------------------------------------------------------------
async function checkPostgrestContract() {
  section('2. POSTGREST — nomes reais dos parâmetros das RPCs');

  const response = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: ANON, Accept: 'application/openapi+json' },
  });

  if (!response.ok) {
    record(false, 'baixar a especificação OpenAPI do PostgREST', `HTTP ${response.status}`);
    return;
  }

  const spec = await response.json();
  const expected = {
    '/rpc/quadro_rpc_save_daily_conference_draft': ['p_store_id', 'p_reference_date', 'p_items'],
    '/rpc/quadro_rpc_submit_daily_conference': ['p_conference_id'],
  };

  for (const [path, params] of Object.entries(expected)) {
    const entry = spec.paths?.[path];
    if (!entry) {
      record(false, `RPC exposta em ${path}`, 'não encontrada na especificação');
      continue;
    }
    const body =
      entry.post?.parameters?.find((p) => p.in === 'body')?.schema?.properties ??
      spec.definitions?.[Object.keys(spec.definitions ?? {}).find((k) => path.includes(k)) ?? '']
        ?.properties ??
      {};
    const found = Object.keys(body);
    const ok = params.every((p) => found.includes(p));
    record(
      ok,
      `parâmetros de ${path.replace('/rpc/', '')}`,
      `esperado [${params.join(', ')}] · exposto [${found.join(', ') || '(vazio)'}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Login dos três perfis
// ---------------------------------------------------------------------------
async function checkLogins() {
  section('3. LOGIN — os três perfis');

  const bad = anonClient();
  const { error: badError } = await bad.auth.signInWithPassword({
    email: ACCOUNTS.manager.email,
    password: 'senha-propositalmente-errada',
  });
  record(
    Boolean(badError),
    'login com senha errada é recusado',
    badError ? `erro real: ${badError.message}` : 'foi aceito (grave)',
  );

  const sessions = {};
  for (const key of ['manager', 'supervisor', 'admin']) {
    const account = ACCOUNTS[key];
    if (!account.email) {
      record(false, `login ${account.label}`, 'credenciais não informadas no .env.validacao');
      continue;
    }
    try {
      const result = await signIn(account);
      sessions[key] = result;

      const { data: profile, error } = await result.client
        .from('quadro_profiles')
        .select('id, name, role, store_id, active')
        .eq('id', result.user.id)
        .maybeSingle();

      if (error || !profile) {
        record(false, `perfil de ${account.label}`, error?.message ?? 'sem linha em profiles');
        continue;
      }

      const roleOk = profile.role === account.label;
      const storeOk =
        account.label === 'MANAGER' ? profile.store_id !== null : profile.store_id === null;

      record(
        roleOk && storeOk && profile.active,
        `login ${account.label} + perfil correto`,
        `role=${profile.role} store_id=${profile.store_id ?? 'NULL'} active=${profile.active} nome="${profile.name}"`,
      );

      record(
        Boolean(result.session?.access_token && result.session?.refresh_token),
        `${account.label} recebe sessão com token de renovação`,
        `expires_in=${result.session?.expires_in}s`,
      );
    } catch (err) {
      record(false, `login ${account.label}`, err.message);
    }
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// 4. Catálogo visto pelo gerente
// ---------------------------------------------------------------------------
async function checkCatalog(managerClient) {
  section('4. CATÁLOGO — o que o gerente enxerga');

  const { data: stores } = await managerClient.from('quadro_stores').select('id, code, name');
  record(
    stores?.length === 1 && stores[0].code === '124',
    'gerente enxerga exatamente 1 loja (a dele)',
    `lojas: ${(stores ?? []).map((s) => `${s.code} - ${s.name}`).join(', ') || '(nenhuma)'}`,
  );

  const { data: positions } = await managerClient
    .from('quadro_positions')
    .select('id, name, function_group, sector')
    .order('display_order');

  record(positions?.length === 25, 'catálogo com 25 funções', `recebidas: ${positions?.length ?? 0}`);

  const groups = {
    'ATENDENTE ALIMENTOS': ['FATIADOS', 'FRUTAS', 'PADARIA'],
    'AUX. DE COZINHA': ['GALETERIA', 'REFEITÓRIO'],
    REPOSITOR: ['BAZAR', 'FRIOS', 'HORTI', 'MERCEARIA'],
  };

  for (const [group, sectors] of Object.entries(groups)) {
    const found = (positions ?? [])
      .filter((p) => p.function_group === group)
      .map((p) => p.sector)
      .sort();
    record(
      JSON.stringify(found) === JSON.stringify(sectors),
      `${group} continua separado por setor`,
      `setores: ${found.join(', ') || '(nenhum)'}`,
    );
  }

  const noLeParc = !(stores ?? []).some((s) => /le\s*parc/i.test(s.name));
  record(noLeParc, 'LE PARC não foi cadastrada', 'confirmado');

  const { data: reasons } = await managerClient.from('quadro_absence_reasons').select('id, name');
  record(reasons?.length === 8, '8 motivos de falta', `recebidos: ${reasons?.length ?? 0}`);
  record(
    !(reasons ?? []).some((r) => /folga/i.test(r.name)),
    'FOLGA não é motivo de falta',
    'confirmado',
  );

  return positions ?? [];
}

// ---------------------------------------------------------------------------
// 5. Fluxo do gerente: rascunho -> reload -> envio
// ---------------------------------------------------------------------------
function itemsPayload(list) {
  return list.map((item) => ({
    position_id: item.positionId,
    absence_quantity: item.absence ?? 0,
    day_off_quantity: item.dayOff ?? 0,
    observation: item.observation ?? null,
    reasons: (item.reasons ?? []).map((r) => ({
      reason_id: r.reasonId,
      quantity: r.quantity,
      observation: r.observation ?? null,
    })),
  }));
}

const CONFERENCE_SELECT = `
  id, store_id, reference_date, status, created_by, submitted_by,
  created_at, updated_at, submitted_at,
  quadro_daily_items ( id, position_id, absence_quantity, day_off_quantity, observation,
    quadro_daily_item_reasons ( id, reason_id, quantity, observation ) )
`;

async function checkManagerFlow(managerClient, managerUserId, storeId) {
  section('5. FLUXO DO GERENTE — rascunho, reload e envio');

  // Rascunho: 1 falta com atestado na PADARIA + 1 folga no CAIXA
  const { data: draftId, error: draftError } = await managerClient.rpc(
    'quadro_rpc_save_daily_conference_draft',
    {
      p_store_id: storeId,
      p_reference_date: REFERENCE_DATE,
      p_items: itemsPayload([
        { positionId: PADARIA, absence: 1, reasons: [{ reasonId: ATESTADO, quantity: 1 }] },
        { positionId: CAIXA, dayOff: 1 },
      ]),
    },
  );

  if (draftError) {
    record(false, 'salvar rascunho pela RPC', `erro real: ${draftError.message}`);
    return null;
  }
  record(Boolean(draftId), 'salvar rascunho pela RPC', `conference_id=${draftId}`);

  // "Reload": nova conexão, novo login, relê do banco
  const reloaded = await signIn(ACCOUNTS.manager);
  const { data: afterReload } = await reloaded.client
    .from('quadro_daily_conferences')
    .select(CONFERENCE_SELECT)
    .eq('store_id', storeId)
    .eq('reference_date', REFERENCE_DATE)
    .maybeSingle();

  const padariaItem = afterReload?.daily_items?.find((i) => i.position_id === PADARIA);
  const caixaItem = afterReload?.daily_items?.find((i) => i.position_id === CAIXA);

  record(
    afterReload?.status === 'DRAFT' &&
      padariaItem?.absence_quantity === 1 &&
      padariaItem?.daily_item_reasons?.[0]?.reason_id === ATESTADO &&
      caixaItem?.day_off_quantity === 1,
    'após recarregar, os dados continuam no Supabase',
    `status=${afterReload?.status} · padaria faltas=${padariaItem?.absence_quantity} motivo=${padariaItem?.daily_item_reasons?.[0]?.reason_id} · caixa folgas=${caixaItem?.day_off_quantity}`,
  );

  record(
    afterReload?.created_by === managerUserId,
    'created_by é o auth.uid() do gerente',
    `created_by=${afterReload?.created_by}`,
  );

  // Envio
  const { data: submitted, error: submitError } = await managerClient.rpc(
    'quadro_rpc_submit_daily_conference',
    { p_conference_id: draftId },
  );

  if (submitError) {
    record(false, 'enviar pela RPC', `erro real: ${submitError.message}`);
    return draftId;
  }

  const row = Array.isArray(submitted) ? submitted[0] : submitted;
  record(row?.status === 'SUBMITTED', 'envio muda status para SUBMITTED', `status=${row?.status}`);
  record(Boolean(row?.submitted_at), 'submitted_at preenchido', `submitted_at=${row?.submitted_at}`);
  record(
    row?.submitted_by === managerUserId,
    'submitted_by é o auth.uid() do gerente',
    `submitted_by=${row?.submitted_by}`,
  );

  return draftId;
}

// ---------------------------------------------------------------------------
// 6. Imutabilidade após o envio
// ---------------------------------------------------------------------------
async function checkImmutability(managerClient, conferenceId, storeId) {
  section('6. IMUTABILIDADE — conferência enviada');

  const { data: items } = await managerClient
    .from('quadro_daily_items')
    .select('id')
    .eq('conference_id', conferenceId);
  const itemId = items?.[0]?.id;

  await expectDenied('reenviar conferência já enviada', () =>
    managerClient.rpc('quadro_rpc_submit_daily_conference', { p_conference_id: conferenceId }),
  );

  await expectDenied('salvar rascunho sobre conferência enviada', () =>
    managerClient.rpc('quadro_rpc_save_daily_conference_draft', {
      p_store_id: storeId,
      p_reference_date: REFERENCE_DATE,
      p_items: itemsPayload([{ positionId: PADARIA }]),
    }),
  );

  // UPDATE direto pela API: a política de UPDATE não alcança a linha enviada
  const { data: patchedConf } = await managerClient
    .from('quadro_daily_conferences')
    .update({ status: 'DRAFT' })
    .eq('id', conferenceId)
    .select();
  record(
    (patchedConf ?? []).length === 0,
    'SUBMITTED -> DRAFT direto pela API não altera nada',
    `linhas afetadas: ${(patchedConf ?? []).length}`,
  );

  const { data: patchedDate } = await managerClient
    .from('quadro_daily_conferences')
    .update({ submitted_at: '2020-01-01T00:00:00Z' })
    .eq('id', conferenceId)
    .select();
  record(
    (patchedDate ?? []).length === 0,
    'submitted_at não pode ser adulterado pela API',
    `linhas afetadas: ${(patchedDate ?? []).length}`,
  );

  if (itemId) {
    const { data: patchedItem } = await managerClient
      .from('quadro_daily_items')
      .update({ absence_quantity: 99 })
      .eq('id', itemId)
      .select();
    record(
      (patchedItem ?? []).length === 0,
      'daily_items protegido após o envio',
      `linhas afetadas: ${(patchedItem ?? []).length}`,
    );

    const { data: patchedReason } = await managerClient
      .from('quadro_daily_item_reasons')
      .update({ quantity: 99 })
      .eq('daily_item_id', itemId)
      .select();
    record(
      (patchedReason ?? []).length === 0,
      'daily_item_reasons protegido após o envio',
      `linhas afetadas: ${(patchedReason ?? []).length}`,
    );

    const { data: deleted } = await managerClient
      .from('quadro_daily_items')
      .delete()
      .eq('id', itemId)
      .select();
    record(
      (deleted ?? []).length === 0,
      'DELETE em daily_items não remove nada após o envio',
      `linhas afetadas: ${(deleted ?? []).length}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 7. Auditoria
// ---------------------------------------------------------------------------
async function checkAudit(managerClient, supervisorClient, conferenceId, managerUserId) {
  section('7. AUDITORIA');

  const { data: asManager } = await managerClient.from('quadro_audit_logs').select('*');
  record(
    (asManager ?? []).length === 0,
    'gerente NÃO lê a auditoria global',
    `linhas visíveis: ${(asManager ?? []).length}`,
  );

  if (!supervisorClient) {
    record(false, 'auditoria pelo supervisor', 'supervisor não autenticado');
    return;
  }

  const { data: logs, error } = await supervisorClient
    .from('quadro_audit_logs')
    .select('action, user_id, store_id, metadata, created_at')
    .eq('entity_id', conferenceId)
    .order('created_at');

  if (error) {
    record(false, 'supervisor lê a auditoria', `erro real: ${error.message}`);
    return;
  }

  const actions = (logs ?? []).map((l) => l.action);
  record(
    actions.includes('CONFERENCE_DRAFT_SAVED') && actions.includes('CONFERENCE_SUBMITTED'),
    'auditoria registrou DRAFT_SAVED e SUBMITTED',
    `ações: ${actions.join(', ') || '(nenhuma)'}`,
  );
  record(
    (logs ?? []).every((l) => l.user_id === managerUserId),
    'todos os logs têm o usuário real do gerente',
    `user_id: ${[...new Set((logs ?? []).map((l) => l.user_id))].join(', ')}`,
  );

  const submitLog = (logs ?? []).find((l) => l.action === 'CONFERENCE_SUBMITTED');
  record(
    submitLog?.metadata?.total_absences === 1 && submitLog?.metadata?.total_day_offs === 1,
    'metadata do envio traz os totais',
    `metadata: ${JSON.stringify(submitLog?.metadata ?? {})}`,
  );

  await expectDenied('audit_logs não aceita UPDATE', () =>
    managerClient.from('quadro_audit_logs').update({ action: 'FORJADO' }).eq('entity_id', conferenceId).select(),
  );

  await expectDenied('não é possível gravar log em nome de outro usuário', () =>
    managerClient.from('quadro_audit_logs').insert({
      user_id: '00000000-0000-0000-0000-000000000000',
      action: 'FORJADO',
      entity: 'quadro_daily_conferences',
      entity_id: conferenceId,
    }),
  );
}

// ---------------------------------------------------------------------------
// 8. Privilégios do próprio perfil
// ---------------------------------------------------------------------------
async function checkSelfPrivileges(managerClient, managerUserId) {
  section('8. PRIVILÉGIOS — gerente não se promove');

  await expectDenied(
    'gerente não muda a própria role',
    () => managerClient.from('quadro_profiles').update({ role: 'ADMIN' }).eq('id', managerUserId).select(),
    /role|permitida|permission/i,
  );

  await expectDenied(
    'gerente não muda o próprio store_id',
    () =>
      managerClient
        .from('quadro_profiles')
        .update({ store_id: 'store-inexistente' })
        .eq('id', managerUserId)
        .select(),
    /loja|permitida|permission|violates/i,
  );

  const { data: others } = await managerClient.from('quadro_profiles').select('id');
  record(
    (others ?? []).length === 1 && others[0].id === managerUserId,
    'gerente só enxerga o próprio perfil',
    `perfis visíveis: ${(others ?? []).length}`,
  );
}

// ---------------------------------------------------------------------------
// 9. Supervisor e admin
// ---------------------------------------------------------------------------
async function checkSupervisorAndAdmin(sessions, storeId, conferenceId) {
  section('9. SUPERVISOR e ADMIN');

  for (const key of ['supervisor', 'admin']) {
    const entry = sessions[key];
    if (!entry) {
      record(false, `${ACCOUNTS[key].label} autenticado`, 'não foi possível entrar');
      continue;
    }
    const label = ACCOUNTS[key].label;

    const { data: conferences } = await entry.client
      .from('quadro_daily_conferences')
      .select('id, store_id, status')
      .eq('id', conferenceId);
    record(
      (conferences ?? []).length === 1,
      `${label} lê a conferência enviada da loja`,
      `status=${conferences?.[0]?.status ?? '(não viu)'}`,
    );

    const { data: positions } = await entry.client.from('quadro_positions').select('id');
    record((positions ?? []).length >= 25, `${label} lê as funções`, `${positions?.length ?? 0} funções`);

    await expectDenied(
      `${label} NÃO salva conferência (perfil elevado não dá escrita)`,
      () =>
        entry.client.rpc('quadro_rpc_save_daily_conference_draft', {
          p_store_id: storeId,
          p_reference_date: REFERENCE_DATE,
          p_items: itemsPayload([{ positionId: PADARIA, dayOff: 1 }]),
        }),
      /permiss/i,
    );

    await expectDenied(
      `${label} NÃO envia conferência`,
      () => entry.client.rpc('quadro_rpc_submit_daily_conference', { p_conference_id: conferenceId }),
      /permiss|enviada/i,
    );

    const { data: patched } = await entry.client
      .from('quadro_daily_conferences')
      .update({ status: 'DRAFT' })
      .eq('id', conferenceId)
      .select();
    record(
      (patched ?? []).length === 0,
      `${label} não altera conferência enviada`,
      `linhas afetadas: ${(patched ?? []).length}`,
    );
  }

  const supervisorProfiles = sessions.supervisor
    ? await sessions.supervisor.client.from('quadro_profiles').select('id, role')
    : { data: null };
  record(
    (supervisorProfiles.data ?? []).length >= 3,
    'SUPERVISOR enxerga os perfis da rede',
    `perfis visíveis: ${(supervisorProfiles.data ?? []).length}`,
  );
}

// ---------------------------------------------------------------------------
// 10. Views analíticas — o teste da duplicação
// ---------------------------------------------------------------------------
async function checkViews(managerClient, supervisorClient, storeId) {
  section('10. VIEWS ANALÍTICAS — 3 faltas em 2 motivos não podem virar 6');

  const viewDate = REFERENCE_DATE.replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) =>
    `${y}-${m}-${String(Number(d) + 1).padStart(2, '0')}`,
  );

  const { data: conferenceId, error } = await managerClient.rpc(
    'quadro_rpc_save_daily_conference_draft',
    {
      p_store_id: storeId,
      p_reference_date: viewDate,
      p_items: itemsPayload([
        {
          positionId: CAIXA,
          absence: 3,
          dayOff: 1,
          reasons: [
            { reasonId: ATESTADO, quantity: 2 },
            { reasonId: INJUSTIFICADA, quantity: 1 },
          ],
        },
      ]),
    },
  );

  if (error) {
    record(false, 'preparar cenário de 3 faltas em 2 motivos', `erro real: ${error.message}`);
    return;
  }

  await managerClient.rpc('quadro_rpc_submit_daily_conference', { p_conference_id: conferenceId });

  const { data: byPosition } = await managerClient
    .from('quadro_v_conference_items')
    .select('absence_quantity, day_off_quantity, position_name')
    .eq('conference_id', conferenceId);

  const totalAbsences = (byPosition ?? []).reduce((sum, r) => sum + r.absence_quantity, 0);
  record(
    (byPosition ?? []).length === 1 && totalAbsences === 3,
    'v_conference_items: 1 linha por função, soma = 3 faltas',
    `linhas=${byPosition?.length} soma=${totalAbsences}`,
  );

  const { data: byReason } = await managerClient
    .from('quadro_v_conference_item_reasons')
    .select('reason_name, reason_quantity')
    .eq('conference_id', conferenceId);

  const totalReasons = (byReason ?? []).reduce((sum, r) => sum + r.reason_quantity, 0);
  record(
    (byReason ?? []).length === 2 && totalReasons === 3,
    'v_conference_item_reasons: 2 linhas, soma dos motivos = 3',
    `${(byReason ?? []).map((r) => `${r.reason_quantity} ${r.reason_name}`).join(' + ')} = ${totalReasons}`,
  );

  record(
    totalAbsences === totalReasons && totalAbsences !== 6,
    'os dois totais batem em 3 — NUNCA 6',
    `faltas=${totalAbsences} motivos=${totalReasons}`,
  );

  if (supervisorClient) {
    const { data: supervisorView } = await supervisorClient
      .from('quadro_v_conference_items')
      .select('store_id')
      .eq('conference_id', conferenceId);
    record(
      (supervisorView ?? []).length === 1,
      'supervisor lê as views (RLS através da view funciona)',
      `linhas: ${supervisorView?.length ?? 0}`,
    );
  }

  const anon = anonClient();
  const { data: anonView, error: anonError } = await anon
    .from('quadro_v_conference_items')
    .select('*')
    .limit(1);
  record(
    Boolean(anonError) || (anonView ?? []).length === 0,
    'anon não lê as views (security_invoker respeitado)',
    anonError ? `erro real: ${anonError.message}` : 'retornou 0 linhas',
  );
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Supabase: ${URL}`);
  console.log(`Data de referência de teste: ${REFERENCE_DATE}`);

  await checkAnon();
  await checkPostgrestContract();

  const sessions = await checkLogins();
  const manager = sessions.manager;

  if (!manager) {
    console.error('\nSem sessão de MANAGER não é possível seguir. Corrija o login e rode de novo.');
  } else {
    const { data: profile } = await manager.client
      .from('quadro_profiles')
      .select('store_id')
      .eq('id', manager.user.id)
      .maybeSingle();
    const storeId = profile?.store_id;

    await checkCatalog(manager.client);
    const conferenceId = await checkManagerFlow(manager.client, manager.user.id, storeId);

    if (conferenceId) {
      await checkImmutability(manager.client, conferenceId, storeId);
      await checkAudit(
        manager.client,
        sessions.supervisor?.client,
        conferenceId,
        manager.user.id,
      );
      await checkSupervisorAndAdmin(sessions, storeId, conferenceId);
    }

    await checkSelfPrivileges(manager.client, manager.user.id);
    await checkViews(manager.client, sessions.supervisor?.client, storeId);
  }

  // Resumo
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\n${'='.repeat(72)}\nRESUMO\n${'='.repeat(72)}`);
  console.log(`Aprovadas: ${passed}   Reprovadas: ${failed.length}   Total: ${results.length}`);

  if (failed.length > 0) {
    console.log('\nReprovadas:');
    for (const item of failed) {
      console.log(`  [${item.section}] ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log('\nSupabase real validado ponta a ponta.');
  }
}

main().catch((err) => {
  console.error('\nErro não tratado durante a validação:', err);
  process.exit(1);
});
