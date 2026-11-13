import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  REJECTION_REASON_MESSAGES,
  type RejectionReasonCode,
  SIGNED_DOCUMENT_URL_TTL_SECONDS,
  evaluateAdminDocumentAccessRequest,
} from '@/features/verification/verification-core';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, typography } from '@/ui/tokens';

export interface AdminVerificationQueueItem {
  submissionId: string;
  providerId: string;
  providerDisplayName: string;
  submissionType: 'initial' | 'resubmission' | 'appeal';
  appealText?: string | null;
  submittedAt: string;
}

export interface AdminVerificationsScreenProps {
  isAdmin?: boolean;
  aal?: 'aal1' | 'aal2';
  opensInLastHour?: number;
  queue?: AdminVerificationQueueItem[];
  onOpenDocument?: (payload: { submissionId: string; reason: string; ttlSeconds: number }) => void;
  onDecision?: (payload: {
    submissionId: string;
    decision: 'approved' | 'rejected';
    rejectionReason?: RejectionReasonCode;
  }) => void;
}

const REJECTION_OPTIONS: { code: RejectionReasonCode; label: string }[] = [
  { code: 'illegible', label: 'Documento ou selfie ilegível' },
  { code: 'expired_document', label: 'Documento vencido' },
  { code: 'face_mismatch', label: 'Foto não corresponde à selfie' },
  { code: 'name_mismatch', label: 'Divergência de nome' },
  { code: 'underage', label: 'Menor de 18 anos' },
  { code: 'duplicate_account', label: 'Conta duplicada' },
  { code: 'suspected_fraud', label: 'Suspeita de fraude' },
  { code: 'incomplete', label: 'Documentação incompleta' },
];

/**
 * Fila Web de Verificações e Recursos do Administrador (E8-01..03, RF-25, RF-41, RF-42, SEC-03, SEC-09).
 * Regras:
 * - Bloqueia acesso se não for admin autenticado com MFA (aal2).
 * - Exige justificativa escrita antes de gerar URL assinada de 60s para documentos.
 * - Exige motivo padronizado ao rejeitar.
 */
export default function AdminVerificationsScreen({
  isAdmin = false,
  aal = 'aal1',
  opensInLastHour = 0,
  queue = [],
  onOpenDocument,
  onDecision,
}: AdminVerificationsScreenProps) {
  const [auditReason, setAuditReason] = useState('');
  const [selectedRejectionReason, setSelectedRejectionReason] =
    useState<RejectionReasonCode>('illegible');
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isAdmin || aal !== 'aal2') {
    return (
      <View style={styles.deniedContainer}>
        <Text style={styles.deniedTitle} accessibilityRole="header">
          Acesso restrito ao Administrador (MFA obrigatório)
        </Text>
        <Text style={styles.bodyText}>
          Para acessar a fila de verificação e visualizar documentos sensíveis, autentique-se com
          segundo fator (MFA / aal2).
        </Text>
      </View>
    );
  }

  const handleOpenDocs = (submissionId: string) => {
    const check = evaluateAdminDocumentAccessRequest({
      isAdmin,
      aal,
      reason: auditReason,
      opensInLastHour,
    });
    if (!check.allowed) {
      setFeedback('Informe o motivo da abertura do documento (mínimo de 5 caracteres).');
      return;
    }
    setFeedback(
      `URL temporária gerada por ${SIGNED_DOCUMENT_URL_TTL_SECONDS} segundos e registrada no log de auditoria.`,
    );
    onOpenDocument?.({
      submissionId,
      reason: auditReason.trim(),
      ttlSeconds: check.ttlSeconds,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Painel Admin — Fila de Verificações (SLA 48h)
      </Text>

      <TextField
        testID="admin-document-open-reason"
        label="Motivo de auditoria para abrir documentos (obrigatório)"
        value={auditReason}
        onChangeText={setAuditReason}
        helperText="Toda visualização gera registro imutável em admin_audit_log e URL válida por 60s."
      />

      {feedback ? (
        <Text style={styles.feedbackBanner} accessibilityRole="alert">
          {feedback}
        </Text>
      ) : null}

      {queue.length === 0 ? (
        <Text style={styles.bodyText}>Nenhuma submissão pendente no momento.</Text>
      ) : (
        queue.map((item) => (
          <View key={item.submissionId} style={styles.card}>
            <Text style={styles.cardTitle}>
              {item.providerDisplayName} ({item.submissionType === 'appeal' ? 'Recurso' : 'Inicial'}
              )
            </Text>
            {item.appealText ? (
              <Text style={styles.appealQuote}>Recurso do profissional: {item.appealText}</Text>
            ) : null}

            <Button
              testID={`admin-open-docs-${item.submissionId}`}
              label="Abrir documentos (URL de 60s)"
              variant="secondary"
              onPress={() => handleOpenDocs(item.submissionId)}
            />

            <View style={styles.reasonsList}>
              <Text style={styles.captionText}>
                Motivo caso rejeite: {REJECTION_REASON_MESSAGES[selectedRejectionReason]}
              </Text>
              <View style={styles.reasonButtonsRow}>
                {REJECTION_OPTIONS.map((opt) => (
                  <Button
                    key={opt.code}
                    testID={`admin-reason-${opt.code}`}
                    label={opt.label}
                    variant={selectedRejectionReason === opt.code ? 'primary' : 'text'}
                    onPress={() => setSelectedRejectionReason(opt.code)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.decisionRow}>
              <Button
                testID={`admin-approve-${item.submissionId}`}
                label="Aprovar identidade"
                onPress={() =>
                  onDecision?.({ submissionId: item.submissionId, decision: 'approved' })
                }
              />
              <Button
                testID={`admin-reject-${item.submissionId}`}
                label="Rejeitar com motivo"
                variant="destructive"
                onPress={() =>
                  onDecision?.({
                    submissionId: item.submissionId,
                    decision: 'rejected',
                    rejectionReason: selectedRejectionReason,
                  })
                }
              />
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  deniedContainer: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  deniedTitle: {
    ...typography.title,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  bodyText: {
    ...typography.body,
    color: colors.text,
  },
  captionText: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  feedbackBanner: {
    ...typography.body,
    color: colors.primary,
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  appealQuote: {
    ...typography.body,
    color: colors.warning,
  },
  reasonsList: {
    marginTop: spacing.xs,
  },
  reasonButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  decisionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
