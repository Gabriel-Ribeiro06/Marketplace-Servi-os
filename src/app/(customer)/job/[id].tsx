import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CancelReason, CompletionType, DisputeReason, JobStatus } from '@/features/jobs/jobs-core';
import { formatCentsToBRL, formatDateTimeBR } from '@/lib/format';
import { Button } from '@/ui/Button';
import { StatusChip, StatusKind } from '@/ui/StatusChip';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, touch, typography } from '@/ui/tokens';

export interface JobDetailsScreenProps {
  jobId?: string;
  requestTitle?: string;
  categoryName?: string;
  neighborhoodName?: string;
  providerDisplayName?: string;
  clientFirstName?: string;
  viewerRole?: 'client' | 'provider';
  scheduledFor?: string;
  agreedPriceCents?: number;
  addressFull?: string;
  initialStatus?: JobStatus;
  initialCompletionType?: CompletionType | null;
  onCompleteJob?: (payload: {
    jobId: string;
    completionType: CompletionType;
    completionNote?: string;
  }) => void | Promise<void>;
  onCancelJob?: (payload: {
    jobId: string;
    cancelReason: CancelReason;
    cancelNote?: string;
  }) => void | Promise<void>;
  onReportNoShow?: (jobId: string) => void | Promise<void>;
  onWithdrawNoShow?: (jobId: string) => void | Promise<void>;
  onContestNoShow?: (payload: { jobId: string; contestNote: string }) => void | Promise<void>;
  onOpenDispute?: (payload: {
    jobId: string;
    reason: DisputeReason;
    details?: string;
  }) => void | Promise<void>;
  onSubmitReview?: (payload: {
    jobId: string;
    rating: number;
    comment?: string;
  }) => void | Promise<void>;
}

const DEFAULT_JOB_UUID = '550e8400-e29b-41d4-a716-446655440301';

export default function JobDetailsScreen({
  jobId = DEFAULT_JOB_UUID,
  requestTitle = 'Formatação e troca de SSD',
  categoryName = 'Técnico em computadores',
  neighborhoodName = 'Presidente Altino',
  providerDisplayName = 'Roberto Técnico',
  clientFirstName = 'Fernanda',
  viewerRole = 'provider',
  scheduledFor = '2026-11-14T14:00:00.000Z',
  agreedPriceCents = 19000,
  addressFull = 'Rua Oswaldo Collino, 300, Apto 12 — Presidente Altino, Osasco',
  initialStatus = 'scheduled',
  initialCompletionType = null,
  onCompleteJob,
  onCancelJob,
  onReportNoShow,
  onWithdrawNoShow,
  onContestNoShow,
  onOpenDispute,
  onSubmitReview,
}: JobDetailsScreenProps) {
  const [status, setStatus] = useState<JobStatus>(initialStatus);
  const [completionType, setCompletionType] = useState<CompletionType>(
    initialCompletionType ?? 'full',
  );
  const [completionNote, setCompletionNote] = useState('');
  const [contestNote, setContestNote] = useState('');
  const [rating, setRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const chipStatus: StatusKind =
    status === 'completed' && completionType === 'partial' ? 'completed_partial' : status;

  const handleComplete = async () => {
    setErrorMessage(null);
    if (completionType === 'partial' && completionNote.trim().length < 5) {
      setErrorMessage(
        'Na conclusão parcial é obrigatório informar uma nota explicativa (mín. 5 caracteres).',
      );
      return;
    }

    setStatus('completed');
    await onCompleteJob?.({
      jobId,
      completionType,
      completionNote: completionNote.trim() || undefined,
    });
  };

  const handleCancel = async () => {
    setErrorMessage(null);
    setStatus('cancelled');
    await onCancelJob?.({
      jobId,
      cancelReason: 'schedule_conflict',
    });
  };

  const handleReportNoShow = async () => {
    setErrorMessage(null);
    setStatus('no_show_claimed');
    await onReportNoShow?.(jobId);
  };

  const handleWithdrawNoShow = async () => {
    setErrorMessage(null);
    setStatus('scheduled');
    await onWithdrawNoShow?.(jobId);
  };

  const handleContestNoShow = async () => {
    setErrorMessage(null);
    if (contestNote.trim().length < 5) {
      setErrorMessage('Explique o motivo da contestação (mín. 5 caracteres).');
      return;
    }
    setStatus('disputed');
    await onContestNoShow?.({
      jobId,
      contestNote: contestNote.trim(),
    });
  };

  const handleOpenDispute = async () => {
    setErrorMessage(null);
    setStatus('disputed');
    await onOpenDispute?.({
      jobId,
      reason: 'incomplete_service',
    });
  };

  const handleSendReview = async () => {
    setErrorMessage(null);
    if (status === 'disputed') {
      setErrorMessage('As avaliações estão suspensas enquanto a disputa estiver em análise.');
      return;
    }
    setReviewSubmitted(true);
    await onSubmitReview?.({
      jobId,
      rating,
      comment: reviewComment.trim() || undefined,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerCard}>
        <Text style={styles.title} accessibilityRole="header">
          {requestTitle}
        </Text>
        <Text style={styles.metaText}>
          {categoryName} • {neighborhoodName} (Osasco/SP)
        </Text>
        <Text style={styles.metaText}>
          Cliente: {clientFirstName} • Profissional: {providerDisplayName}
        </Text>
        <Text style={styles.priceText}>
          Valor acordado: {formatCentsToBRL(agreedPriceCents)} (pagamento direto após o serviço)
        </Text>
        <Text style={styles.metaText}>Horário agendado: {formatDateTimeBR(scheduledFor)}</Text>
        <StatusChip status={chipStatus} testID="job-status-chip" />
      </View>

      <View testID="job-released-address-card" style={styles.addressCard}>
        <Text style={styles.addressTitle}>Endereço do atendimento (liberado após o aceite)</Text>
        <Text style={styles.addressBody}>{addressFull}</Text>
      </View>

      {errorMessage ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      {status === 'scheduled' && viewerRole === 'provider' ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Registrar conclusão do serviço</Text>
          <View style={styles.toggleRow}>
            <Pressable
              testID="completion-type-full"
              accessibilityRole="button"
              style={[styles.toggleChip, completionType === 'full' && styles.toggleChipActive]}
              onPress={() => setCompletionType('full')}
            >
              <Text
                style={[
                  styles.toggleChipText,
                  completionType === 'full' && styles.toggleChipTextActive,
                ]}
              >
                Concluído integralmente
              </Text>
            </Pressable>

            <Pressable
              testID="completion-type-partial"
              accessibilityRole="button"
              style={[styles.toggleChip, completionType === 'partial' && styles.toggleChipActive]}
              onPress={() => setCompletionType('partial')}
            >
              <Text
                style={[
                  styles.toggleChipText,
                  completionType === 'partial' && styles.toggleChipTextActive,
                ]}
              >
                Concluído parcialmente
              </Text>
            </Pressable>
          </View>

          {completionType === 'partial' ? (
            <TextField
              testID="job-partial-note-input"
              label="Nota obrigatória da conclusão parcial"
              value={completionNote}
              onChangeText={setCompletionNote}
              placeholder="Explique o que foi realizado e o que ficou pendente"
              multiline
            />
          ) : null}

          <Button
            testID="job-complete-button"
            label="Marcar serviço como concluído"
            onPress={() => {
              void handleComplete();
            }}
          />
        </View>
      ) : null}

      {status === 'scheduled' ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Imprevistos e exceções</Text>
          <Button
            testID="job-report-no-show-button"
            label="Reportar não comparecimento (+30 min)"
            variant="secondary"
            onPress={() => {
              void handleReportNoShow();
            }}
          />
          <Button
            testID="job-cancel-button"
            label="Cancelar agendamento (antes do horário)"
            variant="destructive"
            onPress={() => {
              void handleCancel();
            }}
          />
        </View>
      ) : null}

      {status === 'no_show_claimed' ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Não comparecimento reportado (prazo de 48h)</Text>
          <TextField
            testID="job-contest-no-show-input"
            label="Contestar acusação de não comparecimento"
            value={contestNote}
            onChangeText={setContestNote}
            placeholder="Explique o que aconteceu (encaminha para análise da moderação)"
            multiline
          />
          <Button
            testID="job-contest-no-show-button"
            label="Contestar não comparecimento"
            onPress={() => {
              void handleContestNoShow();
            }}
          />
          <Button
            testID="job-withdraw-no-show-button"
            label="Retirar acusação (fizemos contato)"
            variant="secondary"
            onPress={() => {
              void handleWithdrawNoShow();
            }}
          />
        </View>
      ) : null}

      {(status === 'completed' || status === 'no_show') && !reviewSubmitted ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Avaliar atendimento (1 a 5 estrelas)</Text>
          <Text style={styles.metaText}>
            Revelação simultânea: sua avaliação só será publicada quando a outra parte também
            avaliar ou após 7 dias.
          </Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable
                key={star}
                testID={`review-star-${star}`}
                accessibilityRole="button"
                style={[styles.starButton, rating === star && styles.starButtonActive]}
                onPress={() => setRating(star)}
              >
                <Text style={styles.starText}>{star} ★</Text>
              </Pressable>
            ))}
          </View>
          <TextField
            testID="review-comment-input"
            label="Comentário sobre o serviço (opcional)"
            value={reviewComment}
            onChangeText={setReviewComment}
            placeholder="Conte como foi sua experiência"
            multiline
          />
          <Button
            testID="review-submit-button"
            label="Enviar avaliação"
            onPress={() => {
              void handleSendReview();
            }}
          />
        </View>
      ) : null}

      {reviewSubmitted ? (
        <View testID="review-submitted-banner" style={styles.sectionCard}>
          <Text style={styles.successText}>
            ✓ Avaliação registrada! Ela será revelada simultaneamente quando a outra parte avaliar
            ou em 7 dias.
          </Text>
        </View>
      ) : null}

      {status === 'completed' ? (
        <Button
          testID="job-open-dispute-button"
          label="Algo deu errado (abrir disputa em até 7 dias)"
          variant="secondary"
          onPress={() => {
            void handleOpenDispute();
          }}
        />
      ) : null}

      {status === 'disputed' ? (
        <View testID="job-disputed-banner" style={styles.sectionCard}>
          <Text style={styles.warningText}>
            ! Este serviço está em disputa sob análise da equipe (SLA de até 72h). As avaliações
            permanecem suspensas até a decisão.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  headerCard: {
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  metaText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  priceText: {
    ...typography.subtitle,
    color: colors.primary,
    fontWeight: '700',
  },
  addressCard: {
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.success,
    gap: spacing.xs,
  },
  addressTitle: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  addressBody: {
    ...typography.body,
    color: colors.text,
  },
  errorBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.md,
    borderRadius: radius.card,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '600',
  },
  sectionCard: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  toggleChip: {
    minHeight: touch.minSize,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  toggleChipText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  toggleChipTextActive: {
    color: colors.primary,
  },
  starsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  starButton: {
    minHeight: touch.minSize,
    minWidth: touch.minSize,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  starButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  starText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  successText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  warningText: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '700',
  },
});
