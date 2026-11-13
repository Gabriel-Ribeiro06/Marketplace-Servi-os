-- =============================================================================
-- Testes pgTAP da Fase 1 — Identidade, Consentimentos, Verificação e Admin (T-RLS, T-VER, T-ADM, T-LGPD)
-- =============================================================================

BEGIN;
SELECT plan(10);

-- Setup de usuários sintéticos (como superuser de teste)
INSERT INTO public.profiles (id, full_name, phone, phone_verified_at, age_confirmed_at, status)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Maria Cliente', '+5511999990001', now(), now(), 'active'),
  ('22222222-2222-4222-8222-222222222222', 'José Prestador', '+5511999990002', now(), now(), 'active'),
  ('99999999-9999-4999-8999-999999999999', 'Admin Operador', '+5511999990099', now(), now(), 'active');

INSERT INTO public.admin_users (user_id)
VALUES ('99999999-9999-4999-8999-999999999999');

-- 1. T-ADM-03: admin_audit_log é imutável (UPDATE/DELETE falham mesmo para superuser)
INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, reason)
VALUES (
  '99999999-9999-4999-8999-999999999999',
  'open_document',
  'provider_document',
  '22222222-2222-4222-8222-222222222222',
  'Conferência de RG inicial'
);

SELECT throws_ok(
  $$
    UPDATE public.admin_audit_log SET reason = 'Alterado'
  $$,
  '42501',
  NULL,
  'T-ADM-03: UPDATE em admin_audit_log é bloqueado por trigger'
);

SELECT throws_ok(
  $$
    DELETE FROM public.admin_audit_log
  $$,
  '42501',
  NULL,
  'T-ADM-03: DELETE em admin_audit_log é bloqueado por trigger'
);

-- 2. T-LGPD-01: consent_records não pode ser deletado nem ter campos históricos alterados
INSERT INTO public.consent_records (user_id, kind, version)
VALUES ('22222222-2222-4222-8222-222222222222', 'biometric_selfie', '1.0');

SELECT throws_ok(
  $$
    DELETE FROM public.consent_records WHERE user_id = '22222222-2222-4222-8222-222222222222'
  $$,
  '42501',
  NULL,
  'T-LGPD-01: DELETE em consent_records é bloqueado'
);

-- 3. T-VER-02: cpf_hmac duplicado é bloqueado pela constraint UNIQUE
INSERT INTO public.provider_profiles (user_id, display_name, bio)
VALUES ('22222222-2222-4222-8222-222222222222', 'Seu José Eletricista', 'Eletricista residencial');

INSERT INTO public.provider_profiles (user_id, display_name, bio)
VALUES ('11111111-1111-4111-8111-111111111111', 'Outro Perfil', 'Bio');

INSERT INTO public.provider_sensitive_data (provider_id, cpf_hmac)
VALUES ('22222222-2222-4222-8222-222222222222', repeat('b', 64));

SELECT throws_ok(
  $$
    INSERT INTO public.provider_sensitive_data (provider_id, cpf_hmac)
    VALUES ('11111111-1111-4111-8111-111111111111', repeat('b', 64))
  $$,
  '23505',
  NULL,
  'T-VER-02: cpf_hmac duplicado deve violar constraint UNIQUE'
);

-- 4. T-VER-06: No máximo uma submissão pending por prestador
INSERT INTO public.verification_submissions (id, provider_id, type, status)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'initial', 'pending');

SELECT throws_ok(
  $$
    INSERT INTO public.verification_submissions (provider_id, type, status)
    VALUES ('22222222-2222-4222-8222-222222222222', 'resubmission', 'pending')
  $$,
  '23505',
  NULL,
  'T-VER-06: Segunda submissão pending para o mesmo prestador é bloqueada pelo índice único parcial'
);

-- 5. T-VER-05: purge_expired_verification_files purga apenas arquivos vencidos e sem recurso pendente
INSERT INTO public.provider_documents (submission_id, provider_id, type, storage_path)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'id_front', 'verification/2222/front.jpg'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'id_back', 'verification/2222/back.jpg'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'selfie', 'verification/2222/selfie.jpg');

UPDATE public.verification_submissions
SET status = 'approved',
    reviewed_at = now() - interval '31 days',
    reviewed_by = '99999999-9999-4999-8999-999999999999',
    files_delete_after = now() - interval '1 day'
WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

SELECT is(
  public.purge_expired_verification_files(),
  3,
  'T-VER-05: purge_expired_verification_files marca os 3 documentos vencidos como purgados'
);

-- 6. Simular usuário autenticado comum (Maria Cliente) e testar isolamento RLS (T-RLS-02, T-VER-01)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated", "aal": "aal1"}';

SELECT is_empty(
  $$
    SELECT * FROM public.profiles WHERE id = '22222222-2222-4222-8222-222222222222'
  $$,
  'T-RLS-02: Cliente não lê linha de outro usuário em profiles'
);

SELECT is_empty(
  $$
    SELECT * FROM public.provider_sensitive_data
  $$,
  'T-VER-01: Usuário autenticado não lê provider_sensitive_data'
);

SELECT is_empty(
  $$
    SELECT * FROM public.provider_documents
  $$,
  'T-STO-01: Usuário comum não lê provider_documents'
);

-- 7. T-ADM-01: Admin SEM MFA (aal1) não passa em public.is_admin()
SET LOCAL "request.jwt.claims" = '{"sub": "99999999-9999-4999-8999-999999999999", "role": "authenticated", "aal": "aal1"}';

SELECT is(
  public.is_admin(),
  false,
  'T-ADM-01: Admin autenticado apenas com aal1 (sem MFA) retorna is_admin() = false'
);

SELECT * FROM finish();
ROLLBACK;
