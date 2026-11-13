// Regras de domínio da Fase 5: Denúncias, Bloqueios, Auditoria Admin (SEC-25),
// Gate de Categorias e Exclusão de Conta (LGPD / DATABASE.md seção 8)

export type ReportReason =
  | 'harassment'
  | 'threat_or_violence'
  | 'fraud_or_scam'
  | 'damage_or_theft'
  | 'no_show'
  | 'fake_profile'
  | 'off_platform_solicitation'
  | 'spam'
  | 'other';

export interface ReportClassification {
  priority: 'safety' | 'normal';
  slaHours: 24 | 72;
  legalHold: boolean;
}

const SAFETY_REASONS = new Set<ReportReason>([
  'threat_or_violence',
  'damage_or_theft',
  'harassment',
]);

export function classifyReportPriorityAndSla(reason: ReportReason): ReportClassification {
  if (SAFETY_REASONS.has(reason)) {
    return {
      priority: 'safety',
      slaHours: 24,
      legalHold: true,
    };
  }
  return {
    priority: 'normal',
    slaHours: 72,
    legalHold: false,
  };
}

export interface BlockRecord {
  blockerId: string;
  blockedId: string;
}

export function canUsersInteract(params: {
  userAId: string;
  userBId: string;
  userAStatus: 'active' | 'suspended' | 'deleted';
  userBStatus: 'active' | 'suspended' | 'deleted';
  blocks: BlockRecord[];
}): boolean {
  if (params.userAStatus !== 'active' || params.userBStatus !== 'active') {
    return false;
  }

  return !params.blocks.some(
    (b) =>
      (b.blockerId === params.userAId && b.blockedId === params.userBId) ||
      (b.blockerId === params.userBId && b.blockedId === params.userAId),
  );
}

/**
 * T-BLK-04: O usuário bloqueado NUNCA vê quem o bloqueou; apenas quem bloqueou (ou admin) vê o registro.
 */
export function filterVisibleBlockRecords(
  viewerId: string,
  isAdmin: boolean,
  blocks: BlockRecord[],
): BlockRecord[] {
  if (isAdmin) {
    return blocks;
  }
  return blocks.filter((b) => b.blockerId === viewerId);
}

export function validateAdminConversationAccess(params: {
  isAdmin: boolean;
  aal: 'aal1' | 'aal2';
  conversationId: string;
  reportId: string | null | undefined;
  reason: string | null | undefined;
  existingReportIds: string[];
}): { allowed: boolean; errorCode?: 'FORBIDDEN' | 'VALIDATION_ERROR'; message?: string } {
  if (!params.isAdmin || params.aal !== 'aal2') {
    return {
      allowed: false,
      errorCode: 'FORBIDDEN',
      message: 'Acesso restrito a administradores com MFA ativo (aal2).',
    };
  }

  if (!params.conversationId.trim() || !params.reportId?.trim() || !params.reason?.trim()) {
    return {
      allowed: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Leitura de conversa exige conversationId, reportId vinculado e justificativa.',
    };
  }

  if (!params.existingReportIds.includes(params.reportId.trim())) {
    return {
      allowed: false,
      errorCode: 'FORBIDDEN',
      message: 'Leitura bloqueada: reportId não encontrado em denúncias registradas.',
    };
  }

  return { allowed: true };
}

export type JobStatusKind =
  'scheduled' | 'completed' | 'cancelled' | 'no_show_claimed' | 'no_show_confirmed' | 'disputed';

export function evaluateAccountDeletionEligibility(params: {
  activeJobStatuses: JobStatusKind[];
  hasOpenSafetyOrLegalHoldReport: boolean;
}): {
  eligible: boolean;
  reasonCode: 'ACTIVE_JOB_OR_DISPUTE' | 'LEGAL_HOLD_ACTIVE' | null;
  message?: string;
} {
  const hasBlockingJob = params.activeJobStatuses.some(
    (s) => s === 'scheduled' || s === 'no_show_claimed' || s === 'disputed',
  );

  if (hasBlockingJob) {
    return {
      eligible: false,
      reasonCode: 'ACTIVE_JOB_OR_DISPUTE',
      message: 'Conclua ou cancele seus serviços agendados/em disputa antes de excluir a conta.',
    };
  }

  if (params.hasOpenSafetyOrLegalHoldReport) {
    return {
      eligible: false,
      reasonCode: 'LEGAL_HOLD_ACTIVE',
      message:
        'Sua conta possui uma apuração de segurança em andamento e não pode ser excluída neste momento.',
    };
  }

  return {
    eligible: true,
    reasonCode: null,
  };
}

export interface AccountDeletionScrubPlan {
  anonymizedFullName: 'Usuário removido';
  anonymizedProviderName: 'Profissional removido';
  deletePrivateAddresses: boolean;
  redactSentMessages: boolean;
  preserveCpfHmacForFraudPrevention: boolean;
  preservePublishedReviewsAnonymized: boolean;
}

export function computeAccountDeletionScrubPlan(params: {
  hasLegalHold: boolean;
  isBannedProvider: boolean;
}): AccountDeletionScrubPlan {
  return {
    anonymizedFullName: 'Usuário removido',
    anonymizedProviderName: 'Profissional removido',
    deletePrivateAddresses: true,
    redactSentMessages: !params.hasLegalHold,
    preserveCpfHmacForFraudPrevention: params.isBannedProvider,
    preservePublishedReviewsAnonymized: true,
  };
}

export function canAdminActivateCategory(params: {
  approvedAvailableProvidersCount: number;
  minRequired?: number;
}): { allowed: boolean; message?: string } {
  const minRequired = params.minRequired ?? 2;
  if (params.approvedAvailableProvidersCount < minRequired) {
    return {
      allowed: false,
      message: `A categoria exige pelo menos ${minRequired} prestadores aprovados e disponíveis em Osasco.`,
    };
  }
  return { allowed: true };
}
