-- =============================================================================
-- Fase 0 — Fundação: Enums canônicos, app_config, status_events, categorias e bairros
-- Fonte oficial: docs/DATABASE.md (seções 2, 3, 7 e 10) e docs/PRD.md (seções 11 e 12)
-- =============================================================================

-- 1. Catálogo de enums (DATABASE.md seção 2)
CREATE TYPE public.profile_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE public.verification_status AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'suspended');
CREATE TYPE public.submission_type AS ENUM ('initial', 'resubmission', 'appeal');
CREATE TYPE public.submission_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.document_type AS ENUM ('id_front', 'id_back', 'selfie');
CREATE TYPE public.rejection_reason AS ENUM (
  'illegible',
  'expired_document',
  'face_mismatch',
  'name_mismatch',
  'underage',
  'duplicate_account',
  'suspected_fraud',
  'incomplete'
);
CREATE TYPE public.request_status AS ENUM ('open', 'quotes_closed', 'hired', 'completed', 'cancelled', 'expired');
CREATE TYPE public.request_status_reason AS ENUM (
  'no_eligible_providers',
  'no_acceptance_in_time',
  'client_cancelled',
  'job_cancelled',
  'job_no_show',
  'no_outcome',
  'moderation_removed',
  'account_deleted'
);
CREATE TYPE public.quote_status AS ENUM ('sent', 'accepted', 'rejected', 'withdrawn', 'expired');
CREATE TYPE public.quote_status_reason AS ENUM (
  'sibling_accepted',
  'request_cancelled',
  'request_expired',
  'validity_expired',
  'provider_withdrew',
  'provider_suspended',
  'moderation_removed',
  'account_deleted'
);
CREATE TYPE public.job_status AS ENUM ('scheduled', 'no_show_claimed', 'completed', 'cancelled', 'no_show', 'disputed');
CREATE TYPE public.completion_type AS ENUM ('full', 'partial');
CREATE TYPE public.cancel_reason AS ENUM (
  'schedule_conflict',
  'no_longer_needed',
  'price_disagreement',
  'found_other_provider',
  'provider_unavailable',
  'safety_concern',
  'other'
);
CREATE TYPE public.conversation_status AS ENUM ('open', 'read_only');
CREATE TYPE public.review_status AS ENUM ('pending_reveal', 'published', 'removed');
CREATE TYPE public.report_target AS ENUM ('user', 'review', 'message', 'request', 'quote', 'job');
CREATE TYPE public.report_reason AS ENUM (
  'harassment',
  'threat_or_violence',
  'fraud',
  'fake_profile',
  'inappropriate_content',
  'no_show',
  'price_divergence',
  'incomplete_service',
  'damage_or_theft',
  'spam',
  'other'
);
CREATE TYPE public.report_status AS ENUM ('open', 'in_review', 'resolved', 'dismissed');
CREATE TYPE public.dispute_outcome AS ENUM ('completed', 'cancelled', 'no_show_client', 'no_show_provider');
CREATE TYPE public.availability_period AS ENUM ('morning', 'afternoon', 'evening');

-- 2. Funções utilitárias de integridade (triggers)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Tabela append-only (%): UPDATE e DELETE são proibidos.', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

-- 3. Tabela app_config (DATABASE.md seção 3.6)
CREATE TABLE public.app_config (
  key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 80),
  value jsonb NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_app_config_updated_at
BEFORE UPDATE ON public.app_config
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Políticas RLS para app_config: usuários autenticados leem apenas chaves públicas
CREATE POLICY app_config_select_public
  ON public.app_config
  FOR SELECT
  TO authenticated
  USING (is_public = true);

CREATE VIEW public.public_app_config
WITH (security_invoker = true) AS
SELECT key, value, updated_at
FROM public.app_config
WHERE is_public = true;

-- 4. Tabela categories (DATABASE.md seção 3.2)
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 60),
  icon text NOT NULL CHECK (char_length(icon) BETWEEN 1 AND 40),
  is_active boolean NOT NULL DEFAULT false,
  requires_enhanced_verification boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_categories_updated_at
BEFORE UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY categories_select_authenticated
  ON public.categories
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. Tabela neighborhoods (DATABASE.md seção 3.2)
CREATE TABLE public.neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  zone text NOT NULL CHECK (zone IN ('Centro', 'Norte', 'Sul', 'Leste', 'Oeste')),
  city text NOT NULL DEFAULT 'Osasco' CHECK (char_length(city) BETWEEN 2 AND 60),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city, name)
);

ALTER TABLE public.neighborhoods ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_neighborhoods_updated_at
BEFORE UPDATE ON public.neighborhoods
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY neighborhoods_select_active
  ON public.neighborhoods
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- 6. Tabela status_events append-only (BACKLOG E0-09, ADR-18, DATABASE.md seção 3.3)
CREATE TABLE public.status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('request', 'quote', 'job', 'verification')),
  entity_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (char_length(to_status) BETWEEN 1 AND 40),
  actor_id uuid,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_events_entity ON public.status_events (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_status_events_actor ON public.status_events (actor_id) WHERE actor_id IS NOT NULL;

ALTER TABLE public.status_events ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_status_events_append_only
BEFORE UPDATE OR DELETE ON public.status_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation();

-- 7. Tabela account_deletion_log append-only (DATABASE.md seção 3.6)
CREATE TABLE public.account_deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_hash text NOT NULL UNIQUE CHECK (char_length(user_id_hash) = 64),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  legal_hold_applied boolean NOT NULL DEFAULT false
);

ALTER TABLE public.account_deletion_log ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_account_deletion_log_append_only
BEFORE UPDATE OR DELETE ON public.account_deletion_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation();

-- 8. Revogar escritas diretas de anon e authenticated nas tabelas de fundação (SEC-07)
REVOKE ALL ON public.app_config FROM anon, authenticated;
GRANT SELECT ON public.app_config TO authenticated;
GRANT SELECT ON public.public_app_config TO authenticated;

REVOKE ALL ON public.categories FROM anon, authenticated;
GRANT SELECT ON public.categories TO authenticated;

REVOKE ALL ON public.neighborhoods FROM anon, authenticated;
GRANT SELECT ON public.neighborhoods TO authenticated;

REVOKE ALL ON public.status_events FROM anon, authenticated;
REVOKE ALL ON public.account_deletion_log FROM anon, authenticated;
