import {
  acceptQuoteInMemory,
  canProviderReadPrivateAddress,
  editQuoteInMemory,
  evaluateCategoryGate,
  ProviderCandidate,
  RequestRecord,
  selectAndBatchEligibleProviders,
  sortQuotesForComparison,
  submitQuoteInMemory,
  withdrawQuoteInMemory,
} from './requests-core';

describe('Fase 2 — Gate de abertura de categorias em Osasco (PRD seção 12, RF-45)', () => {
  it('libera categoria aos clientes somente quando atingir >= 2 prestadores aprovados e disponíveis e 0 pendentes > 48h', () => {
    const blockedOnlyOne = evaluateCategoryGate({
      categoryId: 'cat-eletricista',
      approvedProvidersCount: 1,
      availableProvidersCount: 1,
      overduePendingVerificationsCount: 0,
    });
    expect(blockedOnlyOne.canOpenToCustomers).toBe(false);

    const blockedOverdueSla = evaluateCategoryGate({
      categoryId: 'cat-eletricista',
      approvedProvidersCount: 2,
      availableProvidersCount: 2,
      overduePendingVerificationsCount: 1,
    });
    expect(blockedOverdueSla.canOpenToCustomers).toBe(false);

    const ready = evaluateCategoryGate({
      categoryId: 'cat-eletricista',
      approvedProvidersCount: 2,
      availableProvidersCount: 2,
      overduePendingVerificationsCount: 0,
    });
    expect(ready.canOpenToCustomers).toBe(true);
  });
});

describe('Fase 2 — Elegibilidade nos 8 critérios e distribuição em lotes equilibrados (T-MATCH-01..07)', () => {
  const baseCandidate = (overrides: Partial<ProviderCandidate>): ProviderCandidate => ({
    providerId: 'prov-1',
    profileStatus: 'active',
    verificationStatus: 'approved',
    isPaused: false,
    categoryIds: ['cat-eletricista'],
    neighborhoodIds: ['nh-centro'],
    availabilitySlots: [{ weekday: 6, period: 'morning' }], // Sábado (2026-11-14 é sábado)
    canInteractWithClient: true,
    pendingSentQuotesCount: 0,
    notifiedCount7d: 1,
    notifiedCount30d: 10,
    quotedCount30d: 5,
    ratingAvg: 4.8,
    ratingCount: 10,
    ...overrides,
  });

  const requestInput = {
    requestId: 'req-100',
    clientId: 'client-1',
    categoryId: 'cat-eletricista',
    categoryIsActive: true,
    neighborhoodId: 'nh-centro',
    // 2026-11-14T12:00:00Z é sábado em America/Sao_Paulo (weekday = 6)
    windowStart: new Date('2026-11-14T12:00:00.000Z'),
    windowEnd: new Date('2026-11-14T18:00:00.000Z'),
    createdAt: new Date('2026-11-13T15:00:00.000Z'),
    batchSize: 2,
    batchIntervalMinutes: 15,
  };

  it('filtra rigorosamente cada um dos 8 critérios de elegibilidade', () => {
    const candidates: ProviderCandidate[] = [
      baseCandidate({ providerId: 'p-valid' }),
      baseCandidate({ providerId: 'p-not-approved', verificationStatus: 'pending_review' }),
      baseCandidate({ providerId: 'p-paused', isPaused: true }),
      baseCandidate({ providerId: 'p-wrong-cat', categoryIds: ['cat-encanador'] }),
      baseCandidate({ providerId: 'p-wrong-nh', neighborhoodIds: ['nh-vila-yara'] }),
      baseCandidate({ providerId: 'p-no-avail', availabilitySlots: [] }),
      baseCandidate({
        providerId: 'p-wrong-day',
        availabilitySlots: [{ weekday: 1, period: 'morning' }],
      }),
      baseCandidate({ providerId: 'p-blocked', canInteractWithClient: false }),
      baseCandidate({ providerId: 'client-1' }), // Mesma conta do cliente
      baseCandidate({ providerId: 'p-overloaded', pendingSentQuotesCount: 10 }),
    ];

    const matches = selectAndBatchEligibleProviders(requestInput, candidates);
    expect(matches.map((m) => m.providerId)).toEqual(['p-valid']);
  });

  it('ordena por menos notificados em 7d -> maior taxa de resposta 30d -> maior nota e divide em lotes', () => {
    const candidates: ProviderCandidate[] = [
      baseCandidate({
        providerId: 'p-many-7d',
        notifiedCount7d: 5,
        notifiedCount30d: 10,
        quotedCount30d: 9,
        ratingAvg: 5.0,
        ratingCount: 20,
      }),
      baseCandidate({
        providerId: 'p-zero-7d-low-resp',
        notifiedCount7d: 0,
        notifiedCount30d: 10,
        quotedCount30d: 4,
        ratingAvg: 5.0,
        ratingCount: 20,
      }),
      baseCandidate({
        providerId: 'p-zero-7d-high-resp',
        notifiedCount7d: 0,
        notifiedCount30d: 10,
        quotedCount30d: 8,
        ratingAvg: 4.7,
        ratingCount: 10,
      }),
    ];

    const matches = selectAndBatchEligibleProviders(requestInput, candidates);
    expect(matches.map((m) => m.providerId)).toEqual([
      'p-zero-7d-high-resp',
      'p-zero-7d-low-resp',
      'p-many-7d',
    ]);

    // Com batchSize = 2: lote 1 imediato (2 primeiros) e lote 2 agendado para +15 min
    expect(matches[0]?.batchNo).toBe(1);
    expect(matches[0]?.notifiedAt).toEqual(requestInput.createdAt);
    expect(matches[1]?.batchNo).toBe(1);
    expect(matches[2]?.batchNo).toBe(2);
    expect(matches[2]?.notifiedAt).toBeNull();
    expect(matches[2]?.scheduledNotifyAt.getTime()).toBe(
      requestInput.createdAt.getTime() + 15 * 60 * 1000,
    );
  });
});

describe('Fase 2 — Máquina de estados de Pedidos e Propostas (T-ST-QUO-01..05, T-RLS-04)', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const expiresAt = new Date('2026-11-15T12:00:00.000Z'); // +48h

  const createEmptyRequest = (): RequestRecord => ({
    id: 'req-1',
    clientId: 'client-1',
    status: 'open',
    maxQuotes: 5,
    activeQuotesCount: 0,
    expiresAt,
    privateAddressFull: 'Rua Antônio Agu, 500, Apto 42 — Centro, Osasco',
    quotes: [],
  });

  it('fecha para novas propostas ao atingir 5 propostas ativas e reabre se uma for retirada antes de 48h', () => {
    let req = createEmptyRequest();

    for (let i = 1; i <= 5; i += 1) {
      const res = submitQuoteInMemory(
        req,
        {
          id: `q-${i}`,
          requestId: req.id,
          providerId: `prov-${i}`,
          providerDisplayName: `Profissional ${i}`,
          providerRatingAvg: 4.8,
          providerRatingCount: 10,
          providerCompletedJobsCount: 15,
          totalPriceCents: 15000 + i * 1000,
          visitFeeCents: 0,
          includesDescription: 'Serviço completo com garantia de mão de obra.',
          proposedStart: new Date('2026-11-14T14:00:00.000Z'),
        },
        now,
      );
      expect(res.ok).toBe(true);
      if (res.ok) req = res.request;
    }

    expect(req.status).toBe('quotes_closed');
    expect(req.activeQuotesCount).toBe(5);

    // 6º prestador tenta enviar proposta -> QUOTE_LIMIT_REACHED
    const sixth = submitQuoteInMemory(
      req,
      {
        id: 'q-6',
        requestId: req.id,
        providerId: 'prov-6',
        providerDisplayName: 'Profissional 6',
        providerRatingAvg: 4.9,
        providerRatingCount: 12,
        providerCompletedJobsCount: 20,
        totalPriceCents: 12000,
        visitFeeCents: 0,
        includesDescription: 'Orçamento completo.',
        proposedStart: new Date('2026-11-14T14:00:00.000Z'),
      },
      now,
    );
    expect(sixth).toEqual({ ok: false, errorCode: 'QUOTE_LIMIT_REACHED' });

    // Prestador 5 retira a proposta -> pedido volta para 'open' com 4 propostas ativas
    const withdrawn = withdrawQuoteInMemory(req, 'q-5', 'prov-5', now);
    expect(withdrawn.ok).toBe(true);
    if (withdrawn.ok) req = withdrawn.request;

    expect(req.status).toBe('open');
    expect(req.activeQuotesCount).toBe(4);

    // Prestador 5 que retirou NÃO pode enviar novamente (ALREADY_QUOTED)
    const retryAfterWithdraw = submitQuoteInMemory(
      req,
      {
        id: 'q-5-retry',
        requestId: req.id,
        providerId: 'prov-5',
        providerDisplayName: 'Profissional 5',
        providerRatingAvg: 4.8,
        providerRatingCount: 10,
        providerCompletedJobsCount: 15,
        totalPriceCents: 14000,
        visitFeeCents: 0,
        includesDescription: 'Tentativa de reenvio após retirada.',
        proposedStart: new Date('2026-11-14T14:00:00.000Z'),
      },
      now,
    );
    expect(retryAfterWithdraw).toEqual({ ok: false, errorCode: 'ALREADY_QUOTED' });
  });

  it('permite revisar proposta uma única vez (revision 0 -> 1) e bloqueia segunda revisão', () => {
    let req = createEmptyRequest();
    const submitted = submitQuoteInMemory(
      req,
      {
        id: 'q-1',
        requestId: req.id,
        providerId: 'prov-1',
        providerDisplayName: 'Profissional 1',
        providerRatingAvg: 4.9,
        providerRatingCount: 10,
        providerCompletedJobsCount: 12,
        totalPriceCents: 20000,
        visitFeeCents: 0,
        includesDescription: 'Troca de fiação e disjuntor.',
        proposedStart: new Date('2026-11-14T14:00:00.000Z'),
      },
      now,
    );
    if (submitted.ok) req = submitted.request;

    const firstEdit = editQuoteInMemory(
      req,
      'q-1',
      'prov-1',
      {
        totalPriceCents: 18500,
        includesDescription: 'Troca de fiação e disjuntor com desconto.',
        proposedStart: new Date('2026-11-14T15:00:00.000Z'),
      },
      now,
    );
    expect(firstEdit.ok).toBe(true);
    if (firstEdit.ok) req = firstEdit.request;
    expect(req.quotes[0]?.revision).toBe(1);
    expect(req.quotes[0]?.totalPriceCents).toBe(18500);

    const secondEdit = editQuoteInMemory(
      req,
      'q-1',
      'prov-1',
      {
        totalPriceCents: 17000,
        includesDescription: 'Segunda tentativa de edição.',
        proposedStart: new Date('2026-11-14T15:00:00.000Z'),
      },
      now,
    );
    expect(secondEdit).toEqual({ ok: false, errorCode: 'QUOTE_ALREADY_EDITED' });
  });

  it('aceite de proposta marca irmãs como rejected (sibling_accepted) e libera endereço apenas ao prestador contratado', () => {
    let req = createEmptyRequest();
    for (const i of [1, 2]) {
      const res = submitQuoteInMemory(
        req,
        {
          id: `q-${i}`,
          requestId: req.id,
          providerId: `prov-${i}`,
          providerDisplayName: `Profissional ${i}`,
          providerRatingAvg: 4.5 + i * 0.2,
          providerRatingCount: 8,
          providerCompletedJobsCount: 10,
          totalPriceCents: 15000 + i * 2000,
          visitFeeCents: 0,
          includesDescription: 'Execução completa do serviço elétrico.',
          proposedStart: new Date('2026-11-14T14:00:00.000Z'),
        },
        now,
      );
      if (res.ok) req = res.request;
    }

    // Antes do aceite, nenhum prestador lê o endereço privado
    expect(canProviderReadPrivateAddress(req, 'prov-1')).toBe(false);
    expect(canProviderReadPrivateAddress(req, 'prov-2')).toBe(false);
    expect(canProviderReadPrivateAddress(req, 'client-1')).toBe(true);

    // Cliente aceita q-1
    const accepted = acceptQuoteInMemory(req, 'q-1', 'client-1', now);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) req = accepted.request;

    expect(req.status).toBe('hired');
    expect(req.quotes.find((q) => q.id === 'q-1')?.status).toBe('accepted');
    expect(req.quotes.find((q) => q.id === 'q-2')?.status).toBe('rejected');
    expect(req.quotes.find((q) => q.id === 'q-2')?.statusReason).toBe('sibling_accepted');

    // Agora somente prov-1 e client-1 leem o endereço completo
    expect(canProviderReadPrivateAddress(req, 'prov-1')).toBe(true);
    expect(canProviderReadPrivateAddress(req, 'prov-2')).toBe(false);
  });

  it('ordena propostas para comparação por menor preço, maior nota ou menor tempo de resposta', () => {
    const quotes = [
      {
        id: 'q-expensive-high-rating',
        requestId: 'req-1',
        providerId: 'p-1',
        providerDisplayName: 'Ana',
        providerRatingAvg: 5.0,
        providerRatingCount: 20,
        providerCompletedJobsCount: 30,
        providerAvgResponseMinutes: 25,
        totalPriceCents: 25000,
        visitFeeCents: 0,
        includesDescription: 'Serviço premium',
        proposedStart: now,
        validUntil: expiresAt,
        revision: 0 as const,
        status: 'sent' as const,
      },
      {
        id: 'q-cheap-fast',
        requestId: 'req-1',
        providerId: 'p-2',
        providerDisplayName: 'Bruno',
        providerRatingAvg: 4.6,
        providerRatingCount: 10,
        providerCompletedJobsCount: 12,
        providerAvgResponseMinutes: 8,
        totalPriceCents: 14000,
        visitFeeCents: 0,
        includesDescription: 'Serviço rápido',
        proposedStart: now,
        validUntil: expiresAt,
        revision: 0 as const,
        status: 'sent' as const,
      },
    ];

    expect(sortQuotesForComparison(quotes, 'price_asc').map((q) => q.id)).toEqual([
      'q-cheap-fast',
      'q-expensive-high-rating',
    ]);
    expect(sortQuotesForComparison(quotes, 'rating_desc').map((q) => q.id)).toEqual([
      'q-expensive-high-rating',
      'q-cheap-fast',
    ]);
    expect(sortQuotesForComparison(quotes, 'response_time_asc').map((q) => q.id)).toEqual([
      'q-cheap-fast',
      'q-expensive-high-rating',
    ]);
  });
});
