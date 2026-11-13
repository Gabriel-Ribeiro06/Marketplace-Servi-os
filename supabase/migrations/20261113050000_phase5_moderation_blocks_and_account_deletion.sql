-- =============================================================================
-- Fase 5 — Confiança, Bloqueios, Denúncias, Moderação Admin, Gate e Exclusão de Conta
-- Fonte oficial: docs/DATABASE.md (seções 3.5, 6, 7, 8),
--                docs/API_SPECIFICATION.md (seções 3.4, 4.1, 4.2),
--                docs/SECURITY.md (SEC-03, SEC-09, SEC-25)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabelas da Fase 5 (reports e user_blocks — fechando as 31 tabelas da matriz)
-- -----------------------------------------------------------------------------

-- 1.1 reports (DATABASE.md seção 3.5)
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_type public.report_target NOT NULL,
  target_id uuid NOT NULL,
  reported_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason public.report_reason NOT NULL,
  details text CHECK (details IS NULL OR char_length(btrim(details)) <= 1000),
  status public.report_status NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('safety', 'normal')),
  sla_due_at timestamptz NOT NULL,
  resolved_by uuid REFERENCES public.admin_users(user_id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolution_action text CHECK (resolution_action IS NULL OR char_length(btrim(resolution_action)) <= 120),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(btrim(resolution_note)) <= 1000),
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup de denúncia aberta por (reporter_id, target_type, target_id, reason)
CREATE UNIQUE INDEX idx_reports_unique_open_per_reporter_target
  ON public.reports (reporter_id, target_type, target_id, reason)
  WHERE status IN ('open', 'in_review');

CREATE INDEX idx_reports_status_priority_sla
  ON public.reports (status, priority, sla_due_at);

CREATE INDEX idx_reports_reporter_id
  ON public.reports (reporter_id, created_at DESC);

CREATE INDEX idx_reports_reported_user_id
  ON public.reports (reported_user_id)
  WHERE reported_user_id IS NOT NULL;

CREATE INDEX idx_reports_resolved_by
  ON public.reports (resolved_by)
  WHERE resolved_by IS NOT NULL;

CREATE TRIGGER trg_reports_updated_at
BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reports FROM anon, authenticated;
GRANT SELECT ON public.reports TO authenticated;

-- 1.2 user_blocks (DATABASE.md seção 3.5 e seção 6)
CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT chk_user_blocks_no_self_block CHECK (blocker_id <> blocked_id)
);

-- Índice inverso para consultas bidirecionais em can_interact (DATABASE.md seção 9)
CREATE INDEX idx_user_blocks_blocked_blocker
  ON public.user_blocks (blocked_id, blocker_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_blocks FROM anon, authenticated;
GRANT SELECT ON public.user_blocks TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Políticas RLS da Fase 5 (DATABASE.md seção 7)
-- -----------------------------------------------------------------------------

-- 2.1 reports: autor lê apenas as próprias denúncias; admin lê todas
CREATE POLICY reports_select_own_or_admin
  ON public.reports
  FOR SELECT
  TO authenticated
  USING (
    reporter_id = auth.uid()
    OR public.is_admin()
  );

-- 2.2 user_blocks: SOMENTE quem bloqueou (blocker_id) ou admin lê; o bloqueado NUNCA vê (T-BLK-04)
CREATE POLICY user_blocks_select_blocker_or_admin
  ON public.user_blocks
  FOR SELECT
  TO authenticated
  USING (
    blocker_id = auth.uid()
    OR public.is_admin()
  );

-- Atualizar view public_provider_profiles para ocultar perfis quando houver bloqueio (can_interact)
CREATE OR REPLACE VIEW public.public_provider_profiles
WITH (security_invoker = true)
AS
SELECT
  pp.user_id AS provider_id,
  pp.display_name,
  pp.bio,
  pr.avatar_path,
  pp.experience_years,
  'informado pelo profissional'::text AS experience_label,
  'Identidade verificada'::text AS verification_badge_label,
  pp.verified_at,
  pp.rating_avg,
  pp.rating_count,
  pp.completed_jobs_count,
  pp.avg_first_response_minutes
FROM public.provider_profiles pp
JOIN public.profiles pr ON pr.id = pp.user_id
WHERE pp.verification_status = 'approved'
  AND pp.is_paused = false
  AND pr.status = 'active'
  AND pr.deleted_at IS NULL
  AND (auth.uid() IS NULL OR public.can_interact(pp.user_id, auth.uid()));

GRANT SELECT ON public.public_provider_profiles TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. RPCs de Bloqueio e Denúncia (API_SPECIFICATION.md seção 3.4)
-- -----------------------------------------------------------------------------

-- 3.1 block_user (E7-02 — bloqueia usuário, fecha conversas abertas e sinaliza se houver job scheduled)
CREATE OR REPLACE FUNCTION public.block_user(
  p_blocked_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scheduled_job record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  IF p_blocked_user_id IS NULL OR p_blocked_user_id = v_uid THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Usuário inválido para bloqueio.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (v_uid, p_blocked_user_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  -- Fechar conversas abertas entre as duas partes (status -> read_only)
  UPDATE public.conversations
  SET status = 'read_only'
  WHERE status = 'open'
    AND (
      (client_id = v_uid AND provider_id = p_blocked_user_id)
      OR (client_id = p_blocked_user_id AND provider_id = v_uid)
    );

  -- Se houver job 'scheduled' ativo entre as partes, abre sinalização ao admin (DATABASE.md seção 6)
  FOR v_scheduled_job IN
    SELECT id
    FROM public.jobs
    WHERE status = 'scheduled'
      AND (
        (client_id = v_uid AND provider_id = p_blocked_user_id)
        OR (client_id = p_blocked_user_id AND provider_id = v_uid)
      )
  LOOP
    INSERT INTO public.reports (
      reporter_id,
      target_type,
      target_id,
      reported_user_id,
      reason,
      details,
      status,
      priority,
      sla_due_at,
      legal_hold
    )
    VALUES (
      v_uid,
      'job',
      v_scheduled_job.id,
      p_blocked_user_id,
      'other',
      'Bloqueio acionado durante serviço agendado.',
      'open',
      'normal',
      now() + interval '72 hours',
      false
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'blocker_id', v_uid,
    'blocked_id', p_blocked_user_id,
    'blocked', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.block_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated;

-- 3.2 unblock_user (E7-02)
CREATE OR REPLACE FUNCTION public.unblock_user(
  p_blocked_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.user_blocks
  WHERE blocker_id = v_uid
    AND blocked_id = p_blocked_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated;

-- 3.3 create_report (E7-01 — nunca impedido por bloqueio; SLA 24h safety vs 72h normal)
CREATE OR REPLACE FUNCTION public.create_report(
  p_target_type public.report_target,
  p_target_id uuid,
  p_reason public.report_reason,
  p_details text DEFAULT NULL,
  p_reported_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_max_daily integer := 10;
  v_daily_count integer := 0;
  v_priority text;
  v_sla_hours integer;
  v_legal_hold boolean := false;
  v_report_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE((value #>> '{}')::integer, 10) INTO v_max_daily
  FROM public.app_config
  WHERE key = 'max_daily_reports_per_user';

  SELECT COUNT(*) INTO v_daily_count
  FROM public.reports
  WHERE reporter_id = v_uid
    AND created_at >= now() - interval '24 hours';

  IF v_daily_count >= v_max_daily THEN
    RAISE EXCEPTION 'RATE_LIMITED: Limite diário de denúncias atingido.'
      USING ERRCODE = '22023';
  END IF;

  -- Classificação automática de prioridade safety vs normal (API_SPECIFICATION seção 3.4)
  IF p_reason IN ('threat_or_violence', 'damage_or_theft', 'harassment') THEN
    v_priority := 'safety';
    SELECT COALESCE((value #>> '{}')::integer, 24) INTO v_sla_hours
    FROM public.app_config WHERE key = 'report_sla_safety_hours';
    v_legal_hold := true;
  ELSE
    v_priority := 'normal';
    SELECT COALESCE((value #>> '{}')::integer, 72) INTO v_sla_hours
    FROM public.app_config WHERE key = 'report_sla_normal_hours';
    v_legal_hold := false;
  END IF;

  INSERT INTO public.reports (
    reporter_id,
    target_type,
    target_id,
    reported_user_id,
    reason,
    details,
    status,
    priority,
    sla_due_at,
    legal_hold
  )
  VALUES (
    v_uid,
    p_target_type,
    p_target_id,
    p_reported_user_id,
    p_reason,
    NULLIF(btrim(COALESCE(p_details, '')), ''),
    'open',
    v_priority,
    now() + make_interval(hours => v_sla_hours),
    v_legal_hold
  )
  RETURNING id INTO v_report_id;

  RETURN jsonb_build_object(
    'report_id', v_report_id,
    'priority', v_priority,
    'sla_hours', v_sla_hours,
    'legal_hold', v_legal_hold,
    'status', 'open'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_report(public.report_target, uuid, public.report_reason, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_report(public.report_target, uuid, public.report_reason, text, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Elegibilidade e Execução Transacional de Exclusão de Conta (DATABASE.md seção 8)
-- -----------------------------------------------------------------------------

-- 4.1 check_account_deletion_eligibility (pré-condição de delete-account — RF-04)
CREATE OR REPLACE FUNCTION public.check_account_deletion_eligibility(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_jobs integer := 0;
  v_legal_holds integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Acesso negado.'
      USING ERRCODE = '42501';
  END IF;

  -- Bloqueia se houver job scheduled, no_show_claimed ou disputed
  SELECT COUNT(*) INTO v_active_jobs
  FROM public.jobs
  WHERE (client_id = p_user_id OR provider_id = p_user_id)
    AND status IN ('scheduled', 'no_show_claimed', 'disputed');

  IF v_active_jobs > 0 THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'ACTIVE_JOB_OR_DISPUTE',
      'message', 'Conclua ou cancele seus serviços agendados/em disputa antes de excluir a conta.'
    );
  END IF;

  -- Bloqueia se houver denúncia aberta contra o usuário com legal_hold
  SELECT COUNT(*) INTO v_legal_holds
  FROM public.reports
  WHERE reported_user_id = p_user_id
    AND (status IN ('open', 'in_review') AND (legal_hold = true OR priority = 'safety'));

  IF v_legal_holds > 0 THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'LEGAL_HOLD_ACTIVE',
      'message', 'Sua conta possui uma apuração de segurança em andamento e não pode ser excluída neste momento.'
    );
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'reason_code', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_account_deletion_eligibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_account_deletion_eligibility(uuid) TO authenticated;

-- 4.2 execute_account_deletion_data_scrub (chamada pela Edge Function delete-account ou em testes)
CREATE OR REPLACE FUNCTION public.execute_account_deletion_data_scrub(
  p_user_id uuid,
  p_user_id_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elig jsonb;
  v_has_legal_hold boolean := false;
  v_req record;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Acesso negado.'
      USING ERRCODE = '42501';
  END IF;

  v_elig := public.check_account_deletion_eligibility(p_user_id);
  IF NOT COALESCE((v_elig ->> 'eligible')::boolean, false) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_BLOCKED: %', COALESCE(v_elig ->> 'message', 'Exclusão bloqueada.')
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.reports
    WHERE reported_user_id = p_user_id
      AND legal_hold = true
  ) INTO v_has_legal_hold;

  -- 1. Cancelar pedidos abertos do cliente (account_deleted)
  FOR v_req IN
    SELECT id, status
    FROM public.service_requests
    WHERE client_id = p_user_id
      AND status IN ('open', 'quotes_closed')
    FOR UPDATE
  LOOP
    UPDATE public.quotes
    SET status = 'rejected',
        status_reason = 'account_deleted'
    WHERE request_id = v_req.id
      AND status = 'sent';

    UPDATE public.service_requests
    SET status = 'cancelled',
        status_reason = 'account_deleted',
        active_quotes_count = 0,
        dispatch_state = 'done',
        closed_at = now()
    WHERE id = v_req.id;

    UPDATE public.conversations
    SET status = 'read_only'
    WHERE request_id = v_req.id;
  END LOOP;

  -- 2. Retirar propostas 'sent' enviadas pelo usuário como prestador
  UPDATE public.quotes
  SET status = 'withdrawn',
      status_reason = 'account_deleted'
  WHERE provider_id = p_user_id
    AND status = 'sent';

  -- 3. Apagar endereços privados dos pedidos do usuário
  DELETE FROM public.service_request_private
  WHERE request_id IN (
    SELECT id FROM public.service_requests WHERE client_id = p_user_id
  );

  -- 4. Redigir mensagens enviadas pelo usuário (salvo legal_hold)
  IF NOT v_has_legal_hold THEN
    UPDATE public.messages
    SET body = NULL,
        redacted_at = now()
    WHERE sender_id = p_user_id
      AND redacted_at IS NULL;
  END IF;

  -- 5. Limpar tokens, notificações, disponibilidade, categorias/bairros e portfólio
  DELETE FROM public.push_tokens WHERE user_id = p_user_id;
  DELETE FROM public.notifications WHERE user_id = p_user_id;
  DELETE FROM public.availability_rules WHERE provider_id = p_user_id;
  DELETE FROM public.provider_categories WHERE provider_id = p_user_id;
  DELETE FROM public.provider_neighborhoods WHERE provider_id = p_user_id;
  DELETE FROM public.portfolio_items WHERE provider_id = p_user_id;

  -- 6. Apagar provider_sensitive_data EXCETO quando banido (banned_at IS NOT NULL — prevenção a fraude)
  DELETE FROM public.provider_sensitive_data
  WHERE provider_id = p_user_id
    AND banned_at IS NULL;

  -- 7. Limpar notas e textos de recurso em verification_submissions
  UPDATE public.verification_submissions
  SET reviewer_notes = NULL,
      appeal_text = NULL
  WHERE provider_id = p_user_id;

  -- 8. Anonimizar provider_profiles se existir
  UPDATE public.provider_profiles
  SET display_name = 'Profissional removido',
      bio = '',
      experience_years = NULL,
      verification_status = 'suspended',
      is_paused = true
  WHERE user_id = p_user_id;

  -- 9. Anonimizar profiles (mantendo a linha para integridade de jobs/reviews/reports — ADR-11)
  UPDATE public.profiles
  SET full_name = 'Usuário removido',
      avatar_path = NULL,
      phone = NULL,
      phone_verified_at = NULL,
      neighborhood_id = NULL,
      status = 'deleted',
      deleted_at = now()
  WHERE id = p_user_id;

  -- 10. Registrar prova sem PII em account_deletion_log
  INSERT INTO public.account_deletion_log (
    user_id_hash,
    requested_at,
    completed_at,
    legal_hold_applied
  )
  VALUES (
    p_user_id_hash,
    now(),
    now(),
    v_has_legal_hold
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'legal_hold_applied', v_has_legal_hold
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_account_deletion_data_scrub(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion_data_scrub(uuid, text) TO service_role;
