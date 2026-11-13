import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ChatMessageRecord,
  ConversationStatus,
  detectExternalContactOrPaymentHint,
  formatDisplayMessageBody,
} from '@/features/chat/chat-core';
import { chatMessageSchema } from '@/schemas';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { colors, radius, spacing, typography } from '@/ui/tokens';

export interface ChatScreenProps {
  conversationId?: string;
  currentUserId?: string;
  counterpartName?: string;
  requestTitle?: string;
  status?: ConversationStatus;
  canInteract?: boolean;
  initialMessages?: ChatMessageRecord[];
  onSendMessage?: (payload: { conversationId: string; body: string }) => void | Promise<void>;
  onMarkMessagesRead?: (conversationId: string) => void | Promise<void>;
}

const DEFAULT_CONVERSATION_UUID = '550e8400-e29b-41d4-a716-446655440201';

export default function ChatScreen({
  conversationId = DEFAULT_CONVERSATION_UUID,
  currentUserId = 'client-1',
  counterpartName = 'Marcos Encanador',
  requestTitle = 'Conserto de vazamento na pia',
  status = 'open',
  canInteract = true,
  initialMessages = [],
  onSendMessage,
  onMarkMessagesRead,
}: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => messages.filter((m) => m.senderId !== currentUserId && m.readAt === null).length,
    [messages, currentUserId],
  );

  const safetyHint = useMemo(() => detectExternalContactOrPaymentHint(draft), [draft]);

  const handleMarkRead = async () => {
    const now = new Date();
    setMessages((prev) =>
      prev.map((m) =>
        m.senderId !== currentUserId && m.readAt === null ? { ...m, readAt: now } : m,
      ),
    );
    await onMarkMessagesRead?.(conversationId);
  };

  const handleSend = async () => {
    setErrorMessage(null);

    if (!canInteract) {
      setErrorMessage('Não é possível enviar mensagens nesta conversa.');
      return;
    }

    if (status !== 'open') {
      setErrorMessage('Esta conversa está encerrada (modo somente leitura).');
      return;
    }

    const parsed = chatMessageSchema.safeParse({
      conversationId,
      body: draft,
    });

    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Digite uma mensagem válida.');
      return;
    }

    const newMsg: ChatMessageRecord = {
      id: `msg-${messages.length + 1}`,
      conversationId,
      senderId: currentUserId,
      body: parsed.data.body,
      createdAt: new Date(),
      readAt: null,
      redactedAt: null,
    };

    setMessages((prev) => [...prev, newMsg]);
    setDraft('');
    await onSendMessage?.({
      conversationId,
      body: parsed.data.body,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerBox}>
        <Text style={styles.title} accessibilityRole="header">
          Conversa com {counterpartName}
        </Text>
        <Text style={styles.subtitle}>{requestTitle}</Text>
        <Text testID="chat-unread-indicator" style={styles.unreadText}>
          Mensagens não lidas: {unreadCount}
        </Text>
        {unreadCount > 0 ? (
          <Button
            testID="chat-mark-read-button"
            label="Marcar mensagens como lidas"
            variant="secondary"
            onPress={() => {
              void handleMarkRead();
            }}
          />
        ) : null}
      </View>

      <View style={styles.safetyBanner} accessibilityRole="summary">
        <Text style={styles.safetyTitle}>Aviso de segurança</Text>
        <Text style={styles.safetyBody}>
          Para sua segurança, mantenha a combinação no aplicativo. O pagamento é feito diretamente
          ao profissional após o serviço — nunca faça adiantamentos ou PIX antecipado sem garantia.
        </Text>
      </View>

      {safetyHint.shouldShowSafetyReminder ? (
        <View testID="chat-contextual-safety-reminder" style={styles.contextualHintBox}>
          <Text style={styles.contextualHintText}>
            Lembrete: evite enviar pagamentos adiantados (PIX/sinal) antes da realização do serviço.
          </Text>
        </View>
      ) : null}

      {errorMessage ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <View style={styles.messagesList}>
        {messages.map((msg) => {
          const isMine = msg.senderId === currentUserId;
          const isRedacted = msg.redactedAt !== null || msg.body === null;
          return (
            <View
              key={msg.id}
              testID={`chat-message-${msg.id}`}
              style={[styles.messageBubble, isMine ? styles.myBubble : styles.theirBubble]}
            >
              <Text style={[styles.messageText, isRedacted && styles.redactedText]}>
                {formatDisplayMessageBody(msg)}
              </Text>
            </View>
          );
        })}
      </View>

      {status === 'read_only' || !canInteract ? (
        <View testID="chat-readonly-banner" style={styles.readOnlyBox}>
          <Text style={styles.readOnlyText}>
            Esta conversa está em modo somente leitura. O histórico permanece disponível para
            consulta.
          </Text>
        </View>
      ) : (
        <View style={styles.composerBox}>
          <TextField
            testID="chat-message-input"
            label="Sua mensagem (apenas texto)"
            value={draft}
            onChangeText={setDraft}
            placeholder="Escreva sua mensagem para alinhar detalhes do orçamento..."
            multiline
          />
          <Button
            testID="chat-send-button"
            label="Enviar mensagem"
            onPress={() => {
              void handleSend();
            }}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  headerBox: {
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  unreadText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  safetyBanner: {
    backgroundColor: colors.background,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.md,
    gap: spacing.xs,
  },
  safetyTitle: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '700',
  },
  safetyBody: {
    ...typography.caption,
    color: colors.text,
  },
  contextualHintBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.sm,
    borderRadius: radius.field,
  },
  contextualHintText: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.md,
    borderRadius: radius.card,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '600',
  },
  messagesList: {
    gap: spacing.sm,
  },
  messageBubble: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    maxWidth: '88%',
  },
  myBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.background,
    borderColor: colors.primary,
  },
  theirBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  messageText: {
    ...typography.body,
    color: colors.text,
  },
  redactedText: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  readOnlyBox: {
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  readOnlyText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  composerBox: {
    gap: spacing.sm,
  },
});
