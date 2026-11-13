-- =============================================================================
-- Fase 3 — Chat em Tempo Real e Notificações Push (Épico E5)
-- Fonte oficial: docs/DATABASE.md (seções 3.4, 3.6, 6, 7),
--                docs/API_SPECIFICATION.md (seções 3.4, 4.1, 5, 6),
--                docs/SECURITY.md (SEC-25, SEC-27)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabelas da Fase 3 (conversations, messages, push_tokens, notifications)
-- -----------------------------------------------------------------------------

-- 1.1 conversations (DATABASE.md seção 3.4)
-- Não existe conversa antes de uma proposta. Criada automaticamente em submit_quote.
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL UNIQUE REFERENCES public.quotes(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE RESTRICT,
  status public.conversation_status NOT NULL DEFAULT 'open',
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, provider_id),
  CONSTRAINT chk_conversations_distinct_parties CHECK (client_id <> provider_id)
);

CREATE INDEX idx_conversations_request_id
  ON public.conversations (request_id);

CREATE INDEX idx_conversations_client_last_msg
  ON public.conversations (client_id, last_message_at DESC NULLS LAST);

CREATE INDEX idx_conversations_provider_last_msg
  ON public.conversations (provider_id, last_message_at DESC NULLS LAST);

CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversations FROM anon, authenticated;
GRANT SELECT ON public.conversations TO authenticated;

-- 1.2 messages (DATABASE.md seção 3.4)
-- Sem edição ou exclusão pelo usuário. Na exclusão de conta/moderação: body = NULL e redacted_at preenchido.
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  redacted_at timestamptz,
  CONSTRAINT chk_messages_body_or_redacted CHECK (
    (redacted_at IS NULL AND body IS NOT NULL AND char_length(btrim(body)) BETWEEN 1 AND 2000)
    OR (redacted_at IS NOT NULL AND body IS NULL)
  )
);

CREATE INDEX idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

CREATE INDEX idx_messages_sender_id
  ON public.messages (sender_id);

CREATE INDEX idx_messages_unread
  ON public.messages (conversation_id, sender_id)
  WHERE read_at IS NULL;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.messages FROM anon, authenticated;
GRANT SELECT ON public.messages TO authenticated;

-- 1.3 push_tokens (DATABASE.md seção 3.6)
CREATE TABLE public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CHECK (char_length(btrim(token)) BETWEEN 10 AND 255),
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_tokens_user_id
  ON public.push_tokens (user_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tokens FROM anon, authenticated;
GRANT SELECT ON public.push_tokens TO authenticated;

-- 1.4 notifications (DATABASE.md seção 3.6 — payload sem PII, SEC-27)
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (char_length(btrim(type)) BETWEEN 2 AND 60),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  push_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX idx_notifications_user_unread
  ON public.notifications (user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Políticas RLS da Fase 3 (DATABASE.md seção 7 e SEC-25)
-- -----------------------------------------------------------------------------

-- 2.1 conversations: SOMENTE os dois participantes leem (admin NÃO tem leitura livre; só via EF com report_id)
CREATE POLICY conversations_select_participant_only
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    client_id = auth.uid()
    OR provider_id = auth.uid()
  );

-- 2.2 messages: SOMENTE os participantes da conversa leem (inclusive histórico após bloqueio)
CREATE POLICY messages_select_participant_only
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.client_id = auth.uid() OR c.provider_id = auth.uid())
    )
  );

-- 2.3 push_tokens: somente o próprio dono lê
CREATE POLICY push_tokens_select_own
  ON public.push_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 2.4 notifications: somente o próprio destinatário lê
CREATE POLICY notifications_select_own
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. Sincronização transacional de Conversas e Notificações com Propostas/Pedidos
-- -----------------------------------------------------------------------------

-- 3.1 Ao criar uma proposta ('sent'), cria automaticamente a conversa ('open') e notifica o cliente
CREATE OR REPLACE FUNCTION public.handle_quote_created_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT client_id INTO v_client_id
  FROM public.service_requests
  WHERE id = NEW.request_id;

  INSERT INTO public.conversations (
    request_id,
    quote_id,
    client_id,
    provider_id,
    status
  )
  VALUES (
    NEW.request_id,
    NEW.id,
    v_client_id,
    NEW.provider_id,
    'open'
  )
  ON CONFLICT (quote_id) DO NOTHING;

  -- Notificação genérica sem PII para o cliente (SEC-27)
  IF public.can_interact(v_client_id, NEW.provider_id) THEN
    INSERT INTO public.notifications (user_id, type, payload)
    VALUES (
      v_client_id,
      'new_quote',
      jsonb_build_object(
        'request_id', NEW.request_id,
        'quote_id', NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quote_created_conversation
AFTER INSERT ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.handle_quote_created_conversation();

-- 3.2 Ao alterar status/revisão de proposta, sincroniza conversations.status e gera notificações genéricas
CREATE OR REPLACE FUNCTION public.handle_quote_updated_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT client_id INTO v_client_id
  FROM public.service_requests
  WHERE id = NEW.request_id;

  -- Se a proposta foi encerrada sem contratação (rejected, withdrawn, expired), conversa vira read_only
  IF NEW.status IN ('rejected', 'withdrawn', 'expired') AND OLD.status <> NEW.status THEN
    UPDATE public.conversations
    SET status = 'read_only'
    WHERE quote_id = NEW.id
      AND status <> 'read_only';
  END IF;

  -- Se a proposta foi aceita, notifica o prestador contratado (sem PII no payload)
  IF NEW.status = 'accepted' AND OLD.status <> 'accepted' THEN
    IF public.can_interact(v_client_id, NEW.provider_id) THEN
      INSERT INTO public.notifications (user_id, type, payload)
      VALUES (
        NEW.provider_id,
        'quote_accepted',
        jsonb_build_object(
          'request_id', NEW.request_id,
          'quote_id', NEW.id
        )
      );
    END IF;
  END IF;

  -- Se a proposta foi revisada (revision 0 -> 1), notifica o cliente
  IF NEW.revision = 1 AND OLD.revision = 0 AND NEW.status = 'sent' THEN
    IF public.can_interact(v_client_id, NEW.provider_id) THEN
      INSERT INTO public.notifications (user_id, type, payload)
      VALUES (
        v_client_id,
        'quote_revised',
        jsonb_build_object(
          'request_id', NEW.request_id,
          'quote_id', NEW.id
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quote_updated_conversation
AFTER UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.handle_quote_updated_conversation();

-- 3.3 Se o pedido for cancelado ou expirar, fecha todas as conversas vinculadas como read_only
CREATE OR REPLACE FUNCTION public.handle_request_closed_conversations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'expired') AND OLD.status <> NEW.status THEN
    UPDATE public.conversations
    SET status = 'read_only'
    WHERE request_id = NEW.id
      AND status <> 'read_only';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_request_closed_conversations
AFTER UPDATE ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.handle_request_closed_conversations();

-- -----------------------------------------------------------------------------
-- 4. Views de leitura seguras (`security_invoker = true`) — API_SPECIFICATION seção 2
-- -----------------------------------------------------------------------------

-- 4.1 my_conversations
CREATE OR REPLACE VIEW public.my_conversations
WITH (security_invoker = true)
AS
SELECT
  c.id AS conversation_id,
  c.request_id,
  sr.title AS request_title,
  c.quote_id,
  c.client_id,
  split_part(btrim(pc.full_name), ' ', 1) AS client_first_name,
  c.provider_id,
  pp.display_name AS provider_display_name,
  c.status,
  c.last_message_at,
  (
    SELECT COUNT(*)::integer
    FROM public.messages m
    WHERE m.conversation_id = c.id
      AND m.sender_id <> auth.uid()
      AND m.read_at IS NULL
  ) AS unread_count,
  c.created_at
FROM public.conversations c
JOIN public.service_requests sr ON sr.id = c.request_id
JOIN public.profiles pc ON pc.id = c.client_id
JOIN public.provider_profiles pp ON pp.user_id = c.provider_id
WHERE c.client_id = auth.uid()
   OR c.provider_id = auth.uid();

GRANT SELECT ON public.my_conversations TO authenticated;

-- 4.2 my_notifications
CREATE OR REPLACE VIEW public.my_notifications
WITH (security_invoker = true)
AS
SELECT
  n.id AS notification_id,
  n.user_id,
  n.type,
  n.payload,
  n.read_at,
  n.created_at
FROM public.notifications n
WHERE n.user_id = auth.uid();

GRANT SELECT ON public.my_notifications TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. RPCs da Fase 3 (API_SPECIFICATION.md seção 3.4)
-- -----------------------------------------------------------------------------

-- 5.1 send_message (E5-01 — respeita can_interact, status = open, 1..2000 chars e rate limit)
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id uuid,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_trimmed text := btrim(COALESCE(p_body, ''));
  v_max_per_min integer := 20;
  v_recent_count integer := 0;
  v_recipient_id uuid;
  v_message_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  IF char_length(v_trimmed) < 1 OR char_length(v_trimmed) > 2000 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: A mensagem deve ter entre 1 e 2000 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND OR (v_conv.client_id <> v_uid AND v_conv.provider_id <> v_uid) THEN
    RAISE EXCEPTION 'NOT_FOUND: Conversa não encontrada.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Validar can_interact (não revela quem bloqueou quem)
  IF NOT public.can_interact(v_conv.client_id, v_conv.provider_id) THEN
    RAISE EXCEPTION 'BLOCKED: Não é possível enviar mensagens nesta conversa.'
      USING ERRCODE = '42501';
  END IF;

  IF v_conv.status <> 'open' THEN
    RAISE EXCEPTION 'INVALID_STATE: Esta conversa está em modo somente leitura.'
      USING ERRCODE = '22023';
  END IF;

  -- Rate limit por minuto por conversa
  SELECT COALESCE((value #>> '{}')::integer, 20) INTO v_max_per_min
  FROM public.app_config
  WHERE key = 'max_messages_per_minute';

  SELECT COUNT(*) INTO v_recent_count
  FROM public.messages
  WHERE conversation_id = p_conversation_id
    AND sender_id = v_uid
    AND created_at >= now() - interval '1 minute';

  IF v_recent_count >= v_max_per_min THEN
    RAISE EXCEPTION 'RATE_LIMITED: Aguarde alguns segundos antes de enviar novas mensagens.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    body
  )
  VALUES (
    p_conversation_id,
    v_uid,
    v_trimmed
  )
  RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET last_message_at = now()
  WHERE id = p_conversation_id;

  v_recipient_id := CASE
    WHEN v_uid = v_conv.client_id THEN v_conv.provider_id
    ELSE v_conv.client_id
  END;

  -- Notificação genérica sem PII (nunca armazena o texto da mensagem nem nome no payload — SEC-27)
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (
    v_recipient_id,
    'new_message',
    jsonb_build_object(
      'conversation_id', p_conversation_id,
      'request_id', v_conv.request_id
    )
  );

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'conversation_id', p_conversation_id,
    'created_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;

-- 5.2 mark_messages_read (E5-02 — marca como lidas apenas as mensagens enviadas pela outra parte)
CREATE OR REPLACE FUNCTION public.mark_messages_read(
  p_conversation_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND OR (v_conv.client_id <> v_uid AND v_conv.provider_id <> v_uid) THEN
    RAISE EXCEPTION 'NOT_FOUND: Conversa não encontrada.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.messages
  SET read_at = now()
  WHERE conversation_id = p_conversation_id
    AND sender_id <> v_uid
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_messages_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid) TO authenticated;

-- 5.3 mark_notifications_read (E5-04)
CREATE OR REPLACE FUNCTION public.mark_notifications_read(
  p_notification_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  UPDATE public.notifications
  SET read_at = now()
  WHERE user_id = v_uid
    AND read_at IS NULL
    AND (p_notification_ids IS NULL OR id = ANY(p_notification_ids));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- 5.4 register_push_token e remove_push_token (E5-03)
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token text,
  p_platform text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sessão inválida.'
      USING ERRCODE = '28000';
  END IF;

  IF p_platform NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Plataforma inválida.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_tokens (user_id, token, platform, last_seen_at)
  VALUES (v_uid, btrim(p_token), p_platform, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        last_seen_at = now()
  RETURNING id INTO v_token_id;

  RETURN v_token_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_push_token(
  p_token text
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

  DELETE FROM public.push_tokens
  WHERE user_id = v_uid
    AND token = btrim(p_token);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_push_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_push_token(text) TO authenticated;

-- 5.5 purge_expired_notifications (job agendado diário — retenção de 90 dias, E5-04)
CREATE OR REPLACE FUNCTION public.purge_expired_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retention_days integer := 90;
  v_deleted integer := 0;
BEGIN
  SELECT COALESCE((value #>> '{}')::integer, 90) INTO v_retention_days
  FROM public.app_config
  WHERE key = 'notifications_retention_days';

  DELETE FROM public.notifications
  WHERE created_at < now() - make_interval(days => v_retention_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_notifications() FROM PUBLIC;
