import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * Edge Function: send-push (API_SPECIFICATION.md seção 4.1; SECURITY.md SEC-27; E5-03)
 * - Dispara notificações push genéricas via Expo Push API (sem PII na tela de bloqueio).
 * - Respeita can_interact(sender_id, user_id) quando houver remetente.
 * - Aplica teto diário para prestadores (`push_daily_cap_provider = 10`).
 * - Respeita janela silenciosa (21h–07h America/Sao_Paulo) para novos lotes de pedidos.
 * - Remove tokens inválidos (`DeviceNotRegistered`) de `public.push_tokens`.
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

interface SendPushRequestBody {
  notificationId: string;
  userId: string;
  senderId?: string | null;
  type:
    | 'new_message'
    | 'new_quote'
    | 'quote_revised'
    | 'quote_accepted'
    | 'new_request_batch'
    | 'request_expiring'
    | 'job_completed';
  isProviderNotification?: boolean;
}

const GENERIC_PUSH_COPY: Record<SendPushRequestBody['type'], { title: string; body: string }> = {
  new_message: {
    title: 'Nova mensagem no Eu Faço',
    body: 'Abra o aplicativo para ler e responder com segurança.',
  },
  new_quote: {
    title: 'Nova proposta recebida',
    body: 'Um profissional verificado enviou um orçamento para o seu pedido.',
  },
  quote_revised: {
    title: 'Proposta atualizada',
    body: 'Um profissional atualizou as condições da proposta enviada.',
  },
  quote_accepted: {
    title: 'Sua proposta foi aceita!',
    body: 'Abra o aplicativo para ver os detalhes do agendamento e o endereço.',
  },
  new_request_batch: {
    title: 'Novo pedido compatível em Osasco',
    body: 'Há uma nova solicitação na sua categoria e bairro de atendimento.',
  },
  request_expiring: {
    title: 'Seu pedido expira em breve',
    body: 'Confira as propostas recebidas antes do encerramento do prazo de 48h.',
  },
  job_completed: {
    title: 'Serviço concluído',
    body: 'Deixe sua avaliação no aplicativo para ajudar a comunidade.',
  },
};

function isQuietHoursInSaoPaulo(now: Date): boolean {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const hour = Number(hourStr);
  return hour >= 21 || hour < 7;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }), { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const body = (await req.json()) as SendPushRequestBody;
  if (!body.notificationId || !body.userId || !body.type || !GENERIC_PUSH_COPY[body.type]) {
    return new Response(
      JSON.stringify({
        code: 'VALIDATION_ERROR',
        message: 'Payload de notificação inválido.',
      }),
      { status: 400 },
    );
  }

  // 1. Verificar can_interact quando houver remetente bilateral
  if (body.senderId) {
    const { data: canInteract } = await adminClient.rpc('can_interact', {
      p_user_a: body.senderId,
      p_user_b: body.userId,
    });
    if (!canInteract) {
      return new Response(JSON.stringify({ sent: false, reason: 'BLOCKED_BY_CAN_INTERACT' }), {
        status: 200,
      });
    }
  }

  // 2. Respeitar janela silenciosa (21h–07h America/Sao_Paulo) para novos pedidos em lote
  if (body.type === 'new_request_batch' && isQuietHoursInSaoPaulo(new Date())) {
    return new Response(JSON.stringify({ sent: false, reason: 'QUIET_HOURS_DEFERRED' }), {
      status: 200,
    });
  }

  // 3. Teto diário de push para prestadores (padrão 10/dia; excesso fica só no app)
  if (body.isProviderNotification || body.type === 'new_request_batch') {
    const { data: capCfg } = await adminClient
      .from('app_config')
      .select('value')
      .eq('key', 'push_daily_cap_provider')
      .maybeSingle();
    const dailyCap = Number(capCfg?.value ?? 10);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: sentCount } = await adminClient
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', body.userId)
      .not('push_sent_at', 'is', null)
      .gte('push_sent_at', since24h);

    if ((sentCount ?? 0) >= dailyCap) {
      return new Response(JSON.stringify({ sent: false, reason: 'DAILY_PUSH_CAP_REACHED' }), {
        status: 200,
      });
    }
  }

  // 4. Buscar tokens ativos do destinatário
  const { data: tokens } = await adminClient
    .from('push_tokens')
    .select('id, token')
    .eq('user_id', body.userId);

  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ sent: false, reason: 'NO_PUSH_TOKENS' }), {
      status: 200,
    });
  }

  const copy = GENERIC_PUSH_COPY[body.type];
  const messages = tokens.map((t: { id: string; token: string }) => ({
    to: t.token,
    sound: 'default',
    title: copy.title,
    body: copy.body,
    data: {
      notificationId: body.notificationId,
      type: body.type,
    },
  }));

  const expoResp = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });

  const expoJson = (await expoResp.json().catch(() => ({ data: [] }))) as {
    data?: { status: string; details?: { error?: string } }[];
  };

  // 5. Limpar tokens inválidos (DeviceNotRegistered)
  const tickets = expoJson.data ?? [];
  const invalidTokens: string[] = [];
  tickets.forEach((ticket, idx) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      const targetToken = tokens[idx]?.token;
      if (targetToken) {
        invalidTokens.push(targetToken);
      }
    }
  });

  if (invalidTokens.length > 0) {
    await adminClient.from('push_tokens').delete().in('token', invalidTokens);
  }

  await adminClient
    .from('notifications')
    .update({ push_sent_at: new Date().toISOString() })
    .eq('id', body.notificationId);

  return new Response(
    JSON.stringify({
      sent: true,
      deliveredCount: tokens.length - invalidTokens.length,
      removedInvalidTokensCount: invalidTokens.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
