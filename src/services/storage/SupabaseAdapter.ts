import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConferenceStatus,
  DailyConference,
  DailyItem,
} from '@/types/domain';
import type { NetworkDayData } from '@/types/network';
import type { NetworkRangeData } from '@/types/analytics';
import type { StorageAdapter } from './StorageAdapter';

export interface ConferenceRow {
  id: string;
  store_id: string;
  reference_date: string;
  status: ConferenceStatus;
  created_by: string;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  /** Aninhado do PostgREST: array, objeto único, null ou ausente. */
  daily_items?: ItemRow | ItemRow[] | null;
}

interface ItemRow {
  id: string;
  position_id: string;
  absence_quantity: number;
  day_off_quantity: number;
  observation: string | null;
  daily_item_reasons?: ReasonRow | ReasonRow[] | null;
}

interface ReasonRow {
  id: string;
  reason_id: string;
  quantity: number;
  observation: string | null;
}

/**
 * SELECT da conferência com os itens e os motivos aninhados.
 *
 * Os ALIASES `daily_items:` e `daily_item_reasons:` são OBRIGATÓRIOS.
 *
 * Sem eles o PostgREST devolve o relacionamento na propriedade com o nome real
 * da tabela (`quadro_daily_items`), e o `toDomain`, que lê `row.daily_items`,
 * receberia `undefined`. Aqui o defeito NÃO quebrava a tela — o `?? []`
 * engolia o erro e a conferência voltava com ZERO itens, silenciosamente.
 * É o mesmo defeito que quebrou o catalogService, só que mudo.
 */
const CONFERENCE_SELECT = `
  id, store_id, reference_date, status, created_by, submitted_by,
  created_at, updated_at, submitted_at,
  daily_items:quadro_daily_items (
    id, position_id, absence_quantity, day_off_quantity, observation,
    daily_item_reasons:quadro_daily_item_reasons ( id, reason_id, quantity, observation )
  )
`;

/** O PostgREST pode devolver o aninhado como array, objeto único, null ou nada. */
function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Primeiro elemento de um aninhado que pode vir objeto, array, null ou faltar. */
function firstOf<T>(value: T | T[] | null | undefined): T | undefined {
  return toArray(value)[0];
}

/* =========================================================================
 * SELECTs da área CONFERÊNCIAS do supervisor (fase 3A)
 * ====================================================================== */

/**
 * Conferências do dia + QUEM ENVIOU.
 *
 * Duas coisas obrigatórias neste select, e por motivos diferentes:
 *
 * 1. O ALIAS `submitter:` — sem ele o PostgREST devolveria a propriedade com o
 *    nome da tabela (`quadro_profiles`) e o mapeamento receberia `undefined`.
 *    É o mesmo defeito que já quebrou o catalogService em produção.
 *
 * 2. O HINT DE FK `!quadro_daily_conferences_submitted_by_fkey` — este é NOVO
 *    e específico daqui. A tabela `quadro_daily_conferences` tem DUAS chaves
 *    estrangeiras para `quadro_profiles`:
 *
 *        quadro_daily_conferences_created_by_fkey    (created_by)
 *        quadro_daily_conferences_submitted_by_fkey  (submitted_by)
 *
 *    Com duas, o PostgREST não tem como adivinhar qual usar e recusa a
 *    consulta inteira ("more than one relationship was found"). O hint diz
 *    exatamente qual caminho seguir: quem ENVIOU, não quem criou.
 */
const NETWORK_CONFERENCE_SELECT = `
  id,
  store_id,
  reference_date,
  status,
  submitted_at,
  submitted_by,
  updated_at,
  submitter:quadro_profiles!quadro_daily_conferences_submitted_by_fkey (
    id,
    name
  )
`;

/**
 * View de itens: 1 linha por conferência × função.
 * FONTE ÚNICA de faltas e folgas.
 */
const NETWORK_ITEMS_SELECT = `
  conference_id,
  store_id,
  position_id,
  position_name,
  function_group,
  sector,
  absence_quantity,
  day_off_quantity,
  item_observation
`;

/**
 * View de motivos: 1 linha por conferência × função × motivo.
 *
 * `absence_quantity` NÃO é pedido de propósito. A view repete a função uma vez
 * por motivo; trazer o campo só criaria a chance de alguém somá-lo e obter o
 * dobro. O que interessa aqui é `reason_quantity`.
 */
const NETWORK_REASONS_SELECT = `
  conference_id,
  position_id,
  reason_id,
  reason_name,
  reason_quantity,
  reason_observation
`;

interface StoreRow {
  id: string;
  code: string;
  name: string;
  /** Null enquanto a loja não estiver ligada a um distrito. */
  district_id: string | null;
}

/**
 * Colunas de loja usadas pelas telas do supervisor.
 *
 * `district_id` vem daqui, do BANCO, e não da lista do frontend: a lista de
 * `@/data/network` existe só para a tela de login, que roda sem sessão. Depois
 * do login quem manda é `quadro_stores`, sob RLS.
 */
const NETWORK_STORE_SELECT = 'id, code, name, district_id';

/** Linha de `quadro_stores` -> `NetworkStoreRef`. */
function toStoreRef(row: StoreRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    districtId: row.district_id,
  };
}

interface ProfileRef {
  id: string;
  name: string;
}

interface NetworkConferenceDbRow {
  id: string;
  store_id: string;
  reference_date: string;
  status: ConferenceStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  updated_at: string | null;
  /** Aninhado do PostgREST: objeto, array, null ou ausente. */
  submitter?: ProfileRef | ProfileRef[] | null;
}

interface ItemViewRow {
  conference_id: string;
  store_id: string;
  position_id: string;
  position_name: string;
  function_group: string;
  sector: string | null;
  absence_quantity: number;
  day_off_quantity: number;
  item_observation: string | null;
}

interface ReasonViewRow {
  conference_id: string;
  position_id: string;
  reason_id: string;
  reason_name: string;
  reason_quantity: number;
  reason_observation: string | null;
}

/* =========================================================================
 * SELECTs da VISÃO DA REDE (fase 3B)
 * ====================================================================== */

/**
 * Único status que alimenta o dashboard analítico.
 *
 * As duas views trazem `status` e NÃO filtram nada — elas devolvem também as
 * linhas de conferências DRAFT e REOPENED. Sem este filtro, uma conferência
 * ainda em rascunho contava como PENDENTE na cobertura e, ao mesmo tempo,
 * tinha as faltas somadas no total. Reproduzido no PostgreSQL: 3 faltas
 * enviadas + 10 em rascunho apareciam como 13.
 *
 * Rascunho e reaberta continuam contando para COBERTURA e PENDÊNCIA (é
 * conferência que não chegou) e continuam visíveis na tela Conferências, que é
 * operacional. Só não são número oficial.
 *
 * Filtrar aqui reduz o tráfego. Mesmo assim o domínio refaz a checagem — ver
 * `submittedConferenceIds` em `domain/analytics.ts`.
 */
const OFFICIAL_STATUS = 'SUBMITTED';

/**
 * Conferências do período. SEM embed de propósito.
 *
 * O dashboard não mostra quem enviou — só conta quantas chegaram. Trazer o
 * perfil junto seria uma junção a mais em todas as linhas do período, sem
 * ninguém para ler o resultado.
 */
const RANGE_CONFERENCE_SELECT = `
  id,
  store_id,
  reference_date,
  status,
  submitted_at
`;

/**
 * Itens do período: conferência × função × dia.
 * FONTE ÚNICA de faltas e folgas — inclui `reference_date` para as séries.
 */
const RANGE_ITEMS_SELECT = `
  conference_id,
  store_id,
  store_name,
  reference_date,
  position_id,
  position_name,
  function_group,
  sector,
  absence_quantity,
  day_off_quantity,
  item_observation
`;

/**
 * Motivos do período.
 *
 * `absence_quantity` continua fora — a coluna nem existe nesta view no banco,
 * e o tipo `RangeReasonRow` também não a tem. A duplicação de faltas é
 * impossível pelas duas pontas.
 */
const RANGE_REASONS_SELECT = `
  conference_id,
  store_id,
  reference_date,
  position_id,
  reason_id,
  reason_name,
  reason_quantity,
  reason_observation
`;

interface RangeConferenceDbRow {
  id: string;
  store_id: string;
  reference_date: string;
  status: ConferenceStatus;
  submitted_at: string | null;
}

interface RangeItemDbRow {
  conference_id: string;
  store_id: string;
  store_name: string;
  reference_date: string;
  position_id: string;
  position_name: string;
  function_group: string;
  sector: string | null;
  absence_quantity: number;
  day_off_quantity: number;
  item_observation: string | null;
}

interface RangeReasonDbRow {
  conference_id: string;
  store_id: string;
  reference_date: string;
  position_id: string;
  reason_id: string;
  reason_name: string;
  reason_quantity: number;
  reason_observation: string | null;
}

/** snake_case do banco -> camelCase do domínio. */
export function toDomain(row: ConferenceRow): DailyConference {
  return {
    id: row.id,
    storeId: row.store_id,
    referenceDate: row.reference_date,
    status: row.status,
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    items: toArray(row.daily_items)
      .filter((item): item is ItemRow => item != null)
      .map((item) => ({
        id: item.id,
        positionId: item.position_id,
        absenceQuantity: item.absence_quantity,
        dayOffQuantity: item.day_off_quantity,
        observation: item.observation,
        reasons: toArray(item.daily_item_reasons)
          .filter((reason): reason is ReasonRow => reason != null)
          .map((reason) => ({
            id: reason.id,
            reasonId: reason.reason_id,
            quantity: reason.quantity,
            observation: reason.observation,
          })),
      })),
  };
}

/** camelCase do domínio -> payload JSONB das RPCs. */
function toRpcItems(items: DailyItem[]) {
  return items.map((item) => ({
    position_id: item.positionId,
    absence_quantity: item.absenceQuantity,
    day_off_quantity: item.dayOffQuantity,
    observation: item.observation,
    reasons: item.reasons
      .filter((reason) => reason.quantity > 0)
      .map((reason) => ({
        reason_id: reason.reasonId,
        quantity: reason.quantity,
        observation: reason.observation,
      })),
  }));
}

/**
 * Adaptador definitivo. Mesma interface do LocalStorageAdapter — trocar de um
 * para o outro é só preencher o .env; nenhuma tela muda.
 *
 * Toda ESCRITA passa por RPC transacional:
 *   - rascunho -> rpc_save_daily_conference_draft
 *   - envio    -> rpc_submit_daily_conference
 *
 * O adaptador NUNCA faz upsert direto em daily_conferences / daily_items /
 * daily_item_reasons. Fazia antes, e isso quebrava o envio: a conferência era
 * marcada SUBMITTED primeiro e o gatilho de imutabilidade recusava os itens em
 * seguida. Além disso, mandar ids do cliente reescrevia chaves primárias já
 * referenciadas por chave estrangeira.
 */
export class SupabaseAdapter implements StorageAdapter {
  readonly name = 'Supabase';

  constructor(private readonly client: SupabaseClient) {}

  async getConference(
    storeId: string,
    referenceDate: string,
  ): Promise<DailyConference | null> {
    const { data, error } = await this.client
      .from('quadro_daily_conferences')
      .select(CONFERENCE_SELECT)
      .eq('store_id', storeId)
      .eq('reference_date', referenceDate)
      .maybeSingle();

    if (error) throw new Error(`Falha ao carregar conferência: ${error.message}`);
    return data ? toDomain(data as ConferenceRow) : null;
  }

  /**
   * Salva o rascunho por RPC: uma única transação que grava conferência,
   * itens e motivos, remove funções que saíram do payload e reescreve os
   * motivos por completo (não sobra motivo órfão).
   */
  async saveConference(conference: DailyConference): Promise<DailyConference> {
    // p_created_by NÃO existe mais: a identidade vem de auth.uid() no banco.
    const { error } = await this.client.rpc('quadro_rpc_save_daily_conference_draft', {
      p_store_id: conference.storeId,
      p_reference_date: conference.referenceDate,
      p_items: toRpcItems(conference.items),
    });

    if (error) throw new Error(`Falha ao salvar rascunho: ${error.message}`);

    const saved = await this.getConference(conference.storeId, conference.referenceDate);
    if (!saved) throw new Error('Rascunho salvo mas não pôde ser recarregado.');
    return saved;
  }

  /**
   * Envio definitivo:
   *   1. garante que o último estado do rascunho está salvo;
   *   2. chama a RPC de envio (valida e carimba SUBMITTED na mesma transação);
   *   3. recarrega a conferência do banco.
   *
   * Se a validação do banco falhar, nada fica parcialmente enviado.
   */
  async submitConference(conference: DailyConference): Promise<DailyConference> {
    const draft = await this.saveConference(conference);

    const { error } = await this.client.rpc('quadro_rpc_submit_daily_conference', {
      p_conference_id: draft.id,
    });

    if (error) throw new Error(`Falha ao enviar conferência: ${error.message}`);

    const submitted = await this.getConference(draft.storeId, draft.referenceDate);
    if (!submitted) throw new Error('Conferência enviada mas não pôde ser recarregada.');
    if (submitted.status !== 'SUBMITTED') {
      throw new Error('O banco não confirmou o envio da conferência.');
    }
    return submitted;
  }

  /**
   * FASE 4.5 — resolução de justificativa pendente, por RPC.
   *
   * Uma chamada, uma transação. A RPC trava a linha de "Aguardando
   * justificativa" com `select ... for update`, revalida o saldo sob o lock e
   * grava a auditoria junto — se qualquer parte falhar, nada acontece.
   *
   * O frontend NUNCA faz UPDATE direto em `quadro_daily_item_reasons`: o
   * gatilho de conferência enviada recusaria, e é essa recusa que queremos
   * manter de pé. A porta é estreita e a RPC é a única com a chave.
   */
  async resolvePendingReason(params: {
    itemId: string;
    toReasonId: string;
    quantity: number;
    observation: string | null;
  }): Promise<void> {
    const { error } = await this.client.rpc('quadro_rpc_resolve_pending_absence_reason', {
      p_conference_item_id: params.itemId,
      p_to_reason_id: params.toReasonId,
      p_quantity: params.quantity,
      p_observation: params.observation,
    });

    if (error) throw new Error(`Falha ao resolver justificativa: ${error.message}`);
  }

  async listConferences(
    storeId: string,
    limit = 30,
    range?: { start: string; end: string },
  ): Promise<DailyConference[]> {
    let query = this.client
      .from('quadro_daily_conferences')
      .select(CONFERENCE_SELECT)
      .eq('store_id', storeId)
      .order('reference_date', { ascending: false });
    if (range) {
      query = query.gte('reference_date', range.start).lte('reference_date', range.end);
    }
    const { data, error } = await query.limit(limit);

    if (error) throw new Error(`Falha ao carregar histórico: ${error.message}`);
    return (data as ConferenceRow[] | null)?.map(toDomain) ?? [];
  }

  /**
   * Dia inteiro da rede, em quatro leituras paralelas.
   *
   * Nenhuma delas filtra por loja ou por perfil: a RLS já faz isso. O gerente
   * recebe só a própria loja, o supervisor recebe a rede — pela política do
   * banco, não por um `if` no navegador.
   */
  async getNetworkDay(referenceDate: string): Promise<NetworkDayData> {
    const [lojas, conferencias, itens, motivos] = await Promise.all([
      this.client.from('quadro_stores').select(NETWORK_STORE_SELECT).eq('active', true),
      this.client
        .from('quadro_daily_conferences')
        .select(NETWORK_CONFERENCE_SELECT)
        .eq('reference_date', referenceDate),
      this.client
        .from('quadro_v_conference_items')
        .select(NETWORK_ITEMS_SELECT)
        .eq('reference_date', referenceDate),
      this.client
        .from('quadro_v_conference_item_reasons')
        .select(NETWORK_REASONS_SELECT)
        .eq('reference_date', referenceDate),
    ]);

    const falha = lojas.error ?? conferencias.error ?? itens.error ?? motivos.error;
    if (falha) throw new Error(`Falha ao carregar as conferências do dia: ${falha.message}`);

    return {
      stores: ((lojas.data ?? []) as StoreRow[]).map(toStoreRef),
      conferences: ((conferencias.data ?? []) as unknown as NetworkConferenceDbRow[]).map(
        (row) => ({
          id: row.id,
          storeId: row.store_id,
          referenceDate: row.reference_date,
          status: row.status,
          submittedAt: row.submitted_at,
          submittedBy: row.submitted_by,
          // Nome do responsável: vem do embed em quadro_profiles, ou seja, do
          // BANCO. O navegador nunca informa quem enviou.
          submittedByName: firstOf(row.submitter)?.name ?? null,
          updatedAt: row.updated_at,
        }),
      ),
      items: ((itens.data ?? []) as ItemViewRow[]).map((row) => ({
        conferenceId: row.conference_id,
        storeId: row.store_id,
        positionId: row.position_id,
        positionName: row.position_name,
        functionGroup: row.function_group,
        sector: row.sector,
        absenceQuantity: row.absence_quantity,
        dayOffQuantity: row.day_off_quantity,
        observation: row.item_observation,
      })),
      // A view de motivos NÃO traz absence_quantity de propósito: o tipo
      // NetworkReasonRow não tem o campo, então somar faltas aqui não compila.
      reasons: ((motivos.data ?? []) as ReasonViewRow[]).map((row) => ({
        conferenceId: row.conference_id,
        positionId: row.position_id,
        reasonId: row.reason_id,
        reasonName: row.reason_name,
        reasonQuantity: row.reason_quantity,
        observation: row.reason_observation,
      })),
    };
  }

  /**
   * Período inteiro da rede — a fonte da Visão da Rede.
   *
   * QUATRO consultas, em paralelo, todas com filtro de data NO BANCO:
   *
   *   1. lojas ativas                          (sem filtro de data)
   *   2. conferências   [comparisonStart..end] (cobertura e pendências)
   *   3. itens          [comparisonStart..end] (faltas, folgas e o comparativo)
   *   4. motivos        [start..end]           (só o período analisado)
   *
   * Não existe consulta por loja nem por dia: nada de N+1, independentemente
   * de quantas lojas a rede tenha ou de quantos dias o período cubra.
   *
   * Os itens vão até `comparisonStart` para o comparativo com o período
   * anterior sair da mesma leitura — evita uma quinta consulta. Os motivos
   * ficam só no período analisado porque a comparação usa apenas os totais de
   * falta e folga.
   *
   * ÍNDICE RECOMENDADO (não criado por este sistema — decisão sua):
   *
   *     create index on public.quadro_daily_conferences (reference_date);
   *
   * O índice existente é `(store_id, reference_date desc)`, ótimo para a tela
   * do gerente, mas o filtro daqui é só por data. Com a rede pequena o
   * PostgreSQL varre a tabela sem custo perceptível; com dezenas de lojas e
   * meses de histórico, o índice por data passa a valer.
   */
  async getNetworkRange(params: {
    start: string;
    end: string;
    comparisonStart: string;
  }): Promise<NetworkRangeData> {
    const { start, end, comparisonStart } = params;
    // Quando não há comparação, `comparisonStart` chega igual a `start`.
    const inicioAmplo = comparisonStart < start ? comparisonStart : start;

    const [lojas, conferencias, itens, motivos] = await Promise.all([
      this.client.from('quadro_stores').select(NETWORK_STORE_SELECT).eq('active', true),
      this.client
        .from('quadro_daily_conferences')
        .select(RANGE_CONFERENCE_SELECT)
        .gte('reference_date', inicioAmplo)
        .lte('reference_date', end),
      this.client
        .from('quadro_v_conference_items')
        .select(RANGE_ITEMS_SELECT)
        .eq('status', OFFICIAL_STATUS)
        .gte('reference_date', inicioAmplo)
        .lte('reference_date', end),
      this.client
        .from('quadro_v_conference_item_reasons')
        .select(RANGE_REASONS_SELECT)
        .eq('status', OFFICIAL_STATUS)
        .gte('reference_date', start)
        .lte('reference_date', end),
    ]);

    const falha = lojas.error ?? conferencias.error ?? itens.error ?? motivos.error;
    if (falha) throw new Error(`Falha ao carregar o período: ${falha.message}`);

    return {
      stores: ((lojas.data ?? []) as StoreRow[]).map(toStoreRef),
      conferences: ((conferencias.data ?? []) as RangeConferenceDbRow[]).map((row) => ({
        id: row.id,
        storeId: row.store_id,
        referenceDate: row.reference_date,
        status: row.status,
        submittedAt: row.submitted_at,
      })),
      items: ((itens.data ?? []) as RangeItemDbRow[]).map((row) => ({
        conferenceId: row.conference_id,
        storeId: row.store_id,
        storeName: row.store_name,
        referenceDate: row.reference_date,
        positionId: row.position_id,
        positionName: row.position_name,
        functionGroup: row.function_group,
        sector: row.sector,
        absenceQuantity: row.absence_quantity,
        dayOffQuantity: row.day_off_quantity,
        observation: row.item_observation,
      })),
      reasons: ((motivos.data ?? []) as RangeReasonDbRow[]).map((row) => ({
        conferenceId: row.conference_id,
        storeId: row.store_id,
        referenceDate: row.reference_date,
        positionId: row.position_id,
        reasonId: row.reason_id,
        reasonName: row.reason_name,
        reasonQuantity: row.reason_quantity,
        observation: row.reason_observation,
      })),
    };
  }
}
