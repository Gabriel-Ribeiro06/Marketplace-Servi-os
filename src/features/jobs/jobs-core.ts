/**
 * Núcleo de regras de negócio da Fase 4 — Serviços Agendados (jobs), Exceções e Avaliações Bilaterais (Épico E6)
 * Fonte: docs/DATABASE.md (seções 3.3, 3.5, 5.3, 5.4, 5.5), docs/PRD.md (seção 11.2)
 */

export type JobStatus =
  'scheduled' | 'no_show_claimed' | 'completed' | 'cancelled' | 'no_show' | 'disputed';

export type CompletionType = 'full' | 'partial';

export type CancelReason =
  | 'schedule_conflict'
  | 'no_longer_needed'
  | 'price_disagreement'
  | 'found_other_provider'
  | 'provider_unavailable'
  | 'safety_concern'
  | 'other';

export type DisputeReason =
  | 'incomplete_service'
  | 'price_divergence'
  | 'damage_or_theft'
  | 'no_show'
  | 'harassment'
  | 'threat_or_violence'
  | 'other';

export type ReviewStatus = 'pending_reveal' | 'published' | 'removed';

export interface ReviewRecord {
  id: string;
  jobId: string;
  reviewerId: string;
  revieweeId: string;
  reviewerRole: 'client' | 'provider';
  rating: number;
  comment?: string;
  status: ReviewStatus;
  revealedAt: Date | null;
  createdAt: Date;
}

export interface JobRecord {
  id: string;
  requestId: string;
  quoteId: string;
  clientId: string;
  providerId: string;
  scheduledFor: Date;
  agreedPriceCents: number;
  status: JobStatus;
  completionType?: CompletionType | null;
  completionNote?: string | null;
  completedAt?: Date | null;
  cancelledBy?: 'client' | 'provider' | 'system' | 'admin' | null;
  cancelReason?: CancelReason | null;
  cancelNote?: string | null;
  cancelledAt?: Date | null;
  isLateCancellation: boolean;
  noShowClaimedBy?: 'client' | 'provider' | null;
  noShowClaimedAt?: Date | null;
  noShowContestDeadline?: Date | null;
  disputedAt?: Date | null;
  disputeReason?: DisputeReason | null;
  disputeDeadline?: Date | null;
  reviewsRevealAt?: Date | null;
  reviewsOpenUntil?: Date | null;
  reviews: ReviewRecord[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function completeJobInMemory(
  job: JobRecord,
  input: {
    actorId: string;
    completionType: CompletionType;
    completionNote?: string;
    now?: Date;
  },
): { ok: true; job: JobRecord } | { ok: false; errorCode: string } {
  const now = input.now ?? new Date();

  if (input.actorId !== job.providerId) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }

  // Idempotência (DATABASE.md seção 5.4 item 8)
  if (job.status === 'completed') {
    return { ok: true, job };
  }

  if (job.status !== 'scheduled') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }

  if (now.getTime() < job.scheduledFor.getTime()) {
    return { ok: false, errorCode: 'JOB_TOO_EARLY' };
  }

  if (now.getTime() > job.scheduledFor.getTime() + 7 * DAY_MS) {
    return { ok: false, errorCode: 'JOB_TOO_LATE' };
  }

  const trimmedNote = input.completionNote?.trim() ?? '';
  if (input.completionType === 'partial' && trimmedNote.length < 5) {
    return { ok: false, errorCode: 'VALIDATION_ERROR' };
  }

  return {
    ok: true,
    job: {
      ...job,
      status: 'completed',
      completionType: input.completionType,
      completionNote: trimmedNote.length > 0 ? trimmedNote : null,
      completedAt: now,
      disputeDeadline: new Date(now.getTime() + 7 * DAY_MS),
      reviewsRevealAt: new Date(now.getTime() + 7 * DAY_MS),
      reviewsOpenUntil: new Date(now.getTime() + 30 * DAY_MS),
    },
  };
}

export function cancelJobInMemory(
  job: JobRecord,
  input: {
    actorId: string;
    cancelReason: CancelReason;
    cancelNote?: string;
    now?: Date;
  },
): { ok: true; job: JobRecord } | { ok: false; errorCode: string } {
  const now = input.now ?? new Date();

  const role =
    input.actorId === job.clientId
      ? 'client'
      : input.actorId === job.providerId
        ? 'provider'
        : null;

  if (!role) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }

  if (job.status === 'cancelled') {
    return { ok: true, job };
  }

  if (job.status !== 'scheduled') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }

  if (now.getTime() >= job.scheduledFor.getTime()) {
    return { ok: false, errorCode: 'JOB_TOO_LATE' };
  }

  const isLateCancellation = job.scheduledFor.getTime() - now.getTime() < 24 * HOUR_MS;

  return {
    ok: true,
    job: {
      ...job,
      status: 'cancelled',
      cancelledBy: role,
      cancelReason: input.cancelReason,
      cancelNote: input.cancelNote?.trim() || null,
      cancelledAt: now,
      isLateCancellation,
    },
  };
}

export function reportNoShowInMemory(
  job: JobRecord,
  input: {
    actorId: string;
    now?: Date;
  },
): { ok: true; job: JobRecord } | { ok: false; errorCode: string } {
  const now = input.now ?? new Date();
  const role =
    input.actorId === job.clientId
      ? 'client'
      : input.actorId === job.providerId
        ? 'provider'
        : null;

  if (!role) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }

  if (job.status !== 'scheduled') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }

  if (now.getTime() < job.scheduledFor.getTime() + 30 * 60 * 1000) {
    return { ok: false, errorCode: 'JOB_TOO_EARLY' };
  }

  if (now.getTime() > job.scheduledFor.getTime() + 72 * HOUR_MS) {
    return { ok: false, errorCode: 'JOB_TOO_LATE' };
  }

  return {
    ok: true,
    job: {
      ...job,
      status: 'no_show_claimed',
      noShowClaimedBy: role,
      noShowClaimedAt: now,
      noShowContestDeadline: new Date(now.getTime() + 48 * HOUR_MS),
    },
  };
}

export function withdrawNoShowClaimInMemory(
  job: JobRecord,
  actorId: string,
): { ok: true; job: JobRecord } | { ok: false; errorCode: string } {
  const role = actorId === job.clientId ? 'client' : actorId === job.providerId ? 'provider' : null;

  if (!role || job.status !== 'no_show_claimed' || job.noShowClaimedBy !== role) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }

  return {
    ok: true,
    job: {
      ...job,
      status: 'scheduled',
      noShowClaimedBy: null,
      noShowClaimedAt: null,
      noShowContestDeadline: null,
    },
  };
}

export function respondNoShowInMemory(
  job: JobRecord,
  input: {
    actorId: string;
    contestNote: string;
    now?: Date;
  },
): { ok: true; job: JobRecord } | { ok: false; errorCode: string } {
  const now = input.now ?? new Date();
  const role =
    input.actorId === job.clientId
      ? 'client'
      : input.actorId === job.providerId
        ? 'provider'
        : null;

  if (!role || job.status !== 'no_show_claimed' || job.noShowClaimedBy === role) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }

  if (input.contestNote.trim().length < 5) {
    return { ok: false, errorCode: 'VALIDATION_ERROR' };
  }

  if (job.noShowContestDeadline && now.getTime() > job.noShowContestDeadline.getTime()) {
    return { ok: false, errorCode: 'JOB_TOO_LATE' };
  }

  return {
    ok: true,
    job: {
      ...job,
      status: 'disputed',
      disputedAt: now,
      disputeReason: 'no_show',
    },
  };
}

export function confirmOverdueNoShowInMemory(job: JobRecord, now: Date = new Date()): JobRecord {
  if (
    job.status === 'no_show_claimed' &&
    job.noShowContestDeadline &&
    now.getTime() >= job.noShowContestDeadline.getTime()
  ) {
    return {
      ...job,
      status: 'no_show',
      reviewsRevealAt: new Date(now.getTime() + 7 * DAY_MS),
      reviewsOpenUntil: new Date(now.getTime() + 30 * DAY_MS),
    };
  }
  return job;
}

export function openDisputeInMemory(
  job: JobRecord,
  input: {
    actorId: string;
    reason: DisputeReason;
    now?: Date;
  },
): { ok: true; job: JobRecord } | { ok: false; errorCode: string } {
  const now = input.now ?? new Date();

  if (input.actorId !== job.clientId && input.actorId !== job.providerId) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }

  if (job.status !== 'scheduled' && job.status !== 'completed') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }

  if (now.getTime() < job.scheduledFor.getTime()) {
    return { ok: false, errorCode: 'JOB_TOO_EARLY' };
  }

  if (
    job.status === 'completed' &&
    job.disputeDeadline &&
    now.getTime() > job.disputeDeadline.getTime()
  ) {
    return { ok: false, errorCode: 'JOB_TOO_LATE' };
  }

  return {
    ok: true,
    job: {
      ...job,
      status: 'disputed',
      disputedAt: now,
      disputeReason: input.reason,
    },
  };
}

export function submitReviewInMemory(
  job: JobRecord,
  input: {
    id: string;
    reviewerId: string;
    rating: number;
    comment?: string;
    now?: Date;
  },
):
  { ok: true; job: JobRecord; revealedSimultaneously: boolean } | { ok: false; errorCode: string } {
  const now = input.now ?? new Date();

  if (input.reviewerId !== job.clientId && input.reviewerId !== job.providerId) {
    return { ok: false, errorCode: 'FORBIDDEN' };
  }

  // Nunca permite avaliação em cancelled, disputed, scheduled ou no_show_claimed
  if (job.status !== 'completed' && job.status !== 'no_show') {
    return { ok: false, errorCode: 'INVALID_STATE' };
  }

  if (job.reviewsOpenUntil && now.getTime() > job.reviewsOpenUntil.getTime()) {
    return { ok: false, errorCode: 'JOB_TOO_LATE' };
  }

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, errorCode: 'VALIDATION_ERROR' };
  }

  if (job.reviews.some((r) => r.reviewerId === input.reviewerId)) {
    return { ok: false, errorCode: 'ALREADY_REVIEWED' };
  }

  const reviewerRole = input.reviewerId === job.clientId ? 'client' : 'provider';
  const revieweeId = reviewerRole === 'client' ? job.providerId : job.clientId;

  const created: ReviewRecord = {
    id: input.id,
    jobId: job.id,
    reviewerId: input.reviewerId,
    revieweeId,
    reviewerRole,
    rating: input.rating,
    comment: input.comment?.trim() || undefined,
    status: 'pending_reveal',
    revealedAt: null,
    createdAt: now,
  };

  const nextReviews = [...job.reviews, created];
  const shouldRevealNow =
    nextReviews.length >= 2 ||
    (job.reviewsRevealAt !== null &&
      job.reviewsRevealAt !== undefined &&
      now.getTime() >= job.reviewsRevealAt.getTime());

  const finalReviews = shouldRevealNow
    ? nextReviews.map((r) =>
        r.status === 'pending_reveal' ? { ...r, status: 'published' as const, revealedAt: now } : r,
      )
    : nextReviews;

  return {
    ok: true,
    revealedSimultaneously: shouldRevealNow,
    job: {
      ...job,
      reviews: finalReviews,
    },
  };
}

export function revealOverdueReviewsInMemory(job: JobRecord, now: Date = new Date()): JobRecord {
  if (
    (job.status === 'completed' || job.status === 'no_show') &&
    job.reviewsRevealAt &&
    now.getTime() >= job.reviewsRevealAt.getTime()
  ) {
    return {
      ...job,
      reviews: job.reviews.map((r) =>
        r.status === 'pending_reveal' ? { ...r, status: 'published' as const, revealedAt: now } : r,
      ),
    };
  }
  return job;
}

export function calculateProviderPublicRating(
  reviews: ReviewRecord[],
  providerId: string,
): { ratingAvg: number; ratingCount: number } {
  const publishedClientReviews = reviews.filter(
    (r) => r.revieweeId === providerId && r.reviewerRole === 'client' && r.status === 'published',
  );

  if (publishedClientReviews.length === 0) {
    return { ratingAvg: 0, ratingCount: 0 };
  }

  const sum = publishedClientReviews.reduce((acc, r) => acc + r.rating, 0);
  return {
    ratingAvg: Number((sum / publishedClientReviews.length).toFixed(2)),
    ratingCount: publishedClientReviews.length,
  };
}
