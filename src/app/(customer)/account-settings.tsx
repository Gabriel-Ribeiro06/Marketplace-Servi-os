import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  classifyReportPriorityAndSla,
  evaluateAccountDeletionEligibility,
  JobStatusKind,
  ReportReason,
} from '../../features/moderation/moderation-core';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { colors, radius, spacing, typography } from '../../ui/tokens';

export interface BlockedUserItem {
  userId: string;
  displayName: string;
}

export interface AccountSettingsScreenProps {
  activeJobStatuses?: JobStatusKind[];
  hasOpenSafetyOrLegalHoldReport?: boolean;
  initialBlockedUsers?: BlockedUserItem[];
  onCreateReport?: (payload: {
    reason: ReportReason;
    details: string;
    priority: 'safety' | 'normal';
    slaHours: 24 | 72;
  }) => Promise<void> | void;
  onUnblockUser?: (userId: string) => Promise<void> | void;
  onDeleteAccount?: (confirmationText: string) => Promise<void> | void;
}

export default function AccountSettingsScreen({
  activeJobStatuses = ['completed'],
  hasOpenSafetyOrLegalHoldReport = false,
  initialBlockedUsers = [{ userId: 'usr-blocked-1', displayName: 'Marcos Reparos' }],
  onCreateReport,
  onUnblockUser,
  onDeleteAccount,
}: AccountSettingsScreenProps): React.JSX.Element {
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>(initialBlockedUsers);
  const [selectedReason, setSelectedReason] = useState<ReportReason>('threat_or_violence');
  const [reportDetails, setReportDetails] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const handleSendReport = async (): Promise<void> => {
    setErrorMessage(null);
    setFeedbackMessage(null);

    const classification = classifyReportPriorityAndSla(selectedReason);
    await onCreateReport?.({
      reason: selectedReason,
      details: reportDetails.trim(),
      priority: classification.priority,
      slaHours: classification.slaHours,
    });

    setReportDetails('');
    setFeedbackMessage(
      `Denúncia registrada com prioridade ${
        classification.priority === 'safety' ? 'de segurança (SLA até 24h)' : 'normal (SLA até 72h)'
      }.`,
    );
  };

  const handleUnblock = async (userId: string): Promise<void> => {
    setErrorMessage(null);
    setFeedbackMessage(null);
    await onUnblockUser?.(userId);
    setBlockedUsers((prev) => prev.filter((u) => u.userId !== userId));
    setFeedbackMessage('Usuário desbloqueado com sucesso.');
  };

  const handleDeleteAccount = async (): Promise<void> => {
    setErrorMessage(null);
    setFeedbackMessage(null);

    const eligibility = evaluateAccountDeletionEligibility({
      activeJobStatuses,
      hasOpenSafetyOrLegalHoldReport,
    });

    if (!eligibility.eligible) {
      setErrorMessage(eligibility.message ?? 'Não é possível excluir a conta neste momento.');
      return;
    }

    if (deleteConfirmation.trim().toUpperCase() !== 'EXCLUIR') {
      setErrorMessage('Digite EXCLUIR para confirmar a exclusão permanente da sua conta.');
      return;
    }

    await onDeleteAccount?.(deleteConfirmation.trim().toUpperCase());
    setFeedbackMessage(
      'Sua conta foi encerrada e seus dados pessoais foram anonimizados conforme a LGPD.',
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Segurança, Privacidade e Conta
      </Text>

      {errorMessage ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      {feedbackMessage ? (
        <View style={styles.feedbackBox} testID="account-feedback-banner">
          <Text style={styles.feedbackText}>{feedbackMessage}</Text>
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Registrar Denúncia (sempre disponível)</Text>
        <Text style={styles.helperText}>
          Relatos de ameaça, violência, assédio ou dano têm prioridade de segurança (SLA de até
          24h).
        </Text>
        <View style={styles.reasonButtonsRow}>
          <Button
            label="Ameaça ou violência (24h)"
            variant={selectedReason === 'threat_or_violence' ? 'primary' : 'secondary'}
            onPress={() => setSelectedReason('threat_or_violence')}
            testID="reason-safety-btn"
          />
          <Button
            label="Spam ou outro (72h)"
            variant={selectedReason === 'spam' ? 'primary' : 'secondary'}
            onPress={() => setSelectedReason('spam')}
            testID="reason-normal-btn"
          />
        </View>
        <TextField
          label="Detalhes da ocorrência (opcional)"
          placeholder="Descreva o que aconteceu"
          value={reportDetails}
          onChangeText={setReportDetails}
        />
        <Button
          label="Enviar denúncia"
          onPress={() => void handleSendReport()}
          testID="submit-report-btn"
        />
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Usuários Bloqueados</Text>
        {blockedUsers.length === 0 ? (
          <Text style={styles.helperText}>Você não possui usuários bloqueados.</Text>
        ) : (
          blockedUsers.map((item) => (
            <View key={item.userId} style={styles.blockedRow} testID={`blocked-row-${item.userId}`}>
              <Text style={styles.blockedName}>{item.displayName}</Text>
              <Button
                label="Desbloquear"
                variant="secondary"
                onPress={() => void handleUnblock(item.userId)}
                testID={`unblock-btn-${item.userId}`}
              />
            </View>
          ))
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Privacidade e Canal DPO (LGPD)</Text>
        <Text style={styles.helperText}>
          Para dúvidas sobre tratamento de dados pessoais ou exercício de direitos LGPD, contate
          nosso Encarregado (DPO) em privacidade@eufaco.com.br.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Excluir Minha Conta (LGPD)</Text>
        <Text style={styles.helperText}>
          A exclusão encerra seu acesso, apaga endereços privados e documentos de verificação e
          anonimiza seu perfil para &quot;Usuário removido&quot;, preservando avaliações já
          publicadas de forma anônima.
        </Text>
        <TextField
          label="Confirmação de exclusão (digite EXCLUIR)"
          placeholder="EXCLUIR"
          value={deleteConfirmation}
          onChangeText={setDeleteConfirmation}
        />
        <Button
          label="Excluir conta permanentemente"
          variant="destructive"
          onPress={() => void handleDeleteAccount()}
          testID="delete-account-btn"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.title.fontSize,
    lineHeight: typography.title.lineHeight,
    fontWeight: '700',
    color: colors.text,
  },
  sectionCard: {
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.subtitle.fontSize,
    lineHeight: typography.subtitle.lineHeight,
    fontWeight: '700',
    color: colors.text,
  },
  helperText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.textMuted,
  },
  reasonButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  blockedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  blockedName: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: '600',
    color: colors.text,
  },
  errorBox: {
    padding: spacing.md,
    borderRadius: radius.field,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: colors.danger,
    fontWeight: '600',
  },
  feedbackBox: {
    padding: spacing.md,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
  },
  feedbackText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.success,
    fontWeight: '600',
  },
});
