import {
  calculateProviderPublicRating,
  cancelJobInMemory,
  completeJobInMemory,
  confirmOverdueNoShowInMemory,
  JobRecord,
  openDisputeInMemory,
  reportNoShowInMemory,
  respondNoShowInMemory,
  revealOverdueReviewsInMemory,
  submitReviewInMemory,
  withdrawNoShowClaimInMemory,
} from './jobs-core';

describe('Fase 4 — Ciclo de Vida do Serviço Agendado: Conclusão, Cancelamento, No-Show e Disputa (T-ST-JOB-01..07)', () => {
  const scheduledFor = new Date('2026-11-14T14:00:00.000Z');

  const createScheduledJob = (): JobRecord => ({
    id: 'job-1',
    requestId: 'req-1',
    quoteId: 'quote-1',
    clientId: 'client-1',
    providerId: 'prov-1',
    scheduledFor,
    agreedPriceCents: 19000,
    status: 'scheduled',
    isLateCancellation: false,
    reviews: [],
  });

  it('bloqueia conclusão antes do horário agendado, exige nota em conclusão parcial e conclui com idempotência', () => {
    const job = createScheduledJob();
    const beforeTime = new Date('2026-11-14T13:00:00.000Z');
    const afterTime = new Date('2026-11-14T15:00:00.000Z');

    // Antes do horário -> JOB_TOO_EARLY
    expect(
      completeJobInMemory(job, {
        actorId: 'prov-1',
        completionType: 'full',
        now: beforeTime,
      }),
    ).toEqual({ ok: false, errorCode: 'JOB_TOO_EARLY' });

    // Conclusão parcial sem nota -> VALIDATION_ERROR
    expect(
      completeJobInMemory(job, {
        actorId: 'prov-1',
        completionType: 'partial',
        completionNote: '',
        now: afterTime,
      }),
    ).toEqual({ ok: false, errorCode: 'VALIDATION_ERROR' });

    // Conclusão parcial com nota explicativa -> completed
    const completed = completeJobInMemory(job, {
      actorId: 'prov-1',
      completionType: 'partial',
      completionNote: 'Faltou substituir o espelho da tomada porque a peça estava indisponível.',
      now: afterTime,
    });
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.job.status).toBe('completed');
      expect(completed.job.completionType).toBe('partial');
      expect(completed.job.disputeDeadline).toBeTruthy();
      expect(completed.job.reviewsRevealAt).toBeTruthy();
    }
  });

  it('permite cancelar antes do horário sinalizando cancelamento tardio (< 24h) e bloqueia cancelamento após o horário', () => {
    const job = createScheduledJob();

    // 10 horas antes do horário -> isLateCancellation = true
    const tenHoursBefore = new Date(scheduledFor.getTime() - 10 * 60 * 60 * 1000);
    const lateCancel = cancelJobInMemory(job, {
      actorId: 'provider' === 'provider' ? 'prov-1' : 'client-1',
      cancelReason: 'provider_unavailable',
      now: tenHoursBefore,
    });
    expect(lateCancel.ok).toBe(true);
    if (lateCancel.ok) {
      expect(lateCancel.job.status).toBe('cancelled');
      expect(lateCancel.job.isLateCancellation).toBe(true);
    }

    // No horário agendado ou depois -> JOB_TOO_LATE
    expect(
      cancelJobInMemory(job, {
        actorId: 'client-1',
        cancelReason: 'no_longer_needed',
        now: scheduledFor,
      }),
    ).toEqual({ ok: false, errorCode: 'JOB_TOO_LATE' });
  });

  it('executa fluxo de não comparecimento (+30 min): retirada pelo acusador, contestação (-> disputed) ou confirmação em 48h', () => {
    const job = createScheduledJob();
    const plus15Min = new Date(scheduledFor.getTime() + 15 * 60 * 1000);
    const plus40Min = new Date(scheduledFor.getTime() + 40 * 60 * 1000);

    // +15 min -> cedo demais (< 30 min)
    expect(reportNoShowInMemory(job, { actorId: 'client-1', now: plus15Min })).toEqual({
      ok: false,
      errorCode: 'JOB_TOO_EARLY',
    });

    // +40 min -> registra no_show_claimed
    const claimed = reportNoShowInMemory(job, { actorId: 'client-1', now: plus40Min });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    // Retirada pelo próprio acusador -> volta a scheduled
    const withdrawn = withdrawNoShowClaimInMemory(claimed.job, 'client-1');
    expect(withdrawn.ok).toBe(true);
    if (withdrawn.ok) {
      expect(withdrawn.job.status).toBe('scheduled');
    }

    // Contestação pela parte acusada (prestador) -> vira disputed
    const contested = respondNoShowInMemory(claimed.job, {
      actorId: 'prov-1',
      contestNote: 'Estive na portaria no horário combinado e aguardei 25 minutos.',
      now: plus40Min,
    });
    expect(contested.ok).toBe(true);
    if (contested.ok) {
      expect(contested.job.status).toBe('disputed');
    }

    // Sem contestação após 48h -> confirma no_show e abre janela de avaliação
    const plus50Hours = new Date(plus40Min.getTime() + 50 * 60 * 60 * 1000);
    const confirmed = confirmOverdueNoShowInMemory(claimed.job, plus50Hours);
    expect(confirmed.status).toBe('no_show');
    expect(confirmed.reviewsOpenUntil).toBeTruthy();
  });

  it('suspende avaliações quando uma disputa é aberta dentro da janela de 7 dias', () => {
    const afterTime = new Date(scheduledFor.getTime() + 60 * 60 * 1000);
    const completedRes = completeJobInMemory(createScheduledJob(), {
      actorId: 'prov-1',
      completionType: 'full',
      now: afterTime,
    });
    if (!completedRes.ok) return;

    const disputedRes = openDisputeInMemory(completedRes.job, {
      actorId: 'client-1',
      reason: 'price_divergence',
      now: new Date(afterTime.getTime() + 2 * 60 * 60 * 1000),
    });
    expect(disputedRes.ok).toBe(true);
    if (!disputedRes.ok) return;

    // Tentar avaliar enquanto disputed -> INVALID_STATE
    const reviewOnDisputed = submitReviewInMemory(disputedRes.job, {
      id: 'rev-1',
      reviewerId: 'client-1',
      rating: 2,
      now: afterTime,
    });
    expect(reviewOnDisputed).toEqual({ ok: false, errorCode: 'INVALID_STATE' });
  });
});

describe('Fase 4 — Avaliações Bilaterais com Revelação Simultânea (T-ST-REV-01, T-ST-REV-02)', () => {
  const scheduledFor = new Date('2026-11-14T14:00:00.000Z');
  const completedAt = new Date('2026-11-14T16:00:00.000Z');

  it('mantém a 1ª avaliação em pending_reveal (sem alterar nota pública) e publica ambas simultaneamente quando a 2ª parte avalia ou após 7 dias', () => {
    const completedRes = completeJobInMemory(
      {
        id: 'job-rev-1',
        requestId: 'req-1',
        quoteId: 'quote-1',
        clientId: 'client-1',
        providerId: 'prov-1',
        scheduledFor,
        agreedPriceCents: 20000,
        status: 'scheduled',
        isLateCancellation: false,
        reviews: [],
      },
      {
        actorId: 'prov-1',
        completionType: 'full',
        now: completedAt,
      },
    );
    expect(completedRes.ok).toBe(true);
    if (!completedRes.ok) return;

    // 1. Cliente envia avaliação primeiro -> fica pending_reveal e nota pública permanece 0
    const r1 = submitReviewInMemory(completedRes.job, {
      id: 'rev-client',
      reviewerId: 'client-1',
      rating: 5,
      comment: 'Serviço impecável e pontual.',
      now: completedAt,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    expect(r1.revealedSimultaneously).toBe(false);
    expect(r1.job.reviews[0]?.status).toBe('pending_reveal');
    expect(calculateProviderPublicRating(r1.job.reviews, 'prov-1')).toEqual({
      ratingAvg: 0,
      ratingCount: 0,
    });

    // 2. Prestador envia sua avaliação -> ambas passam a 'published' simultaneamente!
    const r2 = submitReviewInMemory(r1.job, {
      id: 'rev-provider',
      reviewerId: 'prov-1',
      rating: 5,
      comment: 'Cliente muito educada e local organizado.',
      now: new Date(completedAt.getTime() + 10 * 60 * 1000),
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(r2.revealedSimultaneously).toBe(true);
    expect(r2.job.reviews.every((r) => r.status === 'published')).toBe(true);
    expect(calculateProviderPublicRating(r2.job.reviews, 'prov-1')).toEqual({
      ratingAvg: 5,
      ratingCount: 1,
    });

    // 3. Caso alternativo: apenas o cliente avaliou e se passaram 7 dias -> revealOverdueReviewsInMemory publica
    const after7Days = new Date(completedAt.getTime() + 8 * 24 * 60 * 60 * 1000);
    const revealedByCron = revealOverdueReviewsInMemory(r1.job, after7Days);
    expect(revealedByCron.reviews[0]?.status).toBe('published');
  });
});
