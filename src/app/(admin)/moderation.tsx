import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  canAdminActivateCategory,
  validateAdminConversationAccess,
} from '../../features/moderation/moderation-core';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { colors, radius, spacing, typography } from '../../ui/tokens';

export interface AdminReportQueueItem {
  id: string;
  targetType: 'user' | 'request' | 'quote' | 'message' | 'job' | 'review';
  targetId: string;
  conversationId?: string;
  reasonLabel: string;
  priority: 'safety' | 'normal';
  slaHours: 24 | 72;
  status: 'open' | 'in_review' | 'action_taken' | 'dismissed';
}

export interface CategoryGateRow {
  categoryId: string;
  name: string;
  approvedAvailableProvidersCount: number;
  isActive: boolean;
  unservedDemandCount: number;
}

export interface AdminModerationScreenProps {
  initialReports?: AdminReportQueueItem[];
  initialCategories?: CategoryGateRow[];
  onReadConversation?: (payload: {
    conversationId: string;
    reportId: string;
    reason: string;
  }) => Promise<void> | void;
  onResolveReport?: (payload: {
    reportId: string;
    dismissed: boolean;
    reason: string;
  }) => Promise<void> | void;
  onToggleCategoryGate?: (payload: {
    categoryId: string;
    isActive: boolean;
    reason: string;
  }) => Promise<void> | void;
}

const DEFAULT_REPORTS: AdminReportQueueItem[] = [
  {
    id: 'rep-safety-1',
    targetType: 'message',
    targetId: 'msg-1',
    conversationId: 'conv-1',
    reasonLabel: 'Ameaça ou violência',
    priority: 'safety',
    slaHours: 24,
    status: 'open',
  },
  {
    id: 'rep-normal-2',
    targetType: 'job',
    targetId: 'job-2',
    reasonLabel: 'Não comparecimento recorrente',
    priority: 'normal',
    slaHours: 72,
    status: 'open',
  },
];

const DEFAULT_CATEGORIES: CategoryGateRow[] = [
  {
    categoryId: 'cat-eletricista',
    name: 'Eletricista',
    approvedAvailableProvidersCount: 3,
    isActive: true,
    unservedDemandCount: 1,
  },
  {
    categoryId: 'cat-tecnico-pc',
    name: 'Técnico em computadores',
    approvedAvailableProvidersCount: 1,
    isActive: false,
    unservedDemandCount: 4,
  },
];

export default function AdminModerationScreen({
  initialReports = DEFAULT_REPORTS,
  initialCategories = DEFAULT_CATEGORIES,
  onReadConversation,
  onResolveReport,
  onToggleCategoryGate,
}: AdminModerationScreenProps): React.JSX.Element {
  const [reports, setReports] = useState<AdminReportQueueItem[]>(initialReports);
  const [categories, setCategories] = useState<CategoryGateRow[]>(initialCategories);
  const [auditReason, setAuditReason] = useState('');
  const [openedConversationId, setOpenedConversationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const handleReadConversation = async (report: AdminReportQueueItem): Promise<void> => {
    setErrorMessage(null);
    setFeedbackMessage(null);

    const check = validateAdminConversationAccess({
      isAdmin: true,
      aal: 'aal2',
      conversationId: report.conversationId ?? '',
      reportId: report.id,
      reason: auditReason,
      existingReportIds: reports.map((r) => r.id),
    });

    if (!check.allowed) {
      setErrorMessage(check.message ?? 'Acesso negado.');
      return;
    }

    await onReadConversation?.({
      conversationId: report.conversationId!,
      reportId: report.id,
      reason: auditReason.trim(),
    });
    setOpenedConversationId(report.conversationId!);
    setFeedbackMessage(
      `Conversa ${report.conversationId} liberada com registro em admin_audit_log (vinculada a ${report.id}).`,
    );
  };

  const handleResolveReport = async (reportId: string, dismissed: boolean): Promise<void> => {
    setErrorMessage(null);
    setFeedbackMessage(null);

    if (!auditReason.trim()) {
      setErrorMessage('Informe a justificativa de auditoria antes de moderar a denúncia.');
      return;
    }

    await onResolveReport?.({
      reportId,
      dismissed,
      reason: auditReason.trim(),
    });

    setReports((prev) =>
      prev.map((r) =>
        r.id === reportId ? { ...r, status: dismissed ? 'dismissed' : 'action_taken' } : r,
      ),
    );
    setFeedbackMessage(
      dismissed
        ? `Denúncia ${reportId} arquivada com auditoria.`
        : `Medida aplicada na denúncia ${reportId} com auditoria.`,
    );
  };

  const handleToggleCategory = async (category: CategoryGateRow): Promise<void> => {
    setErrorMessage(null);
    setFeedbackMessage(null);

    if (!auditReason.trim()) {
      setErrorMessage('Informe a justificativa de auditoria para alterar o status da categoria.');
      return;
    }

    const nextActive = !category.isActive;
    if (nextActive) {
      const gate = canAdminActivateCategory({
        approvedAvailableProvidersCount: category.approvedAvailableProvidersCount,
      });
      if (!gate.allowed) {
        setErrorMessage(gate.message ?? 'Gate mínimo não atingido.');
        return;
      }
    }

    await onToggleCategoryGate?.({
      categoryId: category.categoryId,
      isActive: nextActive,
      reason: auditReason.trim(),
    });

    setCategories((prev) =>
      prev.map((c) => (c.categoryId === category.categoryId ? { ...c, isActive: nextActive } : c)),
    );
    setFeedbackMessage(
      `Categoria ${category.name} ${nextActive ? 'ativada' : 'pausada'} com auditoria.`,
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Painel Admin — Moderação e Operação Osasco
      </Text>
      <Text style={styles.subtitle}>
        Todas as ações exigem MFA ativo (aal2) e justificativa gravada em admin_audit_log.
      </Text>

      <TextField
        label="Justificativa de auditoria (obrigatória para ações e leitura de chat)"
        placeholder="Ex.: Apuração da denúncia rep-safety-1"
        value={auditReason}
        onChangeText={setAuditReason}
      />

      {errorMessage ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      {feedbackMessage ? (
        <View style={styles.feedbackBox} testID="admin-feedback-banner">
          <Text style={styles.feedbackText}>{feedbackMessage}</Text>
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Fila de Denúncias e Disputas</Text>
        {reports.map((report) => (
          <View key={report.id} style={styles.itemCard} testID={`report-card-${report.id}`}>
            <Text style={styles.itemTitle}>
              {report.reasonLabel} (
              {report.priority === 'safety' ? 'Prioridade Segurança — SLA 24h' : 'Normal — SLA 72h'}
              )
            </Text>
            <Text style={styles.itemMeta}>
              ID: {report.id} • Status: {report.status}
            </Text>
            <View style={styles.actionsRow}>
              {report.conversationId ? (
                <Button
                  label="Ler conversa vinculada"
                  variant="secondary"
                  onPress={() => void handleReadConversation(report)}
                  testID={`read-conv-${report.id}`}
                />
              ) : null}
              {report.status === 'open' ? (
                <>
                  <Button
                    label="Aplicar medida"
                    onPress={() => void handleResolveReport(report.id, false)}
                    testID={`resolve-action-${report.id}`}
                  />
                  <Button
                    label="Arquivar"
                    variant="text"
                    onPress={() => void handleResolveReport(report.id, true)}
                    testID={`resolve-dismiss-${report.id}`}
                  />
                </>
              ) : null}
            </View>
          </View>
        ))}

        {openedConversationId ? (
          <View style={styles.auditReaderBox} testID="audited-conversation-reader">
            <Text style={styles.itemTitle}>
              Visualizador Auditado — Conversa {openedConversationId}
            </Text>
            <Text style={styles.itemMeta}>
              Acesso registrado em admin_audit_log conforme SEC-25.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>
          Gate de Categorias em Osasco (mínimo de 2 prestadores aprovados)
        </Text>
        {categories.map((cat) => (
          <View
            key={cat.categoryId}
            style={styles.itemCard}
            testID={`category-row-${cat.categoryId}`}
          >
            <Text style={styles.itemTitle}>{cat.name}</Text>
            <Text style={styles.itemMeta}>
              Prestadores aprovados e disponíveis: {cat.approvedAvailableProvidersCount} • Demanda
              não atendida: {cat.unservedDemandCount}
            </Text>
            <Text style={styles.itemMeta}>
              Estado: {cat.isActive ? 'Aberta para clientes' : 'Aguardando gate mínimo'}
            </Text>
            <Button
              label={cat.isActive ? `Pausar ${cat.name}` : `Ativar ${cat.name}`}
              variant={cat.isActive ? 'secondary' : 'primary'}
              onPress={() => void handleToggleCategory(cat)}
              testID={`toggle-category-${cat.categoryId}`}
            />
          </View>
        ))}
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
  subtitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.textMuted,
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
  itemCard: {
    padding: spacing.md,
    borderRadius: radius.field,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  itemTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: '700',
    color: colors.text,
  },
  itemMeta: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: colors.textMuted,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  auditReaderBox: {
    padding: spacing.md,
    borderRadius: radius.field,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: spacing.xs,
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
