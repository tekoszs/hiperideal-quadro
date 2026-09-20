import type { AuditAction, AuditLog, DailyConference } from '@/types/domain';
import type { NetworkDayData, NetworkItemRow, NetworkReasonRow } from '@/types/network';
import type {
  NetworkRangeData,
  RangeItemRow,
  RangeReasonRow,
} from '@/types/analytics';
import { createId } from '@/domain/conferenceFactory';
import { POSITIONS, STORES } from '@/data/catalog';
import { NETWORK_STORES } from '@/data/network';
import { getReasonById, PENDING_REASON_ID } from '@/data/absenceReasons';
import type { StorageAdapter } from './StorageAdapter';

const CONFERENCES_KEY = 'hiperideal.quadro.conferences.v1';
const AUDIT_KEY = 'hiperideal.quadro.audit.v1';

/**
 * Lojas do modo demonstração como as telas do supervisor esperam.
 *
 * O distrito vem da REDE OFICIAL (`@/data/network`), casado pelo id da loja.
 * No Supabase esse dado vem de `quadro_stores.district_id`; aqui, sem banco,
 * a lista gerada é a única fonte que existe. Loja de demonstração que não
 * esteja na rede oficial fica com `districtId: null` e aparece só em
 * "Todos os distritos" — nunca é chutada para um distrito qualquer.
 */
function demoStoreRefs() {
  return STORES.filter((store) => store.active).map((store) => ({
    id: store.id,
    code: store.code,
    name: store.name,
    districtId: NETWORK_STORES.find((oficial) => oficial.id === store.id)?.districtId ?? null,
  }));
}

/** Contrato mínimo de Storage — permite injetar um mock nos testes. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Store em memória usada quando não há `window.localStorage` (SSR, testes). */
export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function resolveDefaultStore(): KeyValueStore {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__hiperideal_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // Navegação privada ou storage bloqueado: cai para memória.
  }
  return new MemoryStore();
}

/**
 * Persistência temporária da fase 1.
 * Guarda as conferências por `storeId::referenceDate`.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'LocalStorage (temporário)';

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore = resolveDefaultStore()) {
    this.store = store;
  }

  private readAll(): Record<string, DailyConference> {
    try {
      const raw = this.store.getItem(CONFERENCES_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, DailyConference>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private writeAll(data: Record<string, DailyConference>): void {
    this.store.setItem(CONFERENCES_KEY, JSON.stringify(data));
  }

  private static keyOf(storeId: string, referenceDate: string): string {
    return `${storeId}::${referenceDate}`;
  }

  async getConference(
    storeId: string,
    referenceDate: string,
  ): Promise<DailyConference | null> {
    const all = this.readAll();
    return all[LocalStorageAdapter.keyOf(storeId, referenceDate)] ?? null;
  }

  async saveConference(conference: DailyConference): Promise<DailyConference> {
    const stored = await this.getConference(conference.storeId, conference.referenceDate);
    if (stored?.status === 'SUBMITTED') {
      throw new Error('Conferência já enviada: edição bloqueada.');
    }

    // Espelha a RPC de rascunho: o status nunca vira SUBMITTED por aqui.
    const draft: DailyConference = {
      ...conference,
      status: conference.status === 'REOPENED' ? 'REOPENED' : 'DRAFT',
      submittedAt: null,
    };

    const all = this.readAll();
    all[LocalStorageAdapter.keyOf(draft.storeId, draft.referenceDate)] = draft;
    this.writeAll(all);
    // Espelha a auditoria que a RPC grava no Supabase.
    this.appendAuditLog('CONFERENCE_DRAFT_SAVED', draft);
    return draft;
  }

  /** Espelha `rpc_submit_daily_conference`: salva, valida o status e carimba. */
  async submitConference(conference: DailyConference): Promise<DailyConference> {
    const stored = await this.getConference(conference.storeId, conference.referenceDate);
    if (stored?.status === 'SUBMITTED') {
      throw new Error(`Conferência já enviada em ${stored.submittedAt ?? '—'}.`);
    }

    if (conference.items.length === 0) {
      throw new Error('Conferência sem itens persistidos: salve o rascunho antes de enviar.');
    }

    const submittedAt = new Date().toISOString();
    const submitted: DailyConference = {
      ...conference,
      status: 'SUBMITTED',
      submittedAt,
      updatedAt: submittedAt,
    };

    const all = this.readAll();
    all[LocalStorageAdapter.keyOf(submitted.storeId, submitted.referenceDate)] = submitted;
    this.writeAll(all);
    this.appendAuditLog('CONFERENCE_SUBMITTED', submitted);
    return submitted;
  }

  async listConferences(
    storeId: string,
    limit = 30,
    range?: { start: string; end: string },
  ): Promise<DailyConference[]> {
    return Object.values(this.readAll())
      .filter((conference) => conference.storeId === storeId)
      .filter((conference) => !range || (conference.referenceDate >= range.start && conference.referenceDate <= range.end))
      .sort((a, b) => b.referenceDate.localeCompare(a.referenceDate))
      .slice(0, limit);
  }

  /**
   * Espelha `quadro_rpc_resolve_pending_absence_reason`.
   *
   * As MESMAS recusas da RPC, na mesma ordem: conferência precisa estar
   * enviada, o motivo de destino não pode ser o provisório, e não se resolve
   * mais do que está pendente. Se o modo demonstração aceitasse o que o
   * Supabase recusa, a tela aprenderia a mentir — e o erro só apareceria em
   * produção.
   *
   * O que aqui é aritmética simples, no banco é uma transação com
   * `select ... for update`: aqui não há concorrência, porque é um navegador só.
   */
  async resolvePendingReason(params: {
    itemId: string;
    toReasonId: string;
    quantity: number;
    observation: string | null;
  }): Promise<void> {
    if (params.quantity <= 0) {
      throw new Error('Quantidade a resolver precisa ser maior que zero.');
    }
    if (params.toReasonId === PENDING_REASON_ID) {
      throw new Error('O motivo de destino não pode ser "Aguardando justificativa".');
    }

    const destino = getReasonById(params.toReasonId);
    if (!destino || !destino.active) {
      throw new Error(`Motivo de destino inválido: ${params.toReasonId}.`);
    }
    const observation = params.observation?.trim() ? params.observation.trim() : null;
    if (destino.requiresObservation && !observation) {
      throw new Error(`O motivo "${destino.name}" exige observação.`);
    }

    const all = this.readAll();
    const conference = Object.values(all).find((candidate) =>
      candidate.items.some((item) => item.id === params.itemId),
    );
    if (!conference) {
      throw new Error(`Lançamento não encontrado: ${params.itemId}.`);
    }
    if (conference.status !== 'SUBMITTED') {
      throw new Error(
        'A resolução de justificativa só existe para conferência enviada ' +
          `(status atual: ${conference.status}).`,
      );
    }

    const item = conference.items.find((candidate) => candidate.id === params.itemId)!;
    const pendente = item.reasons.find((reason) => reason.reasonId === PENDING_REASON_ID);

    if (!pendente || pendente.quantity <= 0) {
      throw new Error('Não há falta aguardando justificativa neste lançamento.');
    }
    if (pendente.quantity < params.quantity) {
      throw new Error(
        `Só há ${pendente.quantity} falta(s) aguardando justificativa; ` +
          `foi pedido resolver ${params.quantity}.`,
      );
    }

    const restante = pendente.quantity - params.quantity;
    const destinoExistente = item.reasons.find(
      (reason) => reason.reasonId === params.toReasonId,
    );

    const reasons = item.reasons
      // Motivo zerado sai da lista, como a RPC faz.
      .filter((reason) => reason.reasonId !== PENDING_REASON_ID || restante > 0)
      .map((reason) => {
        if (reason.reasonId === PENDING_REASON_ID) {
          return { ...reason, quantity: restante };
        }
        if (reason.reasonId === params.toReasonId) {
          return {
            ...reason,
            quantity: reason.quantity + params.quantity,
            observation: observation ?? reason.observation,
          };
        }
        return reason;
      });

    if (!destinoExistente) {
      reasons.push({
        id: `reason-${params.itemId}-${params.toReasonId}`,
        reasonId: params.toReasonId,
        quantity: params.quantity,
        observation,
      });
    }

    // A INVARIANTE, conferida também aqui: o total de faltas não pode ter
    // mudado. Se algum dia isto disparar, é bug — e nada é gravado.
    const total = reasons.reduce((soma, reason) => soma + reason.quantity, 0);
    if (total !== item.absenceQuantity) {
      throw new Error(
        `Resolução recusada: motivos somariam ${total} para ${item.absenceQuantity} falta(s).`,
      );
    }

    const atualizada: DailyConference = {
      ...conference,
      items: conference.items.map((candidate) =>
        candidate.id === params.itemId ? { ...candidate, reasons } : candidate,
      ),
    };

    all[LocalStorageAdapter.keyOf(atualizada.storeId, atualizada.referenceDate)] = atualizada;
    this.writeAll(all);
    this.appendAuditLog('ABSENCE_REASON_RESOLVED', atualizada);
  }

  /**
   * Dia da rede no modo demonstração.
   *
   * As lojas vêm do catálogo importado da planilha — as MESMAS que existem no
   * banco, nenhuma inventada. As conferências são as que o gerente demo salvou
   * neste navegador. Loja sem conferência na data simplesmente não aparece na
   * lista de conferências e o domínio a marca como PENDENTE, exatamente como
   * acontece no Supabase.
   */
  async getNetworkDay(referenceDate: string): Promise<NetworkDayData> {
    const nomePorFuncao = new Map(POSITIONS.map((position) => [position.id, position]));

    const conferencias = Object.values(this.readAll()).filter(
      (conference) => conference.referenceDate === referenceDate,
    );

    const items: NetworkItemRow[] = [];
    const reasons: NetworkReasonRow[] = [];

    for (const conference of conferencias) {
      for (const item of conference.items) {
        const position = nomePorFuncao.get(item.positionId);
        items.push({
          conferenceId: conference.id,
          storeId: conference.storeId,
          positionId: item.positionId,
          positionName: position?.name ?? item.positionId,
          functionGroup: position?.functionGroup ?? item.positionId,
          sector: position?.sector ?? null,
          absenceQuantity: item.absenceQuantity,
          dayOffQuantity: item.dayOffQuantity,
          observation: item.observation,
        });

        for (const reason of item.reasons) {
          reasons.push({
            conferenceId: conference.id,
            positionId: item.positionId,
            reasonId: reason.reasonId,
            reasonName: getReasonById(reason.reasonId)?.name ?? reason.reasonId,
            reasonQuantity: reason.quantity,
            observation: reason.observation,
          });
        }
      }
    }

    return {
      stores: demoStoreRefs(),
      conferences: conferencias.map((conference) => ({
        id: conference.id,
        storeId: conference.storeId,
        referenceDate: conference.referenceDate,
        status: conference.status,
        submittedAt: conference.submittedAt,
        submittedBy: conference.submittedBy,
        // No demo não há tabela de perfis: o nome fica em branco e a tela
        // mostra "—", em vez de inventar um responsável.
        submittedByName: null,
        updatedAt: conference.updatedAt,
      })),
      items,
      reasons,
    };
  }

  /**
   * Período da rede no modo demonstração.
   *
   * Mesma forma que o Supabase entrega, montada a partir do que o gerente demo
   * salvou neste navegador. As lojas continuam vindo do catálogo da planilha —
   * nenhuma é inventada.
   */
  async getNetworkRange(params: {
    start: string;
    end: string;
    comparisonStart: string;
  }): Promise<NetworkRangeData> {
    const { start, end, comparisonStart } = params;
    const inicioAmplo = comparisonStart < start ? comparisonStart : start;
    const posicaoPorId = new Map(POSITIONS.map((position) => [position.id, position]));
    const nomeDaLoja = new Map(STORES.map((store) => [store.id, store.name]));

    const noIntervalo = (data: string, de: string) => data >= de && data <= end;

    const conferencias = Object.values(this.readAll());

    const items: RangeItemRow[] = [];
    const reasons: RangeReasonRow[] = [];

    for (const conference of conferencias) {
      const dentroAmplo = noIntervalo(conference.referenceDate, inicioAmplo);
      if (!dentroAmplo) continue;

      // CAMADA A, igual ao Supabase: só conferência ENVIADA vira número
      // analítico. Rascunho e reaberta seguem na lista de `conferences`
      // abaixo, para contarem como pendência na cobertura.
      if (conference.status !== 'SUBMITTED') continue;

      for (const item of conference.items) {
        const position = posicaoPorId.get(item.positionId);
        items.push({
          conferenceId: conference.id,
          storeId: conference.storeId,
          storeName: nomeDaLoja.get(conference.storeId) ?? conference.storeId,
          referenceDate: conference.referenceDate,
          positionId: item.positionId,
          positionName: position?.name ?? item.positionId,
          functionGroup: position?.functionGroup ?? item.positionId,
          sector: position?.sector ?? null,
          absenceQuantity: item.absenceQuantity,
          dayOffQuantity: item.dayOffQuantity,
          observation: item.observation,
        });

        // Motivos só do período analisado, igual ao Supabase.
        if (!noIntervalo(conference.referenceDate, start)) continue;
        for (const reason of item.reasons) {
          reasons.push({
            conferenceId: conference.id,
            storeId: conference.storeId,
            referenceDate: conference.referenceDate,
            positionId: item.positionId,
            reasonId: reason.reasonId,
            reasonName: getReasonById(reason.reasonId)?.name ?? reason.reasonId,
            reasonQuantity: reason.quantity,
            observation: reason.observation,
          });
        }
      }
    }

    return {
      stores: demoStoreRefs(),
      conferences: conferencias
        .filter((conference) => noIntervalo(conference.referenceDate, inicioAmplo))
        .map((conference) => ({
          id: conference.id,
          storeId: conference.storeId,
          referenceDate: conference.referenceDate,
          status: conference.status,
          submittedAt: conference.submittedAt,
        })),
      items,
      reasons,
    };
  }

  /**
   * Auditoria do modo demo, gravada no próprio navegador.
   * No Supabase quem registra é a RPC, dentro da transação.
   */
  private appendAuditLog(action: AuditAction, conference: DailyConference): void {
    try {
      const raw = this.store.getItem(AUDIT_KEY);
      const logs: AuditLog[] = raw ? (JSON.parse(raw) as AuditLog[]) : [];
      logs.push({
        id: createId(),
        userId: conference.createdBy,
        action,
        entity: 'daily_conferences',
        entityId: conference.id,
        storeId: conference.storeId,
        createdAt: new Date().toISOString(),
        metadata: { referenceDate: conference.referenceDate },
      });
      // Mantém o histórico local enxuto.
      this.store.setItem(AUDIT_KEY, JSON.stringify(logs.slice(-500)));
    } catch {
      // Auditoria local é best-effort: nunca derruba o salvamento.
    }
  }

  /** Só o modo demo expõe a auditoria local (usado em teste). */
  readAuditLog(): AuditLog[] {
    try {
      const raw = this.store.getItem(AUDIT_KEY);
      return raw ? (JSON.parse(raw) as AuditLog[]) : [];
    } catch {
      return [];
    }
  }
}
