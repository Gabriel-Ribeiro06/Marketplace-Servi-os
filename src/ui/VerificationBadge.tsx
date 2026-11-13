import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { colors, radius, spacing, touch, typography } from './tokens';

export const VERIFICATION_BADGE_TITLE = 'Identidade verificada';

export const VERIFICATION_BADGE_EXPLANATION =
  'Confirmamos manualmente um documento oficial com foto e uma selfie deste profissional. ' +
  'Este selo confirma apenas a identidade civil (maior de 18 anos) e não garante ' +
  'competência técnica, antecedentes ou execução do serviço.';

export interface VerificationBadgeProps {
  testID?: string;
}

/**
 * Selo único de verificação do MVP (DESIGN_SYSTEM.md seções 3 e 4; SECURITY.md seção 4.1).
 * - Texto fixo: "Identidade verificada".
 * - Ao tocar, explica o que foi e o que NÃO foi verificado.
 * - Termos proibidos ("qualificado", "certificado", "garantido", "profissional de confiança")
 *   são vedados e auditados por teste automatizado.
 */
export function VerificationBadge({ testID }: VerificationBadgeProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        testID={testID ?? 'verification-badge'}
        accessibilityRole="button"
        accessibilityLabel={`${VERIFICATION_BADGE_TITLE}. Toque para saber o que foi verificado.`}
        onPress={() => setOpen(true)}
        style={styles.badge}
      >
        <Text style={styles.badgeText}>✓ {VERIFICATION_BADGE_TITLE}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {VERIFICATION_BADGE_TITLE}
            </Text>
            <Text style={styles.sheetBody}>{VERIFICATION_BADGE_EXPLANATION}</Text>
            <Button
              testID="verification-badge-close"
              label="Entendi"
              onPress={() => setOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    minHeight: touch.minSize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.success,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 31, 43, 0.5)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.xl,
  },
  sheetTitle: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.md,
  },
  sheetBody: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.xl,
  },
});
