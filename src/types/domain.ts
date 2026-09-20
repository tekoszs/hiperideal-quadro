/**
 * Modelo de domínio do sistema de Conferência Diária de Quadro.
 * Espelha 1:1 as tabelas de `supabase/schema.sql`.
 */

/** Status possíveis de uma conferência. REOPENED já existe no modelo, mas o fluxo de reabertura é da fase 2. */
export type ConferenceStatus = 'DRAFT' | 'SUBMITTED' | 'REOPENED';

export type ProfileRole = 'MANAGER' | 'SUPERVISOR' | 'ADMIN';

/** Loja Hiperideal. */
export interface Store {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

/**
 * Função/setor.
 * `name` é sempre o valor exato da planilha (ex.: "REPOSITOR - HORTI").
 * `functionGroup` + `sector` existem apenas para o consolidado do supervisor —
 * nunca para fundir linhas na tela do gerente.
 */
export interface Position {
  id: string;
  name: string;
  functionGroup: string;
  sector: string | null;
  active: boolean;
  displayOrder: number;
}

/** Quadro autorizado por loja. `authorizedQuantity` null = não informado na planilha. */
export interface StoreStaffing {
  id: string;
  storeId: string;
  positionId: string;
  authorizedQuantity: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface Profile {
  id: string;
  name: string;
  role: ProfileRole;
  storeId: string | null;
  active: boolean;
}

/** Motivo de falta. FOLGA NÃO É MOTIVO DE FALTA — folga tem campo próprio em DailyItem. */
export interface AbsenceReason {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
  /** Quando true, a observação daquele motivo é obrigatória (caso de "Outros"). */
  requiresObservation: boolean;
}

/** Quantidade lançada em um motivo específico dentro de uma função. */
export interface DailyItemReason {
  id: string;
  reasonId: string;
  quantity: number;
  observation: string | null;
}

/** Linha da conferência: uma função da loja. */
export interface DailyItem {
  id: string;
  positionId: string;
  absenceQuantity: number;
  dayOffQuantity: number;
  observation: string | null;
  reasons: DailyItemReason[];
}

/** Conferência de um dia (D-1) de uma loja. */
export interface DailyConference {
  id: string;
  storeId: string;
  /** Data de referência no formato ISO `YYYY-MM-DD`. */
  referenceDate: string;
  status: ConferenceStatus;
  /** UUID do usuário. No Supabase vem de auth.uid(), nunca do navegador. */
  createdBy: string;
  /** UUID de quem enviou. Preenchido pela RPC de envio. */
  submittedBy: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  items: DailyItem[];
}

/** Resumo calculado em tempo real para os cards do topo. */
export interface ConferenceSummary {
  totalAbsences: number;
  totalDayOffs: number;
  impactedPositions: number;
  reasonsInformed: number;
  reasonsPending: number;
}

export type AuditAction =
  | 'CONFERENCE_CREATED'
  | 'CONFERENCE_DRAFT_SAVED'
  | 'CONFERENCE_SUBMITTED'
  /**
   * FASE 4.5 — uma falta saiu de "Aguardando justificativa" para um motivo
   * definitivo, numa conferência já enviada. É a única escrita que uma
   * conferência enviada aceita, e por isso a que mais precisa de trilha.
   */
  | 'ABSENCE_REASON_RESOLVED';

export interface AuditLog {
  id: string;
  /** UUID do usuário — no Supabase gravado pela RPC a partir de auth.uid(). */
  userId: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  storeId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

/** Códigos de erro das validações de fechamento. */
export type ValidationCode =
  | 'NEGATIVE_ABSENCE'
  | 'NEGATIVE_DAY_OFF'
  | 'MISSING_REASONS'
  | 'REASON_SUM_MISMATCH'
  | 'OTHERS_REQUIRES_OBSERVATION'
  | 'EMPTY_CONFERENCE'
  | 'ALREADY_SUBMITTED';

export interface ValidationIssue {
  code: ValidationCode;
  /** null quando o problema é da conferência inteira, não de uma função. */
  positionId: string | null;
  positionName: string | null;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** Item do histórico do gerente. */
export interface ConferenceHistoryEntry {
  id: string;
  referenceDate: string;
  totalAbsences: number;
  totalDayOffs: number;
  status: ConferenceStatus;
  submittedAt: string | null;
}
