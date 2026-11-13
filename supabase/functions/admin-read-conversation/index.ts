// Edge Function: admin-read-conversation (Deno / Supabase Edge Runtime)
// Fonte: docs/API_SPECIFICATION.md 4.2, docs/DATABASE.md 7.2, docs/SECURITY.md SEC-25

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    conversationId?: string;
    reportId?: string;
    reason?: string;
  } | null;

  if (!body?.conversationId || !body?.reportId || !body?.reason?.trim()) {
    return Response.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'Leitura de conversa exige conversationId, reportId vinculado e justificativa.',
      },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  // SEC-25: Valida vínculo obrigatório com uma denúncia/disputa existente em public.reports
  const { data: report } = await serviceClient
    .from('reports')
    .select('id, status, target_type, target_id')
    .eq('id', body.reportId)
    .maybeSingle();

  if (!report) {
    return Response.json(
      {
        code: 'FORBIDDEN',
        message: 'Leitura bloqueada: reportId não encontrado em denúncias registradas.',
      },
      { status: 403 },
    );
  }

  const { data: conversation } = await serviceClient
    .from('conversations')
    .select('id, request_id, quote_id, client_id, provider_id, status, created_at')
    .eq('id', body.conversationId)
    .maybeSingle();

  if (!conversation) {
    return Response.json(
      { code: 'NOT_FOUND', message: 'Conversa não encontrada.' },
      { status: 404 },
    );
  }

  // 1. Grava auditoria obrigatória ANTES de retornar mensagens (SEC-09 / SEC-25)
  const { error: auditError } = await serviceClient.from('admin_audit_log').insert({
    admin_id: user.id,
    action: 'read_conversation_via_report',
    target_type: 'conversation',
    target_id: conversation.id,
    reason: body.reason.trim(),
    metadata: {
      report_id: report.id,
      report_target_type: report.target_type,
      report_target_id: report.target_id,
    },
  });

  if (auditError) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Falha ao gravar auditoria.' },
      { status: 500 },
    );
  }

  // 2. Retorna mensagens da conversa
  const { data: messages, error: msgError } = await serviceClient
    .from('messages')
    .select('id, sender_id, kind, body, created_at, read_at, redacted_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });

  if (msgError) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Falha ao carregar mensagens.' },
      { status: 500 },
    );
  }

  return Response.json({
    conversation,
    reportId: report.id,
    messages: messages ?? [],
  });
});
