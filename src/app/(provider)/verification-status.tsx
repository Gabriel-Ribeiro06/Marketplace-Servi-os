import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  REJECTION_REASON_MESSAGES,
  type RejectionReasonCode,
  canResubmitVerification,
  canSubmitVerificationAppeal,
} from '@/features/verification/verification-core';
import { verificationAppealSchema } from '@/schemas';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, typography } from '@/ui/tokens';

export interface VerificationStatusScreenProps {
  submissionId: string;
  verificationStatus: 'pending_review' | 'approved' | 'rejected';
  rejectionReason?: RejectionReasonCode | null;
  submissionType?: 'initial' | 'resubmission' | 'appeal';
  hasExistingAppeal?: boolean;
  resubmissionsInLast30Days?: number;
  reviewedAt?: Date;
  initialPaused?: boolean;
  onAppealSubmitted?: (appealText: string) => void;
  onResubmitRequested?: () => void;
}

/**
 * Acompanhamento de Verificação, Recurso e Pausa de Disponibilidade (E2-04, E2-07, RF-41, RF-42).
 */
export default function VerificationStatusScreen({
  submissionId,
  verificationStatus,
  rejectionReason = null,
  submissionType = 'initial',
  hasExistingAppeal = false,
  resubmissionsInLast30Days = 0,
  reviewedAt = new Date(),
  initialPaused = false,
  onAppealSubmitted,
  onResubmitRequested,
}: VerificationStatusScreenProps) {
  const [isPaused, setIsPaused] = useState(initialPaused);
  const [appealText, setAppealText] = useState('');
  const [appealError, setAppealError] = useState<string | null>(null);
  const [appealSent, setAppealSent] = useState(false);

  const appealCheck = canSubmitVerificationAppeal({
    submissionStatus: verificationStatus === 'pending_review' ? 'pending' : verificationStatus,
    submissionType,
    hasExistingAppeal,
    reviewedAt,
  });

  const resubmitCheck = canResubmitVerification({
    lastRejectionReason: rejectionReason,
    resubmissionsInLast30Days,
  });

  const handleSendAppeal = () => {
    setAppealError(null);
    const parsed = verificationAppealSchema.safeParse({
      rejectedSubmissionId: submissionId,
      appealText,
    });
    if (!parsed.success) {
      setAppealError(parsed.error.issues[0]?.message ?? 'Explique o motivo do recurso.');
      return;
    }
    setAppealSent(true);
    onAppealSubmitted?.(parsed.data.appealText);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Status da Verificação Profissional
      </Text>

      {verificationStatus === 'pending_review' ? (
        <View style={styles.statusCard}>
          <Text style={styles.statusHeading}>◷ Em análise (até 48h)</Text>
          <Text style={styles.bodyText}>
            Estamos conferindo manualmente seu documento e sua selfie. Avisaremos por notificação
            assim que concluir.
          </Text>
        </View>
      ) : null}

      {verificationStatus === 'approved' ? (
        <View style={styles.statusCard}>
          <Text style={styles.statusApprovedHeading}>✓ Identidade verificada</Text>
          <Text style={styles.bodyText}>
            Seu perfil está ativo para receber pedidos nos bairros e categorias selecionados.
          </Text>
          <Button
            testID="provider-pause-toggle"
            label={isPaused ? 'Retomar recebimento de pedidos' : 'Pausar recebimento de pedidos'}
            variant="secondary"
            onPress={() => setIsPaused((prev) => !prev)}
          />
        </View>
      ) : null}

      {verificationStatus === 'rejected' && rejectionReason ? (
        <View style={styles.statusCard}>
          <Text style={styles.statusRejectedHeading}>✕ Verificação não aprovada</Text>
          <Text style={styles.bodyText} testID="rejection-reason-guidance">
            {REJECTION_REASON_MESSAGES[rejectionReason]}
          </Text>

          <View style={styles.actionsSection}>
            <Button
              testID="provider-resubmit-button"
              label="Reenviar documentos"
              disabled={!resubmitCheck.allowed}
              disabledReason={resubmitCheck.reason}
              onPress={() => onResubmitRequested?.()}
            />
          </View>

          {appealCheck.allowed && !appealSent ? (
            <View style={styles.appealBox}>
              <Text style={styles.sectionTitle}>Solicitar recurso (1 vez em até 15 dias)</Text>
              <TextField
                testID="provider-appeal-input"
                label="Justificativa do recurso"
                value={appealText}
                onChangeText={setAppealText}
                maxLength={1000}
                errorMessage={appealError ?? undefined}
              />
              <Button
                testID="provider-appeal-submit"
                label="Enviar recurso (análise em até 5 dias úteis)"
                variant="secondary"
                onPress={handleSendAppeal}
              />
            </View>
          ) : appealSent ? (
            <Text style={styles.appealSentBanner} accessibilityRole="alert">
              Recurso enviado! Nossa equipe responderá em até 5 dias úteis.
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  statusHeading: {
    ...typography.subtitle,
    color: colors.warning,
  },
  statusApprovedHeading: {
    ...typography.subtitle,
    color: colors.success,
  },
  statusRejectedHeading: {
    ...typography.subtitle,
    color: colors.danger,
  },
  bodyText: {
    ...typography.body,
    color: colors.text,
  },
  actionsSection: {
    marginTop: spacing.xs,
  },
  appealBox: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  appealSentBanner: {
    ...typography.body,
    color: colors.primary,
    marginTop: spacing.sm,
  },
});
