import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { colors, spacing, typography } from '@/ui/tokens';

/**
 * Tela de Boas-vindas (USER_FLOWS.md seção 2.1).
 */
export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.brand} accessibilityRole="header">
        Eu Faço
      </Text>
      <Text style={styles.subtitle}>
        Profissionais com identidade verificada perto de você em Osasco.
      </Text>

      <View style={styles.actions}>
        <Button
          testID="welcome-sign-up"
          label="Criar conta"
          onPress={() => router.push('/(auth)/sign-up')}
        />
        <Button
          testID="welcome-sign-in"
          label="Entrar"
          variant="secondary"
          onPress={() => router.push('/(auth)/sign-in')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  brand: {
    ...typography.display,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xxl,
  },
  actions: {
    gap: spacing.md,
  },
});
