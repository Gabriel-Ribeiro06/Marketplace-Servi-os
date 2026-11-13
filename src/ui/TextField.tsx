import React from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { colors, radius, spacing, touch, typography } from './tokens';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  errorMessage?: string;
  helperText?: string;
  maxLength?: number;
  testID?: string;
}

/**
 * Campo de texto do Design System "Eu Faço".
 * Regras (DESIGN_SYSTEM.md seção 3):
 * - Rótulo sempre visível (nunca apenas placeholder).
 * - Mensagem de erro anunciada para leitores de tela.
 * - Contador visível quando maxLength é definido.
 */
export function TextField({
  label,
  value,
  onChangeText,
  errorMessage,
  helperText,
  maxLength,
  testID,
  ...rest
}: TextFieldProps) {
  const hasError = Boolean(errorMessage);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        {typeof maxLength === 'number' ? (
          <Text
            style={styles.counter}
            accessibilityLabel={`${value.length} de ${maxLength} caracteres`}
          >
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>

      <TextInput
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={errorMessage ?? helperText}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, hasError ? styles.inputError : null]}
        {...rest}
      />

      {hasError ? (
        <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {errorMessage}
        </Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  counter: {
    ...typography.caption,
    color: colors.textMuted,
  },
  input: {
    minHeight: touch.minSize,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.field,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  helperText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
