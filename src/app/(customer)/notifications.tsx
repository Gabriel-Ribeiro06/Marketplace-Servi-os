import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { buildGenericPushPayload, NotificationKind } from '@/features/chat/chat-core';
import { Button } from '@/ui/Button';
import { colors, radius, spacing, typography } from '@/ui/tokens';

export interface NotificationItem {
  id: string;
  type: NotificationKind;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsScreenProps {
  initialNotifications?: NotificationItem[];
  onMarkAllRead?: () => void | Promise<void>;
}

const DEFAULT_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    type: 'new_quote',
    readAt: null,
    createdAt: '2026-11-13T14:00:00.000Z',
  },
  {
    id: 'notif-2',
    type: 'new_message',
    readAt: null,
    createdAt: '2026-11-13T14:05:00.000Z',
  },
];

export default function NotificationsScreen({
  initialNotifications = DEFAULT_NOTIFICATIONS,
  onMarkAllRead,
}: NotificationsScreenProps) {
  const [items, setItems] = useState<NotificationItem[]>(initialNotifications);

  const unreadCount = useMemo(() => items.filter((item) => item.readAt === null).length, [items]);

  const handleMarkAllRead = async () => {
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((item) => (item.readAt === null ? { ...item, readAt: nowIso } : item)),
    );
    await onMarkAllRead?.();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Central de notificações
      </Text>
      <Text style={styles.subtitle}>
        Suas notificações permanecem disponíveis por 90 dias. Por privacidade, avisos na tela de
        bloqueio não exibem dados pessoais.
      </Text>

      <View style={styles.summaryRow}>
        <Text testID="notifications-unread-count" style={styles.unreadText}>
          Não lidas: {unreadCount}
        </Text>
        {unreadCount > 0 ? (
          <Button
            testID="notifications-mark-all-read"
            label="Marcar todas como lidas"
            variant="secondary"
            onPress={() => {
              void handleMarkAllRead();
            }}
          />
        ) : null}
      </View>

      {items.map((item) => {
        const genericCopy = buildGenericPushPayload({
          notificationId: item.id,
          type: item.type,
        });
        const isUnread = item.readAt === null;

        return (
          <View
            key={item.id}
            testID={`notification-item-${item.id}`}
            style={[styles.card, isUnread && styles.cardUnread]}
          >
            <Text style={styles.cardTitle}>
              {isUnread ? '● ' : '○ '}
              {genericCopy.title}
            </Text>
            <Text style={styles.cardBody}>{genericCopy.body}</Text>
          </View>
        );
      })}
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
    ...typography.caption,
    color: colors.textMuted,
  },
  summaryRow: {
    gap: spacing.sm,
  },
  unreadText: {
    ...typography.subtitle,
    color: colors.primary,
    fontWeight: '700',
  },
  card: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  cardUnread: {
    backgroundColor: colors.background,
    borderColor: colors.primary,
  },
  cardTitle: {
    ...typography.subtitle,
    color: colors.text,
    fontWeight: '700',
  },
  cardBody: {
    ...typography.body,
    color: colors.textMuted,
  },
});
