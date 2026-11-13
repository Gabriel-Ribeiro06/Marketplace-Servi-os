// Edge Function: admin-get-document-url (Deno / Supabase Edge Runtime)
// Fonte: docs/API_SPECIFICATION.md 4.2, docs/DATABASE.md 7.2, docs/SECURITY.md 4.6 (T-STO-03, T-STO-04, T-ADM-09)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SIGNED_URL_TTL_SECONDS = 60;
const MASS_ACCESS_THRESHOLD_PER_HOUR = 20;

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

  // Verifica is_admin() (que exige admin_users + aal2 no JWT — SEC-03)
  const { data: isAdmin, error: adminCheckError } = await userClient.rpc('is_admin');
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (adminCheckError || !isAdmin || !user) {
    return Response.json(
      { code: 'FORBIDDEN', message: 'Acesso restrito a administradores com MFA ativo.' },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    documentId?: string;
    reason?: string;
  } | null;

  if (!body?.documentId || !body.reason || body.reason.trim().length < 5) {
    return Response.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'Informe o documento e o motivo da visualização (mín. 5 caracteres).',
      },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  const { data: doc } = await serviceClient
    .from('provider_documents')
    .select('id, storage_path, purged_at, submission_id, provider_id, type')
    .eq('id', body.documentId)
    .maybeSingle();

  if (!doc || doc.purged_at !== null) {
    return Response.json(
      { code: 'NOT_FOUND', message: 'Documento não encontrado ou já purgado.' },
      { status: 404 },
    );
  }

  // Contagem de aberturas na última hora para alerta de acesso em massa (T-ADM-09)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentOpens } = await serviceClient
    .from('admin_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('admin_id', user.id)
    .eq('action', 'open_verification_document')
    .gte('created_at', oneHourAgo);

  const massAccessAlert = (recentOpens ?? 0) >= MASS_ACCESS_THRESHOLD_PER_HOUR;

  // Grava auditoria imutável ANTES de devolver a URL assinada (SEC-09, T-ADM-02)
  const { error: auditError } = await serviceClient.from('admin_audit_log').insert({
    admin_id: user.id,
    action: 'open_verification_document',
    target_type: 'provider_document',
    target_id: doc.id,
    reason: body.reason.trim(),
    metadata: {
      submission_id: doc.submission_id,
      provider_id: doc.provider_id,
      document_type: doc.type,
      mass_access_alert: massAccessAlert,
    },
  });

  if (auditError) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Falha ao registrar auditoria.' },
      { status: 500 },
    );
  }

  const { data: signed, error: signError } = await serviceClient.storage
    .from('verification')
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erro ao gerar URL temporária.' },
      { status: 500 },
    );
  }

  return Response.json({
    signedUrl: signed.signedUrl,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    massAccessAlert,
  });
});
