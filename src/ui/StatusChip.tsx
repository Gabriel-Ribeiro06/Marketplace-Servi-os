import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from './tokens';

export type RequestStatusCode =
  'open' | 'quotes_closed' | 'hired' | 'completed' | 'cancelled' | 'expired';

export type JobStatusCode =
  | 'scheduled'
  | 'no_show_claimed'
  | 'completed'
  | 'completed_partial'
  | 'cancelled'
  | 'no_show'
  | 'disputed';

export type StatusKind = RequestStatusCode | JobStatusCode;

interface StatusDescriptor {
  symbol: string;
  label: string;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}

export const STATUS_DESCRIPTORS: Record<StatusKind, StatusDescriptor> = {
  open: { symbol: '●', label: 'Aberto', tone: 'info' },
  quotes_closed: { symbol: '◆', label: 'Propostas encerradas', tone: 'warning' },
  hired: { symbol: '✓', label: 'Contratado', tone: 'info' },
  scheduled: { symbol: '◷', label: 'Agendado', tone: 'info' },
  no_show_claimed: { symbol: '!', label: 'Não comparecimento reportado', tone: 'warning' },
  completed: { symbol: '✓', label: 'Concluído', tone: 'success' },
  completed_partial: { symbol: '◐', label: 'Concluído parcialmente', tone: 'warning' },
  cancelled: { symbol: '✕', label: 'Cancelado', tone: 'neutral' },
  expired: { symbol: '○', label: 'Expirado', tone: 'neutral' },
  no_show: { symbol: '✕', label: 'Não compareceu', tone: 'danger' },
  disputed: { symbol: '!', label: 'Em análise (disputa)', tone: 'danger' },
};

export interface StatusChipProps {
  status: StatusKind;
  testID?: string;
}

/**
 * Chip de status acessível.
 * Regra (DESIGN_SYSTEM.md seções 2.1 e 3):
 * - Nunca usa cor como único indicador: exibe símbolo + texto descritivo.
 * - Cobre todos os status canônicos de Pedido e Serviço (DATABASE.md seção 5).
 */
export function StatusChip({ status, testID }: StatusChipProps) {
  const descriptor = STATUS_DESCRIPTORS[status];

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${descriptor.label}`}
      style={[styles.chip, toneStyles[descriptor.tone]]}
    >
      <Text style={[styles.text, toneTextStyles[descriptor.tone]]}>
        {descriptor.symbol} {descriptor.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  text: {
    ...typography.caption,
    fontWeight: '600',
  },
});

const toneStyles = StyleSheet.create({
  info: { backgroundColor: colors.surface, borderColor: colors.primary },
  success: { backgroundColor: colors.surface, borderColor: colors.success },
  warning: { backgroundColor: colors.surface, borderColor: colors.warning },
  danger: { backgroundColor: colors.surface, borderColor: colors.danger },
  neutral: { backgroundColor: colors.background, borderColor: colors.border },
});

const toneTextStyles = StyleSheet.create({
  info: { color: colors.primary },
  success: { color: colors.success },
  warning: { color: colors.warning },
  danger: { color: colors.danger },
  neutral: { color: colors.textMuted },
});
