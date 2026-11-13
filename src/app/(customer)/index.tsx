import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ProviderPublicCard,
  type PublicProviderViewModel,
} from '@/features/profile/ProviderPublicCard';
import { useActiveRole } from '@/features/profile/role-context';
import { Button } from '@/ui/Button';
import { colors, radius, spacing, typography } from '@/ui/tokens';

const MVP_CATEGORIES = [
  { slug: 'eletricista', name: 'Eletricista' },
  { slug: 'encanador', name: 'Encanador' },
  { slug: 'diarista', name: 'Diarista' },
  { slug: 'tecnico-computadores', name: 'Técnico em computadores' },
] as const;

export interface CustomerHomeScreenProps {
  activeCategorySlugs?: string[];
  featuredProviders?: PublicProviderViewModel[];
}

/**
 * Início do Cliente e Alternância de Perfil (E1-04, E2-09, E3-01).
 * - Usa o termo "profissional" (nunca "prestador") na interface do cliente (DESIGN_SYSTEM.md seção 6).
 * - Categorias sem 2 profissionais aprovados exibem "Em breve" (PRD seção 12).
 */
export default function CustomerHomeScreen({
  activeCategorySlugs = ['eletricista'],
  featuredProviders = [],
}: CustomerHomeScreenProps) {
  const { activeRole, toggleRole } = useActiveRole();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.title} accessibilityRole="header">
            Eu Faço — Osasco
          </Text>
          <Text style={styles.roleIndicator}>
            Perfil ativo: {activeRole === 'customer' ? 'Cliente' : 'Profissional'}
          </Text>
        </View>
        <Button
          testID="role-switch-button"
          label={activeRole === 'customer' ? 'Mudar para Profissional' : 'Mudar para Cliente'}
          variant="secondary"
          onPress={toggleRole}
        />
      </View>

      <Text style={styles.sectionTitle} accessibilityRole="header">
        Categorias de serviço
      </Text>

      <View style={styles.categoryGrid}>
        {MVP_CATEGORIES.map((cat) => {
          const isActive = activeCategorySlugs.includes(cat.slug);
          return (
            <View
              key={cat.slug}
              style={[styles.categoryTile, !isActive ? styles.categoryTileInactive : null]}
              accessibilityLabel={
                isActive ? `Categoria ${cat.name}` : `Categoria ${cat.name} (Em breve)`
              }
            >
              <Text style={styles.categoryName}>{cat.name}</Text>
              <Text style={isActive ? styles.categoryActiveTag : styles.categorySoonTag}>
                {isActive ? 'Disponível' : 'Em breve'}
              </Text>
            </View>
          );
        })}
      </View>

      {featuredProviders.length > 0 ? (
        <View style={styles.providersSection}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Profissionais verificados em Osasco
          </Text>
          {featuredProviders.map((provider) => (
            <ProviderPublicCard key={provider.providerId} provider={provider} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  roleIndicator: {
    ...typography.caption,
    color: colors.textMuted,
  },
  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.md,
  },
  categoryGrid: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  categoryTile: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryTileInactive: {
    borderColor: colors.border,
    opacity: 0.75,
  },
  categoryName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  categoryActiveTag: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.success,
  },
  categorySoonTag: {
    ...typography.caption,
    color: colors.textMuted,
  },
  providersSection: {
    marginTop: spacing.md,
  },
});
