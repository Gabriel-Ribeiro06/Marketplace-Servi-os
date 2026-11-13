import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { serviceRequestInputSchema } from '@/schemas';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, typography } from '@/ui/tokens';

export interface CreateRequestResult {
  requestId: string;
  status: 'open' | 'expired';
  eligible: boolean;
}

export interface CreateRequestScreenProps {
  defaultCategoryId?: string;
  defaultNeighborhoodId?: string;
  defaultWindowStart?: string;
  defaultWindowEnd?: string;
  onCreateRequest?: (input: {
    categoryId: string;
    neighborhoodId: string;
    title: string;
    description: string;
    windowStart: string;
    windowEnd: string;
    addressFull: string;
    addressNotes?: string;
  }) => CreateRequestResult | Promise<CreateRequestResult>;
  onNotifyWhenAvailable?: (requestId: string) => void | Promise<void>;
}

const DEFAULT_CATEGORY_UUID = '11111111-1111-4111-8111-111111111101';
const DEFAULT_NEIGHBORHOOD_UUID = '11111111-1111-4111-8111-111111111201';

export default function CreateRequestScreen({
  defaultCategoryId = DEFAULT_CATEGORY_UUID,
  defaultNeighborhoodId = DEFAULT_NEIGHBORHOOD_UUID,
  defaultWindowStart = '2026-11-14T12:00:00.000Z',
  defaultWindowEnd = '2026-11-15T18:00:00.000Z',
  onCreateRequest,
  onNotifyWhenAvailable,
}: CreateRequestScreenProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [addressFull, setAddressFull] = useState('');
  const [addressNotes, setAddressNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<CreateRequestResult | null>(null);
  const [notifyOptedIn, setNotifyOptedIn] = useState(false);

  const handleSubmit = async () => {
    setErrorMessage(null);
    const parsed = serviceRequestInputSchema.safeParse({
      categoryId: defaultCategoryId,
      neighborhoodId: defaultNeighborhoodId,
      title,
      description,
      windowStart: defaultWindowStart,
      windowEnd: defaultWindowEnd,
      addressFull,
      addressNotes: addressNotes.trim().length > 0 ? addressNotes : undefined,
    });

    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Revise os campos do pedido.');
      return;
    }

    const dispatchResult = onCreateRequest
      ? await onCreateRequest(parsed.data)
      : {
          requestId: 'req-demo-1',
          status: 'open' as const,
          eligible: true,
        };

    setResult(dispatchResult);
  };

  const handleNotifyMe = async () => {
    if (!result) return;
    setNotifyOptedIn(true);
    await onNotifyWhenAvailable?.(result.requestId);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Solicitar serviço em Osasco
      </Text>
      <Text style={styles.subtitle}>
        Você receberá até 5 propostas em até 48 horas de profissionais com identidade verificada.
      </Text>

      <View style={styles.privacyBanner} accessibilityRole="summary">
        <Text style={styles.privacyTitle}>Proteção de endereço e fotos</Text>
        <Text style={styles.privacyBody}>
          As fotos enviadas poderão ser vistas pelos profissionais compatíveis antes da contratação.
          Seu endereço completo ficará oculto e só será liberado ao profissional cuja proposta você
          aceitar.
        </Text>
      </View>

      {errorMessage ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <TextField
        testID="request-title-input"
        label="Título do serviço"
        value={title}
        onChangeText={setTitle}
        placeholder="Ex.: Troca de disjuntor no quadro principal"
      />

      <TextField
        testID="request-description-input"
        label="Descrição detalhada"
        value={description}
        onChangeText={setDescription}
        placeholder="Descreva o problema, local no imóvel e detalhes relevantes"
        multiline
      />

      <TextField
        testID="request-address-input"
        label="Endereço completo (privado até o aceite)"
        value={addressFull}
        onChangeText={setAddressFull}
        placeholder="Rua, número, bloco/apto — Osasco/SP"
      />

      <TextField
        testID="request-address-notes-input"
        label="Complemento / ponto de referência (opcional)"
        value={addressNotes}
        onChangeText={setAddressNotes}
        placeholder="Ex.: Portaria 24h"
      />

      <Button
        testID="request-submit-button"
        label="Enviar pedido (válido por 48h)"
        onPress={() => {
          void handleSubmit();
        }}
      />

      {result && result.eligible ? (
        <View testID="request-created-open-banner" style={styles.successBox}>
          <Text style={styles.successTitle}>Pedido enviado com sucesso!</Text>
          <Text style={styles.successBody}>
            Profissionais compatíveis na sua região estão sendo avisados em lotes. Você receberá até
            5 orçamentos nas próximas 48 horas.
          </Text>
        </View>
      ) : null}

      {result && !result.eligible ? (
        <View testID="request-no-eligible-banner" style={styles.warningBox}>
          <Text style={styles.warningTitle}>
            Não encontramos profissionais disponíveis para esta janela no seu bairro agora
          </Text>
          <Text style={styles.warningBody}>
            Preferimos avisar com transparência em vez de deixar seu pedido esperando em vão.
          </Text>
          {notifyOptedIn ? (
            <Text testID="request-notify-confirmed" style={styles.notifyConfirmedText}>
              Pronto! Avisaremos você assim que novos profissionais estiverem disponíveis no seu
              bairro.
            </Text>
          ) : (
            <Button
              testID="request-notify-when-available-button"
              label="Avise-me quando houver profissionais disponíveis"
              variant="secondary"
              onPress={() => {
                void handleNotifyMe();
              }}
            />
          )}
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
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
  },
  privacyBanner: {
    backgroundColor: colors.background,
    borderRadius: radius.card,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  privacyTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  privacyBody: {
    ...typography.caption,
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
  successBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.success,
    padding: spacing.md,
    borderRadius: radius.card,
    gap: spacing.xs,
  },
  successTitle: {
    ...typography.subtitle,
    color: colors.success,
    fontWeight: '700',
  },
  successBody: {
    ...typography.caption,
    color: colors.text,
  },
  warningBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.md,
    borderRadius: radius.card,
    gap: spacing.sm,
  },
  warningTitle: {
    ...typography.subtitle,
    color: colors.warning,
    fontWeight: '700',
  },
  warningBody: {
    ...typography.caption,
    color: colors.text,
  },
  notifyConfirmedText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
});
