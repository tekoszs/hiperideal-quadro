// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PROFILE } from '@/lib/demo';
import { STORES } from '@/data/catalog';
import { ROLE_LABEL } from '@/types/auth';
import {
  setAbsenceQuantity,
  setDayOffQuantity,
  setReasonQuantity,
} from '@/domain/conferenceFactory';
import {
  LocalStorageAdapter,
  MemoryStore,
  setStorageAdapter,
} from '@/services/storage';
import { listHistory, saveDraft, submitConference } from '@/services/conferenceService';
import {
  POSITION_CAIXA,
  POSITION_PADARIA,
  REASON_ATESTADO,
  TEST_POSITIONS,
  TEST_REASONS,
  makeDraft,
} from './fixtures';

const CONTEXT = { positions: TEST_POSITIONS, reasons: TEST_REASONS };

// TESTE 16 — modo demo funciona sem .env do Supabase.
describe('Modo demonstração (sem .env do Supabase)', () => {
  it('getAuthMode retorna DEMO quando não há variáveis configuradas', async () => {
    // O ambiente de teste não define VITE_SUPABASE_URL/ANON_KEY.
    const { getAuthMode } = await import('@/services/authService');
    expect(getAuthMode()).toBe('DEMO');
  });

  it('o perfil demo é gerente da loja vinda da planilha', () => {
    expect(DEMO_PROFILE.role).toBe('MANAGER');
    expect(DEMO_PROFILE.storeId).toBe(STORES[0].id);
    // Nenhuma loja fictícia: a loja demo é a mesma do catálogo importado.
    expect(STORES.some((store) => store.id === DEMO_PROFILE.storeId)).toBe(true);
  });

  it('o id do perfil demo é um UUID (compatível com as colunas uuid)', () => {
    expect(DEMO_PROFILE.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('não existe cliente Supabase quando o .env está vazio', async () => {
    const { getSupabaseClient, isSupabaseConfigured } = await import('@/lib/supabaseClient');
    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseClient()).toBeNull();
  });

  it('signIn é recusado no modo demo (não há autenticação falsa)', async () => {
    const { signIn } = await import('@/services/authService');
    await expect(signIn('alguem@teste.com', 'senha')).rejects.toThrow(
      /Supabase não configurado/i,
    );
  });
});

/**
 * FASE 4 — o seletor de perfil da demonstração (`?demo=`).
 *
 * Existe para as telas de supervisão poderem ser abertas num navegador de
 * verdade. A pergunta perigosa é "isso não vira uma forma de escalar
 * privilégio?", e a resposta tem de ser verificável, não uma promessa: o
 * último teste liga o Supabase e mostra que a URL deixa de ter qualquer efeito.
 */
describe('Perfil da demonstração escolhido pela URL', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/supabaseClient');
  });

  it('sem parâmetro, continua sendo o gerente de loja', async () => {
    const { demoScopeFromLocation, demoProfileFor } = await import('@/lib/demo');
    const perfil = demoProfileFor(demoScopeFromLocation(''));
    expect(perfil.accessScope).toBe('STORE');
    expect(perfil.role).toBe('MANAGER');
  });

  it('?demo=rede vira gerência da rede; ?demo=distrito vira distrital', async () => {
    const { demoScopeFromLocation, demoProfileFor } = await import('@/lib/demo');

    const rede = demoProfileFor(demoScopeFromLocation('?demo=rede'));
    expect(rede.accessScope).toBe('ALL');
    expect(rede.storeId).toBeNull();

    const distrito = demoProfileFor(demoScopeFromLocation('?demo=distrito'));
    expect(distrito.accessScope).toBe('DISTRICT');
    expect(distrito.districtId).toBe('district-1');
    expect(distrito.storeId).toBeNull();
  });

  it('valor desconhecido cai no padrão, sem erro', async () => {
    const { demoScopeFromLocation } = await import('@/lib/demo');
    for (const busca of ['?demo=admin', '?demo=ALL', '?demo=', '?outro=1']) {
      expect(demoScopeFromLocation(busca)).toBe('loja');
    }
  });

  // O TESTE QUE IMPORTA: com Supabase ligado, a URL não manda em nada.
  it('com o Supabase configurado, ?demo= é ignorado por completo', async () => {
    vi.doMock('@/lib/supabaseClient', () => ({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => null,
    }));

    const anterior = window.location.search;
    try {
      window.history.replaceState({}, '', '?demo=rede');

      const { getDemoProfile } = await import('@/services/authService');
      const perfil = getDemoProfile();

      expect(perfil.accessScope).toBe('STORE');
      expect(perfil.role).toBe('MANAGER');
      expect(perfil.storeId).toBe(DEMO_PROFILE.storeId);
    } finally {
      window.history.replaceState({}, '', anterior || '/');
    }
  });
});

describe('Fluxo completo do gerente no modo demo', () => {
  beforeEach(() => {
    setStorageAdapter(new LocalStorageAdapter(new MemoryStore()));
  });

  afterEach(() => {
    setStorageAdapter(null);
  });

  it('salva rascunho, envia e monta o histórico sem Supabase', async () => {
    let conference = makeDraft('2026-09-05');
    conference = { ...conference, createdBy: DEMO_PROFILE.id };
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    conference = setDayOffQuantity(conference, POSITION_CAIXA, 3);

    const draft = await saveDraft(conference);
    expect(draft.status).toBe('DRAFT');

    const sent = await submitConference(draft, CONTEXT);
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error('deveria ter enviado');
    expect(sent.conference.status).toBe('SUBMITTED');

    const history = await listHistory('store-124');
    expect(history[0]).toMatchObject({
      referenceDate: '2026-09-05',
      totalAbsences: 1,
      totalDayOffs: 3,
      status: 'SUBMITTED',
    });
  });

  it('a auditoria local registra os dois eventos com o usuário do perfil demo', async () => {
    const adapter = new LocalStorageAdapter(new MemoryStore());
    setStorageAdapter(adapter);

    let conference = makeDraft('2026-09-05');
    conference = { ...conference, createdBy: DEMO_PROFILE.id };
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);

    await saveDraft(conference);
    await submitConference(conference, CONTEXT);

    const logs = adapter.readAuditLog();
    expect(logs.map((log) => log.action)).toEqual([
      'CONFERENCE_DRAFT_SAVED',
      'CONFERENCE_SUBMITTED',
    ]);
    expect(logs.every((log) => log.userId === DEMO_PROFILE.id)).toBe(true);
    expect(logs.every((log) => log.storeId === 'store-124')).toBe(true);
  });

  it('os dados demo ficam só no armazenamento local injetado', async () => {
    const store = new MemoryStore();
    setStorageAdapter(new LocalStorageAdapter(store));

    const conference = setDayOffQuantity(makeDraft('2026-09-04'), POSITION_CAIXA, 2);
    await saveDraft(conference);

    expect(store.getItem('hiperideal.quadro.conferences.v1')).toContain('2026-09-04');

    // Um armazenamento novo começa vazio: nada vazou para fora.
    const outro = new MemoryStore();
    setStorageAdapter(new LocalStorageAdapter(outro));
    expect(await listHistory('store-124')).toEqual([]);
  });
});

// TESTE 17 — restauração de sessão.
describe('Restauração de sessão', () => {
  const modules = { supabaseClient: '@/lib/supabaseClient' };

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock(modules.supabaseClient);
  });

  it('sem sessão salva, o estado vai para SIGNED_OUT', async () => {
    vi.doMock(modules.supabaseClient, () => ({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null }, error: null }),
        },
      }),
    }));

    const { getCurrentSession } = await import('@/services/authService');
    expect(await getCurrentSession()).toBeNull();
  });

  it('com sessão salva, o perfil é relido do BANCO (role não vem do navegador)', async () => {
    const session = {
      user: { id: '11111111-aaaa-4aaa-8aaa-111111111111', email: 'gerente@hiperideal.com' },
    };

    vi.doMock(modules.supabaseClient, () => ({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => ({
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: session.user.id,
                  name: 'Maria Silva',
                  role: 'MANAGER',
                  store_id: 'store-124',
                  active: true,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const { getCurrentSession, loadProfile } = await import('@/services/authService');
    const restored = await getCurrentSession();
    expect(restored).not.toBeNull();

    const profile = await loadProfile(restored as never);
    expect(profile).toMatchObject({
      name: 'Maria Silva',
      role: 'MANAGER',
      storeId: 'store-124',
      email: 'gerente@hiperideal.com',
    });
  });

  it('usuário autenticado sem perfil ativo devolve null (RLS não libera nada)', async () => {
    const session = { user: { id: '55555555-eeee-4eee-8eee-555555555555', email: 'x@y.com' } };

    vi.doMock(modules.supabaseClient, () => ({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => ({
        auth: { getSession: async () => ({ data: { session }, error: null }) },
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    }));

    const { loadProfile } = await import('@/services/authService');
    expect(await loadProfile(session as never)).toBeNull();
  });

  it('perfil inativo também é tratado como sem acesso', async () => {
    const session = { user: { id: '66666666-ffff-4fff-8fff-666666666666', email: 'z@y.com' } };

    vi.doMock(modules.supabaseClient, () => ({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => ({
        auth: { getSession: async () => ({ data: { session }, error: null }) },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: session.user.id,
                  name: 'Desativado',
                  role: 'MANAGER',
                  store_id: 'store-124',
                  active: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));

    const { loadProfile } = await import('@/services/authService');
    expect(await loadProfile(session as never)).toBeNull();
  });
});

describe('Rótulos de perfil', () => {
  it('cobrem os três papéis', () => {
    expect(ROLE_LABEL).toEqual({
      MANAGER: 'Gerente',
      SUPERVISOR: 'Supervisor',
      ADMIN: 'Administrador',
    });
  });
});
