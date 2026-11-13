import * as crypto from 'crypto';

import {
  ADMIN_MASS_DOCUMENT_ACCESS_LIMIT_PER_HOUR,
  REJECTION_REASON_MESSAGES,
  type RejectionReasonCode,
  SIGNED_DOCUMENT_URL_TTL_SECONDS,
  calculateFilesDeleteAfter,
  canResubmitVerification,
  canSubmitVerificationAppeal,
  evaluateAdminDocumentAccessRequest,
  isValidBrazilianCPF,
  normalizeValidCPF,
} from './verification-core';

function computeCpfHmacNode(rawCpf: string, pepper: string): string {
  const clean = normalizeValidCPF(rawCpf);
  return crypto.createHmac('sha256', pepper).update(clean).digest('hex');
}

describe('CPF e HMAC (ADR-16, SEC-12, T-VER-01, T-VER-02)', () => {
  it('valida CPFs brasileiros reais por dígito verificador e rejeita inválidos', () => {
    expect(isValidBrazilianCPF('52998224725')).toBe(true);
    expect(isValidBrazilianCPF('529.982.247-25')).toBe(true);
    expect(isValidBrazilianCPF('111.111.111-11')).toBe(false);
    expect(isValidBrazilianCPF('52998224720')).toBe(false);
    expect(isValidBrazilianCPF('123')).toBe(false);
  });

  it('gera HMAC-SHA256 determinístico de 64 caracteres hexadecimais sem incluir o CPF em claro', () => {
    const cpf = '529.982.247-25';
    const pepper = 'test-pepper-secret-do-not-use-in-prod';
    const hash1 = computeCpfHmacNode(cpf, pepper);
    const hash2 = computeCpfHmacNode('52998224725', pepper);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1).not.toContain('52998224725');
  });

  it('não vaza o número do CPF na mensagem de erro quando inválido', () => {
    const invalidInput = '12345678900';
    try {
      normalizeValidCPF(invalidInput);
      fail('Deveria ter lançado erro');
    } catch (err) {
      expect((err as Error).message).not.toContain(invalidInput);
    }
  });
});

describe('Motivos de rejeição (T-VER-03)', () => {
  const allReasons = Object.keys(REJECTION_REASON_MESSAGES) as RejectionReasonCode[];

  it('possui todos os 8 motivos padronizados documentados', () => {
    expect(allReasons).toHaveLength(8);
  });

  it.each(allReasons)(
    'mensagem do motivo %s orienta o prestador sem revelar regras internas antifraude',
    (reason: RejectionReasonCode) => {
      const msg = REJECTION_REASON_MESSAGES[reason];
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).not.toMatch(/cpf_hmac|pepper|score|heurística|algoritmo/i);
    },
  );
});

describe('Recurso e Reenvio de Verificação (RF-41, T-VER-04)', () => {
  const baseDate = new Date('2026-11-01T12:00:00.000Z');

  it('permite 1 recurso dentro de 15 dias para submissão rejeitada', () => {
    const day10 = new Date('2026-11-11T12:00:00.000Z');
    expect(
      canSubmitVerificationAppeal({
        submissionStatus: 'rejected',
        submissionType: 'initial',
        hasExistingAppeal: false,
        reviewedAt: baseDate,
        now: day10,
      }).allowed,
    ).toBe(true);
  });

  it('bloqueia recurso após 15 dias, ou se já houver recurso, ou se a própria submissão for recurso', () => {
    const day16 = new Date('2026-11-17T12:00:01.000Z');
    expect(
      canSubmitVerificationAppeal({
        submissionStatus: 'rejected',
        submissionType: 'initial',
        hasExistingAppeal: false,
        reviewedAt: baseDate,
        now: day16,
      }).allowed,
    ).toBe(false);

    expect(
      canSubmitVerificationAppeal({
        submissionStatus: 'rejected',
        submissionType: 'initial',
        hasExistingAppeal: true,
        reviewedAt: baseDate,
        now: baseDate,
      }).allowed,
    ).toBe(false);

    expect(
      canSubmitVerificationAppeal({
        submissionStatus: 'rejected',
        submissionType: 'appeal',
        hasExistingAppeal: false,
        reviewedAt: baseDate,
        now: baseDate,
      }).allowed,
    ).toBe(false);
  });

  it('bloqueia reenvio automático para suspected_fraud e duplicate_account, ou acima de 3 em 30d', () => {
    expect(
      canResubmitVerification({
        lastRejectionReason: 'suspected_fraud',
        resubmissionsInLast30Days: 0,
      }).allowed,
    ).toBe(false);

    expect(
      canResubmitVerification({
        lastRejectionReason: 'duplicate_account',
        resubmissionsInLast30Days: 0,
      }).allowed,
    ).toBe(false);

    expect(
      canResubmitVerification({
        lastRejectionReason: 'illegible',
        resubmissionsInLast30Days: 3,
      }).allowed,
    ).toBe(false);

    expect(
      canResubmitVerification({
        lastRejectionReason: 'illegible',
        resubmissionsInLast30Days: 2,
      }).allowed,
    ).toBe(true);
  });
});

describe('Retenção de arquivos e acesso Admin (T-VER-05, T-STO-03, T-STO-04, T-ADM-01, T-ADM-09)', () => {
  it('calcula 30 dias após aprovação e 45 dias (15d recurso + 30d) após rejeição', () => {
    const reviewedAt = new Date('2026-11-01T00:00:00.000Z');
    const approvedDeleteAt = calculateFilesDeleteAfter('approved', reviewedAt);
    const rejectedDeleteAt = calculateFilesDeleteAfter('rejected', reviewedAt);

    expect(approvedDeleteAt.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(rejectedDeleteAt.toISOString()).toBe('2026-12-16T00:00:00.000Z');
  });

  it('exige admin + MFA (aal2) + motivo válido, define TTL de 60s e dispara alerta de acesso em massa', () => {
    // Sem MFA (aal1) -> negado
    expect(
      evaluateAdminDocumentAccessRequest({
        isAdmin: true,
        aal: 'aal1',
        reason: 'Conferir frente do RG',
        opensInLastHour: 1,
      }).allowed,
    ).toBe(false);

    // Motivo vazio/curto -> negado
    expect(
      evaluateAdminDocumentAccessRequest({
        isAdmin: true,
        aal: 'aal2',
        reason: 'ok',
        opensInLastHour: 1,
      }).allowed,
    ).toBe(false);

    // Admin com MFA e motivo -> 60s, alerta se >= limite
    const normalAccess = evaluateAdminDocumentAccessRequest({
      isAdmin: true,
      aal: 'aal2',
      reason: 'Conferir frente do RG',
      opensInLastHour: 5,
    });
    expect(normalAccess.allowed).toBe(true);
    expect(normalAccess.ttlSeconds).toBe(SIGNED_DOCUMENT_URL_TTL_SECONDS);
    expect(normalAccess.triggerMassAccessAlert).toBe(false);

    const massAccess = evaluateAdminDocumentAccessRequest({
      isAdmin: true,
      aal: 'aal2',
      reason: 'Auditoria em lote',
      opensInLastHour: ADMIN_MASS_DOCUMENT_ACCESS_LIMIT_PER_HOUR,
    });
    expect(massAccess.allowed).toBe(true);
    expect(massAccess.triggerMassAccessAlert).toBe(true);
  });
});
