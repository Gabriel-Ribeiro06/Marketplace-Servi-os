// Edge Function: delete-account (Deno / Supabase Edge Runtime)
// Fonte: docs/API_SPECIFICATION.md 4.1, docs/DATABASE.md seção 8, docs/SECURITY.md 9.5

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user) {
    return Response.json({ code: 'UNAUTHENTICATED', message: 'Sessão inválida.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    confirmationText?: string;
  } | null;

  if (body?.confirmationText?.trim().toUpperCase() !== 'EXCLUIR') {
    return Response.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'Confirme digitando EXCLUIR para concluir a exclusão da conta.',
      },
      { status: 400 },
    );
  }

  const { data: eligibility, error: eligError } = await userClient.rpc(
    'check_account_deletion_eligibility',
    { p_user_id: user.id },
  );

  if (eligError || !eligibility?.eligible) {
    return Response.json(
      {
        code: eligibility?.reason_code ?? 'ACCOUNT_DELETION_BLOCKED',
        message:
          eligibility?.message ??
          'Não é possível excluir a conta enquanto houver serviços agendados ou em disputa.',
      },
      { status: 409 },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const userIdHash = await sha256Hex(user.id);

  const { data: scrubResult, error: scrubError } = await serviceClient.rpc(
    'execute_account_deletion_data_scrub',
    {
      p_user_id: user.id,
      p_user_id_hash: userIdHash,
    },
  );

  if (scrubError) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Falha ao executar anonimização de dados.' },
      { status: 500 },
    );
  }

  // Remove credencial de autenticação em auth.users (DATABASE.md seção 8)
  const { error: deleteAuthError } = await serviceClient.auth.admin.deleteUser(user.id);
  if (deleteAuthError) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Falha ao encerrar credenciais de acesso.' },
      { status: 500 },
    );
  }

  return Response.json({
    deleted: true,
    legalHoldApplied: Boolean(scrubResult?.legal_hold_applied),
  });
});
