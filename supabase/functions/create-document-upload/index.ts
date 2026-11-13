// Edge Function: create-document-upload (Deno / Supabase Edge Runtime)
// Fonte: docs/API_SPECIFICATION.md 4.1, docs/SECURITY.md 3.3 e 4.2, docs/DATABASE.md 7.1

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_DOCUMENT_TYPES = new Set(['id_front', 'id_back', 'selfie']);
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function isValidCpf(rawCpf: string): boolean {
  const digits = rawCpf.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) {
    return false;
  }
  const calc = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Number(digits[i]) * (len + 1 - i);
    }
    const rem = (sum * 10) % 11;
    return rem === 10 ? 0 : rem;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

async function computeCpfHmacHex(cleanCpf: string, pepper: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(cleanCpf));
  return Array.from(new Uint8Array(sig))
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
  const pepper = Deno.env.get('CPF_HMAC_PEPPER');

  if (!pepper || pepper.length < 16) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Configuração indisponível.' },
      { status: 500 },
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return Response.json({ code: 'UNAUTHENTICATED', message: 'Sessão inválida.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    cpf?: string;
    documentType?: string;
    mimeType?: string;
    fileSizeBytes?: number;
  } | null;

  if (
    !body ||
    !body.documentType ||
    !ALLOWED_DOCUMENT_TYPES.has(body.documentType) ||
    !body.mimeType ||
    !ALLOWED_MIME_TYPES.has(body.mimeType) ||
    typeof body.fileSizeBytes !== 'number' ||
    body.fileSizeBytes <= 0 ||
    body.fileSizeBytes > MAX_FILE_SIZE_BYTES
  ) {
    return Response.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'Tipo de documento, formato (JPEG/PNG) ou tamanho (máx. 5 MB) inválido.',
      },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);

  // Se o CPF foi enviado, valida e grava apenas o HMAC (SEC-12: CPF em claro nunca é persistido ou logado)
  if (body.cpf) {
    const cleanCpf = body.cpf.replace(/\D/g, '');
    if (!isValidCpf(cleanCpf)) {
      return Response.json({ code: 'VALIDATION_ERROR', message: 'CPF inválido.' }, { status: 400 });
    }
    const cpfHmac = await computeCpfHmacHex(cleanCpf, pepper);

    const { data: existingCpf } = await serviceClient
      .from('provider_sensitive_data')
      .select('provider_id, banned_at')
      .eq('cpf_hmac', cpfHmac)
      .maybeSingle();

    if (existingCpf && (existingCpf.provider_id !== user.id || existingCpf.banned_at !== null)) {
      return Response.json(
        { code: 'FORBIDDEN', message: 'Não foi possível prosseguir com os dados informados.' },
        { status: 403 },
      );
    }

    const { error: upsertSensitiveError } = await serviceClient
      .from('provider_sensitive_data')
      .upsert({ provider_id: user.id, cpf_hmac: cpfHmac }, { onConflict: 'provider_id' });

    if (upsertSensitiveError) {
      return Response.json(
        { code: 'FORBIDDEN', message: 'Falha ao registrar verificação.' },
        { status: 403 },
      );
    }
  }

  // Busca ou cria submissão pendente do prestador
  let { data: submission } = await serviceClient
    .from('verification_submissions')
    .select('id, status')
    .eq('provider_id', user.id)
    .eq('status', 'pending')
    .maybeSingle();

  if (!submission) {
    const { count: priorCount } = await serviceClient
      .from('verification_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('provider_id', user.id);

    const subType = (priorCount ?? 0) === 0 ? 'initial' : 'resubmission';
    const { data: created, error: createError } = await serviceClient
      .from('verification_submissions')
      .insert({ provider_id: user.id, type: subType, status: 'pending' })
      .select('id, status')
      .single();

    if (createError || !created) {
      return Response.json(
        { code: 'INVALID_STATE', message: 'Não foi possível iniciar a submissão.' },
        { status: 400 },
      );
    }
    submission = created;
  }

  const ext = body.mimeType === 'image/png' ? 'png' : 'jpg';
  const storagePath = `${user.id}/${submission.id}/${body.documentType}.${ext}`;

  const { data: signedUpload, error: signError } = await serviceClient.storage
    .from('verification')
    .createSignedUploadUrl(storagePath);

  if (signError || !signedUpload) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erro ao gerar URL de envio.' },
      { status: 500 },
    );
  }

  await serviceClient.from('provider_documents').upsert(
    {
      submission_id: submission.id,
      provider_id: user.id,
      type: body.documentType,
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      purged_at: null,
    },
    { onConflict: 'submission_id,type' },
  );

  return Response.json({
    submissionId: submission.id,
    documentType: body.documentType,
    signedUrl: signedUpload.signedUrl,
    token: signedUpload.token,
  });
});
