export type AvailabilityPeriod = 'morning' | 'afternoon' | 'evening';

/**
 * Núcleo de regras de negócio da Fase 2:
 * - Gate de abertura de categorias em Osasco (>= 2 aprovados e disponíveis)
 * - Elegibilidade nos 8 critérios (ARCHITECTURE.md seção 6.1)
 * - Ordenação equilibrada e divisão em lotes (ARCHITECTURE.md seções 6.2 e 6.3)
 * - Máquina de estados de pedidos e propostas (DATABASE.md seções 5.1 e 5.2)
 * - Comparador de propostas para o cliente (E3-04)
 */

export const DEFAULT_MAX_QUOTES = 5;
export const DEFAULT_REQUEST_EXPIRY_HOURS = 48;
export const DEFAULT_BATCH_SIZE = 8;
export const DEFAULT_BATCH_INTERVAL_MINUTES = 15;
export const DEFAULT_MAX_PENDING_QUOTES_PER_PROVIDER = 10;
export const DEFAULT_CATEGORY_GATE_MIN_APPROVED = 2;

export type RequestStatus =
  'open' | 'quotes_closed' | 'hired' | 'completed' | 'cancelled' | 'expired';

export type RequestStatusReason =
  | 'no_eligible_providers'
  | 'no_acceptance_in_time'
  | 'client_cancelled'
  | 'job_cancelled'
  | 'job_no_show'
  | 'no_outcome'
  | 'moderation_removed'
  | 'account_deleted';

export type QuoteStatus = 'sent' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

export type QuoteStatusReason =
  | 'sibling_accepted'
  | 'request_cancelled'
  | 'request_expired'
  | 'validity_expired'
  | 'provider_withdrew'
  | 'provider_suspended'
  | 'moderation_removed'
  | 'account_deleted';

export interface CategoryGateInput {
  categoryId: string;
  approvedProvidersCount: number;
  availableProvidersCount: number;
  overduePendingVerificationsCount: number;
  termsAndModerationReady?: boolean;
  minRequiredApproved?: number;
}

export interface CategoryGateResult {
  categoryId: string;
  minRequiredApproved: number;
  g1ApprovedMet: boolean;
  g2AvailableMet: boolean;
  g3SlaMet: boolean;
  g4ComplianceMet: boolean;
  canOpenToCustomers: boolean;
}

export function evaluateCategoryGate(input: CategoryGateInput): CategoryGateResult {
  const minRequired = input.minRequiredApproved ?? DEFAULT_CATEGORY_GATE_MIN_APPROVED;
  const g1ApprovedMet = input.approvedProvidersCount >= minRequired;
  const g2AvailableMet = input.availableProvidersCount >= minRequired;
  const g3SlaMet = input.overduePendingVerificationsCount === 0;
  const g4ComplianceMet = input.termsAndModerationReady ?? true;

  return {
    categoryId: input.categoryId,
    minRequiredApproved: minRequired,
    g1ApprovedMet,
    g2AvailableMet,
    g3SlaMet,
    g4ComplianceMet,
    canOpenToCustomers: g1ApprovedMet && g2AvailableMet && g3SlaMet && g4ComplianceMet,
  };
}

export interface ProviderCandidate {
  providerId: string;
  profileStatus: 'active' | 'suspended' | 'deleted';
  verificationStatus: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended';
  isPaused: boolean;
  categoryIds: string[];
  neighborhoodIds: string[];
  availabilitySlots: { weekday: number; period: AvailabilityPeriod }[];
  canInteractWithClient: boolean;
  pendingSentQuotesCount: number;
  notifiedCount7d: number;
  notifiedCount30d: number;
  quotedCount30d: number;
  ratingAvg: number;
  ratingCount: number;
}

export interface ServiceRequestMatchInput {
  requestId: string;
  clientId: string;
  categoryId: string;
  categoryIsActive: boolean;
  neighborhoodId: string;
  windowStart: Date;
  windowEnd: Date;
  createdAt?: Date;
  batchSize?: number;
  batchIntervalMinutes?: number;
  maxPendingQuotesPerProvider?: number;
}

export interface PlannedRequestMatch {
  requestId: string;
  providerId: string;
  batchNo: number;
  rank: number;
  scheduledNotifyAt: Date;
  notifiedAt: Date | null;
  eligibilitySnapshot: {
    notifiedCount7d: number;
    responseRate30d: number;
    effectiveRating: number;
  };
}

/**
 * Extrai os dias da semana (0 = domingo .. 6 = sábado) cobertos pela janela [windowStart, windowEnd]
 * no fuso horário de negócio America/Sao_Paulo.
 */
export function getWindowWeekdaysInSaoPaulo(windowStart: Date, windowEnd: Date): Set<number> {
  const weekdays = new Set<number>();
  if (windowEnd.getTime() < windowStart.getTime()) {
    return weekdays;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
  });

  const mapShortDay: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const stepMs = 6 * 60 * 60 * 1000; // Amostragem a cada 6h + limites exatos
  for (let ts = windowStart.getTime(); ts <= windowEnd.getTime(); ts += stepMs) {
    const label = formatter.format(new Date(ts));
    const dow = mapShortDay[label];
    if (dow !== undefined) {
      weekdays.add(dow);
    }
  }
  const endLabel = formatter.format(windowEnd);
  const endDow = mapShortDay[endLabel];
  if (endDow !== undefined) {
    weekdays.add(endDow);
  }

  return weekdays;
}

/**
 * Seleciona prestadores elegíveis segundo os 8 critérios obrigatórios (ARCHITECTURE.md 6.1),
 * ordena de forma equilibrada (6.2) e divide em lotes (6.3).
 */
export function selectAndBatchEligibleProviders(
  request: ServiceRequestMatchInput,
  candidates: ProviderCandidate[],
): PlannedRequestMatch[] {
  if (!request.categoryIsActive) {
    return [];
  }

  const maxPending = request.maxPendingQuotesPerProvider ?? DEFAULT_MAX_PENDING_QUOTES_PER_PROVIDER;
  const batchSize = request.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchIntervalMinutes = request.batchIntervalMinutes ?? DEFAULT_BATCH_INTERVAL_MINUTES;
  const createdAt = request.createdAt ?? new Date();
  const windowWeekdays = getWindowWeekdaysInSaoPaulo(request.windowStart, request.windowEnd);

  const eligible = candidates.filter((c) => {
    // 1. Aprovado e ativo
    if (c.verificationStatus !== 'approved' || c.profileStatus !== 'active') return false;
    // 2. Não pausado
    if (c.isPaused) return false;
    // 3. Atende a categoria
    if (!c.categoryIds.includes(request.categoryId)) return false;
    // 4. Atende o bairro
    if (!c.neighborhoodIds.includes(request.neighborhoodId)) return false;
    // 5. Possui >= 1 regra de disponibilidade compatível com a janela
    if (c.availabilitySlots.length === 0) return false;
    const hasCompatibleDay = c.availabilitySlots.some((slot) => windowWeekdays.has(slot.weekday));
    if (!hasCompatibleDay) return false;
    // 6. can_interact verdadeiro
    if (!c.canInteractWithClient) return false;
    // 7. Prestador != cliente (mesma conta nunca recebe o próprio pedido)
    if (c.providerId === request.clientId) return false;
    // 8. Sem excesso de propostas pendentes
    if (c.pendingSentQuotesCount >= maxPending) return false;

    return true;
  });

  const withMetrics = eligible.map((c) => {
    const responseRate30d = c.notifiedCount30d > 0 ? c.quotedCount30d / c.notifiedCount30d : 0.5;
    const effectiveRating = c.ratingCount >= 3 ? c.ratingAvg : 4.5;
    return {
      candidate: c,
      responseRate30d,
      effectiveRating,
    };
  });

  withMetrics.sort((a, b) => {
    // 1. Menos pedidos recebidos em 7d
    if (a.candidate.notifiedCount7d !== b.candidate.notifiedCount7d) {
      return a.candidate.notifiedCount7d - b.candidate.notifiedCount7d;
    }
    // 2. Maior taxa de resposta em 30d
    if (Math.abs(b.responseRate30d - a.responseRate30d) > 1e-6) {
      return b.responseRate30d - a.responseRate30d;
    }
    // 3. Maior nota efetiva
    if (Math.abs(b.effectiveRating - a.effectiveRating) > 1e-6) {
      return b.effectiveRating - a.effectiveRating;
    }
    // 4. Desempate determinístico
    return a.candidate.providerId.localeCompare(b.candidate.providerId);
  });

  return withMetrics.map((item, idx) => {
    const rank = idx + 1;
    const batchNo = Math.floor(idx / batchSize) + 1;
    const delayMs = (batchNo - 1) * batchIntervalMinutes * 60 * 1000;
    const scheduledNotifyAt = new Date(createdAt.getTime() + delayMs);

    return {
      requestId: request.requestId,
      providerId: item.candidate.providerId,
      batchNo,
      rank,
      scheduledNotifyAt,
      notifiedAt: batchNo === 1 ? createdAt : null,
      eligibilitySnapshot: {
        notifiedCount7d: item.candidate.notifiedCount7d,
        responseRate30d: Number(item.responseRate30d.toFixed(4)),
        effectiveRating: Number(item.effectiveRating.toFixed(2)),
      },
    };
  });
}

export interface QuoteRecord {
  id: string;
  requestId: string;
  providerId: string;
  providerDisplayName: string;
  providerRatingAvg: number;
  providerRatingCount: number;
  providerCompletedJobsCount: number;
  providerAvgResponseMinutes?: number | null;
  totalPriceCents: number;
  visitFeeCents: number;
  includesDescription: string;
  proposedStart: Date;
  estimatedDurationMinutes?: number | null;
  validUntil: Date;
  revision: 0 | 1;
  status: QuoteStatus;
  statusReason?: QuoteStatusReason;
}

export interface RequestRecord {
  id: string;
  clientId: string;
  status: RequestStatus;
  statusReason?: RequestStatusReason;
  maxQuotes: number;
  activeQuotesCount: number;
  expiresAt: Date;
  hiredQuoteId?: string | null;
  privateAddressFull: string;
  quotes: QuoteRecord[];
}

export function canProviderReadPrivateAddress(request: RequestRecord, userId: string): boolean {
  if (request.clientId === userId) {
    return true;
  }
  if (
    (request.status === 'hired' || request.status === 'completed') &&
    request.hiredQuoteId !== null &&
    request.hiredQuoteId !== undefined
  ) {
    const acceptedQuote = request.quotes.find(
      (q) => q.id === request.hiredQuoteId && q.status === 'accepted',
    );
    return acceptedQuote?.providerId === userId;
  }
  return false;
}

export function submitQuoteInMemory(
  request: RequestRecord,
  newQuote: Omit<QuoteRecord, 'revision' | 'status' | 'statusReason' | 'validUntil'> & {
    validUntil?: Date;
  },
  now: Date = new Date(),
): { ok: true; request: RequestRecord } | { ok: false; errorCode: string } {
  if (request.expiresAt.getTime() <= now.getTime() || request.status === 'expired') {
    return { ok: false, errorCode: 'REQUEST_EXPIRED' };
  }
  if (request.quotes.some((q) => q.providerId === newQuote.providerId)) {
    return { ok: false, errorCode: 'ALREADY_QUOTED' };
  }
  if (request.status === 'quotes_closed' || request.activeQuotesCount >= request.maxQuotes) {
    return { ok: false, errorCode: 'QUOTE_LIMIT_REACHED' };
  }
  if (request.status !== 'open') {
    return { ok: false, errorCode: 'REQUEST_CLOSED' };
  }

  const effectiveValidUntil =
    newQuote.validUntil && newQuote.validUntil.getTime() < request.expiresAt.getTime()
      ? newQuote.validUntil
      : request.expiresAt;

  const createdQuote: QuoteRecord = {
    ...newQuote,
    validUntil: effectiveValidUntil,
    revision: 0,
    status: 'sent',
  };

  const quotes = [...request.quotes, createdQuote];
  const activeQuotesCount = quotes.filter(
    (q) => q.status === 'sent' || q.status === 'accepted',
  ).length;
  const status: RequestStatus =
    activeQuotesCount >= request.maxQuotes ? 'quotes_closed' : request.status;

  return {
    ok: true,
    request: {
      ...request,
      status,
      activeQuotesCount,
      quotes,
    },
  };
}

export function editQuoteInMemory(
  request: RequestRecord,
  quoteId: string,
  providerId: string,
  updates: {
    totalPriceCents: number;
    visitFeeCents?: number;
    includesDescription: string;
    proposedStart: Date;
  },
  now: Date = new Date(),
): { ok: true; request: RequestRecord } | { ok: false; errorCode: string } {
  const target = request.quotes.find((q) => q.id === quoteId);
  if (!target) {
    return { ok: false, errorCode: 'NOT_FOUND' };
  }
  if (target.providerId !== providerId) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }
  if (target.status !== 'sent') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }
  if (target.revision >= 1) {
    return { ok: false, errorCode: 'QUOTE_ALREADY_EDITED' };
  }
  if (
    (request.status !== 'open' && request.status !== 'quotes_closed') ||
    request.expiresAt.getTime() <= now.getTime()
  ) {
    return { ok: false, errorCode: 'REQUEST_CLOSED' };
  }

  const quotes = request.quotes.map((q) =>
    q.id === quoteId
      ? {
          ...q,
          totalPriceCents: updates.totalPriceCents,
          visitFeeCents: updates.visitFeeCents ?? q.visitFeeCents,
          includesDescription: updates.includesDescription,
          proposedStart: updates.proposedStart,
          revision: 1 as const,
        }
      : q,
  );

  return {
    ok: true,
    request: {
      ...request,
      quotes,
    },
  };
}

export function withdrawQuoteInMemory(
  request: RequestRecord,
  quoteId: string,
  providerId: string,
  now: Date = new Date(),
): { ok: true; request: RequestRecord } | { ok: false; errorCode: string } {
  const target = request.quotes.find((q) => q.id === quoteId);
  if (!target) {
    return { ok: false, errorCode: 'NOT_FOUND' };
  }
  if (target.providerId !== providerId) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }
  if (target.status !== 'sent') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }

  const quotes = request.quotes.map((q) =>
    q.id === quoteId
      ? { ...q, status: 'withdrawn' as const, statusReason: 'provider_withdrew' as const }
      : q,
  );

  const activeQuotesCount = quotes.filter(
    (q) => q.status === 'sent' || q.status === 'accepted',
  ).length;

  const status: RequestStatus =
    request.status === 'quotes_closed' &&
    activeQuotesCount < request.maxQuotes &&
    request.expiresAt.getTime() > now.getTime()
      ? 'open'
      : request.status;

  return {
    ok: true,
    request: {
      ...request,
      status,
      activeQuotesCount,
      quotes,
    },
  };
}

export function acceptQuoteInMemory(
  request: RequestRecord,
  quoteId: string,
  clientId: string,
  now: Date = new Date(),
): { ok: true; request: RequestRecord } | { ok: false; errorCode: string } {
  if (request.clientId !== clientId) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }
  if (request.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, errorCode: 'REQUEST_EXPIRED' };
  }
  if (request.status !== 'open' && request.status !== 'quotes_closed') {
    return { ok: false, errorCode: 'REQUEST_CLOSED' };
  }

  const target = request.quotes.find((q) => q.id === quoteId);
  if (!target || target.status !== 'sent') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }

  const effectiveValidUntil = Math.min(target.validUntil.getTime(), request.expiresAt.getTime());
  if (effectiveValidUntil <= now.getTime()) {
    return { ok: false, errorCode: 'QUOTE_EXPIRED' };
  }

  const quotes = request.quotes.map((q) => {
    if (q.id === quoteId) {
      return { ...q, status: 'accepted' as const };
    }
    if (q.status === 'sent') {
      return {
        ...q,
        status: 'rejected' as const,
        statusReason: 'sibling_accepted' as const,
      };
    }
    return q;
  });

  return {
    ok: true,
    request: {
      ...request,
      status: 'hired',
      hiredQuoteId: quoteId,
      activeQuotesCount: 1,
      quotes,
    },
  };
}

export type QuoteSortMode = 'price_asc' | 'rating_desc' | 'response_time_asc';

export function sortQuotesForComparison(quotes: QuoteRecord[], mode: QuoteSortMode): QuoteRecord[] {
  return [...quotes].sort((a, b) => {
    if (mode === 'price_asc') {
      if (a.totalPriceCents !== b.totalPriceCents) {
        return a.totalPriceCents - b.totalPriceCents;
      }
      return b.providerRatingAvg - a.providerRatingAvg;
    }
    if (mode === 'rating_desc') {
      if (b.providerRatingAvg !== a.providerRatingAvg) {
        return b.providerRatingAvg - a.providerRatingAvg;
      }
      return a.totalPriceCents - b.totalPriceCents;
    }
    const respA = a.providerAvgResponseMinutes ?? 9999;
    const respB = b.providerAvgResponseMinutes ?? 9999;
    if (respA !== respB) {
      return respA - respB;
    }
    return a.totalPriceCents - b.totalPriceCents;
  });
}
