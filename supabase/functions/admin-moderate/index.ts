// Edge Function: admin-moderate (Deno / Supabase Edge Runtime)
// Fonte: docs/API_SPECIFICATION.md 4.2, docs/DATABASE.md 7.2, docs/SECURITY.md SEC-09

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ModerationAction =
  | 'resolve_report'
  | 'resolve_dispute'
  | 'suspend_user'
  | 'reactivate_user'
  | 'ban_provider'
  | 'set_category_active';

const VALID_ACTIONS = new Set<ModerationAction>([
  'resolve_report',
  'resolve_dispute',
  'suspend_user',
  'reactivate_user',
  'ban_provider',
  'set_category_active',
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
    action?: ModerationAction;
    targetType?: string;
    targetId?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  } | null;

  if (
    !body?.action ||
    !VALID_ACTIONS.has(body.action) ||
    !body?.targetId ||
    !body?.reason?.trim()
  ) {
    return Response.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'Ação administrativa exige action válido, targetId e reason obrigatório.',
      },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const nowIso = new Date().toISOString();
  const reason = body.reason.trim();

  // 1. Grava auditoria imutável ANTES de aplicar a mutação (SEC-09)
  const { error: auditError } = await serviceClient.from('admin_audit_log').insert({
    admin_id: user.id,
    action: body.action,
    target_type: body.targetType ?? body.action,
    target_id: body.targetId,
    reason,
    metadata: body.metadata ?? {},
  });

  if (auditError) {
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Falha ao registrar trilha de auditoria.' },
      { status: 500 },
    );
  }

  // 2. Executa a ação solicitada
  switch (body.action) {
    case 'resolve_report': {
      const resolutionStatus = body.metadata?.dismissed === true ? 'dismissed' : 'action_taken';
      const resolutionAction = String(body.metadata?.resolutionAction ?? 'moderated');

      const { error } = await serviceClient
        .from('reports')
        .update({
          status: resolutionStatus,
          resolved_by: user.id,
          resolved_at: nowIso,
          resolution_action: resolutionAction,
          resolution_note: reason,
        })
        .eq('id', body.targetId);

      if (error) {
        return Response.json(
          { code: 'INTERNAL_ERROR', message: 'Falha ao atualizar denúncia.' },
          { status: 500 },
        );
      }

      return Response.json({
        action: body.action,
        targetId: body.targetId,
        status: resolutionStatus,
      });
    }

    case 'resolve_dispute': {
      const finalStatus = body.metadata?.finalStatus === 'completed' ? 'completed' : 'cancelled';

      const { error } = await serviceClient
        .from('jobs')
        .update({
          status: finalStatus,
          status_reason: `dispute_resolved_${finalStatus}`,
          completed_at: finalStatus === 'completed' ? nowIso : null,
          cancelled_at: finalStatus === 'cancelled' ? nowIso : null,
        })
        .eq('id', body.targetId)
        .eq('status', 'disputed');

      if (error) {
        return Response.json(
          { code: 'INTERNAL_ERROR', message: 'Falha ao encerrar disputa.' },
          { status: 500 },
        );
      }

      await serviceClient.from('status_events').insert({
        entity_type: 'job',
        entity_id: body.targetId,
        from_status: 'disputed',
        to_status: finalStatus,
        actor_id: user.id,
        reason,
      });

      return Response.json({
        action: body.action,
        targetId: body.targetId,
        finalStatus,
      });
    }

    case 'suspend_user': {
      await serviceClient.from('profiles').update({ status: 'suspended' }).eq('id', body.targetId);

      await serviceClient
        .from('provider_profiles')
        .update({ verification_status: 'suspended', is_paused: true })
        .eq('user_id', body.targetId);

      return Response.json({
        action: body.action,
        targetId: body.targetId,
        status: 'suspended',
      });
    }

    case 'reactivate_user': {
      await serviceClient.from('profiles').update({ status: 'active' }).eq('id', body.targetId);

      return Response.json({
        action: body.action,
        targetId: body.targetId,
        status: 'active',
      });
    }

    case 'ban_provider': {
      await serviceClient.from('profiles').update({ status: 'suspended' }).eq('id', body.targetId);

      await serviceClient
        .from('provider_profiles')
        .update({ verification_status: 'suspended', is_paused: true })
        .eq('user_id', body.targetId);

      await serviceClient
        .from('provider_sensitive_data')
        .update({
          banned_at: nowIso,
          banned_reason: reason,
        })
        .eq('provider_id', body.targetId);

      return Response.json({
        action: body.action,
        targetId: body.targetId,
        banned: true,
      });
    }

    case 'set_category_active': {
      const isActive = Boolean(body.metadata?.isActive);

      if (isActive) {
        const { data: gates } = await serviceClient.rpc('get_category_gate_status');
        const categoryGate = (gates ?? []).find(
          (g: { category_id: string; gate_met: boolean }) => g.category_id === body.targetId,
        );
        if (!categoryGate?.gate_met) {
          return Response.json(
            {
              code: 'CATEGORY_GATE_CLOSED',
              message:
                'Não é possível ativar a categoria antes de atingir o mínimo de 2 prestadores aprovados e disponíveis em Osasco.',
            },
            { status: 409 },
          );
        }
      }

      const { error } = await serviceClient
        .from('categories')
        .update({ is_active: isActive })
        .eq('id', body.targetId);

      if (error) {
        return Response.json(
          { code: 'INTERNAL_ERROR', message: 'Falha ao atualizar status da categoria.' },
          { status: 500 },
        );
      }

      return Response.json({
        action: body.action,
        targetId: body.targetId,
        isActive,
      });
    }
  }
});
