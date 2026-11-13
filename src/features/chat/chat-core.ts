/**
 * Núcleo de regras de negócio da Fase 3 — Chat em Tempo Real e Notificações Push (Épico E5)
 * Fonte: docs/DATABASE.md (seções 3.4, 3.6, 6, 7), docs/SECURITY.md (SEC-25, SEC-27), docs/PRD.md (D-06)
 */

export const DEFAULT_MAX_MESSAGES_PER_MINUTE = 20;
export const DEFAULT_PROVIDER_DAILY_PUSH_CAP = 10;
export const DEFAULT_NOTIFICATIONS_RETENTION_DAYS = 90;
export const REDACTED_MESSAGE_PLACEHOLDER = 'Mensagem removida';

export type ConversationStatus = 'open' | 'read_only';

export type NotificationKind =
  | 'new_message'
  | 'new_quote'
  | 'quote_revised'
  | 'quote_accepted'
  | 'new_request_batch'
  | 'request_expiring'
  | 'job_completed';

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  createdAt: Date;
  readAt: Date | null;
  redactedAt: Date | null;
}

export interface ConversationRecord {
  id: string;
  requestId: string;
  quoteId: string;
  clientId: string;
  providerId: string;
  status: ConversationStatus;
  lastMessageAt: Date | null;
  messages: ChatMessageRecord[];
}

export function formatDisplayMessageBody(
  msg: Pick<ChatMessageRecord, 'body' | 'redactedAt'>,
): string {
  if (msg.redactedAt !== null || msg.body === null) {
    return REDACTED_MESSAGE_PLACEHOLDER;
  }
  return msg.body;
}

/**
 * Detecta menções a telefone, links externos ou adiantamento/PIX no chat
 * para exibir aviso contextual de segurança (sem bloquear o envio — PRD D-06 e E7-04).
 */
export function detectExternalContactOrPaymentHint(text: string): {
  hasPhoneOrLink: boolean;
  hasAdvancePaymentMention: boolean;
  shouldShowSafetyReminder: boolean;
} {
  const normalized = text.toLowerCase();
  const hasPhoneOrLink =
    /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}/.test(text) ||
    /https?:\/\/|wa\.me|whatsapp/i.test(text);
  const hasAdvancePaymentMention = /\b(pix|sinal|adiantamento|adiantar|depósito|deposito)\b/i.test(
    normalized,
  );

  return {
    hasPhoneOrLink,
    hasAdvancePaymentMention,
    shouldShowSafetyReminder: hasPhoneOrLink || hasAdvancePaymentMention,
  };
}

export function sendMessageInMemory(
  conversation: ConversationRecord,
  input: {
    id: string;
    senderId: string;
    body: string;
    canInteract: boolean;
    now?: Date;
    maxMessagesPerMinute?: number;
  },
): { ok: true; conversation: ConversationRecord } | { ok: false; errorCode: string } {
  const now = input.now ?? new Date();
  const maxPerMin = input.maxMessagesPerMinute ?? DEFAULT_MAX_MESSAGES_PER_MINUTE;
  const trimmed = input.body.trim();

  if (input.senderId !== conversation.clientId && input.senderId !== conversation.providerId) {
    return { ok: false, errorCode: 'NOT_FOUND' };
  }

  if (!input.canInteract) {
    return { ok: false, errorCode: 'BLOCKED' };
  }

  if (conversation.status !== 'open') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }

  if (trimmed.length < 1 || trimmed.length > 2000) {
    return { ok: false, errorCode: 'VALIDATION_ERROR' };
  }

  const oneMinuteAgo = now.getTime() - 60 * 1000;
  const sentLastMinute = conversation.messages.filter(
    (m) => m.senderId === input.senderId && m.createdAt.getTime() >= oneMinuteAgo,
  ).length;

  if (sentLastMinute >= maxPerMin) {
    return { ok: false, errorCode: 'RATE_LIMITED' };
  }

  const newMessage: ChatMessageRecord = {
    id: input.id,
    conversationId: conversation.id,
    senderId: input.senderId,
    body: trimmed,
    createdAt: now,
    readAt: null,
    redactedAt: null,
  };

  return {
    ok: true,
    conversation: {
      ...conversation,
      lastMessageAt: now,
      messages: [...conversation.messages, newMessage],
    },
  };
}

export function markMessagesReadInMemory(
  conversation: ConversationRecord,
  readerId: string,
  now: Date = new Date(),
): { updatedCount: number; conversation: ConversationRecord } {
  if (readerId !== conversation.clientId && readerId !== conversation.providerId) {
    return { updatedCount: 0, conversation };
  }

  let updatedCount = 0;
  const messages = conversation.messages.map((m) => {
    if (m.senderId !== readerId && m.readAt === null) {
      updatedCount += 1;
      return { ...m, readAt: now };
    }
    return m;
  });

  return {
    updatedCount,
    conversation: {
      ...conversation,
      messages,
    },
  };
}

export function redactUserMessagesInMemory(
  conversation: ConversationRecord,
  userIdToRedact: string,
  now: Date = new Date(),
): ConversationRecord {
  return {
    ...conversation,
    messages: conversation.messages.map((m) =>
      m.senderId === userIdToRedact ? { ...m, body: null, redactedAt: now } : m,
    ),
  };
}

const GENERIC_PUSH_TEMPLATES: Record<NotificationKind, { title: string; body: string }> = {
  new_message: {
    title: 'Nova mensagem no Eu Faço',
    body: 'Abra o aplicativo para ler e responder com segurança.',
  },
  new_quote: {
    title: 'Nova proposta recebida',
    body: 'Um profissional verificado enviou um orçamento para o seu pedido.',
  },
  quote_revised: {
    title: 'Proposta atualizada',
    body: 'Um profissional atualizou as condições da proposta enviada.',
  },
  quote_accepted: {
    title: 'Sua proposta foi aceita!',
    body: 'Abra o aplicativo para ver os detalhes do agendamento e o endereço.',
  },
  new_request_batch: {
    title: 'Novo pedido compatível em Osasco',
    body: 'Há uma nova solicitação na sua categoria e bairro de atendimento.',
  },
  request_expiring: {
    title: 'Seu pedido expira em breve',
    body: 'Confira as propostas recebidas antes do encerramento do prazo de 48h.',
  },
  job_completed: {
    title: 'Serviço concluído',
    body: 'Deixe sua avaliação no aplicativo para ajudar a comunidade.',
  },
};

/**
 * Gera payload de push estritamente genérico (SEC-27 / T-PUSH-01):
 * Nunca inclui nome do remetente, endereço, valor ou texto da mensagem na tela de bloqueio.
 */
export function buildGenericPushPayload(input: {
  notificationId: string;
  type: NotificationKind;
}): {
  title: string;
  body: string;
  data: { notificationId: string; type: NotificationKind };
} {
  const template = GENERIC_PUSH_TEMPLATES[input.type];
  return {
    title: template.title,
    body: template.body,
    data: {
      notificationId: input.notificationId,
      type: input.type,
    },
  };
}

export function isQuietHoursInSaoPaulo(now: Date): boolean {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const hour = Number(hourStr);
  return hour >= 21 || hour < 7;
}

export function evaluatePushDispatchPolicy(input: {
  type: NotificationKind;
  canInteract: boolean;
  isProviderRecipient: boolean;
  providerPushesSentLast24h: number;
  now: Date;
  dailyCap?: number;
}): { shouldSendPush: boolean; reason?: string } {
  if (!input.canInteract) {
    return { shouldSendPush: false, reason: 'BLOCKED_BY_CAN_INTERACT' };
  }

  if (input.type === 'new_request_batch' && isQuietHoursInSaoPaulo(input.now)) {
    return { shouldSendPush: false, reason: 'QUIET_HOURS_DEFERRED' };
  }

  const cap = input.dailyCap ?? DEFAULT_PROVIDER_DAILY_PUSH_CAP;
  if (
    (input.isProviderRecipient || input.type === 'new_request_batch') &&
    input.providerPushesSentLast24h >= cap
  ) {
    return { shouldSendPush: false, reason: 'DAILY_PUSH_CAP_REACHED' };
  }

  return { shouldSendPush: true };
}
