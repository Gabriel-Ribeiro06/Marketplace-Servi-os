-- =============================================================================
-- Fase 1 — Identidade, Consentimentos, Perfis, Verificação do Prestador e Admin Mínimo
-- Fonte oficial: docs/DATABASE.md (seções 3.1, 3.2, 5.6, 7), docs/API_SPECIFICATION.md e docs/SECURITY.md
-- =============================================================================

-- 1. Tabela profiles (ADR-11: mesmo UUID de auth.users, sem FK física para permitir exclusão de credencial preservando histórico anonimizado)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) BETWEEN 2 AND 120),
  avatar_path text CHECK (avatar_path IS NULL OR char_length(avatar_path) <= 255),
  phone text CHECK (phone IS NULL OR phone ~ '^\+55[0-9]{10,11}$'),
  phone_verified_at timestamptz,
  age_confirmed_at timestamptz NOT NULL,
  neighborhood_id uuid REFERENCES public.neighborhoods(id) ON DELETE RESTRICT,
  status public.profile_status NOT NULL DEFAULT 'active',
  suspended_reason text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 300),
  suspended_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_profiles_phone_unique
  ON public.profiles (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX idx_profiles_neighborhood_id ON public.profiles (neighborhood_id);
CREATE INDEX idx_profiles_status ON public.profiles (status);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Tabela admin_users (escrita somente via SQL manual / service_role — SEC-26)
CREATE TABLE public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Helper: verifica se o usuário autenticado é admin E está autenticado com MFA (aal2 — SEC-03)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    JOIN public.profiles p ON p.id = au.user_id
    WHERE au.user_id = auth.uid()
      AND p.status = 'active'
      AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;

-- 3. Tabela admin_audit_log (append-only — SEC-09, T-ADM-03)
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.admin_users(user_id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (char_length(action) BETWEEN 2 AND 80),
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 2 AND 40),
  target_id uuid,
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_admin_id ON public.admin_audit_log (admin_id, created_at DESC);
CREATE INDEX idx_admin_audit_log_target ON public.admin_audit_log (target_type, target_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_admin_audit_log_append_only
BEFORE UPDATE OR DELETE ON public.admin_audit_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation();

-- 4. Tabela consent_records (ADR-19, RF-44 — append-only para criação; revogação controlada via RPC)
CREATE TABLE public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('terms', 'privacy', 'biometric_selfie', 'push')),
  version text NOT NULL CHECK (char_length(trim(version)) BETWEEN 1 AND 32),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  ip_hash text CHECK (ip_hash IS NULL OR char_length(ip_hash) = 64)
);

CREATE INDEX idx_consent_records_user_kind ON public.consent_records (user_id, kind, accepted_at DESC);

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_consent_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registros de consentimento não podem ser excluídos.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.user_id <> NEW.user_id
     OR OLD.kind <> NEW.kind
     OR OLD.version <> NEW.version
     OR OLD.accepted_at <> NEW.accepted_at
     OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Apenas a revogação única de consentimento é permitida.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_consent_records_immutable
BEFORE UPDATE OR DELETE ON public.consent_records
FOR EACH ROW EXECUTE FUNCTION public.prevent_consent_mutation();

-- 5. Tabela provider_profiles (DATABASE.md seção 3.2)
CREATE TABLE public.provider_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 2 AND 80),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 500),
  experience_years integer CHECK (experience_years IS NULL OR (experience_years >= 0 AND experience_years <= 70)),
  verification_status public.verification_status NOT NULL DEFAULT 'draft',
  verified_at timestamptz,
  is_paused boolean NOT NULL DEFAULT false,
  rating_avg numeric(3, 2) NOT NULL DEFAULT 0.00 CHECK (rating_avg BETWEEN 0.00 AND 5.00),
  rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  completed_jobs_count integer NOT NULL DEFAULT 0 CHECK (completed_jobs_count >= 0),
  avg_first_response_minutes integer CHECK (avg_first_response_minutes IS NULL OR avg_first_response_minutes >= 0),
  late_cancellations_30d integer NOT NULL DEFAULT 0 CHECK (late_cancellations_30d >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_profiles_active_approved
  ON public.provider_profiles (verification_status, is_paused)
  WHERE verification_status = 'approved';

ALTER TABLE public.provider_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_provider_profiles_updated_at
BEFORE UPDATE ON public.provider_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Tabela verification_submissions (RF-12, RF-41, DATABASE.md seção 3.2)
CREATE TABLE public.verification_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE RESTRICT,
  type public.submission_type NOT NULL,
  status public.submission_status NOT NULL DEFAULT 'pending',
  rejection_reason public.rejection_reason,
  reviewer_notes text CHECK (reviewer_notes IS NULL OR char_length(reviewer_notes) <= 1000),
  appeal_of_submission_id uuid REFERENCES public.verification_submissions(id) ON DELETE SET NULL,
  appeal_text text CHECK (appeal_text IS NULL OR char_length(appeal_text) <= 1000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.admin_users(user_id) ON DELETE RESTRICT,
  files_delete_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'rejected' AND rejection_reason IS NOT NULL)
    OR (status <> 'rejected' AND rejection_reason IS NULL)
  ),
  CHECK (
    (type = 'appeal' AND appeal_of_submission_id IS NOT NULL AND appeal_text IS NOT NULL)
    OR (type <> 'appeal' AND appeal_of_submission_id IS NULL)
  )
);

-- No máximo 1 submissão pending por prestador (T-VER-06)
CREATE UNIQUE INDEX idx_verification_submissions_one_pending
  ON public.verification_submissions (provider_id)
  WHERE status = 'pending';

-- No máximo 1 recurso por submissão rejeitada (T-VER-04)
CREATE UNIQUE INDEX idx_verification_submissions_one_appeal
  ON public.verification_submissions (appeal_of_submission_id)
  WHERE appeal_of_submission_id IS NOT NULL;

CREATE INDEX idx_verification_submissions_provider_created
  ON public.verification_submissions (provider_id, created_at DESC);

CREATE INDEX idx_verification_submissions_reviewed_by
  ON public.verification_submissions (reviewed_by)
  WHERE reviewed_by IS NOT NULL;

CREATE INDEX idx_verification_submissions_purge
  ON public.verification_submissions (files_delete_after)
  WHERE files_delete_after IS NOT NULL;

ALTER TABLE public.verification_submissions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_verification_submissions_updated_at
BEFORE UPDATE ON public.verification_submissions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Tabela provider_documents (metadados dos arquivos no bucket privado `verification`)
CREATE TABLE public.provider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.verification_submissions(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE CASCADE,
  type public.document_type NOT NULL,
  storage_path text NOT NULL UNIQUE CHECK (char_length(storage_path) BETWEEN 5 AND 255),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  purged_at timestamptz,
  UNIQUE (submission_id, type)
);

CREATE INDEX idx_provider_documents_provider_id ON public.provider_documents (provider_id);
CREATE INDEX idx_provider_documents_submission_id ON public.provider_documents (submission_id);

ALTER TABLE public.provider_documents ENABLE ROW LEVEL SECURITY;

-- 8. Tabela provider_sensitive_data (ADR-16, SEC-12: somente cpf_hmac, zero políticas para clientes/admins via PostgREST)
CREATE TABLE public.provider_sensitive_data (
  provider_id uuid PRIMARY KEY REFERENCES public.provider_profiles(user_id) ON DELETE RESTRICT,
  cpf_hmac text NOT NULL UNIQUE CHECK (cpf_hmac ~ '^[0-9a-f]{64}$'),
  banned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_sensitive_data ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_provider_sensitive_data_updated_at
BEFORE UPDATE ON public.provider_sensitive_data
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 9. Tabelas de categorias, bairros, portfólio e disponibilidade do prestador
CREATE TABLE public.provider_categories (
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  specialties text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, category_id)
);

CREATE INDEX idx_provider_categories_category_provider
  ON public.provider_categories (category_id, provider_id);

ALTER TABLE public.provider_categories ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.provider_neighborhoods (
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE CASCADE,
  neighborhood_id uuid NOT NULL REFERENCES public.neighborhoods(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, neighborhood_id)
);

CREATE INDEX idx_provider_neighborhoods_neighborhood_provider
  ON public.provider_neighborhoods (neighborhood_id, provider_id);

ALTER TABLE public.provider_neighborhoods ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.portfolio_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE CASCADE,
  image_path text NOT NULL CHECK (char_length(image_path) BETWEEN 5 AND 255),
  caption text CHECK (caption IS NULL OR char_length(caption) <= 200),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_items_provider_sort
  ON public.portfolio_items (provider_id, sort_order, created_at DESC);

ALTER TABLE public.portfolio_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(user_id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  period public.availability_period NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, weekday, period)
);

CREATE INDEX idx_availability_rules_lookup
  ON public.availability_rules (provider_id, weekday, period);

ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 10. Políticas RLS (DATABASE.md seção 7)
-- =============================================================================

-- profiles: dono lê o próprio; admin com aal2 lê todos
CREATE POLICY profiles_select_own_or_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_admin());

-- admin_users: admin lê apenas sua própria linha
CREATE POLICY admin_users_select_own
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- admin_audit_log: somente admin com MFA lê
CREATE POLICY admin_audit_log_select_admin
  ON public.admin_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- consent_records: dono lê os próprios; admin lê todos
CREATE POLICY consent_records_select_own_or_admin
  ON public.consent_records
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- provider_profiles: dono lê o próprio; autenticados leem aprovados de perfis ativos; admin lê todos
CREATE POLICY provider_profiles_select_visible
  ON public.provider_profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR (
      verification_status = 'approved'
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = provider_profiles.user_id
          AND p.status = 'active'
      )
    )
  );

-- verification_submissions: admin lê todas; dono lê via view my_verification_status
CREATE POLICY verification_submissions_select_own_or_admin
  ON public.verification_submissions
  FOR SELECT
  TO authenticated
  USING (provider_id = auth.uid() OR public.is_admin());

-- provider_documents: apenas admin lê metadados diretamente; dono consulta via view my_verification_status
CREATE POLICY provider_documents_select_admin
  ON public.provider_documents
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- provider_categories: dono lê/escreve; autenticados leem de prestadores aprovados
CREATE POLICY provider_categories_select
  ON public.provider_categories
  FOR SELECT
  TO authenticated
  USING (
    provider_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.user_id = provider_categories.provider_id
        AND pp.verification_status = 'approved'
    )
  );

-- provider_neighborhoods: dono lê; autenticados leem de prestadores aprovados
CREATE POLICY provider_neighborhoods_select
  ON public.provider_neighborhoods
  FOR SELECT
  TO authenticated
  USING (
    provider_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.user_id = provider_neighborhoods.provider_id
        AND pp.verification_status = 'approved'
    )
  );

-- portfolio_items: dono gerencia; autenticados leem de prestadores aprovados
CREATE POLICY portfolio_items_select
  ON public.portfolio_items
  FOR SELECT
  TO authenticated
  USING (
    provider_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.user_id = portfolio_items.provider_id
        AND pp.verification_status = 'approved'
    )
  );

-- availability_rules: apenas dono e admin leem
CREATE POLICY availability_rules_select_own_or_admin
  ON public.availability_rules
  FOR SELECT
  TO authenticated
  USING (provider_id = auth.uid() OR public.is_admin());

-- =============================================================================
-- 11. Views públicas e de status (API_SPECIFICATION.md seção 2)
-- =============================================================================

CREATE VIEW public.public_provider_profiles
WITH (security_invoker = true) AS
SELECT
  pp.user_id AS provider_id,
  pp.display_name,
  p.avatar_path,
  pp.bio,
  pp.experience_years,
  'Identidade verificada'::text AS verification_badge,
  pp.verified_at,
  pp.rating_avg,
  pp.rating_count,
  pp.completed_jobs_count,
  pp.avg_first_response_minutes
FROM public.provider_profiles pp
JOIN public.profiles p ON p.id = pp.user_id
WHERE pp.verification_status = 'approved'
  AND p.status = 'active';

CREATE VIEW public.my_verification_status
WITH (security_invoker = true) AS
SELECT
  vs.id AS submission_id,
  vs.provider_id,
  vs.type,
  vs.status,
  vs.rejection_reason,
  vs.appeal_of_submission_id,
  vs.appeal_text,
  vs.submitted_at,
  vs.reviewed_at
FROM public.verification_submissions vs
WHERE vs.provider_id = auth.uid();

-- =============================================================================
-- 12. Funções RPC da Fase 1 (SECURITY DEFINER com search_path = public — SEC-08)
-- =============================================================================

-- 12.1 Registrar perfil inicial e aceite de termos + privacidade + confirmação 18+ (E1-01)
CREATE OR REPLACE FUNCTION public.complete_initial_signup(
  p_full_name text,
  p_terms_version text,
  p_privacy_version text,
  p_age_confirmed boolean,
  p_neighborhood_id uuid DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF p_age_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: É obrigatório ter pelo menos 18 anos para criar uma conta.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profiles (
    id,
    full_name,
    age_confirmed_at,
    neighborhood_id,
    status
  )
  VALUES (
    v_uid,
    trim(p_full_name),
    now(),
    p_neighborhood_id,
    'active'
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      neighborhood_id = COALESCE(EXCLUDED.neighborhood_id, public.profiles.neighborhood_id)
  RETURNING * INTO v_profile;

  INSERT INTO public.consent_records (user_id, kind, version)
  VALUES
    (v_uid, 'terms', trim(p_terms_version)),
    (v_uid, 'privacy', trim(p_privacy_version));

  RETURN v_profile;
END;
$$;

-- 12.2 Registrar novo consentimento (termos, privacidade, biometric_selfie, push) (RF-44)
CREATE OR REPLACE FUNCTION public.record_consent(
  p_kind text,
  p_version text
)
RETURNS public.consent_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_record public.consent_records;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.consent_records (user_id, kind, version)
  VALUES (v_uid, p_kind, trim(p_version))
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

-- 12.3 Revogar consentimento biométrico da selfie (T-LGPD-02)
CREATE OR REPLACE FUNCTION public.revoke_biometric_consent()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  UPDATE public.consent_records
  SET revoked_at = now()
  WHERE user_id = v_uid
    AND kind = 'biometric_selfie'
    AND revoked_at IS NULL;
END;
$$;

-- 12.4 Atualizar perfil básico (E1-05)
CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_full_name text,
  p_neighborhood_id uuid DEFAULT NULL,
  p_avatar_path text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  UPDATE public.profiles
  SET full_name = trim(p_full_name),
      neighborhood_id = COALESCE(p_neighborhood_id, neighborhood_id),
      avatar_path = COALESCE(p_avatar_path, avatar_path)
  WHERE id = v_uid
    AND status = 'active'
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN v_profile;
END;
$$;

-- 12.5 Criar ou atualizar perfil profissional (E2-01 — nunca altera verification_status nem rating)
CREATE OR REPLACE FUNCTION public.upsert_provider_profile(
  p_display_name text,
  p_bio text,
  p_experience_years integer DEFAULT NULL
)
RETURNS public.provider_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.provider_profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.provider_profiles (
    user_id,
    display_name,
    bio,
    experience_years
  )
  VALUES (
    v_uid,
    trim(p_display_name),
    trim(COALESCE(p_bio, '')),
    p_experience_years
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      experience_years = EXCLUDED.experience_years
  RETURNING * INTO v_provider;

  RETURN v_provider;
END;
$$;

-- 12.6 Definir categorias e bairros do prestador (E2-02, E2-03)
CREATE OR REPLACE FUNCTION public.set_provider_categories(
  p_category_ids uuid[],
  p_specialties text[] DEFAULT '{}'::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cat_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF array_length(p_category_ids, 1) IS NULL OR array_length(p_category_ids, 1) < 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Selecione pelo menos uma categoria.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.provider_categories WHERE provider_id = v_uid;

  FOREACH v_cat_id IN ARRAY p_category_ids LOOP
    INSERT INTO public.provider_categories (provider_id, category_id, specialties)
    VALUES (v_uid, v_cat_id, COALESCE(p_specialties, '{}'::text[]))
    ON CONFLICT (provider_id, category_id) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_provider_neighborhoods(
  p_neighborhood_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nb_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF array_length(p_neighborhood_ids, 1) IS NULL OR array_length(p_neighborhood_ids, 1) < 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Selecione pelo menos um bairro de Osasco.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.provider_neighborhoods WHERE provider_id = v_uid;

  FOREACH v_nb_id IN ARRAY p_neighborhood_ids LOOP
    INSERT INTO public.provider_neighborhoods (provider_id, neighborhood_id)
    VALUES (v_uid, v_nb_id)
    ON CONFLICT (provider_id, neighborhood_id) DO NOTHING;
  END LOOP;
END;
$$;

-- 12.7 Definir regras de disponibilidade (mínimo 1 regra — E2-04) e pausa
CREATE OR REPLACE FUNCTION public.set_provider_availability(
  p_weekdays smallint[],
  p_periods public.availability_period[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_len integer := array_length(p_weekdays, 1);
  i integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF v_len IS NULL OR v_len < 1 OR v_len IS DISTINCT FROM array_length(p_periods, 1) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Defina pelo menos um período de disponibilidade.'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.availability_rules WHERE provider_id = v_uid;

  FOR i IN 1..v_len LOOP
    INSERT INTO public.availability_rules (provider_id, weekday, period)
    VALUES (v_uid, p_weekdays[i], p_periods[i])
    ON CONFLICT (provider_id, weekday, period) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_provider_paused(
  p_is_paused boolean
)
RETURNS public.provider_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_provider public.provider_profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  UPDATE public.provider_profiles
  SET is_paused = p_is_paused
  WHERE user_id = v_uid
  RETURNING * INTO v_provider;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_provider;
END;
$$;

-- 12.8 Submeter prestador para análise (E2-05, E2-07, T-VER-04..07)
CREATE OR REPLACE FUNCTION public.submit_provider_for_review(
  p_submission_id uuid
)
RETURNS public.verification_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_provider public.provider_profiles;
  v_submission public.verification_submissions;
  v_doc_count integer;
  v_recent_submissions integer;
  v_last_rejected public.verification_submissions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_profile.phone_verified_at IS NULL THEN
    RAISE EXCEPTION 'PHONE_NOT_VERIFIED' USING ERRCODE = '42501';
  END IF;

  -- Verifica consentimento biométrico ativo (T-VER-07, T-LGPD-02)
  IF NOT EXISTS (
    SELECT 1
    FROM public.consent_records cr
    WHERE cr.user_id = v_uid
      AND cr.kind = 'biometric_selfie'
      AND cr.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED: Consentimento biométrico para selfie é obrigatório.'
      USING ERRCODE = '42501';
  END IF;

  -- Verifica CPF hash registrado e não banido (T-VER-02)
  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_sensitive_data psd
    WHERE psd.provider_id = v_uid
      AND psd.banned_at IS NULL
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Dados de verificação incompletos ou bloqueados.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_provider
  FROM public.provider_profiles
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_provider.verification_status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_STATE' USING ERRCODE = '22023';
  END IF;

  -- Se rejeitado anteriormente por fraude ou conta duplicada, reenvio automático é vedado (só recurso)
  SELECT * INTO v_last_rejected
  FROM public.verification_submissions
  WHERE provider_id = v_uid
    AND status = 'rejected'
  ORDER BY reviewed_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF FOUND AND v_last_rejected.rejection_reason IN ('suspected_fraud', 'duplicate_account') THEN
    RAISE EXCEPTION 'FORBIDDEN: Esta rejeição permite apenas recurso formal.'
      USING ERRCODE = '42501';
  END IF;

  -- Limite de 3 reenvios em 30 dias (T-VER-04)
  SELECT count(*) INTO v_recent_submissions
  FROM public.verification_submissions
  WHERE provider_id = v_uid
    AND type = 'resubmission'
    AND submitted_at >= now() - interval '30 days';

  IF v_recent_submissions >= 3 THEN
    RAISE EXCEPTION 'RATE_LIMITED: Limite de 3 reenvios em 30 dias atingido.'
      USING ERRCODE = '42501';
  END IF;

  -- Verifica se os 3 documentos obrigatórios foram enviados na submissão (id_front, id_back, selfie)
  SELECT count(DISTINCT type) INTO v_doc_count
  FROM public.provider_documents
  WHERE submission_id = p_submission_id
    AND provider_id = v_uid
    AND purged_at IS NULL;

  IF v_doc_count < 3 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Envie frente do documento, verso e selfie.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_submission
  FROM public.verification_submissions
  WHERE id = p_submission_id
    AND provider_id = v_uid
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.provider_profiles
  SET verification_status = 'pending_review'
  WHERE user_id = v_uid;

  INSERT INTO public.status_events (entity_type, entity_id, from_status, to_status, actor_id, reason)
  VALUES ('verification', v_submission.id, v_provider.verification_status::text, 'pending_review', v_uid, 'provider_submitted');

  RETURN v_submission;
END;
$$;

-- 12.9 Abrir recurso contra rejeição de verificação (RF-41, T-VER-04: 1 vez em até 15 dias)
CREATE OR REPLACE FUNCTION public.appeal_verification(
  p_rejected_submission_id uuid,
  p_appeal_text text
)
RETURNS public.verification_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rejected public.verification_submissions;
  v_provider public.provider_profiles;
  v_appeal public.verification_submissions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF char_length(trim(COALESCE(p_appeal_text, ''))) < 10 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Explique o motivo do recurso (mín. 10 caracteres).'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_provider
  FROM public.provider_profiles
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_provider.verification_status <> 'rejected' THEN
    RAISE EXCEPTION 'INVALID_STATE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rejected
  FROM public.verification_submissions
  WHERE id = p_rejected_submission_id
    AND provider_id = v_uid
    AND status = 'rejected'
    AND type <> 'appeal';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_rejected.reviewed_at, v_rejected.created_at) < now() - interval '15 days' THEN
    RAISE EXCEPTION 'INVALID_STATE: O prazo de 15 dias para recurso expirou.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.verification_submissions (
    provider_id,
    type,
    status,
    appeal_of_submission_id,
    appeal_text
  )
  VALUES (
    v_uid,
    'appeal',
    'pending',
    v_rejected.id,
    trim(p_appeal_text)
  )
  RETURNING * INTO v_appeal;

  UPDATE public.provider_profiles
  SET verification_status = 'pending_review'
  WHERE user_id = v_uid;

  INSERT INTO public.status_events (entity_type, entity_id, from_status, to_status, actor_id, reason)
  VALUES ('verification', v_appeal.id, 'rejected', 'pending_review', v_uid, 'appeal_submitted');

  RETURN v_appeal;
END;
$$;

-- 12.10 Purga automática de arquivos de verificação vencidos (RF-48, T-VER-05)
CREATE OR REPLACE FUNCTION public.purge_expired_verification_files()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purged_count integer;
BEGIN
  -- Só pode ser chamada por service_role / cron (auth.uid() nulo)
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  WITH purged AS (
    UPDATE public.provider_documents pd
    SET purged_at = now()
    FROM public.verification_submissions vs
    WHERE pd.submission_id = vs.id
      AND pd.purged_at IS NULL
      AND vs.files_delete_after IS NOT NULL
      AND vs.files_delete_after <= now()
      -- Não purga se houver recurso pendente vinculado a esta submissão
      AND NOT EXISTS (
        SELECT 1
        FROM public.verification_submissions ap
        WHERE ap.appeal_of_submission_id = vs.id
          AND ap.status = 'pending'
      )
    RETURNING pd.id
  )
  SELECT count(*) INTO v_purged_count FROM purged;

  RETURN v_purged_count;
END;
$$;

-- =============================================================================
-- 13. Permissões (GRANT / REVOKE — SEC-07: escrita direta bloqueada nas tabelas)
-- =============================================================================

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;

REVOKE ALL ON public.admin_users FROM anon, authenticated;
GRANT SELECT ON public.admin_users TO authenticated;

REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;
GRANT SELECT ON public.admin_audit_log TO authenticated;

REVOKE ALL ON public.consent_records FROM anon, authenticated;
GRANT SELECT ON public.consent_records TO authenticated;

REVOKE ALL ON public.provider_profiles FROM anon, authenticated;
GRANT SELECT ON public.provider_profiles TO authenticated;

REVOKE ALL ON public.verification_submissions FROM anon, authenticated;
GRANT SELECT ON public.verification_submissions TO authenticated;

REVOKE ALL ON public.provider_documents FROM anon, authenticated;
GRANT SELECT ON public.provider_documents TO authenticated;

REVOKE ALL ON public.provider_sensitive_data FROM anon, authenticated;

REVOKE ALL ON public.provider_categories FROM anon, authenticated;
GRANT SELECT ON public.provider_categories TO authenticated;

REVOKE ALL ON public.provider_neighborhoods FROM anon, authenticated;
GRANT SELECT ON public.provider_neighborhoods TO authenticated;

REVOKE ALL ON public.portfolio_items FROM anon, authenticated;
GRANT SELECT ON public.portfolio_items TO authenticated;

REVOKE ALL ON public.availability_rules FROM anon, authenticated;
GRANT SELECT ON public.availability_rules TO authenticated;

GRANT SELECT ON public.public_provider_profiles TO authenticated;
GRANT SELECT ON public.my_verification_status TO authenticated;
