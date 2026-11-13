-- =============================================================================
-- Fase 2 — Pedidos, Elegibilidade, Despacho em Lotes e Propostas (E3 + E4)
-- Fonte oficial: docs/DATABASE.md (seções 3.3, 4, 5.1, 5.2, 6, 7, 9),
--                docs/ARCHITECTURE.md (seção 6) e docs/API_SPECIFICATION.md (seção 3)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Função transversal de interação e bloqueio (DATABASE.md seção 6 / ADR-13)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_interact(
  p_user_a uuid,
  p_user_b uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_count integer;
  v_blocked boolean := false;
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL THEN
    RETURN false;
  END IF;

  -- Verifica se ambos os perfis existem, estão ativos e não foram excluídos
  SELECT COUNT(*)
  INTO v_active_count
  FROM public.profiles p
  WHERE p.id IN (p_user_a, p_user_b)
    AND p.status = 'active'
    AND p.deleted_at IS NULL;

  IF p_user_a = p_user_b THEN
    IF v_active_count < 1 THEN
      RETURN false;
    END IF;
  ELSE
    IF v_active_count < 2 THEN
      RETURN false;
    END IF;
  END IF;

  -- Verifica bloqueio bilateral se a tabela user_blocks já existir (criada na Fase 5 ou antes)
  IF to_regclass('public.user_blocks') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1
         FROM public.user_blocks ub
         WHERE (ub.blocker_id = $1 AND ub.blocked_id = $2)
            OR (ub.blocker_id = $2 AND ub.blocked_id = $1)
       )'
    INTO v_blocked
    USING p_user_a, p_user_b;

    IF v_blocked THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.can_interact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_interact(uuid, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Função de avaliação do Gate de Ativação de Categoria (PRD seção 12, G1..G3)
--    Gate aprovado pelo proprietário: >= 2 prestadores aprovados e disponíveis
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_category_gate_status(p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_min_approved integer := 2;
  v_approved_count integer := 0;
  v_available_count integer := 0;
  v_overdue_pending_count integer := 0;
BEGIN
  SELECT COALESCE((value #>> '{}')::integer, 2)
  INTO v_min_approved
  FROM public.app_config
  WHERE key = 'category_gate_min_approved';

  -- G1: Prestadores aprovados e ativos na categoria
  SELECT COUNT(*)
  INTO v_approved_count
  FROM public.provider_categories pc
  JOIN public.provider_profiles pp ON pp.user_id = pc.provider_id
  JOIN public.profiles pr ON pr.id = pp.user_id
  WHERE pc.category_id = p_category_id
    AND pp.verification_status = 'approved'
    AND pr.status = 'active'
    AND pr.deleted_at IS NULL;

  -- G2: Prestadores aprovados, não pausados e com >= 1 regra de disponibilidade
  SELECT COUNT(*)
  INTO v_available_count
  FROM public.provider_categories pc
  JOIN public.provider_profiles pp ON pp.user_id = pc.provider_id
  JOIN public.profiles pr ON pr.id = pp.user_id
  WHERE pc.category_id = p_category_id
    AND pp.verification_status = 'approved'
    AND pp.is_paused = false
    AND pr.status = 'active'
    AND pr.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.availability_rules ar
      WHERE ar.provider_id = pp.user_id
    );

  -- G3: Submissões pendentes há mais de 48h na categoria
  SELECT COUNT(*)
  INTO v_overdue_pending_count
  FROM public.verification_submissions vs
  JOIN public.provider_categories pc ON pc.provider_id = vs.provider_id
  WHERE pc.category_id = p_category_id
    AND vs.status = 'pending'
    AND vs.submitted_at < now() - interval '48 hours';

  RETURN jsonb_build_object(
    'category_id', p_category_id,
    'min_required_approved', v_min_approved,
    'approved_providers_count', v_approved_count,
    'available_providers_count', v_available_count,
    'overdue_verifications_count', v_overdue_pending_count,
    'gate_passed', (
      v_approved_count >= v_min_approved
      AND v_available_count >= v_min_approved
      AND v_overdue_pending_count = 0
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_category_gate_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_category_gate_status(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Tabelas da Fase 2 (DATABASE.md seção 3.3 e 3.6)
-- -----------------------------------------------------------------------------

-- 3.1 service_requests
CREATE TABLE public.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  neighborhood_id uuid NOT NULL REFERENCES public.neighborhoods(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 5 AND 80),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 15 AND 1000),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL CHECK (window_end >= window_start),
  status public.request_status NOT NULL DEFAULT 'open',
  status_reason public.request_status_reason,
  max_quotes integer NOT NULL DEFAULT 5 CHECK (max_quotes BETWEEN 1 AND 10),
  active_quotes_count integer NOT NULL DEFAULT 0 CHECK (active_quotes_count >= 0 AND active_quotes_count <= max_quotes),
  expires_at timestamptz NOT NULL,
  hired_quote_id uuid,
  dispatch_state text NOT NULL DEFAULT 'pending' CHECK (dispatch_state IN ('pending', 'dispatching', 'done')),
  closed_at timestamptz,
  client_notify_when_available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_requests_client_created
  ON public.service_requests (client_id, created_at DESC);

CREATE INDEX idx_service_requests_category_id
  ON public.service_requests (category_id);

CREATE INDEX idx_service_requests_neighborhood_id
  ON public.service_requests (neighborhood_id);

CREATE INDEX idx_service_requests_expires_open
  ON public.service_requests (expires_at)
  WHERE status IN ('open', 'quotes_closed');

CREATE INDEX idx_service_requests_hired_quote_id
  ON public.service_requests (hired_quote_id)
  WHERE hired_quote_id IS NOT NULL;

CREATE TRIGGER trg_service_requests_updated_at
BEFORE UPDATE ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_requests FROM anon, authenticated;
GRANT SELECT ON public.service_requests TO authenticated;

-- 3.2 service_request_private (endereço completo protegido — RF-22, T-RLS-04)
CREATE TABLE public.service_request_private (
  request_id uuid PRIMARY KEY REFERENCES public.service_requests(id) ON DELETE CASCADE,
  address_full text NOT NULL CHECK (char_length(btrim(address_full)) BETWEEN 8 AND 250),
  address_notes text CHECK (address_notes IS NULL OR char_length(address_notes) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_service_request_private_updated_at
BEFORE UPDATE ON public.service_request_private
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.service_request_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_private FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_request_private FROM anon, authenticated;
GRANT SELECT ON public.service_request_private TO authenticated;

-- 3.3 request_media (fotos do pedido — máx. 5)
CREATE TABLE public.request_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (char_length(storage_path) BETWEEN 5 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_request_media_request_id
  ON public.request_media (request_id);

ALTER TABLE public.request_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_media FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_media FROM anon, authenticated;
GRANT SELECT ON public.request_media TO authenticated;

-- 3.4 request_matches (fonte única de visibilidade do pedido para prestadores — RF-16, RF-34)
CREATE TABLE public.request_matches (
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE CASCADE,
  batch_no integer NOT NULL CHECK (batch_no >= 1),
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_notify_at timestamptz NOT NULL,
  notified_at timestamptz,
  seen_at timestamptz,
  dismissed_at timestamptz,
  quoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, provider_id)
);

CREATE INDEX idx_request_matches_provider_notified
  ON public.request_matches (provider_id, notified_at DESC);

CREATE INDEX idx_request_matches_request_batch
  ON public.request_matches (request_id, batch_no);

CREATE INDEX idx_request_matches_provider_visible
  ON public.request_matches (provider_id)
  WHERE notified_at IS NOT NULL;

CREATE INDEX idx_request_matches_pending_dispatch
  ON public.request_matches (scheduled_notify_at)
  WHERE notified_at IS NULL;

ALTER TABLE public.request_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_matches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_matches FROM anon, authenticated;
GRANT SELECT ON public.request_matches TO authenticated;

-- 3.5 quotes (propostas enviadas pelos prestadores — valores em centavos inteiros)
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE RESTRICT,
  total_price_cents integer NOT NULL CHECK (total_price_cents > 0 AND total_price_cents <= 5000000),
  visit_fee_cents integer NOT NULL DEFAULT 0 CHECK (visit_fee_cents >= 0 AND visit_fee_cents <= 500000),
  includes_description text NOT NULL CHECK (char_length(btrim(includes_description)) BETWEEN 10 AND 500),
  proposed_start timestamptz NOT NULL,
  estimated_duration_minutes integer CHECK (
    estimated_duration_minutes IS NULL
    OR (estimated_duration_minutes > 0 AND estimated_duration_minutes <= 1440)
  ),
  valid_until timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision IN (0, 1)),
  status public.quote_status NOT NULL DEFAULT 'sent',
  status_reason public.quote_status_reason,
  first_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, provider_id)
);

-- FK circular opcional de service_requests.hired_quote_id -> quotes.id
ALTER TABLE public.service_requests
  ADD CONSTRAINT fk_service_requests_hired_quote
  FOREIGN KEY (hired_quote_id) REFERENCES public.quotes(id) ON DELETE SET NULL;

-- No máximo UMA proposta aceita por pedido (DATABASE.md seção 4, regra 3)
CREATE UNIQUE INDEX idx_quotes_one_accepted_per_request
  ON public.quotes (request_id)
  WHERE status = 'accepted';

CREATE INDEX idx_quotes_request_id
  ON public.quotes (request_id);

CREATE INDEX idx_quotes_provider_created
  ON public.quotes (provider_id, created_at DESC);

CREATE INDEX idx_quotes_sent_valid_until
  ON public.quotes (status, valid_until)
  WHERE status = 'sent';

CREATE TRIGGER trg_quotes_updated_at
BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.quotes FROM anon, authenticated;
GRANT SELECT ON public.quotes TO authenticated;

-- 3.6 unserved_demand (demanda não atendida + opção "Avise-me" — E3-03)
CREATE TABLE public.unserved_demand (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  neighborhood_id uuid NOT NULL REFERENCES public.neighborhoods(id) ON DELETE RESTRICT,
  request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  notify_when_available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_unserved_demand_category_id
  ON public.unserved_demand (category_id);

CREATE INDEX idx_unserved_demand_neighborhood_id
  ON public.unserved_demand (neighborhood_id);

CREATE INDEX idx_unserved_demand_request_id
  ON public.unserved_demand (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.unserved_demand ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unserved_demand FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.unserved_demand FROM anon, authenticated;
GRANT SELECT ON public.unserved_demand TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Políticas RLS da Fase 2 (DATABASE.md seção 7)
-- -----------------------------------------------------------------------------

-- 4.1 request_matches: somente o prestador notificado ou admin lê; cliente NUNCA lê
CREATE POLICY request_matches_select_provider_or_admin
  ON public.request_matches
  FOR SELECT
  TO authenticated
  USING (
    (provider_id = auth.uid() AND notified_at IS NOT NULL)
    OR public.is_admin()
  );

-- 4.2 service_requests: cliente dono, prestador com match notificado/cotação/contratado, ou admin
CREATE POLICY service_requests_select_owner_matched_or_admin
  ON public.service_requests
  FOR SELECT
  TO authenticated
  USING (
    client_id = auth.uid()
    OR public.is_admin()
    OR (
      public.can_interact(client_id, auth.uid())
      AND (
        EXISTS (
          SELECT 1
          FROM public.request_matches rm
          WHERE rm.request_id = service_requests.id
            AND rm.provider_id = auth.uid()
            AND rm.notified_at IS NOT NULL
            AND rm.dismissed_at IS NULL
            AND service_requests.status IN ('open', 'quotes_closed')
        )
        OR EXISTS (
          SELECT 1
          FROM public.quotes q
          WHERE q.request_id = service_requests.id
            AND q.provider_id = auth.uid()
        )
      )
    )
  );

-- 4.3 service_request_private: SOMENTE cliente dono ou prestador da proposta aceita (hired/completed)
CREATE POLICY service_request_private_select_owner_or_hired_provider
  ON public.service_request_private
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_requests sr
      WHERE sr.id = service_request_private.request_id
        AND (
          sr.client_id = auth.uid()
          OR (
            sr.status IN ('hired', 'completed')
            AND sr.hired_quote_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.quotes q
              WHERE q.id = sr.hired_quote_id
                AND q.provider_id = auth.uid()
                AND q.status = 'accepted'
            )
          )
        )
    )
  );

-- 4.4 request_media: cliente dono ou prestador com match ativo / contratado
CREATE POLICY request_media_select_owner_or_matched_provider
  ON public.request_media
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_requests sr
      WHERE sr.id = request_media.request_id
        AND (
          sr.client_id = auth.uid()
          OR (
            public.can_interact(sr.client_id, auth.uid())
            AND (
              (
                sr.status IN ('open', 'quotes_closed')
                AND EXISTS (
                  SELECT 1
                  FROM public.request_matches rm
                  WHERE rm.request_id = sr.id
                    AND rm.provider_id = auth.uid()
                    AND rm.notified_at IS NOT NULL
                    AND rm.dismissed_at IS NULL
                )
              )
              OR (
                sr.status IN ('hired', 'completed')
                AND EXISTS (
                  SELECT 1
                  FROM public.quotes q
                  WHERE q.id = sr.hired_quote_id
                    AND q.provider_id = auth.uid()
                    AND q.status = 'accepted'
                )
              )
            )
          )
        )
    )
  );

-- 4.5 quotes: prestador autor da proposta, cliente dono do pedido ou admin
CREATE POLICY quotes_select_owner_client_or_admin
  ON public.quotes
  FOR SELECT
  TO authenticated
  USING (
    provider_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.service_requests sr
      WHERE sr.id = quotes.request_id
        AND sr.client_id = auth.uid()
    )
  );

-- 4.6 unserved_demand: somente admin lê (clientes gravam via RPC)
CREATE POLICY unserved_demand_select_admin
  ON public.unserved_demand
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Atualizar política de status_events para permitir que participantes de pedidos/propostas leiam seus eventos
DROP POLICY IF EXISTS status_events_select_admin ON public.status_events;
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
-- 5. Views de leitura seguras (`security_invoker = true`) — API_SPECIFICATION seção 2
-- -----------------------------------------------------------------------------

-- 5.1 my_requests (visão do cliente)
CREATE OR REPLACE VIEW public.my_requests
WITH (security_invoker = true)
AS
SELECT
  sr.id,
  sr.client_id,
  sr.category_id,
  c.name AS category_name,
  c.slug AS category_slug,
  sr.neighborhood_id,
  n.name AS neighborhood_name,
  sr.title,
  sr.description,
  sr.window_start,
  sr.window_end,
  sr.status,
  sr.status_reason,
  sr.max_quotes,
  sr.active_quotes_count,
  (sr.max_quotes - sr.active_quotes_count) AS remaining_quote_slots,
  sr.expires_at,
  sr.hired_quote_id,
  sr.client_notify_when_available,
  sr.created_at,
  sr.closed_at
FROM public.service_requests sr
JOIN public.categories c ON c.id = sr.category_id
JOIN public.neighborhoods n ON n.id = sr.neighborhood_id
WHERE sr.client_id = auth.uid();

GRANT SELECT ON public.my_requests TO authenticated;

-- 5.2 incoming_requests (visão do prestador — sem endereço completo nem telefone do cliente)
CREATE OR REPLACE VIEW public.incoming_requests
WITH (security_invoker = true)
AS
SELECT
  sr.id AS request_id,
  sr.category_id,
  c.name AS category_name,
  c.slug AS category_slug,
  sr.neighborhood_id,
  n.name AS neighborhood_name,
  n.zone AS neighborhood_zone,
  split_part(btrim(p.full_name), ' ', 1) AS client_first_name,
  sr.title,
  sr.description,
  sr.window_start,
  sr.window_end,
  sr.status,
  sr.max_quotes,
  sr.active_quotes_count,
  GREATEST(sr.max_quotes - sr.active_quotes_count, 0) AS remaining_quote_slots,
  sr.expires_at,
  rm.batch_no,
  rm.notified_at,
  rm.seen_at,
  rm.dismissed_at,
  rm.quoted_at,
  sr.created_at
FROM public.service_requests sr
JOIN public.request_matches rm
  ON rm.request_id = sr.id
  AND rm.provider_id = auth.uid()
JOIN public.categories c ON c.id = sr.category_id
JOIN public.neighborhoods n ON n.id = sr.neighborhood_id
JOIN public.profiles p ON p.id = sr.client_id
WHERE rm.notified_at IS NOT NULL
  AND rm.dismissed_at IS NULL
  AND public.can_interact(sr.client_id, auth.uid());

GRANT SELECT ON public.incoming_requests TO authenticated;

-- 5.3 quotes_for_my_request (visão do cliente para comparar propostas lado a lado)
CREATE OR REPLACE VIEW public.quotes_for_my_request
WITH (security_invoker = true)
AS
SELECT
  q.id AS quote_id,
  q.request_id,
  q.provider_id,
  pp.display_name AS provider_display_name,
  pp.rating_avg AS provider_rating_avg,
  pp.rating_count AS provider_rating_count,
  pp.completed_jobs_count AS provider_completed_jobs_count,
  pp.avg_first_response_minutes AS provider_avg_response_minutes,
  pp.experience_years AS provider_experience_years,
  'Identidade verificada'::text AS verification_badge_label,
  q.total_price_cents,
  q.visit_fee_cents,
  q.includes_description,
  q.proposed_start,
  q.estimated_duration_minutes,
  LEAST(q.valid_until, sr.expires_at) AS effective_valid_until,
  q.revision,
  q.status,
  q.status_reason,
  q.first_sent_at,
  q.updated_at
FROM public.quotes q
JOIN public.service_requests sr ON sr.id = q.request_id
JOIN public.provider_profiles pp ON pp.user_id = q.provider_id
WHERE sr.client_id = auth.uid();

GRANT SELECT ON public.quotes_for_my_request TO authenticated;

-- 5.4 my_quotes (visão do prestador das suas propostas enviadas)
CREATE OR REPLACE VIEW public.my_quotes
WITH (security_invoker = true)
AS
SELECT
  q.id AS quote_id,
  q.request_id,
  sr.title AS request_title,
  sr.status AS request_status,
  q.provider_id,
  q.total_price_cents,
  q.visit_fee_cents,
  q.includes_description,
  q.proposed_start,
  q.estimated_duration_minutes,
  LEAST(q.valid_until, sr.expires_at) AS effective_valid_until,
  q.revision,
  q.status,
  q.status_reason,
  q.first_sent_at,
  q.updated_at
FROM public.quotes q
JOIN public.service_requests sr ON sr.id = q.request_id
WHERE q.provider_id = auth.uid();

GRANT SELECT ON public.my_quotes TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPCs de Expiração Preguiçosa / Cron e Despacho em Lotes (DATABASE.md seção 5)
-- -----------------------------------------------------------------------------

-- 6.1 expire_overdue_requests_and_quotes (expiração preguiçosa + cron idempotente)
CREATE OR REPLACE FUNCTION public.expire_overdue_requests_and_quotes(
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req record;
  v_quote record;
  v_expired_requests integer := 0;
  v_expired_quotes integer := 0;
BEGIN
  -- 1. Expirar pedidos cujo prazo de 48h já venceu (open / quotes_closed -> expired)
  FOR v_req IN
    SELECT id, status
    FROM public.service_requests
    WHERE status IN ('open', 'quotes_closed')
      AND expires_at <= now()
      AND (p_request_id IS NULL OR id = p_request_id)
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.service_requests
    SET status = 'expired',
        status_reason = 'no_acceptance_in_time',
        dispatch_state = 'done',
        closed_at = now()
    WHERE id = v_req.id;

    PERFORM public.record_status_event(
      'request',
      v_req.id,
      v_req.status::text,
      'expired',
      NULL,
      'no_acceptance_in_time',
      '{}'::jsonb
    );

    -- Expirar todas as propostas 'sent' vinculadas a este pedido
    FOR v_quote IN
      SELECT id
      FROM public.quotes
      WHERE request_id = v_req.id
        AND status = 'sent'
      ORDER BY id
      FOR UPDATE
    LOOP
      UPDATE public.quotes
      SET status = 'expired',
          status_reason = 'request_expired'
      WHERE id = v_quote.id;

      PERFORM public.record_status_event(
        'quote',
        v_quote.id,
        'sent',
        'expired',
        NULL,
        'request_expired',
        '{}'::jsonb
      );

      v_expired_quotes := v_expired_quotes + 1;
    END LOOP;

    UPDATE public.service_requests
    SET active_quotes_count = 0
    WHERE id = v_req.id;

    v_expired_requests := v_expired_requests + 1;
  END LOOP;

  -- 2. Expirar propostas individuais com valid_until vencido em pedidos ainda dentro do prazo
  FOR v_req IN
    SELECT sr.id, sr.status, sr.max_quotes, sr.expires_at
    FROM public.service_requests sr
    WHERE sr.status IN ('open', 'quotes_closed')
      AND sr.expires_at > now()
      AND (p_request_id IS NULL OR sr.id = p_request_id)
      AND EXISTS (
        SELECT 1
        FROM public.quotes q
        WHERE q.request_id = sr.id
          AND q.status = 'sent'
          AND q.valid_until <= now()
      )
    ORDER BY sr.id
    FOR UPDATE SKIP LOCKED
  LOOP
    FOR v_quote IN
      SELECT id
      FROM public.quotes
      WHERE request_id = v_req.id
        AND status = 'sent'
        AND valid_until <= now()
      ORDER BY id
      FOR UPDATE
    LOOP
      UPDATE public.quotes
      SET status = 'expired',
          status_reason = 'validity_expired'
      WHERE id = v_quote.id;

      PERFORM public.record_status_event(
        'quote',
        v_quote.id,
        'sent',
        'expired',
        NULL,
        'validity_expired',
        '{}'::jsonb
      );

      v_expired_quotes := v_expired_quotes + 1;
    END LOOP;

    -- Recalcular active_quotes_count e reabrir pedido se estava quotes_closed
    UPDATE public.service_requests sr
    SET active_quotes_count = (
          SELECT COUNT(*)
          FROM public.quotes q
          WHERE q.request_id = v_req.id
            AND q.status IN ('sent', 'accepted')
        ),
        status = CASE
          WHEN sr.status = 'quotes_closed'
            AND (
              SELECT COUNT(*)
              FROM public.quotes q
              WHERE q.request_id = v_req.id
                AND q.status IN ('sent', 'accepted')
            ) < sr.max_quotes
          THEN 'open'::public.request_status
          ELSE sr.status
        END
    WHERE sr.id = v_req.id;
  END LOOP;

  RETURN jsonb_build_object(
    'expired_requests', v_expired_requests,
    'expired_quotes', v_expired_quotes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_overdue_requests_and_quotes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_overdue_requests_and_quotes(uuid) TO authenticated;

-- 6.2 dispatch_next_batch (notifica próximos lotes de pedidos open com vagas)
CREATE OR REPLACE FUNCTION public.dispatch_next_batch(
  p_request_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req record;
  v_next_batch integer;
  v_notified_count integer := 0;
  v_rows integer := 0;
BEGIN
  FOR v_req IN
    SELECT id, active_quotes_count, max_quotes, expires_at
    FROM public.service_requests
    WHERE status = 'open'
      AND expires_at > now()
      AND active_quotes_count < max_quotes
      AND (p_request_id IS NULL OR id = p_request_id)
      AND EXISTS (
        SELECT 1
        FROM public.request_matches rm
        WHERE rm.request_id = service_requests.id
          AND rm.notified_at IS NULL
          AND rm.scheduled_notify_at <= now()
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT MIN(batch_no)
    INTO v_next_batch
    FROM public.request_matches
    WHERE request_id = v_req.id
      AND notified_at IS NULL
      AND scheduled_notify_at <= now();

    IF v_next_batch IS NOT NULL THEN
      UPDATE public.request_matches
      SET notified_at = now()
      WHERE request_id = v_req.id
        AND batch_no = v_next_batch
        AND notified_at IS NULL;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_notified_count := v_notified_count + v_rows;
    END IF;

    -- Se não restam mais matches pendentes, marca dispatch_state = 'done'
    IF NOT EXISTS (
      SELECT 1
      FROM public.request_matches
      WHERE request_id = v_req.id
        AND notified_at IS NULL
    ) THEN
      UPDATE public.service_requests
      SET dispatch_state = 'done'
      WHERE id = v_req.id;
    END IF;
  END LOOP;

  RETURN v_notified_count;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_next_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_next_batch(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPCs do Cliente (API_SPECIFICATION.md seção 3.1)
-- -----------------------------------------------------------------------------

-- 7.1 create_service_request (E3-02, E3-03, E3-11)
CREATE OR REPLACE FUNCTION public.create_service_request(
  p_category_id uuid,
  p_neighborhood_id uuid,
  p_title text,
  p_description text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_address_full text,
  p_address_notes text DEFAULT NULL,
  p_media_paths text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_category public.categories%ROWTYPE;
  v_neighborhood public.neighborhoods%ROWTYPE;
  v_max_open integer := 3;
  v_max_daily integer := 5;
  v_max_quotes integer := 5;
  v_expiry_hours integer := 48;
  v_batch_size integer := 8;
  v_batch_interval_min integer := 15;
  v_max_pending_quotes integer := 10;
  v_open_count integer := 0;
  v_daily_count integer := 0;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_eligible_count integer := 0;
  v_path text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_profile.status <> 'active' OR v_profile.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Conta inativa ou suspensa.'
      USING ERRCODE = '42501';
  END IF;

  IF v_profile.phone_verified_at IS NULL THEN
    RAISE EXCEPTION 'PHONE_NOT_VERIFIED: Verifique seu telefone por SMS antes de abrir um pedido.'
      USING ERRCODE = '42501';
  END IF;

  -- Validar categoria ativa (gate)
  SELECT * INTO v_category
  FROM public.categories
  WHERE id = p_category_id;

  IF NOT FOUND OR v_category.is_active = false THEN
    RAISE EXCEPTION 'CATEGORY_INACTIVE: Esta categoria ainda está em fase de abertura em Osasco.'
      USING ERRCODE = '22023';
  END IF;

  -- Validar bairro ativo em Osasco
  SELECT * INTO v_neighborhood
  FROM public.neighborhoods
  WHERE id = p_neighborhood_id;

  IF NOT FOUND OR v_neighborhood.is_active = false THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Selecione um bairro ativo de Osasco.'
      USING ERRCODE = '22023';
  END IF;

  IF p_window_end < p_window_start THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: A data final da janela deve ser igual ou posterior à inicial.'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(array_length(p_media_paths, 1), 0) > 5 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Envie no máximo 5 fotos por pedido.'
      USING ERRCODE = '22023';
  END IF;

  -- Ler parâmetros em app_config
  SELECT COALESCE((value #>> '{}')::integer, 3) INTO v_max_open
  FROM public.app_config WHERE key = 'max_open_requests';

  SELECT COALESCE((value #>> '{}')::integer, 5) INTO v_max_daily
  FROM public.app_config WHERE key = 'max_daily_requests_per_client';

  SELECT COALESCE((value #>> '{}')::integer, 5) INTO v_max_quotes
  FROM public.app_config WHERE key = 'max_quotes';

  SELECT COALESCE((value #>> '{}')::integer, 48) INTO v_expiry_hours
  FROM public.app_config WHERE key = 'request_expiry_hours';

  SELECT COALESCE((value #>> '{}')::integer, 8) INTO v_batch_size
  FROM public.app_config WHERE key = 'batch_size';

  SELECT COALESCE((value #>> '{}')::integer, 15) INTO v_batch_interval_min
  FROM public.app_config WHERE key = 'batch_interval_minutes';

  SELECT COALESCE((value #>> '{}')::integer, 10) INTO v_max_pending_quotes
  FROM public.app_config WHERE key = 'provider_max_pending_quotes';

  -- Expirar pedidos antigos do cliente antes de contar os abertos
  PERFORM public.expire_overdue_requests_and_quotes(NULL);

  -- Limite de pedidos abertos simultâneos
  SELECT COUNT(*) INTO v_open_count
  FROM public.service_requests
  WHERE client_id = v_uid
    AND status IN ('open', 'quotes_closed');

  IF v_open_count >= v_max_open THEN
    RAISE EXCEPTION 'OPEN_REQUESTS_LIMIT: Você já possui % pedidos em aberto.', v_max_open
      USING ERRCODE = '22023';
  END IF;

  -- Limite diário de pedidos
  SELECT COUNT(*) INTO v_daily_count
  FROM public.service_requests
  WHERE client_id = v_uid
    AND created_at >= now() - interval '24 hours';

  IF v_daily_count >= v_max_daily THEN
    RAISE EXCEPTION 'RATE_LIMITED: Limite diário de pedidos atingido.'
      USING ERRCODE = '22023';
  END IF;

  -- Anti-duplicidade em 10 minutos (mesma categoria, mesmo bairro e mesmo título)
  IF EXISTS (
    SELECT 1
    FROM public.service_requests
    WHERE client_id = v_uid
      AND category_id = p_category_id
      AND neighborhood_id = p_neighborhood_id
      AND lower(btrim(title)) = lower(btrim(p_title))
      AND created_at >= now() - interval '10 minutes'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Um pedido idêntico foi enviado há menos de 10 minutos.'
      USING ERRCODE = '22023';
  END IF;

  v_expires_at := now() + make_interval(hours => v_expiry_hours);

  -- Criar pedido inicialmente como 'open'
  INSERT INTO public.service_requests (
    client_id,
    category_id,
    neighborhood_id,
    title,
    description,
    window_start,
    window_end,
    status,
    max_quotes,
    active_quotes_count,
    expires_at,
    dispatch_state
  )
  VALUES (
    v_uid,
    p_category_id,
    p_neighborhood_id,
    btrim(p_title),
    btrim(p_description),
    p_window_start,
    p_window_end,
    'open',
    v_max_quotes,
    0,
    v_expires_at,
    'dispatching'
  )
  RETURNING id INTO v_request_id;

  -- Salvar endereço privado (RF-22)
  INSERT INTO public.service_request_private (
    request_id,
    address_full,
    address_notes
  )
  VALUES (
    v_request_id,
    btrim(p_address_full),
    NULLIF(btrim(COALESCE(p_address_notes, '')), '')
  );

  -- Salvar caminhos de fotos se enviados
  IF COALESCE(array_length(p_media_paths, 1), 0) > 0 THEN
    FOREACH v_path IN ARRAY p_media_paths
    LOOP
      INSERT INTO public.request_media (request_id, storage_path)
      VALUES (v_request_id, btrim(v_path));
    END LOOP;
  END IF;

  -- Calcular prestadores elegíveis (ARCHITECTURE.md seção 6.1 e 6.2)
  -- Critérios:
  -- 1. verification_status = 'approved' e profiles.status = 'active'
  -- 2. is_paused = false
  -- 3. Atende a categoria (provider_categories)
  -- 4. Atende o bairro (provider_neighborhoods)
  -- 5. Disponibilidade compatível com pelo menos 1 dia da janela [window_start, window_end] em America/Sao_Paulo
  -- 6. can_interact(client_id, provider_id) = true
  -- 7. provider_id <> client_id
  -- 8. Propostas 'sent' simultâneas < provider_max_pending_quotes
  WITH window_days AS (
    SELECT DISTINCT EXTRACT(
      DOW FROM gs AT TIME ZONE 'America/Sao_Paulo'
    )::smallint AS weekday
    FROM generate_series(
      date_trunc('day', p_window_start AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo',
      date_trunc('day', p_window_end AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo',
      interval '1 day'
    ) AS gs
  ),
  eligible_providers AS (
    SELECT
      pp.user_id AS provider_id,
      pp.rating_avg,
      pp.rating_count,
      (
        SELECT COUNT(*)
        FROM public.request_matches rm7
        WHERE rm7.provider_id = pp.user_id
          AND rm7.notified_at >= now() - interval '7 days'
      ) AS notified_7d,
      COALESCE(
        (
          SELECT
            CASE
              WHEN COUNT(*) = 0 THEN 0.50::numeric
              ELSE COUNT(*) FILTER (WHERE rm30.quoted_at IS NOT NULL)::numeric / COUNT(*)::numeric
            END
          FROM public.request_matches rm30
          WHERE rm30.provider_id = pp.user_id
            AND rm30.notified_at >= now() - interval '30 days'
        ),
        0.50::numeric
      ) AS response_rate_30d
    FROM public.provider_profiles pp
    JOIN public.profiles pr ON pr.id = pp.user_id
    JOIN public.provider_categories pc
      ON pc.provider_id = pp.user_id
      AND pc.category_id = p_category_id
    JOIN public.provider_neighborhoods pn
      ON pn.provider_id = pp.user_id
      AND pn.neighborhood_id = p_neighborhood_id
    WHERE pp.verification_status = 'approved'
      AND pp.is_paused = false
      AND pr.status = 'active'
      AND pr.deleted_at IS NULL
      AND pp.user_id <> v_uid
      AND public.can_interact(v_uid, pp.user_id)
      AND EXISTS (
        SELECT 1
        FROM public.availability_rules ar
        JOIN window_days wd ON wd.weekday = ar.weekday
        WHERE ar.provider_id = pp.user_id
      )
      AND (
        SELECT COUNT(*)
        FROM public.quotes q_open
        WHERE q_open.provider_id = pp.user_id
          AND q_open.status = 'sent'
      ) < v_max_pending_quotes
  ),
  ranked_providers AS (
    SELECT
      ep.provider_id,
      ep.notified_7d,
      ep.response_rate_30d,
      ep.rating_avg,
      ROW_NUMBER() OVER (
        ORDER BY
          ep.notified_7d ASC,
          ep.response_rate_30d DESC,
          CASE WHEN ep.rating_count >= 3 THEN ep.rating_avg ELSE 4.50 END DESC,
          md5(v_request_id::text || ep.provider_id::text) ASC
      ) AS rn
    FROM eligible_providers ep
  ),
  batched_inserts AS (
    INSERT INTO public.request_matches (
      request_id,
      provider_id,
      batch_no,
      eligibility_snapshot,
      scheduled_notify_at,
      notified_at
    )
    SELECT
      v_request_id,
      rp.provider_id,
      ((rp.rn - 1) / v_batch_size) + 1 AS batch_no,
      jsonb_build_object(
        'rank', rp.rn,
        'notified_7d', rp.notified_7d,
        'response_rate_30d', rp.response_rate_30d,
        'rating_avg', rp.rating_avg
      ),
      now() + ((((rp.rn - 1) / v_batch_size)) * make_interval(mins => v_batch_interval_min)),
      CASE
        WHEN ((rp.rn - 1) / v_batch_size) + 1 = 1 THEN now()
        ELSE NULL
      END
    FROM ranked_providers rp
    RETURNING provider_id
  )
  SELECT COUNT(*) INTO v_eligible_count
  FROM batched_inserts;

  IF v_eligible_count = 0 THEN
    -- Nenhum prestador elegível: pedido nasce expired (no_eligible_providers) + unserved_demand
    UPDATE public.service_requests
    SET status = 'expired',
        status_reason = 'no_eligible_providers',
        dispatch_state = 'done',
        closed_at = now()
    WHERE id = v_request_id;

    INSERT INTO public.unserved_demand (
      category_id,
      neighborhood_id,
      request_id,
      notify_when_available
    )
    VALUES (
      p_category_id,
      p_neighborhood_id,
      v_request_id,
      false
    );

    PERFORM public.record_status_event(
      'request',
      v_request_id,
      NULL,
      'expired',
      v_uid,
      'no_eligible_providers',
      '{}'::jsonb
    );

    RETURN jsonb_build_object(
      'request_id', v_request_id,
      'status', 'expired',
      'status_reason', 'no_eligible_providers',
      'eligible', false
    );
  END IF;

  -- Se todos os elegíveis já couberam no lote 1, o despacho já terminou
  IF v_eligible_count <= v_batch_size THEN
    UPDATE public.service_requests
    SET dispatch_state = 'done'
    WHERE id = v_request_id;
  END IF;

  PERFORM public.record_status_event(
    'request',
    v_request_id,
    NULL,
    'open',
    v_uid,
    NULL,
    '{}'::jsonb
  );

  -- Retorna apenas eligible: true/false (nunca expõe o número exato de prestadores notificados)
  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'status', 'open',
    'eligible', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_service_request(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_service_request(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text[]) TO authenticated;

-- 7.2 set_notify_when_available (opção "Avise-me" em pedido sem elegíveis — E3-03)
CREATE OR REPLACE FUNCTION public.set_notify_when_available(
  p_request_id uuid,
  p_notify boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.service_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_req
  FROM public.service_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.client_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_FOUND: Pedido não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.service_requests
  SET client_notify_when_available = p_notify
  WHERE id = p_request_id;

  UPDATE public.unserved_demand
  SET notify_when_available = p_notify
  WHERE request_id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_notify_when_available(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_notify_when_available(uuid, boolean) TO authenticated;

-- 7.3 cancel_service_request (cliente cancela pedido aberto — E3-06)
CREATE OR REPLACE FUNCTION public.cancel_service_request(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.service_requests%ROWTYPE;
  v_quote record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_req
  FROM public.service_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.client_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_FOUND: Pedido não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotência: se já está cancelado pelo cliente, retorna o estado atual
  IF v_req.status = 'cancelled' AND v_req.status_reason = 'client_cancelled' THEN
    RETURN jsonb_build_object(
      'request_id', v_req.id,
      'status', v_req.status,
      'status_reason', v_req.status_reason
    );
  END IF;

  IF v_req.status NOT IN ('open', 'quotes_closed') THEN
    RAISE EXCEPTION 'INVALID_STATE: Apenas pedidos abertos podem ser cancelados diretamente.'
      USING ERRCODE = '22023';
  END IF;

  -- Rejeitar propostas 'sent' com motivo 'request_cancelled'
  FOR v_quote IN
    SELECT id
    FROM public.quotes
    WHERE request_id = p_request_id
      AND status = 'sent'
    ORDER BY id
    FOR UPDATE
  LOOP
    UPDATE public.quotes
    SET status = 'rejected',
        status_reason = 'request_cancelled'
    WHERE id = v_quote.id;

    PERFORM public.record_status_event(
      'quote',
      v_quote.id,
      'sent',
      'rejected',
      v_uid,
      'request_cancelled',
      '{}'::jsonb
    );
  END LOOP;

  UPDATE public.service_requests
  SET status = 'cancelled',
      status_reason = 'client_cancelled',
      active_quotes_count = 0,
      dispatch_state = 'done',
      closed_at = now()
  WHERE id = p_request_id;

  PERFORM public.record_status_event(
    'request',
    p_request_id,
    v_req.status::text,
    'cancelled',
    v_uid,
    'client_cancelled',
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'status', 'cancelled',
    'status_reason', 'client_cancelled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_service_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_service_request(uuid) TO authenticated;

-- 7.4 repeat_service_request ("Repetir pedido" a partir de um pedido terminal — E3-06)
CREATE OR REPLACE FUNCTION public.repeat_service_request(
  p_source_request_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_src public.service_requests%ROWTYPE;
  v_priv public.service_request_private%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_src
  FROM public.service_requests
  WHERE id = p_source_request_id;

  IF NOT FOUND OR v_src.client_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_FOUND: Pedido original não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_src.status NOT IN ('expired', 'cancelled', 'completed') THEN
    RAISE EXCEPTION 'INVALID_STATE: Só é possível repetir um pedido já encerrado.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_priv
  FROM public.service_request_private
  WHERE request_id = p_source_request_id;

  RETURN public.create_service_request(
    v_src.category_id,
    v_src.neighborhood_id,
    v_src.title,
    v_src.description,
    p_window_start,
    p_window_end,
    v_priv.address_full,
    v_priv.address_notes,
    ARRAY[]::text[]
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repeat_service_request(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repeat_service_request(uuid, timestamptz, timestamptz) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPCs do Prestador e Aceite do Cliente (API_SPECIFICATION.md seção 3.1 e 3.2)
-- -----------------------------------------------------------------------------

-- 8.1 dismiss_request (prestador descarta pedido notificado — E4-05)
CREATE OR REPLACE FUNCTION public.dismiss_request(
  p_request_id uuid
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

  UPDATE public.request_matches
  SET dismissed_at = COALESCE(dismissed_at, now()),
      seen_at = COALESCE(seen_at, now())
  WHERE request_id = p_request_id
    AND provider_id = v_uid
    AND notified_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Pedido não encontrado para este profissional.'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dismiss_request(uuid) TO authenticated;

-- 8.2 submit_quote (prestador envia proposta sob lock no pedido — E4-02, E4-04)
CREATE OR REPLACE FUNCTION public.submit_quote(
  p_request_id uuid,
  p_total_price_cents integer,
  p_includes_description text,
  p_proposed_start timestamptz,
  p_valid_until timestamptz DEFAULT NULL,
  p_visit_fee_cents integer DEFAULT 0,
  p_estimated_duration_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.provider_profiles%ROWTYPE;
  v_req public.service_requests%ROWTYPE;
  v_match public.request_matches%ROWTYPE;
  v_effective_valid_until timestamptz;
  v_min_validity_hours integer := 2;
  v_min_lead_hours integer := 2;
  v_quote_id uuid;
  v_new_active_count integer;
  v_new_req_status public.request_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  -- Validar prestador aprovado e não pausado
  SELECT * INTO v_provider
  FROM public.provider_profiles
  WHERE user_id = v_uid;

  IF NOT FOUND OR v_provider.verification_status <> 'approved' THEN
    RAISE EXCEPTION 'PROVIDER_NOT_APPROVED: Apenas profissionais com identidade verificada podem enviar propostas.'
      USING ERRCODE = '42501';
  END IF;

  IF v_provider.is_paused THEN
    RAISE EXCEPTION 'PROVIDER_PAUSED: Seu recebimento de pedidos está pausado.'
      USING ERRCODE = '42501';
  END IF;

  -- Expiração preguiçosa antes do lock
  PERFORM public.expire_overdue_requests_and_quotes(p_request_id);

  -- Lock canônico na linha do pedido (SELECT ... FOR UPDATE)
  SELECT * INTO v_req
  FROM public.service_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Pedido não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_interact(v_req.client_id, v_uid) THEN
    RAISE EXCEPTION 'BLOCKED: Não é possível interagir com este pedido.'
      USING ERRCODE = '42501';
  END IF;

  -- Validar match notificado e não dispensado
  SELECT * INTO v_match
  FROM public.request_matches
  WHERE request_id = p_request_id
    AND provider_id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_match.notified_at IS NULL OR v_match.dismissed_at IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Este pedido não está disponível na sua fila.'
      USING ERRCODE = '42501';
  END IF;

  -- Validar se já enviou proposta antes (inclusive withdrawn)
  IF EXISTS (
    SELECT 1
    FROM public.quotes
    WHERE request_id = p_request_id
      AND provider_id = v_uid
  ) THEN
    RAISE EXCEPTION 'ALREADY_QUOTED: Você já enviou uma proposta para este pedido.'
      USING ERRCODE = '23505';
  END IF;

  IF v_req.expires_at <= now() OR v_req.status = 'expired' THEN
    RAISE EXCEPTION 'REQUEST_EXPIRED: O prazo deste pedido expirou.'
      USING ERRCODE = '22023';
  END IF;

  IF v_req.status = 'quotes_closed' OR v_req.active_quotes_count >= v_req.max_quotes THEN
    RAISE EXCEPTION 'QUOTE_LIMIT_REACHED: Este pedido já atingiu o limite de % propostas ativas.', v_req.max_quotes
      USING ERRCODE = '22023';
  END IF;

  IF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'REQUEST_CLOSED: Este pedido não aceita novas propostas.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE((value #>> '{}')::integer, 2) INTO v_min_validity_hours
  FROM public.app_config WHERE key = 'quote_min_validity_hours';

  SELECT COALESCE((value #>> '{}')::integer, 2) INTO v_min_lead_hours
  FROM public.app_config WHERE key = 'quote_min_lead_hours';

  IF p_proposed_start < now() + make_interval(hours => v_min_lead_hours) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: O horário proposto deve ter pelo menos % horas de antecedência.', v_min_lead_hours
      USING ERRCODE = '22023';
  END IF;

  v_effective_valid_until := LEAST(COALESCE(p_valid_until, v_req.expires_at), v_req.expires_at);

  IF v_effective_valid_until < now() + make_interval(hours => v_min_validity_hours) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: A validade da proposta deve ser de pelo menos % horas.', v_min_validity_hours
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.quotes (
    request_id,
    provider_id,
    total_price_cents,
    visit_fee_cents,
    includes_description,
    proposed_start,
    estimated_duration_minutes,
    valid_until,
    revision,
    status
  )
  VALUES (
    p_request_id,
    v_uid,
    p_total_price_cents,
    COALESCE(p_visit_fee_cents, 0),
    btrim(p_includes_description),
    p_proposed_start,
    p_estimated_duration_minutes,
    v_effective_valid_until,
    0,
    'sent'
  )
  RETURNING id INTO v_quote_id;

  v_new_active_count := v_req.active_quotes_count + 1;
  v_new_req_status := CASE
    WHEN v_new_active_count >= v_req.max_quotes THEN 'quotes_closed'::public.request_status
    ELSE 'open'::public.request_status
  END;

  UPDATE public.service_requests
  SET active_quotes_count = v_new_active_count,
      status = v_new_req_status
  WHERE id = p_request_id;

  UPDATE public.request_matches
  SET seen_at = COALESCE(seen_at, now()),
      quoted_at = now()
  WHERE request_id = p_request_id
    AND provider_id = v_uid;

  PERFORM public.record_status_event(
    'quote',
    v_quote_id,
    NULL,
    'sent',
    v_uid,
    NULL,
    jsonb_build_object('total_price_cents', p_total_price_cents)
  );

  IF v_new_req_status <> v_req.status THEN
    PERFORM public.record_status_event(
      'request',
      p_request_id,
      v_req.status::text,
      v_new_req_status::text,
      v_uid,
      'quote_limit_reached',
      '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'quote_id', v_quote_id,
    'request_id', p_request_id,
    'quote_status', 'sent',
    'request_status', v_new_req_status,
    'active_quotes_count', v_new_active_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quote(uuid, integer, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quote(uuid, integer, text, timestamptz, timestamptz, integer, integer) TO authenticated;

-- 8.3 edit_quote (edição única da proposta `revision = 0 -> 1` — E4-03)
CREATE OR REPLACE FUNCTION public.edit_quote(
  p_quote_id uuid,
  p_total_price_cents integer,
  p_includes_description text,
  p_proposed_start timestamptz,
  p_valid_until timestamptz DEFAULT NULL,
  p_visit_fee_cents integer DEFAULT 0,
  p_estimated_duration_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_req public.service_requests%ROWTYPE;
  v_effective_valid_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  -- Lock na proposta e pedido na ordem canônica (pedido -> proposta)
  SELECT sr.* INTO v_req
  FROM public.service_requests sr
  JOIN public.quotes q ON q.request_id = sr.id
  WHERE q.id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Proposta não encontrada.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF v_quote.provider_id <> v_uid THEN
    RAISE EXCEPTION 'FORBIDDEN: Você só pode editar sua própria proposta.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_interact(v_req.client_id, v_uid) THEN
    RAISE EXCEPTION 'BLOCKED: Não é possível interagir com este pedido.'
      USING ERRCODE = '42501';
  END IF;

  IF v_quote.status <> 'sent' THEN
    RAISE EXCEPTION 'INVALID_STATE: Apenas propostas ativas podem ser editadas.'
      USING ERRCODE = '22023';
  END IF;

  IF v_quote.revision >= 1 THEN
    RAISE EXCEPTION 'QUOTE_ALREADY_EDITED: Cada proposta só pode ser revisada uma única vez.'
      USING ERRCODE = '22023';
  END IF;

  IF v_req.status NOT IN ('open', 'quotes_closed') OR v_req.expires_at <= now() THEN
    RAISE EXCEPTION 'REQUEST_CLOSED: O pedido não permite mais alterações na proposta.'
      USING ERRCODE = '22023';
  END IF;

  v_effective_valid_until := LEAST(COALESCE(p_valid_until, v_quote.valid_until), v_req.expires_at);
  IF v_effective_valid_until <= now() THEN
    RAISE EXCEPTION 'QUOTE_EXPIRED: A validade da proposta já expirou.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.quotes
  SET total_price_cents = p_total_price_cents,
      visit_fee_cents = COALESCE(p_visit_fee_cents, 0),
      includes_description = btrim(p_includes_description),
      proposed_start = p_proposed_start,
      estimated_duration_minutes = p_estimated_duration_minutes,
      valid_until = v_effective_valid_until,
      revision = 1
  WHERE id = p_quote_id;

  PERFORM public.record_status_event(
    'quote',
    p_quote_id,
    'sent',
    'sent',
    v_uid,
    'quote_revised',
    jsonb_build_object('revision', 1, 'total_price_cents', p_total_price_cents)
  );

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'revision', 1,
    'status', 'sent'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.edit_quote(uuid, integer, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_quote(uuid, integer, text, timestamptz, timestamptz, integer, integer) TO authenticated;

-- 8.4 withdraw_quote (prestador retira proposta, liberando vaga — E4-03)
CREATE OR REPLACE FUNCTION public.withdraw_quote(
  p_quote_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.service_requests%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_new_active_count integer;
  v_new_req_status public.request_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  -- Lock em ordem canônica: pedido -> proposta
  SELECT sr.* INTO v_req
  FROM public.service_requests sr
  JOIN public.quotes q ON q.request_id = sr.id
  WHERE q.id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Proposta não encontrada.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF v_quote.provider_id <> v_uid THEN
    RAISE EXCEPTION 'FORBIDDEN: Você só pode retirar sua própria proposta.'
      USING ERRCODE = '42501';
  END IF;

  IF v_quote.status = 'withdrawn' THEN
    RETURN jsonb_build_object(
      'quote_id', p_quote_id,
      'quote_status', 'withdrawn',
      'request_status', v_req.status
    );
  END IF;

  IF v_quote.status <> 'sent' THEN
    RAISE EXCEPTION 'INVALID_STATE: Apenas propostas em aberto podem ser retiradas.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.quotes
  SET status = 'withdrawn',
      status_reason = 'provider_withdrew'
  WHERE id = p_quote_id;

  v_new_active_count := GREATEST(v_req.active_quotes_count - 1, 0);
  v_new_req_status := CASE
    WHEN v_req.status = 'quotes_closed'
      AND v_new_active_count < v_req.max_quotes
      AND v_req.expires_at > now()
    THEN 'open'::public.request_status
    ELSE v_req.status
  END;

  UPDATE public.service_requests
  SET active_quotes_count = v_new_active_count,
      status = v_new_req_status
  WHERE id = v_req.id;

  PERFORM public.record_status_event(
    'quote',
    p_quote_id,
    'sent',
    'withdrawn',
    v_uid,
    'provider_withdrew',
    '{}'::jsonb
  );

  IF v_new_req_status <> v_req.status THEN
    PERFORM public.record_status_event(
      'request',
      v_req.id,
      v_req.status::text,
      v_new_req_status::text,
      v_uid,
      'slot_reopened',
      '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'quote_status', 'withdrawn',
    'request_status', v_new_req_status,
    'active_quotes_count', v_new_active_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_quote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_quote(uuid) TO authenticated;

-- 8.5 accept_quote (cliente aceita proposta sob lock canônico, rejeita irmãs e libera endereço — E3-05)
CREATE OR REPLACE FUNCTION public.accept_quote(
  p_quote_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.service_requests%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_provider public.provider_profiles%ROWTYPE;
  v_sibling record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  -- Lock em ordem canônica: pedido -> proposta
  SELECT sr.* INTO v_req
  FROM public.service_requests sr
  JOIN public.quotes q ON q.request_id = sr.id
  WHERE q.id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND OR v_req.client_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_FOUND: Pedido ou proposta não encontrados.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  -- Idempotência: se esta proposta já foi aceita neste pedido, retorna estado atual
  IF v_req.status = 'hired' AND v_req.hired_quote_id = p_quote_id AND v_quote.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'request_id', v_req.id,
      'quote_id', v_quote.id,
      'request_status', 'hired',
      'quote_status', 'accepted',
      'agreed_price_cents', v_quote.total_price_cents,
      'scheduled_for', v_quote.proposed_start
    );
  END IF;

  IF NOT public.can_interact(v_req.client_id, v_quote.provider_id) THEN
    RAISE EXCEPTION 'BLOCKED: Não é possível contratar este profissional.'
      USING ERRCODE = '42501';
  END IF;

  IF v_req.expires_at <= now() THEN
    PERFORM public.expire_overdue_requests_and_quotes(v_req.id);
    RAISE EXCEPTION 'REQUEST_EXPIRED: O prazo deste pedido expirou.'
      USING ERRCODE = '22023';
  END IF;

  IF v_req.status NOT IN ('open', 'quotes_closed') THEN
    RAISE EXCEPTION 'REQUEST_CLOSED: Este pedido já foi contratado ou encerrado.'
      USING ERRCODE = '22023';
  END IF;

  IF v_quote.status <> 'sent' THEN
    RAISE EXCEPTION 'INVALID_STATE: Esta proposta não está mais disponível para aceite.'
      USING ERRCODE = '22023';
  END IF;

  IF LEAST(v_quote.valid_until, v_req.expires_at) <= now() THEN
    PERFORM public.expire_overdue_requests_and_quotes(v_req.id);
    RAISE EXCEPTION 'QUOTE_EXPIRED: A validade desta proposta expirou.'
      USING ERRCODE = '22023';
  END IF;

  IF v_quote.proposed_start <= now() THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: O horário proposto na proposta já passou.'
      USING ERRCODE = '22023';
  END IF;

  -- Validar se prestador continua aprovado e ativo
  SELECT * INTO v_provider
  FROM public.provider_profiles
  WHERE user_id = v_quote.provider_id;

  IF NOT FOUND OR v_provider.verification_status <> 'approved' THEN
    RAISE EXCEPTION 'PROVIDER_NOT_APPROVED: O profissional não está mais elegível.'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Marcar a proposta escolhida como 'accepted'
  UPDATE public.quotes
  SET status = 'accepted'
  WHERE id = p_quote_id;

  PERFORM public.record_status_event(
    'quote',
    p_quote_id,
    'sent',
    'accepted',
    v_uid,
    NULL,
    jsonb_build_object('agreed_price_cents', v_quote.total_price_cents)
  );

  -- 2. Rejeitar todas as demais propostas 'sent' do mesmo pedido (sibling_accepted)
  FOR v_sibling IN
    SELECT id
    FROM public.quotes
    WHERE request_id = v_req.id
      AND id <> p_quote_id
      AND status = 'sent'
    ORDER BY id
    FOR UPDATE
  LOOP
    UPDATE public.quotes
    SET status = 'rejected',
        status_reason = 'sibling_accepted'
    WHERE id = v_sibling.id;

    PERFORM public.record_status_event(
      'quote',
      v_sibling.id,
      'sent',
      'rejected',
      v_uid,
      'sibling_accepted',
      '{}'::jsonb
    );
  END LOOP;

  -- 3. Marcar o pedido como 'hired' e vincular hired_quote_id (libera endereço ao prestador via RLS)
  UPDATE public.service_requests
  SET status = 'hired',
      hired_quote_id = p_quote_id,
      active_quotes_count = 1,
      dispatch_state = 'done'
  WHERE id = v_req.id;

  PERFORM public.record_status_event(
    'request',
    v_req.id,
    v_req.status::text,
    'hired',
    v_uid,
    NULL,
    jsonb_build_object('hired_quote_id', p_quote_id, 'provider_id', v_quote.provider_id)
  );

  RETURN jsonb_build_object(
    'request_id', v_req.id,
    'quote_id', v_quote.id,
    'request_status', 'hired',
    'quote_status', 'accepted',
    'agreed_price_cents', v_quote.total_price_cents,
    'scheduled_for', v_quote.proposed_start
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_quote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_quote(uuid) TO authenticated;
