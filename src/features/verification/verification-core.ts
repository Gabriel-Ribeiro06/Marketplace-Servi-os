/**
 * Regras de negócio puras de Verificação Profissional e Segurança de Documentos (Fase 1).
 * Fonte oficial: docs/SECURITY.md seção 4, docs/DATABASE.md seções 3.2, 5.6 e 7.2.
 */

export type RejectionReasonCode =
  | 'illegible'
  | 'expired_document'
  | 'face_mismatch'
  | 'name_mismatch'
  | 'underage'
  | 'duplicate_account'
  | 'suspected_fraud'
  | 'incomplete';

export type DocumentTypeCode = 'id_front' | 'id_back' | 'selfie';

export const REQUIRED_DOCUMENT_TYPES: readonly DocumentTypeCode[] = [
  'id_front',
  'id_back',
  'selfie',
] as const;

export const SIGNED_DOCUMENT_URL_TTL_SECONDS = 60;
export const ADMIN_MASS_DOCUMENT_ACCESS_LIMIT_PER_HOUR = 20;
export const APPEAL_WINDOW_DAYS = 15;
export const RETENTION_AFTER_FINAL_DECISION_DAYS = 30;
export const MAX_RESUBMISSIONS_IN_30_DAYS = 3;

/**
 * Mensagens padronizadas ao prestador para cada motivo de rejeição (SECURITY.md 4.3, T-VER-03).
 * Explicam o que corrigir sem revelar critérios internos antifraude.
 */
export const REJECTION_REASON_MESSAGES: Record<RejectionReasonCode, string> = {
  illegible:
    'A imagem do documento ou da selfie está desfocada, escura ou com reflexo. Tire uma nova foto em local iluminado.',
  expired_document:
    'O documento enviado está fora do prazo de validade. Envie um RG, CNH ou CIN válido.',
  face_mismatch:
    'Não foi possível confirmar a correspondência entre a foto do documento e a selfie enviada.',
  name_mismatch:
    'O nome no documento diverge do nome informado no cadastro. Corrija seu nome ou explique no campo de recurso (ex.: nome social).',
  underage: 'O cadastro na plataforma é permitido apenas para maiores de 18 anos.',
  duplicate_account:
    'Identificamos que já existe um cadastro vinculado a estes dados na plataforma.',
  suspected_fraud:
    'Não foi possível validar a autenticidade dos documentos apresentados. Caso discorde, utilize a opção de recurso.',
  incomplete:
    'Faltou um dos arquivos obrigatórios (frente do documento, verso do documento e selfie ao vivo).',
};

/**
 * Valida CPF brasileiro (11 dígitos e dígitos verificadores módulo 11).
 */
export function isValidBrazilianCPF(rawCpf: string): boolean {
  const digits = rawCpf.replace(/\D/g, '');
  if (digits.length !== 11) {
    return false;
  }
  // Rejeita sequências repetidas (ex.: 00000000000, 11111111111)
  if (/^(\d)\1{10}$/.test(digits)) {
    return false;
  }

  const calcDigit = (sliceLength: number): number => {
    let sum = 0;
    const weightStart = sliceLength + 1;
    for (let i = 0; i < sliceLength; i++) {
      sum += Number(digits[i]) * (weightStart - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const d1 = calcDigit(9);
  const d2 = calcDigit(10);
  return d1 === Number(digits[9]) && d2 === Number(digits[10]);
}

/**
 * Normaliza o CPF para exatamente 11 dígitos após validação.
 * Lança erro genérico sem expor o valor do CPF na mensagem (SEC-12, SEC-14).
 */
export function normalizeValidCPF(rawCpf: string): string {
  const digits = rawCpf.replace(/\D/g, '');
  if (!isValidBrazilianCPF(digits)) {
    throw new Error('VALIDATION_ERROR: CPF inválido.');
  }
  return digits;
}

/**
 * Calcula a data de purga dos arquivos de verificação (SECURITY.md seção 4.5, T-VER-05):
 * - Em aprovação: 30 dias após a decisão.
 * - Em rejeição: 15 dias (janela de recurso) + 30 dias = 45 dias após a decisão.
 */
export function calculateFilesDeleteAfter(
  decision: 'approved' | 'rejected',
  reviewedAt: Date = new Date(),
): Date {
  const daysToAdd =
    decision === 'approved'
      ? RETENTION_AFTER_FINAL_DECISION_DAYS
      : APPEAL_WINDOW_DAYS + RETENTION_AFTER_FINAL_DECISION_DAYS;

  return new Date(reviewedAt.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
}

/**
 * Verifica se o prestador pode abrir recurso (RF-41, T-VER-04):
 * - A submissão deve estar 'rejected', não ser ela própria um 'appeal',
 *   não possuir recurso anterior e estar dentro dos 15 dias.
 */
export function canSubmitVerificationAppeal(params: {
  submissionStatus: 'pending' | 'approved' | 'rejected';
  submissionType: 'initial' | 'resubmission' | 'appeal';
  hasExistingAppeal: boolean;
  reviewedAt: Date;
  now?: Date;
}): { allowed: boolean; reason?: string } {
  const now = params.now ?? new Date();
  if (params.submissionStatus !== 'rejected') {
    return { allowed: false, reason: 'Apenas submissões rejeitadas permitem recurso.' };
  }
  if (params.submissionType === 'appeal') {
    return { allowed: false, reason: 'A decisão sobre um recurso é final.' };
  }
  if (params.hasExistingAppeal) {
    return { allowed: false, reason: 'Já existe um recurso registrado para esta decisão.' };
  }
  const deadlineMs = params.reviewedAt.getTime() + APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() > deadlineMs) {
    return { allowed: false, reason: 'O prazo de 15 dias para abrir recurso expirou.' };
  }
  return { allowed: true };
}

/**
 * Verifica se o prestador pode enviar nova submissão automática (reenvio) (SECURITY.md 4.4, T-VER-04):
 * - Motivos 'suspected_fraud' e 'duplicate_account' vedam reenvio automático (apenas recurso).
 * - Máximo de 3 reenvios nos últimos 30 dias.
 */
export function canResubmitVerification(params: {
  lastRejectionReason?: RejectionReasonCode | null;
  resubmissionsInLast30Days: number;
}): { allowed: boolean; reason?: string } {
  if (
    params.lastRejectionReason === 'suspected_fraud' ||
    params.lastRejectionReason === 'duplicate_account'
  ) {
    return {
      allowed: false,
      reason: 'Esta rejeição não permite reenvio automático. Utilize a opção de recurso.',
    };
  }
  if (params.resubmissionsInLast30Days >= MAX_RESUBMISSIONS_IN_30_DAYS) {
    return {
      allowed: false,
      reason: 'Você atingiu o limite de 3 reenvios em 30 dias.',
    };
  }
  return { allowed: true };
}

/**
 * Valida pedido de abertura de documento pelo Admin (DATABASE.md 7.2, T-STO-04, T-ADM-09).
 */
export function evaluateAdminDocumentAccessRequest(params: {
  isAdmin: boolean;
  aal: string | null | undefined;
  reason: string;
  opensInLastHour: number;
}): {
  allowed: boolean;
  ttlSeconds: number;
  triggerMassAccessAlert: boolean;
  errorCode?: 'FORBIDDEN' | 'VALIDATION_ERROR';
} {
  if (!params.isAdmin || params.aal !== 'aal2') {
    return {
      allowed: false,
      ttlSeconds: 0,
      triggerMassAccessAlert: false,
      errorCode: 'FORBIDDEN',
    };
  }
  if (params.reason.trim().length < 5) {
    return {
      allowed: false,
      ttlSeconds: 0,
      triggerMassAccessAlert: false,
      errorCode: 'VALIDATION_ERROR',
    };
  }
  return {
    allowed: true,
    ttlSeconds: SIGNED_DOCUMENT_URL_TTL_SECONDS,
    triggerMassAccessAlert: params.opensInLastHour >= ADMIN_MASS_DOCUMENT_ACCESS_LIMIT_PER_HOUR,
  };
}
