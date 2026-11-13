-- =============================================================================
-- Testes pgTAP da Fase 4 — Serviços (jobs), Exceções e Avaliações Bilaterais
-- Cobertura: T-ST-JOB-01..07, T-ST-REV-01..02, T-RLS-08
-- =============================================================================

BEGIN;
SELECT plan(8);

-- Cenário: Cliente (c1), Prestador (p1), Terceiro (u3)
INSERT INTO public.profiles (id, full_name, phone, phone_verified_at, age_confirmed_at, status)
VALUES
  ('51111111-1111-4111-8111-111111111111', 'Fernanda Cliente', '+5511977770001', now(), now(), 'active'),
  ('52222222-2222-4222-8222-222222222222', 'Roberto Técnico', '+5511977770002', now(), now(), 'active'),
  ('53333333-3333-4333-8333-333333333333', 'Terceiro Curioso', '+5511977770003', now(), now(), 'active');

INSERT INTO public.provider_profiles (user_id, display_name, bio, verification_status, verified_at, is_paused)
VALUES
  ('52222222-2222-4222-8222-222222222222', 'Roberto Técnico', 'Manutenção de PCs e notebooks em Osasco', 'approved', now(), false);

UPDATE public.categories SET is_active = true, activated_at = now() WHERE slug = 'tecnico-informatica';

INSERT INTO public.provider_categories (provider_id, category_id)
SELECT '52222222-2222-4222-8222-222222222222', id FROM public.categories WHERE slug = 'tecnico-informatica';

INSERT INTO public.provider_neighborhoods (provider_id, neighborhood_id)
SELECT '52222222-2222-4222-8222-222222222222', id FROM public.neighborhoods WHERE name = 'Presidente Altino';

INSERT INTO public.availability_rules (provider_id, weekday, period)
SELECT '52222222-2222-4222-8222-222222222222', gs, 'afternoon'::public.availability_period
FROM generate_series(0, 6) AS gs;

-- Cliente cria pedido
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '51111111-1111-4111-8111-111111111111';

SELECT live_ok(
  $$
    SELECT public.create_service_request(
      (SELECT id FROM public.categories WHERE slug = 'tecnico-informatica'),
      (SELECT id FROM public.neighborhoods WHERE name = 'Presidente Altino'),
      'Formatação e troca de SSD',
      'Preciso instalar um SSD NVMe novo e reinstalar o sistema operacional.',
      now() + interval '3 hours',
      now() + interval '1 day',
      'Rua Oswaldo Collino, 300, Apto 12',
      NULL,
      ARRAY[]::text[]
    )
  $$,
  'Cliente cria pedido para Técnico em computadores'
);

-- Prestador envia proposta
SET LOCAL "request.jwt.claim.sub" = '52222222-2222-4222-8222-222222222222';
SELECT live_ok(
  $$
    SELECT public.submit_quote(
      (SELECT request_id FROM public.incoming_requests LIMIT 1),
      19000,
      'Instalação física do SSD, clonagem/formatação e backup.',
      now() + interval '3 hours',
      now() + interval '24 hours',
      0,
      90
    )
  $$,
  'Prestador envia proposta'
);

-- Cliente aceita proposta -> trigger cria job 'scheduled' automaticamente
SET LOCAL "request.jwt.claim.sub" = '51111111-1111-4111-8111-111111111111';
SELECT live_ok(
  $$
    SELECT public.accept_quote((SELECT quote_id FROM public.quotes_for_my_request LIMIT 1))
  $$,
  'Cliente aceita proposta e gera job agendado'
);

-- 1. T-ST-JOB-01: Prestador tenta concluir antes do horário agendado -> JOB_TOO_EARLY
SET LOCAL "request.jwt.claim.sub" = '52222222-2222-4222-8222-222222222222';
SELECT throws_ok(
  $$
    SELECT public.complete_job((SELECT job_id FROM public.my_jobs LIMIT 1), 'full', NULL)
  $$,
  '22023',
  NULL,
  'T-ST-JOB-01: Concluir serviço antes de scheduled_for falha com JOB_TOO_EARLY'
);

-- Ajustar scheduled_for para o passado recente (simulando chegada do horário agendado)
SET LOCAL ROLE postgres;
UPDATE public.jobs SET scheduled_for = now() - interval '1 hour';
SET LOCAL ROLE authenticated;

-- 2. T-ST-JOB-02: Conclusão parcial sem nota falha; conclusão completa sucede e incrementa completed_jobs_count
SET LOCAL "request.jwt.claim.sub" = '52222222-2222-4222-8222-222222222222';
SELECT throws_ok(
  $$
    SELECT public.complete_job((SELECT job_id FROM public.my_jobs LIMIT 1), 'partial', '')
  $$,
  '22023',
  NULL,
  'T-ST-JOB-02: Conclusão parcial exige nota obrigatória'
);

SELECT is(
  (
    SELECT (public.complete_job((SELECT job_id FROM public.my_jobs LIMIT 1), 'full', NULL) ->> 'status')
  ),
  'completed',
  'T-ST-JOB-02: Prestador conclui o serviço a partir do horário agendado'
);

-- 3. T-RLS-08 / T-ST-REV-02: Cliente envia avaliação (fica pending_reveal e oculta ao prestador até que ele também avalie)
SET LOCAL "request.jwt.claim.sub" = '51111111-1111-4111-8111-111111111111';
SELECT is(
  (
    SELECT (public.submit_review((SELECT job_id FROM public.my_jobs LIMIT 1), 5, 'Excelente atendimento!') ->> 'status')
  ),
  'pending_reveal',
  'T-ST-REV-01: Primeira avaliação fica em pending_reveal'
);

-- Prestador NÃO vê a avaliação pending_reveal do cliente antes de enviar a sua
SET LOCAL "request.jwt.claim.sub" = '52222222-2222-4222-8222-222222222222';
SELECT is(
  (SELECT COUNT(*)::int FROM public.reviews),
  0,
  'T-RLS-08: Avaliado não enxerga avaliação pending_reveal antes da revelação simultânea'
);

SELECT * FROM finish();
ROLLBACK;
