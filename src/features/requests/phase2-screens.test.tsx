import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import CreateRequestScreen from '@/app/(customer)/create-request';
import CustomerRequestDetailsScreen from '@/app/(customer)/request/[id]';
import ProviderRequestsScreen from '@/app/(provider)/requests';

import { QuoteRecord } from './requests-core';

describe('Fase 2 — Criação de Pedido e Demanda Não Atendida (E3-02, E3-03, E7-04)', () => {
  it('cria pedido válido exibindo aviso de privacidade de endereço/fotos e sem expor contagem de profissionais', async () => {
    const onCreateRequest = jest.fn().mockReturnValue({
      requestId: 'req-open-1',
      status: 'open',
      eligible: true,
    });

    await render(<CreateRequestScreen onCreateRequest={onCreateRequest} />);

    expect(
      screen.getByText(/Seu endereço completo ficará oculto e só será liberado/i),
    ).toBeTruthy();

    await fireEvent.changeText(
      screen.getByTestId('request-title-input'),
      'Troca de disjuntor no quadro',
    );
    await fireEvent.changeText(
      screen.getByTestId('request-description-input'),
      'Preciso substituir o disjuntor geral que está desarmando com frequência.',
    );
    await fireEvent.changeText(
      screen.getByTestId('request-address-input'),
      'Rua Antônio Agu, 500, Apto 42 — Centro, Osasco',
    );

    await fireEvent.press(screen.getByTestId('request-submit-button'));

    expect(onCreateRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('request-created-open-banner')).toBeTruthy();
  });

  it('avisa com transparência quando não há profissionais elegíveis e permite acionar "Avise-me"', async () => {
    const onCreateRequest = jest.fn().mockReturnValue({
      requestId: 'req-unserved-1',
      status: 'expired',
      eligible: false,
    });
    const onNotifyWhenAvailable = jest.fn();

    await render(
      <CreateRequestScreen
        onCreateRequest={onCreateRequest}
        onNotifyWhenAvailable={onNotifyWhenAvailable}
      />,
    );

    await fireEvent.changeText(
      screen.getByTestId('request-title-input'),
      'Instalação de torneira elétrica',
    );
    await fireEvent.changeText(
      screen.getByTestId('request-description-input'),
      'Instalar torneira elétrica 220V na bancada da cozinha com ponto existente.',
    );
    await fireEvent.changeText(
      screen.getByTestId('request-address-input'),
      'Av. dos Autonomistas, 1500 — Vila Yara, Osasco',
    );

    await fireEvent.press(screen.getByTestId('request-submit-button'));

    expect(screen.getByTestId('request-no-eligible-banner')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('request-notify-when-available-button'));

    expect(onNotifyWhenAvailable).toHaveBeenCalledWith('req-unserved-1');
    expect(screen.getByTestId('request-notify-confirmed')).toBeTruthy();
  });
});

describe('Fase 2 — Comparação de Propostas, Aceite com Confirmação e Cancelamento/Repetição (E3-04..06)', () => {
  const sampleQuotes: QuoteRecord[] = [
    {
      id: 'q-expensive-top-rated',
      requestId: 'req-1',
      providerId: 'prov-1',
      providerDisplayName: 'Ana Eletricista',
      providerRatingAvg: 5.0,
      providerRatingCount: 25,
      providerCompletedJobsCount: 40,
      providerAvgResponseMinutes: 20,
      totalPriceCents: 24000,
      visitFeeCents: 0,
      includesDescription: 'Substituição completa com medição de corrente.',
      proposedStart: new Date('2026-11-14T14:00:00.000Z'),
      validUntil: new Date('2026-11-15T12:00:00.000Z'),
      revision: 1,
      status: 'sent',
    },
    {
      id: 'q-cheaper-fast',
      requestId: 'req-1',
      providerId: 'prov-2',
      providerDisplayName: 'Carlos Eletricista',
      providerRatingAvg: 4.7,
      providerRatingCount: 12,
      providerCompletedJobsCount: 18,
      providerAvgResponseMinutes: 7,
      totalPriceCents: 16000,
      visitFeeCents: 2500,
      includesDescription: 'Troca rápida do disjuntor no quadro principal.',
      proposedStart: new Date('2026-11-14T15:00:00.000Z'),
      validUntil: new Date('2026-11-15T12:00:00.000Z'),
      revision: 0,
      status: 'sent',
    },
  ];

  it('ordena propostas por preço/avaliação/tempo de resposta e exige confirmação explícita no aceite', async () => {
    const onAcceptQuote = jest.fn();

    await render(
      <CustomerRequestDetailsScreen
        requestId="req-1"
        quotes={sampleQuotes}
        onAcceptQuote={onAcceptQuote}
      />,
    );

    // Por padrão ordena por menor preço -> Carlos (R$ 160,00) aparece no card 0
    expect(screen.getByTestId('quote-card-0')).toHaveTextContent(/Carlos Eletricista/);

    // Ordenar por maior avaliação -> Ana (5.0) passa para o card 0
    await fireEvent.press(screen.getByTestId('sort-rating-desc'));
    expect(screen.getByTestId('quote-card-0')).toHaveTextContent(/Ana Eletricista/);

    // Clicar em escolher proposta abre confirmação explícita antes de chamar onAcceptQuote
    await fireEvent.press(screen.getByTestId('select-quote-q-cheaper-fast'));
    expect(onAcceptQuote).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('confirm-accept-quote-q-cheaper-fast'));
    expect(onAcceptQuote).toHaveBeenCalledWith('q-cheaper-fast');
  });

  it('permite cancelar pedido aberto e usar "Repetir pedido" após encerrado', async () => {
    const onCancelRequest = jest.fn();
    const onRepeatRequest = jest.fn();

    await render(
      <CustomerRequestDetailsScreen
        requestId="req-99"
        status="open"
        quotes={[]}
        onCancelRequest={onCancelRequest}
        onRepeatRequest={onRepeatRequest}
      />,
    );

    await fireEvent.press(screen.getByTestId('cancel-request-button'));
    expect(onCancelRequest).toHaveBeenCalledWith('req-99');

    // Após cancelado (terminal), o botão "Repetir pedido" fica disponível
    await fireEvent.press(screen.getByTestId('repeat-request-button'));
    expect(onRepeatRequest).toHaveBeenCalledWith('req-99');
  });
});

describe('Fase 2 — Fila de Pedidos do Prestador, Envio, Revisão Única e Retirada de Proposta (E4-01..05)', () => {
  const reqId = '550e8400-e29b-41d4-a716-446655440101';

  it('oculta endereço antes do aceite, converte R$ para centavos, permite 1 revisão e bloqueia 2ª revisão', async () => {
    const onSubmitQuote = jest.fn();
    const onEditQuote = jest.fn();
    const onWithdrawQuote = jest.fn();

    await render(
      <ProviderRequestsScreen
        onSubmitQuote={onSubmitQuote}
        onEditQuote={onEditQuote}
        onWithdrawQuote={onWithdrawQuote}
      />,
    );

    expect(screen.getByTestId('hidden-private-address-notice')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId(`quote-price-input-${reqId}`), '180,00');
    await fireEvent.changeText(
      screen.getByTestId(`quote-includes-input-${reqId}`),
      'Substituição do disjuntor bipolar + reaperto geral do quadro.',
    );

    // 1. Enviar proposta inicial (revision = 0)
    await fireEvent.press(screen.getByTestId(`submit-or-edit-quote-${reqId}`));
    expect(onSubmitQuote).toHaveBeenCalledWith({
      requestId: reqId,
      totalPriceCents: 18000,
      visitFeeCents: 0,
      includesDescription: 'Substituição do disjuntor bipolar + reaperto geral do quadro.',
    });

    // 2. Revisar proposta (revision = 1)
    await fireEvent.changeText(screen.getByTestId(`quote-price-input-${reqId}`), '165,00');
    await fireEvent.press(screen.getByTestId(`submit-or-edit-quote-${reqId}`));
    expect(onEditQuote).toHaveBeenCalledWith({
      requestId: reqId,
      totalPriceCents: 16500,
      includesDescription: 'Substituição do disjuntor bipolar + reaperto geral do quadro.',
    });

    // 3. Tentar revisar pela 2ª vez -> bloqueado
    await fireEvent.changeText(screen.getByTestId(`quote-price-input-${reqId}`), '150,00');
    await fireEvent.press(screen.getByTestId(`submit-or-edit-quote-${reqId}`));
    expect(onEditQuote).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/uma única vez/);

    // 4. Retirar proposta
    await fireEvent.press(screen.getByTestId(`withdraw-quote-${reqId}`));
    expect(onWithdrawQuote).toHaveBeenCalledWith(reqId);
  });

  it('permite descartar pedido que não interessa ao prestador', async () => {
    const onDismissRequest = jest.fn();
    await render(<ProviderRequestsScreen onDismissRequest={onDismissRequest} />);

    await fireEvent.press(screen.getByTestId(`dismiss-request-${reqId}`));
    expect(onDismissRequest).toHaveBeenCalledWith(reqId);
  });
});
