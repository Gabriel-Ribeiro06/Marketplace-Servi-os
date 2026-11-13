import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import ChatScreen from '@/app/(customer)/chat/[id]';
import NotificationsScreen from '@/app/(customer)/notifications';

describe('Fase 3 — Tela de Chat, Redação, Leitura e Aviso Contextual (E5-01, E5-02, E7-04)', () => {
  it('exibe mensagens (incluindo mensagem removida), marca não lidas, exibe lembrete de PIX e envia mensagem', async () => {
    const onSendMessage = jest.fn();
    const onMarkMessagesRead = jest.fn();

    await render(
      <ChatScreen
        conversationId="550e8400-e29b-41d4-a716-446655440201"
        currentUserId="client-1"
        initialMessages={[
          {
            id: 'm-1',
            conversationId: '550e8400-e29b-41d4-a716-446655440201',
            senderId: 'prov-1',
            body: 'Olá! Posso levar o sifão novo.',
            createdAt: new Date('2026-11-13T14:00:00.000Z'),
            readAt: null,
            redactedAt: null,
          },
          {
            id: 'm-2',
            conversationId: '550e8400-e29b-41d4-a716-446655440201',
            senderId: 'prov-1',
            body: null,
            createdAt: new Date('2026-11-13T14:01:00.000Z'),
            readAt: new Date('2026-11-13T14:02:00.000Z'),
            redactedAt: new Date('2026-11-13T14:03:00.000Z'),
          },
        ]}
        onSendMessage={onSendMessage}
        onMarkMessagesRead={onMarkMessagesRead}
      />,
    );

    // Mensagem redigida aparece como "Mensagem removida"
    expect(screen.getByTestId('chat-message-m-2')).toHaveTextContent('Mensagem removida');
    expect(screen.getByTestId('chat-unread-indicator')).toHaveTextContent('Mensagens não lidas: 1');

    // Marcar como lida
    await fireEvent.press(screen.getByTestId('chat-mark-read-button'));
    expect(onMarkMessagesRead).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440201');
    expect(screen.getByTestId('chat-unread-indicator')).toHaveTextContent('Mensagens não lidas: 0');

    // Digitar menção a PIX dispara lembrete contextual sem bloquear o envio
    await fireEvent.changeText(
      screen.getByTestId('chat-message-input'),
      'Combinado, pago no PIX após a conclusão do serviço.',
    );
    expect(screen.getByTestId('chat-contextual-safety-reminder')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('chat-send-button'));
    expect(onSendMessage).toHaveBeenCalledWith({
      conversationId: '550e8400-e29b-41d4-a716-446655440201',
      body: 'Combinado, pago no PIX após a conclusão do serviço.',
    });
  });

  it('oculta campo de envio quando a conversa está em modo read_only', async () => {
    await render(<ChatScreen status="read_only" />);
    expect(screen.getByTestId('chat-readonly-banner')).toBeTruthy();
    expect(screen.queryByTestId('chat-message-input')).toBeNull();
  });
});

describe('Fase 3 — Central de Notificações no App (E5-04, SEC-27)', () => {
  it('lista notificações genéricas sem PII e marca todas como lidas', async () => {
    const onMarkAllRead = jest.fn();
    await render(<NotificationsScreen onMarkAllRead={onMarkAllRead} />);

    expect(screen.getByTestId('notifications-unread-count')).toHaveTextContent('Não lidas: 2');
    await fireEvent.press(screen.getByTestId('notifications-mark-all-read'));

    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('notifications-unread-count')).toHaveTextContent('Não lidas: 0');
  });
});
