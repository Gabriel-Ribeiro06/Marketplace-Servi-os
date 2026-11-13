-- =============================================================================
-- Fase 4 — Serviços Agendados (jobs), Exceções e Avaliações Bilaterais (Épico E6)
-- Fonte oficial: docs/DATABASE.md (seções 3.3, 3.5, 4, 5.3, 5.4, 5.5, 7),
--                docs/API_SPECIFICATION.md (seções 3.3 e 5),
--                docs/PRD.md (seção 11.2)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabelas da Fase 4 (jobs e reviews)
-- -----------------------------------------------------------------------------

-- 1.1 jobs (DATABASE.md seção 3.3 e 5.3)
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.service_requests(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL UNIQUE REFERENCES public.quotes(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE RESTRICT,
  scheduled_for timestamptz NOT NULL,
  agreed_price_cents integer NOT NULL CHECK (agreed_price_cents > 0 AND agreed_price_cents <= 5000000),
  status public.job_status NOT NULL DEFAULT 'scheduled',
  completion_type public.completion_type,
  completion_note text CHECK (completion_note IS NULL OR char_length(btrim(completion_note)) <= 1000),
  completed_at timestamptz,
  cancelled_by text CHECK (cancelled_by IS NULL OR cancelled_by IN ('client', 'provider', 'system', 'admin')),
  cancel_reason public.cancel_reason,
  cancel_note text CHECK (cancel_note IS NULL OR char_length(btrim(cancel_note)) <= 500),
  cancelled_at timestamptz,
  is_late_cancellation boolean NOT NULL DEFAULT false,
  no_show_claimed_by text CHECK (no_show_claimed_by IS NULL OR no_show_claimed_by IN ('client', 'provider')),
  no_show_claimed_at timestamptz,
  no_show_contest_deadline timestamptz,
  disputed_at timestamptz,
  dispute_outcome public.dispute_outcome,
  dispute_resolved_at timestamptz,
  dispute_resolved_by uuid REFERENCES public.admin_users(user_id) ON DELETE RESTRICT,
  dispute_deadline timestamptz,
  reviews_reveal_at timestamptz,
  reviews_open_until timestamptz,
  client_address_released_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_jobs_distinct_parties CHECK (client_id <> provider_id),
  CONSTRAINT chk_jobs_partial_requires_note CHECK (
    completion_type IS DISTINCT FROM 'partial'
    OR (completion_note IS NOT NULL AND char_length(btrim(completion_note)) >= 5)
  )
);

CREATE INDEX idx_jobs_client_created
  ON public.jobs (client_id, created_at DESC);

CREATE INDEX idx_jobs_provider_created
  ON public.jobs (provider_id, created_at DESC);

CREATE INDEX idx_jobs_status_scheduled_for
  ON public.jobs (status, scheduled_for);

CREATE INDEX idx_jobs_reviews_reveal
  ON public.jobs (reviews_reveal_at)
  WHERE status IN ('completed', 'no_show');

CREATE INDEX idx_jobs_dispute_resolved_by
  ON public.jobs (dispute_resolved_by)
  WHERE dispute_resolved_by IS NOT NULL;

CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.jobs FROM anon, authenticated;
GRANT SELECT ON public.jobs TO authenticated;

-- 1.2 reviews (DATABASE.md seção 3.5 e 5.5)
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewer_role text NOT NULL CHECK (reviewer_role IN ('client', 'provider')),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(btrim(comment)) <= 500),
  status public.review_status NOT NULL DEFAULT 'pending_reveal',
  revealed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, reviewer_id),
  CONSTRAINT chk_reviews_distinct_parties CHECK (reviewer_id <> reviewee_id)
);

CREATE INDEX idx_reviews_job_id
  ON public.reviews (job_id);

CREATE INDEX idx_reviews_reviewee_status
  ON public.reviews (reviewee_id, status);

CREATE INDEX idx_reviews_reviewer_id
  ON public.reviews (reviewer_id);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reviews FROM anon, authenticated;
GRANT SELECT ON public.reviews TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Políticas RLS da Fase 4 (DATABASE.md seção 7)
-- -----------------------------------------------------------------------------

-- 2.1 jobs: cliente do job, prestador do job ou admin
CREATE POLICY jobs_select_participant_or_admin
  ON public.jobs
  FOR SELECT
  TO authenticated
  USING (
    client_id = auth.uid()
    OR provider_id = auth.uid()
    OR public.is_admin()
  );

-- 2.2 reviews: autor lê a própria pending_reveal; todos autenticados leem published; admin lê todas
CREATE POLICY reviews_select_published_own_or_admin
  ON public.reviews
  FOR SELECT
  TO authenticated
  USING (
    status = 'published'
    OR (reviewer_id = auth.uid() AND status = 'pending_reveal')
    OR public.is_admin()
  );

-- Atualizar política de status_events para incluir eventos de 'job' para seus participantes
DROP POLICY IF EXISTS status_events_select_participant_or_admin ON public.status_events;
CREATE POLICY status_events_select_participant_or_admin
  ON public.status_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR (
      entity_type = 'request'
      AND EXISTS (
        SELECT 1
        FROM public.service_requests sr
        WHERE sr.id = status_events.entity_id
          AND sr.client_id = auth.uid()
      )
    )
    OR (
      entity_type = 'quote'
      AND EXISTS (
        SELECT 1
        FROM public.quotes q
        JOIN public.service_requests sr ON sr.id = q.request_id
        WHERE q.id = status_events.entity_id
          AND (q.provider_id = auth.uid() OR sr.client_id = auth.uid())
      )
    )
    OR (
      entity_type = 'job'
      AND EXISTS (
        SELECT 1
        FROM public.jobs j
        WHERE j.id = status_events.entity_id
          AND (j.client_id = auth.uid() OR j.provider_id = auth.uid())
      )
    )
    OR (
      entity_type = 'verification'
      AND EXISTS (
        SELECT 1
        FROM public.verification_submissions vs
        WHERE vs.id = status_events.entity_id
          AND vs.provider_id = auth.uid()
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Criação automática do Job quando uma proposta é aceita (accept_quote)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_quote_accepted_create_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
  v_job_id uuid;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status <> 'accepted' THEN
    SELECT client_id INTO v_client_id
    FROM public.service_requests
    WHERE id = NEW.request_id;

    INSERT INTO public.jobs (
      request_id,
      quote_id,
      client_id,
      provider_id,
      scheduled_for,
      agreed_price_cents,
      status,
      client_address_released_at
    )
    VALUES (
      NEW.request_id,
      NEW.id,
      v_client_id,
      NEW.provider_id,
      NEW.proposed_start,
      NEW.total_price_cents,
      'scheduled',
      now()
    )
    ON CONFLICT (request_id) DO NOTHING
    RETURNING id INTO v_job_id;

    IF v_job_id IS NOT NULL THEN
      PERFORM public.record_status_event(
        'job',
        v_job_id,
        NULL,
        'scheduled',
        v_client_id,
        'quote_accepted',
        jsonb_build_object(
          'agreed_price_cents', NEW.total_price_cents,
          'scheduled_for', NEW.proposed_start
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quote_accepted_create_job
AFTER UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.handle_quote_accepted_create_job();

-- -----------------------------------------------------------------------------
-- 4. Views de leitura seguras (`security_invoker = true`) — API_SPECIFICATION seção 2
-- -----------------------------------------------------------------------------

-- 4.1 my_jobs (visão para cliente e prestador do job, incluindo endereço liberado)
CREATE OR REPLACE VIEW public.my_jobs
WITH (security_invoker = true)
AS
SELECT
  j.id AS job_id,
  j.request_id,
  sr.title AS request_title,
  c.name AS category_name,
  n.name AS neighborhood_name,
  j.quote_id,
  j.client_id,
  split_part(btrim(pc.full_name), ' ', 1) AS client_first_name,
  j.provider_id,
  pp.display_name AS provider_display_name,
  j.scheduled_for,
  j.agreed_price_cents,
  j.status,
  j.completion_type,
  j.completion_note,
  j.completed_at,
  j.cancelled_by,
  j.cancel_reason,
  j.cancel_note,
  j.cancelled_at,
  j.is_late_cancellation,
  j.no_show_claimed_by,
  j.no_show_claimed_at,
  j.no_show_contest_deadline,
  j.disputed_at,
  j.dispute_outcome,
  j.dispute_deadline,
  j.reviews_reveal_at,
  j.reviews_open_until,
  j.client_address_released_at,
  srp.address_full,
  srp.address_notes,
  j.created_at
FROM public.jobs j
JOIN public.service_requests sr ON sr.id = j.request_id
JOIN public.categories c ON c.id = sr.category_id
JOIN public.neighborhoods n ON n.id = sr.neighborhood_id
JOIN public.profiles pc ON pc.id = j.client_id
JOIN public.provider_profiles pp ON pp.user_id = j.provider_id
LEFT JOIN public.service_request_private srp ON srp.request_id = j.request_id
WHERE j.client_id = auth.uid()
   OR j.provider_id = auth.uid();

GRANT SELECT ON public.my_jobs TO authenticated;

-- 4.2 public_reviews (somente avaliações publicadas, anonimizando autor se conta removida)
CREATE OR REPLACE VIEW public.public_reviews
WITH (security_invoker = true)
AS
SELECT
  r.id AS review_id,
  r.job_id,
  r.reviewee_id,
  r.reviewer_role,
  CASE
    WHEN p.status = 'deleted' OR p.deleted_at IS NOT NULL THEN 'Usuário removido'
    ELSE split_part(btrim(p.full_name), ' ', 1)
  END AS reviewer_display_name,
  r.rating,
  r.comment,
  r.revealed_at,
  r.created_at
FROM public.reviews r
JOIN public.profiles p ON p.id = r.reviewer_id
WHERE r.status = 'published';

GRANT SELECT ON public.public_reviews TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Recálculo de métricas do prestador (E6-06)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_provider_metrics(
  p_provider_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prov record;
  v_avg numeric(3,2);
  v_cnt integer;
  v_resp_min integer;
  v_late_30d integer;
BEGIN
  FOR v_prov IN
    SELECT user_id
    FROM public.provider_profiles
    WHERE p_provider_id IS NULL OR user_id = p_provider_id
  LOOP
    -- 1. Nota pública (somente avaliações 'published' feitas por clientes para este prestador)
    SELECT
      COALESCE(ROUND(AVG(r.rating)::numeric, 2), 0.00),
      COUNT(*)::integer
    INTO v_avg, v_cnt
    FROM public.reviews r
    WHERE r.reviewee_id = v_prov.user_id
      AND r.reviewer_role = 'client'
      AND r.status = 'published';

    -- 2. Tempo médio da 1ª proposta em minutos (últimos 90 dias)
    SELECT
      ROUND(
        AVG(EXTRACT(EPOCH FROM (q.first_sent_at - rm.notified_at)) / 60.0)
      )::integer
    INTO v_resp_min
    FROM public.quotes q
    JOIN public.request_matches rm
      ON rm.request_id = q.request_id
      AND rm.provider_id = q.provider_id
    WHERE q.provider_id = v_prov.user_id
      AND rm.notified_at IS NOT NULL
      AND q.first_sent_at >= rm.notified_at
      AND q.first_sent_at >= now() - interval '90 days';

    -- 3. Cancelamentos tardios pelo prestador nos últimos 30 dias
    SELECT COUNT(*)::integer
    INTO v_late_30d
    FROM public.jobs j
    WHERE j.provider_id = v_prov.user_id
      AND j.status = 'cancelled'
      AND j.cancelled_by = 'provider'
      AND j.is_late_cancellation = true
      AND j.cancelled_at >= now() - interval '30 days';

    UPDATE public.provider_profiles
    SET rating_avg = v_avg,
        rating_count = v_cnt,
        avg_first_response_minutes = v_resp_min,
        late_cancellations_30d = v_late_30d
    WHERE user_id = v_prov.user_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_provider_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_provider_metrics(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPCs de Ciclo de Vida do Serviço / Job (API_SPECIFICATION.md seção 3.3)
-- -----------------------------------------------------------------------------

-- 6.1 complete_job (prestador conclui serviço completo ou parcial a partir do horário — E6-03, DATABASE 5.4)
CREATE OR REPLACE FUNCTION public.complete_job(
  p_job_id uuid,
  p_completion_type public.completion_type DEFAULT 'full',
  p_completion_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.service_requests%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_dispute_days integer := 7;
  v_reveal_days integer := 7;
  v_review_open_days integer := 30;
  v_trimmed_note text := NULLIF(btrim(COALESCE(p_completion_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  -- Lock em ordem canônica: pedido -> job
  SELECT sr.* INTO v_req
  FROM public.service_requests sr
  JOIN public.jobs j ON j.request_id = sr.id
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Serviço não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.provider_id <> v_uid THEN
    RAISE EXCEPTION 'FORBIDDEN: Apenas o profissional contratado pode concluir o serviço.'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotência (DATABASE.md seção 5.4, item 8)
  IF v_job.status = 'completed' THEN
    RETURN jsonb_build_object(
      'job_id', v_job.id,
      'status', 'completed',
      'completion_type', v_job.completion_type,
      'reviews_reveal_at', v_job.reviews_reveal_at,
      'reviews_open_until', v_job.reviews_open_until
    );
  END IF;

  IF v_job.status <> 'scheduled' THEN
    RAISE EXCEPTION 'INVALID_STATE: O serviço não está no estado agendado.'
      USING ERRCODE = '22023';
  END IF;

  IF now() < v_job.scheduled_for THEN
    RAISE EXCEPTION 'JOB_TOO_EARLY: O serviço só pode ser marcado como concluído a partir do horário agendado.'
      USING ERRCODE = '22023';
  END IF;

  IF now() > v_job.scheduled_for + interval '7 days' THEN
    RAISE EXCEPTION 'JOB_TOO_LATE: O prazo de 7 dias após o agendamento para registrar conclusão expirou.'
      USING ERRCODE = '22023';
  END IF;

  IF p_completion_type = 'partial' AND (v_trimmed_note IS NULL OR char_length(v_trimmed_note) < 5) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Na conclusão parcial é obrigatório informar uma nota explicativa (mín. 5 caracteres).'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE((value #>> '{}')::integer, 7) INTO v_dispute_days
  FROM public.app_config WHERE key = 'dispute_window_days';

  SELECT COALESCE((value #>> '{}')::integer, 7) INTO v_reveal_days
  FROM public.app_config WHERE key = 'reviews_reveal_days';

  SELECT COALESCE((value #>> '{}')::integer, 30) INTO v_review_open_days
  FROM public.app_config WHERE key = 'review_window_days';

  UPDATE public.jobs
  SET status = 'completed',
      completion_type = p_completion_type,
      completion_note = v_trimmed_note,
      completed_at = now(),
      dispute_deadline = now() + make_interval(days => v_dispute_days),
      reviews_reveal_at = now() + make_interval(days => v_reveal_days),
      reviews_open_until = now() + make_interval(days => v_review_open_days)
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  UPDATE public.service_requests
  SET status = 'completed',
      closed_at = now()
  WHERE id = v_req.id;

  UPDATE public.provider_profiles
  SET completed_jobs_count = completed_jobs_count + 1
  WHERE user_id = v_uid;

  PERFORM public.record_status_event(
    'job',
    v_job.id,
    'scheduled',
    'completed',
    v_uid,
    p_completion_type::text,
    jsonb_build_object('completion_type', p_completion_type)
  );

  PERFORM public.record_status_event(
    'request',
    v_req.id,
    v_req.status::text,
    'completed',
    v_uid,
    NULL,
    '{}'::jsonb
  );

  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (
    v_job.client_id,
    'job_completed',
    jsonb_build_object('job_id', v_job.id, 'request_id', v_job.request_id)
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'status', 'completed',
    'completion_type', v_job.completion_type,
    'reviews_reveal_at', v_job.reviews_reveal_at,
    'reviews_open_until', v_job.reviews_open_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_job(uuid, public.completion_type, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid, public.completion_type, text) TO authenticated;

-- 6.2 cancel_job (cliente ou prestador cancela antes do horário agendado — E6-02)
CREATE OR REPLACE FUNCTION public.cancel_job(
  p_job_id uuid,
  p_cancel_reason public.cancel_reason,
  p_cancel_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.service_requests%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_role text;
  v_late_hours integer := 24;
  v_is_late boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT sr.* INTO v_req
  FROM public.service_requests sr
  JOIN public.jobs j ON j.request_id = sr.id
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Serviço não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_uid = v_job.client_id THEN
    v_role := 'client';
  ELSIF v_uid = v_job.provider_id THEN
    v_role := 'provider';
  ELSE
    RAISE EXCEPTION 'FORBIDDEN: Você não participa deste serviço.'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'job_id', v_job.id,
      'status', 'cancelled',
      'is_late_cancellation', v_job.is_late_cancellation
    );
  END IF;

  IF v_job.status <> 'scheduled' THEN
    RAISE EXCEPTION 'INVALID_STATE: Apenas serviços agendados podem ser cancelados.'
      USING ERRCODE = '22023';
  END IF;

  IF now() >= v_job.scheduled_for THEN
    RAISE EXCEPTION 'JOB_TOO_LATE: A partir do horário agendado não é possível cancelar; utilize conclusão, não comparecimento ou disputa.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE((value #>> '{}')::integer, 24) INTO v_late_hours
  FROM public.app_config WHERE key = 'late_cancellation_hours';

  v_is_late := (v_job.scheduled_for - now()) < make_interval(hours => v_late_hours);

  UPDATE public.jobs
  SET status = 'cancelled',
      cancelled_by = v_role,
      cancel_reason = p_cancel_reason,
      cancel_note = NULLIF(btrim(COALESCE(p_cancel_note, '')), ''),
      cancelled_at = now(),
      is_late_cancellation = v_is_late
  WHERE id = p_job_id;

  UPDATE public.service_requests
  SET status = 'cancelled',
      status_reason = 'job_cancelled',
      closed_at = now()
  WHERE id = v_req.id;

  UPDATE public.conversations
  SET status = 'read_only'
  WHERE request_id = v_req.id;

  IF v_role = 'provider' AND v_is_late THEN
    PERFORM public.refresh_provider_metrics(v_job.provider_id);
  END IF;

  PERFORM public.record_status_event(
    'job',
    v_job.id,
    'scheduled',
    'cancelled',
    v_uid,
    p_cancel_reason::text,
    jsonb_build_object('cancelled_by', v_role, 'is_late_cancellation', v_is_late)
  );

  PERFORM public.record_status_event(
    'request',
    v_req.id,
    v_req.status::text,
    'cancelled',
    v_uid,
    'job_cancelled',
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'status', 'cancelled',
    'cancelled_by', v_role,
    'is_late_cancellation', v_is_late
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_job(uuid, public.cancel_reason, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_job(uuid, public.cancel_reason, text) TO authenticated;

-- 6.3 report_no_show, withdraw_no_show_claim e respond_no_show (E6-07)
CREATE OR REPLACE FUNCTION public.report_no_show(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_role text;
  v_after_min integer := 30;
  v_contest_hours integer := 48;
  v_deadline timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Serviço não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_uid = v_job.client_id THEN
    v_role := 'client';
  ELSIF v_uid = v_job.provider_id THEN
    v_role := 'provider';
  ELSE
    RAISE EXCEPTION 'FORBIDDEN: Você não participa deste serviço.'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.status <> 'scheduled' THEN
    RAISE EXCEPTION 'INVALID_STATE: O serviço não está elegível para reporte de não comparecimento.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE((value #>> '{}')::integer, 30) INTO v_after_min
  FROM public.app_config WHERE key = 'no_show_claim_after_minutes';

  SELECT COALESCE((value #>> '{}')::integer, 48) INTO v_contest_hours
  FROM public.app_config WHERE key = 'no_show_contest_hours';

  IF now() < v_job.scheduled_for + make_interval(mins => v_after_min) THEN
    RAISE EXCEPTION 'JOB_TOO_EARLY: Aguarde pelo menos % minutos após o horário agendado para reportar não comparecimento.', v_after_min
      USING ERRCODE = '22023';
  END IF;

  IF now() > v_job.scheduled_for + interval '72 hours' THEN
    RAISE EXCEPTION 'JOB_TOO_LATE: O prazo de 72 horas para reportar não comparecimento expirou.'
      USING ERRCODE = '22023';
  END IF;

  v_deadline := now() + make_interval(hours => v_contest_hours);

  UPDATE public.jobs
  SET status = 'no_show_claimed',
      no_show_claimed_by = v_role,
      no_show_claimed_at = now(),
      no_show_contest_deadline = v_deadline
  WHERE id = p_job_id;

  PERFORM public.record_status_event(
    'job',
    v_job.id,
    'scheduled',
    'no_show_claimed',
    v_uid,
    'no_show_reported',
    jsonb_build_object('claimed_by', v_role, 'contest_deadline', v_deadline)
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'status', 'no_show_claimed',
    'claimed_by', v_role,
    'no_show_contest_deadline', v_deadline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_no_show(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_no_show(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_no_show_claim(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Serviço não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  v_role := CASE
    WHEN v_uid = v_job.client_id THEN 'client'
    WHEN v_uid = v_job.provider_id THEN 'provider'
    ELSE NULL
  END;

  IF v_job.status <> 'no_show_claimed' OR v_job.no_show_claimed_by IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Apenas quem registrou o não comparecimento pode retirar a acusação enquanto pendente.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.jobs
  SET status = 'scheduled',
      no_show_claimed_by = NULL,
      no_show_claimed_at = NULL,
      no_show_contest_deadline = NULL
  WHERE id = p_job_id;

  PERFORM public.record_status_event(
    'job',
    v_job.id,
    'no_show_claimed',
    'scheduled',
    v_uid,
    'claim_withdrawn',
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'status', 'scheduled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_no_show_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_no_show_claim(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_no_show(
  p_job_id uuid,
  p_contest_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  IF char_length(btrim(COALESCE(p_contest_note, ''))) < 5 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Explique o motivo da contestação (mín. 5 caracteres).'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Serviço não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  v_role := CASE
    WHEN v_uid = v_job.client_id THEN 'client'
    WHEN v_uid = v_job.provider_id THEN 'provider'
    ELSE NULL
  END;

  IF v_role IS NULL OR v_job.status <> 'no_show_claimed' OR v_job.no_show_claimed_by = v_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Apenas a parte acusada pode contestar o não comparecimento.'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.no_show_contest_deadline IS NOT NULL AND now() > v_job.no_show_contest_deadline THEN
    RAISE EXCEPTION 'JOB_TOO_LATE: O prazo de 48 horas para contestar expirou.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.jobs
  SET status = 'disputed',
      disputed_at = now()
  WHERE id = p_job_id;

  PERFORM public.record_status_event(
    'job',
    v_job.id,
    'no_show_claimed',
    'disputed',
    v_uid,
    'no_show_contested',
    jsonb_build_object('contest_note', btrim(p_contest_note))
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'status', 'disputed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_no_show(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_no_show(uuid, text) TO authenticated;

-- 6.4 open_dispute (cliente ou prestador abre disputa em até 7 dias — E6-08)
CREATE OR REPLACE FUNCTION public.open_dispute(
  p_job_id uuid,
  p_reason public.report_reason,
  p_details text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR (v_uid <> v_job.client_id AND v_uid <> v_job.provider_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: Serviço não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status = 'disputed' THEN
    RETURN jsonb_build_object('job_id', v_job.id, 'status', 'disputed');
  END IF;

  IF v_job.status NOT IN ('scheduled', 'completed') THEN
    RAISE EXCEPTION 'INVALID_STATE: Não é possível abrir disputa neste estado do serviço.'
      USING ERRCODE = '22023';
  END IF;

  IF now() < v_job.scheduled_for THEN
    RAISE EXCEPTION 'JOB_TOO_EARLY: Antes do horário agendado, utilize o cancelamento.'
      USING ERRCODE = '22023';
  END IF;

  IF v_job.status = 'completed' AND v_job.dispute_deadline IS NOT NULL AND now() > v_job.dispute_deadline THEN
    RAISE EXCEPTION 'JOB_TOO_LATE: O prazo de 7 dias após a conclusão para abrir disputa expirou.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.jobs
  SET status = 'disputed',
      disputed_at = now()
  WHERE id = p_job_id;

  PERFORM public.record_status_event(
    'job',
    v_job.id,
    v_job.status::text,
    'disputed',
    v_uid,
    p_reason::text,
    jsonb_build_object('details', NULLIF(btrim(COALESCE(p_details, '')), ''))
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'status', 'disputed',
    'reason', p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_dispute(uuid, public.report_reason, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_dispute(uuid, public.report_reason, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Avaliações Bilaterais com Revelação Simultânea (E6-04, E6-05, DATABASE 5.5)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_review(
  p_job_id uuid,
  p_rating integer,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_reviewer_role text;
  v_reviewee_id uuid;
  v_review_id uuid;
  v_total_reviews integer := 0;
  v_revealed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: A nota deve ser de 1 a 5 estrelas.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Serviço não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_uid = v_job.client_id THEN
    v_reviewer_role := 'client';
    v_reviewee_id := v_job.provider_id;
  ELSIF v_uid = v_job.provider_id THEN
    v_reviewer_role := 'provider';
    v_reviewee_id := v_job.client_id;
  ELSE
    RAISE EXCEPTION 'FORBIDDEN: Você não participou deste serviço.'
      USING ERRCODE = '42501';
  END IF;

  -- Avaliações só são permitidas em job 'completed' ou 'no_show' confirmado (nunca em disputed ou cancelled)
  IF v_job.status NOT IN ('completed', 'no_show') THEN
    RAISE EXCEPTION 'INVALID_STATE: Avaliações só estão disponíveis para serviços concluídos ou não comparecimento confirmado.'
      USING ERRCODE = '22023';
  END IF;

  IF v_job.reviews_open_until IS NOT NULL AND now() > v_job.reviews_open_until THEN
    RAISE EXCEPTION 'JOB_TOO_LATE: O prazo de 30 dias para avaliar este serviço expirou.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reviews
    WHERE job_id = p_job_id
      AND reviewer_id = v_uid
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Você já enviou sua avaliação para este serviço.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.reviews (
    job_id,
    reviewer_id,
    reviewee_id,
    reviewer_role,
    rating,
    comment,
    status
  )
  VALUES (
    p_job_id,
    v_uid,
    v_reviewee_id,
    v_reviewer_role,
    p_rating::smallint,
    NULLIF(btrim(COALESCE(p_comment, '')), ''),
    'pending_reveal'
  )
  RETURNING id INTO v_review_id;

  -- Verificar condição de revelação simultânea:
  -- (A) Ambas as partes já enviaram avaliação para este job OU
  -- (B) O prazo de 7 dias (reviews_reveal_at) já passou
  SELECT COUNT(*)::integer INTO v_total_reviews
  FROM public.reviews
  WHERE job_id = p_job_id
    AND status IN ('pending_reveal', 'published');

  IF v_total_reviews >= 2 OR (v_job.reviews_reveal_at IS NOT NULL AND now() >= v_job.reviews_reveal_at) THEN
    UPDATE public.reviews
    SET status = 'published',
        revealed_at = COALESCE(revealed_at, now())
    WHERE job_id = p_job_id
      AND status = 'pending_reveal';

    v_revealed := true;
    PERFORM public.refresh_provider_metrics(v_job.provider_id);
  END IF;

  RETURN jsonb_build_object(
    'review_id', v_review_id,
    'job_id', p_job_id,
    'status', CASE WHEN v_revealed THEN 'published' ELSE 'pending_reveal' END,
    'revealed_simultaneously', v_revealed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, integer, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Jobs agendados de consolidação da Fase 4 (confirm_no_show, job_no_outcome, reveal_reviews)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_job_and_review_timers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job record;
  v_confirmed_no_shows integer := 0;
  v_no_outcome_jobs integer := 0;
  v_revealed_reviews integer := 0;
  v_rows integer := 0;
BEGIN
  -- 1. Confirmar no_show_claimed cujo prazo de 48h de contestação venceu -> no_show
  FOR v_job IN
    SELECT id, request_id
    FROM public.jobs
    WHERE status = 'no_show_claimed'
      AND no_show_contest_deadline <= now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.jobs
    SET status = 'no_show',
        reviews_reveal_at = now() + interval '7 days',
        reviews_open_until = now() + interval '30 days'
    WHERE id = v_job.id;

    UPDATE public.service_requests
    SET status = 'cancelled',
        status_reason = 'job_no_show',
        closed_at = now()
    WHERE id = v_job.request_id;

    UPDATE public.conversations
    SET status = 'read_only'
    WHERE request_id = v_job.request_id;

    PERFORM public.record_status_event(
      'job',
      v_job.id,
      'no_show_claimed',
      'no_show',
      NULL,
      'contest_deadline_expired',
      '{}'::jsonb
    );

    v_confirmed_no_shows := v_confirmed_no_shows + 1;
  END LOOP;

  -- 2. Encerrar jobs scheduled sem desfecho 7 dias após o horário -> cancelled (no_outcome)
  FOR v_job IN
    SELECT id, request_id
    FROM public.jobs
    WHERE status = 'scheduled'
      AND scheduled_for + interval '7 days' <= now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.jobs
    SET status = 'cancelled',
        cancelled_by = 'system',
        cancelled_at = now()
    WHERE id = v_job.id;

    UPDATE public.service_requests
    SET status = 'cancelled',
        status_reason = 'no_outcome',
        closed_at = now()
    WHERE id = v_job.request_id;

    UPDATE public.conversations
    SET status = 'read_only'
    WHERE request_id = v_job.request_id;

    PERFORM public.record_status_event(
      'job',
      v_job.id,
      'scheduled',
      'cancelled',
      NULL,
      'no_outcome',
      '{}'::jsonb
    );

    v_no_outcome_jobs := v_no_outcome_jobs + 1;
  END LOOP;

  -- 3. Revelar avaliações pending_reveal cujo reviews_reveal_at já chegou (7 dias)
  FOR v_job IN
    SELECT DISTINCT j.id, j.provider_id
    FROM public.jobs j
    JOIN public.reviews r ON r.job_id = j.id
    WHERE j.status IN ('completed', 'no_show')
      AND j.reviews_reveal_at <= now()
      AND r.status = 'pending_reveal'
    ORDER BY j.id
  LOOP
    UPDATE public.reviews
    SET status = 'published',
        revealed_at = now()
    WHERE job_id = v_job.id
      AND status = 'pending_reveal';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_revealed_reviews := v_revealed_reviews + v_rows;

    PERFORM public.refresh_provider_metrics(v_job.provider_id);
  END LOOP;

  -- 4. Arquivar conversas de jobs concluídos cujo dispute_deadline já passou
  UPDATE public.conversations c
  SET status = 'read_only'
  FROM public.jobs j
  WHERE j.request_id = c.request_id
    AND j.status = 'completed'
    AND j.dispute_deadline <= now()
    AND c.status = 'open';

  RETURN jsonb_build_object(
    'confirmed_no_shows', v_confirmed_no_shows,
    'no_outcome_jobs', v_no_outcome_jobs,
    'revealed_reviews', v_revealed_reviews
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_job_and_review_timers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_job_and_review_timers() TO authenticated;
