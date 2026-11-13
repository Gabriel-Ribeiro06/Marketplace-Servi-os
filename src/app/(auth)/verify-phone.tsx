import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { otpVerificationSchema } from '@/schemas';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, typography } from '@/ui/tokens';

/**
 * Verificação de telefone por OTP (E1-03, RF-02).
 */
export default function VerifyPhoneScreen({
  onVerified,
}: {
  onVerified?: (phone: string) => void;
}) {
  const [phone, setPhone] = useState('+5511');
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  const handleConfirmOtp = () => {
    setErrorMessage(null);
    const parsed = otpVerificationSchema.safeParse({ phone, code });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    setVerified(true);
    onVerified?.(parsed.data.phone);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Confirmar telefone
      </Text>
      <Text style={styles.subtitle}>
        Enviamos um código de 6 dígitos por SMS para proteger sua conta contra fraudes.
      </Text>

      <TextField
        testID="otp-phone"
        label="Telefone celular (com DDD)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        helperText="Formato: +55119XXXXXXXX"
      />

      <TextField
        testID="otp-code"
        label="Código de 6 dígitos"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
      />

      {errorMessage ? (
        <Text style={styles.errorBanner} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      {verified ? (
        <Text style={styles.successBanner} accessibilityRole="alert">
          Telefone confirmado com sucesso!
        </Text>
      ) : null}

      <Button testID="otp-submit" label="Confirmar código" onPress={handleConfirmOtp} />
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
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  errorBanner: {
    ...typography.body,
    color: colors.danger,
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  successBanner: {
    ...typography.body,
    color: colors.success,
    backgroundColor: colors.surface,
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
});
