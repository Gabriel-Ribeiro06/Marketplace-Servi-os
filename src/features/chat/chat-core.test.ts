import {
  buildGenericPushPayload,
  ConversationRecord,
  detectExternalContactOrPaymentHint,
  evaluatePushDispatchPolicy,
  formatDisplayMessageBody,
  markMessagesReadInMemory,
  REDACTED_MESSAGE_PLACEHOLDER,
  redactUserMessagesInMemory,
  sendMessageInMemory,
} from './chat-core';

describe('Fase 3 — Chat em Tempo Real, Bloqueio, Rate Limit e Redação (E5-01, E5-02, T-BLK-01)', () => {
  const now = new Date('2026-11-13T15:00:00.000Z');

  const createConversation = (): ConversationRecord => ({
    id: 'conv-1',
    requestId: 'req-1',
    quoteId: 'quote-1',
    clientId: 'client-1',
    providerId: 'prov-1',
    status: 'open',
    lastMessageAt: null,
    messages: [],
  });

  it('envia mensagem válida, bloqueia quando canInteract=false ou read_only e aplica rate limit', () => {
    let conv = createConversation();

    // Envio válido pelo prestador
    const sent = sendMessageInMemory(conv, {
      id: 'msg-1',
      senderId: 'prov-1',
      body: 'Olá! Posso atender amanhã às 14h.',
      canInteract: true,
      now,
    });
    expect(sent.ok).toBe(true);
    if (sent.ok) conv = sent.conversation;
    expect(conv.messages).toHaveLength(1);

    // Bloqueio entre as partes (canInteract = false) -> BLOCKED
    const blocked = sendMessageInMemory(conv, {
      id: 'msg-2',
      senderId: 'client-1',
      body: 'Tudo bem!',
      canInteract: false,
      now,
    });
    expect(blocked).toEqual({ ok: false, errorCode: 'BLOCKED' });

    // Conversa read_only -> INVALID_STATE
    const closedConv: ConversationRecord = { ...conv, status: 'read_only' };
    const onReadOnly = sendMessageInMemory(closedConv, {
      id: 'msg-3',
      senderId: 'client-1',
      body: 'Mensagem após fechamento',
      canInteract: true,
      now,
    });
    expect(onReadOnly).toEqual({ ok: false, errorCode: 'INVALID_STATE' });

    // Rate limit por minuto
    const rateLimited = sendMessageInMemory(conv, {
      id: 'msg-4',
      senderId: 'prov-1',
      body: 'Segunda mensagem no mesmo minuto',
      canInteract: true,
      now,
      maxMessagesPerMinute: 1,
    });
    expect(rateLimited).toEqual({ ok: false, errorCode: 'RATE_LIMITED' });
  });

  it('marca como lidas apenas as mensagens recebidas da outra parte e formata mensagens redigidas', () => {
    let conv = createConversation();
    const s1 = sendMessageInMemory(conv, {
      id: 'msg-1',
      senderId: 'prov-1',
      body: 'Orçamento enviado.',
      canInteract: true,
      now,
    });
    if (s1.ok) conv = s1.conversation;

    // O próprio remetente tentando marcar -> 0 atualizadas
    const selfRead = markMessagesReadInMemory(conv, 'prov-1', now);
    expect(selfRead.updatedCount).toBe(0);

    // Destinatário (client-1) marca como lida -> 1 atualizada
    const clientRead = markMessagesReadInMemory(conv, 'client-1', now);
    expect(clientRead.updatedCount).toBe(1);
    expect(clientRead.conversation.messages[0]?.readAt).toEqual(now);

    // Redação (exclusão de conta / moderação) -> exibe "Mensagem removida"
    const redactedConv = redactUserMessagesInMemory(clientRead.conversation, 'prov-1', now);
    expect(formatDisplayMessageBody(redactedConv.messages[0]!)).toBe(REDACTED_MESSAGE_PLACEHOLDER);
  });

  it('detecta menção a telefone, link ou adiantamento/PIX para exibir lembrete contextual (PRD D-06)', () => {
    expect(
      detectExternalContactOrPaymentHint('Podemos conversar aqui pelo chat mesmo.')
        .shouldShowSafetyReminder,
    ).toBe(false);

    expect(detectExternalContactOrPaymentHint('Me chama no 11 98765-4321').hasPhoneOrLink).toBe(
      true,
    );

    expect(
      detectExternalContactOrPaymentHint('Preciso de um sinal via PIX antes de ir')
        .hasAdvancePaymentMention,
    ).toBe(true);
  });
});

describe('Fase 3 — Push Genérico sem PII, Janela Silenciosa e Teto Diário (E5-03, SEC-27, T-PUSH-01..03)', () => {
  it('T-PUSH-01 / SEC-27: gera título e corpo genéricos sem vazar PII na tela de bloqueio', () => {
    const payload = buildGenericPushPayload({
      notificationId: 'notif-123',
      type: 'new_message',
    });

    expect(payload.title).toBe('Nova mensagem no Eu Faço');
    expect(payload.body).toBe('Abra o aplicativo para ler e responder com segurança.');
    expect(JSON.stringify(payload)).not.toMatch(/Rua|R\$|Carla|Marcos/);
  });

  it('T-PUSH-02 / T-BLK-03: respeita canInteract, janela silenciosa (21h-07h SP) e teto diário de 10 pushes do prestador', () => {
    // 14:00 UTC = 11:00 America/Sao_Paulo (fora da janela silenciosa)
    const daytimeSP = new Date('2026-11-13T14:00:00.000Z');
    // 01:00 UTC = 22:00 America/Sao_Paulo (dentro da janela silenciosa 21h-07h)
    const nightSP = new Date('2026-11-14T01:00:00.000Z');

    expect(
      evaluatePushDispatchPolicy({
        type: 'new_message',
        canInteract: false,
        isProviderRecipient: false,
        providerPushesSentLast24h: 0,
        now: daytimeSP,
      }),
    ).toEqual({ shouldSendPush: false, reason: 'BLOCKED_BY_CAN_INTERACT' });

    expect(
      evaluatePushDispatchPolicy({
        type: 'new_request_batch',
        canInteract: true,
        isProviderRecipient: true,
        providerPushesSentLast24h: 2,
        now: nightSP,
      }),
    ).toEqual({ shouldSendPush: false, reason: 'QUIET_HOURS_DEFERRED' });

    expect(
      evaluatePushDispatchPolicy({
        type: 'new_request_batch',
        canInteract: true,
        isProviderRecipient: true,
        providerPushesSentLast24h: 10,
        now: daytimeSP,
      }),
    ).toEqual({ shouldSendPush: false, reason: 'DAILY_PUSH_CAP_REACHED' });

    expect(
      evaluatePushDispatchPolicy({
        type: 'new_request_batch',
        canInteract: true,
        isProviderRecipient: true,
        providerPushesSentLast24h: 9,
        now: daytimeSP,
      }),
    ).toEqual({ shouldSendPush: true });
  });
});
