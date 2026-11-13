import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { VerificationBadge } from '@/ui/VerificationBadge';
import { colors, radius, spacing, typography } from '@/ui/tokens';

export interface PublicProviderViewModel {
  providerId: string;
  displayName: string;
  bio: string;
  categories: string[];
  neighborhoods: string[];
  experienceYears?: number | null;
  ratingAvg: number;
  ratingCount: number;
  completedJobsCount: number;
  avgFirstResponseMinutes?: number | null;
}

/**
 * Cartão de Perfil Público do Profissional (RF-13, E2-09, SECURITY.md 4.1, DESIGN_SYSTEM.md 3 e 4).
 * Regras obrigatórias:
 * - Exibe o selo único "Identidade verificada" com explicação interativa.
 * - Rotula tempo de experiência autodeclarado como "(informado pelo profissional)".
 * - Nunca usa termos proibidos ("qualificado", "certificado", "garantido").
 */
export function ProviderPublicCard({ provider }: { provider: PublicProviderViewModel }) {
  return (
    <View style={styles.card} accessibilityLabel={`Perfil público de ${provider.displayName}`}>
      <View style={styles.header}>
        <Text style={styles.name} accessibilityRole="header">
          {provider.displayName}
        </Text>
        <VerificationBadge />
      </View>

      <Text style={styles.categoriesText}>Especialidades: {provider.categories.join(' · ')}</Text>
      <Text style={styles.neighborhoodsText}>
        Bairros em Osasco: {provider.neighborhoods.join(', ')}
      </Text>

      {provider.bio ? <Text style={styles.bio}>{provider.bio}</Text> : null}

      <View style={styles.metricsRow}>
        <Text style={styles.metricItem}>
          ★ {provider.ratingCount > 0 ? provider.ratingAvg.toFixed(1) : 'Novo'} (
          {provider.ratingCount} avaliações)
        </Text>
        <Text style={styles.metricItem}>✓ {provider.completedJobsCount} serviços concluídos</Text>
        {typeof provider.avgFirstResponseMinutes === 'number' ? (
          <Text style={styles.metricItem}>
            ◷ Responde em ~{provider.avgFirstResponseMinutes} min
          </Text>
        ) : null}
      </View>

      {typeof provider.experienceYears === 'number' ? (
        <Text style={styles.selfDeclaredNote}>
          Experiência: {provider.experienceYears} {provider.experienceYears === 1 ? 'ano' : 'anos'}{' '}
          (informado pelo profissional)
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  name: {
    ...typography.title,
    color: colors.text,
  },
  categoriesText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  neighborhoodsText: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  bio: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.md,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  metricItem: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.text,
  },
  selfDeclaredNote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
