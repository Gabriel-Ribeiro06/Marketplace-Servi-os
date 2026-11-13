import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatCentsToBRL, parseBRLToCents } from '@/lib/format';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, typography } from '@/ui/tokens';

export interface IncomingRequestItem {
  requestId: string;
  categoryName: string;
  neighborhoodName: string;
  clientFirstName: string;
  title: string;
  description: string;
  remainingQuoteSlots: number;
  maxQuotes: number;
  releasedAddressFull?: string | null;
}

export interface ProviderRequestsScreenProps {
  incomingRequests?: IncomingRequestItem[];
  onSubmitQuote?: (payload: {
    requestId: string;
    totalPriceCents: number;
    visitFeeCents: number;
    includesDescription: string;
  }) => void | Promise<void>;
  onEditQuote?: (payload: {
    requestId: string;
    totalPriceCents: number;
    includesDescription: string;
  }) => void | Promise<void>;
  onWithdrawQuote?: (requestId: string) => void | Promise<void>;
  onDismissRequest?: (requestId: string) => void | Promise<void>;
}

const DEFAULT_INCOMING: IncomingRequestItem[] = [
  {
    requestId: '550e8400-e29b-41d4-a716-446655440101',
    categoryName: 'Eletricista',
    neighborhoodName: 'Centro',
    clientFirstName: 'Carla',
    title: 'Troca de disjuntor geral',
    description: 'Preciso substituir o disjuntor bipolar do quadro principal.',
    remainingQuoteSlots: 3,
    maxQuotes: 5,
    releasedAddressFull: null,
  },
];

function safeParseBRL(value: string): number | null {
  try {
    return parseBRLToCents(value);
  } catch {
    return null;
  }
}

export default function ProviderRequestsScreen({
  incomingRequests = DEFAULT_INCOMING,
  onSubmitQuote,
  onEditQuote,
  onWithdrawQuote,
  onDismissRequest,
}: ProviderRequestsScreenProps) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [priceBRL, setPriceBRL] = useState('');
  const [visitFeeBRL, setVisitFeeBRL] = useState('0');
  const [includesText, setIncludesText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedQuote, setSubmittedQuote] = useState<{
    requestId: string;
    totalPriceCents: number;
    revision: 0 | 1;
    status: 'sent' | 'withdrawn';
  } | null>(null);

  const visibleRequests = incomingRequests.filter((r) => !dismissedIds.includes(r.requestId));

  const handleDismiss = async (requestId: string) => {
    setDismissedIds((prev) => [...prev, requestId]);
    await onDismissRequest?.(requestId);
  };

  const handleSendOrEditQuote = async (requestId: string) => {
    setErrorMessage(null);
    const totalPriceCents = safeParseBRL(priceBRL);
    const visitFeeCents = safeParseBRL(visitFeeBRL) ?? 0;

    if (totalPriceCents === null || totalPriceCents <= 0) {
      setErrorMessage('Informe um valor total válido em R$ (maior que zero).');
      return;
    }

    if (includesText.trim().length < 10) {
      setErrorMessage('Explique o que está incluído no orçamento (mín. 10 caracteres).');
      return;
    }

    if (!submittedQuote) {
      setSubmittedQuote({
        requestId,
        totalPriceCents,
        revision: 0,
        status: 'sent',
      });
      await onSubmitQuote?.({
        requestId,
        totalPriceCents,
        visitFeeCents,
        includesDescription: includesText.trim(),
      });
      return;
    }

    if (submittedQuote.status === 'withdrawn') {
      setErrorMessage('Você retirou sua proposta deste pedido e não pode reenviar.');
      return;
    }

    if (submittedQuote.revision >= 1) {
      setErrorMessage('Cada proposta só pode ser editada uma única vez.');
      return;
    }

    setSubmittedQuote({
      ...submittedQuote,
      totalPriceCents,
      revision: 1,
    });
    await onEditQuote?.({
      requestId,
      totalPriceCents,
      includesDescription: includesText.trim(),
    });
  };

  const handleWithdraw = async (requestId: string) => {
    setErrorMessage(null);
    if (submittedQuote) {
      setSubmittedQuote({
        ...submittedQuote,
        status: 'withdrawn',
      });
    }
    await onWithdrawQuote?.(requestId);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Pedidos compatíveis em Osasco
      </Text>
      <Text style={styles.subtitle}>
        Você recebe apenas pedidos compatíveis com sua categoria, bairro e disponibilidade.
      </Text>

      {errorMessage ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      {visibleRequests.map((req) => (
        <View key={req.requestId} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.cardTitle}>{req.title}</Text>
            <Text style={styles.slotsBadge}>
              ● Restam {req.remainingQuoteSlots} de {req.maxQuotes} vagas
            </Text>
          </View>

          <Text style={styles.metaText}>
            Cliente: {req.clientFirstName} • {req.categoryName} • Bairro {req.neighborhoodName}{' '}
            (Osasco)
          </Text>
          <Text style={styles.descriptionText}>{req.description}</Text>

          {req.releasedAddressFull ? (
            <View testID="released-private-address-box" style={styles.addressReleasedBox}>
              <Text style={styles.addressReleasedTitle}>
                Endereço liberado (proposta aceita pelo cliente):
              </Text>
              <Text style={styles.addressReleasedBody}>{req.releasedAddressFull}</Text>
            </View>
          ) : (
            <Text testID="hidden-private-address-notice" style={styles.hiddenAddressNotice}>
              Endereço completo protegido: será exibido somente se sua proposta for aceita.
            </Text>
          )}

          {submittedQuote && submittedQuote.requestId === req.requestId ? (
            <View style={styles.quoteSummaryBox}>
              <Text
                style={
                  submittedQuote.status === 'withdrawn'
                    ? styles.withdrawnBadgeText
                    : styles.sentBadgeText
                }
              >
                {submittedQuote.status === 'withdrawn'
                  ? '✕ Proposta retirada (sem reenvio)'
                  : submittedQuote.revision === 1
                    ? `✓ Proposta enviada e revisada (${formatCentsToBRL(submittedQuote.totalPriceCents)})`
                    : `✓ Proposta enviada (${formatCentsToBRL(submittedQuote.totalPriceCents)})`}
              </Text>
            </View>
          ) : null}

          <TextField
            testID={`quote-price-input-${req.requestId}`}
            label="Valor total da proposta (R$)"
            value={priceBRL}
            onChangeText={setPriceBRL}
            placeholder="Ex.: 180,00"
            keyboardType="decimal-pad"
          />

          <TextField
            testID={`quote-visit-fee-input-${req.requestId}`}
            label="Taxa de visita opcional (R$)"
            value={visitFeeBRL}
            onChangeText={setVisitFeeBRL}
            placeholder="0,00"
            keyboardType="decimal-pad"
          />

          <TextField
            testID={`quote-includes-input-${req.requestId}`}
            label="O que está incluído no serviço"
            value={includesText}
            onChangeText={setIncludesText}
            placeholder="Descreva mão de obra, materiais ou condições (mín. 10 caracteres)"
            multiline
          />

          <Button
            testID={`submit-or-edit-quote-${req.requestId}`}
            label={
              !submittedQuote
                ? 'Enviar proposta'
                : submittedQuote.revision === 0
                  ? 'Salvar única revisão da proposta'
                  : 'Limite de revisão atingido'
            }
            onPress={() => {
              void handleSendOrEditQuote(req.requestId);
            }}
          />

          {submittedQuote && submittedQuote.status === 'sent' ? (
            <Button
              testID={`withdraw-quote-${req.requestId}`}
              label="Retirar proposta (não poderá reenviar)"
              variant="destructive"
              onPress={() => {
                void handleWithdraw(req.requestId);
              }}
            />
          ) : null}

          {!submittedQuote ? (
            <Button
              testID={`dismiss-request-${req.requestId}`}
              label="Descartar este pedido"
              variant="secondary"
              onPress={() => {
                void handleDismiss(req.requestId);
              }}
            />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
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
  card: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  cardTitle: {
    ...typography.subtitle,
    fontWeight: '700',
    color: colors.text,
  },
  slotsBadge: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  metaText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  descriptionText: {
    ...typography.body,
    color: colors.text,
  },
  hiddenAddressNotice: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  addressReleasedBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
    padding: spacing.sm,
    borderRadius: radius.field,
    gap: 2,
  },
  addressReleasedTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.success,
  },
  addressReleasedBody: {
    ...typography.caption,
    color: colors.text,
  },
  quoteSummaryBox: {
    paddingVertical: spacing.xs,
  },
  sentBadgeText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  withdrawnBadgeText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
});
