import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { signInInputSchema } from '@/schemas';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, typography } from '@/ui/tokens';

/**
 * Tela de Login e Recuperação de Senha (E1-02, RF-01).
 */
export default function SignInScreen({
  onSignIn,
}: {
  onSignIn?: (credentials: { email: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recoverySent, setRecoverySent] = useState(false);

  const handleSignIn = () => {
    setErrorMessage(null);
    const parsed = signInInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Informe e-mail e senha.');
      return;
    }
    onSignIn?.({ email: parsed.data.email });
  };

  const handlePasswordReset = () => {
    setErrorMessage(null);
    if (!email.includes('@')) {
      setErrorMessage('Digite seu e-mail acima para receber o link de recuperação.');
      return;
    }
    setRecoverySent(true);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Entrar no Eu Faço
      </Text>

      <TextField
        testID="signin-email"
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextField
        testID="signin-password"
        label="Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {errorMessage ? (
        <Text style={styles.errorBanner} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      {recoverySent ? (
        <Text style={styles.infoBanner} accessibilityRole="alert">
          Se o e-mail estiver cadastrado, enviamos as instruções para redefinir sua senha.
        </Text>
      ) : null}

      <Button testID="signin-submit" label="Entrar" onPress={handleSignIn} />

      <Button
        testID="signin-forgot-password"
        label="Esqueci minha senha"
        variant="text"
        onPress={handlePasswordReset}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.lg,
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
  infoBanner: {
    ...typography.body,
    color: colors.primary,
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
});
