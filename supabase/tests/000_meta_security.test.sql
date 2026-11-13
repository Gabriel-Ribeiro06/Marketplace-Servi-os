-- =============================================================================
-- Teste Meta de Segurança e RLS (pgTAP) — BACKLOG E0-04 / TEST_STRATEGY.md seção 2
-- Executa no Postgres via `supabase test db`
-- =============================================================================

BEGIN;
SELECT plan(9);

-- 1. Nenhuma tabela em public pode estar sem RLS habilitada (SEC-06)
SELECT is_empty(
  $$
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = false
  $$,
  'SEC-06: Todas as tabelas do schema public devem ter RLS habilitada'
);

-- 2. Tabelas da Fase 0..5 (todas as 31 tabelas do MVP) existem e têm RLS ativa
SELECT results_eq(
  $$
    SELECT tablename::text
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = true
    ORDER BY tablename
  $$,
  ARRAY[
    'account_deletion_log',
    'admin_audit_log',
    'admin_users',
    'app_config',
    'availability_rules',
    'categories',
    'consent_records',
    'conversations',
    'jobs',
    'messages',
    'neighborhoods',
    'notifications',
    'portfolio_items',
    'profiles',
    'provider_categories',
    'provider_documents',
    'provider_neighborhoods',
    'provider_profiles',
    'provider_sensitive_data',
    'push_tokens',
    'quotes',
    'reports',
    'request_matches',
    'request_media',
    'reviews',
    'service_request_private',
    'service_requests',
    'status_events',
    'unserved_demand',
    'user_blocks',
    'verification_submissions'
  ],
  'Fase 0..5: Todas as 31 tabelas do MVP existem com RLS ativa'
);

-- 3. Papel anon não pode ter privilégio de INSERT/UPDATE/DELETE em nenhuma tabela public (SEC-07)
SELECT is_empty(
  $$
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'anon'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  $$,
  'SEC-07: Papel anon não possui permissão de escrita em tabelas public'
);

-- 4. Papel authenticated não pode ter privilégio de INSERT/UPDATE/DELETE direto nas tabelas protegidas por RPC/EF (SEC-07)
SELECT is_empty(
  $$
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'authenticated'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  $$,
  'SEC-07: Papel authenticated não possui escrita direta em tabelas public (tudo via RPC/EF)'
);

-- 5. Toda função SECURITY DEFINER em public deve fixar search_path (SEC-08)
SELECT is_empty(
  $$
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(p.proconfig) cfg
          WHERE cfg LIKE 'search_path=%'
        )
      )
  $$,
  'SEC-08: Todas as funções SECURITY DEFINER em public possuem search_path fixo'
);

-- 6. status_events é append-only: UPDATE e DELETE devem falhar
INSERT INTO public.status_events (entity_type, entity_id, from_status, to_status, reason)
VALUES ('request', '550e8400-e29b-41d4-a716-446655440000', NULL, 'open', 'teste_meta');

SELECT throws_ok(
  $$
    UPDATE public.status_events SET to_status = 'cancelled'
  $$,
  '42501',
  NULL,
  'ADR-18: UPDATE em status_events deve ser bloqueado pelo trigger append-only'
);

SELECT throws_ok(
  $$
    DELETE FROM public.status_events
  $$,
  '42501',
  NULL,
  'ADR-18: DELETE em status_events deve ser bloqueado pelo trigger append-only'
);

-- 7. account_deletion_log é append-only: UPDATE e DELETE devem falhar
INSERT INTO public.account_deletion_log (user_id_hash, requested_at, legal_hold_applied)
VALUES (repeat('a', 64), now(), false);

SELECT throws_ok(
  $$
    UPDATE public.account_deletion_log SET legal_hold_applied = true
  $$,
  '42501',
  NULL,
  'RF-04: UPDATE em account_deletion_log deve ser bloqueado pelo trigger append-only'
);

SELECT throws_ok(
  $$
    DELETE FROM public.account_deletion_log
  $$,
  '42501',
  NULL,
  'RF-04: DELETE em account_deletion_log deve ser bloqueado pelo trigger append-only'
);

SELECT * FROM finish();
ROLLBACK;
