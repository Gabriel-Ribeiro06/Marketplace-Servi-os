import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

import { colors, radius, spacing, touch, typography } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * Botão acessível do Design System "Eu Faço".
 * Regras (DESIGN_SYSTEM.md seção 3):
 * - Altura mínima de 48dp (touch.minSize).
 * - Estado de carregamento e desabilitado com motivo.
 * - accessibilityRole="button" e accessibilityState explícitos.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  disabledReason,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const computedLabel =
    disabled && disabledReason ? `${label}. Indisponível: ${disabledReason}` : label;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={computedLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variantContainerStyles[variant],
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          testID={testID ? `${testID}-loading` : 'button-loading'}
          color={variant === 'secondary' || variant === 'text' ? colors.primary : colors.onPrimary}
        />
      ) : (
        <Text style={[styles.label, variantTextStyles[variant]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.minSize,
    minWidth: touch.minSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.field,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    ...typography.body,
    fontWeight: '600',
  },
});

const variantContainerStyles: Record<ButtonVariant, ViewStyle> = {
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  text: {
    backgroundColor: 'transparent',
  },
  destructive: {
    backgroundColor: colors.danger,
  },
};

const variantTextStyles: Record<ButtonVariant, TextStyle> = {
  primary: {
    color: colors.onPrimary,
  },
  secondary: {
    color: colors.primary,
  },
  text: {
    color: colors.primary,
  },
  destructive: {
    color: colors.onPrimary,
  },
};
