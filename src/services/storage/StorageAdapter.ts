import type { DailyConference } from '@/types/domain';
import type { NetworkDayData } from '@/types/network';
import type { NetworkRangeData } from '@/types/analytics';

/**
 * Contrato de persistência da aplicação.
 *
 * As telas NUNCA falam com localStorage nem com o Supabase diretamente —
 * elas usam `conferenceService`, que por sua vez usa um StorageAdapter.
 * Trocar `LocalStorageAdapter` por `SupabaseAdapter` não exige mudar nenhuma tela.
 *
 * A AUDITORIA não está neste contrato de propósito: cada adaptador registra
 * seus eventos onde eles são confiáveis — o Supabase grava dentro da própria
 * transação da RPC, e o LocalStorage grava no navegador (modo demo).
 */
export interface StorageAdapter {
  /** Nome legível do adaptador, exibido no rodapé para diagnóstico. */
  readonly name: string;

  /** Retorna a conferência da loja naquela data ou null se ainda não existir. */
  getConference(storeId: string, referenceDate: string): Promise<DailyConference | null>;

  /**
   * Salva o RASCUNHO. Nunca muda o status para SUBMITTED.
   *
   * O envio é uma operação separada (`submitConference`) porque no PostgreSQL
   * ele precisa ser atômico e validado do lado do banco — marcar SUBMITTED
   * por um upsert comum quebra os gatilhos de imutabilidade.
   */
  saveConference(conference: DailyConference): Promise<DailyConference>;

  /**
   * Envia definitivamente: persiste o último estado do rascunho, valida e
   * só então marca SUBMITTED + submitted_at, tudo numa única transação.
   * Lança erro se a conferência já estiver enviada ou inconsistente.
   */
  submitConference(conference: DailyConference): Promise<DailyConference>;

  /** Últimas conferências da loja, mais recentes primeiro. */
  listConferences(
    storeId: string,
    limit?: number,
    range?: { start: string; end: string },
  ): Promise<DailyConference[]>;

  /**
   * FASE 4.5 — move quantidade de "Aguardando justificativa" para um motivo
   * definitivo, numa conferência JÁ ENVIADA.
   *
   * NÃO é uma reabertura: o status continua SUBMITTED e o total de faltas não
   * muda. É a única escrita permitida sobre uma conferência enviada, e existe
   * porque o fato da ausência e o motivo dela acontecem em momentos diferentes.
   *
   * No Supabase isso é uma RPC — transação única, trava na linha pendente e
   * auditoria junto. No modo demonstração, o adaptador local reproduz as mesmas
   * recusas, para a tela se comportar igual nos dois modos.
   */
  resolvePendingReason(params: {
    /** Id do item (função) dentro da conferência. */
    itemId: string;
    toReasonId: string;
    quantity: number;
    observation: string | null;
  }): Promise<void>;

  /**
   * LEITURA DA REDE (fase 3A — área Conferências do supervisor).
   *
   * Devolve o dia inteiro em quatro listas CRUAS, sem agregar nada:
   * lojas, conferências, itens e motivos. Quem monta a tela é
   * `domain/network.ts`, que assim pode ser testado sem banco nenhum.
   *
   * As lojas vêm SEMPRE de `quadro_stores`, inclusive as que não têm
   * conferência na data — é o que permite identificar quem não enviou.
   *
   * Não filtra por perfil: quem decide o que cada um enxerga é a RLS.
   * Um MANAGER recebe só a própria loja pela política do banco; um
   * SUPERVISOR recebe a rede inteira. Nenhuma regra de acesso vive aqui.
   */
  getNetworkDay(referenceDate: string): Promise<NetworkDayData>;

  /**
   * LEITURA POR PERÍODO (fase 3B — Visão da Rede).
   *
   * Uma chamada por período inteiro, não uma por loja nem uma por dia: são
   * QUATRO consultas em paralelo, todas com filtro de data no banco. Trocar
   * de loja ou de grupo de função NÃO refaz nenhuma delas — esses filtros são
   * aplicados sobre os dados já carregados.
   *
   * `comparisonStart` estica só a busca de ITENS para trás, o suficiente para
   * calcular a variação contra o período anterior sem uma segunda viagem.
   *
   * Como na fase 3A, quem decide o que cada perfil enxerga é a RLS.
   */
  getNetworkRange(params: {
    start: string;
    end: string;
    comparisonStart: string;
  }): Promise<NetworkRangeData>;
}
