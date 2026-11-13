import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  QuoteRecord,
  QuoteSortMode,
  RequestStatus,
  sortQuotesForComparison,
} from '@/features/requests/requests-core';
import { formatCentsToBRL } from '@/lib/format';
import { Button } from '@/ui/Button';
import { StatusChip } from '@/ui/StatusChip';
import { VerificationBadge } from '@/ui/VerificationBadge';
import { colors, radius, spacing, touch, typography } from '@/ui/tokens';

export interface CustomerRequestDetailsScreenProps {
  requestId?: string;
  title?: string;
  categoryName?: string;
  neighborhoodName?: string;
  status?: RequestStatus;
  maxQuotes?: number;
  quotes?: QuoteRecord[];
  onAcceptQuote?: (quoteId: string) => void | Promise<void>;
  onCancelRequest?: (requestId: string) => void | Promise<void>;
  onRepeatRequest?: (requestId: string) => void | Promise<void>;
}

export default function CustomerRequestDetailsScreen({
  requestId = 'req-1',
  title = 'Troca de disjuntor no quadro principal',
  categoryName = 'Eletricista',
  neighborhoodName = 'Centro',
  status: initialStatus = 'open',
  maxQuotes = 5,
  quotes = [],
  onAcceptQuote,
  onCancelRequest,
  onRepeatRequest,
}: CustomerRequestDetailsScreenProps) {
  const [status, setStatus] = useState<RequestStatus>(initialStatus);
  const [sortMode, setSortMode] = useState<QuoteSortMode>('price_asc');
  const [confirmingQuoteId, setConfirmingQuoteId] = useState<string | null>(null);
  const [acceptedQuoteId, setAcceptedQuoteId] = useState<string | null>(null);

  const sortedQuotes = useMemo(() => sortQuotesForComparison(quotes, sortMode), [quotes, sortMode]);

  const handleConfirmAccept = async (quoteId: string) => {
    setAcceptedQuoteId(quoteId);
    setStatus('hired');
    setConfirmingQuoteId(null);
    await onAcceptQuote?.(quoteId);
  };

  const handleCancel = async () => {
    setStatus('cancelled');
    await onCancelRequest?.(requestId);
  };

  const isTerminal = status === 'expired' || status === 'cancelled' || status === 'completed';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerCard}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.meta}>
          {categoryName} • {neighborhoodName} (Osasco/SP)
        </Text>
        <StatusChip status={status} />
      </View>

      <View style={styles.paymentWarningBox}>
        <Text style={styles.paymentWarningTitle}>Pagamento direto com o profissional</Text>
        <Text style={styles.paymentWarningBody}>
          O pagamento é combinado e realizado diretamente com o profissional após o serviço. O Eu
          Faço não processa pagamentos nem retém valores no aplicativo.
        </Text>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          Comparar propostas ({quotes.length} de {maxQuotes})
        </Text>
        <View style={styles.sortRow}>
          <Pressable
            testID="sort-price-asc"
            accessibilityRole="button"
            style={[styles.sortChip, sortMode === 'price_asc' && styles.sortChipActive]}
            onPress={() => setSortMode('price_asc')}
          >
            <Text
              style={[styles.sortChipText, sortMode === 'price_asc' && styles.sortChipTextActive]}
            >
              Menor preço
            </Text>
          </Pressable>

          <Pressable
            testID="sort-rating-desc"
            accessibilityRole="button"
            style={[styles.sortChip, sortMode === 'rating_desc' && styles.sortChipActive]}
            onPress={() => setSortMode('rating_desc')}
          >
            <Text
              style={[styles.sortChipText, sortMode === 'rating_desc' && styles.sortChipTextActive]}
            >
              Maior avaliação
            </Text>
          </Pressable>

          <Pressable
            testID="sort-response-asc"
            accessibilityRole="button"
            style={[styles.sortChip, sortMode === 'response_time_asc' && styles.sortChipActive]}
            onPress={() => setSortMode('response_time_asc')}
          >
            <Text
              style={[
                styles.sortChipText,
                sortMode === 'response_time_asc' && styles.sortChipTextActive,
              ]}
            >
              Resposta mais rápida
            </Text>
          </Pressable>
        </View>
      </View>

      {sortedQuotes.map((q, index) => {
        const isAccepted = acceptedQuoteId === q.id || q.status === 'accepted';
        const isConfirming = confirmingQuoteId === q.id;
        return (
          <View key={q.id} testID={`quote-card-${index}`} style={styles.quoteCard}>
            <View style={styles.quoteHeader}>
              <Text testID={`quote-provider-${q.id}`} style={styles.providerName}>
                {q.providerDisplayName}
              </Text>
              <Text style={styles.priceText}>{formatCentsToBRL(q.totalPriceCents)}</Text>
            </View>

            <VerificationBadge testID={`quote-badge-${q.id}`} />

            <Text style={styles.metricsText}>
              ★ {q.providerRatingAvg.toFixed(1)} ({q.providerRatingCount} avaliações) •{' '}
              {q.providerCompletedJobsCount} serviços concluídos
              {q.providerAvgResponseMinutes !== null && q.providerAvgResponseMinutes !== undefined
                ? ` • Responde em ~${q.providerAvgResponseMinutes} min`
                : ''}
            </Text>

            {q.revision === 1 ? (
              <Text style={styles.revisedTag}>◆ Proposta revisada pelo profissional</Text>
            ) : null}

            <Text style={styles.includesText}>{q.includesDescription}</Text>

            {q.visitFeeCents > 0 ? (
              <Text style={styles.visitFeeText}>
                Taxa de visita informada: {formatCentsToBRL(q.visitFeeCents)}
              </Text>
            ) : (
              <Text style={styles.visitFeeText}>Sem taxa de visita</Text>
            )}

            {isAccepted ? (
              <Text style={styles.acceptedText}>
                ✓ Proposta aceita — endereço liberado ao profissional
              </Text>
            ) : status === 'open' || status === 'quotes_closed' ? (
              isConfirming ? (
                <View style={styles.confirmBox}>
                  <Text style={styles.confirmWarningText}>
                    Confirma a contratação de {q.providerDisplayName} por{' '}
                    {formatCentsToBRL(q.totalPriceCents)}? Seu endereço completo será liberado a
                    este profissional e o pagamento será feito diretamente a ele.
                  </Text>
                  <Button
                    testID={`confirm-accept-quote-${q.id}`}
                    label="Confirmar contratação"
                    onPress={() => {
                      void handleConfirmAccept(q.id);
                    }}
                  />
                </View>
              ) : (
                <Button
                  testID={`select-quote-${q.id}`}
                  label="Escolher esta proposta"
                  variant="secondary"
                  onPress={() => setConfirmingQuoteId(q.id)}
                />
              )
            ) : null}
          </View>
        );
      })}

      {status === 'open' || status === 'quotes_closed' ? (
        <Button
          testID="cancel-request-button"
          label="Cancelar pedido"
          variant="destructive"
          onPress={() => {
            void handleCancel();
          }}
        />
      ) : null}

      {isTerminal ? (
        <Button
          testID="repeat-request-button"
          label="Repetir pedido (nova janela de 48h)"
          variant="secondary"
          onPress={() => {
            void onRepeatRequest?.(requestId);
          }}
        />
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
  meta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  paymentWarningBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.md,
    borderRadius: radius.card,
    gap: spacing.xs,
  },
  paymentWarningTitle: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '700',
  },
  paymentWarningBody: {
    ...typography.caption,
    color: colors.text,
  },
  sectionHeader: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.subtitle,
    fontWeight: '700',
    color: colors.text,
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  sortChip: {
    minHeight: touch.minSize,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  sortChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  sortChipText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  sortChipTextActive: {
    color: colors.primary,
  },
  quoteCard: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  quoteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  providerName: {
    ...typography.subtitle,
    fontWeight: '700',
    color: colors.text,
  },
  priceText: {
    ...typography.subtitle,
    fontWeight: '700',
    color: colors.primary,
  },
  metricsText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  revisedTag: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
  },
  includesText: {
    ...typography.body,
    color: colors.text,
  },
  visitFeeText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  acceptedText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  confirmBox: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.card,
    gap: spacing.sm,
  },
  confirmWarningText: {
    ...typography.caption,
    color: colors.text,
  },
});
