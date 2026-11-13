import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, signUpInputSchema } from '@/schemas';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, touch, typography } from '@/ui/tokens';

export interface SignUpScreenProps {
  onSuccess?: (payload: {
    fullName: string;
    email: string;
    termsVersion: string;
    privacyVersion: string;
  }) => void;
}

/**
 * Tela de Cadastro (E1-01, RF-01, RF-32, RF-33, RF-44, T-LGPD-04).
 * Exige nome, e-mail, senha >= 8, declaração de 18+ e aceite versionado de Termos e Privacidade.
 */
export default function SignUpScreen({ onSuccess }: SignUpScreenProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setErrorMessage(null);
    const parsed = signUpInputSchema.safeParse({
      fullName,
      email,
      password,
      ageConfirmed,
      termsAccepted,
    });

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setErrorMessage(firstIssue?.message ?? 'Verifique os campos obrigatórios.');
      return;
    }

    setSubmitted(true);
    onSuccess?.({
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Criar sua conta
      </Text>
      <Text style={styles.subtitle}>
        Uma única conta para contratar ou oferecer serviços em Osasco.
      </Text>

      <TextField
        testID="signup-full-name"
        label="Nome completo"
        value={fullName}
        onChangeText={setFullName}
        maxLength={120}
      />

      <TextField
        testID="signup-email"
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextField
        testID="signup-password"
        label="Senha (mínimo de 8 caracteres)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Pressable
        testID="signup-age-checkbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ageConfirmed }}
        accessibilityLabel="Declaro que tenho 18 anos ou mais"
        onPress={() => setAgeConfirmed((prev) => !prev)}
        style={styles.checkboxRow}
      >
        <Text style={styles.checkboxSymbol}>{ageConfirmed ? '☑' : '☐'}</Text>
        <Text style={styles.checkboxLabel}>Declaro que tenho 18 anos ou mais.</Text>
      </Pressable>

      <Pressable
        testID="signup-terms-checkbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: termsAccepted }}
        accessibilityLabel="Aceito os Termos de Uso e a Política de Privacidade"
        onPress={() => setTermsAccepted((prev) => !prev)}
        style={styles.checkboxRow}
      >
        <Text style={styles.checkboxSymbol}>{termsAccepted ? '☑' : '☐'}</Text>
        <Text style={styles.checkboxLabel}>
          Li e aceito os Termos de Uso (v{CURRENT_TERMS_VERSION}) e a Política de Privacidade (v
          {CURRENT_PRIVACY_VERSION}).
        </Text>
      </Pressable>

      {errorMessage ? (
        <Text style={styles.errorBanner} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      {submitted ? (
        <Text style={styles.successBanner} accessibilityRole="alert">
          Conta criada! Verifique seu e-mail para continuar.
        </Text>
      ) : null}

      <Button testID="signup-submit" label="Criar conta" onPress={handleSubmit} />
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
  checkboxRow: {
    minHeight: touch.minSize,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
  },
  checkboxSymbol: {
    ...typography.subtitle,
    color: colors.primary,
  },
  checkboxLabel: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  errorBanner: {
    ...typography.body,
    color: colors.danger,
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  successBanner: {
    ...typography.body,
    color: colors.success,
    backgroundColor: colors.surface,
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
});
