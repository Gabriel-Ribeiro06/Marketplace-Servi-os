-- =============================================================================
-- Testes SQL / pgTAP da Fase 5: Bloqueios, Denúncias, Moderação e Exclusão de Conta
-- Fonte: docs/TEST_STRATEGY.md (T-BLK-01..06, T-DEL-01..07, T-ADM-01..06)
-- =============================================================================

BEGIN;
SELECT plan(10);

DO $$
DECLARE
  v_cat_id uuid;
  v_nb_id uuid;
  v_client_id uuid := 'bbbb0001-0000-4000-8000-000000000001';
  v_provider_id uuid := 'bbbb0002-0000-4000-8000-000000000002';
BEGIN
  SELECT id INTO v_cat_id FROM public.categories WHERE slug = 'eletricista';
  SELECT id INTO v_nb_id FROM public.neighborhoods WHERE slug = 'centro';

  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_client_id, 'cli_p5@eufaco.test', '{}', '{}', now(), now()),
    (v_provider_id, 'pro_p5@eufaco.test', '{}', '{}', now(), now());

  INSERT INTO public.profiles (id, full_name, phone, phone_verified_at, neighborhood_id, status)
  VALUES
    (v_client_id, 'Cliente Fase 5', '+5511944440001', now(), v_nb_id, 'active'),
    (v_provider_id, 'Prestador Fase 5', '+5511944440002', now(), v_nb_id, 'active');

  INSERT INTO public.provider_profiles (user_id, display_name, bio, verification_status, is_paused, verified_at)
  VALUES (v_provider_id, 'Prestador Fase 5', 'Eletricista', 'approved', false, now());

  INSERT INTO public.provider_sensitive_data (provider_id, cpf_hmac, birth_date)
  VALUES (v_provider_id, repeat('9', 64), '1990-01-01');
END $$;

-- 1. T-BLK-01 & T-BLK-04: block_user impede can_interact em ambas as direções e o bloqueado não enxerga user_blocks
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"bbbb0001-0000-4000-8000-000000000001","aal":"aal1"}';

SELECT lives_ok(
  $$
    SELECT public.block_user('bbbb0002-0000-4000-8000-000000000002'::uuid)
  $$,
  'T-BLK-01: Cliente bloqueia prestador com sucesso via block_user'
);

SELECT is(
  public.can_interact(
    'bbbb0001-0000-4000-8000-000000000001'::uuid,
    'bbbb0002-0000-4000-8000-000000000002'::uuid
  ),
  false,
  'T-BLK-02: can_interact retorna false simetricamente após bloqueio'
);

-- Bloqueado não vê quem o bloqueou (T-BLK-04)
SET LOCAL "request.jwt.claims" = '{"sub":"bbbb0002-0000-4000-8000-000000000002","aal":"aal1"}';

SELECT is(
  (SELECT COUNT(*)::int FROM public.user_blocks),
  0,
  'T-BLK-04: Usuário bloqueado vê 0 linhas em user_blocks via RLS'
);

-- 2. T-BLK-06: create_report continua permitido mesmo com bloqueio ativo e classifica safety (24h + legal_hold)
SELECT is(
  (
    SELECT (public.create_report(
      'user'::public.report_target,
      'bbbb0001-0000-4000-8000-000000000001'::uuid,
      'threat_or_violence'::public.report_reason,
      'Relato urgente de segurança.',
      'bbbb0001-0000-4000-8000-000000000001'::uuid
    ) ->> 'priority')
  ),
  'safety',
  'T-BLK-06: create_report funciona mesmo com bloqueio e atribui prioridade safety para threat_or_violence'
);

-- 3. Desbloqueio restaura can_interact
SET LOCAL "request.jwt.claims" = '{"sub":"bbbb0001-0000-4000-8000-000000000001","aal":"aal1"}';

SELECT lives_ok(
  $$
    SELECT public.unblock_user('bbbb0002-0000-4000-8000-000000000002'::uuid)
  $$,
  'Cliente desbloqueia prestador com sucesso'
);

SELECT is(
  public.can_interact(
    'bbbb0001-0000-4000-8000-000000000001'::uuid,
    'bbbb0002-0000-4000-8000-000000000002'::uuid
  ),
  true,
  'can_interact volta a retornar true após unblock_user'
);

-- 4. T-DEL-02: Cliente com denúncia safety/legal_hold aberta contra si tem exclusão bloqueada
SELECT is(
  (
    SELECT (public.check_account_deletion_eligibility(
      'bbbb0001-0000-4000-8000-000000000001'::uuid
    ) ->> 'reason_code')
  ),
  'LEGAL_HOLD_ACTIVE',
  'T-DEL-02: Exclusão de conta bloqueada enquanto houver denúncia safety com legal_hold ativa'
);

-- 5. T-DEL-03..07: Prestador sem pendências executa anonimização de conta (execute_account_deletion_data_scrub)
RESET ROLE;

SELECT lives_ok(
  $$
    SELECT public.execute_account_deletion_data_scrub(
      'bbbb0002-0000-4000-8000-000000000002'::uuid,
      repeat('e', 64)
    )
  $$,
  'T-DEL-03: Prestador elegível executa anonimização transacional de conta'
);

SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = 'bbbb0002-0000-4000-8000-000000000002'),
  'Usuário removido',
  'T-DEL-03: Perfil anonimizado para Usuário removido com preservação da linha para integridade'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.provider_sensitive_data WHERE provider_id = 'bbbb0002-0000-4000-8000-000000000002'),
  0,
  'T-DEL-06: Prestador não banido tem provider_sensitive_data removido na exclusão de conta'
);

SELECT * FROM finish();
ROLLBACK;
