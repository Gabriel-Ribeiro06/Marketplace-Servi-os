// Edge Function: admin-review-provider (Deno / Supabase Edge Runtime)
// Fonte: docs/API_SPECIFICATION.md 4.2, docs/DATABASE.md 7.2, docs/SECURITY.md 4.3 a 4.5

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VALID_REJECTION_REASONS = new Set([
  'illegible',
  'expired_document',
  'face_mismatch',
  'name_mismatch',
  'underage',
  'duplicate_account',
  'suspected_fraud',
  'incomplete',
]);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json(
      { code: 'VALIDATION_ERROR', message: 'Método não permitido.' },
      { status: 405 },
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return Response.json({ code: 'UNAUTHENTICATED', message: 'Sessão inválida.' }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isAdmin } = await userClient.rpc('is_admin');
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!isAdmin || !user) {
    return Response.json(
      { code: 'FORBIDDEN', message: 'Acesso restrito a administradores com MFA ativo.' },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    submissionId?: string;
    decision?: 'approved' | 'rejected';
    rejectionReason?: string;
    reviewerNotes?: string;
  } | null;

  if (!body?.submissionId || (body.decision !== 'approved' && body.decision !== 'rejected')) {
    return Response.json(
      { code: 'VALIDATION_ERROR', message: 'Decisão inválida.' },
      { status: 400 },
    );
  }

  if (
    body.decision === 'rejected' &&
    (!body.rejectionReason || !VALID_REJECTION_REASONS.has(body.rejectionReason))
  ) {
    return Response.json(
      { code: 'VALIDATION_ERROR', message: 'Motivo padronizado de rejeição obrigatório.' },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  const { data: submission } = await serviceClient
    .from('verification_submissions')
    .select('id, provider_id, status, type')
    .eq('id', body.submissionId)
    .maybeSingle();

  if (!submission || submission.status !== 'pending') {
    return Response.json(
      { code: 'INVALID_STATE', message: 'Submissão não está pendente.' },
      { status: 400 },
    );
  }

  const now = new Date();
  // Retenção (SECURITY.md 4.5): 30 dias em aprovação; 45 dias (15d recurso + 30d) em rejeição
  const retentionDays = body.decision === 'approved' ? 30 : 45;
  const filesDeleteAfter = new Date(
    now.getTime() + retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const auditReason =
    body.decision === 'approved'
      ? `Aprovação de verificação (${submission.type})`
      : `Rejeição (${body.rejectionReason})`;

  // 1. Grava auditoria administrativa (SEC-09)
  const { error: auditError } = await serviceClient.from('admin_audit_log').insert({
    admin_id: user.id,
    action:
      body.decision === 'approved'
        ? 'approve_provider_verification'
        : 'reject_provider_verification',
    target_type: 'verification_submission',
    target_id: submission.id,
    reason: auditReason,
    metadata: {
      provider_id: submission.provider_id,
      submission_type: submission.type,
      rejection_reason: body.rejectionReason ?? null,
    },
  });

  if (auditError) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Falha ao gravar auditoria.' },
      { status: 500 },
    );
  }

  // 2. Atualiza submissão
  const { error: subUpdateError } = await serviceClient
    .from('verification_submissions')
    .update({
      status: body.decision,
      rejection_reason: body.decision === 'rejected' ? body.rejectionReason : null,
      reviewer_notes: body.reviewerNotes?.trim() ?? null,
      reviewed_at: now.toISOString(),
      reviewed_by: user.id,
      files_delete_after: filesDeleteAfter,
    })
    .eq('id', submission.id);

  if (subUpdateError) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Falha ao atualizar submissão.' },
      { status: 500 },
    );
  }

  // 3. Atualiza status público do prestador
  await serviceClient
    .from('provider_profiles')
    .update({
      verification_status: body.decision,
      verified_at: body.decision === 'approved' ? now.toISOString() : null,
    })
    .eq('user_id', submission.provider_id);

  // 4. Registra evento de transição em status_events
  await serviceClient.from('status_events').insert({
    entity_type: 'verification',
    entity_id: submission.id,
    from_status: 'pending_review',
    to_status: body.decision,
    actor_id: user.id,
    reason: body.decision === 'rejected' ? body.rejectionReason : 'approved_by_admin',
  });

  return Response.json({
    submissionId: submission.id,
    providerId: submission.provider_id,
    status: body.decision,
    filesDeleteAfter,
  });
});
