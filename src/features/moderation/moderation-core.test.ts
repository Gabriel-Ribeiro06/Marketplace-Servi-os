import {
  canAdminActivateCategory,
  canUsersInteract,
  classifyReportPriorityAndSla,
  computeAccountDeletionScrubPlan,
  evaluateAccountDeletionEligibility,
  filterVisibleBlockRecords,
  validateAdminConversationAccess,
} from './moderation-core';

describe('Fase 5 — Regras de Moderação, Bloqueios, Auditoria Admin e Exclusão de Conta', () => {
  describe('classifyReportPriorityAndSla (E7-01)', () => {
    it('classifica motivos de segurança física com SLA de 24h e legal_hold = true', () => {
      expect(classifyReportPriorityAndSla('threat_or_violence')).toEqual({
        priority: 'safety',
        slaHours: 24,
        legalHold: true,
      });
      expect(classifyReportPriorityAndSla('damage_or_theft')).toEqual({
        priority: 'safety',
        slaHours: 24,
        legalHold: true,
      });
      expect(classifyReportPriorityAndSla('harassment')).toEqual({
        priority: 'safety',
        slaHours: 24,
        legalHold: true,
      });
    });

    it('classifica motivos operacionais com SLA de 72h e legal_hold = false', () => {
      expect(classifyReportPriorityAndSla('no_show')).toEqual({
        priority: 'normal',
        slaHours: 72,
        legalHold: false,
      });
      expect(classifyReportPriorityAndSla('spam')).toEqual({
        priority: 'normal',
        slaHours: 72,
        legalHold: false,
      });
    });
  });

  describe('canUsersInteract e filterVisibleBlockRecords (T-BLK-01..04)', () => {
    const blocks = [{ blockerId: 'user-a', blockedId: 'user-b' }];

    it('T-BLK-01/02: bloqueio em uma direção impede interação em ambas as direções', () => {
      expect(
        canUsersInteract({
          userAId: 'user-a',
          userBId: 'user-b',
          userAStatus: 'active',
          userBStatus: 'active',
          blocks,
        }),
      ).toBe(false);

      expect(
        canUsersInteract({
          userAId: 'user-b',
          userBId: 'user-a',
          userAStatus: 'active',
          userBStatus: 'active',
          blocks,
        }),
      ).toBe(false);
    });

    it('T-BLK-04: usuário bloqueado nunca vê o registro de quem o bloqueou', () => {
      expect(filterVisibleBlockRecords('user-a', false, blocks)).toHaveLength(1);
      expect(filterVisibleBlockRecords('user-b', false, blocks)).toHaveLength(0);
      expect(filterVisibleBlockRecords('admin-1', true, blocks)).toHaveLength(1);
    });
  });

  describe('validateAdminConversationAccess (SEC-25 / T-ADM-01..04)', () => {
    it('T-ADM-01/02: bloqueia admin sem MFA aal2 ou usuário não-admin', () => {
      expect(
        validateAdminConversationAccess({
          isAdmin: true,
          aal: 'aal1',
          conversationId: 'conv-1',
          reportId: 'rep-1',
          reason: 'Apuração de denúncia',
          existingReportIds: ['rep-1'],
        }).allowed,
      ).toBe(false);
    });

    it('T-ADM-04: bloqueia leitura de conversa sem reportId válido ou sem justificativa', () => {
      const noReport = validateAdminConversationAccess({
        isAdmin: true,
        aal: 'aal2',
        conversationId: 'conv-1',
        reportId: 'rep-inexistente',
        reason: 'Curiosidade',
        existingReportIds: ['rep-1'],
      });
      expect(noReport.allowed).toBe(false);
      expect(noReport.errorCode).toBe('FORBIDDEN');

      const noReason = validateAdminConversationAccess({
        isAdmin: true,
        aal: 'aal2',
        conversationId: 'conv-1',
        reportId: 'rep-1',
        reason: '   ',
        existingReportIds: ['rep-1'],
      });
      expect(noReason.allowed).toBe(false);
      expect(noReason.errorCode).toBe('VALIDATION_ERROR');
    });

    it('T-ADM-03: permite leitura quando admin tem aal2, reportId existente e reason preenchido', () => {
      expect(
        validateAdminConversationAccess({
          isAdmin: true,
          aal: 'aal2',
          conversationId: 'conv-1',
          reportId: 'rep-1',
          reason: 'Investigação da denúncia rep-1',
          existingReportIds: ['rep-1'],
        }).allowed,
      ).toBe(true);
    });
  });

  describe('evaluateAccountDeletionEligibility e computeAccountDeletionScrubPlan (T-DEL-01..07)', () => {
    it('T-DEL-01: bloqueia exclusão quando há job scheduled, no_show_claimed ou disputed', () => {
      const res = evaluateAccountDeletionEligibility({
        activeJobStatuses: ['completed', 'scheduled'],
        hasOpenSafetyOrLegalHoldReport: false,
      });
      expect(res.eligible).toBe(false);
      expect(res.reasonCode).toBe('ACTIVE_JOB_OR_DISPUTE');
    });

    it('T-DEL-02: bloqueia exclusão quando há denúncia safety/legal_hold aberta', () => {
      const res = evaluateAccountDeletionEligibility({
        activeJobStatuses: ['completed'],
        hasOpenSafetyOrLegalHoldReport: true,
      });
      expect(res.eligible).toBe(false);
      expect(res.reasonCode).toBe('LEGAL_HOLD_ACTIVE');
    });

    it('T-DEL-05 vs T-DEL-06: retém cpf_hmac somente se o prestador foi banido; apaga se não banido', () => {
      const normalProvider = computeAccountDeletionScrubPlan({
        hasLegalHold: false,
        isBannedProvider: false,
      });
      expect(normalProvider.preserveCpfHmacForFraudPrevention).toBe(false);
      expect(normalProvider.redactSentMessages).toBe(true);
      expect(normalProvider.anonymizedFullName).toBe('Usuário removido');

      const bannedProvider = computeAccountDeletionScrubPlan({
        hasLegalHold: true,
        isBannedProvider: true,
      });
      expect(bannedProvider.preserveCpfHmacForFraudPrevention).toBe(true);
      expect(bannedProvider.redactSentMessages).toBe(false);
      expect(bannedProvider.preservePublishedReviewsAnonymized).toBe(true);
    });
  });

  describe('canAdminActivateCategory (E8-06..07)', () => {
    it('impede ativar categoria com menos de 2 prestadores aprovados e disponíveis em Osasco', () => {
      expect(canAdminActivateCategory({ approvedAvailableProvidersCount: 1 }).allowed).toBe(false);
      expect(canAdminActivateCategory({ approvedAvailableProvidersCount: 2 }).allowed).toBe(true);
    });
  });
});
